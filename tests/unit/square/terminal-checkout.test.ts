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
const fakePaymentsGet = vi.fn();
// Feature 051 — itemized order creation. The `lib/square/orders.ts` wrapper
// calls `client.orders.create`; we mock it here so US1 cases (a)–(g), (k)
// can assert on the request shape.
const fakeOrdersCreate = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: vi.fn(() => ({
    terminal: {
      checkouts: {
        create: fakeCreate,
        get: fakeGet,
        cancel: fakeCancel,
      },
    },
    orders: {
      create: fakeOrdersCreate,
    },
    payments: { get: fakePaymentsGet },
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

// ---------------------------------------------------------------------
// Feature 051 follow-up — a buyer-entered tip lands on the Payment, not the
// TerminalCheckout. Order-linked checkouts never echo tip_money onto the
// checkout, so getCheckout (polling fallback) and cancelCheckout (cancel-race
// settle) must read the tip from the linked Payment. Otherwise tip_cents is
// recorded as 0 while the card was charged the tip (Constitution III).
// ---------------------------------------------------------------------

describe("lib/square/terminal — buyer tip falls back to the Payment when the checkout omits it", () => {
  beforeEach(() => {
    fakeGet.mockReset();
    fakeCancel.mockReset();
    fakePaymentsGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getCheckout: COMPLETED with no checkout.tip_money reads tip from the linked Payment", async () => {
    const { getCheckout } = await import("@/lib/square/terminal");

    fakeGet.mockResolvedValueOnce({
      checkout: { id: "tco_T", status: "COMPLETED", payment_ids: ["pay_T"] },
    });
    fakePaymentsGet.mockResolvedValueOnce({
      payment: { id: "pay_T", tipMoney: { amount: BigInt(700) } },
    });

    const result = await getCheckout("tco_T");

    expect(result.tipCents).toBe(700);
    expect(fakePaymentsGet).toHaveBeenCalledWith({ paymentId: "pay_T" });
  });

  it("getCheckout: does NOT fetch the Payment when the checkout already carries tip_money", async () => {
    const { getCheckout } = await import("@/lib/square/terminal");

    fakeGet.mockResolvedValueOnce({
      checkout: {
        id: "tco_T",
        status: "COMPLETED",
        payment_ids: ["pay_T"],
        tip_money: { amount: 300, currency: "USD" },
      },
    });

    const result = await getCheckout("tco_T");

    expect(result.tipCents).toBe(300);
    expect(fakePaymentsGet).not.toHaveBeenCalled();
  });

  it("cancelCheckout: race-COMPLETED with no checkout.tip_money reads tip from the linked Payment", async () => {
    const { cancelCheckout } = await import("@/lib/square/terminal");

    fakeCancel.mockResolvedValueOnce({
      checkout: { id: "tco_T", status: "COMPLETED", payment_ids: ["pay_C"] },
    });
    fakePaymentsGet.mockResolvedValueOnce({
      payment: { id: "pay_C", tipMoney: { amount: BigInt(450) } },
    });

    const result = await cancelCheckout("tco_T");

    expect(result.tipCents).toBe(450);
    expect(fakePaymentsGet).toHaveBeenCalledWith({ paymentId: "pay_C" });
  });
});

// ---------------------------------------------------------------------
// Feature 051 — itemized Order creation (US1). The mapping helper in
// lib/square/orders.ts is pure; createOrder is the SDK wrapper. These
// cases author the failing surface BEFORE the production module exists
// (Constitution IV — Test-First).
// ---------------------------------------------------------------------

describe("lib/square/orders — mapTicketItemsToOrderLineItems", () => {
  const SERVICE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const SERVICE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const SERVICE_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const DISCOUNT_A = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const DISCOUNT_B = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

  it("(a) maps two service rows to two lineItems with name + basePriceMoney + quantity", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Classic manicure",
        unit_price_cents: 2500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: SERVICE_B,
        kind: "service",
        name_snapshot: "Gel pedicure",
        unit_price_cents: 4500,
        qty: 1,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[0]).toMatchObject({
      uid: SERVICE_A,
      name: "Classic manicure",
      basePriceMoney: { amount: BigInt(2500), currency: "USD" },
      quantity: "1",
    });
    expect(result.lineItems[1]).toMatchObject({
      uid: SERVICE_B,
      name: "Gel pedicure",
      basePriceMoney: { amount: BigInt(4500), currency: "USD" },
      quantity: "1",
    });
    expect(result.discounts).toBeUndefined();
  });

  it("(b) targeted discount → discounts entry scope=LINE_ITEM and targeted lineItem.appliedDiscounts populated", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Classic manicure",
        unit_price_cents: 2500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: SERVICE_B,
        kind: "service",
        name_snapshot: "Gel pedicure",
        unit_price_cents: 4500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: DISCOUNT_A,
        kind: "discount",
        name_snapshot: "Discount · 10%",
        unit_price_cents: -250,
        qty: 1,
        discount_target_line_ids: [SERVICE_A],
      },
    ]);

    expect(result.discounts).toBeDefined();
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts![0]).toMatchObject({
      uid: DISCOUNT_A,
      name: "Discount · 10%",
      amountMoney: { amount: BigInt(250), currency: "USD" },
      scope: "LINE_ITEM",
    });

    const serviceA = result.lineItems.find((li) => li.uid === SERVICE_A);
    const serviceB = result.lineItems.find((li) => li.uid === SERVICE_B);
    expect(serviceA?.appliedDiscounts).toEqual([{ discountUid: DISCOUNT_A }]);
    expect(serviceB?.appliedDiscounts).toBeUndefined();
  });

  it("(c) untargeted discount → discounts entry scope=ORDER, no lineItem.appliedDiscounts", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Classic manicure",
        unit_price_cents: 2500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: DISCOUNT_A,
        kind: "discount",
        name_snapshot: "Discount",
        unit_price_cents: -500,
        qty: 1,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.discounts).toBeDefined();
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts![0]).toMatchObject({
      uid: DISCOUNT_A,
      name: "Discount",
      amountMoney: { amount: BigInt(500), currency: "USD" },
      scope: "ORDER",
    });
    for (const li of result.lineItems) {
      expect(li.appliedDiscounts).toBeUndefined();
    }
  });

  it("(d) qty=3 → exactly one lineItem with quantity='3' (string per SDK type)", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Polish change",
        unit_price_cents: 1500,
        qty: 3,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].quantity).toBe("3");
    expect(typeof result.lineItems[0].quantity).toBe("string");
  });

  it("(e) zero-priced service → basePriceMoney.amount === BigInt(0) (NOT omitted)", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Comp service",
        unit_price_cents: 0,
        qty: 1,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].basePriceMoney.amount).toBe(BigInt(0));
    expect(typeof result.lineItems[0].basePriceMoney.amount).toBe("bigint");
  });

  it("(f) name_snapshot with apostrophe round-trips unchanged", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Owner's special",
        unit_price_cents: 5000,
        qty: 1,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.lineItems[0].name).toBe("Owner's special");
  });

  it("supports multiple discounts applying to the same lineItem", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Spa pedicure",
        unit_price_cents: 6000,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: DISCOUNT_A,
        kind: "discount",
        name_snapshot: "Discount · 10%",
        unit_price_cents: -600,
        qty: 1,
        discount_target_line_ids: [SERVICE_A],
      },
      {
        id: DISCOUNT_B,
        kind: "discount",
        name_snapshot: "Discount",
        unit_price_cents: -300,
        qty: 1,
        discount_target_line_ids: [SERVICE_A],
      },
    ]);

    const serviceA = result.lineItems.find((li) => li.uid === SERVICE_A);
    expect(serviceA?.appliedDiscounts).toEqual([
      { discountUid: DISCOUNT_A },
      { discountUid: DISCOUNT_B },
    ]);
  });

  it("skips zero-amount discount rows silently", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Classic manicure",
        unit_price_cents: 2500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: DISCOUNT_A,
        kind: "discount",
        name_snapshot: "Discount",
        unit_price_cents: 0,
        qty: 1,
        discount_target_line_ids: null,
      },
    ]);

    expect(result.discounts).toBeUndefined();
    expect(result.lineItems[0].appliedDiscounts).toBeUndefined();
  });

  it("throws EmptyOrderError when lineItems would be empty", async () => {
    const { mapTicketItemsToOrderLineItems, EmptyOrderError } = await import("@/lib/square/orders");

    expect(() =>
      mapTicketItemsToOrderLineItems([
        {
          id: DISCOUNT_A,
          kind: "discount",
          name_snapshot: "Discount",
          unit_price_cents: -500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ])
    ).toThrow(EmptyOrderError);
  });

  it("defensively throws on service qty < 1", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    expect(() =>
      mapTicketItemsToOrderLineItems([
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Bad row",
          unit_price_cents: 2500,
          qty: 0,
          discount_target_line_ids: null,
        },
      ])
    ).toThrow();
  });

  it("defensively throws when a targeted discount references a non-service uid", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    expect(() =>
      mapTicketItemsToOrderLineItems([
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
        {
          id: DISCOUNT_A,
          kind: "discount",
          name_snapshot: "Discount",
          unit_price_cents: -100,
          qty: 1,
          // Points at a uid that's not in the service set above.
          discount_target_line_ids: [SERVICE_C],
        },
      ])
    ).toThrow();
  });
});

