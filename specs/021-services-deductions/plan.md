# Implementation Plan: Per-service deductions + two-pane services layout

**Branch**: `021-services-deductions` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-services-deductions/spec.md`

## Summary

Extend the **008 Services catalog** with two layered changes: (a) refactor `/services` from a drawer-overlay to an **always-visible two-pane layout** (left list ~440px, right edit panel), and (b) add **per-service deductions** to every service — a tri-state card-fee mode (`default` / `custom` / `exempt`) plus an optional flat supply deduction (cents + free-text label). The reference is `design-system/ServicesV1.jsx` (V1 · Refined two-pane); the V2 fork is **not** what we are building.

Neither value is consumed by checkout in this phase (capture and display only — the checkout / payout wiring is reserved for Phase 3). The hardcoded `$3` card-fee default lives in a single named constant (`lib/services/card-fee-default.ts`); Phase 2 replaces that constant with a value read from a policy entity without touching any service row. The supply-on cap is `$50` (5000 cents) and the supply label is bounded to 64 chars — both enforced in app validation AND a `services_*_chk` CHECK constraint added by migration `0016_services_deductions.sql`.

Technical approach: one new SQL migration adds four columns (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`) with two cross-column CHECKs and a column-level CHECK on `card_fee_mode`. The existing `addService` + `updateService` Server Actions are extended to parse, validate, persist, and audit the four new fields — adding four `validate*` helpers to `_validation.ts` plus an extension of the `SERVICE_DIFF_KEYS` list (so the audit diff naturally picks up the new columns). The existing `drawer.client.tsx` modal is **replaced** by a new `edit-panel.client.tsx` always-visible inspector; the existing `discard-changes-dialog.client.tsx` continues to gate selection switches. The catalog row gains a `<DeductionChips>` slot in the same horizontal band as duration/price. A new `<DeductionsSection>` client sub-component owns the Segmented control, the Supply toggle/inputs, and the live `Net to tech (card)` preview — recomputed locally per keystroke, no server round-trip.

Mirrors the proven 008 prelude (`requireStudioSession` → `assertCanWriteCatalog` → `validate*` → service-role mutation → `recordAudit` → `revalidatePath` + redirect with `?toast=` / `?error=`) so the only new surface area is the column set, the panel shell, and the deductions sub-component. The four pure helpers added to `_validation.ts` get Vitest coverage following the test-first discipline already established for 008's validators. A single Playwright spec (`tests/e2e/services-deductions.spec.ts`) exercises US1–US5 end-to-end against the seeded local Supabase.

Per Clarifications: (Q1) the panel header omits an X (Close) affordance — the panel is always visible and is "deselected" only by clicking a different list row or "Add service"; (Q2) both `card_fee_custom_cents` and `supply_amount_cents` are capped at `$50` (5000 cents) via app validation AND DB CHECK constraints, with neither cap leaking onto `price_cents` or the variable-price bounds.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 (App Router + RSC + Server Actions). Existing target — no version change.

**Primary Dependencies**: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `lucide-react`, `clsx`, `sonner` (toasts), shadcn/ui primitives in `components/ui/*`, Lacquer tokens in `styles/tokens.css`. **No new runtime dependencies.**

**Storage**: Supabase Postgres. One new migration (`supabase/migrations/0016_services_deductions.sql`) adds four columns + three CHECK constraints to the existing `public.services` table. **No new tables**, no new RLS roles, no `audit_log` schema change. (The existing `service.updated` audit verb continues to cover deduction edits via the diff payload extension.)

**Testing**: Vitest for the four new pure validators (`validateCardFeeMode`, `validateCardFeeCustomDollars`, `validateSupplyAmountDollars`, `validateSupplyLabel`) and the new `effectiveCardFeeCents` + `computeNetToTechCents` derivations used by both the panel preview and the audit's after-snapshot. Playwright `services-deductions.spec.ts` exercises the five user stories end-to-end against a seeded local Supabase: the two-pane layout (US1), card-fee mode round-trip including all three values (US2), supply on/off round-trip (US3), the live Net preview recomputing on draft change (US4), and the read-only state for a non-privileged operator (US5).

**Target Platform**: Vercel (Next.js 16 Fluid Compute by default); browsers used by Tang Nails staff — modern Chrome/Safari on macOS, iPadOS, Windows laptops. Studio tablets (1024×720 primary) are the responsive floor; the two-pane shell collapses to stacked panes on narrower viewports without changing the underlying state machine (per FR-001).

