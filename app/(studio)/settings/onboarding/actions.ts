"use server";

// Server Actions for Settings → Onboarding.
//
// Contract: specs/012-user-onboarding/contracts/server-actions.contract.md.
// This file implements `inviteUser` for BOTH modes:
//   - `mode='quick'`     — magic-link only, server-picked color, no PIN.
//   - `mode='thorough'`  — user picks color, invite method, optional PIN.
//
// Shared shape (same prelude as `app/(studio)/settings/staff/actions.ts`):
//   1. requireStudioSession            (throws AuthRedirectError on miss)
//   2. owner-only gate                 (Onboarding is owner-only per
//                                       routes.contract.md; non-owners are
//                                       bounced to /dashboard?error=forbidden)
//   3. validate FormData               (per _validation.ts)
//   4. email-conflict check            (per lib/onboarding/email-conflict.ts)
//   5. admin: create auth user + link  (per lib/onboarding/invite.ts —
//                                       generateMagicLinkInvite OR
//                                       sendPasswordInvite, depending on
//                                       mode + method)
//   6. INSERT staff row                (state='invited', active=false,
//                                       invite_method=<method>,
//                                       pin_hash=hashed-or-null,
//                                       color_token=<chosen-or-server-picked>)
//      - On unique_violation (23505) on the staff_email_lower_unique index,
//        we treat the row as a race against another concurrent invite and
//        roll back the auth user via deleteInviteUser so a retry can
//        succeed; redirect ?error=already_invited.
//      - On any other DB error, rollback + redirect ?error=server_error.
//   7. recordAudit (`user.invited`)    (awaited BEFORE redirect —
//                                       Constitution III; payload carries
//                                       method + pin_set boolean — raw PIN
//                                       NEVER appears here)
//   8. revalidatePath + redirect       (`?toast=invited&name=<encoded>`)

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { headers } from "next/headers";

import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { requireStudioSession, type StudioRole, type StudioViewer } from "@/lib/auth/session";

import { getNextAnonPlaceholder } from "@/lib/onboarding/anon-counter";
import { checkEmailConflict } from "@/lib/onboarding/email-conflict";
import {
  deleteInviteUser,
  generateMagicLinkInvite,
  inviteOrigin,
  sendPasswordInvite,
} from "@/lib/onboarding/invite";

import type { InviteMethod } from "./_types";
import {
  STAFF_COLORS,
  ValidationError,
  validateColor,
  validateDisplayName,
  validateEmail,
  validateInviteMethod,
  validateMode,
  validatePinShape,
  validateReason,
  validateRole,
} from "./_validation";

const ONB_PATH = "/settings/onboarding";

/**
 * Owner-only gate. Onboarding lives at the most privileged tier of the
 * Settings tabs (invite / offboard / remove). Managers and below are bounced
 * to /dashboard — the page already redirects non-owners to /settings/staff,
 * this server-side check is the defense-in-depth backstop against a direct
 * POST to the action endpoint.
 */
function assertOwner(viewer: StudioViewer): void {
  if (viewer.staff.role !== "owner") {
    redirect("/dashboard?error=forbidden");
  }
}

/**
 * Pick the first STAFF_COLORS entry not already in use among non-removed
 * staff rows. Falls back to the first color when all are taken. Quick mode
 * defers the avatar choice, so the action picks one server-side to satisfy
 * the staff.color_token NOT NULL constraint.
 */
async function pickNextAvatarColor(
  admin: ReturnType<typeof createSupabaseServiceRoleClient>
): Promise<string> {
  const { data: used } = await admin.from("staff").select("color_token").is("removed_at", null);
  const usedSet = new Set((used ?? []).map((r) => (r as { color_token: string }).color_token));
  return STAFF_COLORS.find((c) => !usedSet.has(c)) ?? STAFF_COLORS[0];
}

/**
 * Common shape produced by the per-mode validation branch. Encapsulates
 * the four extras Thorough mode supplies and Quick mode defaults.
 */
type ValidatedExtras = {
  colorToken: string | null; // null → Quick branch picks server-side
  method: InviteMethod;
  pinPlain: string | null;
};

