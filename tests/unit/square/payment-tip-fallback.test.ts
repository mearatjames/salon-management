// tests/unit/square/payment-tip-fallback.test.ts
//
// Bug (feature 051 follow-up): a buyer-entered tip on a Square Terminal is
// reported on the Payment object (`payment.tip_money`), NOT on the
// TerminalCheckout object. Square only sets `checkout.tip_money` for a
// developer-supplied fixed tip when tipping is disabled. Now that
// single-tender card sales are Order-linked (feature 051), Square stops
// echoing the buyer's tip onto `checkout.tip_money`, so the prior
// `checkout.tip_money ?? 0` capture records `tip_cents = 0` even though the
// card was charged the tip — a money-integrity break (Constitution III).
//
// `getPaymentTipCents` is the fallback: fetch the linked Payment and read its
// tip so the recorded `tip_cents` matches what Square actually charged.

import { afterEach, describe, expect, it, vi } from "vitest";

const paymentsGet = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: () => ({ payments: { get: paymentsGet } }),
}));

vi.mock("@/lib/square/oauth", () => ({
  readDecryptedTokens: vi.fn(async () => ({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    refreshFailedAt: null,
    merchantId: "MERCHANT_TEST",
    merchantName: "Test Salon",
  })),
}));

describe("getPaymentTipCents — buyer tip sourced from the Payment object", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the buyer tip from payment.tipMoney (camelCase + bigint)", async () => {
    paymentsGet.mockResolvedValue({
      payment: { id: "pay_1", tipMoney: { amount: BigInt(900) } },
    });
    const { getPaymentTipCents } = await import("@/lib/square/terminal");
    expect(await getPaymentTipCents("pay_1")).toBe(900);
    expect(paymentsGet).toHaveBeenCalledWith({ paymentId: "pay_1" });
  });

  it("reads snake_case tip_money too", async () => {
    paymentsGet.mockResolvedValue({
      payment: { id: "pay_1", tip_money: { amount: 750 } },
    });
    const { getPaymentTipCents } = await import("@/lib/square/terminal");
    expect(await getPaymentTipCents("pay_1")).toBe(750);
  });

  it("returns null when the payment carries no tip", async () => {
    paymentsGet.mockResolvedValue({ payment: { id: "pay_1" } });
    const { getPaymentTipCents } = await import("@/lib/square/terminal");
    expect(await getPaymentTipCents("pay_1")).toBeNull();
  });

  it("returns null (does not throw) when the Square call fails", async () => {
    paymentsGet.mockRejectedValue(new Error("square down"));
    const { getPaymentTipCents } = await import("@/lib/square/terminal");
    expect(await getPaymentTipCents("pay_1")).toBeNull();
  });
});