**Project Type**: Web application (single Next.js project at repo root — `app/`, `components/`, `lib/`, `styles/`, `tests/`, `supabase/migrations/`).

**Performance Goals**:
- **Net-to-tech preview**: SC-004 — recompute within **100ms** of any draft keystroke. Local React state only; no server round-trip. The math is `max(0, price − card_fee − supply)` with at most one branch per term.
- **Catalog list paint**: unchanged from 008 (~250ms p95 cold against seeded local Supabase). The new chip render adds two `<span>` per row at most — negligible.
- **Save**: Server Action round-trip stays within the existing 008 budget (single `UPDATE` on `services` + `recordAudit` insert; no new queries).

**Constraints**:
- Every visual value resolves to a Lacquer token (Constitution I). No raw hex, no off-scale spacing, no font weight outside 400/500/600, no emoji in chrome.
- All writes flow through Server Actions; the kiosk JWT remains denied on `services` (Constitution II).
- Every successful deduction mutation writes an `audit_log` row with the changed fields in the `changes` map of the existing `service.updated` payload (Constitution III).
- Authorization is unchanged from 008: only `owner` or `manager` may mutate any service field, including the four new columns. Non-privileged operators see disabled controls with the existing "Only owners and managers can edit the catalog." tooltip (FR-029).
- Migration applied via the existing GitHub Actions (`db-migrate-preview.yml` on PR; `db-migrate-prod.yml` on push to `main`). **No manual `supabase db push`** (Constitution v1.0.3 "Schema drift forbidden").
- Card-fee default lives in a single named constant (`lib/services/card-fee-default.ts`) — one place to change for Phase 2.
- No new currency precision: amounts are integer cents end-to-end, same as `price_cents`.
- The four new columns are part of the same single `UPDATE` / `INSERT` the existing Server Action issues — no separate transaction, no separate audit row.
- Animation budget unchanged from 008: 150ms hover/press, 200ms popovers, 300ms sheets/dialogs.

**Scale/Scope**: Single salon. Expected catalog size ≤100 services across ≤20 categories. ≤10 concurrent operator devices. Scope of this feature:
- 1 new migration (4 columns + 3 CHECKs).
- 1 new constant file (`lib/services/card-fee-default.ts`).
- 4 new validators in `_validation.ts`; ~2 new derivations in a new `_deductions.ts`.
- 2 modified Server Actions (`addService`, `updateService`) — additive field set, no structural changes.
- 1 modified type file (`_types.ts`) — extend `CatalogService` + `ServiceDraftBaseline` with the four new fields and the `effectiveCardFeeCents` helper's input shape.
- 1 modified page (`app/(studio)/services/page.tsx`) — replace `<Drawer>` mount with `<EditPanel>`, drop the `?adding`/`?selected` drawer-mode resolver in favor of a single panel-mode resolver.
- 4 modified / new client islands in `components/lacquer/services/`:
  - `edit-panel.client.tsx` — NEW; replaces `drawer.client.tsx`.
  - `deductions-section.client.tsx` — NEW; rendered inside `edit-panel`.
  - `deduction-chips.tsx` — NEW; rendered inside `catalog-row.tsx`.
  - `catalog-row.tsx` — EDIT; render `<DeductionChips>` in the duration/price band.
