// `/auth/callback` — OAuth + magic-link handshake completion endpoint.
//
// Receives `?code=<...>&next=<...>` from Supabase after the external provider
// (Google) or the email link round-trip. Exchanges the code for a session
// (PKCE), records the `device.signed_in` audit row, then bounces forward to
// `/select-staff` with the sanitized `?next=`. On any failure (missing code,
// exchange error) we redirect to `/login?error=oauth_failed` — the surface is
// public and deliberately gives no detail.
//
// Per `contracts/routes.contract.md` § /auth/callback. Method tagging derives
// from `data.user.app_metadata.provider`:
//   - `'google'` → `'oauth_google'`
//   - `'email'`  → `'magic_link'` (Supabase tags magic-link sign-ins as `email`)
//   - anything else falls back to `'oauth_other'` (kept distinct from the two
//     supported methods so a forensic query can spot drift).
//
// NOT under `app/(auth)/` — the literal URL path is `/auth/callback`, and we
// don't want it to inherit the centered-card layout. This is a Route Handler
// (no UI), so a layout would be moot anyway.

import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { recordAuth } from "@/lib/auth/audit";
import { sanitizeNext } from "@/lib/auth/next-url";
import { createSupabaseServerClient } from "@/lib/db/server";

type AuthMethod = "oauth_google" | "magic_link" | "oauth_other";

function methodFromProvider(provider: string | undefined): AuthMethod {
  if (provider === "google") return "oauth_google";
  if (provider === "email") return "magic_link";
  return "oauth_other";
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");

  if (!code) {
    redirect("/login?error=oauth_failed");
  }

  const supabase = await createSupabaseServerClient();

  let userId: string | null = null;
  let provider: string | undefined;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code!);
    if (error || !data?.user) {
      redirect("/login?error=oauth_failed");
    }
    userId = data!.user.id;
    // `app_metadata.provider` carries the provider Supabase resolved the
    // session against. For magic links this is `'email'`; for Google OAuth it
    // is `'google'`.
    const meta = data!.user.app_metadata as { provider?: string } | undefined;
    provider = meta?.provider;
  } catch (err) {
    // Let Next.js `redirect()` sentinels bubble.
    if (isNextRedirectError(err)) throw err;
    redirect("/login?error=oauth_failed");
  }

  await recordAuth("device.signed_in", userId, null, {
    method: methodFromProvider(provider),
  });

  redirect(`/select-staff?next=${encodeURIComponent(sanitizeNext(rawNext))}`);
}

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
