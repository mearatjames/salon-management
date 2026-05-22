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
// Invite redirect URLs resolve the origin from the request headers (see
// `getRequestOrigin`) so they point at the actual deployment — localhost in
// dev, the Vercel URL in preview/prod — without per-environment env config.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getRequestOrigin } from "@/lib/auth/request-origin";

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

/**
 * Resolve the callback origin for invite redirect URLs. Delegates to the
 * shared header-based resolver and is re-exported under this name so the
 * onboarding server actions (resendInvite / getInviteLink / reactivateUser)
 * build the same origin without each importing the resolver directly.
 */
export function inviteOrigin(): Promise<string> {
  return getRequestOrigin();
}

export async function generateMagicLinkInvite(
  email: string,
  metadata: InviteMetadata = {}
): Promise<MagicLinkResult> {
  const supabase = createSupabaseServiceRoleClient();
  // `inviteUserByEmail` creates the auth user AND sends the invite email
  // through Supabase's mailer (Mailpit in local dev; custom SMTP in
  // production). It replaces the previous `createUser` → `generateLink` pair:
  // `generateLink` only GENERATES a link — it never sends an email — so the
  // magic-link invite never actually reached the invitee's inbox.
  //
  // The link lands on `/auth/invite-callback`: admin invites come back via
  // the implicit flow (tokens in the URL hash), which a server route can't
  // read, so that page completes the session client-side. No `?method`
  // param → it routes the accepted invitee straight to /select-staff.
  const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await inviteOrigin()}/auth/invite-callback`,
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
  // `?method=password` tells /auth/invite-callback to route the accepted
  // invitee to the password-setup form instead of /select-staff.
  const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await inviteOrigin()}/auth/invite-callback?method=password`,
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
