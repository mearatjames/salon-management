// tests/unit/square/expired-then-succeeded.test.ts
//
// FR-021a + FR-016a escape hatch — data-model.md § 4 RPC.
//
// A payment row already marked `failed (failure_reason='expired')` by the
// polling endpoint can still be settled by a late `SUCCEEDED` webhook —
// "Square wins." The RPC's escape-hatch branch:
//
//   if v_existing_status = 'failed'
//      and p_new_status = 'succeeded'
//      and (select failure_reason ...) = 'expired'
//   then null; -- fall through to update
//
// The escape hatch is scoped ONLY to `expired` failures — `declined` and
// `cancelled_by_operator` failures stay terminal even on a late SUCCEEDED.
//
// We exercise this by calling `handleTerminalCheckoutUpdated` with a
// late COMPLETED event after directly forcing the row to `failed` with
// each `failure_reason` in turn.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

async function isReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`);
    return r.ok;
  } catch {
    return false;
  }
}

let supabase: SupabaseClient;
let supabaseUp = false;

const STAFF_ID = "10000000-0000-0000-0000-000000000001";

const describeIfUp = (await isReachable())
  ? (() => {
      supabaseUp = true;
      return describe;
    })()
  : describe.skip;

let ticketId: string;
let paymentId: string;

async function seedPendingThenFail(
  failureReason: "expired" | "declined" | "cancelled_by_operator"
): Promise<string> {
  const checkoutId = `tco_ESC_${failureReason}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { data: t, error: tErr } = await supabase
    .from("tickets")
    .insert({
      status: "open",
      opened_by_staff_id: STAFF_ID,
      subtotal_cents: 4500,
      total_cents: 4500,
    })
    .select("id")
    .single();
  if (tErr || !t) throw new Error(`ticket insert failed: ${tErr?.message}`);
  ticketId = t.id;

  const { data: p, error: pErr } = await supabase
    .from("payments")
    .insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 4500,
      status: "failed",
      taken_by_staff_id: STAFF_ID,
      square_terminal_checkout_id: checkoutId,
      failure_reason: failureReason,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (pErr || !p) throw new Error(`payment insert failed: ${pErr?.message}`);
  paymentId = p.id;
  return checkoutId;
}

async function cleanup(): Promise<void> {
  if (!ticketId) return;
  await supabase.from("payments").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
}

async function clearSquareOauthRow(): Promise<void> {
  // The webhook handler rejects the event when merchant_id doesn't match
  // the seeded square_oauth row. Other tests may have left a row behind
  // with a different merchant_id. Clearing it makes the handler treat the
  // event as "no merchant configured" and skip the mismatch check (the
  // `if (oauthRow && ...)` guard handles a null row).
  await supabase.from("square_oauth").delete().eq("id", true);
}

describeIfUp("handleTerminalCheckoutUpdated — expired escape hatch (Square wins narrowly)", () => {
  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  beforeEach(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
    await clearSquareOauthRow().catch(() => {});
  });

  afterAll(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
  });

  it("failed(expired) + late SUCCEEDED → row flips to succeeded, ticket to paid, failure_reason cleared, audit payment.captured after payment.failed(expired)", async () => {
    if (!supabaseUp) return;
    const checkoutId = await seedPendingThenFail("expired");

    const cursor = new Date().toISOString();

    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");
    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated" as const,
      event_id: `evt_LATE_${Date.now()}`,
      created_at: new Date().toISOString(),
      data: {
        type: "checkout" as const,
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: [`pay_${checkoutId}`],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money: { amount: 300, currency: "USD" },
          },
        },
      },
    };

    await handleTerminalCheckoutUpdated(event);

    // Row flipped to succeeded; failure_reason cleared (the RPC writes
    // `case when p_new_status = 'failed' then p_failure_reason else null end`).
    const { data: row } = await supabase
      .from("payments")
      .select("status, tip_cents, failure_reason, square_payment_id")
      .eq("id", paymentId)
      .single();
    expect(row?.status).toBe("succeeded");
    expect(row?.tip_cents).toBe(300);
    expect(row?.failure_reason).toBeNull();
    expect(row?.square_payment_id).toBe(`pay_${checkoutId}`);

    // Ticket flipped to paid.
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticket?.status).toBe("paid");

    // Audit: payment.captured exists in the cursor window (the prior
    // payment.failed(expired) was BEFORE the cursor; the captured row is
    // what we expect AFTER).
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload, ts")
      .gte("ts", cursor)
      .eq("entity_id", paymentId)
      .order("ts", { ascending: true });
    const captured = (auditRows ?? []).find((r) => r.action === "payment.captured");
    expect(captured).toBeDefined();
    expect((captured!.payload as { tip_cents?: number }).tip_cents).toBe(300);
  });

  it("failed(declined) + late SUCCEEDED → NO override; row stays failed/declined", async () => {
    if (!supabaseUp) return;
    const checkoutId = await seedPendingThenFail("declined");

    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");
    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated" as const,
      event_id: `evt_LATE_DECL_${Date.now()}`,
      created_at: new Date().toISOString(),
      data: {
        type: "checkout" as const,
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: [`pay_${checkoutId}`],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money: { amount: 300, currency: "USD" },
          },
        },
      },
    };

    await handleTerminalCheckoutUpdated(event);

    const { data: row } = await supabase
      .from("payments")
      .select("status, failure_reason, tip_cents")
      .eq("id", paymentId)
      .single();
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBe("declined");
    // Tip should not have been updated by the no-op branch.
    expect(row?.tip_cents).toBe(0);

    // Ticket stays open.
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticket?.status).toBe("open");
  });

  it("failed(cancelled_by_operator) + late SUCCEEDED → NO override; row stays failed/cancelled_by_operator", async () => {
    if (!supabaseUp) return;
    const checkoutId = await seedPendingThenFail("cancelled_by_operator");

    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");
    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated" as const,
      event_id: `evt_LATE_CXL_${Date.now()}`,
      created_at: new Date().toISOString(),
      data: {
        type: "checkout" as const,
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: [`pay_${checkoutId}`],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money: { amount: 300, currency: "USD" },
          },
        },
      },
    };

    await handleTerminalCheckoutUpdated(event);

    const { data: row } = await supabase
      .from("payments")
      .select("status, failure_reason")
      .eq("id", paymentId)
      .single();
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBe("cancelled_by_operator");
  });
});
