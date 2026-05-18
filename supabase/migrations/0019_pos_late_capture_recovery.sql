-- 0019_pos_late_capture_recovery.sql
-- Issue #27 — pos_record_card_payment: auto-recover late captures after discard.
--
-- Re-defines pos_record_card_payment so that when Square confirms a
-- card capture (terminal.checkout.updated → COMPLETED) for a ticket the
-- operator has already discarded, the ticket auto-flips back to `paid`
-- (preserving the original discarded actor in the audit payload) and the
-- function emits a `payment.captured_after_discard` audit event. If the
-- ticket is in a third state (neither `open` nor `discarded`), the
-- function falls back to emitting `payment.capture_orphaned` and leaves
-- the ticket untouched. The payment row always ends up `succeeded`
-- because Square already has the money — the row reflects reality.
--
-- Return shape changes: a third boolean column
-- `ticket_recovered_from_discard` is appended so the webhook handler can
-- detect the recovery case and emit a WARN log for observability.
-- Postgres requires DROP FUNCTION before CREATE when the return signature
-- changes — `CREATE OR REPLACE` alone is not enough.
--
-- Rollback: see the commented ROLLBACK block at the bottom. Copy/paste
-- into psql to restore the pre-#27 two-column definition.

drop function if exists public.pos_record_card_payment(
  uuid, public.payment_status, int, text, jsonb, text
);