describe("lib/square/orders — createOrder SDK wiring", () => {
  beforeEach(() => {
    fakeOrdersCreate.mockReset();
    fakeCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const TICKET_ID = "11111111-1111-1111-1111-111111111111";
  const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
  const SERVICE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const SERVICE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("(a) two services → orders.create body has matching lineItems", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValueOnce({
      order: { id: "ord_abc", version: 1 },
    });

    await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
        {
          id: SERVICE_B,
          kind: "service",
          name_snapshot: "Gel pedicure",
          unit_price_cents: 4500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });

    expect(fakeOrdersCreate).toHaveBeenCalledTimes(1);
    const callArg = fakeOrdersCreate.mock.calls[0][0] as {
      order: {
        locationId: string;
        referenceId: string;
        lineItems: Array<{
          name: string;
          basePriceMoney: { amount: bigint };
          quantity: string;
        }>;
      };
    };
    expect(callArg.order.locationId).toBe("L_MAIN");
    expect(callArg.order.referenceId).toBe(TICKET_ID);
    expect(callArg.order.lineItems).toHaveLength(2);
    expect(callArg.order.lineItems[0]).toMatchObject({
      name: "Classic manicure",
      basePriceMoney: { amount: BigInt(2500) },
      quantity: "1",
    });
    expect(callArg.order.lineItems[1]).toMatchObject({
      name: "Gel pedicure",
      basePriceMoney: { amount: BigInt(4500) },
      quantity: "1",
    });
  });

  it("returns { orderId, orderVersion } from the SDK response", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValueOnce({
      order: { id: "ord_xyz", version: 7 },
    });

    const result = await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });

    expect(result).toEqual({ orderId: "ord_xyz", orderVersion: 7 });
  });

  it("throws when Square response is missing order.id", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValueOnce({ order: {} });

    await expect(
      createOrder({
        ticketId: TICKET_ID,
        paymentId: PAYMENT_ID,
        locationId: "L_MAIN",
        ticketItems: [
          {
            id: SERVICE_A,
            kind: "service",
            name_snapshot: "Classic manicure",
            unit_price_cents: 2500,
            qty: 1,
            discount_target_line_ids: null,
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("sends taxes: [] and pricingOptions to disable auto-apply (Research R2)", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValueOnce({
      order: { id: "ord_abc", version: 1 },
    });

    await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });

    const callArg = fakeOrdersCreate.mock.calls[0][0] as {
      order: {
        taxes: unknown[];
        pricingOptions: { autoApplyTaxes: boolean; autoApplyDiscounts: boolean };
      };
    };
    expect(callArg.order.taxes).toEqual([]);
    expect(callArg.order.pricingOptions).toEqual({
      autoApplyTaxes: false,
      autoApplyDiscounts: false,
    });
  });

  it("(k) orders.create + terminal.checkouts.create share the same buildIdempotencyKey for (ticketId, paymentId)", async () => {
    const { createOrder } = await import("@/lib/square/orders");
    const { createCheckout, buildIdempotencyKey } = await import("@/lib/square/terminal");

    fakeOrdersCreate.mockResolvedValueOnce({
      order: { id: "ord_abc", version: 1 },
    });
    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_abc", status: "PENDING" },
    });

    await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });
    await createCheckout({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      amountCents: 2500,
      deviceId: "device:LOBBY",
      referenceId: TICKET_ID,
    });

    const expectedKey = buildIdempotencyKey(TICKET_ID, PAYMENT_ID);
    const ordersKey = (fakeOrdersCreate.mock.calls[0][0] as { idempotencyKey: string })
      .idempotencyKey;
    const checkoutKey = (fakeCreate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    expect(ordersKey).toBe(expectedKey);
    expect(checkoutKey).toBe(expectedKey);
    expect(ordersKey.length).toBe(32);
    expect(ordersKey).toMatch(/^[a-f0-9]{32}$/);
  });

  it("omits discounts entirely from the order body when there are no discounts", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValueOnce({
      order: { id: "ord_abc", version: 1 },
    });

    await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Classic manicure",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });

    const callArg = fakeOrdersCreate.mock.calls[0][0] as {
      order: Record<string, unknown>;
    };
    expect("discounts" in callArg.order).toBe(false);
  });

  // -------------------------------------------------------------------
  // T016 (US3 / Phase 5) — totals math. Two services + a targeted
  // discount: the helper's emitted lineItems and discounts must sum to
  // the same `ticket.total_cents` that Tang Nails computed locally
  // (FR-004 / SC-004). This is the only piece of the totals contract we
  // can verify without round-tripping through Square; the e2e specs
  // cover the wire-level total in the integration layer.
  // -------------------------------------------------------------------
  it("(h) two services ($45 + $60) - targeted -$10.50 discount → helper math equals 9450 cents", async () => {
    const { mapTicketItemsToOrderLineItems } = await import("@/lib/square/orders");

    const result = mapTicketItemsToOrderLineItems([
      {
        id: SERVICE_A,
        kind: "service",
        name_snapshot: "Service A",
        unit_price_cents: 4500,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        id: SERVICE_B,
        kind: "service",
        name_snapshot: "Service B",
        unit_price_cents: 6000,
        qty: 1,
        discount_target_line_ids: null,
      },
      {
        // Stored as negative magnitude per DB convention; helper takes
        // `Math.abs(...)` before emitting the Square positive amount.
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        kind: "discount",
        name_snapshot: "Discount",
        unit_price_cents: -1050,
        qty: 1,
        discount_target_line_ids: [SERVICE_A],
      },
    ]);

    const lineItemsTotal = result.lineItems.reduce(
      (sum, li) => sum + li.basePriceMoney.amount * BigInt(li.quantity),
      BigInt(0)
    );
    const discountsTotal = (result.discounts ?? []).reduce(
      (sum, d) => sum + d.amountMoney.amount,
      BigInt(0)
    );
    expect(lineItemsTotal - discountsTotal).toBe(BigInt(9450));
  });

  // -------------------------------------------------------------------
  // T017 (US3 / Phase 5) — regression guard. Every `orders.create` call
  // MUST include `taxes: []`, `pricingOptions.autoApplyTaxes: false`,
  // and `pricingOptions.autoApplyDiscounts: false` so Square can't
  // silently inflate the total beyond what Tang Nails computed (US3 AS2
  // / Research R2 / FR-005). The earlier `(Research R2)` case covers
  // one shape; this case fans the assertion over multiple invocations
  // so a future refactor that toggles auto-apply on one branch fails
  // fast.
  // -------------------------------------------------------------------
  it("(US3 regression guard) every orders.create body has taxes: [] + pricingOptions auto-apply flags off", async () => {
    const { createOrder } = await import("@/lib/square/orders");

    fakeOrdersCreate.mockResolvedValue({
      order: { id: "ord_abc", version: 1 },
    });

    // Run a couple of invocations with different ticket shapes so the
    // assertion fans across `mock.calls`.
    await createOrder({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Service A",
          unit_price_cents: 2500,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });
    await createOrder({
      ticketId: TICKET_ID,
      paymentId: "33333333-3333-3333-3333-333333333333",
      locationId: "L_MAIN",
      ticketItems: [
        {
          id: SERVICE_A,
          kind: "service",
          name_snapshot: "Service A",
          unit_price_cents: 4500,
          qty: 1,
          discount_target_line_ids: null,
        },
        {
          id: SERVICE_B,
          kind: "service",
          name_snapshot: "Service B",
          unit_price_cents: 6000,
          qty: 1,
          discount_target_line_ids: null,
        },
      ],
    });

    expect(fakeOrdersCreate.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fakeOrdersCreate.mock.calls) {
      const arg = call[0] as {
        order: {
          taxes: unknown[];
          pricingOptions: { autoApplyTaxes: boolean; autoApplyDiscounts: boolean };
        };
      };
      expect(arg.order.taxes).toEqual([]);
      expect(arg.order.pricingOptions.autoApplyTaxes).toBe(false);
      expect(arg.order.pricingOptions.autoApplyDiscounts).toBe(false);
    }
  });
});

