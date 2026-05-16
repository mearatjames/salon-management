-- Migration: 0006_cart_polish.sql
-- Feature: 013-cart-polish (part 2 of 2)
--
-- Cart-polish DDL: discount-line support, services.presets, settings table,
-- + the kind-conditional ticket_items invariants. Re-emits pos_take_cash
-- verbatim from 0004 (body unchanged) so any later body change lands in a
-- single migration boundary rather than depending on a possibly-stale 0004
-- copy.
--
-- Ordering note: the `'discount'` enum label is added in
-- 0005_add_discount_enum_value.sql (a separate file) so the new value is
-- visible to the CHECK constraints below. Postgres rejects the combined
-- form when an in-transaction CHECK or INSERT mentions a freshly added
-- enum label (SQLSTATE 55P04).

-- ----------------------------------------------------------------------
-- 1. ticket_items column adds + nullability relax for discount rows
-- ----------------------------------------------------------------------
alter table public.ticket_items
  add column discount_pct numeric(5,2) null,
  add column note text null,
  alter column ref_id            drop not null,
  alter column assigned_staff_id drop not null;

-- ----------------------------------------------------------------------
-- 2. ticket_items CHECK additions + unit_price relax (kind-conditional)
-- ----------------------------------------------------------------------
alter table public.ticket_items
  drop constraint ticket_items_unit_price_cents_check;
alter table public.ticket_items
  add constraint ticket_items_unit_price_cents_chk check (
    (kind = 'service'  and unit_price_cents >= 0)
    or (kind = 'discount' and unit_price_cents <= 0)
  );
alter table public.ticket_items
  add constraint ticket_items_note_length_chk check (
    note is null or length(note) <= 80
  );
alter table public.ticket_items
  add constraint ticket_items_kind_columns_chk check (
    (kind = 'service'
       and ref_id is not null
       and assigned_staff_id is not null
       and discount_pct is null)
    or (kind = 'discount'
       and ref_id is null
       and assigned_staff_id is null)
  );

-- ----------------------------------------------------------------------
-- 3. services.presets — operator-curated quick-pick chips for variable-
--    priced services (e.g. nail art Small / Medium / Large).
-- ----------------------------------------------------------------------
alter table public.services
  add column presets jsonb null;
alter table public.services
  add constraint services_presets_array_chk check (
    presets is null or jsonb_typeof(presets) = 'array'
  );

-- ----------------------------------------------------------------------
-- 4. settings — small key/value JSON store for salon info + thresholds.
--    RLS: select-to-authenticated only; writes go through the service-role
--    client just like every other table in this app.
-- ----------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key check (length(trim(key)) > 0),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists settings_select_authenticated on public.settings;
create policy settings_select_authenticated
  on public.settings for select to authenticated using (true);

create or replace function public.settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists settings_set_updated_at_trg on public.settings;
create trigger settings_set_updated_at_trg
  before update on public.settings
  for each row execute function public.settings_set_updated_at();

insert into public.settings (key, value) values
  ('salon.name',                       to_jsonb('Tang Nails'::text)),
  ('salon.address',                    to_jsonb('218 Hayes St · San Francisco, CA'::text)),
  ('salon.phone',                      to_jsonb('(415) 555-0140'::text)),
  ('discount.manager_threshold_cents', 'null'::jsonb)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------
-- 5. pos_take_cash RPC — re-emit (body unchanged from 0004).
-- ----------------------------------------------------------------------
create or replace function public.pos_take_cash(
  p_ticket_id uuid,
  p_operator  uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_unconfirmed_count int;
  v_payment_id uuid;
begin
  -- 1) Lock the ticket; refuse if not open.
  perform 1 from public.tickets where id = p_ticket_id and status = 'open' for update;
  if not found then
    raise exception 'ticket_not_open' using errcode = 'P0001';
  end if;

  -- 2) Refuse if any line is unconfirmed (FR-015).
  select count(*) into v_unconfirmed_count
    from public.ticket_items
    where ticket_id = p_ticket_id and price_unconfirmed = true;
  if v_unconfirmed_count > 0 then
    raise exception 'ticket_has_unpriced_items' using errcode = 'P0001';
  end if;

  -- 3) Read the trusted server-side total.
  select total_cents into v_total from public.tickets where id = p_ticket_id;
  if v_total <= 0 then
    raise exception 'ticket_empty' using errcode = 'P0001';
  end if;

  -- 4) Insert the cash payment row.
  insert into public.payments (ticket_id, method, kind, amount_cents, status, taken_by_staff_id)
    values (p_ticket_id, 'cash', 'payment', v_total, 'succeeded', p_operator)
    returning id into v_payment_id;

  -- 5) Flip the ticket to paid.
  update public.tickets
    set status = 'paid',
        closed_by_staff_id = p_operator,
        closed_at = now(),
        updated_at = now()
    where id = p_ticket_id;

  -- 6) Audit ('payment.captured' — controlled vocab in lib/auth/audit.ts).
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (p_operator, 'payment.captured', 'payment', v_payment_id,
            jsonb_build_object('ticket_id', p_ticket_id, 'amount_cents', v_total));

  -- TODO(phase-9): increment open cash_drawer_sessions.expected_cents by v_total.

  return v_payment_id;
end;
$$;

revoke all on function public.pos_take_cash(uuid, uuid) from public;
grant execute on function public.pos_take_cash(uuid, uuid) to service_role;
