-- 0011_gift_card_split_tender.sql
-- Feature 018 — Gift Card Redemption & Split-Tender Checkout (part 2 of 2)
-- (specs/018-gift-card-split-tender/)
--
-- Continues from 0010, which added the 'gift' value to payment_method and
-- the 'draft' value to payment_status (split out per PG's SQLSTATE 55P04
-- restriction on same-transaction use of newly-added enum values).
--
-- This migration ships:
--   - public.gift_cards table (cached lookup + RLS)
--   - payments.gift_card_id + square_gift_card_payment_id columns
--   - relaxed cash-status check (drafts allowed)
--   - one-in-flight-per-ticket unique partial index
--   - gift-card-webhook unique partial index (idempotency backstop)
--   - 4 new RPCs:
--       pos_compose_payment_draft, pos_remove_payment_draft,
--       pos_activate_cash_draft, pos_record_gift_payment
--
-- RLS: gift_cards gets ONE policy — select to authenticated using (true).
-- All writes via service-role.
--
-- audit_log impact: four new AuditAction verbs (see contracts/audit.contract.md):
--   payment.draft_created, payment.draft_removed,
--   gift_card.balance_looked_up, gift_card.redeemed.

-- ----------------------------------------------------------------------
-- 1. Constraint relaxation — cash payments may now sit in 'draft' before
--    the operator activates them via pos_activate_cash_draft.
-- ----------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_cash_status_succeeded_chk;
alter table public.payments add constraint payments_cash_status_succeeded_chk
  check (method != 'cash' or status in ('draft','succeeded'));

-- ----------------------------------------------------------------------
-- 2. payments column additions for gift-card legs.
-- ----------------------------------------------------------------------
alter table public.payments
  add column if not exists gift_card_id                 uuid,
  add column if not exists square_gift_card_payment_id  text;

-- ----------------------------------------------------------------------
-- 3. gift_cards table + RLS + updated_at trigger.
-- ----------------------------------------------------------------------
create table if not exists public.gift_cards (
  id                       uuid primary key default gen_random_uuid(),
  square_gift_card_id      text not null unique,
  last4_mask               text not null check (last4_mask ~ '^[0-9]{4}$'),
  balance_cents_cached     int  not null check (balance_cents_cached >= 0),
  state                    text not null check (state in ('ACTIVE','PENDING','BLOCKED','DEACTIVATED')),
  last_synced_at           timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.gift_cards enable row level security;

drop policy if exists gift_cards_select_authenticated on public.gift_cards;
create policy gift_cards_select_authenticated
  on public.gift_cards for select to authenticated using (true);

-- updated_at trigger — mirrors the tickets_set_updated_at pattern from 0004.
create or replace function public.gift_cards_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gift_cards_set_updated_at_trg on public.gift_cards;
create trigger gift_cards_set_updated_at_trg
  before update on public.gift_cards
  for each row execute function public.gift_cards_set_updated_at();

-- Late-bind the FK on payments.gift_card_id now that gift_cards exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_gift_card_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_gift_card_id_fkey
      foreign key (gift_card_id) references public.gift_cards(id);
  end if;
end$$;

-- ----------------------------------------------------------------------
-- 4. Partial indexes.
-- ----------------------------------------------------------------------
-- 4.a One-in-flight-per-ticket: at most one 'pending' payment per ticket,
--     across any method. The application catches the 23505 and surfaces
--     TicketAlreadyBeingChargedError.
create unique index if not exists payments_one_in_flight_per_ticket_idx
  on public.payments (ticket_id)
  where status = 'pending';

-- 4.b Gift-card webhook idempotency backstop: at most one succeeded row
--     per Square Payment id, even under racing webhook + polling deliveries.
create unique index if not exists payments_unique_succeeded_gift_card_payment_idx
  on public.payments (square_gift_card_payment_id)
  where status = 'succeeded' and square_gift_card_payment_id is not null;

-- ----------------------------------------------------------------------
-- 5.a pos_compose_payment_draft — insert a draft leg.
-- ----------------------------------------------------------------------
create or replace function public.pos_compose_payment_draft(
  p_ticket_id uuid,
  p_operator  uuid,
  p_method    public.payment_method,
  p_amount    int
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_total      int;
  v_unconfirmed_count int;
  v_committed_sum     int;
  v_remaining_owed    int;
  v_payment_id        uuid;
begin
  -- 1) Lock ticket; refuse if not open.
  select total_cents into v_ticket_total
    from public.tickets where id = p_ticket_id and status = 'open'
    for update;
  if not found then
    raise exception 'ticket_not_open' using errcode = 'P0001';
  end if;

  -- 2) Refuse if any line is unconfirmed (FR-015 inheritance).
  select count(*) into v_unconfirmed_count
    from public.ticket_items
    where ticket_id = p_ticket_id and price_unconfirmed = true;
  if v_unconfirmed_count > 0 then
    raise exception 'ticket_has_unpriced_items' using errcode = 'P0001';
  end if;

  -- 3) Compute remaining-owed against draft + pending + succeeded legs.
  select coalesce(sum(amount_cents), 0) into v_committed_sum
    from public.payments
    where ticket_id = p_ticket_id and status in ('draft','pending','succeeded');

  v_remaining_owed := v_ticket_total - v_committed_sum;

  if p_amount <= 0 or p_amount > v_remaining_owed then
    raise exception 'legs_must_fit_remaining' using errcode = 'P0001';
  end if;

  -- 4) Insert the draft leg.
  insert into public.payments (
    ticket_id, method, kind, amount_cents, tip_cents, status, taken_by_staff_id
  ) values (
    p_ticket_id, p_method, 'payment', p_amount, 0, 'draft', p_operator
  )
  returning id into v_payment_id;

  -- 5) Audit.
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_operator,
      'payment.draft_created',
      'payment',
      v_payment_id,
      jsonb_build_object(
        'ticket_id', p_ticket_id,
        'method', p_method::text,
        'amount_cents', p_amount,
        'remaining_owed_cents', v_remaining_owed
      )
    );

  return v_payment_id;
