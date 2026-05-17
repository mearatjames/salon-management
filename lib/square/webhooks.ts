// lib/square/webhooks.ts
//
// Square webhook utilities — four exports:
//   - verifySignature             — HMAC-SHA256 check (Phase 2)
//   - parseEvent                  — defensive JSON parse + minimal shape coercion
//   - handleTerminalCheckoutUpdated — routes terminal.checkout.updated events
//   - handlePaymentUpdated        — routes payment.updated (gift-card) events
//
// SERVER-ONLY. The handler in `app/api/webhooks/square/route.ts` imports
// this; it must never reach the client bundle.
//
// See contracts/webhooks.contract.md §§ 3, 4 for the event matrix and the
// idempotency invariants the handler enforces.

import crypto from "node:crypto";

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

/**
 * Verify a Square webhook signature.
 *
 * Algorithm (per contracts/webhooks.contract.md § 2):
 *   expected = base64( HMAC_SHA256( signature_key, notification_url + raw_body ) )
 *   timingSafeEqual(Buffer.from(expected), Buffer.from(signature_header))
 *
 * Returns `false` (never throws) when:
 *   - `signatureHeader` is null (header missing)
 *   - The computed and provided signatures differ in length
 *     (`timingSafeEqual` throws on length mismatch; we guard up front)
 *   - The constant-time compare reports inequality
 *
 * @param rawBody          The unparsed JSON request body, exactly as Square sent it.
 *                         Re-serializing through `JSON.stringify(JSON.parse(body))`
 *                         would re-order keys and break the HMAC.
 * @param signatureHeader  Value of the `x-square-hmacsha256-signature` request header.
 * @param signatureKey     The signature key from the Square dashboard
 *                         (`SQUARE_WEBHOOK_SIGNATURE_KEY`).
 * @param notificationUrl  The public URL Square POSTs to; for the prod handler
 *                         this is `request.url`. Tests use a known fixture URL.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  signatureKey: string,
  notificationUrl: string
): boolean {
  if (signatureHeader === null) return false;

  const expected = crypto
    .createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64");

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// ---------------------------------------------------------------------
// Event parsing — minimal, defensive.
// ---------------------------------------------------------------------

export type SquareTerminalCheckoutEvent = {
  merchant_id: string;
  type: "terminal.checkout.updated";
  event_id: string;
  created_at: string;
  data: {
    type: "checkout";
    id: string;
    object: {
      checkout: {
        id: string;
        status: string;
        reference_id?: string;
        payment_ids?: string[];
        amount_money?: { amount?: number; currency?: string };
        tip_money?: { amount?: number; currency?: string };
        device_options?: { device_id?: string };
      };
    };
  };
};

export type SquarePaymentUpdatedEvent = {
  merchant_id: string;
  type: "payment.updated";
  event_id: string;
  created_at: string;
  data: {
    type: "payment";
    id: string;
    object: {
      payment: {
        id: string;
        status: "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED" | string;
        source_type?: "CARD" | "GIFT_CARD" | "WALLET" | string;
        amount_money?: { amount?: number | bigint; currency?: string };
        tip_money?: { amount?: number | bigint; currency?: string };
        reference_id?: string;
        source_id?: string;
        gift_card_details?: {
          gan_source?: string;
          state?: "ACTIVE" | "PENDING" | "BLOCKED" | "DEACTIVATED" | string;
          balance_money?: { amount?: number | bigint };
        };
      };
    };
  };
};

export type SquareWebhookEvent =
  | SquareTerminalCheckoutEvent
  | SquarePaymentUpdatedEvent
  | { type: string; [k: string]: unknown };

/**
 * Parse a Square webhook body. Returns `null` on JSON parse failure or
 * obviously-malformed envelopes (missing `type`, missing `merchant_id`,
 * etc). Callers translate `null` to HTTP 400.
 *
 * We deliberately keep the shape coercion shallow — Square is a trusted
 * source and the signature check has already passed; defensive coercion
 * here is about catching wire-format regressions, not adversarial input.
 */
export function parseEvent(jsonString: string): SquareWebhookEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== "string" || typeof obj.merchant_id !== "string") return null;
  return obj as SquareWebhookEvent;
}

// ---------------------------------------------------------------------
// handleTerminalCheckoutUpdated — routes per contracts § 3 event matrix.
// ---------------------------------------------------------------------

export class MerchantMismatchError extends Error {
  readonly code = "MERCHANT_MISMATCH" as const;
  constructor(message = "webhook merchant_id does not match connected square_oauth.merchant_id") {
    super(message);
    this.name = "MerchantMismatchError";
  }
}

export type HandlerResult =
  | { ok: true; ignored?: false }
  | { ok: true; ignored: true; reason: string };

