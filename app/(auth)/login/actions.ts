"use server";

// Server Actions for `/login`. US1 wires password sign-in; US4 adds
// Google OAuth and the magic-link recovery path.
//
// All actions follow the cross-action invariants from
// `specs/003-login-flow/contracts/server-actions.contract.md`:
//   1. Audit before redirect on the success path. (For Google + magic-link
//      the audit row is written by `/auth/callback`, not here — the
//      handshake hasn't completed yet at this point.)
//   2. Identical user-facing error string for "wrong password" and "unknown
//      email" (FR-019) — both redirect to `?error=invalid`. Magic-link
//      extends this guarantee: ALWAYS redirect to `?magic_sent=...`
//      regardless of whether the email matches a row (FR-019 + FR-022 via
//      `shouldCreateUser: false`).
//   3. Network failures (`AuthRetryableFetchError`) surface as
//      `?error=network` so the page renders the retry message.
//   4. `?next=` is propagated verbatim — sanitization happens later (R6).

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthRetryableFetchError } from "@supabase/supabase-js";

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";

function encodeNext(next: string): string {
  // Re-encode so an action invoked with a raw `next` like `/dashboard?foo=bar`
  // round-trips safely through the URL we redirect to.
  return encodeURIComponent(next);
}

export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (email.length === 0 || password.length === 0) {
    redirect(`/login?error=invalid&next=${encodeNext(next)}`);
  }

  const supabase = await createSupabaseServerClient();

  let user: { id: string } | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data?.user) {
      // FR-019: identical message for "wrong password" and "no such email".
      redirect(`/login?error=invalid&next=${encodeNext(next)}`);
    }
    user = data!.user;
  } catch (err) {
    // `redirect()` throws a NEXT_REDIRECT sentinel; let that bubble.
    if (isNextRedirectError(err)) throw err;
    if (err instanceof AuthRetryableFetchError) {
      redirect(`/login?error=network&next=${encodeNext(next)}`);
    }
    // Treat any other unexpected failure as a network blip rather than
    // exposing a stack to the user. Audit-log captures the attempt absence.
    redirect(`/login?error=network&next=${encodeNext(next)}`);
  }

  await recordAuth("device.signed_in", user!.id, null, { method: "password" });
  redirect(`/select-staff?next=${encodeNext(next)}`);
}

// Next.js `redirect()` works by throwing a special error with `digest`
// starting with `NEXT_REDIRECT;`. Re-throw it so the framework can complete
// the redirect.
function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * Resolve the request origin (`<proto>://<host>`) from the inbound headers.
 * Respects `x-forwarded-proto` for production deployments behind a proxy and
 * falls back to `http` only when no forwarded-proto header is present.
 */
async function getOrigin(): Promise<string> {
  const h = await headers();
  // `origin` is set by some browsers on form submissions; prefer it when
  // present so we don't have to reconstruct.
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = String(formData.get("next") ?? "");
  const origin = await getOrigin();
  // Preserve `?next=` through the OAuth round-trip so `/auth/callback` can
  // forward the user to the right studio surface after the handshake.
  const redirectTo = `${origin}/auth/callback?next=${encodeNext(next)}`;

  const supabase = await createSupabaseServerClient();

  let providerUrl: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error || !data?.url) {
      redirect(`/login?error=oauth_failed&next=${encodeNext(next)}`);
    }
    providerUrl = data!.url;
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    redirect(`/login?error=oauth_failed&next=${encodeNext(next)}`);
  }

  // `data.url` is Supabase's Google authorize URL (carrying the PKCE code
  // verifier). Bounce the user there — the browser will round-trip back to
  // `/auth/callback` with `?code=<...>`.
  redirect(providerUrl!);
}

export async function sendPasswordReset(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "");

  // Empty email shouldn't reach us — the `forgot` view's input has `required`
  // — but bounce defensively. Re-seed the forgot view via `reset_intent=1`
  // so the alert renders there (not on the default sign-in view).
  // (server-actions.contract.md § sendPasswordReset behaviour step 1.)
  if (email.length === 0) {
    redirect(`/login?error=invalid&reset_intent=1&next=${encodeNext(next)}`);
  }

  const origin = await getOrigin();
  // Re-use the existing /auth/callback PKCE plumbing. Supabase appends
  // `?type=recovery` to this URL automatically; the callback's recovery
  // branch (T035) then forwards to /reset-password.
  const redirectTo = `${origin}/auth/callback?next=${encodeNext(next)}`;

  const supabase = await createSupabaseServerClient();

  try {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch (err) {
    // Defensive: even if the SDK throws (network blip, unknown email
    // returns an error-shaped value, etc.), we MUST NOT leak whether the
    // email exists. Fall through to the `reset_sent` redirect so the
    // surface is identical for success / unknown-email / SDK-failure
    // (Invariant 6 / research R5).
    if (isNextRedirectError(err)) throw err;
    // Intentionally swallow — log for forensic visibility only.
    console.error("sendPasswordReset: SDK error swallowed (no-enum)", err);
  }

  // Invariant 6: always confirm "we sent a link" regardless of the SDK's
  // response (Supabase returns success-shaped data for registered emails
  // and an error-shaped response for unknown — we mirror both to the same
  // redirect to defeat side-channel enumeration).
  redirect(`/login?reset_sent=${encodeURIComponent(email)}&next=${encodeNext(next)}`);
}

export async function signInWithMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "");

  // Empty email shouldn't reach us — the form input has `required` — but
  // bounce defensively. We do NOT distinguish "invalid email" from
  // "unknown email" in the surface (FR-019).
  if (email.length === 0) {
    redirect(`/login?error=invalid&next=${encodeNext(next)}`);
  }

  const origin = await getOrigin();
  const emailRedirectTo = `${origin}/auth/callback?next=${encodeNext(next)}`;

  const supabase = await createSupabaseServerClient();

  try {
    await supabase.auth.signInWithOtp({
      email,
      options: {
        // FR-022: NEVER auto-provision an account from a magic-link request.
        // The owner provisions staff explicitly via Settings; magic-link is
        // a recovery path for existing accounts only. This flag is the
        // non-negotiable enforcement of that invariant.
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });
  } catch (err) {
    // Defensive: even if the SDK throws, we MUST NOT leak whether the email
    // exists. Fall through to the `magic_sent` redirect so the surface is
    // identical for success / unknown-email / SDK-failure (FR-019).
    if (isNextRedirectError(err)) throw err;
    // Intentionally swallow — log for forensic visibility only.
    console.error("signInWithMagicLink: SDK error swallowed (FR-019)", err);
  }

  // FR-019: always confirm "we sent a link" regardless of whether the email
  // matched. With `shouldCreateUser: false`, Supabase returns success for
  // unknown emails too — so this code path is correct on the happy path,
  // and we mirror it for failures above.
  redirect(`/login?magic_sent=${encodeURIComponent(email)}&next=${encodeNext(next)}`);
}
