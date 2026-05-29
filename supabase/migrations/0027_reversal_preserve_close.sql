-- 0027_reversal_preserve_close.sql
-- ----------------------------------------------------------------------
-- Feature 052 follow-up: a reversal must NOT rewrite the original sale's
-- close attribution.
--
-- 0026's `pos_finalize_void` / `pos_finalize_refund` set
-- `closed_by_staff_id = <reversal operator>` and `closed_at = now()` when
-- flipping a paid ticket to void/refunded/partially_refunded. But the
-- ticket was already closed when it was PAID — overwriting those fields
-- loses the original cashier and sale time, so the Transactions ledger
-- would show "Sale completed by <whoever reversed it>" at the reversal
-- moment and a refunded past sale would jump to the refund date's period.
-- The reversal's actor + time are already recorded in `audit_log`
-- (payment.void_issued / payment.refund_issued), so the finalize RPCs
-- should leave `closed_at` / `closed_by_staff_id` intact and only flip
-- `status`. The closed-consistency CHECK still holds (a paid ticket
-- already has both fields non-null).
--
-- CREATE OR REPLACE only — same signatures, bodies identical to 0026 save
-- for the ticket UPDATE. Authored as a forward migration (not an edit to
-- 0026) because 0026 is already applied on the hosted preview DB.
-- ----------------------------------------------------------------------

create or replace function public.pos_finalize_void(
  p_ticket_id      uuid,
  p_refund_results jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator       uuid;
  v_reversed_total int;
  v_refunds        jsonb;
begin
  -- 1) Lock the ticket.
  perform 1 from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_void_eligible' using errcode = 'P0001';
  end if;

  -- 2) Flip each card/gift refund leg -> succeeded + square_refund_id.
  --    (Cash legs were inserted succeeded with NULL square_refund_id.)
  update public.payments p
    set status           = 'succeeded',
        square_refund_id = (res->>'square_refund_id'),
        processed_at     = now()
    from jsonb_array_elements(p_refund_results) as res
    where p.id = (res->>'refund_payment_id')::uuid
      and p.kind = 'refund';

  -- 3) Operator + reversed total, for the audit row. All refund legs for
  --    this void share one operator (the staff who initiated the reversal).
  select coalesce(sum(amount_cents), 0)
    into v_reversed_total
    from public.payments
    where refunds_payment_id is not null
      and kind = 'refund'
      and ticket_id = p_ticket_id;

  select taken_by_staff_id
    into v_operator
    from public.payments
    where refunds_payment_id is not null
      and kind = 'refund'
      and ticket_id = p_ticket_id
    limit 1;

  -- 4) Set the ticket to void. Leave closed_at / closed_by_staff_id intact
  --    (the original sale's close attribution) — the void's actor + time
  --    live in the audit row below.
  update public.tickets
    set status     = 'void',
        updated_at = now()
    where id = p_ticket_id;

  -- 5) Audit. payload per contracts/audit.contract.md — entity_id is the
  --    voided ticket; refunds[] mirrors each original->refund leg.
  select jsonb_agg(
           jsonb_build_object(
             'payment_id',        r.refunds_payment_id,
             'refund_payment_id', r.id,
             'method',            r.method,
             'amount_cents',      r.amount_cents
           )
         )
    into v_refunds
    from public.payments r
    where r.ticket_id = p_ticket_id and r.kind = 'refund';

  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      v_operator,
      'payment.void_issued',
      'payment',
      p_ticket_id,
      jsonb_build_object(
        'ticket_id',            p_ticket_id,
        'reversed_total_cents', v_reversed_total,
        'refunds',              coalesce(v_refunds, '[]'::jsonb)
      )
    );
end;
$$;

revoke all on function public.pos_finalize_void(uuid, jsonb) from public;
grant execute on function public.pos_finalize_void(uuid, jsonb) to service_role;

create or replace function public.pos_finalize_refund(
  p_ticket_id      uuid,
  p_refund_results jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator         uuid;
  v_orig_sum         int;
  v_refund_sum       int;
  v_refunded_cents   int;
  v_new_status       public.ticket_status;
  v_lines            jsonb;
begin
  -- 1) Lock the ticket.
  perform 1 from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'payment_not_on_ticket' using errcode = 'P0001';
  end if;

  -- 2) Flip card/gift refund legs -> succeeded + square_refund_id.
  update public.payments p
    set status           = 'succeeded',
        square_refund_id = (res->>'square_refund_id'),
        processed_at     = now()
    from jsonb_array_elements(p_refund_results) as res
    where p.id = (res->>'refund_payment_id')::uuid
      and p.kind = 'refund';

  -- 3) Recompute ticket status from succeeded sums.
  select coalesce(sum(amount_cents), 0)
    into v_orig_sum
    from public.payments
    where ticket_id = p_ticket_id and kind = 'payment' and status = 'succeeded';

  select coalesce(sum(amount_cents), 0)
    into v_refund_sum
    from public.payments
    where ticket_id = p_ticket_id and kind = 'refund' and status = 'succeeded';

  if v_refund_sum >= v_orig_sum then
    v_new_status := 'refunded';
  else
    v_new_status := 'partially_refunded';
  end if;

  -- 4) Operator from this finalize's refund legs (the rows just settled).
  select taken_by_staff_id
    into v_operator
    from public.payments
    where id = ((p_refund_results->0)->>'refund_payment_id')::uuid;

  -- 5) Flip status only. Leave closed_at / closed_by_staff_id intact: the
  --    ticket was already closed when it was paid, so the original sale's
  --    cashier + time must be preserved (a refunded past sale stays in its
  --    original period; the drawer keeps showing the original cashier). The
  --    refund's actor + time live in the audit row below.
  update public.tickets
    set status     = v_new_status,
        updated_at = now()
    where id = p_ticket_id;

  -- 6) Audit (payment.refund_issued). refunded_cents is the amount settled
  --    in THIS call; lines[] mirror each original->refund leg from the
  --    finalize payload.
  select coalesce(sum((res->>'amount_cents')::int), 0)
    into v_refunded_cents
    from jsonb_array_elements(p_refund_results) as res;

  select jsonb_agg(
           jsonb_build_object(
             'original_payment_id', res->>'original_payment_id',
             'refund_payment_id',   res->>'refund_payment_id',
             'method',              res->>'method',
             'amount_cents',        (res->>'amount_cents')::int
           )
         )
    into v_lines
    from jsonb_array_elements(p_refund_results) as res;

  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      v_operator,
      'payment.refund_issued',
      'payment',
      p_ticket_id,
      jsonb_build_object(
        'ticket_id',        p_ticket_id,
        'resulting_status', v_new_status,
        'refunded_cents',   v_refunded_cents,
        'lines',            coalesce(v_lines, '[]'::jsonb)
      )
    );
end;
$$;

revoke all on function public.pos_finalize_refund(uuid, jsonb) from public;
grant execute on function public.pos_finalize_refund(uuid, jsonb) to service_role;
