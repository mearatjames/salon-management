// Keep `staff.email` in step with the authenticated user's email (#220).
//
// The Staff and Onboarding UI read only `staff.email` — never
// `auth.users.email`. A staff row that was linked to its auth user without
// going through `inviteUser` (the bootstrapped first owner, or a row whose
// `user_id` was stamped by hand) keeps `email = NULL`, so its email never
// shows. Every sign-in path calls this after the session is established:
// when the row linked by `user_id` has no email, or one that differs
// case-insensitively (the user changed it in auth), copy the auth email in.
//
// Best-effort, like the lifecycle flip next to it: any failure — including a
// `staff_email_lower_unique` collision with another live row — is logged and
// swallowed so it can never block a legitimate sign-in.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export async function syncStaffEmailFromAuth(
  userId: string | null | undefined,
  email: string | null | undefined
): Promise<void> {
  if (!userId || !email) return;
  try {
    const admin = createSupabaseServiceRoleClient();
    const { data, error } = await admin
      .from("staff")
      .select("id, email")
      .eq("user_id", userId)
      .is("removed_at", null);
    if (error) throw error;

    for (const row of data ?? []) {
      if (row.email && row.email.toLowerCase() === email.toLowerCase()) continue;
      const { error: updateErr } = await admin.from("staff").update({ email }).eq("id", row.id);
      if (updateErr) console.error("syncStaffEmailFromAuth: update failed", updateErr);
    }
  } catch (err) {
    console.error("syncStaffEmailFromAuth failed", err);
  }
}
