-- Migration: 0021_payroll.sql
-- Feature: 047-payroll-page
--
-- Adds the payroll schema: two enums, three per-staff payroll-rate columns,
-- the `pay_periods` and `payroll_payouts` tables, and the three SECURITY
-- DEFINER RPCs that perform every payroll write (`payroll_record_payout`,
-- `payroll_undo_payout`, `payroll_close_period`).
--
-- Money is integer cents; commission/tip splits are numeric(5,4) fractions
-- in 0–1. Payouts are immutable snapshots: once a `payroll_payouts` row
-- exists for `(pay_period_id, staff_id)` it captures the rates and figures
-- as-of payout time and is never updated.
--
-- RLS: `select to authenticated using (true)` on both tables; no
-- insert/update/delete policies — every write goes through the service-role
-- RPCs. Pattern mirrors migration 0014 (pos_close_cash_drawer): `p_*`
-- params / `v_*` locals, `for update` lock, validate-before-mutate,
-- `raise exception ... using errcode = 'P0001'`, audit insert in the same
-- transaction, `revoke all ... from public` + `grant execute ... to
-- service_role`.
--
-- Contract: specs/047-payroll-page/contracts/database-rpcs.md
-- Data model: specs/047-payroll-page/data-model.md
--
-- Idempotent throughout (`if not exists` / `or replace`; enums + constraints
-- are guarded with `do $$` existence checks).

-- ----------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pay_period_status') then
    create type public.pay_period_status as enum ('open', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'payout_method') then
    create type public.payout_method as enum ('cash', 'zelle', 'check');
  end if;
end
$$;

-- ----------------------------------------------------------------------
-- 2. Three new per-staff payroll-rate columns.
--    Splits are numeric(5,4) fractions in 0–1; check portion is cents.
--    Defaults match the intended initial state for every existing staff
--    row (no commission, no split, no check portion) — no backfill.
-- ----------------------------------------------------------------------
alter table public.staff
  add column if not exists service_commission_pct numeric(5, 4) not null default 0,
  add column if not exists tip_split_pct numeric(5, 4) not null default 0,
  add column if not exists check_portion_cents int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_service_commission_pct_chk'
  ) then
    alter table public.staff
      add constraint staff_service_commission_pct_chk
        check (service_commission_pct between 0 and 1);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'staff_tip_split_pct_chk'
  ) then
    alter table public.staff
      add constraint staff_tip_split_pct_chk
        check (tip_split_pct between 0 and 1);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'staff_check_portion_cents_chk'
  ) then
    alter table public.staff
      add constraint staff_check_portion_cents_chk
        check (check_portion_cents >= 0);
  end if;
end
$$;

-- ----------------------------------------------------------------------
-- 3. pay_periods — one row per semi-monthly payroll period.
-- ----------------------------------------------------------------------
create table if not exists public.pay_periods (
  id                  uuid primary key default gen_random_uuid(),
  starts_on           date not null,
  ends_on             date not null,
  pay_date            date not null,
  status              public.pay_period_status not null default 'open',
  closed_at           timestamptz,
  closed_by_staff_id  uuid references public.staff(id),
  created_at          timestamptz not null default now(),
  constraint pay_periods_starts_on_unique unique (starts_on),
  constraint pay_periods_range_chk check (ends_on >= starts_on),
  constraint pay_periods_closed_consistency_chk check (
    (status = 'open' and closed_at is null and closed_by_staff_id is null)
    or
    (status = 'closed' and closed_at is not null and closed_by_staff_id is not null)
  )
);

create index if not exists pay_periods_starts_on_idx
  on public.pay_periods (starts_on desc);

