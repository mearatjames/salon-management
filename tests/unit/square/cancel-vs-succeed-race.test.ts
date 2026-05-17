// tests/unit/square/cancel-vs-succeed-race.test.ts
//
// FR-016a — cancel-vs-succeed race ("Square wins").
//
// Given a `pending` card-payment row, when the operator taps Cancel and
// `cancelTerminalPayment` calls `terminals.cancelCheckout` but Square's
// response is `COMPLETED` (the customer already paid before the cancel
// reached the terminal), the action MUST:
//   - call `pos_record_card_payment(... 'succeeded', tipCents, ...)` so the
//     row settles to `succeeded`
//   - emit `payment.cancelled` audit (operator intent, with
//     `resolved_status: 'race_succeeded'`)
//   - the RPC itself emits `payment.captured` (outcome)
//
// Both audit rows must be present after one call.
//
// Uses the local Postgres + service-role + module-mock for
// `lib/square/terminal.cancelCheckout`.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

let supabaseUp = false;

// Mock the terminal module so cancelCheckout returns COMPLETED (race-succeeded).
const fakeCancelCheckout = vi.fn();

vi.mock("@/lib/square/terminal", () => ({
  cancelCheckout: fakeCancelCheckout,
  // Keep other exports in case the action imports something else.
  createCheckout: vi.fn(),
  getCheckout: vi.fn(),
  listDevices: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(async () => ({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: { id: "10000000-0000-0000-0000-000000000001", display_name: "Maya Patel" },
  })),
  AuthRedirectError: class AuthRedirectError extends Error {},
}));

let supabase: SupabaseClient;
let ticketId: string;
let paymentId: string;
const checkoutId = `tco_RACE_${Date.now()}`;

const STAFF_ID = "10000000-0000-0000-0000-000000000001";

const describeIfUp = (await isReachable())
  ? (() => {
      supabaseUp = true;
      return describe;
    })()
  : describe.skip;

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

describeIfUp("cancelTerminalPayment — cancel-vs-succeed race (FR-016a, Square wins)", () => {
  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  beforeEach(async () => {
    if (!supabaseUp) return;
    fakeCancelCheckout.mockReset();
    await cleanup().catch(() => {});
    await seedPendingCardPayment();
  });

  afterEach(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it("Square returns COMPLETED → row settles succeeded with tip; audit has both payment.cancelled and payment.captured", async () => {
    if (!supabaseUp) return;

    // The Square SDK stub returns `COMPLETED` with a tip — the customer
    // paid before the cancel reached the terminal.
    fakeCancelCheckout.mockResolvedValueOnce({
      status: "completed",
      tipCents: 500,
      squarePaymentId: `pay_${checkoutId}`,
    });

    const cursor = new Date().toISOString();

    const { cancelTerminalPayment } = await import("@/app/(studio)/checkout/actions");
    const result = await cancelTerminalPayment(paymentId);

    expect(result.ok).toBe(true);
    expect(result.resolvedStatus).toBe("race_succeeded");

    // Row settled to succeeded with tip = 500.
    const { data: payment } = await supabase
      .from("payments")
      .select("status, tip_cents, square_payment_id")
      .eq("id", paymentId)
      .single();
    expect(payment?.status).toBe("succeeded");
    expect(payment?.tip_cents).toBe(500);
    expect(payment?.square_payment_id).toBe(`pay_${checkoutId}`);

    // Audit log carries BOTH payment.cancelled (intent) AND payment.captured (outcome).
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload")
      .gte("ts", cursor)
      .eq("entity_id", paymentId)
      .order("ts", { ascending: true });

    const cancelled = (auditRows ?? []).find((r) => r.action === "payment.cancelled");
    const captured = (auditRows ?? []).find((r) => r.action === "payment.captured");

    expect(cancelled).toBeDefined();
    expect((cancelled!.payload as { resolved_status?: string }).resolved_status).toBe(
      "race_succeeded"
    );
    expect((cancelled!.payload as { payment_id?: string }).payment_id).toBe(paymentId);
    expect((cancelled!.payload as { ticket_id?: string }).ticket_id).toBe(ticketId);

    expect(captured).toBeDefined();
    expect((captured!.payload as { method?: string }).method).toBe("card");
    expect((captured!.payload as { tip_cents?: number }).tip_cents).toBe(500);
  });

  it("Square returns CANCELED → row settles failed/cancelled_by_operator; audit has payment.cancelled with resolved_status=cancelled and payment.failed", async () => {
    if (!supabaseUp) return;

    fakeCancelCheckout.mockResolvedValueOnce({
      status: "canceled",
      tipCents: null,
      squarePaymentId: null,
    });

    const cursor = new Date().toISOString();

    const { cancelTerminalPayment } = await import("@/app/(studio)/checkout/actions");
    const result = await cancelTerminalPayment(paymentId);

    expect(result.ok).toBe(true);
    expect(result.resolvedStatus).toBe("cancelled");

    const { data: payment } = await supabase
      .from("payments")
      .select("status, failure_reason")
      .eq("id", paymentId)
      .single();
    expect(payment?.status).toBe("failed");
    expect(payment?.failure_reason).toBe("cancelled_by_operator");

    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload")
      .gte("ts", cursor)
      .eq("entity_id", paymentId);

    const cancelled = (auditRows ?? []).find((r) => r.action === "payment.cancelled");
    const failed = (auditRows ?? []).find((r) => r.action === "payment.failed");

    expect(cancelled).toBeDefined();
    expect((cancelled!.payload as { resolved_status?: string }).resolved_status).toBe("cancelled");

    expect(failed).toBeDefined();
    expect((failed!.payload as { failure_reason?: string }).failure_reason).toBe(
      "cancelled_by_operator"
    );
  });

  it("Square network error → row stays pending; resolvedStatus='still_pending'; payment.cancelled emitted, no payment.failed/captured", async () => {
    if (!supabaseUp) return;

    fakeCancelCheckout.mockRejectedValueOnce(new Error("network blip"));

    const cursor = new Date().toISOString();

    const { cancelTerminalPayment } = await import("@/app/(studio)/checkout/actions");
    const result = await cancelTerminalPayment(paymentId);

    expect(result.ok).toBe(true);
    expect(result.resolvedStatus).toBe("still_pending");

    // Row untouched — still pending.
    const { data: payment } = await supabase
      .from("payments")
      .select("status, failure_reason")
      .eq("id", paymentId)
      .single();
    expect(payment?.status).toBe("pending");
    expect(payment?.failure_reason).toBeNull();

    // Audit: only payment.cancelled (no .failed or .captured).
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload")
      .gte("ts", cursor)
      .eq("entity_id", paymentId);

    const cancelled = (auditRows ?? []).find((r) => r.action === "payment.cancelled");
    const failed = (auditRows ?? []).find((r) => r.action === "payment.failed");
    const captured = (auditRows ?? []).find((r) => r.action === "payment.captured");

    expect(cancelled).toBeDefined();
    expect((cancelled!.payload as { resolved_status?: string }).resolved_status).toBe(
      "still_pending"
    );
    expect(failed).toBeUndefined();
    expect(captured).toBeUndefined();
  });
});