- 1 removed file (`drawer.client.tsx`) — kept as an `archive/` reference for one PR cycle, then deleted on follow-up (called out as a Phase X cleanup task).
- 6–8 new Vitest specs (validators, derivations) and 1 Playwright spec.
- 1 CSS append (`styles/settings.css`) for the new `.services-two-pane`, `.services-edit-panel`, `.deductions-section`, `.deduction-chip`, `.deduction-chip--card`, `.deduction-chip--supply`, `.deduction-chip--exempt` selectors — every value resolves to a token.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ Pass | Every visual value resolves to a token in `styles/tokens.css`. The two-pane shell adapts `design-system/ServicesV1.jsx` (V1 · Refined two-pane); the chip palette uses `--info` (blue) for card-fee, `--amber-500` (amber) for supply, and `--secondary` / `--muted-foreground` for the muted "No fees" exempt chip — all already declared in `tokens.css`. The Segmented control composes the shadcn `RadioGroup` primitive into a project-specific `<Segmented>` matching the prototype's selected-pill shadow (`var(--shadow-xs)`) and border-on-hover rules. The Supply switch reuses the same shadcn `Switch` the staff feature shipped. Icons stay Lucide (`CreditCard`, `Package`, `Info`) sized 14/16, 1.5px stroke. Acceptance includes a side-by-side compare against the V1 prototype as the last step before final gate. The `archive-dialog.client.tsx` and `discard-changes-dialog.client.tsx` from 008 are reused unchanged. |
| **II. Server-Authoritative Architecture** | ✅ Pass | All reads on the page continue via `createSupabaseServerClient()` from the existing Server Component. Mutations remain the four 008 Server Actions (`addService`, `updateService`, `archiveService`, `restoreService`) — `archiveService` and `restoreService` are untouched; `addService` and `updateService` gain four FormData fields and four validator calls each in the existing prelude. Each action's role gate stays `assertCanWriteCatalog(viewer.staff.role)` (owner OR manager). Client islands hold form state only; they never write to the DB. The kiosk JWT has no policy on `services` (unchanged from 008). The new derived helpers (`effectiveCardFeeCents`, `computeNetToTechCents`) are pure functions consumed by both the panel preview AND the server-side audit-payload builder — single source of truth for the math. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ Pass — partial scope | This feature does not move money — the four new columns are catalog-only this phase (snapshotting onto `appointment_services` / `ticket_items` is reserved for Phase 3, per spec Assumptions). The audit obligation is met by extending the existing `service.updated` payload: `SERVICE_DIFF_KEYS` grows by 4 entries (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`), the `before` and `after` snapshots gain the four fields, and the `changes` map naturally picks them up — no new verb, no new payload shape. `service.added` extends the same way: the four columns join the echoed-fields list. Deductions appear in the diff payload only when they actually changed in this save (FR-030). Per Constitution III "money never silently mutated", deduction edits are tracked at the row level with full before/after values — no hidden flips. |
| **IV. Test-First for Critical Paths** | ✅ Pass — partial scope | Per Principle IV, TDD-with-failing-tests is mandatory for money/auth/refund/cash-drawer/tip-allocation/audit logic. This feature does not change any of those — deductions are catalog metadata in this phase, not a payment calculation. Still ships: (1) Vitest unit tests for the four new validators (`validateCardFeeMode`, `validateCardFeeCustomDollars`, `validateSupplyAmountDollars`, `validateSupplyLabel`), the two derivations (`effectiveCardFeeCents`, `computeNetToTechCents`), and the `buildChanges` extension covering the four new diff keys; (2) one Playwright spec covering US1–US5 end-to-end; (3) the existing `recordAudit('service.updated')` test from 008 picks up the new payload shape via the diff-keys constant — no new audit-vocabulary widening required. All tests run in CI on every PR. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Scope matches the spec exactly. Five explicit out-of-scope items from the spec stay deferred: (1) global card-fee policy entity + policy strip + Edit Policy sheet — Phase 2; (2) wiring deductions into checkout / receipts / EOD cash / payouts — Phase 3 (with the snapshot-column migration noted in spec Assumptions); (3) pedi-tier deductions from the Day Report prototype; (4) the V2 payout-first table (`ServicesV2.jsx`); (5) per-tech staff assignments — remain deferred per 008's 2026-05-16 amendment. The `$50` cap is a defensive sanity bound per Clarifications Q2 — it does NOT extend to `price_cents` (which retains the existing unbounded 008 validation). No new infrastructure, no new paid services, no new dependencies — only four new columns on an existing table, comfortably inside the Supabase free tier. |

**Gate result: PASS — proceed to Phase 0.** No violations to justify; Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/021-services-deductions/
├── plan.md                              # This file
├── spec.md                              # Already written (/speckit-specify + /speckit-clarify)
├── research.md                          # Phase 0 — decisions + rationale
├── data-model.md                        # Phase 1 — schema delta, types, validators, transitions
├── quickstart.md                        # Phase 1 — how to run, verify, and visually compare
└── contracts/
    ├── README.md                        # Index across the four contracts
    ├── db-migration.contract.md         # 0016 column shape, CHECKs, backfill, RLS posture
    ├── server-actions.contract.md       # addService / updateService extensions, FormData keys, error codes
    ├── audit-payload.contract.md        # Diff-key extension + before/after snapshot extension
    └── ui.contract.md                   # Two-pane state machine, chip vocab, segmented control behavior
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router project at the root. This feature adds and edits the following:

