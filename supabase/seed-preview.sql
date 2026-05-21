-- =====================================================================
-- Tang Nails — PREVIEW seed: richer historical data.
--
-- This is NOT the local dev seed (`supabase/seed.sql`) and is NOT run by
-- `supabase db reset` or by the migration workflows. Run it MANUALLY,
-- ONCE, against the PREVIEW Supabase project — either:
--   * Supabase dashboard -> SQL editor -> paste this file -> Run, or
--   * psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed-preview.sql
--
-- Do NOT run it against production.
--
-- The entire script is ONE `DO` block on purpose: the Supabase SQL editor
-- may run separate top-level statements on separate connections, which
-- breaks any cross-statement temp table. Keeping it as a single statement
-- means the catalog table, the services insert, and the generator all
-- share one session.
--
-- Idempotent: every row uses a deterministic md5-derived UUID, so a
-- second run is a no-op (every insert is `on conflict (id) do nothing`).
--
-- What it creates:
--   * The full services catalog (95 services across 6 categories) taken
--     verbatim from the design prototype
--     design-system/prototypes/transaction/data.jsx — the shared catalog
--     the "New transaction — tablet (front desk)" flow consumes.
--   * a "Cat Eye" supply type attached to the "Cat eyes" add-on service
--     as a $3 tech-borne supply deduction (Report / Payroll subtract it).
--   * ~200-260 paid tickets spanning the last 30 salon-local days. Every
--     ticket has one primary service (Manicure / Pedicure / Enhancement /
--     Waxing) plus 0-2 add-on lines, all referencing the catalog above,
--     with an occasional loyalty-discount line.
--   * card / cash / gift / split-tender payments with realistic tips.
--   * one closed cash_drawer_sessions row per PAST day (today is skipped
--     so the in-app end-of-day close flow stays testable on preview).
--
-- Staff: resolved from whatever active roster already exists on the
-- project — no new staff or auth users are created; login is unaffected.
--
-- Note: the catalog is ADDED. Any services the project already had remain
-- in place; archive them in the app if you want a clean catalog.
--
-- To remove the generated history, see the CLEANUP block at the bottom.
-- =====================================================================

do $$
declare
  v_tz           text;
  v_today_local  date;
  v_staff        uuid[];
  v_nstaff       int;
  v_owner        uuid;

  -- Service pools, drawn from the prototype catalog.
  v_pri_ids      uuid[];   -- primary: Manicure / Pedicure / Enhancement / Waxing
  v_pri_prices   int[];
  v_pri_names    text[];
  v_npri         int;
  v_sec_ids      uuid[];   -- secondary: Add-ons / Removal
  v_sec_prices   int[];
  v_sec_names    text[];
  v_nsec         int;
  v_supply_type  uuid;     -- the "Cat Eye" supply type (resolved or created)

  v_d            int;
  v_i            int;
  v_line         int;
  v_day_local    date;
  v_n_tickets    int;
  v_n_lines      int;
  v_ticket_id    uuid;
  v_md5          text;
  v_h            bigint;
  v_h_time       bigint;
  v_h_actor      bigint;
  v_h_pay        bigint;
  v_lh           bigint;
  v_actor        uuid;
  v_close_at     timestamptz;

  v_ln_ref       uuid[];
  v_ln_name      text[];
  v_ln_price     int[];
  v_ln_staff     uuid[];
  v_idx          int;
  v_subtotal     int;
  v_discount     int;
  v_total        int;

  v_method       text;
  v_tip_pct      int;
  v_tip          int;
  v_split_a      int;
  v_split_b      int;
  v_tip_a        int;
  v_tip_b        int;

  v_day_cash     int;
  v_cdh          bigint;
  v_variance     int;
  v_opening      int := 10000;   -- $100.00 opening float

  v_svc_count    int := 0;
  v_ticket_count int := 0;
  v_drawer_count int := 0;
