// Anonymization counter helper for the hard-remove flow.
//
// When an owner permanently removes a user, the staff row's display_name
// is rewritten to `Former staff #N` (and the email NULL'd) — preserving
// historical receipts/calendar references that point at the row's id
// without leaking the original person's identity. The counter is a
// per-salon sequence (single salon = single sequence) defined in
// migration 0004.
//
// PostgREST can't call `nextval()` directly, so this helper goes through
// the `next_anon_counter()` security-definer RPC also defined in 0004 —
// service-role only (no anon/authenticated grants).

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

/** Returns the next `Former staff #N` placeholder for hard-removed users. */
export async function getNextAnonPlaceholder(): Promise<string> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("next_anon_counter");
  if (error) throw error;
  const n = Number(data);
  return `Former staff #${n}`;
}