```text
supabase/
└── migrations/
    └── 0016_services_deductions.sql               # NEW — add 4 columns + 3 CHECK constraints to public.services

lib/
└── services/
    └── card-fee-default.ts                        # NEW — single source of truth for the hardcoded $3 default

app/
└── (studio)/
    └── services/
        ├── page.tsx                               # EDIT — drop the drawer-mode resolver; add the panel-mode resolver
        ├── actions.ts                             # EDIT — extend addService + updateService with 4 new fields; extend audit payload
        ├── _load.ts                               # EDIT — extend ServiceDraftBaseline build to include the 4 new fields
        ├── _types.ts                              # EDIT — extend CatalogService + ServiceDraftBaseline with 4 new fields
        ├── _validation.ts                         # EDIT — add 4 validators + 1 ValidationErrorCode value per cap
        ├── _deductions.ts                         # NEW — pure helpers: effectiveCardFeeCents, computeNetToTechCents
        ├── _format.ts                             # EDIT — add formatCardFeeChipText, formatSupplyChipText (token-rendering helpers)
        ├── _filter.ts                             # KEEP — unchanged
        ├── _sort.ts                               # KEEP — unchanged
        ├── _diff.ts                               # KEEP — unchanged (staff-assignment diff; deductions ride the column-diff path)
        ├── permissions.ts                         # KEEP — unchanged (assertCanWriteCatalog covers all field writes including deductions)
        └── toasts.ts                              # KEEP — unchanged (no new toast verbs; reuses changes_saved)

components/
└── lacquer/
    └── services/
        ├── catalog-list.client.tsx                # KEEP — list shell unchanged; props pass through to the row
        ├── catalog-row.tsx                        # EDIT — render <DeductionChips> in the duration/price band
        ├── deduction-chips.tsx                    # NEW — server component rendering 0–2 chips per row (card-fee + supply, or muted "No fees")
        ├── edit-panel.client.tsx                  # NEW — always-visible right-pane state machine (replaces drawer.client.tsx)
        ├── service-form.client.tsx                # EDIT — accept deductions draft state via prop; render <DeductionsSection>
        ├── deductions-section.client.tsx          # NEW — Card-fee Segmented control + Supply toggle/inputs + Net-to-tech preview
        ├── archive-dialog.client.tsx              # KEEP — unchanged (still gated by the panel footer's "Archive service" action)
        ├── discard-changes-dialog.client.tsx     # KEEP — unchanged (panel-level discard gate)
        ├── empty-state.tsx                        # KEEP — unchanged (left-pane empty state)
        ├── page-header.tsx                        # KEEP — unchanged
        ├── services-toaster.client.tsx           # KEEP — unchanged (URL-toast bridge)
        ├── staff-assignment-list.client.tsx     # KEEP — dormant per 008's 2026-05-16 amendment; not imported by 021
        ├── _role-label.ts                         # KEEP — unchanged
        └── drawer.client.tsx                      # DELETE — replaced by edit-panel.client.tsx (no callers after page.tsx edit)

styles/
└── settings.css                                   # EDIT — append .services-two-pane, .services-edit-panel, .deductions-section, .deduction-chip{,-card,-supply,-exempt}, .segmented* rules. Every value resolves to a token.

tests/
├── unit/
│   └── services/
│       ├── validation.test.ts                     # EDIT — add cases for the 4 new validators
│       ├── deductions.test.ts                     # NEW — effectiveCardFeeCents + computeNetToTechCents + zero/exempt edge cases
│       └── audit-diff-keys.test.ts                # NEW — the extended SERVICE_DIFF_KEYS picks up deduction columns in buildChanges
└── e2e/
    └── services-deductions.spec.ts                # NEW — US1 (two-pane), US2 (card-fee modes), US3 (supply), US4 (Net preview), US5 (read-only)

CLAUDE.md                                          # EDIT (auto by Phase 1 step 3) — update SPECKIT block to point at this plan
```

**Structure Decision**: Single Next.js project (Option 1 — DEFAULT for this repo, established in 001 and reused by every feature since 006). This feature **extends** the 008 file tree rather than introducing new conventions — same `_validation.ts` / `_types.ts` / `_deductions.ts` ("`_<concept>.ts`" private-helper pattern), same Server-Action prelude, same URL-toast bridge, same `components/lacquer/services/*` namespace. The drawer-to-panel transition deliberately swaps a single client island file (`drawer.client.tsx` → `edit-panel.client.tsx`) so the diff is reviewable: the panel mounts in-grid instead of overlay-fixed, the discard guard fires on row-switch instead of on close-gesture, and the Save / Archive footer keeps its shape. The new `<DeductionsSection>` is its own client island (composed inside `<ServiceForm>`) so the Net-to-tech preview's keystroke responsiveness stays scoped to a small subtree — no full-panel re-render per character.

## Complexity Tracking

No constitution violations to justify. Table intentionally omitted.