describe("lib/square/terminal — createCheckout orderId branch (US1)", () => {
  beforeEach(() => {
    fakeCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const TICKET_ID = "11111111-1111-1111-1111-111111111111";
  const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";

  it("(g) split-tender (no orderId) → checkout sent with amountMoney and no orderId", async () => {
    const { createCheckout } = await import("@/lib/square/terminal");

    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_split", status: "PENDING" },
    });

    await createCheckout({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      amountCents: 2500,
      deviceId: "device:LOBBY",
      referenceId: TICKET_ID,
    });

    const callArg = fakeCreate.mock.calls[0][0] as {
      checkout: { amountMoney?: unknown; orderId?: unknown };
    };
    expect(callArg.checkout.amountMoney).toEqual({ amount: BigInt(2500), currency: "USD" });
    expect(callArg.checkout.orderId).toBeUndefined();
  });

  it("single-tender (orderId set) → checkout sent with orderId + amountMoney (Square v44 SDK requires the cross-checked total)", async () => {
    const { createCheckout } = await import("@/lib/square/terminal");

    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_single", status: "PENDING" },
    });

    await createCheckout({
      ticketId: TICKET_ID,
      paymentId: PAYMENT_ID,
      amountCents: 2500,
      deviceId: "device:LOBBY",
      referenceId: TICKET_ID,
      orderId: "ord_abc",
    });

    const callArg = fakeCreate.mock.calls[0][0] as {
      checkout: { amountMoney?: unknown; orderId?: unknown; referenceId?: string };
    };
    expect(callArg.checkout.orderId).toBe("ord_abc");
    // Square v44 SDK requires amountMoney; the Order id is what makes the
    // terminal screen + receipts render line items.
    expect(callArg.checkout.amountMoney).toEqual({ amount: BigInt(2500), currency: "USD" });
    expect(callArg.checkout.referenceId).toBe(TICKET_ID);
  });
});
