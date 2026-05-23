# Data Model — User Onboarding & Offboarding

This feature requires **one migration** (`0004_user_onboarding.sql`)
that extends `public.staff` with lifecycle, invite, and offboard
metadata, plus a `staff_anon_counter` sequence for the hard-remove
placeholder. No new tables. The `public.audit_log` schema is unchanged;
the TypeScript `AuditAction` union and the `deriveEntityType` dispatch
in `lib/auth/audit.ts` are extended at the application layer only.

## 1. `public.staff` — column additions

| Column | Type | Default | Source | Purpose |
|---|---|---|---|---|
| `state` | `text` | `'active'` | NEW | Lifecycle state. CHECK `state in ('active','invited','offboarded')`. Backfill: all existing rows are `'active'` (they all have `active=true AND removed_at IS NULL` per 006). |
| `email` | `text` | `NULL` | NEW | Display email + uniqueness check source. Mirrors `auth.users.email` at invite time. Cleared to `NULL` on hard remove (FR-052). |
| `invited_at` | `timestamptz` | `NULL` | NEW | Set when invite is sent. Surfaces in the Pending row's "Invited 2 days ago" metadata (FR-004). |
| `invited_by` | `uuid` | `NULL` | NEW | The acting owner's `staff.id`. References `public.staff(id) ON DELETE SET NULL`. |
| `invite_method` | `text` | `NULL` | NEW | One of `'magic_link' | 'password'`. CHECK `invite_method in ('magic_link','password') OR invite_method IS NULL`. |
| `offboarded_at` | `timestamptz` | `NULL` | NEW | Set when offboard completes (FR-042). |
| `offboarded_by` | `uuid` | `NULL` | NEW | The acting owner's `staff.id`. References `public.staff(id) ON DELETE SET NULL`. |
| `offboard_reason` | `text` | `NULL` | NEW | One of the five values from `OFFBOARD_REASONS` plus `'Other'`. Free text but UI-bounded. |
| `last_sign_in_at` | `timestamptz` | `NULL` | NEW | Updated by `/auth/callback` on every successful sign-in (R10). Surfaces in Active row metadata. |
| `pin_reset_admin_at` | `timestamptz` | `NULL` | NEW | Set when an owner resets the PIN via Onboarding row menu (FR-035). Cleared by the next successful PIN auth in `/select-staff` (R9). |

### CHECK constraints added by 0004

```sql
-- The 0001 staff_pin_or_user check ((pin_hash IS NOT NULL) OR
-- (user_id IS NOT NULL)) survives unchanged — every invited row gets
-- a user_id at invite time (R11), so the constraint is satisfied even
-- when pin_hash is NULL.

ALTER TABLE public.staff
  ADD CONSTRAINT staff_state_check
    CHECK (state IN ('active','invited','offboarded')),
  ADD CONSTRAINT staff_invite_method_check
    CHECK (invite_method IS NULL
        OR invite_method IN ('magic_link','password')),
  -- Coherence: invite metadata is set IFF state = 'invited'.
  -- The action layer enforces this; the constraint backstops it.
  ADD CONSTRAINT staff_invite_meta_coherent
    CHECK (
      (state = 'invited' AND invited_at IS NOT NULL
                          AND invite_method IS NOT NULL)
      OR
      (state <> 'invited')
    ),
  -- Coherence: offboard metadata is set IFF state = 'offboarded'.
  ADD CONSTRAINT staff_offboard_meta_coherent
    CHECK (
      (state = 'offboarded' AND offboarded_at IS NOT NULL)
      OR
      (state <> 'offboarded')
    );
```

### Indexes added by 0004

```sql
-- Roster query: WHERE removed_at IS NULL ORDER BY <bucket>, then per
-- bucket. The existing staff_roster_idx (0002) covers role+display_name
-- for the active bucket. Two additional partial indexes accelerate the
-- pending and offboarded buckets, both small in practice.
CREATE INDEX staff_pending_idx
  ON public.staff (invited_at DESC)
  WHERE state = 'invited' AND removed_at IS NULL;

CREATE INDEX staff_offboarded_idx
  ON public.staff (offboarded_at DESC)
  WHERE state = 'offboarded' AND removed_at IS NULL;

-- Email-conflict check (R3). lower(email) is the indexed expression so
-- the SELECT can be ILIKE-equivalent without a Seq Scan.
CREATE UNIQUE INDEX staff_email_lower_unique
  ON public.staff (lower(email))
  WHERE email IS NOT NULL AND removed_at IS NULL;
```

