"use server";

// Server action behind `/auth/recovery-callback`.
//
// An admin-initiated password reset (Settings → Onboarding → "Send password
// reset", `sendUserPasswordReset`) delivers an *implicit-flow* recovery link:
// the access + refresh tokens arrive in the URL *hash fragment*, which the
// server never receives. The `/auth/recovery-callback` client page reads them
// from the hash and hands them here; this action establishes the cookie
// session and records the `device.signed_in` audit row — the same shape
// `acceptInvite` (the invite-callback action) does for invite links.
//
// Why a dedicated implicit-flow callback rather than the PKCE `/auth/callback`
// route handler: the reset is cross-browser — the owner triggers it, the
// target opens the link. A PKCE link's code verifier lives in the owner's
// browser, so `exchangeCodeForSession` in the target's browser has nothing to
// match. The implicit flow carries everything in the hash, so it works
// regardless of which browser opens the link. See issue #126.

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export type CompleteRecoveryResult = { ok: boolean };

export async function completeRecovery(
  accessToken: string,
  refreshToken: string
): Promise<CompleteRecoveryResult> {
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
  // Mirrors `/auth/callback`'s recovery branch, which tags the exchange
  // `method: "recovery"`.
  await recordAuth("device.signed_in", user.id, null, { method: "recovery" });

  // Stamp `last_sign_in_at` — opening a recovery link IS a device sign-in.
  // Unlike `acceptInvite` we deliberately do NOT flip `state`/`active`: a
  // password reset is not a lifecycle transition, and a stale recovery link
  // must never resurrect an offboarded user. Best-effort — an UPDATE failure
  // must not block a legitimate reset.
  try {
    const admin = createSupabaseServiceRoleClient();
    await admin
      .from("staff")
      .update({ last_sign_in_at: new Date().toISOString() })
      .eq("user_id", user.id);
  } catch (err) {
    console.error("completeRecovery: last_sign_in_at update failed", err);
  }

  return { ok: true };
}
