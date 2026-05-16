// `/auth/callback` — OAuth + magic-link + password-recovery + invite
// handshake completion endpoint.
//
// Receives `?code=<...>&next=<...>` from Supabase after the external
// provider (Google), the email magic-link round-trip, the password
// recovery email link, or a 012-user-onboarding invite (`?type=invite`).
// Exchanges the code for a session (PKCE), records the
// `device.signed_in` audit row, flips the matching staff row to
// `state='active'` + sets `last_sign_in_at` (R10), then bounces forward.
//
// Terminal redirect paths:
//   • `?type=invite`           → /reset-password?type=invite
//   • `?type=recovery`         → /reset-password
//   • OAuth / magic-link OK    → /select-staff?next=<sanitized>
//   • exchange failure         → /login?error=oauth_failed
//     (or /reset-password?error=expired when type=recovery)
//     (or /reset-password?type=invite&error=expired when type=invite)
//
// Per `contracts/routes.contract.md` § /auth/callback. Method tagging
// derives from the combination of `data.user.app_metadata.provider` and
// the request's `?type=` query param:
//   - `type === 'invite'`     → `'invite'`     (012-user-onboarding)
//   - `type === 'recovery'`   → `'recovery'`   (010-login-redesign)
//   - `provider === 'google'` → `'oauth_google'`
//   - `provider === 'email'`  → `'magic_link'` (Supabase tags magic-link
//                                              sign-ins as `email`)
//   - anything else → `'oauth_other'`
//
// NOT under `app/(auth)/` — the literal URL path is `/auth/callback`, and
// we don't want it to inherit the centered-card layout. This is a Route
// Handler (no UI), so a layout would be moot anyway.

import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { recordAuth } from "@/lib/auth/audit";
import { sanitizeNext } from "@/lib/auth/next-url";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

type AuthMethod = "oauth_google" | "magic_link" | "oauth_other" | "recovery" | "invite";

function methodFromCallback(provider: string | undefined, type: string | null): AuthMethod {
  // `type === "invite"` and `type === "recovery"` take precedence: those
  // exchanges are themselves device sign-ins (the user is authenticated by
  // the link), but they must be distinguishable from a magic-link sign-in
  // in the audit log so forensic queries can separate "new account
  // password setup" from "regular session start".
  if (type === "invite") return "invite";
  if (type === "recovery") return "recovery";
  if (provider === "google") return "oauth_google";
  if (provider === "email") return "magic_link";
  return "oauth_other";
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const type = searchParams.get("type");

  if (!code) {
    if (type === "invite") {
      redirect("/reset-password?type=invite&error=expired");
    }
    if (type === "recovery") {
      redirect("/reset-password?error=expired");
    }
    redirect("/login?error=oauth_failed");
  }

  const supabase = await createSupabaseServerClient();

  let userId: string | null = null;
  let provider: string | undefined;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code!);
    if (error || !data?.user) {
      if (type === "invite") {
        redirect("/reset-password?type=invite&error=expired");
      }
      if (type === "recovery") {
        // PKCE code stale or already-used. data-model.md Invariant B: codes
        // are single-use. Route to the recovery-specific expired state so
        // the user sees the correct copy + "Request a new link" button.
        redirect("/reset-password?error=expired");
      }
      redirect("/login?error=oauth_failed");
    }
    userId = data!.user.id;
    // `app_metadata.provider` carries the provider Supabase resolved the
    // session against. For magic links this is `'email'`; for Google OAuth
    // it is `'google'`; for recovery exchanges it is whatever the user's
    // original identity provider was (we override via `type` above).
    const meta = data!.user.app_metadata as { provider?: string } | undefined;
    provider = meta?.provider;
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    if (type === "invite") {
      redirect("/reset-password?type=invite&error=expired");
    }
    if (type === "recovery") {
      redirect("/reset-password?error=expired");
    }
    redirect("/login?error=oauth_failed");
  }

  await recordAuth("device.signed_in", userId, null, {
    method: methodFromCallback(provider, type),
  });

  // R10: every successful exchange flips the matching staff row's
  // lifecycle bits — `last_sign_in_at` (when), `state='active'` (used to
  // be 'invited' for a first-time invite acceptance), `active=true`
  // (idempotent on already-active rows). Wrapped in try/catch because
  // an UPDATE failure must NOT block a legitimate sign-in (the operator
  // still has a session); the failure is logged for forensics.
  if (userId) {
    try {
      const admin = createSupabaseServiceRoleClient();
      await admin
        .from("staff")
        .update({
          last_sign_in_at: new Date().toISOString(),
          state: "active",
          active: true,
        })
        .eq("user_id", userId);
    } catch (err) {
      console.error("callback: staff sign-in mark failed", err);
    }
  }

  if (type === "invite") {
    // The invite flow lands on /reset-password?type=invite so the new
    // operator sets their password. The `next` param is intentionally
    // dropped — the immediate next surface is the password form.
    redirect("/reset-password?type=invite");
  }

  if (type === "recovery") {
    // The recovery flow ultimately lands on /select-staff after the user
    // submits the new password (via updatePassword). The `next` param is
    // intentionally dropped here — the immediate next surface is the
    // new-password form, not the operator's original destination.
    redirect("/reset-password");
  }

  redirect(`/select-staff?next=${encodeURIComponent(sanitizeNext(rawNext))}`);
}

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
