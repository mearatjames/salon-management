// @vitest-environment node

// Unit test for `submitGiftFromCart` Server Action (Feature 042 / T014 /
// contracts § Action 2). Promotes the in-memory ephemeral cart into a
// fully-paid gift-card ticket. The flow mirrors `submitCashFromCart`
// (insert ticket → bulk insert items → call gift-redemption RPC chain),
// but the gift RPCs are heavier:
//
//   1. `pos_compose_payment_draft` composes a draft gift leg whose
//      amount covers the full ticket.
//   2. The action then transitions the leg to 'pending' via
//      `payments.update(status='pending')` and calls Square's
//      `createGiftCardPayment` to charge the card. Square's webhook
//      eventually settles the leg to 'succeeded' via
//      `pos_record_gift_payment`.
//
// Constitution Principle IV — money paths are test-driven. Coverage:
//   - INVALID_CART for bad input (no DB touch).
//   - GIFT_NOT_FOUND when the GAN doesn't resolve to a Square card.
//   - GIFT_INSUFFICIENT_BALANCE when the card balance < total_cents.
//   - Happy path: ticket id returned, gift draft composed against the
//     freshly-inserted ticket, Square payment created.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/square/gift-cards", () => ({
  retrieveGiftCardFromGAN: vi.fn(),
  createGiftCardPayment: vi.fn(),
  getPayment: vi.fn(),
  last4MaskFromGAN: vi.fn((gan: string) => gan.replace(/\s/g, "").slice(-4)),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { retrieveGiftCardFromGAN, createGiftCardPayment } from "@/lib/square/gift-cards";

import { submitGiftFromCart } from "@/app/(studio)/checkout/actions";

