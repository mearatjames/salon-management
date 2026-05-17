// tests/unit/square/webhook-replay-idempotent.test.ts
//
// FR-019 / SC-005 — exactly-once side effects on webhook replay.
//
// Given a `pending` payments row tied to a `square_terminal_checkout_id`,
// invoking `handleTerminalCheckoutUpdated` twice with the same SUCCEEDED
// event MUST land:
//   - exactly ONE payment-row mutation (`status='succeeded'` once, tip set once)
//   - exactly ONE ticket transition to `paid`
//   - exactly ONE `payment.captured` audit row
//   - ZERO additional rows
//
// The application-level idempotency guard is the RPC's `status='pending'`
// predicate (T004). The DB backstop is the unique partial index
// `payments_unique_succeeded_terminal_checkout_idx`. We also exercise the
// backstop directly to prove an attacker injecting a duplicate INSERT cannot
// produce two `succeeded` rows for the same checkout.

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
const checkoutId = `tco_REPLAY_${Date.now()}`;

async function seedPendingCardPayment(): Promise<void> {
  // Open ticket.
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

  // Pending card payment row tied to a known terminal checkout.
  const { data: p, error: pErr } = await supabase
    .from("payments")
    .insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 4500,
      status: "pending",
      taken_by_staff_id: STAFF_ID,
      square_terminal_checkout_id: checkoutId,
    })
    .select("id")
    .single();
  if (pErr || !p) throw new Error(`payment insert failed: ${pErr?.message}`);
  paymentId = p.id;
}

async function cleanup(): Promise<void> {
  await supabase.from("payments").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
}

describeIfUp("handleTerminalCheckoutUpdated — webhook replay idempotency", () => {
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
    await seedPendingCardPayment();
  });

  afterAll(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
  });

  it("two identical SUCCEEDED events → 1 row mutation, 1 ticket flip, 1 audit", async () => {
    if (!supabaseUp) return;
    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");

    const cursor = new Date().toISOString();

    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated",
      event_id: "evt_REPLAY_1",
      created_at: new Date().toISOString(),
      data: {
        type: "checkout",
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: [`pay_${checkoutId}`],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money: { amount: 800, currency: "USD" },
          },
        },
      },
    };

    // First delivery
    await handleTerminalCheckoutUpdated(event);
    // Second delivery (identical replay)
    await handleTerminalCheckoutUpdated(event);

    // Exactly one row, succeeded, tip set.
    const { data: rows } = await supabase
      .from("payments")
      .select("id, status, tip_cents, square_payment_id")
      .eq("ticket_id", ticketId);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("succeeded");
    expect(rows![0].tip_cents).toBe(800);
    expect(rows![0].square_payment_id).toBe(`pay_${checkoutId}`);

    // Ticket flipped to paid (once).
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status, closed_at")
      .eq("id", ticketId)
      .single();
    expect(ticket?.status).toBe("paid");

    // Exactly one payment.captured audit row.
    const { data: audits } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload")
      .gte("ts", cursor)
      .eq("entity_id", paymentId);
    const captured = (audits ?? []).filter((a) => a.action === "payment.captured");
    expect(captured.length).toBe(1);
  });

  it("DB-level: unique partial index forbids a second succeeded row for the same checkout", async () => {
    if (!supabaseUp) return;
    // Set the existing row succeeded so the index sees it.
    await supabase
      .from("payments")
      .update({
        status: "succeeded",
        tip_cents: 0,
        processed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    // Attempt to INSERT a second succeeded row with the same
    // square_terminal_checkout_id — the partial unique index must reject.
    const { error } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 4500,
      status: "succeeded",
      taken_by_staff_id: STAFF_ID,
      square_terminal_checkout_id: checkoutId,
    });
    expect(error).not.toBeNull();
    expect((error as { code?: string }).code).toBe("23505"); // unique_violation
  });
});
