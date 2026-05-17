// tests/unit/square/gift-card-payment.test.ts
//
// Unit coverage for `lib/square/gift-cards.createGiftCardPayment`. Asserts:
//   - The Square SDK is invoked with the right shape (sourceId = giftCardId,
//     amountMoney as bigint, tipMoney explicitly { amount: 0n, currency }
//     per Constitution III, referenceId = ticketId).
//   - The idempotencyKey equals `buildIdempotencyKey(ticketId, paymentId)`
//     (same deterministic 32-char hex form as the terminal path).
//   - Two different paymentIds yield two different keys.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakePaymentsCreate = vi.fn();
const fakeGetFromGan = vi.fn();
const fakePaymentsGet = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: vi.fn(() => ({
    giftCards: { getFromGan: fakeGetFromGan },
    payments: { create: fakePaymentsCreate, get: fakePaymentsGet },
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

describe("lib/square/gift-cards — createGiftCardPayment", () => {
  beforeEach(() => {
    fakePaymentsCreate.mockReset();
    fakeGetFromGan.mockReset();
    fakePaymentsGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends idempotencyKey = buildIdempotencyKey(ticketId, paymentId), sourceId=giftCardId, tipMoney=0n", async () => {
    const { createGiftCardPayment } = await import("@/lib/square/gift-cards");
    const { buildIdempotencyKey } = await import("@/lib/square/terminal");

    fakePaymentsCreate.mockResolvedValueOnce({
      payment: { id: "pay_gc_ABC", status: "COMPLETED" },
    });

    const ticketId = "11111111-1111-1111-1111-111111111111";
    const paymentId = "22222222-2222-2222-2222-222222222222";

    await createGiftCardPayment({
      ticketId,
      paymentId,
      amountCents: 4000,
      squareGiftCardId: "gftc_0001",
      referenceId: ticketId,
    });

    expect(fakePaymentsCreate).toHaveBeenCalledTimes(1);
    const callArg = fakePaymentsCreate.mock.calls[0][0] as {
      idempotencyKey: string;
      sourceId: string;
      amountMoney: { amount: bigint; currency: string };
      tipMoney: { amount: bigint; currency: string };
      referenceId: string;
    };

    expect(callArg.idempotencyKey).toBe(buildIdempotencyKey(ticketId, paymentId));
    expect(callArg.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
    expect(callArg.sourceId).toBe("gftc_0001");
    expect(callArg.amountMoney.amount).toBe(BigInt(4000));
    expect(callArg.amountMoney.currency).toBe("USD");
    expect(callArg.tipMoney.amount).toBe(BigInt(0));
    expect(callArg.tipMoney.currency).toBe("USD");
    expect(callArg.referenceId).toBe(ticketId);
  });

  it("two different paymentIds for the same ticket yield different idempotency keys", async () => {
    const { createGiftCardPayment } = await import("@/lib/square/gift-cards");
    const { buildIdempotencyKey } = await import("@/lib/square/terminal");

    fakePaymentsCreate.mockResolvedValue({
      payment: { id: "pay_gc_X", status: "COMPLETED" },
    });

    const ticketId = "11111111-1111-1111-1111-111111111111";
    const paymentA = "22222222-2222-2222-2222-222222222222";
    const paymentB = "33333333-3333-3333-3333-333333333333";

    await createGiftCardPayment({
      ticketId,
      paymentId: paymentA,
      amountCents: 4000,
      squareGiftCardId: "gftc_0001",
      referenceId: ticketId,
    });
    await createGiftCardPayment({
      ticketId,
      paymentId: paymentB,
      amountCents: 4000,
      squareGiftCardId: "gftc_0001",
      referenceId: ticketId,
    });

    const keyA = (fakePaymentsCreate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const keyB = (fakePaymentsCreate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(keyA).toBe(buildIdempotencyKey(ticketId, paymentA));
    expect(keyB).toBe(buildIdempotencyKey(ticketId, paymentB));
    expect(keyA).not.toBe(keyB);
  });

  it("returns the squareGiftCardPaymentId from the SDK response", async () => {
    const { createGiftCardPayment } = await import("@/lib/square/gift-cards");
    fakePaymentsCreate.mockResolvedValueOnce({
      payment: { id: "pay_gc_RETURNED", status: "COMPLETED" },
    });

    const result = await createGiftCardPayment({
      ticketId: "11111111-1111-1111-1111-111111111111",
      paymentId: "22222222-2222-2222-2222-222222222222",
      amountCents: 4000,
      squareGiftCardId: "gftc_0001",
      referenceId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.squareGiftCardPaymentId).toBe("pay_gc_RETURNED");
    expect(result.status).toBe("COMPLETED");
  });
});
