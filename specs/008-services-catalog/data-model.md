# Phase 1 — Data Model: Services catalog (top-level /services)

**Feature**: `008-services-catalog` · **Date**: 2026-05-15

Schema delta, app-layer types, validation rules, state transitions, and invariants for the Services catalog. The authoritative source for column types is the migration this document is the basis for: `supabase/migrations/0003_services_catalog.sql`.

Two **new** tables (`public.services`, `public.staff_services`) and one CHECK-constraint **extension** on the existing `public.audit_log.action`. No new columns on existing tables; no new RLS roles.

Audit payloads use `acting_as_staff_id` as the sole accountability key — this feature has no manager-PIN inline override (consistent with the staff feature post-clarification-Q1 in 006).

---

## 1. Entities

### 1.1 Service (`public.services`) — NEW

| Column                  | Type           | Constraints                                                            | Notes                                                          |
|-------------------------|----------------|------------------------------------------------------------------------|-----------------------------------------------------------------|
| `id`                    | `uuid`         | PK, `default gen_random_uuid()`                                        |                                                                  |
| `name`                  | `text`         | `not null`, app-validated `length(trim(name)) >= 2`                    | Display label                                                    |
| `category`              | `text`         | `not null check (length(trim(category)) > 0)`; default `'Other'`       | Free-text; auto-complete-from-existing                           |
| `duration_min`          | `int`          | `not null check (duration_min > 0)`                                    | Service's default (R2 — no variable duration in v1)               |
| `price_cents`           | `int`          | `not null check (price_cents >= 0)`                                    | For variable-price = `price_from_cents` or 0 (R1)                |
| `color_token`           | `text`         | `not null`; one of the 8 `--avatar-*` token names                      | Reuses staff-feature palette (R4 in 006)                         |
| `taxable`               | `boolean`      | `not null default true` (DB); app default is `false` on new services   | Captured + stored; no read site outside drawer in v1             |
| `active`                | `boolean`      | `not null default true`                                                | `false` = archived (R5)                                          |
| `variable_price`        | `boolean`      | `not null default false`                                               | Drives UI label; not a duration concept (R2)                     |
| `price_from_cents`      | `int`          | nullable; `check (price_from_cents is null or price_from_cents >= 0)`  | Variable-price bound                                             |
| `price_to_cents`        | `int`          | nullable; `check (price_to_cents is null or price_to_cents >= 0)`      | Variable-price bound                                             |
| `variable_price_note`   | `text`         | nullable                                                                | Captured; no display site outside drawer in v1                   |
| `created_at`            | `timestamptz`  | `not null default now()`                                                |                                                                  |
| `updated_at`            | `timestamptz`  | `not null default now()`                                                | Touched by `services_set_updated_at_trg`                         |

#### Cross-column CHECK constraints

- `services_variable_bounds_chk`: `((variable_price = false) or (price_from_cents is null or price_to_cents is null or price_to_cents >= price_from_cents))` — when both bounds are set, `to >= from`.
- `services_fixed_price_consistency_chk`: `((variable_price = true) or (price_from_cents is null and price_to_cents is null and variable_price_note is null))` — fixed-price services must not carry variable-only fields. This protects against drift if `variable_price` is toggled off and a stale write doesn't clear the trailing columns; the Server Action always nulls them but the constraint is the trust boundary.

#### Indexes

- `services_active_category_name_idx`: `on public.services (active, category, name) where active = true` — partial index keyed for the hot list query (active services sorted by category then name).
- `services_category_distinct_idx`: `on public.services (category)` — supports the `select distinct category` auto-complete query.

#### Trigger

- `services_set_updated_at_trg`: `before update on public.services for each row` — sets `new.updated_at = now()` when any non-`updated_at` column changes. Same shape as the (existing) staff trigger.

### 1.2 Staff service assignment (`public.staff_services`) — NEW

