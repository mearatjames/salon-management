# Contract: `lib/square/refunds.ts`

Server-side only. Mirrors `lib/square/gift-cards.ts:createGiftCardPayment` (same client, tokens, money shape).

```ts
export type RefundCardPaymentInput = {
  squarePaymentId: string;   // payments.square_payment_id of the ORIGINAL (card or gift) payment
  amountCents: number;       // > 0
  idempotencyKey: string;    // buildRefundIdempotencyKey(originalPaymentId, refundPaymentId)
  reason?: string;
};

export type RefundCardPaymentResult = {
  squareRefundId: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
};

export async function refundCardPayment(
  input: RefundCardPaymentInput
): Promise<RefundCardPaymentResult>;
```

**Behavior**:
- `connection = await readDecryptedTokens()`; throw if Square not connected.
- `client = getSquareClient(connection.accessToken)`.
- `await client.payments.refundPayment({ idempotencyKey, paymentId: squarePaymentId, amountMoney: { amount: BigInt(amountCents), currency: "USD" }, reason })`.
- Read `response.refund?.id` / `response.refund?.status`; throw if missing id.
- Used for **both** card and gift originals (both settle via `client.payments`).

**Idempotency key** — add to `lib/square/terminal.ts`:

```ts
export function buildRefundIdempotencyKey(originalPaymentId: string, refundPaymentId: string): string {
  return createHash("sha256")
    .update(`${originalPaymentId}:refund:${refundPaymentId}`)
    .digest("hex")
    .slice(0, 45); // Square idempotency_key max length
}
```

The pre-hash string is exactly the constitution's Principle III form `${payment_id}:refund:${refund_payment_id}`.

**Unit test** (`tests/unit/square/refund-payment.test.ts`) — `vi.mock("@/lib/square/client")` + `oauth`, assert:
- `idempotencyKey` equals `buildRefundIdempotencyKey(original, refund)`.
- `amountMoney.amount` is `BigInt(amountCents)`, currency `"USD"`.
- Missing `refund.id` throws.
- Square API rejection propagates (so the action can roll back).
