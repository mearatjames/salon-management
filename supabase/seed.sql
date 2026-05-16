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
