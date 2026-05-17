// app/api/square/terminal-checkout/[id]/route.ts
//
// GET /api/square/terminal-checkout/[paymentId]
//
// Polling fallback for the card-waiting screen. The Supabase Realtime
// channel may be delayed or dropped; this endpoint returns the current
// state of a payment row so the UI can advance to Done (or Failed).
//
// Reads local DB state ONLY. Never calls Square (research R5) — the
// settlement signal already lives in the local row via the webhook
// handler.
//
// Lazy expiration: when a row has been `pending` for > 5 minutes, this
// endpoint marks it `failed/expired` before returning (FR-021a). The RPC
// is idempotent under concurrent expirations.
//
// Contract: contracts/api-routes.contract.md § 1.

import { NextResponse } from "next/server";

import { AuthRedirectError, requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PollResponse =
  | { status: "pending"; pollAgainAfterMs: 5000 }
  | { status: "succeeded"; tipCents: number }
  | {
      status: "failed";
      reason: "declined" | "device_offline" | "cancelled_by_operator" | "expired" | "unknown";
    };

function mapPollResponse(row: {
  status: string;
  tip_cents: number | null;
  failure_reason: string | null;
}): PollResponse {
  if (row.status === "pending") {
    return { status: "pending", pollAgainAfterMs: 5000 };
  }
  if (row.status === "succeeded") {
    return { status: "succeeded", tipCents: row.tip_cents ?? 0 };
  }
  const allowed = ["declined", "device_offline", "cancelled_by_operator", "expired"] as const;
  type FailReason = (typeof allowed)[number] | "unknown";
  const r = row.failure_reason;
  const reason: FailReason = (allowed as readonly string[]).includes(r ?? "")
    ? (r as FailReason)
    : "unknown";
  return { status: "failed", reason };
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
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

  const { id } = await context.params;
  if (!UUID_SHAPE.test(id)) {
    return NextResponse.json(
      { error: "payment_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data: row, error } = await supabase
    .from("payments")
    .select("id, method, status, tip_cents, failure_reason, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("terminal-checkout poll: read failed", error);
    return NextResponse.json(
      { error: "internal" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!row) {
    return NextResponse.json(
      { error: "payment_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (row.method !== "card") {
    return NextResponse.json(
      { error: "not_a_card_payment" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Lazy expiration: > 5 minutes pending → mark failed/expired via RPC.
  if (
    row.status === "pending" &&
    new Date(row.created_at).getTime() < Date.now() - FIVE_MINUTES_MS
  ) {
    // Generated RPC types mark these as non-nullable strings; the
    // Postgres signature accepts NULL. Cast to bypass the typegen gap.
    const expireArgs = {
      p_payment_id: id,
      p_new_status: "failed" as const,
      p_tip_cents: 0,
      p_square_payment_id: null,
      p_raw: { kind: "polling_expired" },
      p_failure_reason: "expired",
    };
    const { error: rpcErr } = await supabase.rpc(
      "pos_record_card_payment",
      expireArgs as unknown as Parameters<typeof supabase.rpc<"pos_record_card_payment">>[1]
    );
    if (rpcErr) {
      console.error("terminal-checkout poll: expiration RPC failed", rpcErr);
      // Fall through — the row may already be non-pending (concurrent
      // expiration) which is the idempotent case we want.
    }
    // Re-read so we return the post-expiration shape.
    const { data: refreshed } = await supabase
      .from("payments")
      .select("status, tip_cents, failure_reason")
      .eq("id", id)
      .single();
    if (refreshed) {
      return NextResponse.json(mapPollResponse(refreshed), {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return NextResponse.json(mapPollResponse(row), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
