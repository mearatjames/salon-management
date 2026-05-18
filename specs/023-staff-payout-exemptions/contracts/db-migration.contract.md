# Contract: DB migration — `0018_staff_pay_deductions.sql`

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

The DDL contract for migration `0018_staff_pay_deductions.sql`. Implementation MUST match this contract byte-for-byte in identifier names, column types, default values, constraint names, and trigger signatures. Order of operations within the migration is constrained because later steps depend on earlier ones (column → CHECK → trigger on the column → trigger on the FK target).

---

## 1. New columns on `public.staff`

In this exact order, all in one `ALTER TABLE`:

```sql
alter table public.staff
  add column if not exists card_fee_exempt boolean not null default false,
  add column if not exists supply_mode text not null default 'apply'
    check (supply_mode in ('apply','partial','exempt')),
  add column if not exists supply_except uuid[] not null default '{}';
```

Column names, types, defaults, and the inline CHECK on `supply_mode` are non-negotiable. The inline CHECK appears as a column-level constraint (not a separate `ALTER TABLE ... ADD CONSTRAINT`) because it is intrinsic to the column's permitted values.

## 2. Table-level CHECK constraint on `public.staff`

```sql
alter table public.staff
  add constraint staff_supply_except_empty_unless_partial_chk
    check (
      supply_mode = 'partial'
      or array_length(supply_except, 1) is null
    );
```

Constraint name: `staff_supply_except_empty_unless_partial_chk`. Implementation MUST use this exact name.

## 3. Trigger function `public.staff_assert_supply_except_valid`

```sql
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
```

Function name: `public.staff_assert_supply_except_valid`. The early-return on empty `supply_except` (via `array_length(...) is null`) is required — without it, the function runs the `EXISTS` check on every row even when there's nothing to check, doubling the cost for the 99% case.

## 4. Trigger `staff_assert_supply_except_valid_trg`

```sql
drop trigger if exists staff_assert_supply_except_valid_trg on public.staff;
create trigger staff_assert_supply_except_valid_trg
  before insert or update on public.staff
  for each row
  execute function public.staff_assert_supply_except_valid();
```

Trigger name: `staff_assert_supply_except_valid_trg`. Drop-then-create pattern is required for re-run idempotency (`create trigger if not exists` is not supported by Postgres for triggers).

## 5. Trigger function `public.supply_types_prune_from_staff`

```sql
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
```

Function name: `public.supply_types_prune_from_staff`. The `WHERE old.id = any(supply_except)` clause is required to avoid no-op updates on every staff row (which would still write to the table and trigger any other AFTER UPDATE triggers, wasting cycles).

## 6. Trigger `supply_types_prune_from_staff_trg`

```sql
drop trigger if exists supply_types_prune_from_staff_trg on public.supply_types;
create trigger supply_types_prune_from_staff_trg
  after delete on public.supply_types
  for each row
  execute function public.supply_types_prune_from_staff();
```

Trigger name: `supply_types_prune_from_staff_trg`. Lives on `supply_types` even though it mutates `staff` — Postgres allows cross-table triggers and this is the only safe place to catch the DELETE event.

## 7. RLS policies — UNCHANGED

The migration MUST NOT add, modify, or drop any RLS policy on `public.staff` or `public.supply_types`. The new columns are read and written under the existing row-level policies for `staff` (per 006). The supply_types triggers run in the SQL caller's role context — both triggers access only tables the caller can already access (no `SECURITY DEFINER` needed).

## 8. `audit_log` table — UNCHANGED

The migration MUST NOT add columns to, drop columns from, or change the type of any column in `public.audit_log`. The audit-payload extension for the three new fields is content-only (JSONB additions inside `payload`), not schema-shaped.

## 9. Backfill — NONE

The migration MUST NOT contain any data-modifying SQL beyond the column DEFAULTs. Every existing staff row gets `card_fee_exempt = false`, `supply_mode = 'apply'`, `supply_except = '{}'` automatically via the column DEFAULTs at `ALTER TABLE ... ADD COLUMN` time. No `UPDATE` statements, no `INSERT INTO audit_log` for backfill events (no audit event is being recorded — the new defaults represent "no exemption", which is the existing implicit state).

## 10. Idempotency

Every DDL operation MUST be wrapped in `if not exists` / `if exists` / `create or replace` / `drop ... if exists`. Re-running the migration on an already-migrated DB MUST be a no-op (zero schema change, zero data change). This is the Supabase migration contract and the existing repo convention.

## 11. Transactional safety

The migration MUST NOT contain any explicit `commit` or `begin transaction` statements. Supabase CLI wraps each migration file in a single transaction by default — either every step commits together or none does. The plan relies on this; explicit transaction control would break the rollback story.

## 12. Verification queries

After applying 0018, the following queries MUST return the expected results on a database that previously was at 0017:

```sql
-- 12.1 — Three new columns exist on staff with correct types.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'staff'
  and column_name in ('card_fee_exempt','supply_mode','supply_except')
order by column_name;
-- Expected three rows: card_fee_exempt | boolean | false,
--                      supply_except   | ARRAY   | '{}'::uuid[],
--                      supply_mode     | text    | 'apply'::text

-- 12.2 — CHECK constraint present.
select constraint_name
from information_schema.table_constraints
where table_schema = 'public' and table_name = 'staff'
  and constraint_type = 'CHECK'
  and constraint_name = 'staff_supply_except_empty_unless_partial_chk';
-- Expected: one row.

-- 12.3 — Both triggers present.
select trigger_name, event_object_table, action_timing
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('staff_assert_supply_except_valid_trg',
                       'supply_types_prune_from_staff_trg')
order by trigger_name;
-- Expected two rows: staff_assert_supply_except_valid_trg | staff        | BEFORE,
--                    supply_types_prune_from_staff_trg    | supply_types | AFTER

-- 12.4 — Existing staff rows have defaults applied.
select count(*) as total,
       count(*) filter (where card_fee_exempt = false) as default_card_exempt,
       count(*) filter (where supply_mode = 'apply') as default_mode,
       count(*) filter (where array_length(supply_except, 1) is null) as default_supply_except
from public.staff;
-- Expected: total == default_card_exempt == default_mode == default_supply_except.

-- 12.5 — Trigger rejects unknown supply_type id.
-- (Run inside a transaction that's rolled back to leave no state.)
begin;
insert into public.staff (display_name, role, color_token, supply_mode, supply_except)
values ('Test', 'technician', '--avatar-rose', 'partial',
        array['00000000-0000-0000-0000-000000000000'::uuid]);
-- Expected: ERROR — foreign_key_violation — supply_except contains an id not present in supply_types
rollback;

-- 12.6 — Trigger accepts a real supply_type id.
-- (Run inside a transaction.)
begin;
insert into public.staff (display_name, role, color_token, supply_mode, supply_except)
select 'Test', 'technician', '--avatar-rose', 'partial', array[id]
from public.supply_types where archived = false limit 1;
-- Expected: SUCCESS (1 row inserted).
rollback;
```

These six queries form the migration's smoke test. The Playwright e2e spec for this feature includes the equivalent of 12.5 and 12.6 as part of US2 (supply_mode = 'partial' with valid + invalid ticks).
