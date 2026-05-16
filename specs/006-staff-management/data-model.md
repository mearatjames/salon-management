# Phase 1 — Data Model: Staff management (Settings → Staff)

**Feature**: `006-staff-management` · **Date**: 2026-05-15 (refreshed
post-Clarifications session 2026-05-15)

This document captures the schema delta, app-layer types, validation rules,
state transitions, and invariants for the Settings → Staff feature. The
authoritative source for column types is the migration file produced from
this document: `supabase/migrations/0002_staff_management.sql`.

The two tables this feature touches — `public.staff` and `public.audit_log`
— already exist from feature 003 (`supabase/migrations/0001_auth_schema.sql`).
This feature **adds one column** (`removed_at`), **adds one trigger**
(`staff_assert_owner_present`), **migrates one set of color tokens**, and
**extends one controlled-vocabulary enum** (`AuditAction`).

Audit payloads carry **no `authorizing_staff_id`** because the
manager-PIN override is no longer part of the feature (Clarifications Q1).
`acting_as_staff_id` on the `audit_log` row is the sole accountability key
for every mutation.

---

## 1. Entities

### 1.1 Staff (`public.staff`) — extended

| Column         | Type           | Constraints                                                       | Source        | Used by                                             |
|----------------|----------------|-------------------------------------------------------------------|---------------|-----------------------------------------------------|
| `id`           | `uuid`         | PK, `default gen_random_uuid()`                                   | 003           | All                                                 |
| `user_id`      | `uuid`         | `references auth.users(id) on delete set null`                    | 003           | Existing — out of scope for v1 edits                |
| `display_name` | `text`         | `not null`, app-validated `length(trim(display_name)) >= 2`       | 003           | All UI                                              |
| `role`         | `text`         | `not null`, CHECK `in ('owner','manager','technician','front_desk')` | 003       | Sort, gate, label                                   |
| `pin_hash`     | `text`         | nullable; bcryptjs cost 11; **CHECK `pin_hash IS NOT NULL OR user_id IS NOT NULL`** | 003 | PIN modal, /select-staff                       |
| `color_token`  | `text`         | `not null`; one of the 8 `--avatar-*` token names (R4)            | 003 (renamed) | Avatar                                              |
| `active`       | `boolean`      | `not null default true`                                            | 003           | Roster filter, /select-staff visibility             |
| `created_at`   | `timestamptz`  | `not null default now()`                                           | 003           | "Added" column                                      |
| **`removed_at`** | `timestamptz` | **NEW** — nullable; non-NULL = soft-removed                       | **006**       | All roster reads filter `removed_at is null`        |

#### Validation rules (Server Action layer)

| Field         | Rule                                                              | Error code           |
|---------------|-------------------------------------------------------------------|----------------------|
| `display_name`| Trimmed length ≥ 2 characters                                     | `name_too_short`     |
| `role`        | One of `owner` / `manager` / `technician` / `front_desk` AND in the operator's allowed set per the permission matrix (R2) | `invalid_role` / `forbidden_target` |
| `color_token` | One of the 8 known `--avatar-*` tokens                            | `invalid_color`      |
| `pin` (when set) | Exactly 4 ASCII digits (`/^\d{4}$/`)                           | `invalid_pin_shape`  |
| `active`      | Boolean                                                            | (form-coerced)       |

#### Tokens accepted in `color_token`

`--avatar-rose`, `--avatar-blue`, `--avatar-green`, `--avatar-amber`,
`--avatar-purple`, `--avatar-teal`, `--avatar-orange`, `--avatar-slate`.
Enforced app-side; not a DB CHECK (so palette can be extended without a
migration).

#### State transitions

```
            removed_at = null
                 │
        (Add)    │
       ─────────►┌──────────┐
                 │  active  │◄─────── reactivateStaff
                 │  = true  │              ▲
                 └────┬─────┘              │
                      │ deactivateStaff    │
                      ▼                    │
                 ┌──────────┐              │
                 │  active  │──────────────┘
                 │  = false │
                 └────┬─────┘
                      │ removeStaff
                      ▼
            removed_at = now()      ← terminal for the roster;
                                       row remains for FK integrity
```

The Add and Edit flows never set `removed_at`. Only `removeStaff` sets it;
no Server Action *clears* it (un-remove is not in scope per spec).

#### Indexes

`staff_active_role_idx` already exists `on public.staff (active, role)`.

This feature adds:

```sql
create index if not exists staff_roster_idx
  on public.staff (removed_at, role, display_name)
  where removed_at is null;
```

…which is the exact key shape the roster query (R8) sorts by.

### 1.2 Audit entry (`public.audit_log`) — extended via app enum

