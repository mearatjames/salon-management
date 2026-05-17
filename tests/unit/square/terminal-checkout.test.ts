// tests/unit/square/terminal-checkout.test.ts
//
// Unit coverage for the lib/square/terminal extensions added by US2:
//
//   (a) createCheckout({ticketId, paymentId, amountCents, deviceId, referenceId})
//       MUST pass the Square SDK a request whose `idempotencyKey` equals
//       `${ticketId}:${paymentId}` exactly (per research R1 — deterministic
//       per-attempt key). This is what guarantees that a retried network
//       call lands on the same Square checkout (idempotent), and that a
//       fresh attempt (new payment row) gets a new key.
//
//   (b) getCheckout(checkoutId) MUST map Square's raw status strings
//       PENDING | IN_PROGRESS | COMPLETED | CANCELED | CANCEL_REQUESTED
//       to our domain status union. Webhook + polling paths depend on this.
//
// Square SDK is mocked via Vitest module mocks — the same pattern used by
// `tests/unit/square/client-import-graph.test.ts` and the rest of the
// suite. No Supabase, no network, no DB.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK instance the implementation will pull from `lib/square/client`.
// We replace `getSquareClient` wholesale so the module-level imports inside
// `lib/square/terminal.ts` resolve to our spy-friendly fake.
const fakeCreate = vi.fn();
const fakeGet = vi.fn();
const fakeCancel = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: vi.fn(() => ({
    terminal: {
      checkouts: {
        create: fakeCreate,
        get: fakeGet,
        cancel: fakeCancel,
      },
    },
    devices: { list: vi.fn() },
  })),
}));

// readDecryptedTokens is the bridge to Postgres; we stub it so unit tests
// stay fully in-process. Returns a synthetic "connected" state.
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

describe("lib/square/terminal — createCheckout", () => {
  beforeEach(() => {
    fakeCreate.mockReset();
    fakeGet.mockReset();
    fakeCancel.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("(a) sends idempotencyKey derived deterministically from (ticketId, paymentId), <=64 chars", async () => {
    const { createCheckout, buildIdempotencyKey } = await import("@/lib/square/terminal");

    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_ABC", status: "PENDING" },
    });

    const ticketId = "11111111-1111-1111-1111-111111111111";
    const paymentId = "22222222-2222-2222-2222-222222222222";

    await createCheckout({
      ticketId,
      paymentId,
      amountCents: 4500,
      deviceId: "device:LOBBY",
      referenceId: ticketId,
    });

    expect(fakeCreate).toHaveBeenCalledTimes(1);
    const callArg = fakeCreate.mock.calls[0][0] as { idempotencyKey: string };
    // Square caps the key at 64 chars; we hash to fit. Same (ticket, payment)
    // ⇒ same key (idempotency contract preserved).
    expect(callArg.idempotencyKey).toBe(buildIdempotencyKey(ticketId, paymentId));
    // Empirically Square rejects 64 chars in sandbox; we use 32 (128 bits of entropy).
    expect(callArg.idempotencyKey.length).toBe(32);
    expect(callArg.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
  });

  it("(a) two different paymentIds for the same ticket yield different keys", async () => {
    const { createCheckout } = await import("@/lib/square/terminal");

    fakeCreate.mockResolvedValue({
      checkout: { id: "tco_ABC", status: "PENDING" },
    });

    const ticketId = "11111111-1111-1111-1111-111111111111";
    const paymentA = "22222222-2222-2222-2222-222222222222";
    const paymentB = "33333333-3333-3333-3333-333333333333";

    await createCheckout({
      ticketId,
      paymentId: paymentA,
      amountCents: 4500,
      deviceId: "device:LOBBY",
      referenceId: ticketId,
    });
    await createCheckout({
      ticketId,
      paymentId: paymentB,
      amountCents: 4500,
      deviceId: "device:LOBBY",
      referenceId: ticketId,
    });

    const { buildIdempotencyKey } = await import("@/lib/square/terminal");
    const keyA = (fakeCreate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const keyB = (fakeCreate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(keyA).toBe(buildIdempotencyKey(ticketId, paymentA));
    expect(keyB).toBe(buildIdempotencyKey(ticketId, paymentB));
    expect(keyA).not.toBe(keyB);
  });

  it("(a) returns the squareTerminalCheckoutId from the SDK response", async () => {
    const { createCheckout } = await import("@/lib/square/terminal");

    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_XYZ", status: "PENDING" },
    });

    const result = await createCheckout({
      ticketId: "11111111-1111-1111-1111-111111111111",
      paymentId: "22222222-2222-2222-2222-222222222222",
      amountCents: 4500,
      deviceId: "device:LOBBY",
      referenceId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.squareTerminalCheckoutId).toBe("tco_XYZ");
  });
});

describe("lib/square/terminal — getCheckout status mapping", () => {
  beforeEach(() => {
    fakeCreate.mockReset();
    fakeGet.mockReset();
    fakeCancel.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["PENDING", "pending"],
    ["IN_PROGRESS", "in_progress"],
    ["COMPLETED", "completed"],
    ["CANCELED", "canceled"],
    ["CANCEL_REQUESTED", "cancel_requested"],
  ])("(b) maps Square %s → domain %s", async (squareStatus, domainStatus) => {
    const { getCheckout } = await import("@/lib/square/terminal");

    fakeGet.mockResolvedValueOnce({
      checkout: {
        id: "tco_ABC",
        status: squareStatus,
        payment_ids: squareStatus === "COMPLETED" ? ["pay_ABC"] : [],
        tip_money: squareStatus === "COMPLETED" ? { amount: 800, currency: "USD" } : undefined,
      },
    });

    const result = await getCheckout("tco_ABC");
    expect(result.status).toBe(domainStatus);
  });

  it("(b) surfaces tip_money.amount as tipCents when COMPLETED", async () => {
    const { getCheckout } = await import("@/lib/square/terminal");

    fakeGet.mockResolvedValueOnce({
      checkout: {
        id: "tco_ABC",
        status: "COMPLETED",
        payment_ids: ["pay_ABC"],
        tip_money: { amount: 1200, currency: "USD" },
      },
    });

    const result = await getCheckout("tco_ABC");
    expect(result.tipCents).toBe(1200);
    expect(result.squarePaymentId).toBe("pay_ABC");
  });
});
