// `/auth/callback` — OAuth + magic-link + password-recovery handshake
// completion endpoint.
//
// Receives `?code=<...>&next=<...>` from Supabase after the external
// provider (Google), the email magic-link round-trip, or the password
// recovery email link. Exchanges the code for a session (PKCE), records
// the `device.signed_in` audit row, then bounces forward.
//
// Three terminal redirect paths:
//   • `?type=recovery`         → /reset-password
//   • OAuth / magic-link OK    → /select-staff?next=<sanitized>
//   • exchange failure         → /login?error=oauth_failed
//     (or /reset-password?error=expired when type=recovery)
//
// Per `contracts/routes.contract.md` § /auth/callback. Method tagging
// derives from the combination of `data.user.app_metadata.provider` and
// the request's `?type=` query param:
//   - `type === 'recovery'` → `'recovery'`   (FR-017 / audit.contract.md)
//   - `provider === 'google'` → `'oauth_google'`
//   - `provider === 'email'`  → `'magic_link'` (Supabase tags magic-link
//                                              sign-ins as `email`)
//   - anything else → `'oauth_other'` (kept distinct so a forensic query
//                                      can spot drift)
//
// NOT under `app/(auth)/` — the literal URL path is `/auth/callback`, and
// we don't want it to inherit the centered-card layout. This is a Route
// Handler (no UI), so a layout would be moot anyway.

import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { recordAuth } from "@/lib/auth/audit";
import { sanitizeNext } from "@/lib/auth/next-url";
import { createSupabaseServerClient } from "@/lib/db/server";

type AuthMethod = "oauth_google" | "magic_link" | "oauth_other" | "recovery";

function methodFromCallback(provider: string | undefined, type: string | null): AuthMethod {
  // `type === "recovery"` takes precedence: a recovery exchange is itself a
  // device sign-in (the user is authenticated by the link) but it must be
  // distinguishable from a magic-link sign-in in the audit log.
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
    if (type === "recovery") {
      redirect("/reset-password?error=expired");
    }
    redirect("/login?error=oauth_failed");
  }

  await recordAuth("device.signed_in", userId, null, {
    method: methodFromCallback(provider, type),
  });

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