-- ----------------------------------------------------------------------
-- 4. payroll_payouts — immutable per-tech payout snapshot for a period.
--    One row per (pay_period_id, staff_id). `paid = true` rows carry the
--    method/date/recorder; `paid = false` rows are frozen-at-close
--    placeholders for techs who were never marked paid.
-- ----------------------------------------------------------------------
create table if not exists public.payroll_payouts (
  id                       uuid primary key default gen_random_uuid(),
  pay_period_id            uuid not null references public.pay_periods(id) on delete cascade,
  staff_id                 uuid not null references public.staff(id),
  paid                     boolean not null default true,
  method                   public.payout_method,
  paid_on                  date,
  recorded_by_staff_id     uuid references public.staff(id),
  paid_at                  timestamptz,
  commissionable_cents     int not null check (commissionable_cents >= 0),
  income_after_split_cents int not null check (income_after_split_cents >= 0),
  card_tips_cents          int not null check (card_tips_cents >= 0),
  tips_after_split_cents   int not null check (tips_after_split_cents >= 0),
  check_portion_cents      int not null check (check_portion_cents >= 0),
  cash_payment_cents       int not null check (cash_payment_cents >= 0),
  service_commission_pct   numeric(5, 4) not null,
  tip_split_pct            numeric(5, 4) not null,
  created_at               timestamptz not null default now(),
  constraint payroll_payouts_unique unique (pay_period_id, staff_id),
  constraint payroll_payouts_paid_consistency_chk check (
    (paid = true and method is not null and paid_on is not null
                 and recorded_by_staff_id is not null and paid_at is not null)
    or
    (paid = false and method is null and paid_on is null
                  and recorded_by_staff_id is null and paid_at is null)
  )
);

create index if not exists payroll_payouts_period_idx
  on public.payroll_payouts (pay_period_id);

-- ----------------------------------------------------------------------
-- 5. RLS — select-only for `authenticated`; all writes via the RPCs.
-- ----------------------------------------------------------------------
alter table public.pay_periods enable row level security;
alter table public.payroll_payouts enable row level security;

drop policy if exists pay_periods_select_all on public.pay_periods;
create policy pay_periods_select_all
  on public.pay_periods for select to authenticated using (true);

drop policy if exists payroll_payouts_select_all on public.payroll_payouts;
create policy payroll_payouts_select_all
  on public.payroll_payouts for select to authenticated using (true);