begin
  -- ------------------------------------------------------------------
  -- Salon timezone (stored as a JSON string in public.settings).
  -- ------------------------------------------------------------------
  select coalesce(value #>> '{}', 'America/Los_Angeles')
    into v_tz
    from public.settings
    where key = 'salon.timezone';
  if v_tz is null then
    v_tz := 'America/Los_Angeles';
  end if;
  v_today_local := (now() at time zone v_tz)::date;

  -- ------------------------------------------------------------------
  -- Staff — use the existing roster (owner first).
  -- ------------------------------------------------------------------
  select array_agg(id order by
           case role when 'owner' then 0 when 'manager' then 1 else 2 end,
           display_name)
    into v_staff
    from public.staff
    where active = true and removed_at is null;

  if v_staff is null or array_length(v_staff, 1) = 0 then
    raise notice 'seed-preview: no active staff found — nothing seeded. Create staff first.';
    return;
  end if;
  v_nstaff := array_length(v_staff, 1);
  v_owner  := v_staff[1];

  -- ------------------------------------------------------------------
  -- Prototype services catalog -> temp table.
  -- proto_id / name / category / duration / price are copied verbatim
  -- from data.jsx. `variable` mirrors the prototype `variable` flag;
  -- price_from/to are set only where the prototype defines a range.
  -- Created inside this DO block so it shares the block's session.
  -- ------------------------------------------------------------------
  drop table if exists _preview_seed_catalog;
  create temp table _preview_seed_catalog (
    proto_id          text primary key,
    name              text    not null,
    category          text    not null,
    duration_min      int     not null,
    price_cents       int     not null,
    variable          boolean not null,
    price_from_cents  int,
    price_to_cents    int
  );

  insert into _preview_seed_catalog
    (proto_id, name, category, duration_min, price_cents, variable, price_from_cents, price_to_cents)
  values
    -- ----- Manicure -----
    ('classic-mani','Classic mani','Manicure',30,2500,true,null,null),
    ('manicure-gel','Manicure Gel','Manicure',30,4000,false,null,null),
    ('manicure-regular-polish','Manicure Regular Polish','Manicure',45,2500,true,null,null),
    ('polish-change-natural','Polish change (On Natural Nails)','Manicure',40,1500,true,null,null),
    ('gel-polish-change-natural','Gel Polish Change On Natural Nails','Manicure',60,2500,true,null,null),
    ('mens-mani','Mens mani','Manicure',30,2500,true,null,null),
    ('nails-cut','Nails cut','Manicure',30,1000,true,null,null),
    ('regular-polish-change-hands','Regular polish change on hands','Manicure',30,1500,true,null,null),
    ('gel-color-change','Gel color change','Manicure',30,2000,true,null,null),
    -- ----- Pedicure -----
    ('classic-pedi','Classic Pedicure','Pedicure',45,3800,true,3800,5300),
    ('classic-pedi-gel','Classic pedicure w Gel','Pedicure',30,5300,true,null,null),
    ('express-pedi','Express Pedi','Pedicure',30,3300,true,3300,4800),
    ('deluxe-pedi','Deluxe Pedicure','Pedicure',30,5500,true,5500,7000),
    ('deluxe-pedi-reg','Deluxe Pedi w Reg Color','Pedicure',30,6000,true,null,null),
    ('deluxe-pedi-gel','Deluxe Pedi w Gel Polish','Pedicure',30,7500,true,null,null),
    ('deep-clean-pedi','Deep Clean Pedi','Pedicure',30,5000,true,null,null),
    ('vitamin-recharge-pedi','Vitamin Recharge Pedicure','Pedicure',30,7800,true,7800,8800),
    ('energy-boost-pedi','Energy Boost Pedicure','Pedicure',30,7300,true,7300,8800),
    ('energy-boost-pedi-reg','Energy boost pedi w regular','Pedicure',30,7000,false,null,null),
    ('hemp-steam-pedi','Hemp Relaxation Steam Pedicure','Pedicure',30,8600,true,8600,10100),
    ('lavender-steam-pedi-reg','Lavender Steam Pedi with Regular Color','Pedicure',60,8600,true,8600,10100),
    ('milk-honey-pedi','Milk and Honey Pedicure','Pedicure',30,0,false,null,null),
    ('kid-pedi','Kid Pedi (8 yr & under)','Pedicure',30,2500,true,null,null),
    ('toe-polish-change','Toe polish change','Pedicure',30,1500,true,null,null),
    ('toe-nails-cut','Toe nails cut','Pedicure',30,1000,true,null,null),
    -- ----- Enhancement -----
    ('acrylic-fullset-gel','Acrylic Full Set w/Gel','Enhancement',120,8000,true,null,null),
    ('acrylic-fills-gel','Acrylic Fills w/Gel','Enhancement',120,6500,true,null,null),
    ('acrylic-fill-3wk','3+ week acrylic fill w/Gel','Enhancement',30,7000,true,null,null),
    ('gel-polish-change-acrylic','Gel Polish Change on Acrylic','Enhancement',45,3000,true,null,null),
    ('hard-gel-overlay','Hard Gel Overlay','Enhancement',45,5300,false,null,null),
    ('hard-gel-rebase','Hard Gel Rebase','Enhancement',75,5300,false,null,null),
    ('rebase-4wk','4+ weeks Rebase','Enhancement',30,5800,false,null,null),
    ('builder-gel','Builder Gel','Enhancement',75,5300,false,null,null),
    ('gelx-fullset','Gel X Fullset (Soft Gel Extension)','Enhancement',90,6500,false,null,null),
    ('gelx-refill','Gel X Refill','Enhancement',30,5500,true,null,null),
    ('gelx-apres','Gel X (Aprés) Soft Gel Extension','Enhancement',30,6500,true,null,null),
    ('dipping-powder','Dipping Powder','Enhancement',30,5000,false,null,null),
    ('dipping-gel','Dipping with Gel polish','Enhancement',30,5500,false,null,null),
    -- ----- Add-ons -----
    ('addon-french-tips','French Tips','Add-ons',30,1000,true,null,null),
    ('addon-side-french','Side French','Add-ons',30,1000,true,null,null),
    ('addon-double-french','Double French','Add-ons',30,1500,true,null,null),
    ('addon-custom-pink-french','Custom pink on French','Add-ons',30,1500,true,null,null),
    ('addon-designs','Designs','Add-ons',30,500,true,null,null),
    ('addon-3d-designs','3D designs','Add-ons',30,1000,true,null,null),
    ('addon-airbrush','Airbrush Designs','Add-ons',30,1000,true,null,null),
    ('addon-airbrush-ombre','Air brush ombre','Add-ons',30,1500,true,null,null),
    ('addon-ombre','Ombre Designs','Add-ons',30,1500,true,null,null),
    ('addon-cat-eyes','Cat eyes','Add-ons',30,1000,true,null,null),
    ('addon-foil','Foil Transfer','Add-ons',30,1000,true,null,null),
    ('addon-encapsulation','Encapsulation Design','Add-ons',30,1500,true,null,null),
    ('addon-custom-art-all10','Custom nail art (all 10 nails)','Add-ons',30,2500,true,null,null),
    ('addon-rhinestones','Rhinestones Designs','Add-ons',30,1000,true,null,null),
    ('addon-gold-flakes','Gold Flakes','Add-ons',30,1000,true,null,null),
    ('addon-nail-charms','Nail Charms','Add-ons',30,1000,true,null,null),
    ('addon-fairy-dust','Fairy dust','Add-ons',30,500,true,null,null),
    ('addon-sugar-effect','Sugar Effect','Add-ons',30,500,true,null,null),
    ('addon-matte','Matte','Add-ons',30,500,true,null,null),
    ('addon-chrome','Chrome','Add-ons',30,1000,true,null,null),
    ('addon-stain-re-topcoat','Stain Re top coat','Add-ons',30,500,true,null,null),
    ('addon-shining-buff','Shining Buff','Add-ons',30,700,false,null,null),
    ('addon-nail-length','Nail Length','Add-ons',30,500,true,null,null),
    ('addon-nail-shape','Nail shape','Add-ons',30,500,true,null,null),
    ('addon-changing-shape','Changing Shape','Add-ons',30,500,true,null,null),
    ('addon-cut-reshape','Cut Short and Reshape','Add-ons',30,500,true,null,null),
    ('addon-cuticle-trim','Cuticle Trim','Add-ons',30,500,true,null,null),
    ('addon-nail-fixing','Nail Fixing','Add-ons',30,500,true,null,null),
    ('addon-nail-replacing','Nail Replacing','Add-ons',30,500,true,null,null),
    ('addon-sculpted','Sculpted','Add-ons',30,1000,true,null,null),
    ('addon-gel-polish','Gel polish (add-on)','Add-ons',30,1500,true,null,null),
    ('addon-colors-3plus','Up to 3+ colors','Add-ons',30,500,true,null,null),
    ('addon-colors-5plus','Up to 5+ colors','Add-ons',30,1000,true,null,null),
    ('addon-colors-10plus','Up to 10+ colors','Add-ons',30,1500,true,null,null),
    ('addon-paraffin','Paraffin (feet)','Add-ons',30,1000,true,null,null),
    ('addon-callus','Callus treatment','Add-ons',30,1000,true,null,null),
    ('addon-sugar-scrub','Sugar scrub (feet)','Add-ons',30,1000,true,null,null),
    ('addon-deep-clean-toes','Deep clean on toes','Add-ons',30,1000,true,null,null),
    ('addon-toe-recon','Toe Nails Reconstruction','Add-ons',30,1000,true,null,null),
    ('addon-gel-color-toes','GEL color change on toes','Add-ons',30,2000,true,null,null),
    ('addon-acrylic-toes','Acrylic on toes','Add-ons',30,2000,true,null,null),
    ('addon-acrylic-set-toes','Acrylic set on Toes','Add-ons',30,3000,true,null,null),
    ('addon-acrylic-full-toes','Acrylic Full Set on Toes','Add-ons',30,5000,true,null,null),
    ('addon-acrylic-take-off-toes','Acrylic Take off on toes','Add-ons',30,1000,true,null,null),
    -- ----- Waxing -----
    ('wax-eyebrows','Eyebrows Wax','Waxing',30,1200,true,null,null),
    ('wax-chin','Chin Wax','Waxing',30,1000,true,null,null),
    ('wax-lips','Lips wax','Waxing',30,800,true,null,null),
    ('wax-mustache','Mustache Wax','Waxing',30,1000,true,null,null),
    ('wax-full-face','Full face Wax','Waxing',30,3500,true,null,null),
    ('wax-arms','Arms Wax','Waxing',30,3500,true,null,null),
    ('wax-underarms','Underarms Wax','Waxing',30,2000,true,null,null),
    ('wax-legs','Legs wax','Waxing',30,5000,true,null,null),
    -- ----- Removal -----
    ('removal-gel','Gel Polish Removal','Removal',30,1000,true,null,null),
    ('removal-acrylic','Acrylic Removal','Removal',30,1500,true,null,null),
    ('removal-hard-gel','Hard Gel Removal','Removal',30,1500,true,null,null),
    ('removal-gelx','Gel X Removal','Removal',30,1000,true,null,null),
    ('removal-dipping','Dipping Powder Removal','Removal',30,1500,true,null,null);

  -- ------------------------------------------------------------------
  -- Upsert the catalog into public.services. Deterministic UUIDs keep
  -- it idempotent; color_token is hash-picked from the avatar palette.
  -- price_from/to are already null for every fixed-price row, which the
  -- fixed-price CHECK requires.
  -- ------------------------------------------------------------------
  insert into public.services
    (id, name, category, duration_min, price_cents, color_token, taxable,
     variable_price, price_from_cents, price_to_cents)
  select
    md5('preview-seed:service:' || proto_id)::uuid,
    name, category, duration_min, price_cents,
    (array['--avatar-rose','--avatar-amber','--avatar-purple','--avatar-green',
           '--avatar-blue','--avatar-teal','--avatar-orange','--avatar-slate'])
      [1 + ((('x' || substr(md5(proto_id), 1, 8))::bit(32)::bigint & 2147483647) % 8)::int],
    true, variable, price_from_cents, price_to_cents
  from _preview_seed_catalog
  on conflict (id) do nothing;

  get diagnostics v_svc_count = row_count;

  -- ------------------------------------------------------------------
  -- Supply deduction — the "Cat Eye" supply type, attached to the
  -- "Cat eyes" add-on service as a $3.00 tech-borne material cost.
  --
  -- The Report / Payroll read models derive supply deductions live from
  -- services.supply_amount_cents (lib/report/aggregate.ts), so attaching
  -- it here makes every seeded ticket with a "Cat eyes" line carry the
  -- deduction in the open period's computed payout — no payroll_payouts
  -- or pay_periods rows are seeded (the app creates the period lazily).
  --
  -- Resolve an existing "Cat Eye" type by canonical name first (the demo
  -- may already have one created via the UI); only insert when absent.
  -- The UPDATE is guarded on `supply_type_id is null` so a re-run — or a
  -- supply amount later changed in the UI — is left untouched.
  -- ------------------------------------------------------------------
  select id into v_supply_type
    from public.supply_types
    where name_canonical = 'cat eye' and archived = false;

  if v_supply_type is null then
    insert into public.supply_types (id, name)
    values (md5('preview-seed:supply-type:cat-eye')::uuid, 'Cat Eye')
    on conflict do nothing;
    select id into v_supply_type
      from public.supply_types
      where name_canonical = 'cat eye' and archived = false;
  end if;

  if v_supply_type is not null then
    update public.services
       set supply_type_id      = v_supply_type,
           supply_amount_cents = 300
     where id = md5('preview-seed:service:addon-cat-eyes')::uuid
       and supply_type_id is null;
  end if;

  -- ------------------------------------------------------------------
  -- Service pools. Every ticket gets one primary-pool line + 0-2
  -- secondary-pool lines, so each ticket has a real anchor service.
  -- price_cents > 0 excludes the $0 promo item from being a ticket line
  -- (it stays in the catalog).
  -- ------------------------------------------------------------------
  select array_agg(md5('preview-seed:service:' || proto_id)::uuid order by proto_id),
         array_agg(price_cents                                  order by proto_id),
         array_agg(name                                         order by proto_id)
    into v_pri_ids, v_pri_prices, v_pri_names
    from _preview_seed_catalog
    where price_cents > 0
      and category in ('Manicure', 'Pedicure', 'Enhancement', 'Waxing');
  v_npri := array_length(v_pri_ids, 1);

  select array_agg(md5('preview-seed:service:' || proto_id)::uuid order by proto_id),
         array_agg(price_cents                                  order by proto_id),
         array_agg(name                                         order by proto_id)
    into v_sec_ids, v_sec_prices, v_sec_names
    from _preview_seed_catalog
    where price_cents > 0
      and category in ('Add-ons', 'Removal');
  v_nsec := array_length(v_sec_ids, 1);

  -- ------------------------------------------------------------------
  -- Generate 30 salon-local days of paid-ticket history.
  -- ------------------------------------------------------------------
  for v_d in 0..29 loop
    v_day_local := v_today_local - v_d;
    v_day_cash  := 0;

    v_h := (('x' || substr(md5('preview-seed:count:' || v_d), 1, 8))::bit(32)::bigint) & 2147483647;
    v_n_tickets := 5 + (v_h % 8)::int;   -- 5..12 tickets per day

    for v_i in 0..v_n_tickets - 1 loop
      v_ticket_id := md5('preview-seed:ticket:' || v_d || ':' || v_i)::uuid;
      v_md5     := md5('preview-seed:rng:' || v_d || ':' || v_i);
      v_h       := (('x' || substr(v_md5,  1, 8))::bit(32)::bigint) & 2147483647;
      v_h_time  := (('x' || substr(v_md5,  9, 8))::bit(32)::bigint) & 2147483647;
      v_h_actor := (('x' || substr(v_md5, 17, 8))::bit(32)::bigint) & 2147483647;
      v_h_pay   := (('x' || substr(v_md5, 25, 8))::bit(32)::bigint) & 2147483647;

      v_n_lines := 1 + (v_h % 3)::int;                       -- 1..3 service lines
      v_actor   := v_staff[1 + (v_h_actor % v_nstaff)::int]; -- opener/closer/cashier

      v_close_at := (v_day_local::timestamp
                      + make_interval(hours => 9 + (v_h_time % 10)::int,
                                      mins  => (v_h_time % 60)::int))
                    at time zone v_tz;

      -- --- pick the service lines, accumulate the subtotal -------------
      v_ln_ref   := '{}'::uuid[];
      v_ln_name  := '{}'::text[];
      v_ln_price := '{}'::int[];
      v_ln_staff := '{}'::uuid[];
      v_subtotal := 0;
      for v_line in 0..v_n_lines - 1 loop
        v_lh := (('x' || substr(md5('preview-seed:line:' || v_d || ':' || v_i || ':' || v_line), 1, 8))::bit(32)::bigint) & 2147483647;
        if v_line = 0 then
          v_idx := 1 + (v_lh % v_npri)::int;                 -- primary pool
          v_ln_ref   := array_append(v_ln_ref,   v_pri_ids[v_idx]);
          v_ln_name  := array_append(v_ln_name,  v_pri_names[v_idx]);
          v_ln_price := array_append(v_ln_price, v_pri_prices[v_idx]);
          v_subtotal := v_subtotal + v_pri_prices[v_idx];
        else
          v_idx := 1 + (v_lh % v_nsec)::int;                 -- secondary pool
          v_ln_ref   := array_append(v_ln_ref,   v_sec_ids[v_idx]);
          v_ln_name  := array_append(v_ln_name,  v_sec_names[v_idx]);
          v_ln_price := array_append(v_ln_price, v_sec_prices[v_idx]);
          v_subtotal := v_subtotal + v_sec_prices[v_idx];
        end if;
        v_lh := (('x' || substr(md5('preview-seed:linestaff:' || v_d || ':' || v_i || ':' || v_line), 1, 8))::bit(32)::bigint) & 2147483647;
        v_ln_staff := array_append(v_ln_staff, v_staff[1 + (v_lh % v_nstaff)::int]);
      end loop;

      -- 1-in-5 tickets carry a loyalty discount (only when it leaves a
      -- positive total — keeps payments.amount_cents > 0 satisfied).
      v_discount := 0;
      if (v_h % 5) = 0 and v_subtotal > 3000 then
        v_discount := -1000;
      end if;
      v_total := v_subtotal + v_discount;

      -- --- ticket row --------------------------------------------------
      insert into public.tickets (
        id, status, subtotal_cents, tax_cents, total_cents,
        opened_by_staff_id, closed_by_staff_id, closed_at, created_at, updated_at
      ) values (
        v_ticket_id, 'paid', v_total, 0, v_total,
        v_actor, v_actor, v_close_at, v_close_at - interval '20 minutes', v_close_at
      )
      on conflict (id) do nothing;

      -- --- service line items -----------------------------------------
      for v_line in 0..v_n_lines - 1 loop
        insert into public.ticket_items (
          id, ticket_id, kind, ref_id, name_snapshot, unit_price_cents,
          qty, assigned_staff_id, price_unconfirmed, created_at
        ) values (
          md5('preview-seed:item:' || v_d || ':' || v_i || ':' || v_line)::uuid,
          v_ticket_id, 'service', v_ln_ref[v_line + 1], v_ln_name[v_line + 1],
          v_ln_price[v_line + 1], 1, v_ln_staff[v_line + 1], false, v_close_at
        )
        on conflict (id) do nothing;
      end loop;

      -- --- optional discount line -------------------------------------
      if v_discount < 0 then
        insert into public.ticket_items (
          id, ticket_id, kind, ref_id, name_snapshot, unit_price_cents,
          qty, assigned_staff_id, price_unconfirmed, created_at
        ) values (
          md5('preview-seed:item:' || v_d || ':' || v_i || ':discount')::uuid,
          v_ticket_id, 'discount', null, 'Loyalty discount', v_discount,
          1, null, false, v_close_at
        )
        on conflict (id) do nothing;
      end if;

      -- --- payment(s) --------------------------------------------------
      -- Method mix: ~55% card, ~28% cash, ~10% gift, ~7% split-tender.
      if    (v_h_pay % 100) < 55 then v_method := 'card';
      elsif (v_h_pay % 100) < 83 then v_method := 'cash';
      elsif (v_h_pay % 100) < 93 then v_method := 'gift';
      else                            v_method := 'split';
      end if;

      v_tip_pct := (array[0, 15, 18, 20, 20, 22, 25])[1 + (v_h_pay % 7)::int];
      if v_method = 'gift' then
        v_tip := 0;
      else
        v_tip := round(v_total * v_tip_pct / 100.0)::int;
      end if;

      if v_method = 'split' then
        -- Cash + card on one ticket; each payment carries half the tip.
        v_split_a := v_total / 2;            -- cash portion
        v_split_b := v_total - v_split_a;    -- card portion (remainder)
        v_tip_a   := v_tip / 2;
        v_tip_b   := v_tip - v_tip_a;
        insert into public.payments (
          id, ticket_id, method, kind, amount_cents, tip_cents, status,
          taken_by_staff_id, processed_at
        ) values
          (md5('preview-seed:pay:' || v_d || ':' || v_i || ':a')::uuid,
           v_ticket_id, 'cash', 'payment', v_split_a, v_tip_a, 'succeeded',
           v_actor, v_close_at),
          (md5('preview-seed:pay:' || v_d || ':' || v_i || ':b')::uuid,
           v_ticket_id, 'card', 'payment', v_split_b, v_tip_b, 'succeeded',
           v_actor, v_close_at + interval '1 minute')
        on conflict (id) do nothing;
        v_day_cash := v_day_cash + v_split_a;
      else
        insert into public.payments (
          id, ticket_id, method, kind, amount_cents, tip_cents, status,
          taken_by_staff_id, processed_at
        ) values (
          md5('preview-seed:pay:' || v_d || ':' || v_i || ':x')::uuid,
          v_ticket_id, v_method::public.payment_method, 'payment', v_total,
          v_tip, 'succeeded', v_actor, v_close_at
        )
        on conflict (id) do nothing;
        if v_method = 'cash' then
          v_day_cash := v_day_cash + v_total;
        end if;
      end if;

      v_ticket_count := v_ticket_count + 1;
    end loop;

    -- ----------------------------------------------------------------
    -- Closed cash-drawer session for every PAST day (skip today so the
    -- in-app end-of-day close flow remains testable on preview).
    -- expected_cents is the day's cash-payment total, matching what the
    -- pos_close_cash_drawer RPC re-derives. Most days reconcile exactly;
    -- ~1 in 6 carries a small variance with a required note.
    -- ----------------------------------------------------------------
    if v_d >= 1 then
      v_cdh := (('x' || substr(md5('preview-seed:drawer:' || v_d), 1, 8))::bit(32)::bigint) & 2147483647;
      if (v_cdh % 6) = 0 then
        v_variance := (array[-300, -200, 250, 350])[1 + (v_cdh % 4)::int];
      else
        v_variance := 0;
      end if;

      insert into public.cash_drawer_sessions (
        id, opened_by_staff_id, opening_cents, closed_by_staff_id, closed_at,
        expected_cents, counted_cents, variance_cents, notes, business_day, opened_at
      ) values (
        md5('preview-seed:drawer:' || v_d)::uuid,
        v_owner, v_opening, v_owner,
        (v_day_local::timestamp + interval '19 hours 30 minutes') at time zone v_tz,
        v_day_cash,
        v_opening + v_day_cash + v_variance,
        v_variance,
        case when v_variance = 0 then null
             else (array[
               'Customer tipped extra in cash.',
               'Drawer was short at open.',
               'Miscount corrected at close.',
               'Found extra cash behind the register.'
             ])[1 + (v_cdh % 4)::int]
        end,
        v_day_local,
        (v_day_local::timestamp + interval '9 hours') at time zone v_tz
      )
      on conflict (id) do nothing;
      v_drawer_count := v_drawer_count + 1;
    end if;
  end loop;

  drop table if exists _preview_seed_catalog;

  raise notice 'seed-preview: % catalog services inserted, % tickets and % cash-drawer sessions ensured across 30 days (% staff).',
    v_svc_count, v_ticket_count, v_drawer_count, v_nstaff;
end
$$;

-- =====================================================================
-- CLEANUP — uncomment and run to remove the generated ticket history.
-- The id ranges (days 0..29, up to 30 tickets/day) are a safe superset;
-- md5s for rows that were never created simply match nothing.
-- payments must go before tickets (no ON DELETE CASCADE on that FK);
-- ticket_items cascade with their ticket. The services catalog is left
-- in place — archive unwanted services in the app instead.
-- ---------------------------------------------------------------------
-- delete from public.payments where ticket_id in (
--   select md5('preview-seed:ticket:' || d || ':' || i)::uuid
--   from generate_series(0, 29) d, generate_series(0, 29) i
-- );
-- delete from public.tickets where id in (
--   select md5('preview-seed:ticket:' || d || ':' || i)::uuid
--   from generate_series(0, 29) d, generate_series(0, 29) i
-- );
-- delete from public.cash_drawer_sessions where id in (
--   select md5('preview-seed:drawer:' || d)::uuid
--   from generate_series(1, 29) d
-- );
-- =====================================================================
