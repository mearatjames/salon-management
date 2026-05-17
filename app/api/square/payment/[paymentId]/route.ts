// app/api/square/payment/[paymentId]/route.ts
//
// GET /api/square/payment/[paymentId]
//
// Polling fallback for the gift-card waiting micro-state (feature 018).
// Returns the current local DB state of a gift-card payment row so the UI
// can advance to "redeemed" (or "failed") when the Supabase Realtime
// channel for `payment.updated` is delayed or dropped.
//
// Mirrors the shape of `/api/square/terminal-checkout/[id]` from feature
// 015 — reads local DB state ONLY. Never calls Square (the settlement
// signal already arrives via the webhook → `pos_record_gift_payment`).
//
// No lazy expiration here (unlike the card-on-terminal route): gift-card
// payments settle synchronously at Square; a long-lived `'pending'` row
// indicates a webhook delivery problem requiring operator escalation,
// not an abandoned customer interaction.
//
// Contract: contracts/api-routes.contract.md § 1.

import { NextResponse } from "next/server";

import { AuthRedirectError, requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GiftPaymentStateResponse = {
  paymentId: string;
  ticketId: string;
  method: "gift";
  status: "draft" | "pending" | "succeeded" | "failed";
  amountCents: number;
  squareGiftCardPaymentId: string | null;
  giftCardLast4Mask: string | null;
  failureReason: string | null;
  processedAt: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ paymentId: string }> }
): Promise<Response> {
  // Auth — defense in depth.
  try {
    await requireStudioSession();
  } catch (err) {
    if (err instanceof AuthRedirectError) {
      return new Response(null, { status: 401 });
    }
    throw err;
  }

  const { paymentId } = await context.params;
  if (!UUID_SHAPE.test(paymentId)) {
    return NextResponse.json(
      { ok: false, error: "payment_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: row, error } = await supabase
    .from("payments")
    .select(
      "id, ticket_id, method, status, amount_cents, square_gift_card_payment_id, failure_reason, processed_at, gift_card_id"
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    console.error("square.payment.poll: read failed", error);
    return NextResponse.json(
      { ok: false, error: "internal" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "payment_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (row.method !== "gift") {
    return NextResponse.json(
      { ok: false, error: "wrong_method" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Join the gift_cards row for the last4 mask (one extra read, kept
  // separate from the payments select for clarity; the mask is null when
  // the leg is still in 'draft' status).
  let giftCardLast4Mask: string | null = null;
  if (row.gift_card_id) {
    const { data: gc } = await supabase
      .from("gift_cards")
      .select("last4_mask")
      .eq("id", row.gift_card_id)
      .maybeSingle();
    giftCardLast4Mask = gc?.last4_mask ?? null;
  }

  const body: GiftPaymentStateResponse = {
    paymentId: row.id,
    ticketId: row.ticket_id,
    method: "gift",
    status: row.status as GiftPaymentStateResponse["status"],
    amountCents: row.amount_cents,
    squareGiftCardPaymentId: row.square_gift_card_payment_id,
    giftCardLast4Mask,
    failureReason: row.failure_reason,
    processedAt: row.processed_at,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
