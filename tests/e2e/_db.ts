// Tiny service-role Supabase client for Playwright E2E specs.
//
// NOT a server-runtime helper — `lib/db/admin.ts` is RSC-only (it imports
// types and is intended for the audit writer). This file is plain Node and
// uses `@supabase/supabase-js` directly so Playwright tests can read
// `audit_log` rows for verification.
//
// The service-role key MUST be present in `.env.local` (or process env). If
// it is missing, helpers throw — the test should already have skipped via
// the Supabase reachability probe in `auth.spec.ts`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "tests/e2e/_db.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (typically in .env.local)"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type AuditRow = {
  action: string;
  actor_user_id: string | null;
  acting_as_staff_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  ts: string;
};

// Capture the start-of-test timestamp to use as a cursor for subsequent
// `getAuditLogRowsSince()` queries. Call this in `beforeEach` (or `beforeAll`
// when an assertion spans multiple serial tests) instead of truncating the
// table. Each test then sees only the rows written after its own cursor,
// which lets the suite run with `workers > 1` — global truncation would
// race across spec files that share the `audit_log` table.
//
// Node and Postgres share the host clock on dev + CI, so a simple Node
// `new Date()` is within sub-ms of the value Postgres will stamp on rows
// inserted moments later. If we ever split Postgres onto another host,
// swap this for an RPC that returns server-side `now()`.
export function newAuditCursor(): string {
  return new Date().toISOString();
}

// Re-applies the three seeded staff rows from `supabase/seed.sql` (Maya,
// Jordan, Sam) to the local DB. Idempotent via `upsert` so tests that
// mutate the seed rows (rename, deactivate, soft-remove) get them back to
// known-good state without paying for a full `supabase db reset`.
//
// Mirrors the seed.sql INSERT block — keep these literals in sync if the
// seed changes. PIN hashes are pre-computed bcrypt(11) for 1234/5678/9999.
const SEEDED_STAFF: ReadonlyArray<{
  id: string;
  user_id: string | null;
  display_name: string;
  role: string;
  pin_hash: string;
  color_token: string;
  active: boolean;
  removed_at: string | null;
}> = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000001",
    display_name: "Maya Patel",
    role: "owner",
    pin_hash: "$2b$11$ocPxZYLxI9q3whaThAf44eqadcklBHovq4KGJcGQ2VjlZkoGD66x.",
    color_token: "--avatar-rose",
    active: true,
    removed_at: null,
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    user_id: "00000000-0000-0000-0000-000000000002",
    display_name: "Jordan Lee",
    role: "manager",
    pin_hash: "$2b$11$ixukE2AGjrZs3diU3DJbk.ee1XcDBdkg.GlRUABhzcHX.20ELBPiq",
    color_token: "--avatar-amber",
    active: true,
    removed_at: null,
  },
  {
    id: "10000000-0000-0000-0000-000000000003",
    user_id: null,
    display_name: "Sam Chen",
    role: "technician",
    pin_hash: "$2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W",
    color_token: "--avatar-purple",
    active: true,
    removed_at: null,
  },
];

/**
 * Re-applies the seeded staff rows. Upserts on id so the function is
 * idempotent and survives tests that rename or deactivate the seed rows.
 *
 * IMPORTANT: This does NOT remove non-seeded rows. Tests that create extra
 * staff (e.g. the Add wizard scenario) should explicitly delete them in
 * `afterEach`, OR rely on the next `truncate non-seeded staff` block to do
 * it. To keep the roster clean we also delete any row whose id is NOT in
 * the seeded set — this gives every `beforeEach` a fresh 3-row roster.
 */
export async function resetStaffToSeed(): Promise<void> {
  const c = client();
  // 1. Delete any non-seed rows so the roster matches the seed exactly.
  const seedIds = SEEDED_STAFF.map((s) => s.id);
  const { error: delErr } = await c
    .from("staff")
    .delete()
    .not("id", "in", `(${seedIds.map((id) => `"${id}"`).join(",")})`);
  if (delErr) throw new Error(`staff cleanup failed: ${delErr.message}`);

  // 2. Upsert the seed rows back to their canonical state. The seed shape
  // explicitly clears the feature-012 lifecycle columns (state, email,
  // invite/offboard metadata, pin_reset_admin_at, last_sign_in_at) so a
  // previous test that flipped them — e.g. soft-offboarding Jordan in the
  // US3 offboard spec — doesn't leak into the next test. Without this,
  // the canonical 3 columns get restored but the lifecycle columns stay
  // at their previous values and the seed appears in the wrong bucket.
  // Email mirror: keep staff.email in sync with auth.users.email for the
  // seeded operators so feature-012's Send-password-reset (and any other
  // path that reads staff.email) can resolve them. Sam has no auth user
  // and stays email=null.
  const SEED_EMAILS: Record<string, string | null> = {
    "10000000-0000-0000-0000-000000000001": "owner@tangnails.dev",
    "10000000-0000-0000-0000-000000000002": "manager@tangnails.dev",
    "10000000-0000-0000-0000-000000000003": null,
  };
  const SEEDED_STAFF_FULL = SEEDED_STAFF.map((s) => ({
    ...s,
    state: "active" as const,
    email: SEED_EMAILS[s.id] ?? null,
    invited_at: null,
    invited_by: null,
    invite_method: null,
    offboarded_at: null,
    offboarded_by: null,
    offboard_reason: null,
    last_sign_in_at: null,
    pin_reset_admin_at: null,
  }));
  const { error: upErr } = await c.from("staff").upsert(SEEDED_STAFF_FULL, { onConflict: "id" });
  if (upErr) throw new Error(`staff seed upsert failed: ${upErr.message}`);
}

// Returns audit rows written at or after `cursor` (use `newAuditCursor()` to
// produce one in `beforeEach`). Optionally filtered to a specific `action`.
// Ordered by `ts` ascending so multi-row assertions can assume insertion
// order.
export async function getAuditLogRowsSince(cursor: string, action?: string): Promise<AuditRow[]> {
  let query = client()
    .from("audit_log")
    .select("action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload, ts")
    .gte("ts", cursor)
    .order("ts", { ascending: true });
  if (action) {
    query = query.eq("action", action);
  }
  const { data, error } = await query;
  if (error) throw new Error(`audit_log read failed: ${error.message}`);
  return (data as AuditRow[]) ?? [];
}

export type StaffRow = { id: string; display_name: string };

/**
 * Look up a staff row by display name. Used by E2E specs that need a
 * stable staff id without hard-coding UUIDs (the seed migration uses
 * `gen_random_uuid()` so ids are not deterministic across resets).
 */
export async function getStaffByDisplayName(name: string): Promise<StaffRow> {
  const { data, error } = await client()
    .from("staff")
    .select("id, display_name")
    .eq("display_name", name)
    .single();
  if (error) {
    throw new Error(`staff lookup failed for "${name}": ${error.message}`);
  }
  return data as StaffRow;
}

/**
 * Resolve an `auth.users.id` by email. Used by US6 specs that need to
 * assert an audit row's `actor_user_id` matches the device user without
 * hard-coding UUIDs.
 *
 * Uses the service-role client's admin API (`auth.admin.listUsers`) — the
 * standard PostgREST surface does not expose `auth.users` directly.
 */
export async function getAuthUserByEmail(email: string): Promise<{ id: string }> {
  const { data, error } = await client().auth.admin.listUsers();
  if (error) {
    throw new Error(`auth.admin.listUsers failed: ${error.message}`);
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    throw new Error(`auth user not found for email "${email}"`);
  }
  return { id: user.id };
}
