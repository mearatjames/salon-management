# DB Migration Contract — `0017_supply_types_catalog.sql`

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17 · **Authority**: `data-model.md § 1` · `research.md § R1, R2, R3, R7, R8`

This contract locks the exact SQL the migration ships. The Supabase CLI wraps each migration file in a single transaction; the steps below run all-or-nothing. The order matters — the audit-log INSERT must run **before** `drop column services.supply_label` so the `from_label` lookup still has a column to read.

---

## 1. `public.supply_types` — table, indexes, trigger, RLS

```sql
-- 1.1 Table.
create table if not exists public.supply_types (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  name_canonical  text        not null generated always as (lower(trim(name))) stored,
  archived        boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint supply_types_name_len_chk check (length(trim(name)) between 2 and 64)
);

-- 1.2 Indexes.
-- Partial unique index — uniqueness only across ACTIVE types (per research §R1).
create unique index if not exists supply_types_name_active_uq
  on public.supply_types (name_canonical) where archived = false;

-- Covers the section's `select … order by archived, name` queries.
create index if not exists supply_types_archived_name_idx
  on public.supply_types (archived, name_canonical);

-- 1.3 Trigger.
drop trigger if exists supply_types_set_updated_at_trg on public.supply_types;
create trigger supply_types_set_updated_at_trg
  before update on public.supply_types
  for each row execute function public.set_updated_at();

-- 1.4 RLS — mirror public.services (research §R8).
alter table public.supply_types enable row level security;

drop policy if exists supply_types_select_authenticated on public.supply_types;
create policy supply_types_select_authenticated
  on public.supply_types
  for select to authenticated using (true);
-- NO insert/update/delete policies — writes go via service-role client.
```

---

## 2. `public.services` — add FK column

```sql
-- 2.1 Add nullable FK; ON DELETE RESTRICT (research §R7).
alter table public.services
  add column if not exists supply_type_id uuid
    references public.supply_types(id) on delete restrict;
```

Note: no index on `services.supply_type_id` — the catalog list reads services with all fields by id, and the section's reverse query (`select services where supply_type_id = $1`) hits ≤30 type buckets across ≤100 services, well within the planner's seq-scan budget.

---

## 3. Backfill

```sql
-- 3.1 Seed supply_types from distinct legacy labels. Whitespace-collapse +
-- trim; deduped by the partial unique index via `on conflict do nothing`
-- (which the DISTINCT in the SELECT also short-circuits).
insert into public.supply_types (name)
select distinct regexp_replace(trim(supply_label), '\s+', ' ', 'g') as name
  from public.services
 where supply_label is not null
   and length(trim(supply_label)) > 0
on conflict do nothing;

-- 3.2 Point every affected service at its matching type id.
update public.services s
   set supply_type_id = (
     select id from public.supply_types st
      where st.name_canonical = regexp_replace(lower(trim(s.supply_label)), '\s+', ' ', 'g')
   )
 where s.supply_label is not null;
```

Post-conditions: every `services` row with `supply_label is not null` has `supply_type_id is not null`. SC-002 (every distinct legacy label → exactly one active type row) is satisfied by the partial unique index + DISTINCT pre-select. SC-003 (services with null `supply_label` stay null on `supply_type_id`) is satisfied because the UPDATE's WHERE clause excludes them.

---

## 4. Audit-log INSERT (must run BEFORE step 5)

```sql
-- 4.1 Write one supply_type.created row per seeded type, with the system
-- actor marker in payload (research §R3). The `from_label` field is the
-- min() original label that produced this type — useful for debugging if
-- the canonicalization ever surfaces a surprise.
--
-- The `not exists` guard makes this idempotent in case the migration is
-- ever replayed (Supabase CLI defaults to a per-file lock, but defense in
-- depth is cheap).
insert into public.audit_log (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
select
  'supply_type.created',
  null,                                             -- actor_user_id (system event)
  null,                                             -- acting_as_staff_id (system event)
  'supply_type',                                    -- entity_type (new, plain text in audit_log)
  st.id,
  jsonb_build_object(
    'name',       st.name,
    'source',     'migration:022',
    'from_label', coalesce(
      (select min(supply_label) from public.services s
        where regexp_replace(lower(trim(s.supply_label)), '\s+', ' ', 'g') = st.name_canonical),
      st.name
    )
  )
from public.supply_types st
where not exists (
  select 1 from public.audit_log al
   where al.action = 'supply_type.created'
     and al.entity_id = st.id
);
```

---

## 5. Replace the supply CHECK + drop the legacy column

```sql
-- 5.1 Replace the 021 services_supply_pair_chk with one that pairs
-- supply_amount_cents against supply_type_id (instead of supply_label).
alter table public.services
  drop constraint if exists services_supply_pair_chk;
alter table public.services
  add constraint services_supply_pair_chk check (
    (supply_amount_cents is null and supply_type_id is null)
    or
    (supply_amount_cents is not null
     and supply_type_id is not null
     and supply_amount_cents between 1 and 5000)
  );

-- 5.2 Drop the legacy free-text column. Per Clarification Q1.
alter table public.services drop column if exists supply_label;
```

---

## 6. Step order — authoritative

The migration file's statement order is **exactly** this, because step 4 reads `services.supply_label` and step 5.2 drops it:

1. `create table public.supply_types …`           (§1.1)
2. `create unique index supply_types_name_active_uq …`  (§1.2)
3. `create index supply_types_archived_name_idx …`      (§1.2)
4. `drop trigger … ; create trigger supply_types_set_updated_at_trg …`  (§1.3)
5. `alter table public.supply_types enable row level security; create policy …`  (§1.4)
6. `alter table public.services add column supply_type_id …`            (§2)
7. `insert into public.supply_types (name) select distinct …`           (§3.1)
8. `update public.services s set supply_type_id = (…) where s.supply_label is not null`  (§3.2)
9. `insert into public.audit_log …`                                     (§4 — reads supply_label)
10. `alter table public.services drop constraint services_supply_pair_chk`  (§5.1)
11. `alter table public.services add constraint services_supply_pair_chk check (…)` (§5.1)
12. `alter table public.services drop column supply_label`              (§5.2)

---

## 7. Type regeneration

After this migration is applied to the local supabase, regenerate types:

```sh
npx supabase gen types typescript --local > lib/db/types.ts
```

Expected diff in `lib/db/types.ts`:

- `services.Row` — REMOVES `supply_label: string | null`; ADDS `supply_type_id: string | null`.
- `services.Insert` / `services.Update` — same field swap.
- NEW `supply_types.Row` / `Insert` / `Update` shapes (id, name, name_canonical, archived, created_at, updated_at).

The regenerated file is committed alongside the migration.

---

## 8. Rollback story

Not in scope. The migration is irreversible by design — once `supply_label` is dropped, the data lives only in the catalog. The forward migration is the recovery path (it is idempotent — re-running it on already-migrated data is a no-op for steps 1, 2, 3, 4, 6, 10, 11, 12 thanks to `if exists` / `if not exists` / `on conflict do nothing`; steps 7 and 8 are idempotent because the `where` clauses naturally select zero rows on the second run; step 9 is idempotent thanks to the `not exists` guard).

If a rollback is genuinely needed in production (e.g., a downstream bug discovered post-deploy), the operator path is: (a) re-add `supply_label text`, (b) backfill it from `services.supply_type_id` joined to `supply_types.name`, (c) drop `supply_type_id`. This is a forward migration on its own — not part of this contract.
