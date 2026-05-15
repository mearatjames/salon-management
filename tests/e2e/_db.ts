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
      "tests/e2e/_db.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (typically in .env.local)",
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
  created_at: string;
};

export async function getAuditLogRows(action?: string): Promise<AuditRow[]> {
  let query = client()
    .from("audit_log")
    .select("action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload, created_at")
    .order("created_at", { ascending: true });
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