end;
$$;

revoke all on function public.pos_compose_payment_draft(uuid, uuid, public.payment_method, int) from public;
grant execute on function public.pos_compose_payment_draft(uuid, uuid, public.payment_method, int) to service_role;

-- ----------------------------------------------------------------------
-- 5.b pos_remove_payment_draft — operator removes a draft leg.
-- ----------------------------------------------------------------------
create or replace function public.pos_remove_payment_draft(
  p_payment_id uuid,
  p_operator   uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id uuid;
  v_method    public.payment_method;
  v_amount    int;
  v_status    public.payment_status;
begin
  -- 1) Lock the row; refuse if missing or not draft.
  select ticket_id, method, amount_cents, status
    into v_ticket_id, v_method, v_amount, v_status
    from public.payments where id = p_payment_id
    for update;

  if not found then
    raise exception 'draft_leg_not_found' using errcode = 'P0001';
  end if;

  if v_status != 'draft' then
    raise exception 'draft_leg_not_found' using errcode = 'P0001';
  end if;

  delete from public.payments where id = p_payment_id;

  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_operator,
      'payment.draft_removed',
      'payment',
      p_payment_id,
      jsonb_build_object(
        'ticket_id', v_ticket_id,
        'method', v_method::text,
        'amount_cents', v_amount,
        'reason', 'operator_removed'
      )
    );
end;
$$;

revoke all on function public.pos_remove_payment_draft(uuid, uuid) from public;
grant execute on function public.pos_remove_payment_draft(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 5.c pos_activate_cash_draft — flip a draft cash leg to succeeded.
-- ----------------------------------------------------------------------
create or replace function public.pos_activate_cash_draft(
  p_payment_id uuid,
  p_operator   uuid
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id      uuid;
  v_amount         int;
  v_status         public.payment_status;
  v_method         public.payment_method;
  v_ticket_total   int;
  v_legs_sum       int;
  v_succeeded_sum  int;
  v_ticket_flipped boolean := false;
begin
  -- 1) Lock the payment; refuse if not (draft, cash).
  select payments.ticket_id, amount_cents, status, method
    into v_ticket_id, v_amount, v_status, v_method
    from public.payments where id = p_payment_id
    for update;
  if not found then
    raise exception 'draft_leg_not_found' using errcode = 'P0001';
  end if;
  if v_status != 'draft' or v_method != 'cash' then
    raise exception 'draft_leg_not_found' using errcode = 'P0001';
  end if;

  -- 2) Lock the ticket; refuse if not open.
  select total_cents into v_ticket_total
    from public.tickets where id = v_ticket_id and status = 'open'
    for update;
  if not found then
    raise exception 'ticket_not_open' using errcode = 'P0001';
  end if;

  -- 3) Legs-sum-equals-total guard (sum non-failed legs == ticket total).
  select coalesce(sum(amount_cents), 0) into v_legs_sum
    from public.payments
    where payments.ticket_id = v_ticket_id and status != 'failed';
  if v_legs_sum != v_ticket_total then
    raise exception 'legs_must_sum_to_total' using errcode = 'P0001';
  end if;

  -- 4) Update payment status -> succeeded.
  update public.payments
    set status       = 'succeeded',
        processed_at = now()
    where id = p_payment_id;

  -- 5) Recompute succeeded sum; if it covers the ticket, flip it to paid.
  select coalesce(sum(amount_cents), 0) into v_succeeded_sum
    from public.payments
    where payments.ticket_id = v_ticket_id and status = 'succeeded';

  if v_succeeded_sum >= v_ticket_total then
    update public.tickets
      set status             = 'paid',
          closed_by_staff_id = p_operator,
          closed_at          = now(),
          updated_at         = now()
      where id = v_ticket_id and status = 'open';
    v_ticket_flipped := true;
  end if;

  -- 6) Audit.
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      p_operator,
      'payment.captured',
      'payment',
      p_payment_id,
      jsonb_build_object(
        'ticket_id', v_ticket_id,
        'method', 'cash',
        'amount_cents', v_amount,
        'tip_cents', 0
      )
    );

  return query select v_ticket_id, v_ticket_flipped;
