# Server Actions contract — 006-staff-management

All six actions live in `app/(studio)/settings/staff/actions.ts`. They
share the prelude described in `README.md`. This document is the
per-action specification.

## Shared prelude (every action)

```ts
"use server";

// 1. Resolve operator
const viewer = await requireStudioSession();

// 2. Operator role gate (defense in depth — layout already blocked this)
if (!["owner", "manager"].includes(viewer.staff.role)) {
  redirect("/dashboard?error=forbidden");
}

// 3. Parse FormData (per-action; see sections below)

// 4. (Skipped for addStaff) Load target row + compute isLastOwner
const target = await loadTarget(staff_id);
if (!target) {
  redirect(`/settings/staff?error=not_found`);
}
const isLastOwner = await computeIsLastOwner(target);

// 5. Permission-matrix check (the trust boundary)
try {
  assertMutationAllowed(
    { operator: viewer.staff, target, isLastOwner },
    action,
    newRole // for role mutations only
  );
} catch (err) {
  if (err instanceof PermissionError) {
    redirect(`/settings/staff?selected=${target?.id ?? ""}&error=${err.code}`);
  }
  throw err;
}

// 6. Mutation

// 7. Audit — must be awaited before redirect
await recordAudit("staff.<verb>", viewer.deviceUserId, viewer.staff.id, payload);

// 8. Revalidate + redirect
revalidatePath("/settings/staff");
redirect(`/settings/staff?selected=${targetId}&toast=<key>&name=${encodeURIComponent(name)}`);
```

If the mutation itself throws (last-owner trigger fires, etc.), the
action does **not** record audit and redirects with `?error=last_owner`.
The trigger raises with `errcode=check_violation`, which the action
catches and maps to the error code.

`redirect()` throws internally inside Next 16, so it's always the
terminating line of every branch (no need for `return`).

**No `overridePin` field on any action.** The override is gone per
Clarifications Q1.

---

## 1. `addStaff`

**Purpose**: Create a new staff row.

**FormData**:

| Field          | Type                                                | Required | Validation                                       |
|----------------|-----------------------------------------------------|----------|--------------------------------------------------|
| `display_name` | `string`                                            | Yes      | Trimmed length ≥ 2                               |
| `role`         | `"owner" \| "manager" \| "technician" \| "front_desk"` | Yes      | One of the four AND in `roleOptionsFor(operator)` |
| `color_token`  | `--avatar-…` string                                 | Yes      | One of the 8 (R4)                                |
| `pin`          | `string` (4 digits)                                 | No       | When present, exactly `/^\d{4}$/`                |

Permission-matrix check uses `action="add"` with the chosen `role` as
`newRole`. Manager attempting to add an owner → `forbidden_target`/`
invalid_role` (caught by role-set scope gate).

**Successful redirect**:

```
/settings/staff?selected=<new_id>&toast=staff_added&name=<display_name>
```

**Audit**: `staff.added` with payload `{ display_name, role, color_token,
pin_set }`.

**Error codes**: `name_too_short`, `invalid_role`, `invalid_color`,
`invalid_pin_shape`, `forbidden`.

---

## 2. `updateStaff`

**Purpose**: Atomic edit of any of `display_name`, `role`, `color_token`,
`active`. Submitted with the full target id + all four fields (the Server
Action computes the diff from the saved row).

**FormData**:

| Field          | Type                  | Required | Validation                       |
|----------------|-----------------------|----------|----------------------------------|
| `staff_id`     | `uuid`                | Yes      | Row exists, `removed_at is null` |
| `display_name` | `string`              | Yes      | Trimmed length ≥ 2               |
| `role`         | enum                  | Yes      | One of the four AND allowed for operator |
| `color_token`  | `--avatar-…`          | Yes      | One of the 8                     |
| `active`       | `"on" \| undefined`   | No       | Form-coerced to boolean          |

**Permission-matrix check**: One call per changed field, picking the
matching action:

- `display_name` change → `update_name`
- `role` change → `update_role` (with `newRole`)
- `color_token` change → `update_color`
- `active` change → `update_active`

A single rejected field aborts the whole save. The first rejection's
error code is the redirect's `?error=`. (In practice the UI prevents
this — controls are disabled for fields the operator can't change — but
the server check is the trust boundary.)

**Validation extras**:

- Diff is empty (no field changed) → `?error=no_changes` (a soft error;
  page-level toast; can't actually happen because the Save button is
  disabled when there's no diff, but defense in depth).

**Successful redirect**:

```
/settings/staff?selected=<staff_id>&toast=changes_saved
```

If the change was `active: true → false`, also include
`toast=staff_deactivated` and `name=<display_name>`. The reactivate path
(`false → true`) uses `toast=changes_saved`.

**Audit**: `staff.updated` with `{ changes: {...}, before: {...},
after: {...} }`. No `authorizing_staff_id` (override is gone).

**Error codes**: `name_too_short`, `invalid_role`, `invalid_color`,
`forbidden_target`, `last_owner`, `self_edit_blocked`, `not_found`.

---

## 3. `setStaffPin`

**Purpose**: Hash and persist a new PIN for a staff member (used by both
"Set PIN" and "Change PIN" — they're the same operation server-side).

**FormData**:

| Field         | Type      | Required | Validation                          |
|---------------|-----------|----------|-------------------------------------|
| `staff_id`    | `uuid`    | Yes      | Row exists, `removed_at is null`    |
| `pin`         | `string`  | Yes      | Exactly 4 digits                    |

Permission-matrix action: `set_pin`. Allowed: owner × any target, manager
× non-owner target, any × self. Rejected: manager × owner target →
`forbidden_target`.

**Behavior**:

```ts
const hash = await hashPin(pin);
await supabase.from("staff").update({ pin_hash: hash }).eq("id", staff_id);
```

**Successful redirect**:

```
/settings/staff?selected=<staff_id>&toast=pin_updated
```

**Audit**: `staff.pin_set` with `{ previous_pin_set: boolean }`. The raw
PIN is **never** in the payload (Constitution III + spec FR-030).

**Error codes**: `invalid_pin_shape`, `forbidden_target`, `not_found`.

---

## 4. `deactivateStaff`

**Purpose**: Set `active=false`.

**FormData**:

| Field      | Type   | Required | Validation                            |
|------------|--------|----------|---------------------------------------|
| `staff_id` | `uuid` | Yes      | Row exists, currently `active=true`   |

Permission-matrix action: `deactivate`. Allowed: owner × any (except
self), manager × non-owner (except self).

**Behavior**:

- Pre-check via matrix: self → `self_edit_blocked`; manager × owner →
  `forbidden_target`; last-owner → `last_owner`.
- `update staff set active=false where id=$1`.

**Successful redirect**:

```
/settings/staff?selected=<staff_id>&toast=staff_deactivated&name=<display_name>
```

**Audit**: `staff.deactivated` with `{}`.

**Error codes**: `forbidden_target`, `last_owner`, `self_edit_blocked`,
`not_found`.

---

## 5. `reactivateStaff`

**Purpose**: Set `active=true`.

**FormData**:

| Field      | Type   | Required | Validation                                                   |
|------------|--------|----------|--------------------------------------------------------------|
| `staff_id` | `uuid` | Yes      | Row exists, `removed_at is null`, currently `active=false`   |

Permission-matrix action: `reactivate`. Allowed by the same matrix as
`deactivate` (manager × owner still blocked).

**Successful redirect**:

```
/settings/staff?selected=<staff_id>&toast=changes_saved
```

**Audit**: `staff.reactivated` with `{}`.

**Error codes**: `forbidden_target`, `not_found`.

---

## 6. `removeStaff`

**Purpose**: Soft-delete (set `removed_at=now()`).

**FormData**:

| Field      | Type      | Required | Validation                                           |
|------------|-----------|----------|------------------------------------------------------|
| `staff_id` | `uuid`    | Yes      | Row exists, `removed_at is null`                     |

Permission-matrix action: `remove`. Allowed: owner × non-self, manager ×
(non-self, non-owner). Rejected: self → `self_edit_blocked`; manager ×
owner → `forbidden_target`; last-owner → `last_owner`.

**Behavior**:

```sql
update staff set removed_at = now(), active = false where id = $1
```

Setting `active=false` in the same statement keeps the `/select-staff`
query (which only filters on `active`) internally consistent with the
new `removed_at` filter.

**Successful redirect**:

```
/settings/staff?toast=staff_removed&name=<display_name_at_removal>
```

(Note: no `?selected=` — the row is gone; the panel returns to the
empty state.)

**Audit**: `staff.removed` with `{ display_name_at_removal,
role_at_removal }`. No `authorizing_staff_id`.

**Error codes**: `forbidden_target`, `last_owner`, `self_edit_blocked`,
`not_found`.

---

## Error-code → UX mapping

| Code                  | Where it surfaces                                                                 |
|-----------------------|-----------------------------------------------------------------------------------|
| `name_too_short`      | Inline error directly under the display-name input                                |
| `invalid_role`        | Inline error under the role select                                                |
| `invalid_color`       | Inline error near the color picker                                                |
| `invalid_pin_shape`   | PIN modal: dot row flashes error, returns to Enter step                           |
| `pin_mismatch`        | Same as `invalid_pin_shape` (only fires during Add wizard's combined post)        |
| `forbidden_target`    | Page-level Sonner toast (destructive variant): "Only owners can edit owner accounts." (or generic message if the operator hit some other gate). |
| `last_owner`          | Page-level Sonner toast (destructive variant): "At least one owner must remain."  |
| `self_edit_blocked`   | Page-level Sonner toast: "You can't change your own role, deactivate, or remove yourself." |
| `not_found`           | Page-level Sonner toast: "That staff member was removed by another tab."          |
| `no_changes`          | Silent no-op; clears `?error=no_changes` from the URL immediately                 |
| `forbidden`           | Dashboard: page-level Sonner toast: "Staff settings is restricted to owners and managers." |

## Idempotency

None of the six actions are idempotent at the wire level. Re-submits are
suppressed by React 19 `useFormStatus` (Save / Set PIN / Confirm buttons
disable while pending).

## Auditable promise

Every successful path writes exactly one `audit_log` row before
redirecting. Failure paths that don't get past validation OR permission
checks write **zero** rows. Constitution III's "every mutation … MUST
be recorded" still holds because a rejected mutation produced **no**
DB write.
