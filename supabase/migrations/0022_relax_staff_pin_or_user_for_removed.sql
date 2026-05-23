-- Migration: 0022_relax_staff_pin_or_user_for_removed.sql
-- Issue: #120
--
-- The original 0001 CHECK constraint
--   `pin_hash is not null or user_id is not null`
-- aborts `auth.admin.deleteUser` whenever the cascade (`ON DELETE SET NULL`
-- on staff.user_id) lands on a row whose pin_hash is already NULL. That
-- combination is the steady state for two real flows:
--
--   • cancelInvite — magic-link invitees never have a pin_hash.
--   • removeUser   — offboardUser explicitly nulls pin_hash, so every
--                    row that reaches the hard-remove step is pin-less.
--
-- cancelInvite hard-deletes the staff row entirely, so reordering staff
-- DELETE before the auth deleteUser is sufficient for that path (no
-- cascade target left). removeUser keeps the row (anonymized + soft-
-- archived via removed_at), so it genuinely needs the auth user gone
-- while the staff row persists — and that's the case the original CHECK
-- can't represent.
--
-- The relaxation: a row that has been hard-removed (`removed_at IS NOT
-- NULL`) is exempt from the pin_hash/user_id requirement. The data-model
-- already treats removed_at non-null as "this row is an archive
-- placeholder" — it's dropped from staff_email_lower_unique and
-- staff_pending_idx / staff_offboarded_idx, and the application never
-- treats it as logged-in. Allowing pin_hash = NULL + user_id = NULL on
-- those rows keeps the trust boundary unchanged.
--
-- Idempotent: DROP-then-ADD CHECK (Postgres has no ADD CONSTRAINT IF
-- NOT EXISTS).

alter table public.staff drop constraint if exists staff_pin_or_user;
alter table public.staff
  add constraint staff_pin_or_user
  check (pin_hash is not null or user_id is not null or removed_at is not null);
