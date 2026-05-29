// tests/unit/square/refund-payment.test.ts
//
// Unit coverage for `lib/square/refunds.refundCardPayment`. Asserts:
//   - The Square SDK `payments.refundPayment` is invoked with the right
//     shape (paymentId = squarePaymentId, amountMoney as bigint / USD,
//     idempotencyKey = buildRefundIdempotencyKey(original, refund)).
//   - A missing `refund.id` throws.
//   - A Square API rejection propagates.
//
// Mocks `@/lib/square/client` + oauth exactly like
// `tests/unit/square/gift-card-payment.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeRefundPayment = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: vi.fn(() => ({
    giftCards: { getFromGan: vi.fn() },
    payments: { create: vi.fn(), get: vi.fn() },
    refunds: { refundPayment: fakeRefundPayment },
    terminal: { checkouts: { create: vi.fn(), get: vi.fn(), cancel: vi.fn() } },
    devices: { list: vi.fn() },
  })),
}));

vi.mock("@/lib/square/oauth", () => ({
  readDecryptedTokens: vi.fn(async () => ({
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    refreshFailedAt: null,
    merchantId: "MERCHANT_STUB",
    merchantName: "Stub Salon",
  })),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

describe("lib/square/refunds — refundCardPayment", () => {
  beforeEach(() => {
    fakeRefundPayment.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls payments.refundPayment with the right shape + deterministic idempotency key", async () => {
    const { refundCardPayment } = await import("@/lib/square/refunds");
    const { buildRefundIdempotencyKey } = await import("@/lib/square/terminal");

    fakeRefundPayment.mockResolvedValueOnce({
      refund: { id: "rfnd_ABC", status: "PENDING" },
    });

    const original = "11111111-1111-1111-1111-111111111111";
    const refund = "22222222-2222-2222-2222-222222222222";
    const idempotencyKey = buildRefundIdempotencyKey(original, refund);

    const result = await refundCardPayment({
      squarePaymentId: "pay_sq_ORIG",
      amountCents: 4500,
      idempotencyKey,
      reason: "Void same-day sale",
    });

    expect(fakeRefundPayment).toHaveBeenCalledTimes(1);
    const callArg = fakeRefundPayment.mock.calls[0][0] as {
      idempotencyKey: string;
      paymentId: string;
      amountMoney: { amount: bigint; currency: string };
      reason?: string;
    };

    expect(callArg.idempotencyKey).toBe(idempotencyKey);
    expect(callArg.idempotencyKey).toMatch(/^[a-f0-9]{45}$/);
    expect(callArg.paymentId).toBe("pay_sq_ORIG");
    expect(callArg.amountMoney.amount).toBe(BigInt(4500));
    expect(callArg.amountMoney.currency).toBe("USD");
    expect(callArg.reason).toBe("Void same-day sale");

    expect(result.squareRefundId).toBe("rfnd_ABC");
    expect(result.status).toBe("PENDING");
  });

  it("throws when the Square response is missing refund.id", async () => {
    const { refundCardPayment } = await import("@/lib/square/refunds");
    fakeRefundPayment.mockResolvedValueOnce({ refund: { status: "PENDING" } });

    await expect(
      refundCardPayment({
        squarePaymentId: "pay_sq_ORIG",
        amountCents: 1000,
        idempotencyKey: "k".repeat(45),
      })
    ).rejects.toThrow();
  });

  it("propagates a Square API rejection", async () => {
    const { refundCardPayment } = await import("@/lib/square/refunds");
    fakeRefundPayment.mockRejectedValueOnce(new Error("Square 422 INVALID_REQUEST_ERROR"));

    await expect(
      refundCardPayment({
        squarePaymentId: "pay_sq_ORIG",
        amountCents: 1000,
        idempotencyKey: "k".repeat(45),
      })
    ).rejects.toThrow("Square 422 INVALID_REQUEST_ERROR");
  });
});
