-- Migration: 0002_staff_management.sql
-- Feature: 006-staff-management
--
-- Adds the soft-delete column, a hot-path index, migrates legacy
-- `--accent-*` color tokens to the new `--avatar-*` namespace, and installs
-- the `staff_assert_owner_present_trg` trigger that enforces the
-- "at least one active, non-removed owner remains" invariant
-- (data-model.md § 2, research.md § R5).

-- 1. Soft-delete column.
alter table public.staff
  add column if not exists removed_at timestamptz;

-- 2. Roster index — matches the page's hot query: filter `removed_at is null`
--    then ORDER BY role_priority, display_name. The partial WHERE keeps the
--    index small (only present-on-roster rows).
create index if not exists staff_roster_idx
  on public.staff (removed_at, role, display_name)
  where removed_at is null;

-- 3. Color-token rename (one-shot; idempotent — only rewrites legacy strings).
update public.staff
   set color_token = case color_token
     when '--accent-rose'   then '--avatar-rose'
     when '--accent-amber'  then '--avatar-amber'
     when '--accent-violet' then '--avatar-purple'
     when '--accent-green'  then '--avatar-green'
     when '--accent-blue'   then '--avatar-blue'
     when '--accent-teal'   then '--avatar-teal'
     when '--accent-orange' then '--avatar-orange'
     when '--accent-slate'  then '--avatar-slate'
     else color_token
   end
 where color_token like '--accent-%';

-- 4. Last-owner trigger.
--    The function counts active, non-removed owners EXCLUDING the row being
--    mutated, then adds 1 back if the new row would still qualify as an
--    active owner. If the resulting count is < 1, the operation is rejected
--    with errcode = check_violation (PostgREST surfaces this as "23514").
create or replace function public.staff_assert_owner_present()
returns trigger
language plpgsql
as $$
declare
  active_owners int;
begin
  select count(*) into active_owners
  from public.staff
  where role = 'owner'
    and active = true
    and removed_at is null
    and id <> coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op in ('INSERT','UPDATE')
     and new.role = 'owner'
     and new.active = true
     and new.removed_at is null then
    active_owners := active_owners + 1;
  end if;

  if active_owners < 1 then
    raise exception 'staff_assert_owner_present: at least one active owner must remain'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_assert_owner_present_trg on public.staff;
create trigger staff_assert_owner_present_trg
  before update or delete
  on public.staff
  for each row
  execute function public.staff_assert_owner_present();
