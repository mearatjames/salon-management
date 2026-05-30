# Contract: Server Actions

Both actions follow the existing pattern: `"use server"`, `requireStudioSession()`, role gate, Zod-validated input, service-role RPC, two-phase Square settlement, typed errors from `_errors.ts`, `revalidatePath`. No PIN.

## `voidSale` — `app/(studio)/checkout/actions.ts`

```ts
export async function voidSale(input: {
  ticketId: string;
}): Promise<{ ticketId: string; status: "void"; refundedCents: number }>;
```

**Flow**:
1. `viewer = await requireStudioSession()`.
2. Role gate: `if (role !== "owner" && role !== "manager") throw new PermissionDeniedError()`.
3. `pos_void_ticket(p_ticket_id, p_operator)` (service-role): locks ticket + succeeded payments; refuses with `ticket_not_void_eligible` if status≠`paid`, not same-day (salon-local `closed_at`), or already reversed; creates `kind='refund'` rows (cash→`succeeded`, card/gift→`pending`). Returns rows `[{ refundPaymentId, method, squarePaymentId, amountCents }]`.
4. For each card/gift row: `refundCardPayment({ squarePaymentId, amountCents, idempotencyKey: buildRefundIdempotencyKey(squarePaymentId? originalPaymentId, refundPaymentId) })`. **On any throw** → mark legs `failed`, abort, `throw new SquareRefundFailedError(...)` (ticket stays `paid`).
5. `pos_finalize_void(p_ticket_id, p_refund_results)`: flip card/gift rows → `succeeded` + `square_refund_id`; set `tickets.status='void'`, `closed_*`; insert `payment.void_issued` audit.
6. `revalidatePath("/checkout")`, `revalidatePath("/dashboard")`, `revalidatePath("/transactions")`. Return.

**Errors**: `PermissionDeniedError`, `VoidNotAllowedError` (maps `ticket_not_void_eligible`), `SquareRefundFailedError`, `TicketNotFoundError`.

## `refundTicket` — `app/(studio)/transactions/actions.ts`

```ts
export async function refundTicket(input: {
  ticketId: string;
  lines: Array<{ originalPaymentId: string; amountCents: number }>; // amountCents > 0
}): Promise<{
  ticketId: string;
  status: "partially_refunded" | "refunded";
  refundedCents: number;
}>;
```

**Flow**:
1. `requireStudioSession()` + owner/manager gate (`PermissionDeniedError`).
2. Validate `lines` non-empty, each `amountCents > 0` (Zod).
3. `pos_refund_payments(p_ticket_id, p_operator, p_lines jsonb)`: under lock, for each line assert `amountCents ≤ remaining(originalPaymentId)` else raise `refund_exceeds_remaining`; assert each `originalPaymentId` belongs to the ticket and is `kind='payment' status='succeeded'`; create `kind='refund'` rows (cash→`succeeded`, card/gift→`pending`). Returns created rows.
4. Card/gift legs → `refundCardPayment(...)`; on throw → mark failed, abort, `SquareRefundFailedError` (no status change).
5. `pos_finalize_refund(p_ticket_id, p_refund_results)`: flip legs `succeeded` + `square_refund_id`; recompute status via the same logic as `lib/payments/refund-status.ts` (`refunded` iff Σ succeeded refunds == Σ succeeded payments, else `partially_refunded`); set `closed_*` if first reversal; insert `payment.refund_issued` audit.
6. `revalidatePath("/dashboard")`, `revalidatePath("/transactions")`, `revalidatePath("/end-of-day")`. Return.

**Errors**: `PermissionDeniedError`, `RefundExceedsRemainingError` (maps `refund_exceeds_remaining`), `PaymentNotOnTicketError`, `SquareRefundFailedError`, `TicketNotFoundError`.

## Error types — `app/(studio)/checkout/_errors.ts` (+ reuse in transactions)

New subclasses of the existing `CheckoutError`-style base (discriminated by `.name`, since `"use server"` forbids non-async exports beyond classes/types):

- `VoidNotAllowedError` — ticket not void-eligible (wrong status / not same-day / already reversed).
- `RefundExceedsRemainingError` — a line exceeds the payment's unrefunded remainder.
- `PaymentNotOnTicketError` — referenced payment not part of the ticket.
- `SquareRefundFailedError` — a card/gift Square refund failed; ticket left unchanged.
- `PermissionDeniedError` — reuse the existing one from `app/(studio)/transactions/actions.ts` (lift to a shared module if both files need it).

Client surfaces map `error.name` → a sonner toast (existing convention from feature 050's `receipt-line-tech-chip.tsx`).
