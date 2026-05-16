// Email-conflict guard for the Onboard sheet.
//
// The Onboard action consults this helper BEFORE issuing a Supabase invite.
// If the email is already attached to a live staff row, the action surfaces
// a typed code so the UI can render the right inline copy (and the toast
// system stays in sync). Hard-removed rows have `email = NULL` per the
// anonymization contract (see migration 0004 + FR-052), so the address is
// free to re-use after Remove — that case is the `null` return below.
//
// `ilike` rather than `eq lower()` keeps the query backed by the partial
// index `staff_email_lower_unique` (it's a case-insensitive unique index;
// `ilike '<exact-email>'` planner-optimizes to an index lookup).

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export type EmailConflictCode = "already_active" | "already_invited" | "was_offboarded";

export async function checkEmailConflict(email: string): Promise<EmailConflictCode | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("staff")
    .select("state")
    .ilike("email", email)
    .is("removed_at", null)
    .maybeSingle();

  if (!data) return null;
  const state = (data as { state: string }).state;
  if (state === "active") return "already_active";
  if (state === "invited") return "already_invited";
  if (state === "offboarded") return "was_offboarded";
  return null;
}