create or replace function public.pos_record_card_payment(
  p_payment_id          uuid,
  p_new_status          public.payment_status,
  p_tip_cents           int,
  p_square_payment_id   text,
  p_raw                 jsonb,
  p_failure_reason      text
) returns table (
  ticket_id                       uuid,
  ticket_flipped_to_paid          boolean,
  ticket_recovered_from_discard   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id                       uuid;
  v_amount                          int;
  v_ticket_total                    int;
  v_succeeded_sum                   int;
  v_ticket_flipped                  boolean := false;
  v_ticket_recovered                boolean := false;
  v_existing_status                 public.payment_status;
  v_open_rows                       int;
  v_recovery_rows                   int;
  v_payment_staff_id                uuid;
  v_existing_closed_by              uuid;
  v_existing_closed_at              timestamptz;
  v_ticket_status_observed          public.ticket_status;
  v_square_terminal_checkout_id     text;
begin
  -- 1) Lock the payment row; refuse mutation if not 'pending'.
  --    This is the application-level idempotency guard — duplicate webhooks
  --    find non-'pending' rows and short-circuit.
  select status, payments.ticket_id, amount_cents,
         payments.square_terminal_checkout_id, payments.taken_by_staff_id
    into v_existing_status, v_ticket_id, v_amount,
         v_square_terminal_checkout_id, v_payment_staff_id
    from public.payments
    where id = p_payment_id
    for update;

  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency: replayed webhook on a 'succeeded' or 'failed' row is a no-op.
  if v_existing_status != 'pending' then
    -- R5 escape hatch: a late 'succeeded' webhook can override an
    -- 'expired' failure (Square wins).
    if v_existing_status = 'failed'
       and p_new_status = 'succeeded'
       and (select failure_reason from public.payments where id = p_payment_id) = 'expired'
    then
      -- fall through to update; Square wins.
      null;
    else
      return query select v_ticket_id, false, false;
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
      -- 3a) Happy path: ticket still open → flip to paid.
      update public.tickets
        set status              = 'paid',
            closed_by_staff_id  = v_payment_staff_id,
            closed_at           = now(),
            updated_at          = now()
        where id = v_ticket_id and status = 'open';
      get diagnostics v_open_rows = ROW_COUNT;

      if v_open_rows = 1 then
        v_ticket_flipped := true;
      else
        -- 3b) Late-capture-after-discard: try the recovery flip. Preserve
        --     the original discarded actor + timestamp in the audit
        --     payload so the forensic record of who discarded survives.
        select status, closed_by_staff_id, closed_at
          into v_ticket_status_observed, v_existing_closed_by, v_existing_closed_at
          from public.tickets
          where id = v_ticket_id;

        update public.tickets
          set status              = 'paid',
              closed_by_staff_id  = coalesce(v_existing_closed_by, v_payment_staff_id),
              closed_at           = now(),
              updated_at          = now()
          where id = v_ticket_id and status = 'discarded';
        get diagnostics v_recovery_rows = ROW_COUNT;

        if v_recovery_rows = 1 then
          v_ticket_recovered := true;
          insert into public.audit_log
            (acting_as_staff_id, action, entity_type, entity_id, payload)
          values (
            coalesce(v_existing_closed_by, v_payment_staff_id),
            'payment.captured_after_discard',
            'payment',
            p_payment_id,
            jsonb_build_object(
              'ticket_id', v_ticket_id,
              'payment_id', p_payment_id,
              'amount_cents', v_amount,
              'square_terminal_checkout_id', v_square_terminal_checkout_id,
              'original_discarded_at', v_existing_closed_at,
              'original_discarded_by_staff_id', v_existing_closed_by,
              'recovered_at', now()
            )
          );
          return query select v_ticket_id, false, true;
          return;
        else
          -- 3c) Third state (neither open nor discarded — would only
          --     happen if a future feature introduces a new ticket
          --     status). Payment row stays succeeded; emit
          --     capture_orphaned audit; do NOT touch the ticket.
          insert into public.audit_log
            (acting_as_staff_id, action, entity_type, entity_id, payload)
          values (
            v_payment_staff_id,
            'payment.capture_orphaned',
            'payment',
            p_payment_id,
            jsonb_build_object(
              'ticket_id', v_ticket_id,
              'ticket_status', v_ticket_status_observed,
              'payment_id', p_payment_id,
              'amount_cents', v_amount,
              'square_terminal_checkout_id', v_square_terminal_checkout_id
            )
          );
          return query select v_ticket_id, false, false;
          return;
        end if;
      end if;
    end if;
  end if;

  -- 4) Audit. payment.captured for success (happy / partial-sum),
  --    payment.failed for failure. The recovery and orphan branches
  --    above return early so this insert does not double-fire.
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (
      v_payment_staff_id,
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

  return query select v_ticket_id, v_ticket_flipped, v_ticket_recovered;
end;
$$;

revoke all on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) from public;
grant execute on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------
-- ROLLBACK (manual): apply this block to restore the pre-#27 definition
-- and the original two-column return shape. Left as comments to follow
-- the migration-forward convention this repo uses; copy/paste into psql
-- when a rollback is needed.
-- ----------------------------------------------------------------------
-- drop function if exists public.pos_record_card_payment(
--   uuid, public.payment_status, int, text, jsonb, text
-- );
--
-- create or replace function public.pos_record_card_payment(
--   p_payment_id          uuid,
--   p_new_status          public.payment_status,
--   p_tip_cents           int,
--   p_square_payment_id   text,
--   p_raw                 jsonb,
--   p_failure_reason      text
-- ) returns table (ticket_id uuid, ticket_flipped_to_paid boolean)
-- language plpgsql
-- security definer
-- set search_path = public, pg_temp
-- as $$
-- declare
--   v_ticket_id              uuid;
--   v_amount                 int;
--   v_ticket_total           int;
--   v_succeeded_sum          int;
--   v_ticket_flipped         boolean := false;
--   v_existing_status        public.payment_status;
-- begin
--   select status, payments.ticket_id, amount_cents
--     into v_existing_status, v_ticket_id, v_amount
--     from public.payments
--     where id = p_payment_id
--     for update;
--
--   if not found then
--     raise exception 'payment_not_found' using errcode = 'P0001';
--   end if;
--
--   if v_existing_status != 'pending' then
--     if v_existing_status = 'failed'
--        and p_new_status = 'succeeded'
--        and (select failure_reason from public.payments where id = p_payment_id) = 'expired'
--     then
--       null;
--     else
--       return query select v_ticket_id, false;
--       return;
--     end if;
--   end if;
--
--   update public.payments
--     set status              = p_new_status,
--         tip_cents           = p_tip_cents,
--         square_payment_id   = coalesce(p_square_payment_id, square_payment_id),
--         raw                 = p_raw,
--         failure_reason      = case when p_new_status = 'failed' then p_failure_reason else null end,
--         processed_at        = now()
--     where id = p_payment_id;
--
--   if p_new_status = 'succeeded' then
--     select total_cents into v_ticket_total from public.tickets
--       where id = v_ticket_id for update;
--     select coalesce(sum(amount_cents), 0) into v_succeeded_sum
--       from public.payments
--       where payments.ticket_id = v_ticket_id and status = 'succeeded';
--     if v_succeeded_sum >= v_ticket_total then
--       update public.tickets
--         set status              = 'paid',
--             closed_by_staff_id  = (select taken_by_staff_id from public.payments where id = p_payment_id),
--             closed_at           = now(),
--             updated_at          = now()
--         where id = v_ticket_id and status = 'open';
--       v_ticket_flipped := true;
--     end if;
--   end if;
--
--   insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
--     values (
--       (select taken_by_staff_id from public.payments where id = p_payment_id),
--       case when p_new_status = 'succeeded' then 'payment.captured' else 'payment.failed' end,
--       'payment',
--       p_payment_id,
--       jsonb_build_object(
--         'ticket_id', v_ticket_id,
--         'method', 'card',
--         'amount_cents', v_amount,
--         'tip_cents', p_tip_cents,
--         'failure_reason', p_failure_reason,
--         'square_payment_id', p_square_payment_id
--       )
--     );
--
--   return query select v_ticket_id, v_ticket_flipped;
-- end;
-- $$;
--
-- revoke all on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) from public;
-- grant execute on function public.pos_record_card_payment(uuid, public.payment_status, int, text, jsonb, text) to service_role;
