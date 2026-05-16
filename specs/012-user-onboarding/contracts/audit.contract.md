# Audit Contract — User Onboarding

The seven new `user.*` AuditAction values + two payload extensions to
existing events. Persisted to `public.audit_log` via the existing
`recordAudit` helper (no schema change).

`entity_type` for every `user.*` event is `"user"` (derived from prefix
by the extended `deriveEntityType` — see `../data-model.md § 2`).
`acting_as_staff_id` is the **acting owner's `staff.id`** for every
event (matches the `staff.*` pattern from 006).

## 1. `user.invited` — FR-031

Written by `inviteUser` on successful invite (R11 step 7).

```json
{
  "action": "user.invited",
  "actor_user_id": "<owner.user_id>",
  "acting_as_staff_id": "<owner.staff.id>",
  "entity_type": "user",
  "entity_id": "<new_staff.id>",
  "payload": {
    "email": "hana@tangnails.com",
    "role": "technician",
    "method": "magic_link",
    "pin_set": false,
    "by": "<owner.user_id>"
  }
}
```

**Invariant**: `payload.method ∈ {"magic_link","password"}`. `payload.pin_set` is `true` iff the Thorough wizard captured a PIN.

## 2. `user.invite_resent` — FR-032

Written by `resendInvite`.

```json
{
  "action": "user.invite_resent",
  "entity_id": "<staff.id>",
  "payload": {
    "email": "<row.email>",
    "method": "<row.invite_method>",
    "by": "<owner.user_id>"
  }
}
```

The Supabase admin call rotates the token; the prior link is invalidated server-side. Subsequent `device.signed_in` rows from the user contain the new `method` value.

## 3. `user.invite_cancelled` — FR-032

Written by `cancelInvite` after `admin.deleteUser` succeeds.

```json
{
  "action": "user.invite_cancelled",
  "entity_id": "<staff.id_before_delete>",
  "payload": {
    "email": "<snapshot.email>",
    "by": "<owner.user_id>"
  }
}
```

The `entity_id` references the staff row that **no longer exists** after the action commits (the audit row is written before the staff DELETE? — no, ordering: audit writes after DELETE per Constitution III "audit writes after the mutation succeeds"). This is acceptable per the existing `staff.removed` pattern (audit references a soft-deleted row); the `entity_id` is denormalized + the payload carries the email.

## 4. `user.offboarded` — FR-042

Written by `offboardUser`.

```json
{
  "action": "user.offboarded",
  "entity_id": "<staff.id>",
  "payload": {
    "reason": "Left the salon",
    "by": "<owner.user_id>"
  }
}
```

`payload.reason` is `null` when the owner skipped the optional reason field.

## 5. `user.reactivated` — FR-061

Written by `reactivateUser`.

```json
{
  "action": "user.reactivated",
  "entity_id": "<staff.id>",
  "payload": {
    "method": "magic_link",
    "by": "<owner.user_id>"
  }
}
```

`method` is always `"magic_link"` in v1 (FR-061 mandates magic-link reactivation).

## 6. `user.removed` — FR-052

Written by `removeUser` after the anonymization UPDATE succeeds.

```json
{
  "action": "user.removed",
  "entity_id": "<staff.id>",
  "payload": {
    "display_name_at_removal": "Hana Soto",
    "email_at_removal": "hana@tangnails.com",
    "role_at_removal": "technician",
    "by": "<owner.user_id>"
  }
}
```

The `entity_id` references the (now anonymized) staff row. The payload preserves the human-readable identity for compliance reviews — without it, an audit-log query for "what happened to Hana?" would find nothing.

## 7. `user.pin_reset` — FR-036

Written by `resetUserPin`.

```json
{
  "action": "user.pin_reset",
  "entity_id": "<staff.id>",
  "payload": {
    "previous_pin_set": true,
    "by": "<owner.user_id>",
    "actor": "admin"
  }
}
```

Distinguishes from the existing `staff.pin_set` audit event (006) which has no `actor` field and represents the user setting their own PIN in Settings → Staff. `actor: "admin"` flags this as an owner-initiated reset (FR-036).

## 8. `device.password_reset` — payload extension (owner-initiated path)

Written by `sendUserPasswordReset`. Reuses the existing event from 010 (FR-070 says explicitly "Existing `device.password_reset` events MUST be reused without renaming").

```json
{
  "action": "device.password_reset",
  "actor_user_id": "<owner.user_id>",
  "acting_as_staff_id": "<owner.staff.id>",
  "entity_type": "auth",
  "entity_id": null,
  "payload": {
    "method": "recovery",
    "actor": "admin",
    "by": "<owner.user_id>"
  }
}
```

The self-serve path (010) continues to write `{ "method": "recovery" }` without `actor` or `by` (which a downstream consumer reads as `actor: "user"` by default). FR-038 explicitly: "the self-serve path uses `actor=user` and omits `by`".

**Two-row pattern**: the request-side row (above) is followed by a completion-side row when the user submits the new password — also `device.password_reset`, but written by `updatePassword` in `/reset-password/actions.ts` (010). The completion row carries no `actor` or `by` (it's the user submitting; the original initiator's tag is on the request row). An audit-log query for "owner-initiated resets" reads `actor='admin'` rows; for "user-completed resets" reads any `device.password_reset` row.

## 9. `device.signed_in` — payload extension (`method: "invite"`)

Written by `/auth/callback` for the `?type=invite` branch (R8). Existing event, new payload value.

```json
{
  "action": "device.signed_in",
  "actor_user_id": "<invitee.user_id>",
  "entity_type": "auth",
  "entity_id": null,
  "payload": {
    "method": "invite"
  }
}
```

`payload.method` now ranges over `{"magic_link", "oauth_google", "oauth_other", "recovery", "invite"}`.

## Cross-event invariants

- Every `user.*` row has `entity_id` set (a staff.id, possibly anonymized).
- Every `user.*` row has `acting_as_staff_id` set (the owner who initiated).
- Every `user.*` row's `payload.by` equals `actor_user_id` (redundant by design — lets payload-only queries skip the JOIN).
- An `inviteUser` flow produces **one** audit row (`user.invited`). The follow-up `device.signed_in` row (when the invitee accepts) is the user's own first sign-in, not part of the invite event.
- An `offboardUser` flow produces **one** audit row (`user.offboarded`). The `signOut` call does not produce an audit row.
- A `removeUser` flow produces **one** audit row (`user.removed`). The `admin.deleteUser` does not produce a separate `device.signed_out` (the row was already offboarded; the auth row deletion is a side effect).
- A `sendUserPasswordReset` produces **one** audit row at request time (`device.password_reset` with `actor: "admin"`). If the user completes, a **second** `device.password_reset` row is written (no `actor`). Together they form a two-row receipt.

## Audit-row read access

Existing 0001 RLS: `authenticated` can `SELECT` from `audit_log` but NOT the `payload` column (revoked). `service_role` has full access. The Onboarding page does not surface audit log entries to the user; this feature adds no new read paths.

## Test coverage

`tests/e2e/onboarding.spec.ts` asserts each event type by querying `audit_log WHERE action = '<event>' ORDER BY ts DESC LIMIT 1` immediately after the corresponding UI action. Per the per-test audit cursor convention (`tests/e2e/_db.ts:newAuditCursor / getAuditLogRowsSince` — memory: `feedback_scope_intermediate_e2e_gates`), each test scopes its assertion to rows written since `newAuditCursor()` was taken at test start, so parallel workers don't race.