-- ----------------------------------------------------------------------
-- 6. payroll_record_payout — record a tech's payout for an open period.
-- ----------------------------------------------------------------------
-- Steps (contracts/database-rpcs.md):
--   1) lock the pay_periods row `for update`; refuse if missing/closed
--   2) refuse if a payout row already exists for (period, staff)
--   3) re-derive the cash payment and refuse on mismatch (server is
--      authoritative — never trust the client's cash figure)
--   4) insert the immutable payroll_payouts snapshot (paid = true)
--   5) write a `payroll.payout_recorded` audit row in the same tx
--
-- security definer so RLS does not block the write; the service_role-only
-- grant below ensures only the Server Action can invoke it.
create or replace function public.payroll_record_payout(
  p_pay_period_id            uuid,
  p_staff_id                 uuid,
  p_method                   public.payout_method,
  p_paid_on                  date,
  p_commissionable_cents     int,
  p_income_after_split_cents int,
  p_card_tips_cents          int,
  p_tips_after_split_cents   int,
  p_check_portion_cents      int,
  p_cash_payment_cents       int,
  p_service_commission_pct   numeric,
  p_tip_split_pct            numeric,
  p_operator                 uuid,
  p_device_user_id           uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status         public.pay_period_status;
  v_expected_cash  int;
  v_payout_id      uuid;
begin
  -- 1) Lock the period row. Refuse if missing or not open.
  select status
    into v_status
    from public.pay_periods
    where id = p_pay_period_id
    for update;

  if v_status is null or v_status <> 'open' then
    raise exception 'payroll_period_not_open' using errcode = 'P0001';
  end if;

  -- 2) One payout per (period, staff). Refuse a duplicate.
  if exists (
    select 1 from public.payroll_payouts
    where pay_period_id = p_pay_period_id and staff_id = p_staff_id
  ) then
    raise exception 'payroll_payout_exists' using errcode = 'P0001';
  end if;

  -- 3) Re-derive the cash payment server-side and refuse on mismatch.
  v_expected_cash := greatest(
    0,
    p_income_after_split_cents + p_tips_after_split_cents - p_check_portion_cents
  );
  if p_cash_payment_cents <> v_expected_cash then
    raise exception 'payroll_cash_mismatch' using errcode = 'P0001';
  end if;

  -- 4) Insert the immutable payout snapshot.
  insert into public.payroll_payouts (
    pay_period_id, staff_id, paid, method, paid_on,
    recorded_by_staff_id, paid_at,
    commissionable_cents, income_after_split_cents,
    card_tips_cents, tips_after_split_cents,
    check_portion_cents, cash_payment_cents,
    service_commission_pct, tip_split_pct
  ) values (
    p_pay_period_id, p_staff_id, true, p_method, p_paid_on,
    p_operator, now(),
    p_commissionable_cents, p_income_after_split_cents,
    p_card_tips_cents, p_tips_after_split_cents,
    p_check_portion_cents, p_cash_payment_cents,
    p_service_commission_pct, p_tip_split_pct
  )
  returning id into v_payout_id;

  -- 5) Audit. Same transaction as the insert.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.payout_recorded',
      'payroll',
      v_payout_id,
      jsonb_build_object(
        'pay_period_id',            p_pay_period_id,
        'staff_id',                 p_staff_id,
        'method',                   p_method,
        'paid_on',                  p_paid_on,
        'commissionable_cents',     p_commissionable_cents,
        'income_after_split_cents', p_income_after_split_cents,
        'card_tips_cents',          p_card_tips_cents,
        'tips_after_split_cents',   p_tips_after_split_cents,
        'check_portion_cents',      p_check_portion_cents,
        'cash_payment_cents',       p_cash_payment_cents,
        'service_commission_pct',   p_service_commission_pct,
        'tip_split_pct',            p_tip_split_pct
      )
    );

  return v_payout_id;
end;
$$;

revoke all on function public.payroll_record_payout(
  uuid, uuid, public.payout_method, date, int, int, int, int, int, int,
  numeric, numeric, uuid, uuid
) from public;
grant execute on function public.payroll_record_payout(
  uuid, uuid, public.payout_method, date, int, int, int, int, int, int,
  numeric, numeric, uuid, uuid
) to service_role;

-- ----------------------------------------------------------------------
-- 7. payroll_undo_payout — remove a tech's payout for an open period.
-- ----------------------------------------------------------------------
-- Audit-before-delete: the audit row captures the complete snapshot of the
-- payout row about to be deleted, then the row is deleted — in one tx.
create or replace function public.payroll_undo_payout(
  p_pay_period_id  uuid,
  p_staff_id       uuid,
  p_operator       uuid,
  p_device_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.pay_period_status;
  v_payout public.payroll_payouts%rowtype;
begin
  -- 1) Lock the period row. Refuse if missing or not open.
  select status
    into v_status
    from public.pay_periods
    where id = p_pay_period_id
    for update;

  if v_status is null or v_status <> 'open' then
    raise exception 'payroll_period_not_open' using errcode = 'P0001';
  end if;

  -- 2) Read the payout row about to be deleted. Refuse if missing.
  select *
    into v_payout
    from public.payroll_payouts
    where pay_period_id = p_pay_period_id and staff_id = p_staff_id;

  if v_payout.id is null then
    raise exception 'payroll_payout_missing' using errcode = 'P0001';
  end if;

  -- 3) Audit BEFORE the delete — payload carries the full undone snapshot.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.payout_undone',
      'payroll',
      p_pay_period_id,
      jsonb_build_object(
        'staff_id',                 p_staff_id,
        'payout_id',                v_payout.id,
        'method',                   v_payout.method,
        'paid_on',                  v_payout.paid_on,
        'recorded_by_staff_id',     v_payout.recorded_by_staff_id,
        'paid_at',                  v_payout.paid_at,
        'commissionable_cents',     v_payout.commissionable_cents,
        'income_after_split_cents', v_payout.income_after_split_cents,
        'card_tips_cents',          v_payout.card_tips_cents,
        'tips_after_split_cents',   v_payout.tips_after_split_cents,
        'check_portion_cents',      v_payout.check_portion_cents,
        'cash_payment_cents',       v_payout.cash_payment_cents,
        'service_commission_pct',   v_payout.service_commission_pct,
        'tip_split_pct',            v_payout.tip_split_pct
      )
    );

  -- 4) Delete the payout row.
  delete from public.payroll_payouts
    where pay_period_id = p_pay_period_id and staff_id = p_staff_id;
