// @vitest-environment node

// Unit test for `redeemGiftCardWholeTicket`. Covers both the full-balance
// branch (landed in US1) and the partial-coverage branch (US3 / T050).
//
// Full-balance branch:
//   - Happy path: $40 ticket + ACTIVE $60 card → returns
//     `{kind: 'fully_paid', paymentId, ticketFlippedToPaid: true}`.
//   - lookup_zero_balance / lookup_not_redeemable / lookup_not_found exits
//     return the lookup_* shapes without creating any payment row.
//
// Partial-balance branch (US3 / T049 + T050):
//   - $40 ticket + ACTIVE $15 card → activates the gift leg for $15 and
//     returns `{kind: 'partial_split', paymentId, nextLegAmountCents: 2500}`.
//     The test asserts that ONLY ONE payment row is inserted (the gift
//     leg via pos_compose_payment_draft); the client drives the second-
//     leg method-pick + composeDraftLeg round-trip — the server does NOT
//     synthesise a second draft row in redeemGiftCardWholeTicket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/square/gift-cards", () => ({
  retrieveGiftCardFromGAN: vi.fn(),
  createGiftCardPayment: vi.fn(),
  getPayment: vi.fn(),
  last4MaskFromGAN: vi.fn((gan: string) => gan.replace(/\s/g, "").slice(-4)),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { retrieveGiftCardFromGAN, createGiftCardPayment } from "@/lib/square/gift-cards";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const GIFT_CARD_ID = "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";

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

type TicketRow = {
  id: string;
  status: "open" | "paid" | "discarded";
  total_cents: number;
};

