-- Migration: 0010_dashboard_data_wiring.sql
-- Feature: 016-dashboard-data-wiring (renumbered after Square Terminal landed at 015)
--
-- Seeds the salon timezone in public.settings and adds two partial indexes
-- that turn the dashboard's hot aggregate queries into index-only scans.
--
-- Also adds the 'gift' payment_method enum value so the dev seed fixture
-- can express the gift-redemption outcome the dashboard's read-model expects.
-- ('card' was already added by 0008_square_terminal_payment.sql; the tip_cents
-- check was also already relaxed there, so those two deltas are no-ops here.)
-- No policy changes.

-- ----------------------------------------------------------------------
-- 1. Salon timezone setting (idempotent — ON CONFLICT no-op on re-run).
-- ----------------------------------------------------------------------
insert into public.settings (key, value) values
  ('salon.timezone', to_jsonb('America/Los_Angeles'::text))
on conflict (key) do nothing;

-- ----------------------------------------------------------------------
-- 2. payment_method enum extension — add 'gift'. 'card' is already on
--    the type via 0008_square_terminal_payment.sql; this statement is a
--    no-op if 'gift' already exists, so it stays idempotent.
-- ----------------------------------------------------------------------
alter type public.payment_method add value if not exists 'gift';

-- ----------------------------------------------------------------------
-- 3. Partial indexes — turn the dashboard's hot aggregate queries into
--    index-only scans for status='paid' tickets and status='succeeded'
--    payments. The WHERE clause is what makes them "partial".
-- ----------------------------------------------------------------------
create index if not exists tickets_status_closed_at_idx
  on public.tickets (status, closed_at desc)
  where status = 'paid';

create index if not exists payments_status_processed_at_idx
  on public.payments (status, processed_at desc)
  where status = 'succeeded';
