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
    '--accent-rose',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Jordan Lee',
    'manager',
    '$2b$11$ixukE2AGjrZs3diU3DJbk.ee1XcDBdkg.GlRUABhzcHX.20ELBPiq',
    '--accent-amber',
    true
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    null,
    'Sam Chen',
    'technician',
    '$2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W',
    '--accent-violet',
    true
  )
on conflict (id) do nothing;