| Column                   | Type           | Constraints                                                          | Notes                                                            |
|--------------------------|----------------|----------------------------------------------------------------------|-------------------------------------------------------------------|
| `staff_id`               | `uuid`         | `not null references public.staff(id) on delete cascade`             |                                                                   |
| `service_id`             | `uuid`         | `not null references public.services(id) on delete cascade`          |                                                                   |
| `duration_min_override`  | `int`          | nullable; `check (duration_min_override is null or duration_min_override > 0)` | `null` = fall back to `services.duration_min`              |
| `created_at`             | `timestamptz`  | `not null default now()`                                              |                                                                   |
| `updated_at`             | `timestamptz`  | `not null default now()`                                              | Touched by `staff_services_set_updated_at_trg`                    |
| **PK**                   |                | `primary key (staff_id, service_id)`                                  |                                                                   |

#### Indexes

- `staff_services_service_id_idx`: `on public.staff_services (service_id)` — supports "who can perform service X?" (drawer load) and the per-service tech-count aggregation on the list.
- The PK doubles as an efficient "what services does staff Y perform?" index when querying by `staff_id` first.

#### Trigger

- `staff_services_set_updated_at_trg`: `before update on public.staff_services for each row` — only touches `updated_at` when `duration_min_override` actually changes.

### 1.3 Audit log (`public.audit_log`) — extended verb vocabulary

No DB-side schema change. `audit_log.action` is declared `text not null` with no CHECK constraint (verified against `supabase/migrations/0001_auth_schema.sql`); the controlled vocabulary lives at the application layer via the `AuditAction` TypeScript union in `lib/auth/audit.ts`. This feature extends that union with four new verbs:

- `service.added`
- `service.updated`
- `service.archived`
- `service.restored`

`entity_type` for these four new verbs is `'service'`; `entity_id` is the affected `services.id`. `acting_as_staff_id` is the operator. `actor_user_id` is the device user (`auth.uid()`).

The `lib/auth/audit.ts` helper updates the `AuditAction` union to include the four new verbs and replaces the hard-coded `STAFF_ENTITY_ACTIONS` set with a prefix-based dispatch table:

```ts
const ENTITY_TYPE_BY_PREFIX: ReadonlyArray<[string, "service" | "staff" | "auth"]> = [
  ["service.", "service"],
  ["staff.added", "staff"],
  ["staff.updated", "staff"],
  ["staff.pin_set", "staff"],
  ["staff.deactivated", "staff"],
  ["staff.reactivated", "staff"],
  ["staff.removed", "staff"],
];
```

Anything not matched routes to `"auth"` (preserves the 003 sign-in / sign-out behavior).

---

## 2. RLS posture

Both new tables have RLS enabled (`alter table … enable row level security`). Policies:

| Table             | Policy name                                | Operation | Role          | Body            |
|-------------------|--------------------------------------------|-----------|---------------|------------------|
| `services`        | `services_read_any_authenticated`          | `select`  | `authenticated` | `true`         |
| `staff_services`  | `staff_services_read_any_authenticated`    | `select`  | `authenticated` | `true`         |

No `insert`, `update`, or `delete` policy on either table. All writes go through Server Actions backed by `createSupabaseServiceRoleClient()` which bypasses RLS. Kiosk JWT does not authenticate as `authenticated` audience and therefore gets no read access (parallel to every existing non-`walk_ins` table).

---

## 3. App-layer types