### Sequence added by 0004

```sql
-- Per-salon (single-tenant DB) monotonic counter for hard-remove
-- placeholder display names: "Former staff #1", "Former staff #2", …
CREATE SEQUENCE IF NOT EXISTS public.staff_anon_counter START WITH 1;

-- Service-role only — no GRANT to authenticated.
```

### Trigger reuse

`staff_assert_owner_present_trg` (introduced in 0002) is **reused
unchanged**. It fires on UPDATE/DELETE; the offboard and remove
actions both UPDATE the row, so the trigger fires and blocks the
last-owner case (FR-044, FR-053). The action maps `errcode=23514` /
`P0001` to `?error=last_owner` (existing pattern in
`app/(studio)/settings/staff/actions.ts:isLastOwnerTriggerError`).

### RLS

No new policies. The existing `staff_select_authenticated` policy
(grants `SELECT` to `authenticated`) covers the roster fetch. All
writes happen via the service-role client (`lib/db/admin.ts`),
which bypasses RLS per the existing constraint.

The Onboarding page additionally enforces owner-only access at the
application layer (FR-002): both the page component
(`requireStudioSession()` + `if (viewer.staff.role !== 'owner')
redirect(...)`) and every server action. A non-owner who somehow
calls the server action POST endpoint directly gets a redirect to
`/dashboard?error=forbidden` (matches the staff actions' pattern).

## 2. `public.audit_log` — application-level extension

No schema change. The TypeScript `AuditAction` union in
`lib/auth/audit.ts` gains seven new members, and `deriveEntityType`
learns to route `user.*` to `entity_type = "user"`:

```ts
export type AuditAction =
  // From feature 003 (entity_type "auth")
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  // Added by feature 010 (entity_type "auth")
  | "device.password_reset"
  // Added by feature 006 (entity_type "staff")
  | "staff.added"
  | "staff.updated"
  | "staff.pin_set"
  | "staff.deactivated"
  | "staff.reactivated"
  | "staff.removed"
  // Added by feature 008 (entity_type "service")
  | "service.added"
  | "service.updated"
  | "service.archived"
  | "service.restored"
  // Added by feature 012 (entity_type "user")
  | "user.invited"
  | "user.invite_resent"
  | "user.invite_cancelled"
  | "user.offboarded"
  | "user.reactivated"
  | "user.removed"
  | "user.pin_reset";

function deriveEntityType(action: AuditAction):
  "service" | "staff" | "auth" | "user" {
  if (action.startsWith("service.")) return "service";
  if (action.startsWith("user.")) return "user";
  if (
    action === "staff.added" ||
    action === "staff.updated" ||
    action === "staff.pin_set" ||
    action === "staff.deactivated" ||
    action === "staff.reactivated" ||
    action === "staff.removed"
  ) {
    return "staff";
  }
  return "auth";
}
```

The DB column `audit_log.entity_type` is `text` with no enum
constraint, so adding `"user"` is a code-only change.

### Audit rows written by this feature

Each `recordAudit` call carries the standard parameters
`(action, deviceUserId, entityId, payload, actingAsStaffId?)`.
For this feature:

| Action | `entity_id` | `acting_as_staff_id` | `payload` shape |
|---|---|---|---|
| `user.invited` | new staff.id | acting owner's staff.id | `{ email, role, method, pin_set, by: <owner.user_id> }` |
| `user.invite_resent` | staff.id | acting owner's staff.id | `{ email, method, by }` |
| `user.invite_cancelled` | staff.id | acting owner's staff.id | `{ email, by }` |
| `user.offboarded` | staff.id | acting owner's staff.id | `{ reason, by }` |
| `user.reactivated` | staff.id | acting owner's staff.id | `{ method, by }` (method of the fresh invite — always magic_link for v1) |
| `user.removed` | staff.id | acting owner's staff.id | `{ display_name_at_removal, email_at_removal, role_at_removal, by }` |
| `user.pin_reset` | staff.id | acting owner's staff.id | `{ previous_pin_set, by, actor: 'admin' }` |
| `device.password_reset` (owner-initiated path) | NULL | acting owner's staff.id | `{ method: 'recovery', actor: 'admin', by }` |
| `device.signed_in` (existing — extended) | NULL | NULL | `{ method: 'invite' \| 'recovery' \| 'magic_link' \| 'oauth_google' \| 'oauth_other' }` |
| `device.password_reset` (existing self-serve) | NULL | NULL | `{ method: 'recovery' }` (no `actor`, no `by`) |

`by` duplicates `acting_as_staff_id` in the payload as a convenience
for audit-log queries that don't join on the foreign key — matches
the pattern in `staff.updated` (which captures `before`/`after` in
the payload).

## 3. State machine

```text
              ┌─────────┐                  ┌────────────┐
   (none) ──→ │ invited │ ────────────────→│   active   │
              └─────────┘  first sign-in   └────────────┘
                  │ cancel                      │ offboard
                  │ (delete staff +             │ (UPDATE state,
                  │  delete auth.users)         │  active=false,
                  ▼                             │  signOut)
              (removed)                          ▼
                                            ┌────────────┐
                                            │ offboarded │
                                            └────────────┘
                                                │  │
                                  reactivate ───┘  └─── remove
                                  (fresh invite,   (delete auth,
                                   state='invited',  anonymize staff,
                                   active=false)    email=NULL,
                                                    display_name=
                                                    "Former staff #N")
                                                       │
                                                       ▼
                                                  (removed —
                                                   staff row stays
                                                   with state='offboarded',
                                                   removed_at=now())
```

Transitions:

| From | Action | To | Side effects |
|---|---|---|---|
| (none) | `inviteUser` | `invited` | `admin.createUser` or `inviteUserByEmail` → `auth.users` row; INSERT into `staff` with `state='invited'`, `active=false`; audit `user.invited`. |
| `invited` | `resendInvite` | `invited` | `admin.generateLink` or `inviteUserByEmail` (rotates token); UPDATE `invited_at=now()`; audit `user.invite_resent`. |
| `invited` | `cancelInvite` | (removed) | `admin.deleteUser`; DELETE staff row (no soft-delete — the invite never existed in any meaningful sense); audit `user.invite_cancelled`. |
| `invited` | `/auth/callback` first sign-in | `active` | UPDATE `state='active'`, `active=true`, `last_sign_in_at=now()`. Idempotent. |
| `active` | `offboardUser` | `offboarded` | `admin.signOut(user_id, 'global')`; UPDATE `state='offboarded'`, `active=false`, `pin_hash=NULL`, `offboarded_at=now()`, `offboarded_by=<owner>`, `offboard_reason=<reason>`; audit `user.offboarded`. Trigger fires; rejects if last owner. |
| `offboarded` | `reactivateUser` | `invited` | `sendImplicitFlowResetEmail(email, '<origin>/auth/invite-callback')` (fresh sign-in link to the existing auth user — `generateLink` only generates, doesn't send; `inviteUserByEmail` rejects `email_exists` on a confirmed address); UPDATE `state='invited'`, `active=false`, `offboarded_at=NULL`, `offboarded_by=NULL`, `offboard_reason=NULL`, `invited_at=now()`, `invited_by=<owner>`, `invite_method='magic_link'`; audit `user.reactivated`. |
| `offboarded` | `removeUser` | (anonymized; `removed_at` set) | `admin.deleteUser(user_id)` → cascades `user_id=NULL` on staff (FK on delete set null from 0001); UPDATE `state='offboarded'` (stays), `display_name='Former staff #N'`, `email=NULL`, `color_token='--avatar-slate'`, `pin_hash=NULL`, `removed_at=now()`; audit `user.removed` with snapshot. Trigger fires; rejects if last owner. |

## 4. Application-level invariants

### Invariant A — `state` and `active` stay coherent

Every transition that writes `state` also writes `active` in the same
UPDATE statement:
- `state='active'` ↔ `active=true`
- `state='invited'` ↔ `active=false`
- `state='offboarded'` ↔ `active=false`

Enforced in the application; the `staff_state_check` and the
existing `/select-staff` query (`active=true AND removed_at IS NULL`)
together make this an externally visible contract.

### Invariant B — `user_id` is non-null for every non-removed staff row

The 0001 CHECK `(pin_hash IS NOT NULL OR user_id IS NOT NULL)` plus
R11's pre-create flow guarantees every row that we *create* through
the Onboarding action set has a `user_id`. The only rows that may
have `user_id IS NULL` are:
- Rows whose `auth.users` was deleted by `removeUser` (cascade
  `ON DELETE SET NULL` from 0001). These have `removed_at IS NOT NULL`.
- Rows added pre-006 that satisfied the CHECK via `pin_hash`. These
  are owner/operator rows seeded for early development; none in
  production.

Either way, the roster query's `WHERE removed_at IS NULL` filter
excludes the first set, and the Onboarding page's owner-only access
gate keeps the second set out of scope.

### Invariant C — last-owner protection is server-enforced

The `staff_assert_owner_present_trg` trigger (0002) fires on any
UPDATE/DELETE that would reduce the active-owner count below 1. The
offboard and remove server actions both UPDATE the row; the trigger
catches them. The UI also performs a pre-flight count for the inline
"Promote another owner first" message but treats the trigger as the
trust boundary (matches the existing staff actions' pattern).

### Invariant D — email uniqueness across the live roster

The partial unique index `staff_email_lower_unique` enforces that no
two non-removed rows can hold the same lowercased email. Removed
rows have `email IS NULL` (cleared by `removeUser`), so a freed email
can be reused (FR-052 last AC).

### Invariant E — sequence-backed anonymization counter never collides

`SELECT nextval('staff_anon_counter')` returns a unique value per
call across all concurrent transactions. Two simultaneous `removeUser`
actions cannot produce the same `Former staff #N` placeholder.

### Invariant F — every PIN written via Onboarding is hashed before INSERT/UPDATE

The shared `hashPin` helper from `lib/auth/pin.ts` is the only path
the Thorough wizard and the Reset PIN modal use. Raw PINs never
touch the DB. The `user.pin_reset` audit payload carries only
`previous_pin_set: boolean` (matches the existing `staff.pin_set`
payload shape).

### Invariant G — invite-method coherence in audit + DB

When a staff row has `invite_method='password'`, the user's first
sign-in goes through `/reset-password?type=invite`, producing
`device.signed_in` with `payload.method='invite'`. When
`invite_method='magic_link'`, the user's first sign-in produces
`device.signed_in` with `payload.method='magic_link'`. An e2e
assertion in `tests/e2e/onboarding.spec.ts` cross-checks the staff
row's `invite_method` against the audit row's `payload.method`.

## 5. Migration footprint

**One migration**: `supabase/migrations/0004_user_onboarding.sql`.
Applied automatically by the two GitHub Actions
(`db-migrate-preview.yml` on PR, `db-migrate-prod.yml` on merge to
main) per CLAUDE.md and Constitution § Schema drift forbidden.

The migration is **idempotent** (`ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS`),
matching the existing migrations' style. The backfill for `state`
runs once: `UPDATE public.staff SET state = 'active' WHERE state IS NULL;`

No `supabase db push` by hand. No data migration risk — the column
additions are all nullable except `state` (which has a default and is
backfilled in the same migration).

## 6. Verification

| Item | Verified by |
|---|---|
| Schema additions land on preview Supabase before Vercel preview deploy | `db-migrate-preview.yml` CI job; PR cannot merge with a schema-vs-code mismatch (Constitution § Schema drift). |
| Backfill sets every existing row to `state='active'` | Migration 0004 final statement; verified by a Vitest fixture that queries `SELECT COUNT(*) FROM staff WHERE state IS NULL` post-migration in dev. |
| `staff_email_lower_unique` blocks concurrent duplicate invites | `tests/unit/settings/onboarding/email-conflict.test.ts` (the action layer) + an e2e fixture that opens two invite sheets and submits the same email — second submission must hit `?error=already_invited`. |
| `staff_anon_counter` is monotonic and per-transaction safe | `tests/unit/settings/onboarding/anon-counter.test.ts` (interacts with a local Postgres via `pgexec`). |
| `device.signed_in` payload `method` matches `staff.invite_method` after first sign-in | `tests/e2e/onboarding.spec.ts` US2 leg (password invite) + US1 leg (magic invite). |
| `staff_assert_owner_present_trg` blocks last-owner offboard and last-owner remove | `tests/e2e/onboarding.spec.ts` last-owner edge case + a Vitest unit on the action's `?error=last_owner` mapping. |
| `pin_reset_admin_at` shows a banner on `/select-staff` and clears on successful PIN | New e2e test in `tests/e2e/select-staff.spec.ts` (FR-035 + R9). |
