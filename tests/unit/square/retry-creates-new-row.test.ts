// tests/unit/square/retry-creates-new-row.test.ts
//
// Per-attempt-row contract (FR-015 / clarification Q1).
//
// Given a `failed` payments row that came from a prior card-payment attempt,
// calling `sendCardToTerminal` again MUST NOT mutate the failed row. Instead
// it MUST INSERT a fresh `pending` row with a brand-new `payment_id`. Both
// rows persist; the idempotency key the action passes to the stubbed Square
// SDK differs between the two attempts (because `${ticketId}:${paymentId}`
// differs when the paymentId differs).
//
// This proves the audit trail keeps every attempt (each is its own row, with
// its own taken_by_staff_id, processed_at, failure_reason).
//
// Uses the real local Postgres connection through the service-role client —
// same pattern as oauth-encryption.test.ts. Mocks Square SDK only.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reset the realServiceRole client cache between modules.
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

// Mock Square SDK so the action's `createCheckout` doesn't try the network.
// We capture the idempotency keys passed across two attempts.
const fakeCreate = vi.fn();
const fakeGet = vi.fn();
const fakeCancel = vi.fn();

vi.mock("@/lib/square/client", () => ({
  getSquareClient: vi.fn(() => ({
    terminal: {
      checkouts: {
        create: fakeCreate,
        get: fakeGet,
        cancel: fakeCancel,
      },
    },
    devices: { list: vi.fn() },
  })),
}));

vi.mock("@/lib/square/oauth", () => ({
  readDecryptedTokens: vi.fn(async () => ({
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    refreshFailedAt: null,
    merchantId: "MERCHANT_TEST",
    merchantName: "Test Salon",
  })),
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

const STAFF_ID = "10000000-0000-0000-0000-000000000001"; // Maya, owner

const describeIfUp = (await isReachable())
  ? (() => {
      supabaseUp = true;
      return describe;
    })()
  : describe.skip;

async function seedConnectedSquare(): Promise<void> {
  // Best-effort: a fresh oauth row + one default device so the action's
  // preconditions all pass.
  const VAULT_NAME = process.env.SQUARE_OAUTH_KEY_VAULT_NAME ?? "square_oauth_key";

  await supabase.from("square_devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("square_oauth").delete().eq("id", true);

  const { data: encAccess } = await supabase.rpc("encrypt_square_token", {
    plain: "stub-access-token",
    vault_secret_name: VAULT_NAME,
  });
  const { data: encRefresh } = await supabase.rpc("encrypt_square_token", {
    plain: "stub-refresh-token",
    vault_secret_name: VAULT_NAME,
  });
  await supabase.from("square_oauth").insert({
    id: true,
    merchant_id: "MERCHANT_TEST",
    merchant_name: "Test Salon",
    access_token_encrypted: encAccess as unknown as string,
    refresh_token_encrypted: encRefresh as unknown as string,
    access_token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    scope: "PAYMENTS_WRITE",
    connected_by_staff_id: STAFF_ID,
  });
  await supabase.from("square_devices").insert({
    square_device_id: "device:RETRY_TEST",
    friendly_name: "Test Terminal",
    is_default: true,
  });
}

async function createOpenTicketWithLine(): Promise<string> {
  // Insert a ticket and one priced line so total_cents > 0.
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

  // Insert a service line. Use a stable seeded service id.
  const { data: svc } = await supabase.from("services").select("id").limit(1).single();
  if (!svc) throw new Error("no service rows in DB — run supabase db reset");

  await supabase.from("ticket_items").insert({
    ticket_id: t.id,
    kind: "service",
    ref_id: svc.id,
    name_snapshot: "Test service",
    unit_price_cents: 4500,
    qty: 1,
    assigned_staff_id: STAFF_ID,
    price_unconfirmed: false,
  });

  return t.id;
}

describeIfUp("sendCardToTerminal — retry semantics (per-attempt row)", () => {
  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  });

  beforeEach(async () => {
    if (!supabaseUp) return;
    fakeCreate.mockReset();
    fakeGet.mockReset();
    fakeCancel.mockReset();
    await seedConnectedSquare();
    ticketId = await createOpenTicketWithLine();
  });

  afterEach(async () => {
    if (!supabaseUp) return;
    await supabase.from("payments").delete().eq("ticket_id", ticketId);
    await supabase.from("ticket_items").delete().eq("ticket_id", ticketId);
    await supabase.from("tickets").delete().eq("id", ticketId);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it("retry after a failed row INSERTs a fresh pending row; both persist; idempotency keys differ", async () => {
    if (!supabaseUp) return;
    const { sendCardToTerminal } = await import("@/app/(studio)/checkout/actions");

    // First attempt — Square call succeeds (returns a checkout id).
    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_ATTEMPT_1", status: "PENDING" },
    });
    const first = await sendCardToTerminal({ from: "ticket", ticketId });
    expect(first.paymentId).toBeTruthy();
    expect(first.squareTerminalCheckoutId).toBe("tco_ATTEMPT_1");

    // Mark the first attempt FAILED (simulating a decline or cancel — the
    // path the polling endpoint / webhook would take). We use a direct
    // UPDATE rather than calling pos_record_card_payment because the
    // action being tested is sendCardToTerminal, not the settlement RPC.
    await supabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: "declined",
        processed_at: new Date().toISOString(),
      })
      .eq("id", first.paymentId);

    // Second attempt on the SAME ticket.
    fakeCreate.mockResolvedValueOnce({
      checkout: { id: "tco_ATTEMPT_2", status: "PENDING" },
    });
    const second = await sendCardToTerminal({ from: "ticket", ticketId });
    expect(second.paymentId).toBeTruthy();
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(second.squareTerminalCheckoutId).toBe("tco_ATTEMPT_2");

    // Both rows persist.
    const { data: rows } = await supabase
      .from("payments")
      .select("id, status, failure_reason, square_terminal_checkout_id")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    expect(rows).toHaveLength(2);
    expect(rows![0].id).toBe(first.paymentId);
    expect(rows![0].status).toBe("failed");
    expect(rows![0].failure_reason).toBe("declined");
    expect(rows![1].id).toBe(second.paymentId);
    expect(rows![1].status).toBe("pending");

    // Idempotency keys passed to Square differ.
    expect(fakeCreate).toHaveBeenCalledTimes(2);
    const { buildIdempotencyKey } = await import("@/lib/square/terminal");
    const keyA = (fakeCreate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const keyB = (fakeCreate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(keyA).toBe(buildIdempotencyKey(ticketId, first.paymentId));
    expect(keyB).toBe(buildIdempotencyKey(ticketId, second.paymentId));
    expect(keyA).not.toBe(keyB);
  });
});
