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
    const nowIso = new Date().toISOString();
    const { data: linked, error: linkErr } = await admin
      .from("staff")
      .update({ last_sign_in_at: nowIso, state: "active", active: true })
      .eq("user_id", user.id)
      .is("removed_at", null)
      .select("id");

    // Back-fill the link for a staff row that predates its auth account. A row
    // created without going through `inviteUser` (a seeded roster row, for
    // instance) has user_id IS NULL, so the match above touches nothing and
    // the row stays stuck `state='invited'` forever — even after the invitee
    // signs in and uses the app (they pick the staff tile by PIN, which never
    // reads user_id). When nothing matched by user_id, link the still-unlinked,
    // invited row whose email matches the just-authenticated user, stamping
    // user_id so every later sign-in matches directly. The `user_id IS NULL` +
    // `state='invited'` + `removed_at IS NULL` guards keep this from ever
    // touching an already-linked, active, offboarded, or removed row;
    // `staff_email_lower_unique` bounds the email match to one row. Mirrors the
    // same back-fill in `/auth/callback`. (Fixes the "stuck pending invite".)
    if (!linkErr && (linked?.length ?? 0) === 0 && user.email) {
      const escapedEmail = user.email.replace(/[%_]/g, "\\$&");
      await admin
        .from("staff")
        .update({ user_id: user.id, last_sign_in_at: nowIso, state: "active", active: true })
        .is("user_id", null)
        .is("removed_at", null)
        .eq("state", "invited")
        .ilike("email", escapedEmail);
    }
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
