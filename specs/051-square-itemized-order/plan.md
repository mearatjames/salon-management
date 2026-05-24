# Implementation Plan: Itemized Square Terminal Checkout

**Branch**: `051-square-itemized-order` | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/051-square-itemized-order/spec.md`

## Summary

Replace the `amountMoney`-only payload `lib/square/terminal.ts → createCheckout` sends today with a two-step pattern: create a Square **Order** first (carrying line items per `ticket_items`, with discounts mapped per the [Q2 clarification](./spec.md#clarifications) — line-level when `discount_target_line_ids` is set, Order-level otherwise), then pass `orderId` to `terminal.checkouts.create`. Square then pulls the amount and itemization from the Order and renders them on the dashboard and the printed/emailed receipt (SC-001 / SC-002). The grand total, taxes, and tip continue to match Tang Nails to the cent (FR-004 / FR-005 / FR-011 / SC-003).

Scope is **single-tender card sales only** (Q1 clarification — FR-001). Split-tender card legs keep today's non-itemized `amountMoney`-only call. The deterministic `${ticketId}:${paymentId}` SHA-256 (32-char) idempotency key already used for terminal checkouts is reused on `orders.create` so retries collapse onto the same Order (FR-006); a fresh payment row produces a fresh Order (FR-007). On a permanent `terminal.checkouts.create` failure or pre-customer cancel, the action makes a best-effort `orders.update` to mark the orphan Order `CANCELED` (FR-008 / SC-008); a failed cancel call logs but never blocks the operator UI.

**Technical approach**: extend `lib/square/terminal.ts` with a new `createOrder()` helper plus a `cancelOrder()` helper, and change `createCheckout()` to accept an optional `orderId` so itemized and non-itemized paths share one wrapper. Add a small `lib/square/orders.ts` (or co-locate in `terminal.ts` — see Research R3) that maps `ticket_items` rows → Square `OrderLineItem` and `OrderLineItemDiscount` shapes. Wire `sendCardToTerminal` in `app/(studio)/checkout/actions.ts` to fetch the ticket's `ticket_items` rows, route to itemized vs non-itemized paths based on whether this is a single-tender attempt or a split-tender leg, and pass through to the SDK wrapper. Add an audit column `payments.square_order_id text` via `supabase/migrations/0024_square_order_id.sql` (FR-013). Tests: Vitest unit cases extend `tests/unit/square/terminal-checkout.test.ts` with line-item mapping (services + targeted discount + untargeted discount + multi-qty + zero-priced line + special characters); a new `tests/unit/square/order-cancel-orphan.test.ts` covers the orphan-cancel best-effort path; e2e `tests/e2e/checkout-card.spec.ts` (or its equivalent — see Research R4) is extended to assert the stubbed Square HTTP fixture receives an Order payload with the expected line items on the single-tender card path and continues to receive `amountMoney`-only on the split-tender card path.

No UI change. No new external dependencies. Constitution Principles II, III, IV are the relevant gates; the design-system principle (I) does not apply.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 24 (Next.js 16 App Router; Server Components + Server Actions; Vercel Functions on the Node.js runtime per `vercel:knowledge-update` defaults — no Edge functions).

**Primary Dependencies**: Next.js 16, React 19, `square@^44.0.1` (already pinned — `client.orders.create` / `client.orders.update` are available on `OrdersClient` in `node_modules/square/api/resources/orders/client/Client.d.ts`), `@supabase/supabase-js` via the existing typed wrappers in `lib/db/`, `zod` (already in repo) for Server Action input validation. No new runtime dependencies.

**Storage**: Supabase Postgres (hosted preview + prod). Migration `supabase/migrations/0024_square_order_id.sql` adds a single nullable column `payments.square_order_id text` alongside the existing `square_terminal_checkout_id` / `square_payment_id` columns introduced by `0008_square_terminal_payment.sql`. No new tables, no enum changes, no RLS-policy changes. Migration auto-applies via the two GitHub Actions per CLAUDE.md / Constitution § Schema drift forbidden.

**Testing**:
- **Vitest unit** — extend `tests/unit/square/terminal-checkout.test.ts` with cases for: (a) single-tender card sale → `orders.create` is called with line items matching `ticket_items`; (b) ticket with a targeted discount → that discount appears under `line_items[i].applied_discounts`; (c) ticket with an untargeted discount → discount appears under top-level `discounts`; (d) multi-quantity service line → one Order line item with `quantity = N`; (e) zero-priced service line is preserved on the Order; (f) special-character service name (`Owner's special`) round-trips unchanged; (g) split-tender card leg → `orders.create` is NOT called and `terminal.checkouts.create` receives `amountMoney` only. Plus a new `tests/unit/square/order-cancel-orphan.test.ts` that mocks `terminal.checkouts.create` to throw and asserts `orders.update({ orderId, order: { state: 'CANCELED' } })` is called; a second case asserts that when the cancel call itself throws, the original failure (and the cancel failure) are both logged but the action still throws the original error (operator never sees the cancel failure).
- **Playwright e2e** — extend `tests/e2e/checkout-card.spec.ts` (or the spec that currently covers the card path — confirmed in Research R4) with assertions against the existing Square HTTP stub: the request body to `connect.squareupsandbox.com/v2/orders` matches the expected line-item shape on the single-tender path; no Order request is made on the split-tender card-leg path. No new e2e file is created — the existing card spec already covers the full Send → Terminal → Webhook → Done flow.
- Stub Square at the HTTP layer (already done by `tests/e2e/_square-stub.ts`). No live Square calls in CI.

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest); Vercel Functions (Node.js runtime, default 300s timeout) for the existing Server Actions and webhook route — none change shape, only payload.

