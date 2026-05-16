-- Migration: 0004_user_onboarding.sql
-- Feature: 012-user-onboarding
--
-- Adds the user-onboarding lifecycle columns to public.staff (state, email,
-- invite metadata, offboard metadata, last_sign_in_at, pin_reset_admin_at),
-- the coherence CHECK constraints that keep invite/offboard metadata aligned
-- with state, three partial indexes that match the page's hot queries, the
-- per-salon `staff_anon_counter` sequence used by the hard-remove flow to
-- mint `Former staff #N` placeholders, and a defense-in-depth backfill so
-- pre-existing rows resolve to `state = 'active'`.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS, DROP-then-ADD CHECK constraints
-- (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`), CREATE INDEX IF NOT
-- EXISTS, CREATE SEQUENCE IF NOT EXISTS. Per data-model.md § 1.

-- 1. Lifecycle + invite + offboard columns.
alter table public.staff
  add column if not exists state text not null default 'active',
  add column if not exists email text,
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references public.staff(id) on delete set null,
  add column if not exists invite_method text,
  add column if not exists offboarded_at timestamptz,
  add column if not exists offboarded_by uuid references public.staff(id) on delete set null,
  add column if not exists offboard_reason text,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists pin_reset_admin_at timestamptz;

-- 2. Backfill (defense-in-depth — the column default already covers
--    rows inserted after the ADD COLUMN, so this only catches the
--    in-flight column-add window).
update public.staff
   set state = 'active'
 where state is null;

-- 3. CHECK constraints (named so they are debuggable; DROP-then-ADD for
--    idempotency since Postgres has no ADD CONSTRAINT IF NOT EXISTS).
alter table public.staff drop constraint if exists staff_state_check;
alter table public.staff
  add constraint staff_state_check
  check (state in ('active', 'invited', 'offboarded'));

alter table public.staff drop constraint if exists staff_invite_method_check;
alter table public.staff
  add constraint staff_invite_method_check
  check (invite_method is null or invite_method in ('magic_link', 'password'));

alter table public.staff drop constraint if exists staff_invite_meta_coherent;
alter table public.staff
  add constraint staff_invite_meta_coherent
  check (
    (state = 'invited' and invited_at is not null and invite_method is not null)
    or (state <> 'invited')
  );

alter table public.staff drop constraint if exists staff_offboard_meta_coherent;
alter table public.staff
  add constraint staff_offboard_meta_coherent
  check (
    (state = 'offboarded' and offboarded_at is not null)
    or (state <> 'offboarded')
  );

-- 4. Partial indexes matching the onboarding page's hot queries.
--    `staff_pending_idx`    — Pending invites section, ordered by most-recent invite.
--    `staff_offboarded_idx` — Offboarded section, ordered by most-recent offboard.
--    `staff_email_lower_unique` — Email-conflict guard (case-insensitive,
--    scoped to non-removed rows so hard-removed records free the address).
create index if not exists staff_pending_idx
  on public.staff (invited_at desc)
  where state = 'invited' and removed_at is null;

create index if not exists staff_offboarded_idx
  on public.staff (offboarded_at desc)
  where state = 'offboarded' and removed_at is null;

create unique index if not exists staff_email_lower_unique
  on public.staff (lower(email))
  where email is not null and removed_at is null;

-- 5. Anonymization counter used by the hard-remove flow to mint
--    `Former staff #N` placeholder display names. Single salon, so a
--    single sequence is sufficient.
create sequence if not exists public.staff_anon_counter start with 1;

-- 6. RPC wrapper for the counter. PostgREST cannot call `nextval()`
--    directly, so the anon-counter helper goes through this thin
--    `security definer` function. Only the service-role grant is exposed
--    so authenticated/anon clients can never advance the sequence from a
--    browser. `create or replace` is unconditional, so re-running the
--    migration always picks up the latest body.
create or replace function public.next_anon_counter()
returns bigint
language sql
security definer
set search_path = public
as $$
  select nextval('public.staff_anon_counter');
$$;
revoke all on function public.next_anon_counter() from public, anon, authenticated;
grant execute on function public.next_anon_counter() to service_role;
