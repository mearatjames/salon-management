// tests/unit/square/expired-payment.test.ts
//
// FR-021a — lazy 5-minute expiration via the polling endpoint.
//
// A `pending` payment row created > 5 minutes ago, polled via
// `GET /api/square/terminal-checkout/[id]`, MUST flip to `failed` with
// `failure_reason='expired'` and persist + audit. A row younger than
// 5 minutes MUST stay pending and not mutate.
//
// We exercise this by directly calling the route handler's GET export
// against a NextRequest-shaped object — no full HTTP roundtrip needed
// for the expiration logic.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(async () => ({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: { id: "10000000-0000-0000-0000-000000000001", display_name: "Maya Patel" },
  })),
  AuthRedirectError: class AuthRedirectError extends Error {},
}));

let supabase: SupabaseClient;
let ticketId: string;

const STAFF_ID = "10000000-0000-0000-0000-000000000001";

const describeIfUp = (await isReachable())
  ? (() => {
      supabaseUp = true;
      return describe;
    })()
  : describe.skip;

async function seedPendingCardPayment(createdAt: Date): Promise<string> {
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
      square_terminal_checkout_id: `tco_EXP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: createdAt.toISOString(),
    })
    .select("id")
    .single();
  if (pErr || !p) throw new Error(`payment insert failed: ${pErr?.message}`);
  return p.id;
}

async function cleanup(): Promise<void> {
  if (!ticketId) return;
  await supabase.from("payments").delete().eq("ticket_id", ticketId);
  await supabase.from("tickets").delete().eq("id", ticketId);
}

describeIfUp("polling endpoint — lazy 5-minute expiration (FR-021a)", () => {
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
  });

  afterAll(async () => {
    if (!supabaseUp) return;
    await cleanup().catch(() => {});
  });

  it("row aged 5min 1s → flips to failed/expired and persists; response shape says failed/expired", async () => {
    if (!supabaseUp) return;
    const fiveMinPlus = new Date(Date.now() - (5 * 60 + 1) * 1000);
    const paymentId = await seedPendingCardPayment(fiveMinPlus);

    const cursor = new Date().toISOString();

    const { GET } = await import("@/app/api/square/terminal-checkout/[id]/route");
    const req = new Request(`http://localhost:3000/api/square/terminal-checkout/${paymentId}`);
    const res = await GET(req, { params: Promise.resolve({ id: paymentId }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reason?: string };
    expect(body.status).toBe("failed");
    expect(body.reason).toBe("expired");

    // Row mutated.
    const { data: row } = await supabase
      .from("payments")
      .select("status, failure_reason")
      .eq("id", paymentId)
      .single();
    expect(row?.status).toBe("failed");
    expect(row?.failure_reason).toBe("expired");

    // Audit row: payment.failed with failure_reason=expired.
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id, payload")
      .gte("ts", cursor)
      .eq("entity_id", paymentId);
    const failed = (auditRows ?? []).find((r) => r.action === "payment.failed");
    expect(failed).toBeDefined();
    expect((failed!.payload as { failure_reason?: string }).failure_reason).toBe("expired");
  });

  it("row aged 4min 59s → stays pending; row not mutated; response shape says pending", async () => {
    if (!supabaseUp) return;
    const justUnder = new Date(Date.now() - (4 * 60 + 59) * 1000);
    const paymentId = await seedPendingCardPayment(justUnder);

    const cursor = new Date().toISOString();

    const { GET } = await import("@/app/api/square/terminal-checkout/[id]/route");
    const req = new Request(`http://localhost:3000/api/square/terminal-checkout/${paymentId}`);
    const res = await GET(req, { params: Promise.resolve({ id: paymentId }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");

    // Row untouched.
    const { data: row } = await supabase
      .from("payments")
      .select("status, failure_reason")
      .eq("id", paymentId)
      .single();
    expect(row?.status).toBe("pending");
    expect(row?.failure_reason).toBeNull();

    // No payment.failed audit.
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_id")
      .gte("ts", cursor)
      .eq("entity_id", paymentId);
    const failed = (auditRows ?? []).find((r) => r.action === "payment.failed");
    expect(failed).toBeUndefined();
  });
});
