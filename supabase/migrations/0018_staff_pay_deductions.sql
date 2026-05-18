-- 0018_staff_pay_deductions.sql
-- Feature: 023-staff-payout-exemptions
--
-- Adds per-staff payout-exemption columns to public.staff so the salon can
-- mark techs as exempt from the card processing fee deduction and/or from
-- supply-cost deductions (apply all / partial / exempt). The element-existence
-- trigger guards against orphaned supply_except references; the cascading-prune
-- trigger keeps the array consistent when a supply_type is hard-deleted.
--
-- Contract: specs/023-staff-payout-exemptions/contracts/db-migration.contract.md
-- Data model: specs/023-staff-payout-exemptions/data-model.md § 5
--
-- Idempotent throughout (`if not exists` / `or replace` /
-- `drop trigger if exists`). No data backfill — the new columns ship with
-- defaults that match the intended initial state for every existing staff row
-- (no exemptions).

-- ----------------------------------------------------------------------
-- 1. Add three new columns to public.staff with defaults.
-- ----------------------------------------------------------------------
alter table public.staff
  add column if not exists card_fee_exempt boolean not null default false,
  add column if not exists supply_mode text not null default 'apply'
    check (supply_mode in ('apply','partial','exempt')),
  add column if not exists supply_except uuid[] not null default '{}';

-- ----------------------------------------------------------------------
-- 2. Add the mode-vs-empty CHECK constraint.
-- ----------------------------------------------------------------------
alter table public.staff
  add constraint staff_supply_except_empty_unless_partial_chk
    check (
      supply_mode = 'partial'
      or array_length(supply_except, 1) is null
    );

-- ----------------------------------------------------------------------
-- 3. Element-existence trigger function + trigger.
-- ----------------------------------------------------------------------
create or replace function public.staff_assert_supply_except_valid()
returns trigger
language plpgsql
as $$
begin
  if array_length(new.supply_except, 1) is not null then
    if exists (
      select 1
      from unnest(new.supply_except) as elem(id)
      left join public.supply_types t on t.id = elem.id
      where t.id is null
    ) then
      raise foreign_key_violation
        using message = 'supply_except contains an id not present in supply_types';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_assert_supply_except_valid_trg on public.staff;
create trigger staff_assert_supply_except_valid_trg
  before insert or update on public.staff
  for each row execute function public.staff_assert_supply_except_valid();

-- ----------------------------------------------------------------------
-- 4. Cascading-prune trigger function + trigger on supply_types.
-- ----------------------------------------------------------------------
create or replace function public.supply_types_prune_from_staff()
returns trigger
language plpgsql
as $$
begin
  update public.staff
  set supply_except = array_remove(supply_except, old.id)
  where old.id = any(supply_except);
  return old;
end;
$$;

drop trigger if exists supply_types_prune_from_staff_trg on public.supply_types;
create trigger supply_types_prune_from_staff_trg
  after delete on public.supply_types
  for each row execute function public.supply_types_prune_from_staff();

-- ----------------------------------------------------------------------
-- 5. No data backfill — the new columns ship with defaults that match the
--    intended initial state for every existing staff row (no exemptions).
-- ----------------------------------------------------------------------
