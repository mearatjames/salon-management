# Server Actions Contract — User Onboarding

All actions are exported from `app/(studio)/settings/onboarding/actions.ts`.
All accept a `FormData` argument (Next 16 Server Action convention).
All return `Promise<void>` (terminate in `redirect()`).

Shared prelude is documented in `./README.md`. Per-action details follow.

---

## 1. `inviteUser(formData)` — FR-010, FR-012, FR-013, FR-020–FR-024, FR-030, FR-031

**Inputs (FormData fields)**:

| Field | Type | Required | Validation |
|---|---|---|---|
| `mode` | `"quick" \| "thorough"` | yes | exact match |
| `display_name` | string | yes | trimmed, length ≥ 2 |
| `email` | string | yes | RFC 5322 lite regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` |
| `role` | `"owner" \| "manager" \| "technician" \| "front_desk"` | yes | exact match against `roleOptionsFor("owner")` |
| `color_token` | string | yes (thorough), defaulted server-side (quick) | one of the 8-swatch palette in `STAFF_COLORS` |
| `pin` | string (4 digits) | optional (thorough only) | `/^\d{4}$/` if present |
| `method` | `"magic_link" \| "password"` | yes (thorough), defaulted to `magic_link` (quick) | exact match |

**Steps**:

1–2. Prelude (session + owner gate).
3. Validate.
4. Email-conflict check (R3). On conflict, `redirect(?error=already_invited|already_active|was_offboarded)`.
5. Admin API call per method (R1):
   - `magic_link` → `admin.createUser` + `admin.generateLink({ type: 'magiclink' })`.
   - `password` → `admin.inviteUserByEmail`.
   On Supabase error → `redirect(?error=invite_failed)`.
6. INSERT `staff` row: `user_id`, `display_name`, `email`, `role`, `color_token`, `pin_hash` (hashed if present, else NULL), `state='invited'`, `active=false`, `invited_at=now()`, `invited_by=viewer.staff.id`, `invite_method=method`. On `unique_violation` (`23505`) on `staff_email_lower_unique` → roll back via `admin.deleteUser` → `redirect(?error=already_invited)`. On other failure → roll back + `redirect(?error=server_error)`.
7. `recordAudit("user.invited", viewer.deviceUserId, newStaffId, { email, role, method, pin_set, by: viewer.deviceUserId }, viewer.staff.id)`.
8. `revalidatePath("/settings/onboarding")` + `redirect("/settings/onboarding?toast=invited&name=<display_name>")`.

**Success toast**: "Invite sent to {name}".
**Error codes**: `already_invited`, `already_active`, `was_offboarded`, `invite_failed`, `server_error`, plus validation codes (`invalid_email`, `invalid_name`, `invalid_role`, `invalid_color`, `invalid_pin_shape`).

---

## 2. `resendInvite(formData)` — FR-032

**Inputs**: `staff_id` (uuid).

**Steps**:

1–2. Prelude.
3. Validate `staff_id` shape.
4. Load target via `admin.from('staff')...eq('id', staff_id).single()`. Must have `state='invited'` and `removed_at IS NULL`; else `redirect(?error=not_found)`.
5. (no conflict check — same email, same row.)
6. Re-issue link per the row's `invite_method`:
   - `magic_link` → `admin.generateLink({ type: 'magiclink', email })` (rotates the prior token; the prior link is invalidated server-side by Supabase).
   - `password` → `admin.inviteUserByEmail(email)` (Supabase rotates the prior token).
   UPDATE `staff` `invited_at = now()`.
7. `recordAudit("user.invite_resent", viewer.deviceUserId, staff_id, { email, method, by }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=resent&name=<display_name>")`.

**Success toast**: "Invite resent".
**Error codes**: `not_found`, `invite_failed`, `server_error`.

---

## 3. `cancelInvite(formData)` — FR-032

**Inputs**: `staff_id` (uuid).

**Steps**:

1–2. Prelude.
3. Validate.
4. Load target. Must be `state='invited'`; else `redirect(?error=not_found)`.
5. Snapshot `display_name`, `email`, `user_id` for the audit row.
6. `admin.auth.admin.deleteUser(user_id)` (invalidates any outstanding invite link). Then DELETE `staff WHERE id = staff_id` (true delete — invited rows have never produced any history to preserve). On Supabase failure → `redirect(?error=server_error)`.
7. `recordAudit("user.invite_cancelled", viewer.deviceUserId, staff_id, { email: snapshot.email, by }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=cancelled&name=<display_name>")`.

**Success toast**: "Invite to {name} cancelled".

---

## 4. `offboardUser(formData)` — FR-040, FR-041, FR-042, FR-043, FR-044

**Inputs**: `staff_id` (uuid), `reason` (one of the 5 reasons; optional → NULL).

**Steps**:

1–2. Prelude.
3. Validate. If `reason` present, must be in `["Left the salon", "On extended leave", "Role change", "Performance", "Other"]`.
4. Load target. Must be `state='active'`; else `redirect(?error=not_found)`. Reject `target.user_id === viewer.deviceUserId` → `redirect(?error=cannot_offboard_self)` (FR-002 + edge case "Self-offboard via direct request").
5. Pre-flight last-owner count (R5) — informational only.
6. `admin.auth.admin.signOut(target.user_id, 'global')` (R6). Then UPDATE `staff` SET `state='offboarded'`, `active=false`, `pin_hash=NULL`, `offboarded_at=now()`, `offboarded_by=viewer.staff.id`, `offboard_reason=reason`, `pin_reset_admin_at=NULL` (clear any pending notice). On trigger error → `redirect(?error=last_owner)`.
7. `recordAudit("user.offboarded", viewer.deviceUserId, staff_id, { reason, by }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=offboarded&name=<display_name>")`.

**Success toast**: "{name} offboarded".
**Error codes**: `not_found`, `cannot_offboard_self`, `last_owner`, `server_error`, plus validation (`invalid_reason`).

---

## 5. `reactivateUser(formData)` — FR-060, FR-061

**Inputs**: `staff_id` (uuid).

**Steps**:

1–2. Prelude.
3. Validate.
4. Load target. Must be `state='offboarded'` AND `removed_at IS NULL` (i.e. not a hard-removed row); else `redirect(?error=not_found)`.
5. (No conflict check — the email is still on this row's email column; reactivation does not change the email.)
6. `sendImplicitFlowResetEmail(target.email, '<origin>/auth/invite-callback')` — re-sends a fresh sign-in link to the EXISTING auth user (always magic_link on reactivate per spec FR-061). An offboarded user is already email-confirmed, so neither `inviteUserByEmail` (rejects `email_exists`) nor `admin.generateLink` (only generates a token; does not send the email) can deliver. `resetPasswordForEmail` on an implicit-flow client reaches the existing user without touching the auth row — `staff.user_id` is preserved. UPDATE `staff` SET `state='invited'`, `active=false`, `offboarded_at=NULL`, `offboarded_by=NULL`, `offboard_reason=NULL`, `invited_at=now()`, `invited_by=viewer.staff.id`, `invite_method='magic_link'`, `pin_hash=NULL`. On Supabase failure → `redirect(?error=invite_failed)`. (Issue #116.)
7. `recordAudit("user.reactivated", viewer.deviceUserId, staff_id, { method: 'magic_link', by }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=reactivated&name=<display_name>")`.

**Success toast**: "Reactivation invite sent to {name}".

---

## 6. `removeUser(formData)` — FR-050, FR-051, FR-052, FR-053

**Inputs**: `staff_id` (uuid), `confirm_name` (string — must equal `display_name` case-insensitively), `ack_history` (`"on"`), `ack_irreversible` (`"on"`).

**Steps**:

1–2. Prelude.
3. Validate all three confirmation gates:
   - `confirm_name.toLowerCase().trim() === target.display_name.toLowerCase().trim()` → else `?error=confirm_name_mismatch`.
   - `ack_history === "on"` → else `?error=ack_required`.
   - `ack_irreversible === "on"` → else `?error=ack_required`.
4. Load target. Must be `state='offboarded'` AND `removed_at IS NULL`; else `?error=not_found`.
5. Pre-flight last-owner count.
6. Snapshot `display_name`, `email`, `role` for audit. `admin.auth.admin.deleteUser(target.user_id)` (cascades `staff.user_id` to NULL via FK). Then `nextval('staff_anon_counter')` → format `Former staff #N`. UPDATE `staff` SET `display_name = 'Former staff #N'`, `email = NULL`, `color_token = '--avatar-slate'`, `pin_hash = NULL`, `removed_at = now()`. On trigger error → `?error=last_owner`. On any other failure → `?error=server_error`.
7. `recordAudit("user.removed", viewer.deviceUserId, staff_id, { display_name_at_removal: snap.display_name, email_at_removal: snap.email, role_at_removal: snap.role, by }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=removed&name=<snap.display_name>")`.

**Success toast**: "{name} permanently removed" (destructive tone).
**Error codes**: `confirm_name_mismatch`, `ack_required`, `not_found`, `last_owner`, `server_error`.

---

## 7. `resetUserPin(formData)` — FR-035, FR-036

**Inputs**: `staff_id` (uuid), `pin` (4 digits).

**Steps**:

1–2. Prelude.
3. Validate `pin` shape.
4. Load target. Must be `state='active'` AND `removed_at IS NULL`; else `?error=not_found`. (PIN reset is allowed for the viewer's own row — FR-035 explicitly: "every user (including the current owner's own row)".)
5. `previousPinSet = target.pin_hash !== null`.
6. `pinHash = await hashPin(pin)`. UPDATE `staff` SET `pin_hash = pinHash`, `pin_reset_admin_at = now()`.
7. `recordAudit("user.pin_reset", viewer.deviceUserId, staff_id, { previous_pin_set: previousPinSet, by, actor: 'admin' }, viewer.staff.id)`.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=pin_reset&name=<display_name>")`.

**Success toast**: "{name}'s PIN reset. They'll be notified on next sign-in."

---

## 8. `sendUserPasswordReset(formData)` — FR-037, FR-038

**Inputs**: `staff_id` (uuid).

**Steps**:

1–2. Prelude.
3. Validate.
4. Load target. Must be `state='active'` AND `email IS NOT NULL`; else `?error=not_found`.
5. Call `sendImplicitFlowResetEmail(target.email, '<origin>/auth/recovery-callback')` — a `resetPasswordForEmail` issued through a dedicated **implicit-flow** anon client. The reset is admin-initiated for *another* user, so the link is opened in the target's browser, not the owner's; a PKCE link is unusable (its code verifier lives in the owner's browser) and must NOT be used here. The link lands on the `/auth/recovery-callback` client page, which reads the implicit-flow tokens from the URL hash. On `AuthRetryableFetchError` → `?error=network`; any other failure → `?error=server_error`. (Issue #126.)
6. (No DB mutation.)
7. `recordAudit("device.password_reset", viewer.deviceUserId, null, { method: 'recovery', actor: 'admin', by: viewer.deviceUserId }, viewer.staff.id)`. **Note**: this writes only the *request* row; the *completion* row (`device.password_reset` with `actor='user'` semantics) fires later if the user submits the new password.
8. `revalidatePath` + `redirect("/settings/onboarding?toast=password_reset_sent&name=<display_name>")`.

**Success toast**: "Password-reset email sent to {name}."
**Error codes**: `not_found`, `network`, `server_error`.

---

## Idempotency

- **`resendInvite`** is naturally idempotent: re-running it rotates the token again but always succeeds when target is `invited`.
- **`offboardUser`** rejects if target is not `active`; second submit → `?error=not_found` (the row is no longer `active`). No double-offboard audit row.
- **`removeUser`** rejects if target is not `state='offboarded' AND removed_at IS NULL`; second submit → `?error=not_found`. No double-remove audit row.
- **`cancelInvite`** deletes the staff row; second submit hits `not_found`.

Per Constitution III's idempotency-key principle: we don't need per-action idempotency keys here because each action's state transition is atomic and the post-transition state rejects repeats with `not_found`.