```ts
// app/(studio)/services/_types.ts

export type AvatarColorToken =
  | "--avatar-rose" | "--avatar-blue" | "--avatar-green" | "--avatar-amber"
  | "--avatar-purple" | "--avatar-teal" | "--avatar-orange" | "--avatar-slate";

// Row shape returned by the page's hot read query (used by the list).
export type CatalogService = {
  id: string;
  name: string;
  category: string;
  duration_min: number;
  price_cents: number;
  color_token: AvatarColorToken;
  taxable: boolean;
  active: boolean;
  variable_price: boolean;
  price_from_cents: number | null;
  price_to_cents: number | null;
  variable_price_note: string | null;
  // Aggregated server-side; assignment_count counts active staff only.
  assignment_count: number;
};

// Per-tech assignment row inside the edit drawer's draft.
export type ServiceAssignment = {
  staff_id: string;
  duration_min_override: number | null;
};

// Full drawer baseline for an existing service (Edit mode).
export type ServiceDraftBaseline = CatalogService & {
  assignments: ServiceAssignment[];
};

// Active staff row used by the staff-assignment list. Mirrors the
// existing staff page's roster projection minus the PIN columns.
export type AssignableStaff = {
  id: string;
  display_name: string;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
  active: true;
};
```

The page passes `roster: CatalogService[]`, `assignableStaff: AssignableStaff[]`, and (when `?selected=<id>` is present) `selectedBaseline: ServiceDraftBaseline` as props to the catalog list + drawer client islands.

---

## 4. Validation rules (Server Action layer)

`app/(studio)/services/_validation.ts` exposes a validator per field. Each throws `ValidationError(code)` and the action prelude maps it to a `?error=<code>` redirect.

| Validator                  | Field                    | Rule                                                                  | Error code              |
|----------------------------|--------------------------|-----------------------------------------------------------------------|--------------------------|
| `validateName`             | `name`                   | `length(trim) >= 2`                                                   | `name_too_short`         |
| `validateCategory`         | `category`               | `length(trim) >= 1`; trimmed                                          | `category_required`      |
| `validateDurationMin`      | `duration_min`           | positive integer                                                      | `invalid_duration`       |
| `validateFixedPriceDollars`| `price` (dollars string) | non-negative decimal with ≤2 fractional digits; converts to cents     | `invalid_price`          |
| `validateBoundDollars`     | `price_from` / `price_to`| if non-empty: non-negative decimal ≤2 fractional; null otherwise      | `invalid_bound`          |
| `validateBoundsConsistency`| pair                     | when both bounds are set, `to >= from`                                | `bounds_inverted`        |
| `validateColor`            | `color_token`            | one of the 8 `--avatar-*` tokens                                      | `invalid_color`          |
| `validateOverrideMin`      | per-tech override        | nullable; if set, positive integer                                    | `invalid_override`       |
| `validateUuid`             | `service_id` / `staff_id`| UUID v4 shape                                                          | `not_found`              |

The drawer enforces the same shapes client-side so the Save button stays disabled, but the Server Action validators are the trust boundary.

---

## 5. State transitions

### 5.1 Per-service lifecycle

```
                ┌─────────────┐
   addService → │ active=true │
                └──────┬──────┘
                       │ archiveService
                       ▼
                ┌──────────────┐
                │ active=false │
                └──────┬───────┘
                       │ restoreService
                       ▼
                ┌─────────────┐
                │ active=true │
                └─────────────┘
```

`updateService` is allowed in either state. `staff_services` rows are preserved across the archive/restore cycle (FR-028).

### 5.2 Per-assignment lifecycle (inside `updateService`'s assignment diff)

For each staff in the drawer's "Who can perform this service?" list:

| Baseline | Draft | Operation                                        |
|----------|-------|--------------------------------------------------|
| absent   | unticked | no-op                                          |
| absent   | ticked   | `insert` row with override = typed value (or null) |
| present  | unticked | `delete` row                                    |
| present  | ticked, same override | no-op                                |
| present  | ticked, different override | `update` row's `duration_min_override` |

The diff is computed by `_diff.ts` and applied inside the action's single transaction.

### 5.3 Drawer state machine

See `research.md § R12`. States: `closed`, `add-clean`, `add-dirty`, `edit-clean`, `edit-dirty`, plus overlays `confirm-discard` and `confirm-archive`.

---

## 6. Invariants

