// Thin wrappers around Supabase Admin invite endpoints.
//
// Only the Onboard server action (and its tests) calls into these helpers;
// keeping the Supabase boilerplate out of the action file makes the action
// readable as a pipeline of business rules rather than SDK invocations.
//
// The "duplicate" sentinel pattern lets the caller distinguish a benign
// re-invite collision (which the conflict-check helper already routed
// earlier in the action — this is the second-line defense) from a genuine
// SDK failure. Genuine failures throw so the action's catch can map them
// to `?error=invite_failed` per the routes contract.
//
// `getOrigin()` mirrors the existing `lib/auth/next-url.ts` pattern —
// configurable via `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL`, falls
// back to the local dev origin.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

type InviteMetadata = Record<string, unknown>;

/**
 * Result of `generateMagicLinkInvite`. On the happy path `user_id` is the id
 * of the freshly-invited auth user and Supabase has already sent the invite
 * email. On a duplicate-email collision the function returns the typed
 * sentinel so the caller can react with the contract's `was_offboarded` /
 * `already_invited` etc. code (set by the prior conflict-check stage; this
 * branch is a defense-in-depth fallback).
 */
export type MagicLinkResult =
  | { user_id: string; error?: undefined }
  | { user_id: null; error: "duplicate" };

/** Result of `sendPasswordInvite`. Same duplicate-sentinel shape. */
export type PasswordInviteResult =
  | { user_id: string; error?: undefined }
  | { user_id: null; error: "duplicate" };

function isDuplicateError(message: string | undefined): boolean {
  // Supabase emits a few variants for the "email already taken" case:
  //   - "A user with this email address has already been registered" (createUser)
  //   - "Email already exists"
  //   - "User already registered"
  // The middle word ("been") may or may not be present, so use a lenient
  // pattern that matches `already <anything> registered|exists`.
  return typeof message === "string" && /already\b[^.]*\b(?:registered|exists)/i.test(message);
}

function getOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  );
}

/**
 * Public alias for `getOrigin()` so other modules in the onboarding feature
 * (resendInvite / getInviteLink in `app/(studio)/settings/onboarding/actions.ts`)
 * can resolve the same callback origin without duplicating the env-var
 * fallback ladder. Keep the underlying function private — callers should
 * import this exported name to keep the contract explicit.
 */
export function inviteOrigin(): string {
  return getOrigin();
}

export async function generateMagicLinkInvite(
  email: string,
  metadata: InviteMetadata = {}
): Promise<MagicLinkResult> {
  const supabase = createSupabaseServiceRoleClient();
  // `inviteUserByEmail` creates the auth user AND sends the invite email
  // through Supabase's mailer (Inbucket in local dev; custom SMTP in
  // production). It replaces the previous `createUser` → `generateLink` pair:
  // `generateLink` only GENERATES a link — it never sends an email — so the
  // magic-link invite never actually reached the invitee's inbox.
  //
  // The redirect omits `?type=invite` so `/auth/callback` routes the accepted
  // invitee straight to /select-staff — a magic-link invite is passwordless,
  // with no password-setup detour. `sendPasswordInvite` keeps the
  // `?type=invite` suffix for the password-setup variant.
  const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getOrigin()}/auth/callback`,
    data: metadata,
  });
  if (error) {
    if (isDuplicateError(error.message)) {
      return { user_id: null, error: "duplicate" };
    }
    throw error;
  }
  if (!invited?.user) {
    throw new Error("inviteUserByEmail returned no user");
  }
  return { user_id: invited.user.id };
}

export async function sendPasswordInvite(
  email: string,
  metadata: InviteMetadata = {}
): Promise<PasswordInviteResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getOrigin()}/auth/callback?type=invite`,
    data: metadata,
  });
  if (error) {
    if (isDuplicateError(error.message)) {
      return { user_id: null, error: "duplicate" };
    }
    throw error;
  }
  if (!invited?.user) {
    throw new Error("inviteUserByEmail returned no user");
  }
  return { user_id: invited.user.id };
}

export async function deleteInviteUser(userId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  // Hard-delete (shouldSoftDelete=false) so the email is freed immediately
  // for re-invite. The SDK default is version-dependent.
  const { error } = await supabase.auth.admin.deleteUser(userId, false);
  if (error) throw error;
}
