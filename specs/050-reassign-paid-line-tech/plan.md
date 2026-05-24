# Implementation Plan: Correct staff attribution on a paid ticket (within open pay period)

**Branch**: `050-reassign-paid-line-tech` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/050-reassign-paid-line-tech/spec.md`

## Summary

An owner or manager can change the assigned technician on a single service line of a paid ticket, from inside the existing `ReceiptDrawer`, as long as the ticket's pay period is still open (no `payroll_payouts` row exists for that period and the `pay_periods` row is not `status='closed'`). Non-privileged users (technician, front-desk) see no change to the drawer chrome and are rejected at the server. Once the period is finalized, every staff chip on every paid line shows a small `Lock` indicator with the tooltip *"Payouts for this pay period have been finalized."* and no "change" affordance.

**Technical approach.** Adapt the open-cart pattern already used by `setLineTech` in `app/(studio)/checkout/actions.ts` (lines ~580–641). Add a new server action `reassignPaidLineTech` that mirrors `setLineTech` but adds three gates: role must be `owner` or `manager`; ticket status must be `paid`; the resolved pay period must not be finalized. Write a new audit action `ticket.line_tech_reassigned` (distinct from the checkout-time `ticket.line_tech_assigned`) so reports can separate the two. Revalidate `/transactions`, `/dashboard`, `/report`, and `/payroll` so every downstream view reflects the new attribution on the next render. The receipt drawer gets a per-line inline picker (small "Change" link next to the chip, opening the existing active-staff Popover) for privileged roles in an open period, and a `Lock` icon + Tooltip on every chip in a finalized period. No new dependencies; no schema change.

## Technical Context

**Language/Version**: TypeScript 5.x · Node 24 LTS

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server Actions) · `@supabase/supabase-js` · shadcn/ui (Radix primitives in `components/ui/*`) · Tailwind · Lucide

**Storage**: Supabase Postgres (existing tables only — `tickets`, `ticket_items`, `staff`, `pay_periods`, `payroll_payouts`, `audit_log`). No new tables, columns, or indexes.

**Testing**: Vitest (unit) · Playwright (e2e against seeded local Supabase)

**Target Platform**: Vercel (Fluid Compute Next.js) · modern desktop & tablet browsers (the Tang Nails studio runs on the salon's iPad and front-desk laptop)

**Project Type**: Single Next.js web app — the existing `app/(studio)/*` surface

**Performance Goals**: Reassignment Server Action p95 ≤ 250 ms (mirrors the existing `setLineTech` budget: one ticket read, one staff read, one line read, one update, one audit insert, four `revalidatePath` calls). Drawer renders with the new control add ≤ 5 ms over the current render.

**Constraints**: Server-authoritative authorization (Principle II); exactly one audit row per successful reassignment (Principle III, FR-010); zero monetary fields touched (FR-007, SC-006); design-system fidelity (Principle I) — the only new chrome is one inline "Change" trigger and one `Lock` affordance with Tooltip, both via existing `components/ui/*` primitives and Lucide.

**Scale/Scope**: Single salon, ~5–10 staff, ~50–200 paid tickets per pay period. Reassignment is a rare, manual, owner/manager-driven correction action — concurrent contention is essentially zero.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see end of file.*

| Principle | Status | Evidence |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ PASS | Two pieces of new chrome only: (1) inline "Change" trigger next to the staff chip on a paid line, reusing the cart's Popover-based active-staff picker pattern from `components/lacquer/checkout/cart-row-with-tech.tsx`; (2) `Lock` icon (Lucide, 1.5px stroke, 16px) inside the staff chip in finalized periods, with the existing `components/ui/tooltip.tsx` for the tooltip. All sizing/spacing/color from `styles/tokens.css`; no new tokens. The drawer adapts `design-system/prototypes/transaction/TransactionsPage.jsx` — no redraw. |
| **II. Server-Authoritative Architecture** | ✅ PASS | New `reassignPaidLineTech` Server Action lives in `app/(studio)/transactions/actions.ts` (or extends `app/(studio)/checkout/actions.ts`'s pattern). Role check (`viewer.staff.role in {owner, manager}`) is enforced **inside the action**, not in the client. The UI hides the affordance for non-privileged roles as defense in depth (FR-014). Supabase RLS remains the anonymous-access backstop. No client write paths. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ PASS | Every successful reassignment writes exactly one `audit_log` row with action `ticket.line_tech_reassigned` (distinct from `ticket.line_tech_assigned` used at checkout time — FR-010). Payload carries ticket id, line id, previous staff id (nullable, FR-006), new staff id, ticket `closed_at`, pay period `starts_on`, both `actor_user_id` and `acting_as_staff_id` (FR-011). No-op (same tech) writes no audit row (FR-013). Money invariants are trivially preserved — only `ticket_items.assigned_staff_id` is mutated; subtotal/tip/discount/total fields are never read or written (FR-007, SC-006). |
| **IV. Test-First for Critical Paths** | ✅ PASS | Critical paths covered: (a) Vitest unit tests for the new `isPayPeriodFinalized(payPeriodRef)` helper and the `reassignPaidLineTech` Server Action (all six gates: role, paid-state, finalized-period, staff-inactive, ticket-not-found, line-not-on-ticket, no-op same-tech); (b) one Playwright e2e spec `transactions-paid-line-reassign.spec.ts` covering US1 (owner reassigns), US2 (technician/front-desk see no affordance + server rejection on direct call), US3 (finalized period locks the surface), and the no-op edge case. Tests are written first per Principle IV — money/auth logic. |
| **V. Scope Discipline & Cost Restraint** | ✅ PASS | Reuses existing tables, helpers, and components verbatim — no new tables, columns, migrations, or paid services. The picker is the same one the cart already uses. The pay-period helper (`resolvePayPeriod` from `lib/payroll/window.ts`) and the finalized-period signal (`pay_periods` row + `payroll_payouts` existence) are existing. Spec explicitly excludes void/refund, money-field edits, line-add/remove, and bulk corrections (FR-007, Assumptions § "No void/refund flow"). |

**Result**: PASS. No deviations. Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/050-reassign-paid-line-tech/
├── plan.md              # This file
├── spec.md              # Existing feature specification
├── research.md          # Phase 0 output (see below)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── server-actions.md  # Phase 1 output — reassignPaidLineTech contract
└── tasks.md             # Phase 2 output (generated by /speckit-tasks — NOT here)
```

### Source Code (repository root)

```text
# New files
app/(studio)/transactions/actions.ts          # NEW — exports reassignPaidLineTech
                                              #       (collocate with the surface the
                                              #       drawer lives on; mirrors the
                                              #       checkout/actions.ts pattern)
lib/payroll/finalized.ts                      # NEW — isPayPeriodFinalized(supabase, ref)
                                              #       single-purpose helper, returns
                                              #       true iff the pay_periods row for
                                              #       (starts_on) exists AND either
                                              #       status='closed' OR ≥1 row in
                                              #       payroll_payouts ties to its id
components/lacquer/transactions/
  receipt-line-tech-chip.tsx                  # NEW — extracted per-line tech chip
                                              #       that renders one of three
                                              #       affordances: plain chip,
                                              #       chip + "Change" trigger
                                              #       (privileged + open period),
                                              #       or chip + Lock + Tooltip
                                              #       (finalized period, all roles)
tests/unit/transactions/
  reassign-paid-line-tech.test.ts             # NEW — Vitest, covers all 6 gates +
                                              #       no-op + audit-row shape
tests/unit/payroll/
  finalized.test.ts                           # NEW — Vitest, covers the helper's
                                              #       three branches (no row,
                                              #       row+closed, row+payouts exist)
tests/e2e/
  transactions-paid-line-reassign.spec.ts     # NEW — Playwright, US1+US2+US3

# Modified files
components/lacquer/transactions/
  receipt-drawer.tsx                          # MOD — replace inline tech-chip JSX
                                              #       (lines ~170–179) with the new
                                              #       <ReceiptLineTechChip>. Drawer
                                              #       receives `viewerRole` and
                                              #       `payPeriodFinalized` as new
                                              #       props from its server parent.
components/lacquer/transactions/
  transactions-view.client.tsx                # MOD — thread `viewerRole` +
                                              #       `payPeriodFinalized` (per-tx)
                                              #       through to <ReceiptDrawer>.
                                              #       Plus: refresh after a
                                              #       reassignment save (router
                                              #       refresh — Server Action's
                                              #       revalidatePath does the rest).
app/(studio)/transactions/page.tsx            # MOD — compute viewer role from
                                              #       requireStudioSession() and
                                              #       compute per-transaction
                                              #       payPeriodFinalized (one
                                              #       isPayPeriodFinalized call per
                                              #       distinct period in the loaded
                                              #       page — cached in a Map).
lib/transactions/aggregate.ts                 # MOD — extend `TransactionDetail` with
                                              #       per-line `lineId: string` so the
                                              #       drawer's Change action has a
                                              #       stable id to send to the server.
lib/transactions/queries.ts                   # MOD — include `ticket_items.id` and
                                              #       `tickets.closed_at` in the
                                              #       page query so the drawer has
                                              #       both. (closed_at is already
                                              #       selected; verify and add lineId.)
lib/auth/audit.ts                             # MOD — add `"ticket.line_tech_reassigned"`
                                              #       to the `AuditAction` union.
styles/transactions.css                       # MOD — micro: a `.tp-d-tech-chip-change`
                                              #       trigger style (text-only, ghost,
                                              #       reuses existing button tokens) +
                                              #       a `.tp-d-tech-chip-lock` slot for
                                              #       the Lock icon. Both 1:1 with
                                              #       existing surrounding chrome.
```

**Structure Decision**: Single Next.js project — extends the existing `app/(studio)/transactions/` surface. The new Server Action lives next to the surface that triggers it (project convention — `app/(studio)/checkout/actions.ts`, `app/(studio)/payroll/actions.ts`, etc.). The per-line chip is extracted into its own small component so the three render modes (plain · privileged+open · finalized-lock) are explicit and individually testable; the parent drawer's diff stays tiny.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*No violations — table intentionally empty.*

---

# Phase 0 — Research

Resolved every decision the spec deferred to "the plan." Output: [research.md](./research.md).

# Phase 1 — Design & Contracts

Generated:
- [data-model.md](./data-model.md) — reuses existing entities; documents the read fields, the single mutated column, and the new audit-row shape.
- [contracts/server-actions.md](./contracts/server-actions.md) — `reassignPaidLineTech` input/output/errors and the no-op behavior.
- [quickstart.md](./quickstart.md) — manual smoke test, local commands, and the four-spec verification checklist.

Updated:
- `CLAUDE.md` — the "Active plan" pointer now references this plan.

## Constitution Check (post-design re-check)

Re-checked all five principles against the Phase 1 artifacts. Result: **PASS, no new violations introduced.**

- Principle I — the per-line chip component lives in `components/lacquer/transactions/` and references only existing tokens (verified by listing every CSS class added to `styles/transactions.css`: two classes, both `.tp-d-tech-chip-*`, both composed of existing `--space-*`, `--radius-*`, `--color-*` tokens).
- Principle II — the contract in `contracts/server-actions.md` makes the server's authority explicit (six distinct typed errors, one of which is the role gate). The UI control is documented as "an affordance, not authority."
- Principle III — the audit-row shape in `data-model.md` § "Audit log row written by this feature" enumerates every field per FR-011. The contract specifies "exactly one row on success; zero rows on any rejection or no-op."
- Principle IV — `quickstart.md` lists the unit + e2e specs as gates that must be green before merge.
- Principle V — no new dependencies, no new tables, no new paid services. The only schema interaction is the new audit-action vocabulary value (a string), which is not a schema change.
