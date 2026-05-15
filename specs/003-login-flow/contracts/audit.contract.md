# Audit Contract

Every state change in this feature writes one row to `audit_log` via
`recordAuth(...)` from `lib/auth/audit.ts`. The five action values below
are the **complete** vocabulary this feature contributes; future features
extend the union with their own values (`appointment.created`,
`payment.captured`, etc.).

## API

```ts
export type AuthAction =
  | 'device.signed_in'
  | 'device.signed_out'
  | 'staff.signed_in'
  | 'staff.pin_failed'
  | 'staff.switched';

export async function recordAuth(
  action: AuthAction,
  deviceUserId: string | null,
  staffId: string | null,
  payload?: Record<string, unknown>,
): Promise<void>;
```

- Uses the **service-role** Supabase client from `lib/db/admin.ts`.
- Awaited by callers, but failures are logged and swallowed — an audit-
  write blip must not block a legitimate sign-in.
- Always sets `entity_type = 'auth'` and (for the per-staff actions)
  `entity_id = staffId` so future audit queries can use indexed lookups.

## Per-action shape

### `device.signed_in`

Written by:
- `signInWithPassword` Server Action on Supabase success
- `/auth/callback` route handler on a successful OAuth or magic-link
  exchange

| Field | Value |
|-------|-------|
| `actor_user_id` | `user.id` |
| `acting_as_staff_id` | `null` |
| `entity_type` | `'auth'` |
| `entity_id` | `null` |
| `payload` | `{ method: 'password' \| 'oauth_google' \| 'magic_link' }` |

### `device.signed_out`

Written by:
- `signOut` Server Action

| Field | Value |
|-------|-------|
| `actor_user_id` | `viewer.deviceUserId` |
| `acting_as_staff_id` | `viewer.staff?.id ?? null` (best-effort if degraded) |
| `entity_type` | `'auth'` |
| `entity_id` | `null` |
| `payload` | `{}` |

### `staff.signed_in`

Written by:
- `submitPin` Server Action on PIN verification success.

| Field | Value |
|-------|-------|
| `actor_user_id` | `user.id` |
| `acting_as_staff_id` | `staffId` |
| `entity_type` | `'auth'` |
| `entity_id` | `staffId` |
| `payload` | `previousSid ? { previous_staff_id: previousSid } : {}` — set when an existing operator cookie was replaced (i.e., `submitPin` was reached via the Switch-staff path) |

### `staff.pin_failed`

Written by:
- `submitPin` Server Action on any failure path (mismatch, deactivated
  staff, missing pin_hash).

| Field | Value |
|-------|-------|
| `actor_user_id` | `user.id` |
| `acting_as_staff_id` | `null` (no operator was successfully resolved) |
| `entity_type` | `'auth'` |
| `entity_id` | `staffId` (the targeted tile, even when invalid) |
| `payload` | `{ reason: 'mismatch' \| 'invalid_target' }` |

### `staff.switched`

Written by:
- `switchStaff` Server Action.

| Field | Value |
|-------|-------|
| `actor_user_id` | `viewer.deviceUserId` |
| `acting_as_staff_id` | `viewer.staff.id` (the **outgoing** operator — for forensic clarity, the row that was acting when the switch was initiated) |
| `entity_type` | `'auth'` |
| `entity_id` | `viewer.staff.id` |
| `payload` | `{}` |

(The next operator's `staff.signed_in` row, written by the subsequent
`submitPin`, carries `previous_staff_id` so the pair can be correlated
without joining tables — see `staff.signed_in` above.)

## Invariants

- **Coverage** (SC-006 and related FRs): every transition in the state
  diagram from `data-model.md` § 6 has exactly one corresponding audit row.
  Vitest covers each action value; Playwright asserts the row count after
  each scripted scenario.
- **Append-only**: no path in this feature `UPDATE`s or `DELETE`s an
  audit row. (Future retention work, if any, lives outside the auth
  feature.)
- **Best-effort ts**: `ts` is set by Postgres `DEFAULT now()` — never
  client-supplied, even from the service-role caller.
- **Vocabulary discipline**: the `AuthAction` union is the only legal
  source of `action` strings written by this feature. Adding a new value
  requires a contract update + a Vitest case + an audit-log query helper
  update.