const SERVICE_ID_1 = "20000000-0000-0000-0000-000000000001";
const TECH_ID = "30000000-0000-0000-0000-000000000001";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const NEW_TICKET_ID = "44444444-4444-4444-4444-444444444444";
const PAYMENT_ID = "55555555-5555-5555-5555-555555555555";
const GIFT_CARD_ID = "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa";
const SQUARE_GIFT_CARD_ID = "gtc_stub_active";
const GAN = "6000123456780001";

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: {
      id: STAFF_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

type ServiceRow = { id: string; name: string; price_cents: number; duration_min: number };

type Setup = {
  services?: ServiceRow[];
  /**
   * Behavior of `retrieveGiftCardFromGAN`:
   *   - "not_found" → submitGiftFromCart should return GIFT_NOT_FOUND.
   *   - "found" with balance below total → GIFT_INSUFFICIENT_BALANCE.
   *   - "found" with balance ≥ total → happy path.
   */
  lookupKind?: "found" | "not_found" | "zero_balance" | "not_redeemable";
  lookupBalanceCents?: number;
  /**
   * Whether `createGiftCardPayment` should resolve or throw.
   */
  squarePaymentFails?: boolean;
};

type InsertCall = { table: string; values: unknown };
type DeleteCall = { table: string; predicates: Array<{ col: string; val: unknown }> };

function setupClient(opts: Setup) {
  const services = opts.services ?? [
    { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
  ];
  const total = services.reduce((a, s) => a + s.price_cents, 0);

  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];

  (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const kind = opts.lookupKind ?? "found";
    if (kind === "not_found") {
      return { kind: "not_found" as const };
    }
    if (kind === "zero_balance") {
      return {
        kind: "zero_balance" as const,
        last4Mask: GAN.slice(-4),
        giftCardId: GIFT_CARD_ID,
        squareGiftCardId: SQUARE_GIFT_CARD_ID,
        state: "ACTIVE" as const,
      };
    }
    if (kind === "not_redeemable") {
      return {
        kind: "not_redeemable" as const,
        last4Mask: GAN.slice(-4),
        giftCardId: GIFT_CARD_ID,
        squareGiftCardId: SQUARE_GIFT_CARD_ID,
        state: "BLOCKED" as const,
      };
    }
    return {
      kind: "found" as const,
      last4Mask: GAN.slice(-4),
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: SQUARE_GIFT_CARD_ID,
      state: "ACTIVE" as const,
      balanceCents: opts.lookupBalanceCents ?? total,
    };
  });

  (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    if (opts.squarePaymentFails) throw new Error("square_unreachable");
    return { squareGiftCardPaymentId: "sqgift_stub_payment_id" };
  });

  const rpc = vi.fn(async (fn: string, _args?: unknown) => {
    void _args;
    if (fn === "pos_compose_payment_draft") {
      return { data: PAYMENT_ID, error: null };
    }
    if (fn === "pos_record_gift_payment") {
      // The webhook drives the actual settlement; the action stops at
      // activate. Return null so any accidental call surfaces in tests.
      return { data: null, error: { message: "unexpected pos_record_gift_payment call" } };
    }
    return { data: null, error: { message: "unexpected rpc " + fn } };
  });

  function fromFn(table: string) {
    if (table === "services") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: services, error: null })),
          })),
        })),
      };
    }
    if (table === "staff") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({ data: [{ id: TECH_ID }], error: null })),
            })),
          })),
        })),
      };
    }
    if (table === "customers") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    }
    if (table === "tickets") {
      return {
        insert: vi.fn((row: unknown) => {
          inserts.push({ table: "tickets", values: row });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: NEW_TICKET_ID }, error: null })),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: NEW_TICKET_ID, status: "open", total_cents: total },
              error: null,
            })),
            single: vi.fn(async () => ({
              data: { total_cents: total },
              error: null,
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "tickets", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    if (table === "ticket_items") {
      return {
        insert: vi.fn(async (rows: unknown) => {
          inserts.push({ table: "ticket_items", values: rows });
          return { error: null };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "ticket_items", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    if (table === "payments") {
      // The action transitions the draft to 'pending' via update.
      // Also: pre-flight in-flight scan, and post-Square persist of the
      // Square payment id. Track but don't write.
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
            // For activateGiftDraft's draft-row read:
            maybeSingle: vi.fn(async () => ({
              data: {
                id: PAYMENT_ID,
                ticket_id: NEW_TICKET_ID,
                method: "gift",
                status: "draft",
                amount_cents: total,
              },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(async () => ({ data: [{ id: PAYMENT_ID }], error: null })),
            })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "payments", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    return {};
  }

  const fromSpy = vi.fn(fromFn);

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from: fromSpy,
  });

  return { rpc, fromSpy, inserts, deletes };
}

function validCart(over: Partial<Record<string, unknown>> = {}) {
  return {
    customerId: null,
    techId: TECH_ID,
    items: [{ serviceId: SERVICE_ID_1, techId: TECH_ID, note: null }],
    discount: null,
    notes: null,
    ...over,
  };
}

describe("submitGiftFromCart — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns INVALID_CART for a malformed cart and never touches Square", async () => {
    const { fromSpy } = setupClient({});
    const bad = validCart({
      items: [{ serviceId: "not-a-uuid", techId: TECH_ID, note: null }],
    });
    const result = await submitGiftFromCart(
      bad as unknown as Parameters<typeof submitGiftFromCart>[0],
      "•••• 0001",
      GAN
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
    expect(retrieveGiftCardFromGAN).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("submitGiftFromCart — Square gift card lookup failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns GIFT_NOT_FOUND when the GAN doesn't resolve to a Square card and runs compensating deletes", async () => {
    const { deletes } = setupClient({ lookupKind: "not_found" });
    const result = await submitGiftFromCart(validCart(), "•••• 0001", GAN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("GIFT_NOT_FOUND");

    // Ticket + items were inserted but the lookup failed — they must
    // not be left behind.
    const items = deletes.find((d) => d.table === "ticket_items");
    const tk = deletes.find((d) => d.table === "tickets");
    expect(items).toBeDefined();
    expect(tk).toBeDefined();
  });

  it("returns GIFT_INSUFFICIENT_BALANCE when card balance < total_cents and compensates", async () => {
    const { deletes } = setupClient({
      lookupKind: "found",
      lookupBalanceCents: 100, // $1 < $25 service total
    });
    const result = await submitGiftFromCart(validCart(), "•••• 0001", GAN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("GIFT_INSUFFICIENT_BALANCE");

    const items = deletes.find((d) => d.table === "ticket_items");
    const tk = deletes.find((d) => d.table === "tickets");
    expect(items).toBeDefined();
    expect(tk).toBeDefined();
  });
});

describe("submitGiftFromCart — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("inserts ticket + items, composes gift draft against new ticket id, calls Square, returns ok", async () => {
    const { rpc, inserts } = setupClient({});
    const result = await submitGiftFromCart(validCart(), "•••• 0001", GAN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketId).toBe(NEW_TICKET_ID);

    // Insert order: ticket → items → compose draft RPC → Square.
    const tk = inserts.find((i) => i.table === "tickets");
    const items = inserts.find((i) => i.table === "ticket_items");
    expect(tk).toBeDefined();
    expect(items).toBeDefined();
    expect((tk!.values as Record<string, unknown>).status).toBe("open");

    // pos_compose_payment_draft called with the freshly-inserted ticket id.
    const composeCalls = rpc.mock.calls.filter((c) => c[0] === "pos_compose_payment_draft");
    expect(composeCalls).toHaveLength(1);
    const composeArgs = composeCalls[0][1] as Record<string, unknown>;
    expect(composeArgs.p_ticket_id).toBe(NEW_TICKET_ID);
    expect(composeArgs.p_method).toBe("gift");

    // Square charge was attempted.
    expect(createGiftCardPayment).toHaveBeenCalledTimes(1);
    const sqArgs = (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sqArgs.ticketId).toBe(NEW_TICKET_ID);
    expect(sqArgs.paymentId).toBe(PAYMENT_ID);
  });
});