end;
$$;

revoke all on function public.payroll_undo_payout(uuid, uuid, uuid, uuid) from public;
grant execute on function public.payroll_undo_payout(uuid, uuid, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 8. payroll_close_period — freeze every eligible-unpaid tech and lock.
-- ----------------------------------------------------------------------
-- `p_frozen_rows` is a JSON array, one object per eligible-but-unpaid tech.
-- Each is inserted as a `paid = false` placeholder snapshot; techs who were
-- already marked paid keep their existing row (`on conflict do nothing`).
-- The period is then flipped to `closed`.
create or replace function public.payroll_close_period(
  p_pay_period_id  uuid,
  p_frozen_rows    jsonb,
  p_period_totals  jsonb,
  p_operator       uuid,
  p_device_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status     public.pay_period_status;
  v_row        jsonb;
  v_frozen_ids uuid[] := '{}';
begin
  -- 1) Lock the period row. Refuse if missing or not open.
  select status
    into v_status
    from public.pay_periods
    where id = p_pay_period_id
    for update;

  if v_status is null or v_status <> 'open' then
    raise exception 'payroll_period_not_open' using errcode = 'P0001';
  end if;

  -- 2) Freeze each eligible-unpaid tech as a paid = false placeholder.
  --    A tech already marked paid keeps their row (on conflict do nothing).
  for v_row in select * from jsonb_array_elements(coalesce(p_frozen_rows, '[]'::jsonb))
  loop
    insert into public.payroll_payouts (
      pay_period_id, staff_id, paid,
      commissionable_cents, income_after_split_cents,
      card_tips_cents, tips_after_split_cents,
      check_portion_cents, cash_payment_cents,
      service_commission_pct, tip_split_pct
    ) values (
      p_pay_period_id,
      (v_row ->> 'staff_id')::uuid,
      false,
      (v_row ->> 'commissionable_cents')::int,
      (v_row ->> 'income_after_split_cents')::int,
      (v_row ->> 'card_tips_cents')::int,
      (v_row ->> 'tips_after_split_cents')::int,
      (v_row ->> 'check_portion_cents')::int,
      (v_row ->> 'cash_payment_cents')::int,
      (v_row ->> 'service_commission_pct')::numeric,
      (v_row ->> 'tip_split_pct')::numeric
    )
    on conflict (pay_period_id, staff_id) do nothing;

    v_frozen_ids := v_frozen_ids || (v_row ->> 'staff_id')::uuid;
  end loop;

  -- 3) Flip the period to closed.
  update public.pay_periods
    set status             = 'closed',
        closed_at          = now(),
        closed_by_staff_id = p_operator
    where id = p_pay_period_id;

  -- 4) Audit. Same transaction as the close.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.period_closed',
      'payroll',
      p_pay_period_id,
      jsonb_build_object(
        'frozen_staff_ids', to_jsonb(v_frozen_ids),
        'period_totals',    coalesce(p_period_totals, '{}'::jsonb)
      )
    );
end;
$$;

revoke all on function public.payroll_close_period(uuid, jsonb, jsonb, uuid, uuid) from public;
grant execute on function public.payroll_close_period(uuid, jsonb, jsonb, uuid, uuid) to service_role;
