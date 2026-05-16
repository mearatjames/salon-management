# Audit contract — 006-staff-management

The single point of truth for what staff-management writes to
`audit_log`. This contract is what `tests/unit/staff/audit.test.ts`
asserts against.

## Type extension

The `AuthAction` union in `lib/auth/audit.ts` is renamed `AuditAction`
and extended with six new verbs.

```ts
// lib/auth/audit.ts
export type AuditAction =
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  | "staff.added"          // NEW
  | "staff.updated"        // NEW
  | "staff.pin_set"        // NEW
  | "staff.deactivated"    // NEW
  | "staff.reactivated"    // NEW
  | "staff.removed";       // NEW

export async function recordAudit(
  action: AuditAction,
  deviceUserId: string | null,
  staffId: string | null = null,
  payload: Record<string, unknown> = {}
): Promise<void> { /* body unchanged */ }

// Back-compat alias — removed in the next auth-touching feature.
export const recordAuth = recordAudit;
export type AuthAction = AuditAction;
```

## Common columns

Every row written by this feature uses:

| Column               | Value                                                              |
|----------------------|--------------------------------------------------------------------|
| `ts`                 | `now()` (DB default)                                               |
| `actor_user_id`      | `viewer.deviceUserId` (the device's Supabase user)                 |
| `acting_as_staff_id` | `viewer.staff.id` (the operator from the cookie)                   |
| `entity_type`        | `"staff"` for all six new verbs                                    |
| `entity_id`          | The target staff row's id (for `staff.added`, the **new** id)      |
| `action`             | The verb from the table below                                      |
| `payload`            | The shape from the table below                                     |

There is **no `authorizing_staff_id`** in any payload — the manager-PIN
inline override was removed per Clarifications Q1. `acting_as_staff_id`
is the sole accountability key.

## Per-verb payload shape

### `staff.added`

```jsonc
{
  "display_name": "Maya Chen",
  "role": "technician",
  "color_token": "--avatar-green",
  "pin_set": true
}
```

`pin_set` is `true` iff the Add wizard's PIN step ran and the user
confirmed a PIN.

### `staff.updated`

```jsonc
{
  "changes": {
    "display_name": ["Maya Chen", "Mei Chen"],
    "role": ["technician", "manager"]
    // …only changed keys appear
  },
  "before": {
    "display_name": "Maya Chen",
    "role": "technician",
    "color_token": "--avatar-green",
    "active": true
  },
  "after": {
    "display_name": "Mei Chen",
    "role": "manager",
    "color_token": "--avatar-green",
    "active": true
  }
}
```

### `staff.pin_set`

```jsonc
{
  "previous_pin_set": false
}
```

`previous_pin_set` is `true` if the row already had a non-null
`pin_hash` before the action. The raw PIN is **never** in the payload,
never in any log, never in any error message.

### `staff.deactivated`

```jsonc
{}
```

Empty payload — `entity_id` already carries the target.

### `staff.reactivated`

```jsonc
{}
```

### `staff.removed`

```jsonc
{
  "display_name_at_removal": "Maya Chen",
  "role_at_removal": "technician"
}
```

The display name and role are snapshotted because the row's `removed_at`
hides it from many future queries; preserving the name makes the audit
log human-readable without joining to the soft-removed row.

### `staff.pin_failed` (unchanged from feature 003)

This feature does NOT extend the verb. Only feature 003 (`/select-staff`)
writes this verb, with its existing flavors `"mismatch"` and
`"invalid_target"`. The pre-clarification plan added an
`"override_invalid"` flavor; that addition is **reverted** because the
override is gone.

## Ordering guarantee

For every successful Server Action invocation, the audit insert is
awaited **before** the redirect. A forensic query on `audit_log`
therefore sees the event no later than the user sees the toast. Failures
that pass validation but fail the permission matrix write **zero** rows
(no mutation, nothing to audit). Unit tests `staff/audit.test.ts` assert
that the happy path produces exactly one row per Server Action call and
that rejected matrix paths produce zero rows.

## Non-controlled-vocabulary fields

The `payload` shapes are intentionally **non-strict** at the column
level (`audit_log.payload` is `jsonb` with no CHECK). The strictness
lives in the TypeScript types and the unit tests. Future features may
add keys to a payload shape without a migration; removing keys requires
a coordinated update to all consumers.
