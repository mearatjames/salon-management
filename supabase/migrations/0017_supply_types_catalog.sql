-- 0017_supply_types_catalog.sql
-- Feature: 022-supply-types-catalog
--
-- Promotes free-text services.supply_label to a first-class supply_types
-- catalog. Creates supply_types, adds services.supply_type_id, backfills
-- from existing supply_label values (case-insensitively deduped +
-- canonicalized via lower(trim()) + collapsed whitespace), replaces
-- services_supply_pair_chk, drops services.supply_label, and writes one
-- supply_type.created audit row per seeded type.
--
-- Contract: specs/022-supply-types-catalog/contracts/db-migration.contract.md
-- Data model: specs/022-supply-types-catalog/data-model.md § 2, § 3.3
--
-- Idempotent throughout (`if exists` / `if not exists` /
-- `on conflict do nothing` / `not exists` guards). Audit-log INSERT runs
-- BEFORE the drop column step so `services.supply_label` is still readable
-- when the seed payload reaches for its `from_label` derivation source.

-- ----------------------------------------------------------------------
-- 1.1 supply_types table.
-- ----------------------------------------------------------------------
create table if not exists public.supply_types (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  name_canonical  text        not null generated always as (lower(trim(name))) stored,
  archived        boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint supply_types_name_len_chk check (length(trim(name)) between 2 and 64)
);

-- ----------------------------------------------------------------------
-- 1.2 Indexes — partial unique on active rows + lookup index on archived.
-- ----------------------------------------------------------------------
create unique index if not exists supply_types_name_active_uq
  on public.supply_types (name_canonical) where archived = false;

create index if not exists supply_types_archived_name_idx
  on public.supply_types (archived, name_canonical);

-- ----------------------------------------------------------------------
-- 1.3 updated_at trigger.
-- ----------------------------------------------------------------------
create or replace function public.supply_types_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists supply_types_set_updated_at_trg on public.supply_types;
create trigger supply_types_set_updated_at_trg
  before update on public.supply_types
  for each row execute function public.supply_types_set_updated_at();

-- ----------------------------------------------------------------------
-- 1.4 RLS — authenticated read; writes go through service-role.
-- ----------------------------------------------------------------------
alter table public.supply_types enable row level security;

drop policy if exists supply_types_select_authenticated on public.supply_types;
create policy supply_types_select_authenticated
  on public.supply_types
  for select to authenticated using (true);

-- ----------------------------------------------------------------------
-- 2. services.supply_type_id FK column.
-- ----------------------------------------------------------------------
alter table public.services
  add column if not exists supply_type_id uuid
    references public.supply_types(id) on delete restrict;

-- ----------------------------------------------------------------------
-- 3.1 Seed types from distinct legacy labels (canonicalized).
-- ----------------------------------------------------------------------
insert into public.supply_types (name)
select distinct regexp_replace(trim(supply_label), '\s+', ' ', 'g') as name
  from public.services
 where supply_label is not null
   and length(trim(supply_label)) > 0
on conflict do nothing;

-- ----------------------------------------------------------------------
-- 3.2 Point each affected service at its matching type id.
-- ----------------------------------------------------------------------
update public.services s
   set supply_type_id = (
     select id from public.supply_types st
      where st.name_canonical = regexp_replace(lower(trim(s.supply_label)), '\s+', ' ', 'g')
   )
 where s.supply_label is not null;

-- ----------------------------------------------------------------------
-- 4. Audit-log INSERT — MUST run BEFORE drop column (step 5.2) so the
--    `from_label` derivation can still read services.supply_label.
--    Idempotent via the `not exists` guard.
-- ----------------------------------------------------------------------
insert into public.audit_log (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
select
  'supply_type.created',
  null,
  null,
  'supply_type',
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

-- ----------------------------------------------------------------------
-- 5.1 Replace supply pair CHECK — old constraint referenced supply_label
--     (both-or-neither with supply_amount_cents); the new constraint is
--     both-or-neither with supply_type_id.
-- ----------------------------------------------------------------------
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

-- ----------------------------------------------------------------------
-- 5.2 Drop the legacy column.
-- ----------------------------------------------------------------------
alter table public.services drop column if exists supply_label;
