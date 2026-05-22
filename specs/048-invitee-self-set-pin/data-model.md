# Phase 1 Data Model: Invitee self-sets their PIN

**No new tables, columns, enums, constraints, or migrations.** This feature
operates entirely on existing schema. This document records which existing
entities the feature reads and writes, and the one state transition it drives.

## Entities touched

### `staff` (existing table)

The invitee's own row. The feature reads two columns and writes one.

| Column | Type | Role in this feature |
|--------|------|----------------------|
| `id` | uuid | Resolved (via `user_id`) to scope the `pin_hash` write to the invitee's own row. |
| `user_id` | uuid | The link to the Supabase auth user. Matched against the current session's user id to find the invitee's row. Always non-null for an invite-flow row. |
| `pin_hash` | text, nullable | **Read** for the skip-vs-show gate. **Written** once: `NULL → <bcrypt hash>`. |
| `active` / `state` | bool / text | Read indirectly — already flipped to `active=true, state='active'` by `/auth/callback` (R10) before the PIN step. Not modified here. |

Relevant existing constraint — **not violated, not changed**:

```sql
-- supabase/migrations/0001_auth_schema.sql
constraint staff_pin_or_user
  check (pin_hash is not null or user_id is not null)
```

An invite-flow row satisfies this with `user_id IS NOT NULL` both before
(`pin_hash IS NULL`) and after (`pin_hash` set) the transition.

RLS — **not changed**: `staff` has one policy, `staff_select_authenticated
USING (true)`, and no `authenticated` write policy. Reads use the authenticated
server client; the `pin_hash` write uses the service-role client.

### `audit_log` (existing table)

One row is appended when the invitee self-sets their PIN.

| Column | Value written |
|--------|---------------|
| `action` | `"user.pin_set"` — **new value** in the `AuditAction` TypeScript union; the DB column is plain `text` and needs no change. |
| `actor_user_id` | The invitee's Supabase auth user id (the device user). |
| `acting_as_staff_id` | The invitee's own `staff.id` (the operator — here, the invitee themselves). |
| `entity_type` | `"user"` — derived automatically from the `user.` prefix by `deriveEntityType`. |
| `entity_id` | The invitee's own `staff.id`. |
| `payload` | `{ "pin_set": true, "actor": "self" }` — boolean witness only; the raw PIN never appears. |

## State transition

```text
                    invite accepted, password set
                    ( /auth/callback or acceptInvite →
                      updatePassword, method = "invite" )
                                  │
                                  ▼
                            ┌───────────┐
                            │ /set-pin  │  page reads own staff.pin_hash
                            └─────┬─────┘
                  pin_hash IS NULL │ pin_hash already set
                   (quick mode)    │  (thorough mode / owner-set)
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                        ▼
   staff.pin_hash:  NULL  ──setOwnPin──▶  <bcrypt hash>   (no write)
              │            + audit_log row                │
              │            user.pin_set                   │
              └───────────────────┬────────────────────── ┘
                                  ▼
                            /select-staff
            (invitee now passes the .not("pin_hash","is",null)
                   roster filter and can pin in)
```

The `pin_hash` write is **idempotent at the action layer**: `setOwnPin`
re-reads `pin_hash` immediately before writing and, if it is already non-null,
skips the write and the audit row and redirects to `/select-staff` — it never
silently overwrites an existing PIN (spec Edge Cases).

## No-change inventory

- No new migration file.
- `staff.pin_hash`, `audit_log` schema unchanged.
- `select-staff/page.tsx` roster query unchanged — the existing
  `.not("pin_hash", "is", null)` filter is exactly what makes a freshly
  PIN'd invitee appear on the roster with no further change.
- No change to the `staff_pin_or_user` CHECK or any RLS policy.
