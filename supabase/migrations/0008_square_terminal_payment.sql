-- 0008_square_terminal_payment.sql
-- Feature 015 — Square Terminal Card Payment (specs/015-square-terminal-payment/)
-- Adds two tables (square_oauth, square_devices), extends payments with four
-- nullable columns + the 'card' payment_method enum value, relaxes the
-- tip_cents = 0 check to tip_cents >= 0, ships the atomic pos_record_card_payment
-- RPC for card settlement, and a thin pgcrypto wrapper for decrypting Square
-- OAuth tokens stored at rest.
-- RLS: square_oauth + square_devices each get a single
-- `select to authenticated using (true)` policy; all writes via service-role.
-- audit_log impact: seven new AuditAction verbs (see contracts/audit.contract.md).

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------
-- 1. square_oauth (singleton)
-- ----------------------------------------------------------------------
create table if not exists public.square_oauth (
  id                              boolean primary key default true,
  merchant_id                     text not null,
  merchant_name                   text not null,
  access_token_encrypted          bytea not null,
  refresh_token_encrypted         bytea not null,
  access_token_expires_at         timestamptz not null,
  scope                           text not null,
  connected_at                    timestamptz not null default now(),
  connected_by_staff_id           uuid not null references public.staff(id),
  refresh_failed_at               timestamptz,
  last_refreshed_at               timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint square_oauth_singleton_chk check (id is true)
);

alter table public.square_oauth enable row level security;
drop policy if exists square_oauth_select_authenticated on public.square_oauth;
create policy square_oauth_select_authenticated
  on public.square_oauth for select to authenticated using (true);

-- ----------------------------------------------------------------------
-- 2. square_devices (one row per paired Square Terminal)
-- ----------------------------------------------------------------------
create table if not exists public.square_devices (
  id                       uuid primary key default gen_random_uuid(),
  square_device_id         text not null unique,
  friendly_name            text not null,
  is_default               boolean not null default false,
  last_seen_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.square_devices enable row level security;
drop policy if exists square_devices_select_authenticated on public.square_devices;
create policy square_devices_select_authenticated
  on public.square_devices for select to authenticated using (true);

-- At most one row may be marked default.
create unique index if not exists square_devices_one_default_idx
  on public.square_devices ((true)) where is_default = true;

-- Fast lookup by Square's id (used by webhook routing).
create index if not exists square_devices_by_square_id_idx
  on public.square_devices (square_device_id);

-- ----------------------------------------------------------------------
-- 3. payments table extensions
-- ----------------------------------------------------------------------
-- 3a. Add 'card' payment method (enum extension; safe additive change).
alter type public.payment_method add value if not exists 'card';

-- 3b. New nullable columns (populated only for card payments).
alter table public.payments
  add column if not exists square_payment_id             text,
  add column if not exists square_terminal_checkout_id   text,
  add column if not exists raw                           jsonb,
  add column if not exists failure_reason                text;

-- 3c. Relax tip_cents constraint to allow card tips.
-- The original constraint in 0004_checkout_cash_sale.sql was inline
-- (`check (tip_cents = 0)`) so Postgres auto-named it
-- `payments_tip_cents_check`. Drop that name and add the relaxed one.
alter table public.payments drop constraint if exists payments_tip_cents_check;
alter table public.payments drop constraint if exists payments_tip_cents_zero_chk;
alter table public.payments add constraint payments_tip_cents_nonneg_chk
  check (tip_cents >= 0);

-- 3d. Webhook idempotency: at most one succeeded row per Square terminal
--     checkout, even under racing webhook deliveries. The application
--     `status='pending'` predicate is the first line of defense; this
--     index is the database-level backstop.
create unique index if not exists payments_unique_succeeded_terminal_checkout_idx
  on public.payments (square_terminal_checkout_id)
  where status = 'succeeded' and square_terminal_checkout_id is not null;

-- ----------------------------------------------------------------------
-- 4. pos_record_card_payment RPC (atomic card-payment settlement)
-- ----------------------------------------------------------------------
create or replace function public.pos_record_card_payment(
  p_payment_id          uuid,
  p_new_status          public.payment_status,
  p_tip_cents           int,
  p_square_payment_id   text,
  p_raw                 jsonb,
  p_failure_reason      text
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id              uuid;
  v_amount                 int;
  v_ticket_total           int;
  v_succeeded_sum          int;
  v_ticket_flipped         boolean := false;
  v_existing_status        public.payment_status;
begin
  -- 1) Lock the payment row; refuse mutation if not 'pending'.
  --    This is the application-level idempotency guard — duplicate webhooks
  --    find non-'pending' rows and short-circuit.
  select status, payments.ticket_id, amount_cents
    into v_existing_status, v_ticket_id, v_amount
    from public.payments
    where id = p_payment_id
    for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency: replayed webhook on a 'succeeded' or 'failed' row is a no-op.
  if v_existing_status != 'pending' then
    -- Special case (R5 escape hatch): a late 'succeeded' webhook can
    -- override an 'expired' failure (per the Square-wins clarification).
    if v_existing_status = 'failed'
       and p_new_status = 'succeeded'
       and (select failure_reason from public.payments where id = p_payment_id) = 'expired'
    then
      -- fall through to update; Square wins.
      null;
    else
      return query select v_ticket_id, false;
      return;
    end if;
  end if;

  -- 2) Update the payment row.
  update public.payments
    set status              = p_new_status,
        tip_cents           = p_tip_cents,
        square_payment_id   = coalesce(p_square_payment_id, square_payment_id),
        raw                 = p_raw,
        failure_reason      = case when p_new_status = 'failed' then p_failure_reason else null end,
        processed_at        = now()
    where id = p_payment_id;

  -- 3) If this was a success, check whether the ticket is fully covered.
  if p_new_status = 'succeeded' then
    select total_cents into v_ticket_total
      from public.tickets
      where id = v_ticket_id
      for update;

    select coalesce(sum(amount_cents), 0) into v_succeeded_sum
      from public.payments
      where payments.ticket_id = v_ticket_id and status = 'succeeded';

    if v_succeeded_sum >= v_ticket_total then
      update public.tickets
        set status              = 'paid',
            closed_by_staff_id  = (select taken_by_staff_id from public.payments where id = p_payment_id),
            closed_at           = now(),
            updated_at          = now()
        where id = v_ticket_id and status = 'open';
      v_ticket_flipped := true;
    end if;
  end if;

  -- 4) Audit. payment.captured for success, payment.failed for failure.
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      (select taken_by_staff_id from public.payments where id = p_payment_id),
      case when p_new_status = 'succeeded' then 'payment.captured' else 'payment.failed' end,
      'payment',
      p_payment_id,
      jsonb_build_object(
        'ticket_id', v_ticket_id,
        'method', 'card',
        'amount_cents', v_amount,
        'tip_cents', p_tip_cents,
        'failure_reason', p_failure_reason,
        'square_payment_id', p_square_payment_id
      )
    );

  return query select v_ticket_id, v_ticket_flipped;
end;
$$;

revoke all on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) from public;
grant execute on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------
-- 5. decrypt_square_token (pgcrypto wrapper)
-- ----------------------------------------------------------------------
-- Requires the `app.square_oauth_key` GUC to be set in the current
-- transaction (via lib/square/oauth.ts:setOauthKeyGuc).
create or replace function public.decrypt_square_token(ciphertext bytea)
returns text
language sql
stable
as $$
  select pgp_sym_decrypt(ciphertext, current_setting('app.square_oauth_key'))::text;
$$;

revoke all on function public.decrypt_square_token(bytea) from public;
grant execute on function public.decrypt_square_token(bytea) to service_role;
