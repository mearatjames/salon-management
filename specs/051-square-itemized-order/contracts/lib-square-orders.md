# Contract: `lib/square/orders.ts`

**Feature**: `051-square-itemized-order`

**File**: `lib/square/orders.ts` (NEW — per Research R3)

This module is the Square Orders API wrapper. All callers go through this surface; nothing else in the repo imports `client.orders.*` directly.

## Module exports

### `mapTicketItemsToOrderLineItems(rows: TicketItemRow[]): OrderPayload`

**Purpose**: Pure conversion from Tang Nails `ticket_items` rows to the shape `client.orders.create` expects. No SDK calls, no DB calls — fully unit-testable in isolation.

**Input type**:

```ts
type TicketItemRow = {
  id: string;                              // uuid
  kind: 'service' | 'discount';
  name_snapshot: string;
  unit_price_cents: number;                // services: >= 0; discounts: stored magnitude (always >= 0 in DB)
  qty: number;                             // >= 1 (CHECK constraint)
  discount_target_line_ids: string[] | null;  // only meaningful when kind='discount'
};
```

**Output type**:

```ts
type OrderPayload = {
  lineItems: Array<{
    uid: string;                           // = ticket_item.id (for cross-ref from appliedDiscounts)
    name: string;
    basePriceMoney: { amount: bigint; currency: 'USD' };
    quantity: string;                      // Square SDK stringifies integer quantities
    appliedDiscounts?: Array<{ discountUid: string }>;
  }>;
  discounts: Array<{
    uid: string;                           // = ticket_item.id of the discount row
    name: string;
    amountMoney: { amount: bigint; currency: 'USD' };
    scope: 'ORDER' | 'LINE_ITEM';
  }> | undefined;                          // undefined when no non-zero discount rows
};
```

**Rules** (mirrored in `data-model.md → Validation rules`):

1. Service rows become `lineItems` entries, in input order.
2. Untargeted discount rows (`discount_target_line_ids === null`) become `discounts` entries with `scope: 'ORDER'`.
3. Targeted discount rows become `discounts` entries with `scope: 'LINE_ITEM'`; each `lineItem` whose `uid` is in `discount_target_line_ids` also gets an `appliedDiscounts: [{ discountUid }]` entry. Multiple discounts can apply to the same line item (the array grows).
4. Zero-amount discounts (`abs(unit_price_cents) === 0`) are skipped silently.
5. If after mapping `lineItems.length === 0`, the function throws `EmptyOrderError`.
6. Returns `discounts: undefined` (not an empty array) when no discounts apply — keeps the Square payload minimal.

**Error type**:

```ts
export class EmptyOrderError extends Error {
  constructor() { super('Cannot create an Order with zero line items'); this.name = 'EmptyOrderError'; }
}
```

---

### `createOrder(input): Promise<CreateOrderResult>`

**Purpose**: Server-only wrapper around `client.orders.create`, returning the new Order's id and version (the latter is captured in case the orphan-cancel path needs it; see `cancelOrder`).

**Input type**:

```ts
type CreateOrderInput = {
  ticketId: string;          // for referenceId + idempotency key
  paymentId: string;         // for idempotency key
  locationId: string;        // resolved via lib/square/oauth.ts → getSquareLocationId()
  ticketItems: TicketItemRow[];
};
```

**Output type**:

```ts
type CreateOrderResult = {
  orderId: string;
  orderVersion: number;       // returned by Square; needed for orders.update on the cancel path
};
```

**Behavior**:

- Calls `mapTicketItemsToOrderLineItems(ticketItems)` to derive `lineItems` + `discounts`.
- Reads Square tokens via `readDecryptedTokens()`; throws `Error('createOrder: Square not connected')` when missing (mirrors `createCheckout` precedent in `lib/square/terminal.ts:115`).
- Builds the deterministic idempotency key via the existing `buildIdempotencyKey(ticketId, paymentId)` exported from `lib/square/terminal.ts`. Per Research R6, the same key is used on both `orders.create` and `terminal.checkouts.create` — Square namespaces idempotency per endpoint.
- Sends the request:

  ```ts
  await client.orders.create({
    idempotencyKey,
    order: {
      locationId,
      referenceId: ticketId,
      lineItems,
      discounts,                  // omit field entirely when undefined
      taxes: [],
      pricingOptions: {
        autoApplyTaxes: false,
        autoApplyDiscounts: false,
      },
    },
  });
  ```

- Returns `{ orderId: response.order!.id, orderVersion: response.order!.version ?? 1 }`. Throws if the response is missing `order.id`.

**Idempotency contract**: identical `(ticketId, paymentId)` → identical Order id, regardless of how many times the function is called.

---

### `cancelOrder(input): Promise<void>`

**Purpose**: Best-effort cancel of an Order whose downstream terminal checkout permanently failed (per FR-008 / Q3 clarification / Research R7).

**Input type**:

```ts
type CancelOrderInput = {
  orderId: string;
  orderVersion: number;       // from CreateOrderResult
  locationId: string;
};
```

**Behavior**:

- Calls `client.orders.update({ orderId, order: { locationId, version: orderVersion, state: 'CANCELED' } })`.
- Throws on Square error. The CALLER is responsible for catching, logging, and not surfacing the failure to the operator UI.
- Idempotent at Square's end — calling on an already-CANCELED Order returns the same state.

**Caller pattern** (from `app/(studio)/checkout/actions.ts → sendCardToTerminal`):

```ts
try {
  const { squareTerminalCheckoutId } = await squareCreateCheckout({ ... });
  // success path …
} catch (checkoutErr) {
  // Best-effort orphan-cancel
  if (orderId !== null) {
    try {
      await cancelOrder({ orderId, orderVersion, locationId });
    } catch (cancelErr) {
      console.warn('orphan order cancel failed; orphan remains in Square dashboard', {
        orderId,
        checkoutError: String(checkoutErr),
        cancelError: String(cancelErr),
      });
    }
  }
  // … existing failure handling: mark payment failed, record audit, throw SquareCheckoutCreateFailedError
  throw checkoutErr;
}
```

---

## Module-level invariants

1. **Server-only**: file starts with the same `// lib/square/orders.ts` block comment as `terminal.ts` and is imported only by Server Actions / API routes. A static-import test in `tests/unit/square/client-import-graph.test.ts` will be extended to assert this (the test currently enforces the same invariant for `terminal.ts`).
2. **No DB writes from this module**: `createOrder` reads tokens via the existing helper but never writes to Supabase. Persistence of `payments.square_order_id` happens in the calling Server Action so the write is colocated with the existing `payments` updates and the audit-log call.
3. **No console.log in the success path**: failures inside `createOrder` throw; failures inside `cancelOrder` are surfaced to the caller (which logs). This keeps the module pure-throwing.
4. **`mapTicketItemsToOrderLineItems` is referentially transparent**: no `Date.now()`, no random ids, no env reads. Reseeds the same Order payload on every call.