/**
 * Route a `terminal.checkout.updated` event per the contract.
 *
 * Statuses that produce a DB write:
 *   - COMPLETED → pos_record_card_payment(succeeded)
 *   - CANCELED  → pos_record_card_payment(failed, cancelled_by_operator)
 *
 * Statuses that no-op (200 OK):
 *   - PENDING, IN_PROGRESS, CANCEL_REQUESTED
 *
 * Cross-merchant: throws MerchantMismatchError → caller returns 401.
 *
 * Unknown checkout (no payments row with this square_terminal_checkout_id):
 *   - returns { ok: true, ignored: true, reason: 'unknown_checkout' }
 *   - logs at warn level (helps diagnose stray webhooks from prior
 *     installations or revoked tokens).
 *
 * Idempotency: the RPC enforces `status='pending'` predicate. Calling
 * twice with the same event is safe — second call short-circuits.
 */
export async function handleTerminalCheckoutUpdated(
  event: SquareWebhookEvent
): Promise<HandlerResult> {
  if (event.type !== "terminal.checkout.updated") {
    return { ok: true, ignored: true, reason: "unsupported_event_type" };
  }

  const terminalEvent = event as SquareTerminalCheckoutEvent;
  const supabase = createSupabaseServiceRoleClient();

  // Merchant-id check: defense-in-depth against a misconfigured Square
  // dashboard pointing at our endpoint with someone else's webhook.
  const { data: oauthRow } = await supabase
    .from("square_oauth")
    .select("merchant_id")
    .eq("id", true)
    .maybeSingle();
  if (oauthRow && oauthRow.merchant_id !== terminalEvent.merchant_id) {
    throw new MerchantMismatchError();
  }

  const checkout = terminalEvent.data?.object?.checkout;
  if (!checkout) {
    return { ok: true, ignored: true, reason: "malformed_checkout" };
  }

  const status = checkout.status;
  const checkoutId = checkout.id;

  // No-op statuses.
  if (status === "PENDING" || status === "IN_PROGRESS" || status === "CANCEL_REQUESTED") {
    return { ok: true, ignored: true, reason: `noop_status_${status.toLowerCase()}` };
  }

  if (status !== "COMPLETED" && status !== "CANCELED") {
    return { ok: true, ignored: true, reason: `unknown_status_${status}` };
  }

  // Lookup the payment row by terminal checkout id.
  const { data: paymentRow, error: lookupErr } = await supabase
    .from("payments")
    .select("id, status")
    .eq("square_terminal_checkout_id", checkoutId)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`handleTerminalCheckoutUpdated: payment lookup failed: ${lookupErr.message}`);
  }
  if (!paymentRow) {
    console.warn("square.webhook: unknown checkout", { checkout_id: checkoutId, status });
    return { ok: true, ignored: true, reason: "unknown_checkout" };
  }

  const tipCents = checkout.tip_money?.amount ?? 0;
  const squarePaymentId = checkout.payment_ids?.[0] ?? null;
  const raw = checkout as unknown as Record<string, unknown>;

  // The generated RPC argument types are inferred as non-nullable strings
  // by the Supabase typegen even though Postgres accepts NULL for
  // p_square_payment_id + p_failure_reason. Cast to bypass — the runtime
  // contract is correct.
  type CardPaymentArgs = {
    p_payment_id: string;
    p_new_status: "pending" | "succeeded" | "failed";
    p_tip_cents: number;
    p_square_payment_id: string | null;
    p_raw: unknown;
    p_failure_reason: string | null;
  };

  if (status === "COMPLETED") {
    const args: CardPaymentArgs = {
      p_payment_id: paymentRow.id,
      p_new_status: "succeeded",
      p_tip_cents: tipCents,
      p_square_payment_id: squarePaymentId,
      p_raw: raw,
      p_failure_reason: null,
    };
    const { error: rpcErr } = await supabase.rpc(
      "pos_record_card_payment",
      args as unknown as Parameters<typeof supabase.rpc<"pos_record_card_payment">>[1]
    );
    if (rpcErr) {
      throw new Error(`pos_record_card_payment(succeeded) failed: ${rpcErr.message}`);
    }
    return { ok: true };
  }

  // status === 'CANCELED'
  const cancelArgs: CardPaymentArgs = {
    p_payment_id: paymentRow.id,
    p_new_status: "failed",
    p_tip_cents: 0,
    p_square_payment_id: null,
    p_raw: raw,
    p_failure_reason: "cancelled_by_operator",
  };
  const { error: rpcErr } = await supabase.rpc(
    "pos_record_card_payment",
    cancelArgs as unknown as Parameters<typeof supabase.rpc<"pos_record_card_payment">>[1]
  );
  if (rpcErr) {
    throw new Error(`pos_record_card_payment(failed) failed: ${rpcErr.message}`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// handlePaymentUpdated — routes payment.updated events for GIFT_CARD
// payments per contracts/webhooks.contract.md § 3.
//
// Feature 018 — Gift Card Redemption & Split-Tender Checkout.
//
// Flow:
//   1) narrow event type (`payment.updated`); else ignored.
//   2) merchant-id check (throws MerchantMismatchError → 401).
//   3) source-type guard: skip non-GIFT_CARD payments — card-on-terminal
//      payments arrive via terminal.checkout.updated and are handled by
//      `handleTerminalCheckoutUpdated`.
//   4) status routing:
//        APPROVED / PENDING → noop (return ignored).
//        COMPLETED          → pos_record_gift_payment(status='succeeded')
//        CANCELED / FAILED  → pos_record_gift_payment(status='failed',
//                                                     failure_reason)
//        other              → ignored.
//   5) lookup local payment row by `square_gift_card_payment_id =
//      payment.id`; if missing, ignored with warn-log (helps diagnose
//      stray events).
//
// Idempotency: the RPC's `status='pending'` predicate makes a replayed
// COMPLETED event a noop on a non-pending row; the unique partial index
// `payments_unique_succeeded_gift_card_payment_idx` is the DB backstop.
// ---------------------------------------------------------------------

export async function handlePaymentUpdated(event: SquareWebhookEvent): Promise<HandlerResult> {
  if (event.type !== "payment.updated") {
    return { ok: true, ignored: true, reason: "unsupported_event_type" };
  }

  const paymentEvent = event as SquarePaymentUpdatedEvent;
  const supabase = createSupabaseServiceRoleClient();

  // Merchant-id check — defense-in-depth.
  const { data: oauthRow } = await supabase
    .from("square_oauth")
    .select("merchant_id")
    .eq("id", true)
    .maybeSingle();
  if (oauthRow && oauthRow.merchant_id !== paymentEvent.merchant_id) {
    throw new MerchantMismatchError();
  }

  const payment = paymentEvent.data?.object?.payment;
  if (!payment) {
    return { ok: true, ignored: true, reason: "malformed_payment" };
  }

  // Source-type guard — only handle gift-card payments here.
  if (payment.source_type !== "GIFT_CARD") {
    return { ok: true, ignored: true, reason: "non_gift_card_payment" };
  }

  const status = payment.status;

  // No-op statuses — Square will send a follow-up event when settlement
  // resolves.
  if (status === "APPROVED" || status === "PENDING") {
    return { ok: true, ignored: true, reason: `noop_status_${status.toLowerCase()}` };
  }

  if (status !== "COMPLETED" && status !== "CANCELED" && status !== "FAILED") {
    return { ok: true, ignored: true, reason: `unknown_status_${status}` };
  }

  // Lookup the local payment row by Square Payment id.
  const { data: paymentRow, error: lookupErr } = await supabase
    .from("payments")
    .select("id, status")
    .eq("square_gift_card_payment_id", payment.id)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`handlePaymentUpdated: payment lookup failed: ${lookupErr.message}`);
  }
  if (!paymentRow) {
    console.warn("square.webhook: unknown gift-card payment", {
      square_payment_id: payment.id,
      status,
    });
    return { ok: true, ignored: true, reason: "unknown_gift_card_payment" };
  }

  const squareGiftCardId = payment.source_id ?? "";
  const raw = payment as unknown as Record<string, unknown>;

  type GiftPaymentArgs = {
    p_payment_id: string;
    p_new_status: "pending" | "succeeded" | "failed";
    p_square_gift_card_id: string;
    p_square_payment_id: string;
    p_raw: unknown;
    p_failure_reason: string | null;
  };

  if (status === "COMPLETED") {
    const args: GiftPaymentArgs = {
      p_payment_id: paymentRow.id,
      p_new_status: "succeeded",
      p_square_gift_card_id: squareGiftCardId,
      p_square_payment_id: payment.id,
      p_raw: raw,
      p_failure_reason: null,
    };
    const { error: rpcErr } = await supabase.rpc(
      "pos_record_gift_payment",
      args as unknown as Parameters<typeof supabase.rpc<"pos_record_gift_payment">>[1]
    );
    if (rpcErr) {
      throw new Error(`pos_record_gift_payment(succeeded) failed: ${rpcErr.message}`);
    }
    return { ok: true };
  }

  // status === 'CANCELED' or 'FAILED'
  const failureReason = status === "CANCELED" ? "cancelled_at_square" : "square_payment_failed";
  const failArgs: GiftPaymentArgs = {
    p_payment_id: paymentRow.id,
    p_new_status: "failed",
    p_square_gift_card_id: squareGiftCardId,
    p_square_payment_id: payment.id,
    p_raw: raw,
    p_failure_reason: failureReason,
  };
  const { error: rpcErr } = await supabase.rpc(
    "pos_record_gift_payment",
    failArgs as unknown as Parameters<typeof supabase.rpc<"pos_record_gift_payment">>[1]
  );
  if (rpcErr) {
    throw new Error(`pos_record_gift_payment(failed) failed: ${rpcErr.message}`);
  }
  return { ok: true };
}
