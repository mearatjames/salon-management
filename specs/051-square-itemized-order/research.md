# Research: Itemized Square Terminal Checkout

**Feature**: `051-square-itemized-order`

**Date**: 2026-05-24

This document resolves every open technical question raised by `spec.md` (after `/speckit-clarify`) and `plan.md → Technical Context`. Each item is structured as Decision / Rationale / Alternatives considered, per the Spec Kit convention.

## R1 — Resolve `location_id` for `orders.create`

**Decision**: Lazy-resolve and persist. Add a nullable `square_oauth.location_id text` column. The first itemized checkout per salon calls `client.locations.get({ locationId: "main" })`, extracts the resulting `Location.id`, and writes it back to the `square_oauth` row. Every subsequent itemized checkout reads the value directly. Implementation lives in a new `getSquareLocationId()` helper in `lib/square/oauth.ts`.

**Rationale**:
- Square's `orders.create` requires a concrete `location_id` UUID; the literal string `"main"` is only accepted by `locations.get` as a convenience alias, not by Orders.
- We already store `merchant_id` and `merchant_name` on the `square_oauth` row at OAuth time (`lib/square/oauth.ts:280`), so the row is the right home for an additional connection-level identifier.
- Lazy resolution avoids touching the OAuth handler in this feature (Constitution Principle V — scope discipline) and works for the already-connected production salon without a backfill migration.
- The one-time `locations.get` call (~50–100 ms) lands on the very first itemized checkout for a fresh salon connection only. After that, the read is free.
- The salon is single-location (Constitution preamble: "single-salon"), so picking "main" is correct by definition.

**Alternatives considered**:
- *Store `location_id` in `square_oauth` at OAuth time*: cleanest long-term but requires changing the OAuth callback (`lib/square/oauth.ts:280`) and risks breaking the existing connection during a re-OAuth. Rejected to keep the scope of this feature narrow; lazy resolution self-heals on first use.
- *Always call `locations.get("main")` per checkout, no caching*: an extra ~80 ms on every single-tender card sale forever. Wasteful.
- *Read from environment / `vercel env`*: brittle and not multi-environment-safe; the preview Supabase project would need a manual env entry that the prod project doesn't.
- *Use `client.locations.list()` and pick the first row*: works but `locations.get("main")` is the documented convenience the Square SDK provides for exactly this case; preferred for clarity.

## R2 — Defeat Square's location-default tax inheritance

**Decision**: Every `orders.create` request sends:

```ts
{
  order: {
    locationId,
    referenceId: ticketId,
    lineItems: [...],
    discounts: [...],         // top-level Order discounts (or omitted)
    taxes: [],                // explicit empty
    pricingOptions: {
      autoApplyTaxes: false,
      autoApplyDiscounts: false,  // we apply ours explicitly; don't let Square inject any
    },
  },
  idempotencyKey,
}
```

**Rationale**:
- `OrderPricingOptions.autoApplyTaxes: boolean | null` exists on `node_modules/square/api/types/OrderPricingOptions.d.ts:16`, confirming the SDK passes it through. Setting `false` instructs Square's Order pricing engine not to inject the location's configured default taxes.
- An explicit empty `taxes: []` is belt-and-suspenders: even if some future SDK version changes the default of `autoApplyTaxes`, the empty array proves the Order has no tax lines.
- `autoApplyDiscounts: false` defends symmetrically against the Square Loyalty / Promotions feature auto-injecting discounts a salon admin set up in the Square dashboard. Tang Nails owns the discount story; Square must not surprise us.
- Satisfies FR-005 and US3 AS2.

**Alternatives considered**:
- *Set only `taxes: []` and rely on the SDK default*: the documented default for `autoApplyTaxes` is "respect the location config" — explicit `false` is required to be safe across Square API versions.
- *Disable the default tax at the Square location level in the dashboard*: requires the salon owner to perform a configuration step we can't enforce; relying on this would be a real silent-drift risk.

## R3 — Co-locate Order helpers vs new `lib/square/orders.ts` module

**Decision**: New file `lib/square/orders.ts`. It exports:

- `mapTicketItemsToOrderLineItems(ticketItems): { lineItems: SquareOrderLineItem[]; discounts: SquareOrderDiscount[] | undefined }` — pure function.
- `createOrder({ ticketId, paymentId, locationId, ticketItems }) → { orderId: string }` — wraps `client.orders.create` with the deterministic idempotency key.
- `cancelOrder(orderId): Promise<void>` — wraps `client.orders.update({ orderId, order: { state: 'CANCELED' } })`; rejects on Square error so the caller can decide to log-only.

`lib/square/terminal.ts → createCheckout` is extended to accept an optional `orderId` argument and, when supplied, send it via `checkout.orderId` instead of `checkout.amountMoney`. Both branches still pass `referenceId: ticketId`.

