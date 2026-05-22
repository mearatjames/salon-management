"use server";

// Server Action for `/reset-password` — the final step of the US3
// password-reset flow (010-login-redesign). Receives the two password
// fields from the new-password form, validates them, writes the new
// password through Supabase, records the audit row, and forwards the
// user to /select-staff.
//
// Contract: `specs/010-login-redesign/contracts/server-actions.contract.md`
// § updatePassword.
// Audit semantics: `specs/010-login-redesign/contracts/audit.contract.md`
// § Lifecycle — this action writes the SECOND of the two audit rows
// produced by a complete reset (the first is the `device.signed_in` row
// written by `/auth/callback`'s recovery branch).
//
// Branch matrix:
//   • password < 8 chars      → /reset-password?error=too_short
//   • password !== confirm    → /reset-password?error=mismatch
//   • no session              → /reset-password?error=expired
//   • AuthRetryableFetchError → /reset-password?error=network
//   • success                 → recordAuth(device.password_reset) + /select-staff

import { redirect } from "next/navigation";

import { AuthRetryableFetchError } from "@supabase/supabase-js";

import { recordAuth } from "@/lib/auth/audit";
import { createSupabaseServerClient } from "@/lib/db/server";

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function updatePassword(formData: FormData): Promise<void> {
  // Passwords may legitimately start/end with whitespace, so we do NOT
  // trim either field. The contract is explicit on this point.
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // `method` distinguishes the 010 recovery flow from the 012-onboarding
  // invite flow at audit time. Defaults to "recovery" for back-compat
  // with existing call sites that don't yet emit the field.
  const methodRaw = String(formData.get("method") ?? "recovery");
  const method: "recovery" | "invite" = methodRaw === "invite" ? "invite" : "recovery";

  // Validation matches FR-023 (carried from 003-login-flow): minimum 8
  // characters, no character-class rules. Equality enforces the second
  // field's intent.
  if (password.length < 8) {
    redirect("/reset-password?error=too_short");
  }
  if (password !== confirm) {
    redirect("/reset-password?error=mismatch");
  }

  const supabase = await createSupabaseServerClient();

  // Session probe. After the PKCE exchange in `/auth/callback`'s recovery
  // branch the user IS authenticated (briefly — long enough to call
  // updateUser). If the cookie has been wiped or the exchange never ran
  // (user opened the form via an expired link, or a copy-paste of the
  // recovery URL was already consumed), there's no user; surface the
  // expired-state page rather than silently failing.
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    // Treat as no-session — same surface.
    userId = null;
  }

  if (!userId) {
    redirect("/reset-password?error=expired");
  }

  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error instanceof AuthRetryableFetchError) {
        redirect("/reset-password?error=network");
      }
      // Any other SDK error (e.g. weak-password policy from Supabase) —
      // surface as too_short for now; the dev console will carry the
      // forensic detail.
      console.error("updatePassword: SDK returned error", error);
      redirect("/reset-password?error=too_short");
    }
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    if (err instanceof AuthRetryableFetchError) {
      redirect("/reset-password?error=network");
    }
    // Any unknown throw — treat as network blip so the user can retry.
    console.error("updatePassword: unexpected throw", err);
    redirect("/reset-password?error=network");
  }

  // Cross-action invariant 1: audit BEFORE redirect on the success path.
  // payload.method = "recovery" (010-login-redesign) or "invite"
  // (012-user-onboarding); the field comes from the form's hidden
  // <input name="method"> and is normalised above.
  await recordAuth("device.password_reset", userId, null, { method });

  // Reset complete. Recovery resets go straight to /select-staff so the
  // operator pins in. Invite-method users (012-user-onboarding) route to
  // the new /set-pin step (048-invitee-self-set-pin): that page gates on
  // `staff.pin_hash` — a no-PIN invitee sets one, an owner-set invitee
  // skips straight through to /select-staff.
  // The `next` query is not propagated here — the reset flow is terminal
  // w.r.t. the user's original navigation intent.
  redirect(method === "invite" ? "/set-pin" : "/select-staff");
}
