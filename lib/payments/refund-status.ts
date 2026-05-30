// lib/payments/refund-status.ts
//
// Pure refund-status math for feature 052 (Privileged Action Overrides —
// Void & Refund), per data-model.md D9. No I/O — the canonical source of
// truth for these computations lives in the SQL RPCs (pos_refund_payments
// / pos_finalize_refund); this module mirrors them so the server action
// and unit tests can reason about per-payment remaining + the resulting
// ticket status without a round-trip.
//
// Conventions: `amountCents` is always a positive integer on both
// original (`kind='payment'`) and refund (`kind='refund'`) rows; a refund
// row carries `refundsPaymentId` = the original it reverses. Only
// `status='succeeded'` refunds reduce a payment's remaining balance.

export type RefundStatusPayment = {
  id: string;
  amountCents: number;
  kind: "payment" | "refund";
  status: "succeeded" | "pending" | "failed";
  refundsPaymentId: string | null;
};

export type ReversibleTicketStatus = "refunded" | "partially_refunded";

/**
 * The unrefunded remainder of a single original payment:
 *   amountCents − Σ(succeeded refund.amountCents where
 *                   refundsPaymentId === payment.id).
 *
 * Only succeeded refunds count (pending Square refunds haven't settled).
 * A fully-reversed payment returns 0 — leaving no headroom for a further
 * refund line (the caller enforces `requested ≤ remaining`).
 */
export function remaining(
  payment: Pick<RefundStatusPayment, "id" | "amountCents">,
  refunds: readonly RefundStatusPayment[]
): number {
  const refundedCents = refunds
    .filter(
      (r) => r.kind === "refund" && r.status === "succeeded" && r.refundsPaymentId === payment.id
    )
    .reduce((sum, r) => sum + r.amountCents, 0);
  return payment.amountCents - refundedCents;
}

/**
 * Resulting ticket status after a reversal, from the full set of payment
 * rows on the ticket (data-model.md D9):
 *   - 'refunded'           iff Σ succeeded refunds == Σ succeeded original
 *                          payments (fully reversed).
 *   - 'partially_refunded' otherwise (some succeeded refund exists but the
 *                          ticket isn't fully reversed).
 *
 * Pending refunds are ignored — they haven't settled at Square yet.
 */
export function deriveTicketStatus(
  payments: readonly RefundStatusPayment[]
): ReversibleTicketStatus {
  const originalSum = payments
    .filter((p) => p.kind === "payment" && p.status === "succeeded")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const refundSum = payments
    .filter((p) => p.kind === "refund" && p.status === "succeeded")
    .reduce((sum, p) => sum + p.amountCents, 0);

  return refundSum >= originalSum ? "refunded" : "partially_refunded";
}
