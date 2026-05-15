-- Migration: 0001_auth_schema.sql
-- Feature: 003-login-flow
-- Introduces the two tables this feature persists: `staff` and `audit_log`.
-- All other tables from docs/system-design.md § Data model are deferred to the
-- features that own them (calendar → appointments, walkin → walk_ins, etc.).

-- ---------------------------------------------------------------------------
-- Required extensions (idempotent — Supabase already enables these, but
-- declaring them here documents the dependency and makes the migration
-- portable to any vanilla Postgres 15+).
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. staff
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        references auth.users(id) on delete set null,
  display_name  text        not null,
  role          text        not null,
  pin_hash      text,
  color_token   text        not null,
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  constraint staff_role_check
    check (role in ('owner', 'manager', 'technician', 'front_desk')),
  constraint staff_pin_or_user
    check (pin_hash is not null or user_id is not null)
);

-- Partial unique index — a Supabase auth user maps to at most one staff row.
create unique index if not exists staff_user_id_unique
  on public.staff (user_id)
  where user_id is not null;

-- Drives the /select-staff roster query.
create index if not exists staff_active_role_idx
  on public.staff (active, role);

-- ---------------------------------------------------------------------------
-- 2. audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id                  uuid        primary key default gen_random_uuid(),
  ts                  timestamptz not null default now(),
  actor_user_id       uuid,
  acting_as_staff_id  uuid        references public.staff(id) on delete set null,
  action              text        not null,
  entity_type         text,
  entity_id           uuid,
  payload             jsonb       not null default '{}'::jsonb
);

create index if not exists audit_log_ts_idx
  on public.audit_log (ts desc);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_user_id, ts desc);

create index if not exists audit_log_action_idx
  on public.audit_log (action, ts desc);

-- ---------------------------------------------------------------------------
-- 3. RLS — both tables enabled, with the minimal policies this feature needs.
-- All writes go through the service-role client (lib/db/admin.ts), so we do
-- NOT define INSERT/UPDATE/DELETE policies for authenticated users.
-- ---------------------------------------------------------------------------
alter table public.staff      enable row level security;
alter table public.audit_log  enable row level security;

-- staff: authenticated users can read any row (drives the roster + operator
-- chip lookups). Inactive rows are filtered out by the application query, not
-- by RLS — owners may need to see inactive staff in Settings later.
drop policy if exists staff_select_authenticated on public.staff;
create policy staff_select_authenticated
  on public.staff
  for select
  to authenticated
  using (true);

-- audit_log: authenticated users may SELECT, but the `payload` column is
-- granted only to service_role. This keeps event metadata (e.g., previous
-- staff id, PIN-failure reason) unreadable from ordinary client sessions.
drop policy if exists audit_log_select_authenticated on public.audit_log;
create policy audit_log_select_authenticated
  on public.audit_log
  for select
  to authenticated
  using (true);

revoke select (payload) on public.audit_log from authenticated;
grant  select (payload) on public.audit_log to   service_role;
