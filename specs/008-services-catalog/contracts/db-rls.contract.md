# Contract: Database schema + RLS

Authoritative source for the two new tables this feature owns. Cited by the migration (`supabase/migrations/0003_services_catalog.sql`) and by every Server Action that writes to either table.

See `data-model.md § 7` for the canonical migration outline; this file is the *contract* — the rules every consumer must respect, in column-by-column form.

---

## 1. `public.services`

### 1.1 Columns

| Column | Type | Constraints | Server Action that may write it |
|---|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` | (system) |
| `name` | `text` | `not null`; app-validated `length(trim) >= 2` | `addService`, `updateService` |
| `category` | `text` | `not null check (length(trim(category)) > 0)`; default `'Other'` | `addService`, `updateService` |
| `duration_min` | `int` | `not null check (duration_min > 0)` | `addService`, `updateService` |
| `price_cents` | `int` | `not null check (price_cents >= 0)`; for `variable_price = true` stores `price_from_cents` (or `0`) | `addService`, `updateService` |
| `color_token` | `text` | `not null`; one of 8 `--avatar-*` tokens | `addService`, `updateService` |
| `taxable` | `boolean` | `not null default true` | `addService`, `updateService` |
| `active` | `boolean` | `not null default true`; `false` = archived | `addService` (true on insert), `archiveService`, `restoreService` |
| `variable_price` | `boolean` | `not null default false` | `addService`, `updateService` |
| `price_from_cents` | `int?` | nullable; `check (is null or >= 0)` | `addService`, `updateService` (cleared when `variable_price = false`) |
| `price_to_cents` | `int?` | nullable; `check (is null or >= 0)` | `addService`, `updateService` (cleared when `variable_price = false`) |
| `variable_price_note` | `text?` | nullable | `addService`, `updateService` (cleared when `variable_price = false`) |
| `created_at` | `timestamptz` | `not null default now()` | (system) |
| `updated_at` | `timestamptz` | `not null default now()`; trigger-maintained | (trigger) |

### 1.2 Cross-column CHECKs

- `services_variable_bounds_chk`: when both `price_from_cents` and `price_to_cents` are set, `price_to_cents >= price_from_cents`.
- `services_fixed_price_consistency_chk`: when `variable_price = false`, `price_from_cents`, `price_to_cents`, and `variable_price_note` must all be NULL.

### 1.3 Indexes

- `services_active_category_name_idx`: partial — `(active, category, name) where active = true`. Hot path for the catalog list query.
- `services_category_distinct_idx`: `(category)`. Backs the auto-complete `select distinct category` query.

### 1.4 Trigger

- `services_set_updated_at_trg`: `before update for each row` → sets `new.updated_at = now()`.

---

## 2. `public.staff_services`

### 2.1 Columns

| Column | Type | Constraints | Server Action that may write it |
|---|---|---|---|
| `staff_id` | `uuid` | `not null references public.staff(id) on delete cascade` | `addService`, `updateService` |
| `service_id` | `uuid` | `not null references public.services(id) on delete cascade` | `addService`, `updateService` |
| `duration_min_override` | `int?` | nullable; `check (is null or > 0)` | `addService`, `updateService` |
| `created_at` | `timestamptz` | `not null default now()` | (system) |
| `updated_at` | `timestamptz` | `not null default now()`; trigger-maintained | (trigger) |
| **PK** | | `primary key (staff_id, service_id)` | |

### 2.2 Indexes

- `staff_services_service_id_idx`: `(service_id)`. Supports the drawer hydration query (`where service_id = $1`) and the per-service tech-count aggregation.

### 2.3 Trigger

- `staff_services_set_updated_at_trg`: `before update for each row` → sets `new.updated_at = now()`.

### 2.4 Cascade behavior

`on delete cascade` is correct because neither parent is ever hard-deleted in normal operation:
- `staff` uses `removed_at` (soft delete) — cascades only fire in test cleanup.
- `services` uses `active = false` (archive) — cascades only fire in test cleanup.

---

## 3. RLS

Both tables `enable row level security`. Policies:

| Table | Policy | Operation | Role | `using` |
|---|---|---|---|---|
| `services` | `services_read_any_authenticated` | `select` | `authenticated` | `true` |
| `staff_services` | `staff_services_read_any_authenticated` | `select` | `authenticated` | `true` |

**No `insert`/`update`/`delete` policies on either table.** All writes go through Server Actions using `createSupabaseServiceRoleClient()` which bypasses RLS. The Server Action prelude is the trust boundary that enforces operator role (see `server-actions.contract.md § Shared prelude`).

Kiosk JWT receives no read access to either table — its audience is not the `authenticated` role; RLS denies. Confirmed by inspecting the kiosk middleware path in `middleware.ts` and the auth helper in `lib/auth/cookie.ts`.

---

## 4. `audit_log` extension (application-layer only)

The migration does **not** touch `audit_log`. The action vocabulary is extended at the application layer in `lib/auth/audit.ts`:

```ts
export type AuditAction =
  // … existing values …
  | "service.added"
  | "service.updated"
  | "service.archived"
  | "service.restored";
```

The `STAFF_ENTITY_ACTIONS` set is replaced with a prefix-based dispatch (see `audit.contract.md § 3`).

---

## 5. Hot query (page-level read)

The page issues two parallel queries:

```sql
-- Catalog list with assignment counts.
select
  s.id, s.name, s.category, s.duration_min, s.price_cents, s.color_token,
  s.taxable, s.active, s.variable_price,
  s.price_from_cents, s.price_to_cents, s.variable_price_note,
  coalesce(ac.assignment_count, 0) as assignment_count
from public.services s
left join (
  select ss.service_id, count(*) filter (where st.active = true and st.removed_at is null) as assignment_count
  from public.staff_services ss
  join public.staff st on st.id = ss.staff_id
  group by ss.service_id
) ac on ac.service_id = s.id
order by s.category, s.name;
```

```sql
-- Assignable staff list (active, non-removed).
select id, display_name, role, color_token
from public.staff
where active = true and removed_at is null
order by display_name;
```

When `?selected=<id>` is present, a third small query loads that service's assignments so the drawer hydrates from props:

```sql
select staff_id, duration_min_override
from public.staff_services
where service_id = $1;
```

All three are issued in parallel inside the RSC.