export async function inviteUser(formData: FormData): Promise<void> {
  // 1 + 2: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  // 3a: shared validation (every mode validates these).
  let mode: "quick" | "thorough";
  let displayName: string;
  let email: string;
  let role: StudioRole;
  let extras: ValidatedExtras;

  try {
    mode = validateMode(String(formData.get("mode") ?? "quick"));
    displayName = validateDisplayName(String(formData.get("display_name") ?? ""));
    email = validateEmail(String(formData.get("email") ?? ""));
    role = validateRole(String(formData.get("role") ?? ""));

    // 3b: per-mode extras. Order matters — invalid_color / invalid_pin_shape
    // / invalid_invite_method codes are stable per the contract.
    if (mode === "thorough") {
      const colorToken = validateColor(String(formData.get("color_token") ?? ""));
      const method = validateInviteMethod(String(formData.get("method") ?? "magic_link"));
      const pinRaw = String(formData.get("pin") ?? "").trim();
      const pinPlain = pinRaw.length > 0 ? validatePinShape(pinRaw) : null;
      extras = { colorToken, method, pinPlain };
    } else {
      // Quick: defaults. Color picked after admin client is built (it
      // queries the table); method is always magic_link; PIN deferred.
      extras = { colorToken: null, method: "magic_link", pinPlain: null };
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${ONB_PATH}?error=${encodeURIComponent(err.code)}`);
    }
    throw err;
  }

  // 4: email-conflict check. The matrix is exhaustive per
  // email-conflict.contract.md, so we forward the typed code verbatim.
  const conflict = await checkEmailConflict(email);
  if (conflict) {
    redirect(`${ONB_PATH}?error=${encodeURIComponent(conflict)}`);
  }

  // 5: create auth user via the method-appropriate helper. Genuine SDK
  // failures throw; a duplicate-email collision returns the typed sentinel.
  let userId: string;
  try {
    if (extras.method === "password") {
      const result = await sendPasswordInvite(email, {
        display_name: displayName,
        role,
        invited_by: viewer.staff.id,
      });
      if (!result.user_id) {
        redirect(`${ONB_PATH}?error=already_invited`);
      }
      userId = result.user_id;
    } else {
      const result = await generateMagicLinkInvite(email, {
        display_name: displayName,
        role,
        invited_by: viewer.staff.id,
      });
      if (!result.user_id) {
        redirect(`${ONB_PATH}?error=already_invited`);
      }
      userId = result.user_id;
    }
  } catch (err) {
    // Suppress NEXT_REDIRECT — that's the duplicate-sentinel branch above
    // throwing through us; let it propagate to terminate the action.
    if (err instanceof Error && (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    console.error("inviteUser: admin invite call failed", err);
    redirect(`${ONB_PATH}?error=invite_failed`);
  }

  // 5b: hash the PIN if one was provided. Constitution III invariant —
  // raw PIN never persists past this point; the audit only carries the
  // boolean witness `pin_set`.
  const pinHash = extras.pinPlain ? await hashPin(extras.pinPlain) : null;
  const pinSet = pinHash !== null;

  // 6: INSERT staff. service-role client (the `staff` table has no INSERT
  // policy for `authenticated`; service-role bypasses RLS).
  const admin = createSupabaseServiceRoleClient();
  const colorToken = extras.colorToken ?? (await pickNextAvatarColor(admin));

  const { data: inserted, error: insertErr } = await admin
    .from("staff")
    .insert({
      user_id: userId,
      display_name: displayName,
      email,
      role,
      color_token: colorToken,
      pin_hash: pinHash,
      state: "invited",
      active: false,
      invited_at: new Date().toISOString(),
      invited_by: viewer.staff.id,
      invite_method: extras.method,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    // Roll back the auth user so a retry succeeds cleanly. Best-effort:
    // a delete failure here only means the orphan will be cleaned up on
    // re-invite via the conflict-check path.
    try {
      await deleteInviteUser(userId);
    } catch (rbErr) {
      console.error("inviteUser: rollback deleteInviteUser failed", rbErr);
    }
    const code = (insertErr as { code?: string } | null)?.code;
    if (code === "23505") {
      // Race against another concurrent invite of the same email — the
      // partial unique index staff_email_lower_unique fired.
      redirect(`${ONB_PATH}?error=already_invited`);
    }
    console.error("inviteUser: staff INSERT failed", insertErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  const newStaffId = (inserted as { id: string }).id;

  // 7: audit row — awaited BEFORE redirect per Constitution III. The raw
  // invite link is NEVER in the payload (Supabase token is sensitive), and
  // the raw PIN is never in the payload either (Constitution III + spec
  // FR-030 — only the boolean witness `pin_set`).
  await recordAudit(
    "user.invited",
    viewer.deviceUserId,
    newStaffId,
    {
      email,
      role,
      method: extras.method,
      pin_set: pinSet,
      by: viewer.deviceUserId,
    },
    viewer.staff.id
  );

  // 8: revalidate the roster + redirect with the toast params. The
  // OnboardingToaster client island consumes ?toast=invited&name=... and
  // strips the params after firing.
  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=invited&name=${encodeURIComponent(displayName)}`);
}

// ── offboardUser ────────────────────────────────────────────────────────────
//
// Soft-offboard a non-self active user. Per server-actions.contract.md § 4:
//   1. session + owner gate.
//   2. validate optional reason (one of the 5).
//   3. load target — must be state='active' and removed_at IS NULL.
//   4. self-guard: target.user_id === viewer.deviceUserId → cannot_offboard_self.
//   5. admin.auth.admin.signOut(target_user_id, 'global') BEFORE the UPDATE so
//      a stale refresh-token can't slip a request through between UPDATE and
//      signOut. This is the cornerstone of SC-003 (5-second offboard).
//   6. UPDATE state='offboarded'/active=false/pin_hash=null/offboarded_*/
//      pin_reset_admin_at=null.
//   7. on trigger error 23514|P0001 → ?error=last_owner.
//   8. audit user.offboarded { reason, by }.
//   9. revalidate + redirect ?toast=offboarded&name=…
//
// Constitution III invariant: audit row is awaited BEFORE the redirect.
// Constitution II invariant: defense-in-depth — UI also disables self-row +
// last-owner cases, this server-side gate is the trust boundary.

export async function offboardUser(formData: FormData): Promise<void> {
  // 1 + 2: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  // 3: parse staff_id.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 4: validate optional reason. Empty string → reason=null (the field is
  // optional). Non-empty must match one of the 5 canonical values.
  let reason: string | null = null;
  try {
    reason = validateReason(String(formData.get("reason") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${ONB_PATH}?error=${encodeURIComponent(err.code)}`);
    }
    throw err;
  }

  // 5: load target.
  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, display_name, role, state, removed_at")
    .eq("id", staffId)
    .single();

  if (loadErr || !target || target.removed_at !== null || target.state !== "active") {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 6: self-guard. Defense-in-depth — the row menu also hides the destructive
  // item for the viewer's own row, but a hand-crafted POST would bypass that.
  if (target.user_id === viewer.deviceUserId) {
    redirect(`${ONB_PATH}?error=cannot_offboard_self`);
  }

  // 7: invalidate every active session for the target FIRST. If the UPDATE
  // races a still-valid token, the user could squeeze one more request
  // through; signing out pre-emptively closes that window. Failure here is
  // logged + swallowed — the UPDATE below is still the trust boundary and
  // /select-staff filters on active=true so the user can't pick their tile
  // post-offboard regardless.
  try {
    if (target.user_id) {
      const adminAuth = (admin as unknown as { auth?: { admin?: unknown } }).auth?.admin as
        | { signOut?: (uid: string, scope: string) => Promise<unknown> }
        | undefined;
      if (adminAuth?.signOut) {
        await adminAuth.signOut(target.user_id, "global");
      }
    }
  } catch (err) {
    console.error("offboardUser: signOut failed", err);
  }

  // 8: UPDATE lifecycle columns.
  const { error: updateErr } = await admin
    .from("staff")
    .update({
      state: "offboarded",
      active: false,
      pin_hash: null,
      offboarded_at: new Date().toISOString(),
      offboarded_by: viewer.staff.id,
      offboard_reason: reason,
      pin_reset_admin_at: null,
    })
    .eq("id", target.id);

  if (updateErr) {
    const code = (updateErr as { code?: string }).code;
    if (code === "23514" || code === "P0001") {
      // Trigger fired — would-be last-owner offboard. The UI should have
      // blocked this, but the server is the trust boundary.
      redirect(`${ONB_PATH}?error=last_owner`);
    }
    console.error("offboardUser: UPDATE failed", updateErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 9: audit BEFORE redirect (Constitution III).
  await recordAudit(
    "user.offboarded",
    viewer.deviceUserId,
    target.id,
    { reason, by: viewer.deviceUserId },
    viewer.staff.id
  );

  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=offboarded&name=${encodeURIComponent(target.display_name)}`);
}

// ── resetUserPin ────────────────────────────────────────────────────────────
//
// Owner-initiated PIN reset for any active user (own-row reset allowed per
// FR-035). Per server-actions.contract.md § 7:
//   1. session + owner gate.
//   2. validate pin shape (4 digits).
//   3. load — must be state='active' AND removed_at IS NULL.
//   4. previousPinSet = target.pin_hash !== null.
//   5. hashPin(pin). UPDATE pin_hash + pin_reset_admin_at = now().
//   6. audit user.pin_reset { previous_pin_set, by, actor: 'admin' }.
//   7. revalidate + redirect ?toast=pin_reset&name=…
//
// Constitution III invariant: raw PIN never appears in the audit payload —
// only the boolean witness `previous_pin_set`.

export async function resetUserPin(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  let pin: string;
  try {
    pin = validatePinShape(String(formData.get("pin") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${ONB_PATH}?error=${encodeURIComponent(err.code)}`);
    }
    throw err;
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, display_name, state, removed_at, pin_hash")
    .eq("id", staffId)
    .single();

  if (loadErr || !target || target.removed_at !== null || target.state !== "active") {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const previousPinSet = target.pin_hash !== null;
  const pinHash = await hashPin(pin);

  const { error: updateErr } = await admin
    .from("staff")
    .update({
      pin_hash: pinHash,
      pin_reset_admin_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  if (updateErr) {
    console.error("resetUserPin: UPDATE failed", updateErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  await recordAudit(
    "user.pin_reset",
    viewer.deviceUserId,
    target.id,
    { previous_pin_set: previousPinSet, by: viewer.deviceUserId, actor: "admin" },
    viewer.staff.id
  );

  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=pin_reset&name=${encodeURIComponent(target.display_name)}`);
}

// ── sendUserPasswordReset ──────────────────────────────────────────────────
//
// Owner-initiated recovery email for a user. Per server-actions.contract.md
// § 8:
//   1. session + owner gate.
//   2. load target — must be state='active' AND email IS NOT NULL.
//   3. (await createSupabaseServerClient()).auth.resetPasswordForEmail(
//        target.email, { redirectTo: '<origin>/auth/callback' })
//   4. AuthRetryableFetchError → ?error=network.
//   5. NO DB mutation.
//   6. audit device.password_reset { method: 'recovery', actor: 'admin', by }.
//      entity_id = null, entity_type = "auth".
//   7. revalidate + redirect ?toast=password_reset_sent&name=…
//
// Uses the cookie-aware SSR client (not service-role): resetPasswordForEmail
// is on the regular client and carries the user's session correctly.

async function deriveOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function sendUserPasswordReset(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, display_name, email, state, removed_at")
    .eq("id", staffId)
    .single();

  if (
    loadErr ||
    !target ||
    target.removed_at !== null ||
    target.state !== "active" ||
    !target.email
  ) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // Use the cookie-aware client — resetPasswordForEmail is on the regular
  // SDK surface, not the admin one.
  const ssr = await createSupabaseServerClient();
  const origin = await deriveOrigin();

  try {
    await ssr.auth.resetPasswordForEmail(target.email, {
      redirectTo: `${origin}/auth/callback`,
    });
  } catch (err) {
    // The SDK throws AuthRetryableFetchError for transient network blips.
    // We detect by name (the class is exported but importing it inflates
    // the bundle; the name is stable across versions).
    const name = (err as { name?: string }).name;
    if (name === "AuthRetryableFetchError") {
      console.error("sendUserPasswordReset: network blip", err);
      redirect(`${ONB_PATH}?error=network`);
    }
    console.error("sendUserPasswordReset: unexpected failure", err);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // audit BEFORE redirect. entity_id = null per the contract (this is an
  // auth-domain event, not a user-domain mutation — the user row is
  // unchanged).
  await recordAudit(
    "device.password_reset",
    viewer.deviceUserId,
    null,
    { method: "recovery", actor: "admin", by: viewer.deviceUserId },
    viewer.staff.id
  );

  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=password_reset_sent&name=${encodeURIComponent(target.display_name)}`);
}

// ── removeUser ──────────────────────────────────────────────────────────────
//
// Hard-remove an offboarded user. Per server-actions.contract.md § 6:
//   1. session + owner gate.
//   2. parse staff_id; load target — must be state='offboarded' AND
//      removed_at IS NULL; else `not_found`.
//   3. validate three gates in order — first-fail wins:
//        a. ack_history === "on"                     → else `ack_required`
//        b. confirm_name match (case-insensitive trim) → else `confirm_name_mismatch`
//        c. ack_irreversible === "on"                → else `ack_required`
//   4. snapshot display_name + email + role BEFORE mutation (audit needs the
//      original identity per FR-052).
//   5. admin.auth.admin.deleteUser(target.user_id) — cascades staff.user_id
//      to NULL via the 0001 FK constraint.
//   6. getNextAnonPlaceholder() → "Former staff #N" (security-definer RPC).
//   7. UPDATE staff SET display_name=anonName, email=null,
//      color_token='--avatar-slate', pin_hash=null, removed_at=now().
//      On trigger 23514|P0001 → `last_owner` (UI should have blocked, the
//      server is the trust boundary).
//   8. audit user.removed { display_name_at_removal, email_at_removal,
//      role_at_removal, by } — Constitution III: awaited BEFORE redirect.
//   9. revalidate + redirect ?toast=removed&name=<encoded original name>.
//
// data-model.md Invariant D: with email=null AND removed_at IS NOT NULL the
// partial unique index staff_email_lower_unique no longer covers the row, so
// the original email is free to re-invite.

export async function removeUser(formData: FormData): Promise<void> {
  // 1: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const ackHistory = String(formData.get("ack_history") ?? "");
  const ackIrreversible = String(formData.get("ack_irreversible") ?? "");
  const confirmName = String(formData.get("confirm_name") ?? "");

  // 2: load target.
  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, display_name, email, role, state, removed_at")
    .eq("id", staffId)
    .single();

  if (loadErr || !target || target.removed_at !== null || target.state !== "offboarded") {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 3: three-gate validation — order matters (first-fail wins per spec).
  if (ackHistory !== "on") {
    redirect(`${ONB_PATH}?error=ack_required`);
  }
  if (confirmName.toLowerCase().trim() !== (target.display_name as string).toLowerCase().trim()) {
    redirect(`${ONB_PATH}?error=confirm_name_mismatch`);
  }
  if (ackIrreversible !== "on") {
    redirect(`${ONB_PATH}?error=ack_required`);
  }

  // 4: snapshot identity for the audit row BEFORE we mutate.
  const snap = {
    display_name: target.display_name as string,
    email: (target.email as string | null) ?? null,
    role: target.role as string,
  };

  // 5: delete the Supabase auth user. The 0001 FK ON DELETE SET NULL
  // cascades staff.user_id to NULL — no explicit clear needed here.
  try {
    if (target.user_id) {
      const adminAuth = (admin as unknown as { auth?: { admin?: unknown } }).auth?.admin as
        | { deleteUser?: (uid: string, shouldSoftDelete?: boolean) => Promise<unknown> }
        | undefined;
      if (adminAuth?.deleteUser) {
        // Explicit hard-delete: the Supabase SDK's `shouldSoftDelete` default
        // is version-dependent; passing `false` ensures the auth.users row is
        // physically removed so the email is freed for re-invite per FR-052
        // and data-model.md Invariant D. Without this, soft-deleted rows
        // continue to occupy the email and `createUser` rejects re-invites
        // with `email_exists`.
        await adminAuth.deleteUser(target.user_id as string, false);
      }
    }
  } catch (err) {
    console.error("removeUser: deleteUser failed", err);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 6: mint the anonymized placeholder via the security-definer RPC.
  let anonName: string;
  try {
    anonName = await getNextAnonPlaceholder();
  } catch (err) {
    console.error("removeUser: getNextAnonPlaceholder failed", err);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 7: anonymize the staff row. The combination of email=null AND removed_at
  // non-null drops it from the staff_email_lower_unique partial index.
  const { error: updateErr } = await admin
    .from("staff")
    .update({
      display_name: anonName,
      email: null,
      color_token: "--avatar-slate",
      pin_hash: null,
      removed_at: new Date().toISOString(),
    })
    .eq("id", target.id as string);

  if (updateErr) {
    const code = (updateErr as { code?: string }).code;
    if (code === "23514" || code === "P0001") {
      // Trigger fired — UI should have blocked, the server is the trust boundary.
      redirect(`${ONB_PATH}?error=last_owner`);
    }
    console.error("removeUser: UPDATE failed", updateErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 8: audit BEFORE redirect (Constitution III). Payload preserves the
  // human-readable original identity per FR-052.
  await recordAudit(
    "user.removed",
    viewer.deviceUserId,
    target.id as string,
    {
      display_name_at_removal: snap.display_name,
      email_at_removal: snap.email,
      role_at_removal: snap.role,
      by: viewer.deviceUserId,
    },
    viewer.staff.id
  );

  // 9: revalidate + redirect with the toast params. The OnboardingToaster
  // fires `removed` as toast.error (destructive tone).
  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=removed&name=${encodeURIComponent(snap.display_name)}`);
}

// ── resendInvite ────────────────────────────────────────────────────────────
//
// Owner-initiated re-issue of a pending invite. Per server-actions.contract.md
// § 2:
//   1. session + owner gate.
//   2. load target — must be state='invited' AND removed_at IS NULL; else
//      ?error=not_found. Also email IS NOT NULL.
//   3. delete the stale auth user, then re-invite via the method-appropriate
//      helper (generateMagicLinkInvite / sendPasswordInvite, both of which
//      call inviteUserByEmail so Supabase actually SENDS the email). The
//      original invite already created an auth user — and the moment the
//      invitee clicks any invite/magic link that user becomes CONFIRMED.
//      inviteUserByEmail rejects a confirmed address with `email_exists`, so
//      a plain re-invite fails for anyone who has clicked their link once
//      (even if the staff row never left `invited`). Deleting first frees
//      the email unconditionally — the FK ON DELETE SET NULL also clears
//      staff.user_id — so the re-invite always lands with a fresh token.
//      The staff row is still state='invited': the invitee never signed in,
//      so no audit chain references their user_id and rotating it is safe.
//   4. UPDATE staff `user_id = <rotated id>`, `invited_at = now()`.
//   5. audit `user.invite_resent { email, method, by }` BEFORE the redirect
//      (Constitution III).
//   6. revalidate + redirect ?toast=resent&name=<display_name>.
//
// On Supabase failure (network blip or auth API error) → ?error=invite_failed.
// On UPDATE failure → ?error=server_error. In both cases NO audit row is
// written — the action surface stays consistent with the rest of this file.

export async function resendInvite(formData: FormData): Promise<void> {
  // 1: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  // 2: parse + load target.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, email, display_name, role, state, invite_method, removed_at")
    .eq("id", staffId)
    .single();

  if (
    loadErr ||
    !target ||
    target.removed_at !== null ||
    target.state !== "invited" ||
    !target.email
  ) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 3: delete the stale auth user, then re-invite. `inviteUserByEmail` rejects
  // an already-confirmed address with `email_exists`, and an invitee's auth
  // user is confirmed the moment they click any invite/magic link — so a plain
  // re-invite fails for anyone who has clicked their link once. Deleting first
  // frees the email unconditionally; the helper then sends a fresh email with
  // a fresh token. generateMagicLinkInvite / sendPasswordInvite carry the
  // method-appropriate /auth/invite-callback redirect (the password variant
  // adds ?method=password so the callback routes to password setup).
  const method: InviteMethod = (target.invite_method as InviteMethod) ?? "magic_link";

  // Best-effort pre-delete: the auth user may already be gone (deleted out of
  // band). A genuine failure here is harmless — if the email is still occupied
  // the re-invite below returns the duplicate sentinel, mapped to invite_failed.
  if (target.user_id) {
    try {
      await deleteInviteUser(target.user_id as string);
    } catch (delErr) {
      console.error("resendInvite: pre-delete failed (continuing)", delErr);
    }
  }

  const inviteMetadata = {
    display_name: target.display_name as string,
    role: target.role as string,
    invited_by: viewer.staff.id,
  };
  let rotatedUserId: string | null = null;
  try {
    const result =
      method === "password"
        ? await sendPasswordInvite(target.email as string, inviteMetadata)
        : await generateMagicLinkInvite(target.email as string, inviteMetadata);
    rotatedUserId = result.user_id;
  } catch (err) {
    console.error("resendInvite: re-invite failed", err);
  }
  if (!rotatedUserId) {
    redirect(`${ONB_PATH}?error=invite_failed`);
  }

  // 4: repoint the staff row at the rotated auth user + bump invited_at.
  const { error: updateErr } = await admin
    .from("staff")
    .update({ user_id: rotatedUserId, invited_at: new Date().toISOString() })
    .eq("id", target.id as string);

  if (updateErr) {
    console.error("resendInvite: UPDATE failed", updateErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 5: audit BEFORE redirect (Constitution III).
  await recordAudit(
    "user.invite_resent",
    viewer.deviceUserId,
    target.id as string,
    {
      email: target.email as string,
      method,
      by: viewer.deviceUserId,
    },
    viewer.staff.id
  );

  // 6: revalidate + redirect.
  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=resent&name=${encodeURIComponent(target.display_name as string)}`);
}

// ── cancelInvite ────────────────────────────────────────────────────────────
//
// Owner-initiated cancel of a pending invite. Per server-actions.contract.md
// § 3:
//   1. session + owner gate.
//   2. load target — must be state='invited' AND removed_at IS NULL; else
//      ?error=not_found.
//   3. snapshot { email, display_name, user_id } BEFORE any deletes — the
//      audit row needs the pre-delete email per audit.contract.md § 3.
//   4. admin.auth.admin.deleteUser(user_id, false) — hard-delete, mirrors
//      Phase 6's fix. Frees the email for future re-invite.
//   5. DELETE staff WHERE id = staff_id. Invited rows have no history worth
//      preserving (no audit references, no completed sessions), so a hard
//      DELETE is correct here — versus offboarded rows which we soft-archive
//      via removed_at and anonymized display_name.
//   6. audit user.invite_cancelled { email: snapshot.email, by } BEFORE
//      redirect (Constitution III). entity_id references the now-deleted
//      staff.id by design (denormalized — see audit.contract.md § 3).
//   7. revalidate + redirect ?toast=cancelled&name=<display_name>.
//
// On Supabase deleteUser failure → ?error=server_error, no staff DELETE,
// no audit. On staff DELETE failure → ?error=server_error (auth user already
// hard-deleted; on next reconciliation the orphan staff row will be cleaned
// up — best-effort).

export async function cancelInvite(formData: FormData): Promise<void> {
  // 1: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  // 2: parse + load.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, email, display_name, state, removed_at")
    .eq("id", staffId)
    .single();

  if (loadErr || !target || target.removed_at !== null || target.state !== "invited") {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 3: snapshot identity BEFORE the deletes — the audit payload carries
  // the pre-delete email per audit.contract.md § 3.
  const snap = {
    email: (target.email as string | null) ?? null,
    display_name: target.display_name as string,
    user_id: (target.user_id as string | null) ?? null,
  };

  // 4: hard-delete the auth user so the email is freed for re-invite per
  // data-model.md Invariant D + Phase 6's hard-delete pattern.
  try {
    if (snap.user_id) {
      const adminAuth = (admin as unknown as { auth?: { admin?: unknown } }).auth?.admin as
        | { deleteUser?: (uid: string, shouldSoftDelete?: boolean) => Promise<unknown> }
        | undefined;
      if (adminAuth?.deleteUser) {
        await adminAuth.deleteUser(snap.user_id, false);
      }
    }
  } catch (err) {
    console.error("cancelInvite: deleteUser failed", err);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 5: DELETE staff row. Invited rows are hard-deleted (no history worth
  // preserving) — contrast with offboard which soft-archives via removed_at.
  const { error: delErr } = await admin
    .from("staff")
    .delete()
    .eq("id", target.id as string);
  if (delErr) {
    console.error("cancelInvite: staff DELETE failed", delErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 6: audit BEFORE redirect. entity_id references the now-deleted staff.id
  // (denormalized — audit.contract.md § 3).
  await recordAudit(
    "user.invite_cancelled",
    viewer.deviceUserId,
    target.id as string,
    { email: snap.email, by: viewer.deviceUserId },
    viewer.staff.id
  );

  // 7: revalidate + redirect.
  revalidatePath(ONB_PATH);
  redirect(`${ONB_PATH}?toast=cancelled&name=${encodeURIComponent(snap.display_name)}`);
}

// ── reactivateUser ──────────────────────────────────────────────────────────
//
// Owner-initiated reactivation of an offboarded user. Per
// server-actions.contract.md § 5:
//   1. session + owner gate.
//   2. load target — must be state='offboarded' AND removed_at IS NULL AND
//      email IS NOT NULL; else `?error=not_found`.
//   3. (no email-conflict check needed — the email is still on this row;
//      we're rotating a fresh token for the same auth user.)
//   4. admin.generateLink({ type:'magiclink', email: target.email, options:
//      { redirectTo: '<origin>/auth/invite-callback' } }) — issues a token;
//      Supabase invalidates any prior token as a side-effect. Always
//      magic_link in v1 per FR-061, regardless of the prior invite_method.
//   5. UPDATE staff SET state='invited', active=false, offboarded_at=NULL,
//      offboarded_by=NULL, offboard_reason=NULL, invited_at=now(),
//      invited_by=viewer.staff.id, invite_method='magic_link', pin_hash=NULL.
//      The staff.id + staff.user_id are PRESERVED — this is the invariant
//      that keeps the audit chain consistent across the offboard→reactivate
//      cycle (a future `device.signed_in` row's `actor_user_id` matches the
//      original auth.users.id).
//   6. audit `user.reactivated { method: 'magic_link', by }` BEFORE the
//      redirect (Constitution III).
//   7. revalidate + redirect `?toast=reactivated&name=<display_name>`.
//
// On generateLink failure → `?error=invite_failed`, no UPDATE, no audit.
// On UPDATE failure → `?error=server_error`, no audit (token already rotated
// but the staff row didn't flip — the orphaned link will simply expire).

export async function reactivateUser(formData: FormData): Promise<void> {
  // 1: session + owner gate.
  const viewer = await requireStudioSession();
  assertOwner(viewer);

  // 2: parse + load target.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("id, user_id, email, display_name, state, removed_at")
    .eq("id", staffId)
    .single();

  if (
    loadErr ||
    !target ||
    target.removed_at !== null ||
    target.state !== "offboarded" ||
    !target.email
  ) {
    redirect(`${ONB_PATH}?error=not_found`);
  }

  // 4: issue a fresh magic-link. Reactivate is always magic_link in v1 per
  // FR-061, regardless of the user's prior invite_method.
  //
  // Fallback: if `generateLink` fails (most commonly because the auth user
  // was hard-deleted out of band — e.g. by a prior `removeUser` flow that
  // ran against this same record before it was re-seeded), re-create the
  // auth user via `generateMagicLinkInvite`. That helper internally calls
  // createUser → generateLink, so the magic-link email still goes out and
  // we capture a NEW user_id we must persist on the staff row.
  let resolvedUserId: string | null = (target.user_id as string | null) ?? null;
  try {
    const adminAuth = (admin as unknown as { auth?: { admin?: unknown } }).auth?.admin as
      | {
          generateLink?: (args: {
            type: string;
            email: string;
            options?: { redirectTo?: string };
          }) => Promise<{ error: { message: string } | null }>;
        }
      | undefined;
    if (!adminAuth?.generateLink) {
      throw new Error("supabase admin.generateLink unavailable");
    }
    const { error } = await adminAuth.generateLink({
      type: "magiclink",
      email: target.email as string,
      options: { redirectTo: `${await inviteOrigin()}/auth/invite-callback` },
    });
    if (error) throw error;
  } catch (err) {
    console.error("reactivateUser: generateLink failed, falling back to recreate", err);
    try {
      const result = await generateMagicLinkInvite(target.email as string, {
        display_name: target.display_name as string,
        invited_by: viewer.staff.id,
      });
      if (!result.user_id) {
        // Genuinely couldn't reach Supabase — surface the standard error.
        redirect(`${ONB_PATH}?error=invite_failed`);
      }
      resolvedUserId = result.user_id;
    } catch (err2) {
      if (
        err2 instanceof Error &&
        (err2 as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")
      ) {
        throw err2;
      }
      console.error("reactivateUser: recreate fallback failed", err2);
      redirect(`${ONB_PATH}?error=invite_failed`);
    }
  }

  // 5: UPDATE — preserve id + user_id; flip state to 'invited'; clear the
  // offboard_* metadata; set fresh invite metadata; force magic_link;
  // clear any stale pin_hash (offboard already nulled it, but be explicit).
  const { error: updateErr } = await admin
    .from("staff")
    .update({
      // If the fallback recreated the auth user, persist the new uuid so the
      // staff↔auth pairing stays intact for the eventual sign-in (R11).
      user_id: resolvedUserId,
      state: "invited",
      active: false,
      offboarded_at: null,
      offboarded_by: null,
      offboard_reason: null,
      invited_at: new Date().toISOString(),
      invited_by: viewer.staff.id,
      invite_method: "magic_link",
      pin_hash: null,
    })
    .eq("id", target.id as string);

  if (updateErr) {
    console.error("reactivateUser: UPDATE failed", updateErr);
    redirect(`${ONB_PATH}?error=server_error`);
  }

  // 6: audit BEFORE redirect (Constitution III).
  await recordAudit(
    "user.reactivated",
    viewer.deviceUserId,
    target.id as string,
    { method: "magic_link", by: viewer.deviceUserId },
    viewer.staff.id
  );

  // 7: revalidate + redirect.
  revalidatePath(ONB_PATH);
  redirect(
    `${ONB_PATH}?toast=reactivated&name=${encodeURIComponent(target.display_name as string)}`
  );
}

// ── getInviteLink ───────────────────────────────────────────────────────────
//
// Server-side helper invoked imperatively from the pending-row menu's
// "Copy invite link" handler. Returns the current rotated invite URL so the
// client can write it to the clipboard via `navigator.clipboard.writeText`.
//
// IMPORTANT: this primitive ALSO rotates the prior token (Supabase invalidates
// the prior link as a side-effect of generateLink / inviteUserByEmail). That
// matches the documented UX caveat in quickstart.md — Copy link is equivalent
// to a silent Resend from the user's perspective, sans the email send.
//
// Takes a plain string arg (not FormData) because the client invokes it
// imperatively from a button click handler:
//   const result = await getInviteLink(target.id);
//   if ("link" in result) navigator.clipboard.writeText(result.link);
//
// Per Next 16 Server Actions can take any JSON-serializable arg shape.

export async function getInviteLink(
  staffId: string
): Promise<{ link: string } | { error: string }> {
  const viewer = await requireStudioSession();
  if (viewer.staff.role !== "owner") return { error: "forbidden" };

  if (!staffId) return { error: "not_found" };

  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("staff")
    .select("email, state, invite_method, removed_at")
    .eq("id", staffId)
    .single();

  if (
    loadErr ||
    !target ||
    target.removed_at !== null ||
    target.state !== "invited" ||
    !target.email
  ) {
    return { error: "not_found" };
  }

  try {
    const method: InviteMethod = (target.invite_method as InviteMethod) ?? "magic_link";
    const adminAuth = (admin as unknown as { auth?: { admin?: unknown } }).auth?.admin as
      | {
          generateLink?: (args: {
            type: string;
            email: string;
            options?: { redirectTo?: string };
          }) => Promise<{
            data?: { properties?: { action_link?: string } };
            error: { message: string } | null;
          }>;
        }
      | undefined;
    if (!adminAuth?.generateLink) {
      throw new Error("supabase admin.generateLink unavailable");
    }
    const origin = await inviteOrigin();
    const { data, error } = await adminAuth.generateLink({
      type: method === "password" ? "invite" : "magiclink",
      email: target.email as string,
      options: {
        redirectTo:
          method === "password"
            ? `${origin}/auth/invite-callback?method=password`
            : `${origin}/auth/invite-callback`,
      },
    });
    if (error) throw error;
    const link = data?.properties?.action_link ?? "";
    if (!link) return { error: "invite_failed" };
    return { link };
  } catch (err) {
    console.error("getInviteLink: generateLink failed", err);
    return { error: "invite_failed" };
  }
}
