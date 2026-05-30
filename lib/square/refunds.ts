// lib/square/refunds.ts
//
// Server-only wrapper around Square's Refunds API used by feature 052
// (Privileged Action Overrides — Void & Refund). Used for BOTH card and
// gift-card originals.
//
// Exports:
//   - refundCardPayment({...})  — Square `client.payments.refundPayment`
//                                 with a deterministic idempotency key
//                                 per Constitution III.
//
// Mirrors `lib/square/gift-cards.ts:createGiftCardPayment` exactly — same
// `readDecryptedTokens` + `getSquareClient`, same money shape.
//
// SERVER-ONLY. NEVER import from a client component — the Square SDK pulls
// in Node-only modules and would leak the access token at runtime. The
// existing `tests/unit/square/client-import-graph.test.ts` enforces this.

import { getSquareClient } from "@/lib/square/client";
import { readDecryptedTokens } from "@/lib/square/oauth";

export type RefundCardPaymentInput = {
  /** The Square payment id of the ORIGINAL payment being reversed. */
  squarePaymentId: string;
  amountCents: number;
  /** Deterministic key from `buildRefundIdempotencyKey(original, refund)`. */
  idempotencyKey: string;
  reason?: string;
};

export type RefundCardPaymentResult = {
  squareRefundId: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
};

/**
 * Issue a Square refund against an existing card or gift-card payment.
 *
 * Idempotency: the caller passes `idempotencyKey =
 * buildRefundIdempotencyKey(originalPaymentId, refundPaymentId)` per
 * Constitution III. A retried call with the same refund-leg row dedupes
 * at Square; a fresh refund-leg row yields a brand-new refund.
 *
 * The SDK throws on non-2xx — the caller (the server action) translates
 * to `SquareRefundFailedError`.
 */
export async function refundCardPayment(
  input: RefundCardPaymentInput
): Promise<RefundCardPaymentResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("refundCardPayment: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);

  // The Square v44 SDK exposes refunds on `client.refunds.refundPayment`
  // (NOT `client.payments.refundPayment`, which doesn't exist on the
  // PaymentsClient surface).
  const response = (await client.refunds.refundPayment({
    idempotencyKey: input.idempotencyKey,
    paymentId: input.squarePaymentId,
    amountMoney: {
      amount: BigInt(input.amountCents),
      currency: "USD",
    },
    reason: input.reason,
  })) as unknown as { refund?: { id?: string; status?: string } };

  const squareRefundId = response.refund?.id;
  if (!squareRefundId) {
    throw new Error("refundCardPayment: Square response missing refund.id");
  }

  const status = (response.refund?.status ?? "PENDING") as RefundCardPaymentResult["status"];
  return { squareRefundId, status };
}