1. **Every service has at least one category section.** `category` is non-null and trimmed-non-empty, so the list grouping is total — no orphan rows.
2. **`price_cents` is always queryable.** For variable-price services, downstream readers can still rely on `price_cents` for sort-by-price or other heuristics; the `variable_price` flag is the only signal needed to format it as a range.
3. **`staff_services` rows reference live entities.** Cascade-on-delete protects against orphan rows; in practice neither parent is ever hard-deleted (services use `active`, staff use `removed_at`), so cascades only fire in test cleanup.
4. **Archive/restore preserves assignments.** No assignment row is touched by `archiveService` or `restoreService`.
5. **`audit_log.action like 'service.%' → entity_type = 'service'`.** Enforced by the helper's prefix dispatch and by code review of any future audit verb additions.
6. **Historical price snapshots are independent of catalog edits.** When `appointment_services` and `ticket_items` exist (future features), their `price_cents_snapshot` and `duration_min_snapshot` columns are filled from `services` at the moment of booking/checkout; later edits to the `services` row never rewrite history (system-design § "Snapshotting").
7. **List sort is deterministic.** `category ASC, name ASC` everywhere; both the SQL `order by` and the client `_sort.ts` apply the same comparator so a streaming render and a fully-hydrated render produce the same order.
8. **One open mutation per service at a time.** Last-write-wins on the `services` row (no optimistic locking); `staff_services` writes for a single service happen inside the same transaction as the service `update` so a concurrent edit cannot leave the assignment list half-mutated.

---

## 7. Migration outline

```sql
-- supabase/migrations/0003_services_catalog.sql

-- 1. services
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Other'
    check (length(trim(category)) > 0),
  duration_min int not null check (duration_min > 0),
  price_cents int not null check (price_cents >= 0),
  color_token text not null,
  taxable boolean not null default true,
  active boolean not null default true,
  variable_price boolean not null default false,
  price_from_cents int check (price_from_cents is null or price_from_cents >= 0),
  price_to_cents int check (price_to_cents is null or price_to_cents >= 0),
  variable_price_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_variable_bounds_chk check (
    variable_price = false
      or price_from_cents is null
      or price_to_cents is null
      or price_to_cents >= price_from_cents
  ),
  constraint services_fixed_price_consistency_chk check (
    variable_price = true
      or (price_from_cents is null
          and price_to_cents is null
          and variable_price_note is null)
  )
);

create index if not exists services_active_category_name_idx
  on public.services (active, category, name)
  where active = true;

create index if not exists services_category_distinct_idx
  on public.services (category);

-- 2. updated_at trigger (services)
create or replace function public.services_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists services_set_updated_at_trg on public.services;
create trigger services_set_updated_at_trg
  before update on public.services
  for each row execute function public.services_set_updated_at();

-- 3. staff_services
create table if not exists public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  duration_min_override int
    check (duration_min_override is null or duration_min_override > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (staff_id, service_id)
);

create index if not exists staff_services_service_id_idx
  on public.staff_services (service_id);

-- 4. updated_at trigger (staff_services)
create or replace function public.staff_services_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_services_set_updated_at_trg on public.staff_services;
create trigger staff_services_set_updated_at_trg
  before update on public.staff_services
  for each row execute function public.staff_services_set_updated_at();

-- 5. RLS
alter table public.services enable row level security;
alter table public.staff_services enable row level security;

create policy services_read_any_authenticated
  on public.services for select to authenticated using (true);

create policy staff_services_read_any_authenticated
  on public.staff_services for select to authenticated using (true);

-- 6. audit_log — no schema change. action is plain text; the controlled
--    vocabulary lives in the AuditAction union in lib/auth/audit.ts.
```

No data backfill is required because the `audit_log` table contains no `service.*` rows yet. The application-layer change is described in § 1.3 (extend `AuditAction`, replace `STAFF_ENTITY_ACTIONS` with a prefix-based dispatch).