No schema change. The `action` column is `text` (no DB CHECK constraint);
the controlled vocabulary lives in `lib/auth/audit.ts` as a TypeScript
union. This feature extends that union from 5 verbs to **11 verbs**:

```ts
export type AuditAction =
  // From feature 003 (kept verbatim)
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  // Added by feature 006
  | "staff.added"
  | "staff.updated"
  | "staff.pin_set"
  | "staff.deactivated"
  | "staff.reactivated"
  | "staff.removed";
```

The function is renamed `recordAuth` → `recordAudit` with a one-release
alias (R11).

#### Payload shape (per verb)

| `action`              | `entity_type` | `entity_id`        | `payload` keys (jsonb)                                              |
|-----------------------|---------------|--------------------|---------------------------------------------------------------------|
| `staff.added`         | `"staff"`     | new staff id       | `{ display_name, role, color_token, pin_set: boolean }`             |
| `staff.updated`       | `"staff"`     | target staff id    | `{ changes: { display_name?, role?, color_token?, active? }, before, after }` |
| `staff.pin_set`       | `"staff"`     | target staff id    | `{ previous_pin_set: boolean }` (raw PIN never logged)              |
| `staff.deactivated`   | `"staff"`     | target staff id    | `{}`                                                                |
| `staff.reactivated`   | `"staff"`     | target staff id    | `{}`                                                                |
| `staff.removed`       | `"staff"`     | removed staff id   | `{ display_name_at_removal, role_at_removal }`                      |

`actor_user_id` is the device Supabase user (`auth.uid()`).
`acting_as_staff_id` is the operator's `staff.id` from the cookie. There
is **no `authorizing_staff_id`** in any payload — the manager-PIN override
was removed per Clarifications Q1.

The `staff.pin_failed` verb from feature 003 retains its original payload
flavors (`"mismatch"`, `"invalid_target"`). It is not extended by this
feature.

### 1.3 Studio viewer — extended (in-memory only)

The existing `StudioViewer` type from `lib/auth/session.ts:18-26` is
reused unchanged. The Settings shell augments it with per-target permission
flags computed in the page Server Component:

```ts
type StaffPagePermissions = {
  canEnter: boolean;                        // viewer.staff.role in ('owner','manager')
  roleOptions: StudioRole[];                // owner sees [owner, manager, technician, front_desk]; manager sees [manager, technician, front_desk]
};

type StaffTargetPermissions = {
  isSelf: boolean;
  isLastOwner: boolean;
  canEditAnyField: boolean;                 // manager × owner-target = false
  canEditDisplayName: boolean;
  canEditRole: boolean;                     // false if isSelf || isLastOwner || manager × owner
  canEditColor: boolean;
  canToggleActive: boolean;                 // false if isSelf || isLastOwner || manager × owner
  canSetPin: boolean;                       // false if manager × owner
  canDeactivate: boolean;                   // false if !canToggleActive || target.active === false
  canReactivate: boolean;                   // false if !canToggleActive || target.active === true
  canRemove: boolean;                       // false if isSelf || isLastOwner || manager × owner
};
```

The matrix lives in
`app/(studio)/settings/staff/permissions.ts` as pure functions consumed by
the edit panel client island and by every Server Action.

### 1.4 Settings shell tabs (in-memory, no persistence)

```ts
const SETTINGS_TABS = [
  { id: "general",       label: "General",       implemented: false },
  { id: "staff",         label: "Staff",         implemented: true  },
  { id: "notifications", label: "Notifications", implemented: false },
  { id: "billing",       label: "Billing",       implemented: false },
];
```

`/settings` (the root) redirects to `/settings/staff`; once implemented,
`/settings/general` becomes the default.

---

## 2. Last-owner invariant

A DB trigger guarantees that the active, present-on-roster owner count
never drops to zero (R5). Implemented as:

```sql
create or replace function public.staff_assert_owner_present()
returns trigger
language plpgsql
as $$
declare
  active_owners int;
begin
  select count(*) into active_owners
  from public.staff
  where role = 'owner'
    and active = true
    and removed_at is null
    and id <> coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op in ('INSERT','UPDATE')
     and new.role = 'owner'
     and new.active = true
     and new.removed_at is null then
    active_owners := active_owners + 1;
  end if;

  if active_owners < 1 then
    raise exception 'staff_assert_owner_present: at least one active owner must remain'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_assert_owner_present_trg on public.staff;
create trigger staff_assert_owner_present_trg
  before update or delete
  on public.staff
  for each row
  execute function public.staff_assert_owner_present();
```

The trigger fires on UPDATE (covers demote, deactivate, soft-delete via
`removed_at = now()`) and DELETE. It does **not** fire on INSERT because
INSERT only ever increases the active owner count.

---

## 3. RLS

No new RLS policies. Existing policies from `0001_auth_schema.sql`:

- `staff_select_authenticated` allows any authenticated user to SELECT.
- Writes have no policy → service-role only.

The Settings page reads via the **server client** (`lib/db/server.ts` —
the cookie-aware authenticated client). All mutations go through the
service-role client inside the Server Actions, mirroring feature 003's
pattern (`recordAuth` uses `createSupabaseServiceRoleClient()`).

---

## 4. Migrations

### `supabase/migrations/0002_staff_management.sql`

```sql
-- Migration: 0002_staff_management.sql
-- Feature: 006-staff-management

-- 1. Soft-delete column
alter table public.staff
  add column if not exists removed_at timestamptz;

-- 2. Roster index (the page's hot query)
create index if not exists staff_roster_idx
  on public.staff (removed_at, role, display_name)
  where removed_at is null;

-- 3. Color-token rename (one-shot; safe to re-run)
update public.staff
   set color_token = case color_token
     when '--accent-rose'   then '--avatar-rose'
     when '--accent-amber'  then '--avatar-amber'
     when '--accent-violet' then '--avatar-purple'
     when '--accent-green'  then '--avatar-green'
     when '--accent-blue'   then '--avatar-blue'
     when '--accent-teal'   then '--avatar-teal'
     when '--accent-orange' then '--avatar-orange'
     when '--accent-slate'  then '--avatar-slate'
     else color_token
   end
 where color_token like '--accent-%';

-- 4. Last-owner trigger
create or replace function public.staff_assert_owner_present()
returns trigger
language plpgsql
as $$
declare
  active_owners int;
begin
  select count(*) into active_owners
  from public.staff
  where role = 'owner'
    and active = true
    and removed_at is null
    and id <> coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op in ('INSERT','UPDATE')
     and new.role = 'owner'
     and new.active = true
     and new.removed_at is null then
    active_owners := active_owners + 1;
  end if;

  if active_owners < 1 then
    raise exception 'staff_assert_owner_present: at least one active owner must remain'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_assert_owner_present_trg on public.staff;
create trigger staff_assert_owner_present_trg
  before update or delete
  on public.staff
  for each row
  execute function public.staff_assert_owner_present();
```

The seed file `supabase/seed.sql` is updated in the same commit to emit
the new `--avatar-*` token strings, so `supabase db reset` produces
consistent data on a fresh checkout.

---

## 5. Generated types

After the migration runs locally, regenerate types:

```bash
npx supabase gen types typescript --local > lib/db/types.ts
```

The only delta in `lib/db/types.ts` is the new `removed_at: string | null`
column on the `staff` row type. All app code reads it as
`row.removed_at !== null` for the "is removed" check.

---

## 6. Invariants summary

| # | Invariant                                                                          | Enforced by                                                             |
|---|------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| 1 | At least one active, non-removed owner exists at all times.                        | DB trigger `staff_assert_owner_present_trg` + Server Action pre-check  |
| 2 | Operator cannot demote / deactivate / remove themselves.                           | Server Action checks `target.id !== viewer.staff.id` (R6) + UI tooltip |
| 3 | Manager cannot mutate any field on an owner row.                                   | Permission matrix (R2) — server + UI (Clarifications Q4)               |
| 4 | Manager can only assign role values in `{manager, technician, front_desk}`.        | Permission matrix (R2) — server + role-select scope (Clarifications Q3)|
| 5 | `color_token` is one of the 8 known `--avatar-*` strings.                          | Server Action validation + Lacquer CSS fallback                        |
| 6 | `pin_hash` is bcryptjs cost 11; raw PIN is never persisted or audit-logged.        | `hashPin()` is the only writer; audit payload deliberately omits the field |
| 7 | `removed_at` is monotonically settable (no un-remove).                             | No Server Action clears it; no UI exposes a path                       |
| 8 | Roster sorting is `role_priority`, then `display_name` ASC, case-insensitive.      | SQL `ORDER BY` (R8); client mirror in the filter island                |

`role_priority` SQL expression: `CASE role WHEN 'owner' THEN 0 WHEN
'manager' THEN 1 WHEN 'technician' THEN 2 WHEN 'front_desk' THEN 3 END`.
Same shape used by the existing `/select-staff` query.

---

## 7. Out of scope (deferred to future features)

- `email`, `phone`, `hire_date`, `commission_rate`, `permissions[]` columns
  — explicitly deferred (spec Assumption).
- Multi-tenant staff sharing across salons — system design defers
  multi-tenant to v2.
- Realtime invalidation of the roster — deferred (R10).
- Deactivation-dialog upcoming-appointment count — explicitly deferred to
  the appointments feature (Clarifications Q2). This feature does not
  query or reference the `appointments` table.
- Two-actor authorization (manager-PIN inline override) — removed from
  scope per Clarifications Q1.
