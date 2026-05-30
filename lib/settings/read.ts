// Server-only reader for the `public.settings` key/value table.
//
// Used by:
//   - the receipt preview's masthead (salon.name / salon.address / salon.phone)
//   - the addDiscountLine Server Action (discount.manager_threshold_cents
//     read — v1 ignores the value per FR-018; phase-8 plugs in the
//     manager-PIN gate at that exact point)
//
// IMPORTANT: this module imports the service-role Supabase client and MUST
// NOT be transitively pulled into a `"use client"` bundle. Keep callers on
// the server (Server Components, Server Actions). The settings table has a
// `select-to-authenticated` RLS policy so a future read path could move to
// the SSR client; the service-role read here is intentional for symmetry
// with the rest of the action layer.
//
// Failure mode: throws on supabase error (the caller decides whether to
// surface the failure or fall back to a default). Returns `null` when the
// key is not present (distinct from "the row exists and its value is JSON
// null" — that case returns the JSON null as `T`).

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.value as T;
}