**Rationale**:
- `terminal.ts` is already 315 lines and conceptually about Terminal/Devices; adding Order mapping logic would muddy that boundary. Square's SDK splits the two surfaces (`client.orders.*` vs `client.terminal.checkouts.*`), and our module structure should mirror it.
- A pure `mapTicketItemsToOrderLineItems` is the single most-testable seam — Vitest covers all six mapping cases without touching the Square SDK at all.
- One file co-located by domain matches the existing pattern (`lib/square/oauth.ts`, `lib/square/webhooks.ts`, `lib/square/gift-cards.ts`).

**Alternatives considered**:
- *Inline helpers inside `terminal.ts`*: rejected — mixes two SDK surfaces in one module, and the unit tests get harder to mock.
- *A `lib/square/checkout.ts` wrapper that orchestrates Orders + Terminal*: rejected as premature. `sendCardToTerminal` already orchestrates; a second orchestrator adds an empty layer.

## R4 — Which e2e spec carries the card-path assertion

**Decision**: Extend `tests/e2e/card-payment-happy.spec.ts` for the single-tender Order-payload assertion (it already exercises the full Send → Terminal → Webhook → Done flow for a happy card sale). Extend `tests/e2e/card-payment-cancel.spec.ts` to assert the orphan-cancel best-effort behavior. The split-tender path is covered by `tests/e2e/split-tender-card-leg.spec.ts` (if it exists — verify in the task list; otherwise the split-tender assertion goes in `card-payment-happy.spec.ts` with a clearly scoped `test.describe("US-Split:")` block).

