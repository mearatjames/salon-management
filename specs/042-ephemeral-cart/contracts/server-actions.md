# Phase 1 Contracts: Server Action Surface

**Feature**: 042-ephemeral-cart | **Date**: 2026-05-18

This feature exposes its server-side surface via four new Next.js Server Actions, all in `app/(studio)/checkout/actions.ts`. They take an `EphemeralCart` payload from the browser, validate it server-side, and atomically create the ticket + items + first payment row.

This document is the contract: input shape, behavior, error cases, and post-conditions. The TypeScript code lives in the repo; this file is what `/speckit-analyze` and reviewers diff against.

---

## Common input — `EphemeralCartInput`

Validated by a Zod schema (`commitCartSchema`) at the entry of every commit Server Action. The schema is defined in `app/(studio)/checkout/_commit-from-cart.ts` and exported for use by tests.

```ts
const cartItemSchema = z.object({
  serviceId: z.string().uuid(),
  techId: z.string().uuid(),
  note: z.string().max(500).nullable(),
});

const cartDiscountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('amount'), amountCents: z.number().int().min(0) }),
]);

const commitCartSchema = z.object({
  customerId: z.string().uuid().nullable(),
  techId: z.string().uuid().nullable(),
  items: z.array(cartItemSchema).min(1),  // at least one item required
  discount: cartDiscountSchema.nullable(),
  notes: z.string().max(1000).nullable(),
});

export type EphemeralCartInput = z.infer<typeof commitCartSchema>;
```

**Server-side resolution after schema validation:**

- Each `serviceId` is re-resolved against `services` (active only); price + duration + name come from the database (snapshot semantics).
- Each `techId` is re-resolved against `staff` (active only).
- `customerId` if present is re-resolved against `customers`.
- `subtotal_cents` is computed from snapshotted line prices.
- `discount_cents` is computed from `discount` and `subtotal_cents`.
- `total_cents` = `subtotal_cents - discount_cents` (tip + tax are 0 at commit).

---

## Action 1 — `submitCashFromCart(cart: EphemeralCartInput, cashTenderedCents: number): Promise<CommitResult>`

**Purpose**: Promote the ephemeral cart to a fully-paid cash ticket in one atomic transaction.

**Behavior**:

1. Validate `cart` with `commitCartSchema` (throws `ValidationError` on failure).
2. Open a single Postgres transaction.
3. Insert `tickets` row with `status='paid'`, computed totals, operator + tech IDs.
4. Bulk insert `ticket_items` rows from `cart.items`, snapshotting service price/name/duration.
5. Call existing `pos_take_cash(ticket_id, cash_tendered_cents)` RPC inside the same transaction — this RPC inserts the `payments` row with `method='cash'`, `status='succeeded'`, and writes the `payment.captured` audit event.
6. Insert `ticket.paid` audit event (the same RPC handles this today as part of the cash-tendered flow).
7. Commit the transaction.
8. Return `{ ok: true, ticketId }`.

**Error cases**:

- Input validation failure → `{ ok: false, code: 'INVALID_CART', message }`.
- A `serviceId` no longer references an active service → `{ ok: false, code: 'STALE_SERVICE', serviceId }`.
- A `techId` is inactive → `{ ok: false, code: 'INACTIVE_TECH', techId }`.
- `cashTenderedCents < total_cents` → `{ ok: false, code: 'INSUFFICIENT_CASH' }`.
- Database error (RLS, FK, constraint) → `{ ok: false, code: 'INTERNAL', message }`. Transaction rolls back; no partial rows.

**Post-conditions on success**:

- Exactly one new `tickets` row with `status='paid'`, total matching `cart`'s computed total.
- `ticket_items.length === cart.items.length` rows, FK to the new ticket.
- Exactly one new `payments` row with `method='cash'`, `status='succeeded'`, `amount_cents=total_cents`.
- Two new `audit_log` rows: `ticket.paid` and `payment.captured`.

**Post-conditions on failure**: No new rows in `tickets`, `ticket_items`, or `payments`. The client's `EphemeralCart` is preserved (caller responsibility — Server Action does not redirect on failure).

---

## Action 2 — `submitGiftFromCart(cart: EphemeralCartInput, giftCardNumber: string, gan: string): Promise<CommitResult>`

**Purpose**: Promote the ephemeral cart to a fully-paid gift-card ticket.

**Behavior**: Same shape as `submitCashFromCart` but calls `pos_record_gift_payment(ticket_id, gan, amount_cents)` inside the transaction. Resolves the gift card, decrements balance, inserts `payments` row with `method='gift'`, `status='succeeded'`.