function setupClient({
  ticket,
  inFlightLeg,
  succeededSum,
  paymentDraftRow,
}: {
  ticket: TicketRow;
  inFlightLeg?: boolean;
  succeededSum?: number;
  paymentDraftRow?: {
    id: string;
    ticket_id: string;
    method: "gift";
    status: "draft";
    amount_cents: number;
  };
}) {
  const insertedPaymentRows: Array<Record<string, unknown>> = [];
  const updateCalls: Array<{
    values: Record<string, unknown>;
    predicates: Array<{ k: string; v: unknown }>;
    settled: boolean;
  }> = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  const rpc = vi.fn(async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    if (fn === "pos_compose_payment_draft") {
      return { data: PAYMENT_ID, error: null };
    }
    return { data: null, error: null };
  });

  // Build the supabase chain for the `payments` table on every call so each
  // `.select(...)` resolves to a fresh predicate-tracking chain. The
  // predicates determine which mock data we return at the terminal node.
  function paymentsTable() {
    return {
      select: vi.fn((cols?: string) => {
        const predicates: Array<{ k: string; v: unknown }> = [];
        const cs = cols ?? "";
        const chain = {
          eq: vi.fn((k: string, v: unknown) => {
            predicates.push({ k, v });
            return chain;
          }),
          limit: vi.fn(async () => {
            // The in-flight check uses .select('id').eq('ticket_id',X).eq('status','pending').limit(1)
            const isPendingCheck = predicates.some((p) => p.k === "status" && p.v === "pending");
            if (isPendingCheck) {
              return {
                data: inFlightLeg ? [{ id: "in-flight" }] : [],
                error: null,
              };
            }
            // drafts read used by discardDraftLegs.
            const isDraftsCheck = predicates.some((p) => p.k === "status" && p.v === "draft");
            if (isDraftsCheck) {
              return { data: [], error: null };
            }
            return { data: [], error: null };
          }),
          maybeSingle: vi.fn(async () => {
            // activateGiftDraft loads the draft row via .select(...).eq('id',X).maybeSingle().
            const byId = predicates.find((p) => p.k === "id");
            if (byId) {
              return { data: paymentDraftRow ?? null, error: null };
            }
            return { data: null, error: null };
          }),
          // The remaining-owed read: .select('amount_cents,status').eq('ticket_id',X).eq('status','succeeded')
          // — terminal node is the await directly (then-able).
          then: undefined as unknown,
        };
        (chain as unknown as { then: PromiseLike<unknown>["then"] }).then = (resolve) => {
          // Await on the chain: this happens only for the succeeded-sum read.
          if (cs.includes("amount_cents") && cs.includes("status")) {
            return Promise.resolve({
              data: succeededSum != null ? [{ amount_cents: succeededSum }] : [],
              error: null,
            }).then(resolve as never);
          }
          // drafts read with .select('id, method, amount_cents') from discardDraftLegs.
          if (cs.includes("id") && cs.includes("method") && cs.includes("amount_cents")) {
            return Promise.resolve({ data: [], error: null }).then(resolve as never);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve as never);
        };
        return chain;
      }),
      insert: vi.fn((vals: Record<string, unknown>) => {
        insertedPaymentRows.push(vals);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: PAYMENT_ID, ...vals },
              error: null,
            })),
          })),
        };
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        const predicates: Array<{ k: string; v: unknown }> = [];
        const entry = { values, predicates, settled: false };
        const chain = {
          eq: vi.fn((k: string, v: unknown) => {
            predicates.push({ k, v });
            return chain;
          }),
          select: vi.fn(async () => {
            if (!entry.settled) {
              entry.settled = true;
              updateCalls.push(entry);
            }
            // The atomic draft → pending transition: returns the row.
            const newRow = paymentDraftRow
              ? { ...paymentDraftRow, ...values }
              : { id: PAYMENT_ID, ...values };
            return { data: [newRow], error: null };
          }),
          then: undefined as unknown,
        };
        (chain as unknown as { then: PromiseLike<unknown>["then"] }).then = (resolve) => {
          if (!entry.settled) {
            entry.settled = true;
            updateCalls.push(entry);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve as never);
        };
        return chain;
      }),
      delete: vi.fn(() => {
        const chain = {
          eq: vi.fn(() => chain),
          then: undefined as unknown,
        };
        (chain as unknown as { then: PromiseLike<unknown>["then"] }).then = (resolve) =>
          Promise.resolve({ data: null, error: null }).then(resolve as never);
        return chain;
      }),
    };
  }

  function ticketsTable() {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: ticket, error: null })),
          single: vi.fn(async () => ({ data: ticket, error: null })),
        })),
      })),
    };
  }

  const from = vi.fn((table: string) => {
    if (table === "tickets") return ticketsTable();
    if (table === "payments") return paymentsTable();
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from,
    rpc,
  });

  return { insertedPaymentRows, updateCalls, rpcCalls };
}

describe("redeemGiftCardWholeTicket — full-balance branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {kind: 'fully_paid', ticketFlippedToPaid: true} on $40 ticket + ACTIVE $60 card", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "found",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_0001",
      last4Mask: "0001",
      balanceCents: 6000,
      state: "ACTIVE",
    });
    (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      squareGiftCardPaymentId: "pay_gc_OK",
      status: "COMPLETED",
    });

    setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 4000 },
      paymentDraftRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "gift",
        status: "draft",
        amount_cents: 4000,
      },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 0001");

    expect(result.kind).toBe("fully_paid");
    if (result.kind !== "fully_paid") throw new Error("type guard");
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.ticketFlippedToPaid).toBe(true);
  });

  it("returns {kind: 'lookup_zero_balance'} without creating a payment row", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "zero_balance",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_0000",
      last4Mask: "0000",
      balanceCents: 0,
      state: "ACTIVE",
    });

    const { insertedPaymentRows, rpcCalls } = setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 0000");

    expect(result.kind).toBe("lookup_zero_balance");
    if (result.kind !== "lookup_zero_balance") throw new Error("type guard");
    expect(result.last4Mask).toBe("0000");
    expect(insertedPaymentRows).toHaveLength(0);
    expect(rpcCalls.some((c) => c.fn === "pos_compose_payment_draft")).toBe(false);
    expect(createGiftCardPayment).not.toHaveBeenCalled();
  });

  it("returns {kind: 'lookup_not_redeemable', state} for BLOCKED cards", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "not_redeemable",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_BLKD",
      last4Mask: "BLKD",
      state: "BLOCKED",
    });

    const { insertedPaymentRows, rpcCalls } = setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 BLKD");

    expect(result.kind).toBe("lookup_not_redeemable");
    if (result.kind !== "lookup_not_redeemable") throw new Error("type guard");
    expect(result.last4Mask).toBe("BLKD");
    expect(result.state).toBe("BLOCKED");
    expect(insertedPaymentRows).toHaveLength(0);
    expect(rpcCalls.some((c) => c.fn === "pos_compose_payment_draft")).toBe(false);
  });

  it("returns {kind: 'lookup_not_found'} when Square cannot find the card", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "not_found",
    });

    const { insertedPaymentRows, rpcCalls } = setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 9999");

    expect(result.kind).toBe("lookup_not_found");
    expect(insertedPaymentRows).toHaveLength(0);
    expect(rpcCalls.some((c) => c.fn === "pos_compose_payment_draft")).toBe(false);
  });
});

