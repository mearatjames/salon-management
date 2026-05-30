-- Migration: 0028_payout_adjustments.sql
-- Feature: 053-payroll-reversals-adjustments
--
-- Adds the `public.payout_adjustments` table plus the four SECURITY DEFINER
-- RPCs that perform every adjustment write (`payroll_assert_adjustable`,
-- `payroll_add_adjustment`, `payroll_edit_adjustment`,
-- `payroll_delete_adjustment`).
--
-- An adjustment is a free-form per-tech, per-period money line: `+` adds,
-- `−` deducts. `reason` is a 1–80 char (trimmed) label. Adjustments are only
-- mutable while the period is open AND the tech has no payout row yet (a
-- recorded payout snapshots the figures, so adjustments must be locked in
-- before payout). That gate lives in `payroll_assert_adjustable`.
--
-- RLS: `select to authenticated using (true)`; no insert/update/delete
-- policies — every write goes through the service-role RPCs. Pattern mirrors
-- migration 0021 (payroll): `p_*` params / `v_*` locals, `for update` lock,
-- validate-before-mutate, `raise exception ... using errcode = 'P0001'`,
-- audit insert in the same transaction, `revoke all ... from public` +
-- `grant execute ... to service_role`.
--
-- Contract: specs/053-payroll-reversals-adjustments/contracts/db-rpc.md
-- Data model: specs/053-payroll-reversals-adjustments/data-model.md
--
-- Idempotent throughout (`if not exists` / `or replace`).

-- ----------------------------------------------------------------------
-- 1. payout_adjustments — one row per per-tech, per-period money line.
-- ----------------------------------------------------------------------
create table if not exists public.payout_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  pay_period_id       uuid not null references public.pay_periods(id),
  staff_id            uuid not null references public.staff(id),
  amount_cents        int  not null check (amount_cents <> 0),     -- + add, − deduct
  reason              text not null check (char_length(btrim(reason)) between 1 and 80),
  created_by_staff_id uuid not null references public.staff(id),
  created_by_user_id  uuid,                                        -- device auth user
  created_at          timestamptz not null default now(),
  updated_at          timestamptz                                  -- set on edit; null = never edited
);

create index if not exists payout_adjustments_period_staff_idx
  on public.payout_adjustments (pay_period_id, staff_id);

-- ----------------------------------------------------------------------
-- 2. RLS — select-only for `authenticated`; all writes via the RPCs.
-- ----------------------------------------------------------------------
alter table public.payout_adjustments enable row level security;

drop policy if exists payout_adjustments_select_all on public.payout_adjustments;
create policy payout_adjustments_select_all
  on public.payout_adjustments for select to authenticated using (true);

-- ----------------------------------------------------------------------
-- 3. payroll_assert_adjustable — shared lock guard.
-- ----------------------------------------------------------------------
-- Locks the period row `for update`; refuses if the period is missing /
-- closed, or if a payout row already exists for (period, staff).
create or replace function public.payroll_assert_adjustable(
  p_pay_period_id uuid,
  p_staff_id      uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.pay_period_status;
begin
  select status
    into v_status
    from public.pay_periods
    where id = p_pay_period_id
    for update;

  if v_status is null or v_status <> 'open' then
    raise exception 'payroll_period_not_open' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.payroll_payouts
    where pay_period_id = p_pay_period_id and staff_id = p_staff_id
  ) then
    raise exception 'payroll_payout_exists' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.payroll_assert_adjustable(uuid, uuid) from public;
grant execute on function public.payroll_assert_adjustable(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 4. payroll_add_adjustment — insert a new adjustment line.
-- ----------------------------------------------------------------------
create or replace function public.payroll_add_adjustment(
  p_pay_period_id  uuid,
  p_staff_id       uuid,
  p_amount_cents   int,
  p_reason         text,
  p_operator       uuid,
  p_device_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_adjustment_id uuid;
begin
  -- 1) Lock the period and refuse if closed / payout already recorded.
  perform public.payroll_assert_adjustable(p_pay_period_id, p_staff_id);

  -- 2) Validate amount and reason.
  if p_amount_cents = 0
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 80 then
    raise exception 'payroll_invalid' using errcode = 'P0001';
  end if;

  -- 3) Insert the adjustment line.
  insert into public.payout_adjustments (
    pay_period_id, staff_id, amount_cents, reason,
    created_by_staff_id, created_by_user_id
  ) values (
    p_pay_period_id, p_staff_id, p_amount_cents, btrim(p_reason),
    p_operator, p_device_user_id
  )
  returning id into v_adjustment_id;

  -- 4) Audit. Same transaction as the insert.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.adjustment_added',
      'payroll',
      v_adjustment_id,
      jsonb_build_object(
        'pay_period_id', p_pay_period_id,
        'staff_id',      p_staff_id,
        'amount_cents',  p_amount_cents,
        'reason',        btrim(p_reason)
      )
    );

  -- 5) Return the new id.
  return v_adjustment_id;
