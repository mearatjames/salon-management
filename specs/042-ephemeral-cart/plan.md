# Implementation Plan: Ephemeral Cart

**Branch**: `042-ephemeral-cart` | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/042-ephemeral-cart/spec.md`

## Summary

Convert the `/checkout` cart-building experience from a database-backed flow (which eagerly inserts an empty `tickets` row on page load) to an in-memory ephemeral cart that writes nothing to the database until the operator commits to a payment. At commit time, a single atomic Server Action creates the `tickets` row, all `ticket_items` rows, and the first `payments` row (or the initial split-tender draft state) in one transaction, then redirects to `/checkout/<new-id>` for the post-commit phase (Square Terminal waiting screen, mid-split-tender UI, or completed-sale receipt). The cart is consumed only after server-confirmed success; failed commits preserve the in-memory cart so the operator can retry without rebuilding. The Cancel and Discard controls on the cart-building phase are removed (no row to discard); Discard remains on the mid-split-tender screen where a real ticket exists.

## Technical Context

**Language/Version**: TypeScript 5 / Node.js (Next.js 16 App Router, RSC + Server Actions)

**Primary Dependencies**: Next.js 16, React 19, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), shadcn/ui + Tailwind + Lucide, Square SDK (server-side only), Zod for input validation

**Storage**: Postgres via Supabase. Existing tables — `tickets`, `ticket_items`, `payments`, `customers`, `audit_log` — all schemas unchanged for this feature. Existing RPCs reused: `pos_take_cash`, `pos_record_card_payment`, `pos_record_gift_payment`, `pos_compose_payment_draft`, `pos_activate_cash_draft`.

**Testing**: Vitest unit suite for cart-state pure functions (totals, discount math, cart-item normalization) and any new server-action helper; Playwright end-to-end suite for the four commit paths and the abandon-cart hygiene invariant; existing e2e specs updated for the route topology change.

**Target Platform**: Web — Next.js on Vercel (Fluid Compute). No new runtime requirements.

**Project Type**: Single web application (Next.js App Router monorepo style under `app/`, `components/`, `lib/`, `supabase/`).

**Performance Goals**: First commit must complete in < 500ms p95 for a typical 1–5 item cart on the local Supabase (same envelope as today's `addServiceLine` + payment flow, which currently sums to 3+ round trips). Cart-edit operations now run entirely in-memory in the browser, so should feel instant.

**Constraints**:
- Zero schema migrations (FR/Assumption requirement).
- Atomic ticket + items + payment creation in a single Postgres transaction at commit (Constitution Principle III).
- No localStorage / sessionStorage / IndexedDB / cookie persistence of cart state (FR-011).
- Cart state stays local to a single browser tab (Assumption).
- Square Terminal handoff failure rolls back DB rows by direct deletion in the same Server Action (Assumption); the in-memory cart is preserved (FR-013).
- All existing post-commit behavior (split-tender legs, Square webhook lifecycle, receipt) MUST remain unchanged (FR-009).
- Prerequisite bugfix issues #25/#26/#27 must be merged on `main` before this work begins (Spec Prerequisites + Assumption).

**Scale/Scope**: Single salon, ~5–15 concurrent operators across iPads and a back-office laptop. Typical cart size 1–10 items. ≤ 50 transactions per peak hour.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**I. Design System Fidelity (NON-NEGOTIABLE)** — PASS. No new visual surfaces are introduced. The cart-building page reuses every existing Lacquer component (`service-tiles.tsx`, `cart-row-with-tech.tsx`, `totals.tsx`, `payment-tiles.tsx`, `discount-sheet.tsx`, etc.). The only visible change is the removal of the Cancel/Discard buttons in `tx-header.tsx` when no `ticketId` is in scope. Tokens, spacing, and typography are unchanged.

**II. Server-Authoritative Architecture** — PASS. The cart is in-memory React state in the browser, but contains only display-side data: selected service IDs, selected discount IDs, customer ID, tech ID, and item-level metadata. No prices, totals, taxes, or authorization decisions are computed in a way that the client could weaponize — at commit time the Server Action re-resolves each `service_id` against the database catalog (snapshotted into `ticket_items`), re-applies discount rules, and computes the canonical totals. The client cart is a draft form, not the source of truth.

**III. Auditability & Money Integrity (NON-NEGOTIABLE)** — PASS. Atomic commit means the ticket row, all item rows, and the first payment row come into existence in a single transaction. Audit logging is unchanged in shape and content; the only difference is the absence of a `ticket.created` event for empty tickets that operators never committed (today's noise). Square idempotency keys (`${ticket_id}:${payment_id}`) are generated identically because both IDs come from the same transaction. The "one in-flight payment per ticket" unique index is preserved.

**IV. Test-First for Critical Paths** — PASS with required test work. The three new commit Server Actions (cash/gift, Square Terminal, split-tender init) are critical paths and MUST get failing-first unit tests for input validation + happy-path totals, plus end-to-end Playwright tests for the four commit paths. Existing e2e specs (cash sale, Square Terminal, gift card split tender) need updates for the route topology change. A new e2e covers the hygiene invariant: open `/checkout`, take 0 actions, walk away → no rows.

**V. Scope Discipline & Cost Restraint** — PASS with note. This refactor is not explicitly listed in `docs/system-design.md` "Files to create" build order because it post-dates v1's initial scaffolding. However it is strictly an improvement to existing in-scope behavior (checkout/POS), introduces no new tables/columns/RPCs/services, and is justified by a real operational pain point (accumulating empty `open` tickets, awkward Cancel/Discard UX). No paid services or new dependencies. Zero new infra cost.

**Gates result**: All five principles pass. No violations to track in Complexity Tracking. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/042-ephemeral-cart/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── server-actions.md  # Server Action contracts for the 4 commit paths
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
app/
└── (studio)/
    └── checkout/
        ├── page.tsx                          # CHANGED: becomes the cart-building page; no eager ticket create; renders <CartBuildingScreen />
        ├── checkout-screen.client.tsx        # NEW: the ephemeral-cart UI (extracted/refactored from [ticketId]/checkout-screen.client.tsx)
        ├── _cart.ts                          # NEW: pure helpers — cart shape, normalization, totals preview, hash for change detection
        ├── _cart-context.tsx                 # NEW: React Context + reducer for cart state (provider rendered by /checkout/page.tsx only)
        ├── _commit-from-cart.ts              # NEW: server-action helpers for the four commit paths (atomic ticket+items+payment create)
        ├── actions.ts                        # CHANGED: add submitCashFromCart, submitGiftFromCart, sendCardToTerminalFromCart, splitTenderFromCart; mark createEmptyTicket/resumeOrCreateTicket as deprecated callers-only-of-mid-split-tender; keep all post-commit actions intact
        ├── _drafts.ts                        # UNCHANGED
        ├── _errors.ts                        # UNCHANGED
        ├── checkout.css                      # UNCHANGED
        └── [ticketId]/
            ├── page.tsx                      # CHANGED: becomes a strict post-commit reader; refuses to render if status='open' has zero items (defensive)
            └── checkout-screen.client.tsx    # CHANGED: now only handles post-commit flows (mid-split-tender, Square Terminal waiting, completed-sale receipt). Cart-edit handlers removed from this file (they live in the new cart-building screen).

components/
└── lacquer/
    ├── new-transaction-cta.tsx               # CHANGED: href is /checkout (no ?fresh=1)
    ├── sidebar/nav-items.ts                  # CHANGED: Checkout link points to /checkout (was: same href but with eager-create semantics)
    └── checkout/
        ├── tx-header.tsx                     # CHANGED: hide Cancel + Discard when no ticketId in scope; keep them visible on the mid-split-tender screen
        ├── done-screen.tsx                   # CHANGED: "New sale" link points to /checkout (no eager-create)
        └── (all other checkout components)   # UNCHANGED — reused in both pre-commit and post-commit views

lib/
└── (existing helpers)                        # UNCHANGED

supabase/migrations/                          # NO NEW MIGRATIONS for this feature

tests/
├── e2e/
│   ├── checkout-ephemeral-cart.spec.ts       # NEW: covers all four commit paths + abandon-cart hygiene invariant + retry-on-failure
│   ├── checkout-cash-sale.spec.ts            # UPDATED: route topology change; no Cancel button
│   ├── checkout-square-terminal.spec.ts      # UPDATED: route topology change; rollback-on-handoff-failure asserts no residual rows
│   ├── checkout-gift-split-tender.spec.ts    # UPDATED: route topology change; assert ticket+items appear at split-init, not at page-load
│   └── _affected-map.mjs                     # UPDATED: new code paths (checkout/_commit-from-cart.ts, _cart.ts, _cart-context.tsx) mapped to spec coverage
└── unit/
    └── checkout/
        ├── cart.test.ts                      # NEW: unit tests for _cart.ts pure helpers (normalization, preview totals)
        └── commit-from-cart.test.ts          # NEW: unit tests for the input validation surface of the new server actions
```

**Structure Decision**: Single Next.js project (existing). All work happens under `app/(studio)/checkout/**`, `components/lacquer/checkout/**`, `components/lacquer/{new-transaction-cta,sidebar}`, and `tests/{unit,e2e}/**`. No new top-level directories. No new packages. No schema migrations.

## Complexity Tracking

No constitution violations. Complexity Tracking intentionally omitted per the template's instruction ("Fill ONLY if Constitution Check has violations that must be justified").
