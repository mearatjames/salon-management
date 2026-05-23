# Implementation Plan: Per-service discount in checkout

**Branch**: `049-per-service-discount` | **Date**: 2026-05-22 | **Spec**:
[spec.md](./spec.md)

## Summary

The checkout cart's existing discount today reduces the entire
transaction. This feature extends the same discount sheet so the operator
can choose between **"All services in this sale"** (today's default — no
behavior change for operators who never engage with the new control) and
**"Selected services"** (one or more service lines on the same cart).
The customer total reduces by the targeted amount only; the assigned
tech's commission base is unchanged (FR-018 — confirmed in the 2026-05-22
clarification).

The implementation is a one-column extension to `public.ticket_items`
(`discount_target_line_ids uuid[] null` — backward compatible: `null`
means today's "all services"), a new in-place `editDiscountLine` Server
Action (FR-017 — so the operator can change scope/shape/amount/note in
one round-trip), a scoped-first / all-services-second recompute order in
both `lib/pos/cart.ts::computeTotals` and the server's
`recomputeTicketTotals` (FR-009 matches Square's stacking semantics),
auto-removal of a scoped discount when its last target leaves the cart
(FR-010 / FR-016 — no operator confirmation, payment not blocked), and a
new chip-picker inside the existing DiscountSheet (no new screen — Spec
Assumption). The cart row distinguishes scope via a label suffix
(`Discount · Pedicure`, `Discount · 2 services` — FR-006); the printed
receipt and the past-transaction drawer enumerate every targeted service
by name (FR-007).

**What is NOT changing**: the Square SDK call surface (discounts are
POS-only in v1), tax (`tax_cents` literal 0 invariant), commission/
payroll math (FR-018), or RLS — `ticket_items` is service-role-write
only and stays that way. No new dependencies. No new routes.

Full design rationale in [research.md](./research.md); data layer in
[data-model.md](./data-model.md); action / RPC / UI contracts in
[contracts/](./contracts/); walkthrough + e2e map in
[quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x, Next.js 16 (App Router — RSC +
Server Actions).

**Primary Dependencies**: Next.js 16, `@supabase/supabase-js` +
`@supabase/ssr`, shadcn/ui + Tailwind, Lucide. **No new dependencies.**

**Storage**: Supabase Postgres. One new column on `public.ticket_items`
(`discount_target_line_ids uuid[]`) + two CHECK constraints + a body
replacement on `pos_create_ticket_from_draft` (migration
`0023_per_service_discount_scope.sql`).

**Testing**: Vitest (unit — cart math, action validation, audit payload
shape) and Playwright (e2e — US1/US2/US3 against a seeded local
Supabase). Specs touch only the checkout + transactions paths; the rest
of the suite is unaffected.

**Target Platform**: Web — Tang Nails studio surfaces (`/checkout`,
`/checkout/[ticketId]`, the printable receipt route, `/transactions`).
The kiosk route (`/walk-in`) is unaffected: walk-ins do not produce
discounts.

**Project Type**: Single Next.js web application.

**Performance Goals**: Operator completes a scoped-discount sale in
under 30 s start-to-finish (SC-001). Cart total updates within 200 ms
of a target service removal (SC-003). Both are met by the existing
in-process recompute — no new round-trips.

**Constraints**:

- **No schema drift** (Constitution § Development Workflow & Quality
  Gates) — the new migration lands with the PR; the
  `db-migrate-preview` workflow applies it before the Vercel preview
  exercises the new column.
- **Design system fidelity** (Constitution Principle I) — the new
  "Applies to" control reuses tokens, shadcn primitives, and the existing
  DiscountSheet shell. No new visual primitives; every value traces to
  `styles/tokens.css`.
- **Backward compatibility** — pre-existing discount rows
  (`discount_target_line_ids = null`) render exactly as today (Spec
  Assumption: "sales closed before the feature ships continue to render
  as transaction-wide discounts").
- **FR-018** (commission base unchanged) is a contract — payroll
  aggregation (`specs/047-payroll-page/`) is read-only of
  `ticket_items.unit_price_cents` on service rows, and this feature
  changes only the discount row's value, never a service row's. No code
  change there, only a regression test.

**Scale/Scope**: single salon, ≤ 20 service lines and ≤ 4 discount
lines per cart in practice. Migration is a column add + two CHECKs —
fast even on the production table size (small).

## Constitution Check

*GATE: evaluated against constitution v1.0.4. Re-checked after Phase 1
design — still passing.*

| Principle | Relevance | Compliance |
|-----------|-----------|------------|
| **I. Design System Fidelity** (NON-NEGOTIABLE) | DiscountSheet grows a chip-picker; cart row gains a scope-label suffix and an Edit affordance; receipt + transaction drawer gain a sub-line. | All new UI reuses existing tokens (`primary`, `border`, `muted-foreground`, `space-2/3`, `radius-sm`, `text-xs/sm`, `font-sans`, `tabular-nums`), shadcn primitives, and Lucide icons (`Pencil` 1.5px / 16px for the Edit affordance). No new visual primitives. No raw hex codes. The DiscountSheet's shell (`tx-sheet-*` classes) is unchanged. Side-by-side comparison against `design-system/preview/*.html` for the cart row + receipt is a phase-completion gate. **PASS** |
| **II. Server-Authoritative Architecture** | Privileged mutation (discount writes through Server Actions). | `addDiscountLine` / `editDiscountLine` / `removeDiscountLine` all run through the existing `requireStudioSession()` + service-role client path. The scope is re-validated server-side (target ids must resolve to service rows on the same ticket). The client's `computeTotals` mirror is for instant display only; the server's `recomputeTicketTotals` is the authority — `pos_take_cash` reads `tickets.total_cents` under row lock so a stale client view can never short-charge. **PASS** |
| **III. Auditability & Money Integrity** (NON-NEGOTIABLE) | New discount audit shape; potential rounding ambiguity. | Every write records device user + operator via `recordAudit`. The `discount.added` payload gains a `scope` key (line ids); the new `discount.edited` verb writes a `before` / `after` block; auto-removal emits `discount.removed` with `auto_removed: true, orphaned_targets`. Money invariants unchanged: `subtotalCents = max(0, serviceSubtotal + Σ all amounts)` (FR-015); a scoped flat discount caps at the targeted subtotal (FR-004) so the targeted contribution never goes negative; rounding for percent discounts uses the same `Math.round((pct × base) / 100)` rule as today; no payment row mutation. **PASS** |
| **IV. Test-First for Critical Paths** | Cart math, action validation, audit shape — all critical-path. | Unit tests written failing first for: scoped-percent + scoped-flat math, FR-009 stacking, over-discount cap on scope, auto-remove on last target, FR-011 (new line not auto-included). Action tests for the new `targetLineIds` validation surface (`scope_empty`, `scope_target_unknown`, `scope_off_ticket`). Playwright e2e covers US1, US2, US3 acceptance scenarios + the FR-017 in-place edit. **PASS** |
| **V. Scope Discipline & Cost Restraint** | — | No new dependencies, no new paid services, no new tables. One new column + two CHECKs + one new action + one new audit verb. Reuses the existing DiscountSheet shell, the existing recompute helper, and the existing audit pipeline. Does not touch deferred items (SMS, multi-tenant, gift-card issuance, tax math, native wrappers). **PASS** |

No violations. **Complexity Tracking** is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/049-per-service-discount/
├── plan.md                # This file
├── research.md            # Phase 0 — decisions D1..D8
├── data-model.md          # Phase 1 — migration, CHECKs, draft / RPC / read-model shapes
├── quickstart.md          # Phase 1 — manual walkthrough + e2e mapping
└── contracts/
    ├── server-actions.md  # addDiscountLine (extended), editDiscountLine (NEW),
    │                      # removeDiscountLine, recomputeTicketTotals,
    │                      # validateAndResolveDraft, pos_create_ticket_from_draft
    └── discount-sheet-ui.md  # DiscountSheet "Applies to" control, cart row label,
                              # receipt + transaction-drawer enumeration
```

### Source Code (repository root)

This is a single Next.js web application. The feature touches files in
the existing `app/(studio)/checkout/`, `components/lacquer/checkout/`,
`components/lacquer/transactions/`, `lib/pos/`, `lib/transactions/`,
`lib/auth/`, `supabase/migrations/`, and the matching test trees.

```text
# Touched: backend / Server Actions / cart math
app/(studio)/checkout/
├── actions.ts                            # extend addDiscountLine; add editDiscountLine; extend recomputeTicketTotals (auto-removal + scoped-first/all-services-second order)
├── _cart-draft.ts                        # extend DraftDiscountLine + ResolvedDiscountItem + validateAndResolveDraft
├── _errors.ts                            # add DiscountInvalidError reasons: scope_empty, scope_target_unknown, scope_off_ticket
└── checkout-screen.client.tsx            # cart row label + scope label; ephemeral auto-removal on service remove; Edit affordance; serializeDraft scope

lib/pos/cart.ts                           # widen CartItem with id + discountTargetIds; new partition + recompute order in computeTotals
lib/auth/audit.ts                         # add "discount.edited" verb
lib/transactions/aggregate.ts             # widen TransactionLineItem with targetNames; project from discount_target_line_ids
lib/transactions/queries.ts               # include discount_target_line_ids in the ticket_items select

# Touched: frontend / UI
components/lacquer/checkout/
├── discount-sheet.tsx                    # new "Applies to" control (radio + chip-picker), edit-mode prefill, inline empty-scope hint
└── receipt-view.tsx                      # render "Applies to:" sub-line under scoped discount items

components/lacquer/transactions/receipt-drawer.tsx
                                          # render "Applies to:" sub-line under scoped discount items (drawer)

# Touched: schema
supabase/migrations/0023_per_service_discount_scope.sql   # NEW — column + CHECKs + pos_create_ticket_from_draft body replacement

# Tests
tests/unit/checkout/
├── cart-totals.test.ts                   # extend — scoped math, stacking, cap, auto-remove math
├── add-discount-line-action.test.ts      # extend — scope validation, audit payload shape
└── edit-discount-line-action.test.ts     # NEW — full edit surface

tests/e2e/
├── checkout-discount-scoped.spec.ts      # NEW — US1, US2 cart/receipt, US3 adapt-as-cart-changes, FR-013, FR-017
├── checkout-discount.spec.ts             # regression — default scope unchanged
└── transactions-page.spec.ts             # extend — Applies to: sub-line in drawer

# Spec Kit artifacts (this feature)
specs/049-per-service-discount/           # spec / research / plan / data-model / quickstart / contracts
```

**Structure Decision**: single Next.js web application. The new code
fits cleanly into the established checkout layering — Server Actions in
`app/(studio)/checkout/actions.ts`, pure cart math in `lib/pos/cart.ts`,
read-model in `lib/transactions/aggregate.ts`, Lacquer-shell client UI
in `components/lacquer/checkout/` and `components/lacquer/transactions/`,
schema in `supabase/migrations/0023_*.sql`. No new top-level directory,
no new route, no new dependency. The migration extends `ticket_items`
backward-compatibly (`discount_target_line_ids = null` = today's
universe) so the preview deploy can run against pre-feature data
without a backfill.

## Complexity Tracking

*No constitution violations — section intentionally empty.*
