// tests/unit/square/gift-card-lookup.test.ts
//
// Unit coverage for `lib/square/gift-cards.retrieveGiftCardFromGAN`. Asserts:
//   - the five Square states map to the discriminated-union per research R3
//     (ACTIVE+balance>0, ACTIVE+balance=0, PENDING/BLOCKED/DEACTIVATED,
//     NOT_FOUND).
//   - balance bigint → number conversion.
//   - last4 mask derivation (whitespace stripped).
//   - 5xx → thrown SquareGiftCardLookupFailedError.
//
// Square SDK + Supabase are mocked at module scope (same pattern as
// terminal-checkout.test.ts). No live DB, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeGetFromGan = vi.fn();
const fakePaymentsCreate = vi.fn();
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

// A minimal builder for the chained from('gift_cards').upsert(...).select('id').single()
// shape consumed by `retrieveGiftCardFromGAN`. Returns the same fake id for any GAN.
const FAKE_GIFT_CARD_ID = "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa";
function makeSupabaseMock() {
  const single = vi.fn(async () => ({ data: { id: FAKE_GIFT_CARD_ID }, error: null }));
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  return { from, upsert, select, single };
}

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

describe("lib/square/gift-cards — retrieveGiftCardFromGAN", () => {
  beforeEach(() => {
    fakeGetFromGan.mockReset();
    fakePaymentsCreate.mockReset();
    fakePaymentsGet.mockReset();
    const mock = makeSupabaseMock();
    (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps ACTIVE + balance > 0 → kind 'found' with balanceCents (number) + last4 mask", async () => {
    const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
    fakeGetFromGan.mockResolvedValueOnce({
      giftCard: {
        id: "gftc_0001",
        state: "ACTIVE",
        balanceMoney: { amount: BigInt(6000), currency: "USD" },
      },
    });

    const result = await retrieveGiftCardFromGAN("6000 1234 5678 0001");

    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("type guard");
    expect(result.giftCardId).toBe(FAKE_GIFT_CARD_ID);
    expect(result.squareGiftCardId).toBe("gftc_0001");
    expect(result.last4Mask).toBe("0001");
    expect(result.balanceCents).toBe(6000);
    expect(typeof result.balanceCents).toBe("number");
    expect(result.state).toBe("ACTIVE");
  });

  it("maps ACTIVE + balance = 0 → kind 'zero_balance'", async () => {
    const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
    fakeGetFromGan.mockResolvedValueOnce({
      giftCard: {
        id: "gftc_0000",
        state: "ACTIVE",
        balanceMoney: { amount: BigInt(0), currency: "USD" },
      },
    });

    const result = await retrieveGiftCardFromGAN("6000123456780000");

    expect(result.kind).toBe("zero_balance");
    if (result.kind !== "zero_balance") throw new Error("type guard");
    expect(result.balanceCents).toBe(0);
    expect(result.last4Mask).toBe("0000");
  });

  it.each(["PENDING", "BLOCKED", "DEACTIVATED"] as const)(
    "maps state %s → kind 'not_redeemable'",
    async (state) => {
      const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
      fakeGetFromGan.mockResolvedValueOnce({
        giftCard: {
          id: `gftc_${state}`,
          state,
          balanceMoney: { amount: BigInt(0), currency: "USD" },
        },
      });

      const result = await retrieveGiftCardFromGAN("6000-1234-5678-BLKD");

      expect(result.kind).toBe("not_redeemable");
      if (result.kind !== "not_redeemable") throw new Error("type guard");
      expect(result.state).toBe(state);
      expect(result.last4Mask).toBe("BLKD");
    }
  );

  it("maps Square 404 NOT_FOUND → kind 'not_found' (no DB write)", async () => {
    const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
    fakeGetFromGan.mockRejectedValueOnce({
      statusCode: 404,
      body: {
        errors: [
          { category: "INVALID_REQUEST_ERROR", code: "NOT_FOUND", detail: "no such gift card" },
        ],
      },
    });

    const result = await retrieveGiftCardFromGAN("6000123456789999");

    expect(result.kind).toBe("not_found");
  });

  it("throws SquareGiftCardLookupFailedError on a 5xx Square response", async () => {
    const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
    const { SquareGiftCardLookupFailedError } = await import("@/app/(studio)/checkout/_errors");
    fakeGetFromGan.mockRejectedValueOnce({
      statusCode: 500,
      body: { errors: [{ category: "API_ERROR", code: "INTERNAL_SERVER_ERROR" }] },
      message: "internal server error",
    });

    await expect(retrieveGiftCardFromGAN("6000123456780001")).rejects.toBeInstanceOf(
      SquareGiftCardLookupFailedError
    );
  });

  it("handles numeric (non-bigint) balance values without losing precision", async () => {
    const { retrieveGiftCardFromGAN } = await import("@/lib/square/gift-cards");
    fakeGetFromGan.mockResolvedValueOnce({
      giftCard: {
        id: "gftc_2500",
        state: "ACTIVE",
        balanceMoney: { amount: 2500, currency: "USD" },
      },
    });

    const result = await retrieveGiftCardFromGAN("6000 1234 5678 2500");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("type guard");
    expect(result.balanceCents).toBe(2500);
  });
});
