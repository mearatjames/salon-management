"use server";

// Server action behind `/auth/invite-callback`.
//
// Admin-generated invite links (`admin.inviteUserByEmail` / `generateLink`)
// return the session via the OAuth *implicit flow*: the access + refresh
// tokens arrive in the URL *hash fragment*, which the server never receives.
// The `/auth/invite-callback` client page reads them from the hash and hands
// them here; this action establishes the cookie session, records the
// `device.signed_in` audit row, and flips the staff row to `active` — the
// same lifecycle work `/auth/callback` does for the PKCE `?code=` flow.

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export type AcceptInviteResult = { ok: true; destination: string } | { ok: false };

export async function acceptInvite(
  accessToken: string,
  refreshToken: string,
  method: string | null
): Promise<AcceptInviteResult> {
  if (!accessToken || !refreshToken) return { ok: false };

  const supabase = await createSupabaseServerClient();

  // Persist the implicit-flow tokens as the cookie session, then re-validate
  // against the auth server: `getUser()` verifies the JWT signature, so a
  // forged, tampered, or expired token fails closed here.
  const { error: setErr } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setErr) return { ok: false };

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return { ok: false };

  // Audit the device sign-in before routing onward (Constitution III).
  await recordAuth("device.signed_in", user.id, null, { method: "invite" });

  // Flip the matching staff row to active — mirrors `/auth/callback`'s R10
  // step (state 'invited' → 'active', last_sign_in_at). Best-effort: an
  // UPDATE failure must not block a legitimate sign-in.
  try {
    const admin = createSupabaseServiceRoleClient();
    await admin
      .from("staff")
      .update({ last_sign_in_at: new Date().toISOString(), state: "active", active: true })
      .eq("user_id", user.id);
  } catch (err) {
    console.error("acceptInvite: staff sign-in mark failed", err);
  }

  // Password-method invites set a password first; magic-link invites are
  // passwordless and go straight to the staff picker.
  return {
    ok: true,
    destination: method === "password" ? "/reset-password?type=invite" : "/select-staff",
  };
}
