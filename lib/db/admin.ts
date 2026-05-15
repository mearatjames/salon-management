// Service-role Supabase client — bypasses RLS.
//
// IMPORTANT: do NOT import this from any UI component, page, route handler,
// or layout. The only legitimate caller is `lib/auth/audit.ts`, which uses it
// to insert into `audit_log` (a write path that authenticated clients lack
// an INSERT policy for, by design).
//
// The service-role key carries unconditional read/write access to the
// database. Leaking it into a client bundle would defeat RLS entirely.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars — required by lib/db/admin.ts",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
