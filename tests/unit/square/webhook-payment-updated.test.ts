// tests/unit/square/webhook-payment-updated.test.ts
//
// Unit coverage for `lib/square/webhooks.handlePaymentUpdated` (feature 018).
// Asserts:
//   - A `payment.updated` event with source_type='GIFT_CARD' + status COMPLETED
//     dispatches to `pos_record_gift_payment(p_new_status='succeeded')`.
//   - Replay of the same event a second time on a non-pending row no-ops
//     (the RPC's `status='pending'` predicate is upstream of this handler;
//     the handler itself surfaces the second call as ok+ignored OR re-dispatches
//     to the RPC which short-circuits — both behaviours preserve the
//     "exactly-once side effects" invariant).
//   - Merchant-id mismatch throws `MerchantMismatchError` (defense in depth).
//   - source_type != GIFT_CARD short-circuits to ignored (terminal payments
//     go through handleTerminalCheckoutUpdated, not this path).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const PAYMENT_ID = "22222222-2222-2222-2222-222222222222";
const SQUARE_PAYMENT_ID = "pay_gc_TEST_001";

type GiftPaymentArgs = {
  p_payment_id: string;
  p_new_status: "pending" | "succeeded" | "failed";
  p_square_gift_card_id: string;
  p_square_payment_id: string;
  p_raw: unknown;
  p_failure_reason: string | null;
};

type RpcCall = { fn: string; args: unknown };

function makeMockClient({
  oauthMerchantId,
  paymentRowStatus,
}: {
  oauthMerchantId: string;
  paymentRowStatus: "pending" | "succeeded" | null;
}) {
  const rpcCalls: RpcCall[] = [];
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
  });

  const from = vi.fn((table: string) => {
    if (table === "square_oauth") {
      // .select(...).eq('id', true).maybeSingle()
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { merchant_id: oauthMerchantId },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "payments") {
      // .select('id, status').eq('square_gift_card_payment_id', payment.id).maybeSingle()
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () =>
              paymentRowStatus === null
                ? { data: null, error: null }
                : {
                    data: { id: PAYMENT_ID, status: paymentRowStatus },
                    error: null,
                  }
            ),
          })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from,
  });

  return { rpcCalls };
}

function makeGiftCardCompletedEvent(merchantId = "MERCHANT_STUB"): {
  merchant_id: string;
  type: "payment.updated";
  event_id: string;
  created_at: string;
  data: {
    type: "payment";
    id: string;
    object: { payment: Record<string, unknown> };
  };
} {
  return {
    merchant_id: merchantId,
    type: "payment.updated",
    event_id: "evt_gift_001",
    created_at: new Date().toISOString(),
    data: {
      type: "payment",
      id: SQUARE_PAYMENT_ID,
      object: {
        payment: {
          id: SQUARE_PAYMENT_ID,
          status: "COMPLETED",
          source_type: "GIFT_CARD",
          source_id: "gftc_0001",
          amount_money: { amount: 4000, currency: "USD" },
          tip_money: { amount: 0, currency: "USD" },
          reference_id: TICKET_ID,
        },
      },
    },
  };
}

describe("lib/square/webhooks — handlePaymentUpdated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches GIFT_CARD COMPLETED → pos_record_gift_payment(succeeded)", async () => {
    const { rpcCalls } = makeMockClient({
      oauthMerchantId: "MERCHANT_STUB",
      paymentRowStatus: "pending",
    });
    const { handlePaymentUpdated } = await import("@/lib/square/webhooks");

    const result = await handlePaymentUpdated(makeGiftCardCompletedEvent());
    expect(result.ok).toBe(true);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("pos_record_gift_payment");
    const args = rpcCalls[0].args as GiftPaymentArgs;
    expect(args.p_payment_id).toBe(PAYMENT_ID);
    expect(args.p_new_status).toBe("succeeded");
    expect(args.p_square_payment_id).toBe(SQUARE_PAYMENT_ID);
    expect(args.p_square_gift_card_id).toBe("gftc_0001");
    expect(args.p_failure_reason).toBeNull();
  });

  it("merchant-id mismatch throws MerchantMismatchError", async () => {
    makeMockClient({
      oauthMerchantId: "MERCHANT_OURS",
      paymentRowStatus: "pending",
    });
    const { handlePaymentUpdated, MerchantMismatchError } = await import("@/lib/square/webhooks");

    const evil = makeGiftCardCompletedEvent("MERCHANT_OTHER");
    await expect(handlePaymentUpdated(evil)).rejects.toBeInstanceOf(MerchantMismatchError);
  });

  it("source_type !== GIFT_CARD short-circuits to ok+ignored (no RPC)", async () => {
    const { rpcCalls } = makeMockClient({
      oauthMerchantId: "MERCHANT_STUB",
      paymentRowStatus: "pending",
    });
    const { handlePaymentUpdated } = await import("@/lib/square/webhooks");

    const cardEvent = makeGiftCardCompletedEvent();
    (cardEvent.data.object.payment as Record<string, unknown>).source_type = "CARD";

    const result = await handlePaymentUpdated(cardEvent);
    expect(result.ok).toBe(true);
    if (!("ignored" in result) || !result.ignored) {
      throw new Error("expected ignored=true");
    }
    expect(result.reason).toBe("non_gift_card_payment");
    expect(rpcCalls).toHaveLength(0);
  });

  it("idempotent on replay: a second identical event re-dispatches; the RPC's status='pending' predicate is the gatekeeper", async () => {
    // Simulate a replayed event arriving after the row settled to succeeded.
    // The handler will look up the row, find it (status='succeeded'), and
    // re-dispatch to the RPC. The RPC's `status='pending'` predicate (covered
    // by the supabase/0011 migration and the e2e idempotency test) is the
    // source of truth. The handler MUST NOT add a duplicate side effect of
    // its own — exercised here by asserting the handler's return value is
    // a success regardless.
    const { rpcCalls } = makeMockClient({
      oauthMerchantId: "MERCHANT_STUB",
      paymentRowStatus: "succeeded",
    });
    const { handlePaymentUpdated } = await import("@/lib/square/webhooks");

    const result = await handlePaymentUpdated(makeGiftCardCompletedEvent());
    expect(result.ok).toBe(true);
    // The handler dispatches one RPC call; the RPC itself is the noop.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("pos_record_gift_payment");
  });

  it("unknown gift-card payment (no local row) → ok+ignored", async () => {
    const { rpcCalls } = makeMockClient({
      oauthMerchantId: "MERCHANT_STUB",
      paymentRowStatus: null,
    });
    const { handlePaymentUpdated } = await import("@/lib/square/webhooks");

    const result = await handlePaymentUpdated(makeGiftCardCompletedEvent());
    expect(result.ok).toBe(true);
    if (!("ignored" in result) || !result.ignored) {
      throw new Error("expected ignored=true");
    }
    expect(result.reason).toBe("unknown_gift_card_payment");
    expect(rpcCalls).toHaveLength(0);
  });
});