**Error cases**: Same as cash, plus:
- `GIFT_NOT_FOUND` — `gan` doesn't resolve to an active gift card.
- `GIFT_INSUFFICIENT_BALANCE` — card balance is less than `total_cents`.

**Post-conditions**: Identical to cash except `method='gift'` on the `payments` row.

---

## Action 3 — `sendCardToTerminalFromCart(cart: EphemeralCartInput, deviceId: string): Promise<CommitResult>`

**Purpose**: Promote the ephemeral cart to a `status='open'` ticket with a `pending` card payment, then ask Square to start the terminal capture.

**Behavior**:

1. Validate `cart` with `commitCartSchema`.
2. Open a single Postgres transaction.
3. Insert `tickets` row with `status='open'`, computed totals.
4. Bulk insert `ticket_items` rows.
5. Insert `payments` row with `method='card'`, `kind='sale'`, `status='pending'`, `amount_cents=total_cents`. `square_terminal_checkout_id` is null at this point.
6. Commit the transaction.
7. Call Square `createTerminalCheckout` with idempotency key `${ticketId}:${paymentId}`.
8. If Square call succeeds: update the `payments` row with `square_terminal_checkout_id`, return `{ ok: true, ticketId }` — client redirects to `/checkout/<ticketId>` which renders the existing "waiting for terminal" UI.
9. If Square call fails: directly DELETE the three just-created rows (`payments` → `ticket_items` → `tickets`, FK-safe order), then return `{ ok: false, code: 'TERMINAL_HANDOFF_FAILED', message }`. The client preserves the in-memory cart for retry.

**Error cases**: Same input-validation errors as cash, plus `TERMINAL_HANDOFF_FAILED`.

**Post-conditions on success**: One `tickets` row (`status='open'`), N `ticket_items` rows, one `payments` row (`status='pending'`, `square_terminal_checkout_id` populated). No audit event yet — the existing webhook handler emits `payment.captured` when the capture completes.

**Post-conditions on handoff failure**: Zero new rows. Verified by SC-006.

---

## Action 4 — `splitTenderFromCart(cart: EphemeralCartInput): Promise<CommitResult>`

**Purpose**: Promote the ephemeral cart to a `status='open'` ticket and compose the initial split-tender draft state, then hand off to the existing mid-split-tender screen.

**Behavior**:

1. Validate `cart` with `commitCartSchema`.
2. Open a single Postgres transaction.
3. Insert `tickets` row with `status='open'`, computed totals.
4. Bulk insert `ticket_items` rows.
5. Call existing `pos_compose_payment_draft(ticket_id)` inside the same transaction to set up the initial draft state (no `payments` row yet — the draft is composed lazily as legs are added in the existing UI).
6. Commit the transaction.
7. Return `{ ok: true, ticketId }`. Client redirects to `/checkout/<ticketId>`, which renders the existing mid-split-tender screen with the new ticket ID.

**Error cases**: Same input-validation errors as cash. No external-service failure path because Square isn't called here.

**Post-conditions on success**: One `tickets` row (`status='open'`), N `ticket_items` rows. No `payments` row yet — the existing mid-split-tender flow inserts them per captured leg.

---

## Common return type

```ts
export type CommitResult =
  | { ok: true; ticketId: string }
  | { ok: false; code: CommitErrorCode; message: string;
      // optional context fields per code
      serviceId?: string; techId?: string };

export type CommitErrorCode =
  | 'INVALID_CART'
  | 'STALE_SERVICE'
  | 'INACTIVE_TECH'
  | 'INSUFFICIENT_CASH'
  | 'GIFT_NOT_FOUND'
  | 'GIFT_INSUFFICIENT_BALANCE'
  | 'TERMINAL_HANDOFF_FAILED'
  | 'INTERNAL';
```

The client-side caller is expected to:

- On `ok: true` → call the cart reducer's `reset()` action AND `router.push('/checkout/' + result.ticketId)`.
- On `ok: false` → render an error toast (using `_errors.ts` mapping) and do NOT call `reset()` — the cart stays in memory for retry.

---

## Non-goals for this contract

These are existing endpoints that this contract does NOT change:

- `POST /api/webhooks/square` (Square's webhook delivery)
- `GET /api/square/terminal-checkout/[id]` (terminal-checkout status polling fallback)
- `POST /api/square/payment` and `POST /api/square/payment/[paymentId]` (Square Web Payments SDK confirmation)
- All post-commit Server Actions in `actions.ts`: `discardTicket`, `setItemTech`, `editTip`, `voidPayment`, `refundPayment`, etc.
- The mid-split-tender Server Actions: `addSplitTenderLeg`, `captureSplitTenderLeg`, `dropSplitTenderLeg`, etc.

These continue to operate against committed tickets exactly as today.
