-- Seed: development-only data for feature 003-login-flow.
-- IMPORTANT: The PINs and password below are dev-only. Production bootstrap is
-- a manual step (SQL/Studio) per docs/system-design.md and quickstart.md § 1.
-- Re-run via `supabase db reset` (which truncates + re-runs migrations + this
-- file). Never run against the production project.

-- ---------------------------------------------------------------------------
-- Two seed auth.users so the email + password flow has something to find.
-- The Supabase CLI uses pgcrypto's crypt() with a bcrypt salt for password
-- hashing — mirror the same call here.
-- ---------------------------------------------------------------------------
-- Note: GoTrue's Go scanner rejects NULL for the *_token text columns
-- (it can't convert NULL → string). Seed them as '' explicitly.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  reauthentication_token,
  phone_change,
  phone_change_token
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner@tangnails.dev',
  crypt('tang-nails-dev', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '', '', '', '', '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'manager@tangnails.dev',
  crypt('tang-nails-dev', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '', '', '', '', '', '', '', ''
),
-- Dedicated user for destructive e2e tests (password-reset round-trip etc.)
-- so those tests don't mutate the shared `owner@tangnails.dev` mid-suite —
-- which broke parallel workers in any spec signing in as Maya. NO `staff`
-- row associated; the reset test only navigates as far as /select-staff and
-- never pins in.
(
  '00000000-0000-0000-0000-0000000000ff',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'reset-test@tangnails.dev',
  crypt('reset-tang-nails-test', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '', '', '', '', '', '', '', ''
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Three staff. PIN hashes are precomputed via `bcryptjs.hashSync(<pin>, 11)`
-- and embedded as literals. Re-generate only when the canonical PINs change.
--   Maya   : PIN 1234 → $2b$11$ocPxZYLxI9q3whaThAf44eqadcklBHovq4KGJcGQ2VjlZkoGD66x.
--   Jordan : PIN 5678 → $2b$11$ixukE2AGjrZs3diU3DJbk.ee1XcDBdkg.GlRUABhzcHX.20ELBPiq
--   Sam    : PIN 9999 → $2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W
-- ---------------------------------------------------------------------------
insert into public.staff (id, user_id, display_name, role, pin_hash, color_token, active)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Maya Patel',
    'owner',
    '$2b$11$ocPxZYLxI9q3whaThAf44eqadcklBHovq4KGJcGQ2VjlZkoGD66x.',
    '--avatar-rose',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Jordan Lee',
    'manager',
    '$2b$11$ixukE2AGjrZs3diU3DJbk.ee1XcDBdkg.GlRUABhzcHX.20ELBPiq',
    '--avatar-amber',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    null,
    'Sam Chen',
    'technician',
    '$2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W',
    '--avatar-purple',
    true
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Services catalog seed (feature 008-services-catalog).
-- Five sample services across three categories (Manicure, Pedicure, Add-on)
-- plus their `staff_services` rows so the e2e suite has assignments to
-- exercise:
--   * Classic manicure   — Jordan + Sam (both non-owners)
--   * Gel polish         — Sam only
--   * Classic pedicure   — Jordan + Sam (both non-owners)
--   * Spa pedicure       — Sam with a 75-min duration_min_override
--   * Nail art           — no assignments (exercises the "No techs" pill +
--                          the secondary `no_techs_assigned` toast)
--
-- The `services` and `staff_services` tables only exist after the Phase 2
-- migration (`0003_services_catalog.sql`) has run. To keep `supabase db
-- reset` working before that migration lands, the inserts are wrapped in a
-- DO block that no-ops when the tables don't yet exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.services') is null then
    return;
  end if;

  insert into public.services (
    id,
    name,
    category,
    duration_min,
    price_cents,
    color_token,
    taxable,
    variable_price,
    price_from_cents,
    price_to_cents,
    variable_price_note,
    active
  ) values
    (
      '20000000-0000-0000-0000-000000000001',
      'Classic manicure',
      'Manicure',
      30,
      2500,
      '--avatar-rose',
      true,
      false,
      null,
      null,
      null,
      true
    ),
    (
      '20000000-0000-0000-0000-000000000002',
      'Gel polish',
      'Manicure',
      45,
      3500,
      '--avatar-blue',
      true,
      false,
      null,
      null,
      null,
      true
    ),
    (
      '20000000-0000-0000-0000-000000000003',
      'Classic pedicure',
      'Pedicure',
      45,
      4000,
      '--avatar-green',
      true,
      false,
      null,
      null,
      null,
      true
    ),
    (
      '20000000-0000-0000-0000-000000000004',
      'Spa pedicure',
      'Pedicure',
      60,
      5500,
      '--avatar-teal',
      true,
      false,
      null,
      null,
      null,
      true
    ),
    (
      '20000000-0000-0000-0000-000000000005',
      'Nail art',
      'Add-on',
      30,
      0,
      '--avatar-purple',
      true,
      true,
      1500,
      null,
      'Depends on design complexity',
      true
    )
  on conflict (id) do nothing;

  insert into public.staff_services (service_id, staff_id, duration_min_override) values
    -- Classic manicure → Jordan + Sam
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', null),
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', null),
    -- Gel polish → Sam only
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', null),
    -- Classic pedicure → Jordan + Sam
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', null),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', null),
    -- Spa pedicure → Sam with a 75-min override
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 75)
    -- Nail art (20000000-…-005) intentionally has no assignments.
  on conflict (service_id, staff_id) do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- 013-cart-polish: presets seed for the variable-priced "Nail art" service.
-- Three quick-pick chips (Small / Medium / Large) at $35 / $45 / $60 — the
-- price-sheet renders them via the `services.presets` jsonb column (added
-- by migration 0007_cart_polish.sql).
--
-- Deviation note vs data-model.md: the spec snippet targets the row by
-- name='Nail art · medium', but the existing seed (and phase-2 e2e tests)
-- use the shorter name 'Nail art'. We update the existing row in place
-- rather than rename it; renaming would break tests/e2e/services.spec.ts.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.services') is null then
    return;
  end if;

  update public.services
     set presets = jsonb_build_array(
       jsonb_build_object('label', 'Small',  'price_cents', 3500),
       jsonb_build_object('label', 'Medium', 'price_cents', 4500),
       jsonb_build_object('label', 'Large',  'price_cents', 6000)
     )
   where name = 'Nail art';
end
$$;

-- ---------------------------------------------------------------------------
-- Feature 015 (Square Terminal): dev-only Vault secret used by
-- `lib/square/oauth.ts` to encrypt OAuth tokens at rest via pgcrypto.
-- The key value here is dev-only — production uses a per-environment
-- secret installed manually via the Supabase dashboard. Idempotent so
-- repeat `supabase db reset` runs don't error.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'square_oauth_key') then
    perform vault.create_secret(
      'dev-only-square-oauth-symmetric-key-do-not-use-in-prod-32+chars',
      'square_oauth_key',
      'DEV ONLY: pgcrypto symmetric key for Square OAuth tokens at rest'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 016-dashboard-data-wiring: five paid tickets dated today (salon TZ), used
-- by the dashboard's live read model so the local-dev experience matches the
-- production read path. Wrapped in a DO block guarded on the seed owner
-- user so this fixture NEVER executes against a production database that
-- has never had the dev-only seed user.
--
-- Method coverage: card, cash, gift, split-tender (cash + card on one
-- ticket), and a card sale that includes a kind='discount' line so the
-- read-model's discount-exclusion projection is exercised.
-- Tips: 4 of 5 tickets carry non-zero tip_cents.
-- Techs: mixed across Maya / Jordan / Sam from the staff seed above.
--
-- All timestamps are pinned to today in America/Los_Angeles via
--   date_trunc('day', (now() at time zone 'America/Los_Angeles'))
--     at time zone 'America/Los_Angeles' + interval 'N hours'
-- which yields a UTC timestamptz that corresponds to N:00 local time today.
-- ---------------------------------------------------------------------------
do $$
declare
  v_today_local_midnight timestamptz := (date_trunc('day', (now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles');
  v_owner uuid := '10000000-0000-0000-0000-000000000001';
  v_jordan uuid := '10000000-0000-0000-0000-000000000002';
  v_sam uuid := '10000000-0000-0000-0000-000000000003';
  v_svc_classic_mani uuid := '20000000-0000-0000-0000-000000000001';
  v_svc_gel_polish   uuid := '20000000-0000-0000-0000-000000000002';
  v_svc_classic_pedi uuid := '20000000-0000-0000-0000-000000000003';
  v_svc_spa_pedi     uuid := '20000000-0000-0000-0000-000000000004';
  v_svc_nail_art     uuid := '20000000-0000-0000-0000-000000000005';
begin
  if not exists (select 1 from auth.users where email = 'owner@tangnails.dev') then
    return;
  end if;

  -- Tax is pinned to 0 by the tickets_tax_cents_check on public.tickets (the
  -- salon is currently tax-free); totals are subtotal + 0.
  --
  -- ---- Ticket 1 ---- card, 1 service (classic mani $25), 20% tip = $5 → 500c
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('30000000-0000-0000-0000-000000000001', 'paid', 2500, 0, 2500, v_owner, v_owner, v_today_local_midnight + interval '9 hours' + interval '12 minutes')
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values ('30000000-0000-0000-0000-000000000001', 'service', v_svc_classic_mani, 'Classic manicure', 2500, 1, v_owner, false)
  on conflict do nothing;

  insert into public.payments (ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values ('30000000-0000-0000-0000-000000000001', 'card', 'payment', 2500, 500, 'succeeded', v_owner, v_today_local_midnight + interval '9 hours' + interval '12 minutes')
  on conflict do nothing;

  -- ---- Ticket 2 ---- cash, 2 services (gel polish $35 + classic pedi $40 = $75), 18% tip = $13.50 → 1350c
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('30000000-0000-0000-0000-000000000002', 'paid', 7500, 0, 7500, v_jordan, v_jordan, v_today_local_midnight + interval '10 hours' + interval '34 minutes')
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values
    ('30000000-0000-0000-0000-000000000002', 'service', v_svc_gel_polish,   'Gel polish',       3500, 1, v_jordan, false),
    ('30000000-0000-0000-0000-000000000002', 'service', v_svc_classic_pedi, 'Classic pedicure', 4000, 1, v_jordan, false)
  on conflict do nothing;

  insert into public.payments (ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values ('30000000-0000-0000-0000-000000000002', 'cash', 'payment', 7500, 1350, 'succeeded', v_jordan, v_today_local_midnight + interval '10 hours' + interval '34 minutes')
  on conflict do nothing;

  -- ---- Ticket 3 ---- gift, 1 service (classic pedi $40), 0% tip
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('30000000-0000-0000-0000-000000000003', 'paid', 4000, 0, 4000, v_sam, v_sam, v_today_local_midnight + interval '11 hours' + interval '48 minutes')
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values ('30000000-0000-0000-0000-000000000003', 'service', v_svc_classic_pedi, 'Classic pedicure', 4000, 1, v_sam, false)
  on conflict do nothing;

  insert into public.payments (ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values ('30000000-0000-0000-0000-000000000003', 'gift', 'payment', 4000, 0, 'succeeded', v_sam, v_today_local_midnight + interval '11 hours' + interval '48 minutes')
  on conflict do nothing;

  -- ---- Ticket 4 ---- split-tender (cash + card on same ticket), 2 services (classic mani $25 + spa pedi $55 = $80), 22% tip total = $17.60 → 1760c
  -- Split: $40 in cash + $40 in card. Each payment carries half the tip.
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('30000000-0000-0000-0000-000000000004', 'paid', 8000, 0, 8000, v_owner, v_jordan, v_today_local_midnight + interval '13 hours' + interval '5 minutes')
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values
    ('30000000-0000-0000-0000-000000000004', 'service', v_svc_classic_mani, 'Classic manicure', 2500, 1, v_owner,  false),
    ('30000000-0000-0000-0000-000000000004', 'service', v_svc_spa_pedi,     'Spa pedicure',     5500, 1, v_jordan, false)
  on conflict do nothing;

  insert into public.payments (ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values
    ('30000000-0000-0000-0000-000000000004', 'cash', 'payment', 4000, 880, 'succeeded', v_jordan, v_today_local_midnight + interval '13 hours' + interval '5 minutes'),
    ('30000000-0000-0000-0000-000000000004', 'card', 'payment', 4000, 880, 'succeeded', v_jordan, v_today_local_midnight + interval '13 hours' + interval '5 minutes' + interval '1 minute')
  on conflict do nothing;

  -- ---- Ticket 5 ---- card, 3 service items (classic mani + classic pedi + nail art $35) + 1 discount line (-$10), 25% tip
  -- Subtotal: 2500 + 4000 + 3500 - 1000 = 9000c. Total: 9000c (tax-free). Tip: 9000 * 0.25 = 2250c.
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('30000000-0000-0000-0000-000000000005', 'paid', 9000, 0, 9000, v_sam, v_sam, v_today_local_midnight + interval '15 hours' + interval '22 minutes')
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values
    ('30000000-0000-0000-0000-000000000005', 'service',  v_svc_classic_mani, 'Classic manicure',  2500, 1, v_sam, false),
    ('30000000-0000-0000-0000-000000000005', 'service',  v_svc_classic_pedi, 'Classic pedicure',  4000, 1, v_sam, false),
    ('30000000-0000-0000-0000-000000000005', 'service',  v_svc_nail_art,     'Nail art',          3500, 1, v_sam, false),
    ('30000000-0000-0000-0000-000000000005', 'discount', null,               'Loyalty discount', -1000, 1, null,  false)
  on conflict do nothing;

  insert into public.payments (ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values ('30000000-0000-0000-0000-000000000005', 'card', 'payment', 9000, 2250, 'succeeded', v_sam, v_today_local_midnight + interval '15 hours' + interval '22 minutes')
  on conflict do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- Feature 020 (Past Cash Counts) — three closed cash_drawer_sessions rows on
-- distinct historic business days. One clean ($0 variance), one over (+$3.50
-- with a note), one short (−$2.00 with a note). Deterministic UUIDs so re-runs
-- are idempotent via `on conflict do nothing`. Owner/manager closer mix so the
-- detail page shows both display names without further fixtures.
-- ---------------------------------------------------------------------------
do $$
declare
  v_today_local date := (now() at time zone 'America/Los_Angeles')::date;
  v_owner uuid := '10000000-0000-0000-0000-000000000001';
  v_jordan uuid := '10000000-0000-0000-0000-000000000002';
begin
  if not exists (select 1 from public.staff where id = v_owner) then
    return;
  end if;

  -- Clean: 7 days ago, exact match.
  insert into public.cash_drawer_sessions (
    id, opened_by_staff_id, opening_cents, closed_by_staff_id, closed_at,
    expected_cents, counted_cents, variance_cents, notes, business_day, opened_at
  ) values (
    '40000000-0000-0000-0000-000000000001',
    v_owner, 10000, v_owner,
    ((v_today_local - 7)::timestamp + interval '19 hours') at time zone 'America/Los_Angeles',
    12500, 22500, 0, null, (v_today_local - 7),
    ((v_today_local - 7)::timestamp + interval '9 hours') at time zone 'America/Los_Angeles'
  ) on conflict (id) do nothing;

  -- Over: 3 days ago, +$3.50.
  insert into public.cash_drawer_sessions (
    id, opened_by_staff_id, opening_cents, closed_by_staff_id, closed_at,
    expected_cents, counted_cents, variance_cents, notes, business_day, opened_at
  ) values (
    '40000000-0000-0000-0000-000000000002',
    v_jordan, 10000, v_jordan,
    ((v_today_local - 3)::timestamp + interval '19 hours') at time zone 'America/Los_Angeles',
    15000, 25350, 350, 'Customer tipped extra in cash.', (v_today_local - 3),
    ((v_today_local - 3)::timestamp + interval '9 hours') at time zone 'America/Los_Angeles'
  ) on conflict (id) do nothing;

  -- Short: 1 day ago, −$2.00.
  insert into public.cash_drawer_sessions (
    id, opened_by_staff_id, opening_cents, closed_by_staff_id, closed_at,
    expected_cents, counted_cents, variance_cents, notes, business_day, opened_at
  ) values (
    '40000000-0000-0000-0000-000000000003',
    v_owner, 10000, v_owner,
    ((v_today_local - 1)::timestamp + interval '19 hours') at time zone 'America/Los_Angeles',
    11000, 20800, -200, 'Drawer was off at open.', (v_today_local - 1),
    ((v_today_local - 1)::timestamp + interval '9 hours') at time zone 'America/Los_Angeles'
  ) on conflict (id) do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- Feature 047 (Payroll Page) — seeded payroll rates on the three seed staff,
-- one open pay period (May 16 – 31, 2026) and one closed pay period
-- (May 1 – 15, 2026) with frozen `payroll_payouts` rows. Guarded on the
-- seed owner so this NEVER runs against a production database. Fixed UUIDs
-- in the '70000000-…' range; idempotent via `on conflict do nothing`.
--
-- Rates are consistent with design-system/prototypes/payroll/data.jsx:
--   * Maya (owner)        — 90% commission, 100% tip split, $2,500 check
--   * Jordan (manager)    — 85% commission, 100% tip split, $1,500 check
--   * Sam (technician)    — 65% commission,  90% tip split, $1,003 check
--
-- Closed-period payouts satisfy `payroll_payouts_paid_consistency_chk` and
-- the cash clamp `cash = max(0, income_after_split + tips_after_split −
-- check_portion)`: Maya + Jordan are paid (Zelle / cash), Sam is a frozen
-- `paid = false` placeholder (closed while unpaid).
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner  uuid := '10000000-0000-0000-0000-000000000001';
  v_jordan uuid := '10000000-0000-0000-0000-000000000002';
  v_sam    uuid := '10000000-0000-0000-0000-000000000003';
  v_open_period   uuid := '70000000-0000-0000-0000-000000000001';
  v_closed_period uuid := '70000000-0000-0000-0000-000000000002';

  -- Semi-monthly windows derived from the salon-local "today" so the seeded
  -- periods always land where the page's offset math expects them — open at
  -- offset 0, closed (the previous half) at offset -1 — no matter which
  -- calendar day the seed runs on. (Pinned May-2026 dates silently drifted out
  -- of those offsets every 1st/16th and broke the US4 closed-period e2e.)
  -- Mirrors `semiMonthlyWindowAt` (lib/time/period-windows.ts): halves are
  -- [1..15] and [16..end-of-month]; pay date = end + 2 days.
  v_today        date    := (now() at time zone 'America/Los_Angeles')::date;
  v_month_start  date    := date_trunc('month', v_today)::date;
  v_second_half  boolean := extract(day from v_today) > 15;

  v_open_start   date := case when v_second_half then v_month_start + 15 else v_month_start end;
  v_open_end     date := case when v_second_half
                              then (date_trunc('month', v_today) + interval '1 month' - interval '1 day')::date
                              else v_month_start + 14 end;
  v_open_pay     date := v_open_end + 2;

  -- Previous half-month → the seeded closed period (offset -1).
  v_closed_start date := case when v_second_half
                              then v_month_start
                              else (date_trunc('month', v_today - interval '1 month') + interval '15 days')::date end;
  v_closed_end   date := v_open_start - 1;
  v_closed_pay   date := (v_open_start - 1) + 2;
  v_closed_at    timestamptz := (((v_open_start - 1) + 2)::timestamp + interval '11 hours')
                                  at time zone 'America/Los_Angeles';
begin
  if not exists (select 1 from public.staff where id = v_owner) then
    return;
  end if;
  if to_regclass('public.pay_periods') is null then
    return;
  end if;

  -- 1) Payroll rates on the three seed staff.
  update public.staff
     set service_commission_pct = 0.9000, tip_split_pct = 1.0000, check_portion_cents = 250000
   where id = v_owner;
  update public.staff
     set service_commission_pct = 0.8500, tip_split_pct = 1.0000, check_portion_cents = 150000
   where id = v_jordan;
  update public.staff
     set service_commission_pct = 0.6500, tip_split_pct = 0.9000, check_portion_cents = 100300
   where id = v_sam;

  -- 2) Open pay period: the current half-month (offset 0).
  insert into public.pay_periods (id, starts_on, ends_on, pay_date, status)
  values (v_open_period, v_open_start, v_open_end, v_open_pay, 'open')
  on conflict (id) do nothing;

  -- 3) Closed pay period: the previous half-month (offset -1), pay date + 2 days.
  insert into public.pay_periods (
    id, starts_on, ends_on, pay_date, status, closed_at, closed_by_staff_id
  ) values (
    v_closed_period, v_closed_start, v_closed_end, v_closed_pay, 'closed',
    v_closed_at, v_owner
  ) on conflict (id) do nothing;

  -- 4) Frozen payouts for the closed period.
  --    Maya — paid via Zelle. income_after = round(800000*0.90)=720000;
  --    tips_after = round(50000*1.00)=50000; cash = 720000+50000-250000 = 520000.
  insert into public.payroll_payouts (
    id, pay_period_id, staff_id, paid, method, paid_on,
    recorded_by_staff_id, paid_at,
    commissionable_cents, income_after_split_cents,
    card_tips_cents, tips_after_split_cents,
    check_portion_cents, cash_payment_cents,
    service_commission_pct, tip_split_pct
  ) values (
    '70000000-0000-0000-0000-000000000101', v_closed_period, v_owner, true, 'zelle',
    v_closed_pay, v_owner,
    v_closed_at,
    800000, 720000, 50000, 50000, 250000, 520000, 0.9000, 1.0000
  ) on conflict (pay_period_id, staff_id) do nothing;

  --    Jordan — paid via cash. income_after = round(600000*0.85)=510000;
  --    tips_after = round(40000*1.00)=40000; cash = 510000+40000-150000 = 400000.
  insert into public.payroll_payouts (
    id, pay_period_id, staff_id, paid, method, paid_on,
    recorded_by_staff_id, paid_at,
    commissionable_cents, income_after_split_cents,
    card_tips_cents, tips_after_split_cents,
    check_portion_cents, cash_payment_cents,
    service_commission_pct, tip_split_pct
  ) values (
    '70000000-0000-0000-0000-000000000102', v_closed_period, v_jordan, true, 'cash',
    v_closed_pay, v_owner,
    v_closed_at,
    600000, 510000, 40000, 40000, 150000, 400000, 0.8500, 1.0000
  ) on conflict (pay_period_id, staff_id) do nothing;

  --    Sam — frozen unpaid placeholder. income_after = round(450000*0.65)=292500;
  --    tips_after = round(35000*0.90)=31500; cash = 292500+31500-100300 = 223700.
  insert into public.payroll_payouts (
    id, pay_period_id, staff_id, paid,
    commissionable_cents, income_after_split_cents,
    card_tips_cents, tips_after_split_cents,
    check_portion_cents, cash_payment_cents,
    service_commission_pct, tip_split_pct
  ) values (
    '70000000-0000-0000-0000-000000000103', v_closed_period, v_sam, false,
    450000, 292500, 35000, 31500, 100300, 223700, 0.6500, 0.9000
  ) on conflict (pay_period_id, staff_id) do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- Feature 053 (Payroll reversals & adjustments) — two reversed tickets in the
-- CURRENT OPEN pay period (May 16 – 31, 2026) so the US1 e2e can assert that a
-- partial refund and a void land in payroll. Both are dated May 20, 2026 — a
-- prior day INSIDE the open window, deliberately NOT today (today is salon-
-- local May 30) so the today-scoped EOD-cash and dashboard baselines are not
-- perturbed. Both belong to Maya (10000000-…-001), the canonical seeded tech;
-- US1 e2e asserts against Maya's payout. Guarded on the seed owner so this
-- NEVER runs against production. Fixed UUIDs in the '31000000-…' range
-- (tickets) and '32000000-…' range (payments); idempotent via on-conflict.
--
-- Refund representation (per migrations 0026/0027):
--   * A refund is a NEW payments row, kind='refund', POSITIVE amount_cents
--     (refunded portion), tip_cents=0, method copied from the original,
--     refunds_payment_id -> the original payment, status 'succeeded' (cash
--     refunds are immediately succeeded). Original ticket_items stay UNTOUCHED.
--   * Ticket status is 'partially_refunded' when Σ succeeded refunds < Σ
--     succeeded original payments; 'void' for a fully-reversed same-day sale.
--
--   * Partial refund: $60 single-tech service (Maya), original cash payment
--     $60 succeeded + a $20 refund row (amount 2000, kind refund, tip 0,
--     refunds_payment_id -> original), ticket status 'partially_refunded'.
--   * Void: $60 single-tech service (Maya), original cash payment $60 +
--     a full $60 refund mirror row, ticket status 'void' (nets $0).
-- ---------------------------------------------------------------------------
do $$
declare
  v_maya uuid := '10000000-0000-0000-0000-000000000001';
  v_svc_spa_pedi uuid := '20000000-0000-0000-0000-000000000004';
  -- A prior day inside the open period (May 16 – 31), NOT today.
  v_when timestamptz := ('2026-05-20'::timestamp + interval '14 hours') at time zone 'America/Los_Angeles';
  -- Original payment ids referenced by the refund rows' refunds_payment_id.
  v_pr_orig_pay   uuid := '32000000-0000-0000-0000-000000000011';
  v_void_orig_pay uuid := '32000000-0000-0000-0000-000000000021';
begin
  if not exists (select 1 from auth.users where email = 'owner@tangnails.dev') then
    return;
  end if;

  -- ---- Ticket A ---- PARTIALLY REFUNDED: $60 service (Maya), $20 refunded.
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('31000000-0000-0000-0000-000000000001', 'partially_refunded', 6000, 0, 6000, v_maya, v_maya, v_when)
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values ('31000000-0000-0000-0000-000000000001', 'service', v_svc_spa_pedi, 'Spa pedicure', 6000, 1, v_maya, false)
  on conflict do nothing;

  -- Original cash payment $60, succeeded.
  insert into public.payments (id, ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values (v_pr_orig_pay, '31000000-0000-0000-0000-000000000001', 'cash', 'payment', 6000, 0, 'succeeded', v_maya, v_when)
  on conflict (id) do nothing;

  -- Refund row: $20 (2000c), kind refund, tip 0, same method, points at original, succeeded.
  insert into public.payments (id, ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at, refunds_payment_id)
  values ('32000000-0000-0000-0000-000000000012', '31000000-0000-0000-0000-000000000001', 'cash', 'refund', 2000, 0, 'succeeded', v_maya, v_when + interval '5 minutes', v_pr_orig_pay)
  on conflict (id) do nothing;

  -- ---- Ticket B ---- VOID: $60 service (Maya), fully reversed (nets $0).
  insert into public.tickets (id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_by_staff_id, closed_at)
  values ('31000000-0000-0000-0000-000000000002', 'void', 6000, 0, 6000, v_maya, v_maya, v_when)
  on conflict (id) do nothing;

  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed)
  values ('31000000-0000-0000-0000-000000000002', 'service', v_svc_spa_pedi, 'Spa pedicure', 6000, 1, v_maya, false)
  on conflict do nothing;

  -- Original cash payment $60, succeeded.
  insert into public.payments (id, ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at)
  values (v_void_orig_pay, '31000000-0000-0000-0000-000000000002', 'cash', 'payment', 6000, 0, 'succeeded', v_maya, v_when)
  on conflict (id) do nothing;

  -- Full $60 refund mirror row, succeeded -> nets $0.
  insert into public.payments (id, ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id, processed_at, refunds_payment_id)
  values ('32000000-0000-0000-0000-000000000022', '31000000-0000-0000-0000-000000000002', 'cash', 'refund', 6000, 0, 'succeeded', v_maya, v_when + interval '5 minutes', v_void_orig_pay)
  on conflict (id) do nothing;
end
$$;