**Project Type**: Web application — single Next.js app. Files touched are confined to:

```text
lib/square/terminal.ts                              # extend
lib/square/orders.ts                                # NEW (or co-located helpers in terminal.ts — see R3)
app/(studio)/checkout/actions.ts                    # sendCardToTerminal: load ticket_items, branch single-vs-split
supabase/migrations/0024_square_order_id.sql        # NEW migration
tests/unit/square/terminal-checkout.test.ts         # extend
tests/unit/square/order-cancel-orphan.test.ts       # NEW unit spec
tests/e2e/checkout-card.spec.ts                     # extend (confirm filename in R4)
tests/e2e/_square-stub.ts                           # extend to intercept /v2/orders
```

**Performance Goals**: Itemized path adds one extra Square round-trip (`orders.create`) per single-tender card sale; Square Sandbox `POST /v2/orders` historically completes in ~80–200 ms. SC-005 budgets ≤500 ms of regression on the operator-visible "Send to terminal → waiting" path; the median should land closer to +120 ms. No regression on the cash, gift, or split-tender card paths (they don't go through the new branch). Cancel-orphan path: best-effort, fire-and-forget at the level of "don't await beyond ~1s before letting the operator retry" (await full call to log result; if it hangs past the existing Square SDK timeout, the SDK abort fires and we log a timeout).

**Constraints**:
- **Constitution Principle II (Server-Authoritative)** — `orders.create` and `orders.update` run inside `lib/square/` server-only modules; no client touches Square. The Server Action `sendCardToTerminal` continues to enforce all role checks before any Square call.
- **Constitution Principle III (Auditability & Money Integrity)** — every Square call still passes a deterministic idempotency key (`${ticketId}:${paymentId}` SHA-256 → 32-char hex for both `orders.create` and `terminal.checkouts.create`). The `payments` row stores both `square_terminal_checkout_id` and the new `square_order_id`, so the financial record is traceable from Tang Nails ticket to Square Order to Square Checkout to Square Payment. Money invariants are unchanged — `payments.amount_cents` continues to equal `tickets.total_cents` for a single-tender card sale, and the Order's grand total (verified by inspecting the SDK response) equals `amount_cents`. Audit `payload` JSON gains a `square_order_id` field on `payment.created` / `payment.succeeded` / `payment.failed` events (controlled-vocabulary `action` values unchanged).
- **Constitution Principle IV (Test-First for Critical Paths)** — `lib/square/terminal.ts` is a Square SDK wrapper for a critical money path. Vitest tests for line-item mapping, idempotency, and orphan-cancel are written and shown to fail before the implementation. The Playwright spec is updated in the same commit.
- **Constitution Principle V (Scope Discipline)** — feature scope is narrow (single SDK call shape change + one column + best-effort cancel), no new paid services, no scope creep into Catalog sync.
- **Tax discipline** — the Order request explicitly sets `taxes: []` and `pricing_options.auto_apply_taxes: false` (confirmed in Research R2) to defeat Square's location-default-tax inheritance, satisfying FR-005 and US3 AS2.
- **Split-tender invariant** — `sendCardToTerminal` checks for `existingDraftId` (the existing split-tender indicator) and routes that path to the non-itemized branch; the unit test (g) and the e2e split-tender card path both assert this.

**Scale/Scope**: Single salon, ~tens of card sales per day. No throughput concerns. Migration impact: one nullable column on a small table (`payments` has < 100k rows in prod; the migration is metadata-only and CI-applies in milliseconds).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | **N/A** | No UI change. The waiting screen, settings, and dashboard surfaces are untouched (FR-014). |
| **II. Server-Authoritative Architecture** | **PASS** | All Square calls (`orders.create`, `orders.update`, `terminal.checkouts.create`) live in `lib/square/*`. No client-side credentials. The `sendCardToTerminal` Server Action remains the only entry point. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | **PASS** | Deterministic idempotency key (`${ticketId}:${paymentId}` SHA-256 → 32-char) reused on `orders.create` so retries collapse. New `payments.square_order_id` column added in audit migration; Order id is included in audit `payload` JSON. Grand-total parity verified in unit test (h) and e2e on the single-tender path. No money is silently mutated. |
| **IV. Test-First for Critical Paths** | **PASS** | Vitest unit cases for mapping + idempotency + orphan cancel are listed in the test plan above and will be added in the test phase of the task list before the wrapper change lands. Playwright spec extended in the same PR. |
| **V. Scope Discipline & Cost Restraint** | **PASS** | No new paid services, no new dependencies, no scope creep into Catalog sync or Square Catalog object IDs (explicitly out of scope per spec). Migration is a single nullable column. |

**Initial gate: PASS.** No Complexity Tracking entries required.

(Post-Phase-1 re-check at the bottom of this file.)

## Project Structure

### Documentation (this feature)

```text
specs/051-square-itemized-order/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Already produced by /speckit-specify and /speckit-clarify
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── lib-square-orders.md      # createOrder() / cancelOrder() module contract
│   └── server-actions.md         # sendCardToTerminal payload extension contract
├── checklists/
│   └── requirements.md  # Already produced by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks command — NOT created by /speckit-plan)
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router monorepo; we follow that layout (per `docs/system-design.md` and `CLAUDE.md`). Only the paths below are touched.

```text
app/
└── (studio)/
    └── checkout/
        └── actions.ts                              # sendCardToTerminal — load ticket_items, branch single/split, pass to wrapper

lib/
└── square/
    ├── terminal.ts                                 # extend createCheckout() to accept optional orderId; export from same module
    └── orders.ts                                   # NEW — createOrder() + cancelOrder() + mapTicketItemsToOrderLineItems()
                                                    # (final co-location decided in Research R3)

supabase/
└── migrations/
    └── 0024_square_order_id.sql                    # NEW — adds payments.square_order_id text null

tests/
├── unit/
│   └── square/
│       ├── terminal-checkout.test.ts               # extend — line-item mapping cases (a)–(g)
│       └── order-cancel-orphan.test.ts             # NEW — orphan-cancel best-effort cases
└── e2e/
    ├── checkout-card.spec.ts                       # extend — single-tender Order assertion; split-tender no-Order assertion
    └── _square-stub.ts                             # extend — intercept POST /v2/orders + PUT /v2/orders/:id
```

**Structure Decision**: Single Next.js App Router monorepo (Option 2-ish "Web application" but the repo is one app, not a backend/frontend split). All Square SDK code is server-only under `lib/square/`. No new top-level directory required.

## Complexity Tracking

> No Constitution Check violations. Section intentionally empty.

---

## Post-Phase-1 Constitution Re-check

After producing `research.md`, `data-model.md`, `contracts/`, and `quickstart.md` below, re-evaluated against the same five principles:

| Principle | Status | Notes |
|---|---|---|
| I. Design System Fidelity | **N/A** (still no UI change) | — |
| II. Server-Authoritative | **PASS** | Phase-1 contracts confirm `createOrder()` / `cancelOrder()` live in `lib/square/` and are called only from `app/(studio)/checkout/actions.ts → sendCardToTerminal`. |
| III. Auditability & Money | **PASS** | `data-model.md` confirms `payments.square_order_id` and the audit-payload extension. Idempotency key is identical on `orders.create` and `terminal.checkouts.create` for the same `(ticketId, paymentId)` per the wrapper contract. |
| IV. Test-First | **PASS** | `quickstart.md` checklist begins with the failing-Vitest step before the wrapper edit. |
| V. Scope Discipline | **PASS** | Phase-1 artifacts do not introduce any column, table, action, route, or surface not enumerated in Phase 0/1. |

**Post-Phase-1 gate: PASS.** Ready for `/speckit-tasks`.
