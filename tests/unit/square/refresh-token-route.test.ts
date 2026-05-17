// tests/unit/square/refresh-token-route.test.ts
//
// Exercises the `GET /api/square/refresh-token` cron handler. Covers the
// four branches from `contracts/api-routes.contract.md` § 2:
//
//   1. Missing / wrong `Authorization: Bearer ${CRON_SECRET}` → 401.
//   2. No `square_oauth` row → 200 { ok: true, skipped: "not_connected" }.
//   3. expires_at ≥ now() + 7d → 200 { ok: true, skipped: "not_due" }.
//   4. Refresh succeeds → 200 { ok: true, refreshed: true } + audit row,
//      `last_refreshed_at` set, `refresh_failed_at` cleared.
//   5. Refresh fails 3x → 200 { ok: false, error } + audit row,
//      `refresh_failed_at` set.
//
// Talks to the local Supabase via the service-role client so the
// audit/persistence checks are end-to-end real. Square's `/oauth2/token`
// endpoint is intercepted via `vi.spyOn(globalThis, 'fetch')`.

import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { GET } from "@/app/api/square/refresh-token/route";

const CRON_SECRET = "test-cron-secret-please-replace-in-real-deploys";
const VAULT_NAME = "square_oauth_key";

let supabase: SupabaseClient;
let ownerStaffId: string;

function isReachable(): Promise<boolean> {
  return fetch("http://127.0.0.1:54321/auth/v1/health")
    .then((r) => r.ok)
    .catch(() => false);
}

let supabaseUp = false;
const describeIfUp = (await isReachable())
  ? (() => {
      supabaseUp = true;
      return describe;
    })()
  : describe.skip;

beforeAll(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.SQUARE_OAUTH_KEY_VAULT_NAME = VAULT_NAME;
  // Set placeholders so fetchSquareTokenSet's env check passes.
  process.env.SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID ?? "sq0idp-test";
  process.env.SQUARE_APPLICATION_SECRET = process.env.SQUARE_APPLICATION_SECRET ?? "sq0csp-test";
  process.env.SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT ?? "sandbox";

  supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Get a real owner staff id for the connected_by_staff_id FK.
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("role", "owner")
    .limit(1)
    .single();
  ownerStaffId = (staff as { id: string }).id;
});

async function clearOAuth(): Promise<void> {
  await supabase.from("square_oauth").delete().eq("id", true);
}

async function seedOAuth(opts: { expiresAt: Date; refreshFailedAt?: Date | null }): Promise<void> {
  await clearOAuth();
  // Use the encrypt RPC to populate encrypted columns.
  const { data: enc1, error: e1 } = await supabase.rpc("encrypt_square_token", {
    plain: "stub-access-token-existing",
    vault_secret_name: VAULT_NAME,
  });
  if (e1 || !enc1) throw new Error(`seed encrypt failed: ${e1?.message}`);
  const { data: enc2, error: e2 } = await supabase.rpc("encrypt_square_token", {
    plain: "stub-refresh-token-existing",
    vault_secret_name: VAULT_NAME,
  });
  if (e2 || !enc2) throw new Error(`seed encrypt failed: ${e2?.message}`);

  const { error } = await supabase.from("square_oauth").insert({
    id: true,
    merchant_id: "MERCHANT_TEST",
    merchant_name: "Test Salon",
    access_token_encrypted: enc1 as unknown as string,
    refresh_token_encrypted: enc2 as unknown as string,
    access_token_expires_at: opts.expiresAt.toISOString(),
    scope: "PAYMENTS_WRITE",
    connected_by_staff_id: ownerStaffId,
    refresh_failed_at: opts.refreshFailedAt?.toISOString() ?? null,
  });
  if (error) throw new Error(`seed insert failed: ${error.message}`);
}

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost:3000/api/square/refresh-token", {
    method: "GET",
    headers,
  });
}

describeIfUp("GET /api/square/refresh-token", () => {
  beforeEach(async () => {
    await clearOAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is wrong", async () => {
    const res = await GET(makeRequest("Bearer wrong") as never);
    expect(res.status).toBe(401);
  });

  it("returns 200 + skipped:not_connected when no square_oauth row exists", async () => {
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, skipped: "not_connected" });
  });

  it("returns 200 + skipped:not_due when expires_at is more than 7 days out", async () => {
    if (!supabaseUp) return;
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await seedOAuth({ expiresAt: farFuture });
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, skipped: "not_due" });
  });

  it("returns 200 + refreshed:true on a successful refresh", async () => {
    if (!supabaseUp) return;
    // expires_at in 1 day → due for refresh.
    await seedOAuth({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });

    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/oauth2/token") && !url.includes("/auth/v1/token")) {
          return new Response(
            JSON.stringify({
              access_token: "new-access-token",
              refresh_token: "new-refresh-token",
              merchant_id: "MERCHANT_TEST",
              expires_at: newExpiresAt.toISOString(),
              scope: "PAYMENTS_WRITE",
              token_type: "bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return originalFetch(input, init);
      }
    );

    const cursor = new Date().toISOString();
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, refreshed: true });

    const { data: row } = await supabase
      .from("square_oauth")
      .select("last_refreshed_at, refresh_failed_at, access_token_expires_at")
      .eq("id", true)
      .single();
    expect(row?.last_refreshed_at).not.toBeNull();
    expect(row?.refresh_failed_at).toBeNull();

    const { data: audits } = await supabase
      .from("audit_log")
      .select("action, payload")
      .gte("ts", cursor)
      .eq("action", "integration.square_token_refreshed");
    expect(audits?.length).toBe(1);
    expect((audits![0].payload as { ok: boolean }).ok).toBe(true);
  });

  it("returns 200 + ok:false and sets refresh_failed_at after 3 failed retries", async () => {
    if (!supabaseUp) return;
    await seedOAuth({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });

    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/oauth2/token") && !url.includes("/auth/v1/token")) {
          return new Response("error", { status: 500 });
        }
        return originalFetch(input, init);
      }
    );

    const cursor = new Date().toISOString();
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe("string");

    const { data: row } = await supabase
      .from("square_oauth")
      .select("refresh_failed_at")
      .eq("id", true)
      .single();
    expect(row?.refresh_failed_at).not.toBeNull();

    const { data: audits } = await supabase
      .from("audit_log")
      .select("action, payload")
      .gte("ts", cursor)
      .eq("action", "integration.square_token_refreshed");
    expect(audits?.length).toBe(1);
    expect((audits![0].payload as { ok: boolean }).ok).toBe(false);
  }, 15000);
});
