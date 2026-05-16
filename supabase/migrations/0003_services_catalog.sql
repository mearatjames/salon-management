-- Migration: 0003_services_catalog.sql
-- Feature: 008-services-catalog
--
-- Creates the two catalog tables (services + staff_services), installs the
-- updated_at triggers, and enables RLS with read-only-for-`authenticated`
-- policies. Writes go through Server Actions backed by the service-role
-- client (bypasses RLS). The migration does NOT touch `audit_log` —
-- `action` is plain `text` and the controlled vocabulary lives in the
-- TypeScript `AuditAction` union in `lib/auth/audit.ts` (see research.md
-- § R9 and contracts/audit.contract.md § 5).

-- ----------------------------------------------------------------------
-- 1. services
-- ----------------------------------------------------------------------
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

-- Hot-path index for the catalog list query (active rows, grouped by
-- category, alpha within group). Partial index keeps it small.
create index if not exists services_active_category_name_idx
  on public.services (active, category, name)
  where active = true;

-- Backs `select distinct category from services order by category` for the
-- category auto-complete.
create index if not exists services_category_distinct_idx
  on public.services (category);

-- ----------------------------------------------------------------------
-- 2. services updated_at trigger
-- ----------------------------------------------------------------------
create or replace function public.services_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists services_set_updated_at_trg on public.services;
create trigger services_set_updated_at_trg
  before update on public.services
  for each row execute function public.services_set_updated_at();

-- ----------------------------------------------------------------------
-- 3. staff_services
-- ----------------------------------------------------------------------
create table if not exists public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  duration_min_override int
    check (duration_min_override is null or duration_min_override > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (staff_id, service_id)
);

-- Supports "who can perform service X?" (drawer hydration) and the
-- per-service tech-count aggregation.
create index if not exists staff_services_service_id_idx
  on public.staff_services (service_id);

-- ----------------------------------------------------------------------
-- 4. staff_services updated_at trigger
-- ----------------------------------------------------------------------
create or replace function public.staff_services_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_services_set_updated_at_trg on public.staff_services;
create trigger staff_services_set_updated_at_trg
  before update on public.staff_services
  for each row execute function public.staff_services_set_updated_at();

-- ----------------------------------------------------------------------
-- 5. RLS — reads open to every authenticated user; writes through the
--    service-role client only (bypasses RLS). Kiosk JWT does not
--    authenticate as `authenticated` so it gets no access.
-- ----------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.staff_services enable row level security;

drop policy if exists services_read_any_authenticated on public.services;
create policy services_read_any_authenticated
  on public.services
  for select
  to authenticated
  using (true);

drop policy if exists staff_services_read_any_authenticated on public.staff_services;
create policy staff_services_read_any_authenticated
  on public.staff_services
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------
-- 6. audit_log — intentionally untouched. `action` remains plain `text`;
--    the controlled vocabulary lives in `lib/auth/audit.ts`. Feature 008
--    extends the TS `AuditAction` union with `service.added`,
--    `service.updated`, `service.archived`, `service.restored` and the
--    `recordAudit` helper routes those to `entity_type = 'service'`.
-- ----------------------------------------------------------------------