describe("redeemGiftCardWholeTicket — partial-balance branch (US3 / T050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {kind: 'partial_split', nextLegAmountCents: 2500} on $40 ticket + ACTIVE $15 card; composes exactly ONE payment draft (the gift leg)", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "found",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_0002",
      last4Mask: "0002",
      balanceCents: 1500,
      state: "ACTIVE",
    });
    (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      squareGiftCardPaymentId: "pay_gc_PARTIAL",
      status: "COMPLETED",
    });

    const { rpcCalls } = setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 4000 },
      paymentDraftRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "gift",
        status: "draft",
        amount_cents: 1500,
      },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 0002");

    expect(result.kind).toBe("partial_split");
    if (result.kind !== "partial_split") throw new Error("type guard");
    expect(result.paymentId).toBe(PAYMENT_ID);
    // remainingOwed (4000) - amountToCharge (1500) = 2500
    expect(result.nextLegAmountCents).toBe(2500);

    // Exactly one compose-draft RPC call (the gift leg). No second draft
    // synthesised server-side — the client owns the method-pick flow.
    const composeCalls = rpcCalls.filter((c) => c.fn === "pos_compose_payment_draft");
    expect(composeCalls).toHaveLength(1);
    const composeArgs = composeCalls[0]!.args as { p_method: string; p_amount: number };
    expect(composeArgs.p_method).toBe("gift");
    expect(composeArgs.p_amount).toBe(1500);

    // Square gift-card payment was created for exactly the available
    // balance (not the full ticket amount).
    expect(createGiftCardPayment).toHaveBeenCalledTimes(1);
  });

  it("computed remainingOwed accounts for prior succeeded legs (cart 'owes' is total_cents - sum(succeeded))", async () => {
    // Setup: $50 ticket, prior $10 succeeded leg, ACTIVE $15 gift card.
    // remainingOwed = 50 - 10 = 40. amountToCharge = min(15, 40) = 15.
    // nextLegAmountCents = 40 - 15 = 25.
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "found",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_0002",
      last4Mask: "0002",
      balanceCents: 1500,
      state: "ACTIVE",
    });
    (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      squareGiftCardPaymentId: "pay_gc_PARTIAL_PRIOR",
      status: "COMPLETED",
    });

    setupClient({
      ticket: { id: TICKET_ID, status: "open", total_cents: 5000 },
      succeededSum: 1000,
      paymentDraftRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "gift",
        status: "draft",
        amount_cents: 1500,
      },
    });

    const { redeemGiftCardWholeTicket } = await import("@/app/(studio)/checkout/actions");
    const result = await redeemGiftCardWholeTicket(TICKET_ID, "6000 1234 5678 0002");

    expect(result.kind).toBe("partial_split");
    if (result.kind !== "partial_split") throw new Error("type guard");
    expect(result.nextLegAmountCents).toBe(2500);
  });
});
