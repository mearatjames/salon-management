// tests/unit/square/webhook-tip-from-payment.test.ts
//
// Regression (feature 051 follow-up — money integrity, Constitution III):
//
// A buyer-entered tip on a Square Terminal is reported on the Payment object,
// NOT on the TerminalCheckout. Order-linked checkouts (feature 051) never echo
// the tip onto `checkout.tip_money`, so a COMPLETED `terminal.checkout.updated`
// event arrives with `tip_money` absent. The handler MUST fall back to the
// linked Payment so the persisted `tip_cents` matches what the card was
// charged — otherwise `amount_cents + tip_cents` understates the real total.
//
// The Square SDK fetch itself is covered by payment-tip-fallback.test.ts; here
// we mock `getPaymentTipCents` to assert the WIRING: handler reads it for the
// checkout's first payment id and persists the result via the RPC.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/square/terminal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/square/terminal")>();
  return { ...actual, getPaymentTipCents: vi.fn() };
});

import { getPaymentTipCents } from "@/lib/square/terminal";

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
const checkoutId = `tco_TIP_${Date.now()}`;

async function seedPendingCardPayment(): Promise<void> {
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

  const { error: pErr } = await supabase.from("payments").insert({
    ticket_id: ticketId,
    method: "card",
    kind: "payment",
    amount_cents: 4500,
    status: "pending",
    taken_by_staff_id: STAFF_ID,
    square_terminal_checkout_id: checkoutId,
  });
  if (pErr) throw new Error(`payment insert failed: ${pErr.message}`);
}

async function cleanup(): Promise<void> {
  await supabase.from("payments").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
}

describeIfUp("handleTerminalCheckoutUpdated — buyer tip sourced from the Payment", () => {
  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  beforeEach(async () => {
    if (!supabaseUp) return;
    vi.clearAllMocks();
    await cleanup().catch(() => {});
    await seedPendingCardPayment();
  });

  afterAll(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
  });

  it("records the Payment's tip when the checkout carries no tip_money", async () => {
    if (!supabaseUp) return;
    (getPaymentTipCents as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(900);

    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");

    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated",
      event_id: "evt_TIP_1",
      created_at: new Date().toISOString(),
      data: {
        type: "checkout",
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: ["pay_TIP_X"],
            amount_money: { amount: 4500, currency: "USD" },
            // NOTE: no tip_money — Square puts the buyer tip on the Payment.
          },
        },
      },
    };

    await handleTerminalCheckoutUpdated(event);

    expect(getPaymentTipCents).toHaveBeenCalledWith("pay_TIP_X");
    const { data: rows } = await supabase
      .from("payments")
      .select("status, tip_cents")
      .eq("ticket_id", ticketId);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("succeeded");
    expect(rows![0].tip_cents).toBe(900);
  });

  it("still honors checkout.tip_money when Square DOES send it (fixed-tip path)", async () => {
    if (!supabaseUp) return;
    // When the checkout already carries the tip, the handler must NOT call the
    // payment fallback — the checkout value wins.
    const { handleTerminalCheckoutUpdated } = await import("@/lib/square/webhooks");

    const event = {
      merchant_id: "MERCHANT_TEST",
      type: "terminal.checkout.updated",
      event_id: "evt_TIP_2",
      created_at: new Date().toISOString(),
      data: {
        type: "checkout",
        id: checkoutId,
        object: {
          checkout: {
            id: checkoutId,
            status: "COMPLETED",
            reference_id: ticketId,
            payment_ids: ["pay_TIP_Y"],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money: { amount: 600, currency: "USD" },
          },
        },
      },
    };

    await handleTerminalCheckoutUpdated(event);

    expect(getPaymentTipCents).not.toHaveBeenCalled();
    const { data: rows } = await supabase
      .from("payments")
      .select("status, tip_cents")
      .eq("ticket_id", ticketId);
    expect(rows![0].tip_cents).toBe(600);
  });
});