end;
$$;

revoke all on function public.pos_activate_cash_draft(uuid, uuid) from public;
grant execute on function public.pos_activate_cash_draft(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------
-- 5.d pos_record_gift_payment — settle a gift-card leg from webhook/poll.
-- ----------------------------------------------------------------------
create or replace function public.pos_record_gift_payment(
  p_payment_id           uuid,
  p_new_status           public.payment_status,
  p_square_gift_card_id  text,
  p_square_payment_id    text,
  p_raw                  jsonb,
  p_failure_reason       text
) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id        uuid;
  v_amount           int;
  v_existing_status  public.payment_status;
  v_gift_card_id     uuid;
  v_last4_mask       text;
  v_ticket_total     int;
  v_legs_sum         int;
  v_succeeded_sum    int;
  v_ticket_flipped   boolean := false;
  v_operator         uuid;
begin
  -- 1) Lock payment; refuse if not found.
  select status, payments.ticket_id, amount_cents, taken_by_staff_id
    into v_existing_status, v_ticket_id, v_amount, v_operator
    from public.payments where id = p_payment_id
    for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  -- 2) Idempotency: any replayed event on a non-pending row is a noop.
  --    Gift payments settle synchronously at Square; there is no
  --    'expired' escape hatch (unlike pos_record_card_payment).
  if v_existing_status != 'pending' then
    return query select v_ticket_id, false;
    return;
  end if;

  -- 3) Resolve gift_card_id + last4_mask from the cached row.
  select id, last4_mask
    into v_gift_card_id, v_last4_mask
    from public.gift_cards where square_gift_card_id = p_square_gift_card_id;

  -- 4) Update the payment row.
  update public.payments
    set status                      = p_new_status,
        square_gift_card_payment_id = coalesce(p_square_payment_id, square_gift_card_payment_id),
        gift_card_id                = coalesce(v_gift_card_id, gift_card_id),
        raw                         = p_raw,
        failure_reason              = case when p_new_status = 'failed' then p_failure_reason else null end,
        processed_at                = now()
    where id = p_payment_id;

  -- 5) On success: legs-sum guard + ticket-paid flip.
  if p_new_status = 'succeeded' then
    select total_cents into v_ticket_total
      from public.tickets where id = v_ticket_id
      for update;

    select coalesce(sum(amount_cents), 0) into v_legs_sum
      from public.payments
      where payments.ticket_id = v_ticket_id and status != 'failed';
    if v_legs_sum != v_ticket_total then
      raise exception 'legs_must_sum_to_total' using errcode = 'P0001';
    end if;

    select coalesce(sum(amount_cents), 0) into v_succeeded_sum
      from public.payments
      where payments.ticket_id = v_ticket_id and status = 'succeeded';

    if v_succeeded_sum >= v_ticket_total then
      update public.tickets
        set status             = 'paid',
            closed_by_staff_id = v_operator,
            closed_at          = now(),
            updated_at         = now()
        where id = v_ticket_id and status = 'open';
      v_ticket_flipped := true;
    end if;
  end if;

  -- 6) Audit. On success → gift_card.redeemed (entity_type=gift_card).
  --    On failure → payment.failed (entity_type=payment).
  if p_new_status = 'succeeded' then
    insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
      values (
        v_operator,
        'gift_card.redeemed',
        'gift_card',
        v_gift_card_id,
        jsonb_build_object(
          'ticket_id', v_ticket_id,
          'payment_id', p_payment_id,
          'square_gift_card_id', p_square_gift_card_id,
          'square_payment_id', p_square_payment_id,
          'last4_mask', v_last4_mask,
          'amount_cents', v_amount,
          'ticket_flipped_to_paid', v_ticket_flipped
        )
      );
  else
    insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
      values (
        v_operator,
        'payment.failed',
        'payment',
        p_payment_id,
        jsonb_build_object(
          'ticket_id', v_ticket_id,
          'method', 'gift',
          'amount_cents', v_amount,
          'tip_cents', 0,
          'square_gift_card_id', p_square_gift_card_id,
          'square_payment_id', p_square_payment_id,
          'last4_mask', v_last4_mask,
          'failure_reason', p_failure_reason
        )
      );
  end if;

  return query select v_ticket_id, v_ticket_flipped;
end;
$$;

revoke all on function public.pos_record_gift_payment(uuid, public.payment_status, text, text, jsonb, text) from public;
grant execute on function public.pos_record_gift_payment(uuid, public.payment_status, text, text, jsonb, text) to service_role;
