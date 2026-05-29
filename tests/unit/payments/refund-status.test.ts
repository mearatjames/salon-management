// tests/unit/payments/refund-status.test.ts
//
// Unit coverage for the pure refund-status math in
// `lib/payments/refund-status.ts` (data-model.md D9):
//   - `remaining(payment, refunds)` = amount_cents − Σ(succeeded refunds
//     of that payment).
//   - `deriveTicketStatus` resolves to 'refunded' iff Σ succeeded refunds
//     == Σ succeeded original payments, else 'partially_refunded'.
//   - Over-refund (a line exceeding remaining) is rejected by the
//     remaining math (remaining goes to 0, so a further refund has no
//     headroom).

import { describe, expect, it } from "vitest";

import { remaining, deriveTicketStatus } from "@/lib/payments/refund-status";

type P = {
  id: string;
  amountCents: number;
  kind: "payment" | "refund";
  status: "succeeded" | "pending" | "failed";
  refundsPaymentId: string | null;
};

const original = (id: string, amountCents: number): P => ({
  id,
  amountCents,
  kind: "payment",
  status: "succeeded",
  refundsPaymentId: null,
});

const refund = (
  refundsPaymentId: string,
  amountCents: number,
  status: P["status"] = "succeeded"
): P => ({
  id: `r-${refundsPaymentId}-${amountCents}-${status}`,
  amountCents,
  kind: "refund",
  status,
  refundsPaymentId,
});

describe("lib/payments/refund-status — remaining", () => {
  it("returns the full amount when nothing is refunded", () => {
    const orig = original("p1", 4500);
    expect(remaining(orig, [])).toBe(4500);
  });

  it("subtracts only succeeded refunds of that payment", () => {
    const orig = original("p1", 4500);
    const refunds = [
      refund("p1", 2000, "succeeded"),
      refund("p1", 500, "pending"), // not counted — not succeeded
      refund("p2", 1000, "succeeded"), // not counted — different payment
    ];
    expect(remaining(orig, refunds)).toBe(2500);
  });

  it("returns 0 when fully refunded (no headroom for an over-refund)", () => {
    const orig = original("p1", 4500);
    expect(remaining(orig, [refund("p1", 4500)])).toBe(0);
  });
});

describe("lib/payments/refund-status — deriveTicketStatus", () => {
  it("'refunded' when succeeded refunds equal succeeded original payments (full)", () => {
    const payments = [
      original("p1", 3000),
      original("p2", 1500),
      refund("p1", 3000),
      refund("p2", 1500),
    ];
    expect(deriveTicketStatus(payments)).toBe("refunded");
  });

  it("'partially_refunded' on a partial reversal", () => {
    const payments = [original("p1", 4500), refund("p1", 2000)];
    expect(deriveTicketStatus(payments)).toBe("partially_refunded");
  });

  it("'partially_refunded' when one of several originals is fully reversed but others aren't", () => {
    const payments = [original("p1", 3000), original("p2", 1500), refund("p1", 3000)];
    expect(deriveTicketStatus(payments)).toBe("partially_refunded");
  });

  it("ignores pending refunds when deriving status", () => {
    const payments = [original("p1", 4500), refund("p1", 4500, "pending")];
    expect(deriveTicketStatus(payments)).toBe("partially_refunded");
  });
});
