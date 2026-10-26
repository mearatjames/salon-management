-- Migration: 0031_backfill_staff_email_from_auth.sql
-- Issue: #220 — signed-in owner's email never shows on Staff / Onboarding.
--
-- The Staff and Onboarding UI read only `staff.email`. `0005_user_onboarding`
-- added that column but never back-filled it from `auth.users`, so a staff
-- row linked to its auth user before 0005 (the bootstrapped first owner) or
-- linked by hand keeps `email = NULL`.
--
-- Copy `auth.users.email` into every live, linked staff row whose email is
-- NULL. Rows whose auth email is already held by ANOTHER live staff row are
-- skipped so `staff_email_lower_unique` can't abort the migration.
--
-- Going forward, `syncStaffEmailFromAuth` (lib/auth/sync-staff-email.ts)
-- keeps the column in step on every sign-in. Idempotent: a re-run only touches rows still NULL.

update public.staff s
set email = u.email
from auth.users u
where s.user_id = u.id
  and s.email is null
  and s.removed_at is null
  and u.email is not null
  and not exists (
    select 1
    from public.staff o
    where o.id <> s.id
      and o.removed_at is null
      and o.email is not null
      and lower(o.email) = lower(u.email)
  );
