# Contract: Server Action extensions

**Feature**: `051-square-itemized-order`

**File**: `app/(studio)/checkout/actions.ts`

Only one existing Server Action gains new behavior: `sendCardToTerminal`. Its signature does not change; the change is internal — itemized branch vs current behaviour.

## `sendCardToTerminal` — extended behavior contract

**File**: `app/(studio)/checkout/actions.ts` (around line 1755 in the current main).

**Public signature (UNCHANGED)**:

```ts
sendCardToTerminal({
  target: { kind: 'ticket' | 'proposal'; … },
  deviceId?: string,
  existingDraftId?: string,    // present iff this is a split-tender card leg
}): Promise<{
  ticketId: string;
  paymentId: string;
  squareTerminalCheckoutId: string;
}>;
```

**Required behavior delta**:

1. **Branch detection**. After the existing checks resolve `paymentId` and `paymentAmountCents` (existing lines ~1840–1900):
   - If `existingDraftId` is set OR `paymentAmountCents < ticket.total_cents` (defensive — covers any future caller that doesn't pass `existingDraftId` for a partial leg), the call is **split-tender**. Continue with today's path: call `squareCreateCheckout` with `amountMoney` only, no Order. The `payments.square_order_id` column stays NULL.
   - Otherwise the call is **single-tender** (the card covers the full ticket total). Take the itemized branch.

2. **Single-tender itemized branch**:
   - Read the ticket items: `select id, kind, name_snapshot, unit_price_cents, qty, discount_target_line_ids from ticket_items where ticket_id = :ticketId order by created_at`. (The action already does a similar select earlier for the unpriced-line check; reuse or extend.)
   - Resolve `locationId = await getSquareLocationId()` from `lib/square/oauth.ts` (new helper per Research R1).
   - Call `createOrder({ ticketId, paymentId, locationId, ticketItems })` from `lib/square/orders.ts`. On success, persist `payments.square_order_id = orderId` BEFORE attempting the terminal-create:

     ```ts
     await supabase.from('payments').update({ square_order_id: orderId }).eq('id', paymentId);
     ```

     Storing the Order id first means a subsequent terminal-create failure still leaves a discoverable trace for support, regardless of whether the orphan-cancel succeeds.
   - Call `squareCreateCheckout({ ticketId, paymentId, deviceId, referenceId: ticketId, orderId, /* amountCents omitted */ })`. The wrapper sends `checkout.orderId` instead of `checkout.amountMoney`.

3. **Failure handling (single-tender itemized branch)**:
   - On `createOrder` failure: existing failure block applies as today — mark `payments.failed`, record audit, throw `SquareCheckoutCreateFailedError`. No orphan to cancel (Square didn't create one).
   - On `squareCreateCheckout` failure AFTER a successful `createOrder`:
     1. Best-effort `cancelOrder({ orderId, orderVersion, locationId })`. Wrap in `try/catch` and log via `console.warn` on failure (per `lib-square-orders.md` caller pattern).
     2. Continue with the existing failure block (mark `payments.failed`, record audit, throw).
     3. The `payments.square_order_id` column stays set so support can find the orphan in Square logs.

4. **Success handling (single-tender itemized branch)**:
   - `squareCreateCheckout` returns `squareTerminalCheckoutId`. Persist on the payment row (existing line ~1925); the action returns the same shape as today. No additional audit fields beyond the `square_order_id` already added in step 2.

5. **Audit-log extension** (for both itemized success and failure):
   - The existing `payment.created` audit call gains `square_order_id` in its `payload` JSON whenever the Order was created. Controlled-vocabulary `action` value is unchanged.
   - The existing `payment.failed` audit call (when raised inside this action) gains `square_order_id` in `payload` when applicable.

## Error types — UNCHANGED public surface

- `TicketNotOpenError`, `TicketHasUnpricedItemsError`, `TicketEmptyError`, `SquareNotConnectedError`, `SquareReconnectRequiredError`, `TerminalDeviceRequiredError`, `TicketAlreadyBeingChargedError`, `DraftLegNotFoundError`, `SquareCheckoutCreateFailedError` — all behave exactly as today. The new failure types (`EmptyOrderError` from the mapping helper) MUST be translated by `sendCardToTerminal` into `SquareCheckoutCreateFailedError` so the operator UI's error vocabulary stays stable.

## Idempotency contract — UNCHANGED public surface

- Per FR-006 / Research R6: the deterministic `buildIdempotencyKey(ticketId, paymentId)` produces the same SHA-256 32-char hex key, and this key is now passed to BOTH `orders.create` and `terminal.checkouts.create`. A retried `sendCardToTerminal` (same `paymentId`) collapses both calls to the same Order and same Checkout.
- Per FR-007: a fresh card attempt on the same ticket inserts a fresh `payments` row → fresh `paymentId` → fresh idempotency key → fresh Order, fresh Checkout.

## Non-functional contract

- Latency budget: single-tender itemized branch must complete within today's path latency + 300 ms (`orders.create` typical ~80–200 ms + the `payments` `update` write ~20 ms). SC-005 budgets ≤ 500 ms regression.
- Cancel-orphan best-effort: the `cancelOrder` call MUST NOT prolong the operator-visible error by more than the existing Square SDK call timeout. (The SDK's default `connect.squareupsandbox.com` timeout is well under 10 s; the call is awaited but bounded.)

## Test contract — what unit and e2e tests will assert

**Vitest unit (`tests/unit/square/terminal-checkout.test.ts` extensions)**:
- (a) Single-tender card → `client.orders.create` is called once with `lineItems` matching `ticket_items` (services only).
- (b) Single-tender with targeted discount → `discounts[]` has one entry with `scope: 'LINE_ITEM'` and the targeted `lineItem.appliedDiscounts` is populated.
- (c) Single-tender with untargeted discount → `discounts[]` has one entry with `scope: 'ORDER'` and no `lineItem.appliedDiscounts`.
- (d) Multi-quantity service line → exactly one `lineItem` with `quantity: '<N>'`.
- (e) Zero-priced service line → `basePriceMoney.amount === 0` is preserved.
- (f) Special characters in `name_snapshot` (`Owner's special`) round-trip unchanged.
- (g) Split-tender card leg (`existingDraftId` set) → `client.orders.create` is NOT called; `terminal.checkouts.create` is called with `amountMoney` and NO `orderId`.
- (h) Grand total parity → for a service-line subtotal + a targeted discount, the implied Order grand total equals `ticket.total_cents`.

**Vitest unit (`tests/unit/square/order-cancel-orphan.test.ts` — new)**:
- (i) `terminal.checkouts.create` throws after `orders.create` succeeds → `orders.update({ state: 'CANCELED' })` is called exactly once with the correct `orderVersion`.
- (j) The cancel call itself throws → `console.warn` is invoked with both errors; the original `SquareCheckoutCreateFailedError` is the thrown value.
- (k) Idempotency key reuse → `orders.create` and `terminal.checkouts.create` receive the same `idempotencyKey` string.

**Playwright e2e (`tests/e2e/card-payment-happy.spec.ts` extensions)**:
- (l) Run a single-tender card sale; assert the Square stub recorded a `POST /v2/orders` request whose body has the expected `lineItems` and total.
- (m) Run a split-tender card leg (cart with cash + card); assert NO `POST /v2/orders` was recorded.

**Playwright e2e (`tests/e2e/card-payment-cancel.spec.ts` extensions)**:
- (n) Force `terminal.checkouts.create` to 500; assert the stub recorded a `PUT /v2/orders/:id` with `state: 'CANCELED'`.