end;
$$;

revoke all on function public.payroll_add_adjustment(uuid, uuid, int, text, uuid, uuid) from public;
grant execute on function public.payroll_add_adjustment(uuid, uuid, int, text, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 5. payroll_edit_adjustment — update an existing adjustment line.
-- ----------------------------------------------------------------------
-- Returns the affected staff_id.
create or replace function public.payroll_edit_adjustment(
  p_adjustment_id  uuid,
  p_amount_cents   int,
  p_reason         text,
  p_operator       uuid,
  p_device_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay_period_id uuid;
  v_staff_id      uuid;
begin
  -- 1) Lock the adjustment row. Refuse if missing.
  select pay_period_id, staff_id
    into v_pay_period_id, v_staff_id
    from public.payout_adjustments
    where id = p_adjustment_id
    for update;

  if v_staff_id is null then
    raise exception 'payroll_adjustment_missing' using errcode = 'P0001';
  end if;

  -- 2) Lock the period and refuse if closed / payout already recorded.
  perform public.payroll_assert_adjustable(v_pay_period_id, v_staff_id);

  -- 3) Validate amount and reason.
  if p_amount_cents = 0
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 80 then
    raise exception 'payroll_invalid' using errcode = 'P0001';
  end if;

  -- 4) Update the adjustment line.
  update public.payout_adjustments
    set amount_cents = p_amount_cents,
        reason       = btrim(p_reason),
        updated_at   = now()
    where id = p_adjustment_id;

  -- 5) Audit. Same transaction as the update.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.adjustment_edited',
      'payroll',
      p_adjustment_id,
      jsonb_build_object(
        'pay_period_id', v_pay_period_id,
        'staff_id',      v_staff_id,
        'amount_cents',  p_amount_cents,
        'reason',        btrim(p_reason),
        'edited',        true
      )
    );

  -- 6) Return the affected staff_id.
  return v_staff_id;
end;
$$;

revoke all on function public.payroll_edit_adjustment(uuid, int, text, uuid, uuid) from public;
grant execute on function public.payroll_edit_adjustment(uuid, int, text, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 6. payroll_delete_adjustment — remove an adjustment line.
-- ----------------------------------------------------------------------
-- Audit-before-delete: the audit row captures the complete snapshot of the
-- adjustment about to be deleted, then the row is deleted — in one tx.
-- Returns the affected staff_id.
create or replace function public.payroll_delete_adjustment(
  p_adjustment_id  uuid,
  p_operator       uuid,
  p_device_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_adj public.payout_adjustments%rowtype;
begin
  -- 1) Lock the adjustment row. Refuse if missing.
  select *
    into v_adj
    from public.payout_adjustments
    where id = p_adjustment_id
    for update;

  if v_adj.id is null then
    raise exception 'payroll_adjustment_missing' using errcode = 'P0001';
  end if;

  -- 2) Lock the period and refuse if closed / payout already recorded.
  perform public.payroll_assert_adjustable(v_adj.pay_period_id, v_adj.staff_id);

  -- 3) Audit BEFORE the delete — payload carries the full deleted line.
  insert into public.audit_log
    (actor_user_id, acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_device_user_id,
      p_operator,
      'payroll.adjustment_removed',
      'payroll',
      p_adjustment_id,
      jsonb_build_object(
        'pay_period_id',       v_adj.pay_period_id,
        'staff_id',            v_adj.staff_id,
        'amount_cents',        v_adj.amount_cents,
        'reason',              v_adj.reason,
        'created_by_staff_id', v_adj.created_by_staff_id,
        'created_at',          v_adj.created_at
      )
    );

  -- 4) Delete the adjustment line.
  delete from public.payout_adjustments
    where id = p_adjustment_id;

  -- 5) Return the affected staff_id.
  return v_adj.staff_id;
end;
$$;

revoke all on function public.payroll_delete_adjustment(uuid, uuid, uuid) from public;
grant execute on function public.payroll_delete_adjustment(uuid, uuid, uuid) to service_role;