The Square HTTP stub (`tests/e2e/_square-stub.ts`) is extended to:
- Intercept `POST /v2/orders` and return a fixed `{ order: { id: "ord_test_<uuid>" } }`.
- Intercept `PUT /v2/orders/:id` (Square's update endpoint) and return `200`.
- Record the captured request bodies so specs can assert on them.

**Rationale**:
- Adding a *new* e2e spec file for itemization would re-spin the long Send-to-Terminal chain Playwright already runs in `card-payment-happy.spec.ts`. Reusing the existing spec keeps total suite runtime flat (per CLAUDE.md "Pre-push quality gates → final gate runs everything full" — fewer specs is better).
- The Square stub already centralizes HTTP intercepts; adding two endpoints to it is the smallest possible change.
- The orphan-cancel behavior is a failure-path concern that belongs with the existing cancel spec for thematic clustering.

**Alternatives considered**:
- *New `card-payment-itemized.spec.ts`*: rejected for the runtime reason above.
- *Unit tests only*: insufficient — the Server Action wiring (loading `ticket_items`, branching, passing through) lives in `actions.ts` which is best covered by the e2e harness that exercises the full request.

## R5 — Mapping `ticket_items` → Square `OrderLineItem` / `OrderLineItemDiscount`

**Decision**: One pure function with the following rules. Sign convention is normalized at the boundary: Tang Nails stores `unit_price_cents` as a negative integer on `kind='discount'` rows (per `app/(studio)/checkout/actions.ts:143` comment); Square expects discounts as positive `amountMoney`.

| Tang Nails `ticket_items` row | Square OrderLineItem / discount field |
|---|---|
| `kind = 'service'` | One `lineItem` entry: `name: name_snapshot`, `basePriceMoney: { amount: unit_price_cents, currency: 'USD' }`, `quantity: String(qty)`, `uid: id` (the ticket_item UUID — for `applied_discounts` cross-ref). |
| `kind = 'discount'`, `discount_target_line_ids IS NULL` | One top-level `Order.discounts` entry: `name: name_snapshot`, `amountMoney: { amount: abs(unit_price_cents), currency: 'USD' }`, `scope: 'ORDER'`, `uid: id`. |
| `kind = 'discount'`, `discount_target_line_ids = [a, b]` | One top-level `Order.discounts` entry with `scope: 'LINE_ITEM'`, `uid: id`, plus an entry in each targeted `lineItem.appliedDiscounts: [{ discountUid: id }]`. Square sums them automatically. |

Notes:
- `OrderLineItem.quantity` is a *string* in the Square SDK (`'1'`, `'2'`, …) — Squares documents this; the TypeScript type confirms.
- `OrderLineItem.uid` is a client-supplied identifier scoped to the Order; reusing the `ticket_item.id` UUID is unique within an Order and supports the `appliedDiscounts.discountUid` link.
- Discounts whose `amountMoney` would be zero (an active but $0 discount) are skipped — Square rejects zero-amount discount lines.

**Rationale**:
- This is the literal mapping the issue's "Proposal" block describes; making the conversion pure and testable means every edge case lands as a Vitest assertion.
- Tang Nails' internal data already carries the targeting info (`discount_target_line_ids` from feature 049). The function does not need to recompute discount allocation; it just translates the existing structure.

**Alternatives considered**:
- *Always send discounts as line-level (one applied_discount per service)*: rejected — for untargeted discounts this is technically correct but loses the "applies to whole sale" semantic on the dashboard. Spec Q2-A locks in the hybrid rule.
- *Always send discounts as negative line items*: rejected by FR-003 explicitly.

## R6 — Idempotency key strategy for `orders.create`

**Decision**: Reuse the *exact same* SHA-256 32-char hex key (`buildIdempotencyKey(ticketId, paymentId)` from `lib/square/terminal.ts:47`) on both `orders.create` and `terminal.checkouts.create`. Both calls happen inside the same `sendCardToTerminal` invocation, against the same `(ticketId, paymentId)`, so the same key is correct for both.

**Rationale**:
- Square idempotency is namespaced per endpoint inside Square's infrastructure, so the same key on `/v2/orders` and `/v2/terminals/checkouts` does not collide — it dedupes within each endpoint independently.
- Reusing the key means a retried `sendCardToTerminal` (same `paymentId`) collapses to the same Order and the same Checkout, exactly as FR-006 requires.
- A fresh `paymentId` (per FR-007) yields a fresh key for both endpoints — fresh Order, fresh Checkout.

**Alternatives considered**:
- *Different key per endpoint (e.g., append `:order` and `:checkout` suffixes)*: rejected — pointless complexity; the namespacing is already at the Square endpoint level.
- *Random UUID per call*: rejected — defeats the entire retry-collapse contract Constitution Principle III enforces.

## R7 — Orphan Order cancel mechanics (`orders.update` vs an Orders-specific cancel)

**Decision**: Use `client.orders.update({ orderId, order: { locationId, version, state: 'CANCELED' } })`. Best-effort: any thrown error is caught, logged at `console.warn` with both the original error and the cancel error, and never propagated to the operator UI. The original `SquareCheckoutCreateFailedError` is still thrown.

The `version` field is required by `orders.update` to do optimistic concurrency. We capture it from the `orders.create` response (`response.order?.version`) and store it in a function-scoped variable; it is passed to `update` only on the failure branch.

**Rationale**:
- The Orders SDK does not expose a discrete `cancel(orderId)` method; the documented cancel path is `update` with `state: 'CANCELED'` (confirmed in `node_modules/square/api/resources/orders/client/Client.d.ts:251`).
- `version` is created at the time of `orders.create` and is `1` for a fresh Order with no later updates — passing it makes the call deterministic and defends against accidentally clobbering a concurrently-updated Order.
- Best-effort means the failure path never blocks the operator; SC-008 measures "either canceled or logged" — both branches satisfy it.

**Alternatives considered**:
- *No cancel attempt; let orphans accumulate*: rejected by Q3 clarification (Option A wins).
- *Strict cancel that retries until success and surfaces failures*: rejected by Q3 clarification (Option B is too heavy for the failure rate).
- *Cancel from a separate cron sweep*: rejected — adds infrastructure for a rare edge case (Constitution Principle V).

## R8 — Schema migration scope

**Decision**: One migration file, `supabase/migrations/0024_square_order_id.sql`, with two `alter table` statements:

```sql
alter table public.payments
  add column if not exists square_order_id text null;

alter table public.square_oauth
  add column if not exists location_id text null;
```

Both columns are nullable; no default; no backfill; no constraint. Migration size: trivial; CI-apply time: < 100 ms; rollback: drop two columns (no data loss because the columns are new).

**Rationale**:
- One file keeps the change atomic on both preview and prod under the existing `db-migrate-{preview,prod}.yml` GitHub Actions (per Constitution § Schema drift forbidden).
- Both columns are needed by this feature; bundling them avoids two PRs / two CI runs.
- Nullable columns mean existing payment rows are unaffected and the migration can land *before* the code that writes them (preview always migrates before Vercel preview deploy exercises the code).

**Alternatives considered**:
- *Two separate migrations*: rejected — adds CI cycles for no benefit.
- *Make `payments.square_order_id` non-nullable with a CHECK*: rejected — would break every existing payment row, and the split-tender card-leg path legitimately writes NULL (no Order created).

---

## Summary of NEEDS CLARIFICATION resolved

| Source | Question | Resolution |
|---|---|---|
| Plan TC Storage | `location_id` source | R1 — lazy-resolve + persist in `square_oauth.location_id` |
| Plan TC Tax discipline | Defeat Square location-default tax | R2 — `taxes: []` + `pricingOptions.autoApplyTaxes: false` + `autoApplyDiscounts: false` |
| Plan TC Project Structure | Helper module co-location | R3 — new `lib/square/orders.ts` |
| Plan TC Testing | Which e2e spec | R4 — extend `card-payment-happy.spec.ts` + `card-payment-cancel.spec.ts` + the Square stub |
| Spec FR-003 / R5 | `ticket_items` → SDK mapping | R5 — three-row mapping table; preserve `uid` for `applied_discounts` linkage |
| Spec FR-006 / FR-007 | Idempotency key strategy | R6 — reuse the same `(ticketId, paymentId)` SHA-256 key for both `orders.create` and `terminal.checkouts.create` |
| Spec FR-008 / SC-008 | Orphan-cancel mechanics | R7 — `orders.update` with `state: 'CANCELED'`, best-effort, log-only on failure |
| Plan TC Storage | Migration scope | R8 — one migration `0024_square_order_id.sql` with two `alter table` statements |

No outstanding NEEDS CLARIFICATION items.
