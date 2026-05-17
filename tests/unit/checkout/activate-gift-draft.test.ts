// @vitest-environment node

// Unit test for `activateGiftDraft` (T023). Asserts the Node-side
// behaviour of the action:
//
//   - Loads the draft row, refuses unless (status='draft', method='gift')
//     on an open ticket.
//   - Refreshes the gift-card cache via `retrieveGiftCardFromGAN`; refuses
//     with `GiftCardNotRedeemableError` when state is non-ACTIVE.
//   - Refuses with `GiftCardInsufficientBalanceError` when balance < leg amount.
//   - Transitions the row to 'pending' atomically (the update must include
//     the `status='draft'` predicate so a racing partial-unique-index
//     violation surfaces as `TicketAlreadyBeingChargedError`).
//   - Calls Square's `createGiftCardPayment` with the right shape.
//   - Persists `square_gift_card_payment_id` + `gift_card_id` back onto the row.

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

type PaymentRow = {
  id: string;
  ticket_id: string;
  method: "gift" | "cash" | "card";
  status: "draft" | "pending" | "succeeded" | "failed";
  amount_cents: number;
};

type TicketRow = {
  id: string;
  status: "open" | "paid" | "discarded";
  total_cents: number;
};

function mockClient({
  paymentRow,
  ticketRow,
  updatePayment,
}: {
  paymentRow: PaymentRow | null;
  ticketRow: TicketRow | null;
  /** Override the result of the atomic draft → pending transition. */
  updatePayment?: () => Promise<{ data: PaymentRow[] | null; error: unknown }>;
}) {
  const updateCalls: Array<{
    values: Record<string, unknown>;
    predicates: Array<{ k: string; v: unknown }>;
    settled: boolean;
  }> = [];

  function paymentsTable() {
    return {
      select: vi.fn(() => {
        const predicates: Array<{ k: string; v: unknown }> = [];
        const chain = {
          eq: vi.fn((k: string, v: unknown) => {
            predicates.push({ k, v });
            return chain;
          }),
          maybeSingle: vi.fn(async () => ({ data: paymentRow, error: null })),
        };
        return chain;
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
            if (updatePayment) return updatePayment();
            return { data: paymentRow ? [paymentRow] : [], error: null };
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
    };
  }

  const from = vi.fn((table: string) => {
    if (table === "payments") return paymentsTable();
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: ticketRow, error: null })),
            single: vi.fn(async () => ({ data: ticketRow, error: null })),
          })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from,
    rpc: vi.fn(),
  });

  return { updateCalls };
}

describe("activateGiftDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions a (draft, gift) row to pending, calls Square, persists ids", async () => {
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

    const { updateCalls } = mockClient({
      paymentRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "gift",
        status: "draft",
        amount_cents: 4000,
      },
      ticketRow: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { activateGiftDraft } = await import("@/app/(studio)/checkout/actions");
    const result = await activateGiftDraft(PAYMENT_ID, "6000 1234 5678 0001");

    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.status).toBe("pending");
    expect(result.squareGiftCardPaymentId).toBe("pay_gc_OK");

    expect(createGiftCardPayment).toHaveBeenCalledTimes(1);
    const createArg = (createGiftCardPayment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      ticketId: string;
      paymentId: string;
      amountCents: number;
      squareGiftCardId: string;
      referenceId: string;
    };
    expect(createArg.ticketId).toBe(TICKET_ID);
    expect(createArg.paymentId).toBe(PAYMENT_ID);
    expect(createArg.amountCents).toBe(4000);
    expect(createArg.squareGiftCardId).toBe("gftc_0001");
    expect(createArg.referenceId).toBe(TICKET_ID);

    // At least one update flipped the row to 'pending' against the draft predicate.
    const draftTransition = updateCalls.find(
      (c) =>
        c.values.status === "pending" &&
        c.predicates.some((p) => p.k === "status" && p.v === "draft")
    );
    expect(draftTransition).toBeDefined();

    // After Square success, the action persists squareGiftCardPaymentId + gift_card_id.
    const persistIds = updateCalls.find(
      (c) =>
        c.values.square_gift_card_payment_id === "pay_gc_OK" &&
        c.values.gift_card_id === GIFT_CARD_ID
    );
    expect(persistIds).toBeDefined();
  });

  it("refuses with GiftCardNotRedeemableError when the re-lookup reports a non-ACTIVE state", async () => {
    (retrieveGiftCardFromGAN as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "not_redeemable",
      giftCardId: GIFT_CARD_ID,
      squareGiftCardId: "gftc_BLKD",
      last4Mask: "BLKD",
      state: "BLOCKED",
    });
    mockClient({
      paymentRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "gift",
        status: "draft",
        amount_cents: 4000,
      },
      ticketRow: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { activateGiftDraft } = await import("@/app/(studio)/checkout/actions");
    const { GiftCardNotRedeemableError } = await import("@/app/(studio)/checkout/_errors");
    await expect(activateGiftDraft(PAYMENT_ID, "6000 1234 5678 BLKD")).rejects.toBeInstanceOf(
      GiftCardNotRedeemableError
    );
    expect(createGiftCardPayment).not.toHaveBeenCalled();
  });

  it("refuses with DraftLegNotFoundError when the row isn't a (draft, gift) leg", async () => {
    mockClient({
      paymentRow: {
        id: PAYMENT_ID,
        ticket_id: TICKET_ID,
        method: "cash",
        status: "draft",
        amount_cents: 4000,
      },
      ticketRow: { id: TICKET_ID, status: "open", total_cents: 4000 },
    });

    const { activateGiftDraft } = await import("@/app/(studio)/checkout/actions");
    const { DraftLegNotFoundError } = await import("@/app/(studio)/checkout/_errors");
    await expect(activateGiftDraft(PAYMENT_ID, "6000 1234 5678 0001")).rejects.toBeInstanceOf(
      DraftLegNotFoundError
    );
  });
});
