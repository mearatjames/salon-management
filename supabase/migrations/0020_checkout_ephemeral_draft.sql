-- Migration: 0020_checkout_ephemeral_draft.sql
-- Feature: 043-checkout-ephemeral-draft
--
-- Makes the in-progress checkout cart an ephemeral in-memory draft.
-- Before this feature, opening /checkout wrote an empty `tickets` row and
-- every cart edit wrote a `ticket_items` row. Now nothing is written
-- until the first payment-initiating action: the whole cart is persisted
-- once, atomically, by the new `pos_create_ticket_from_draft` RPC.
--
-- The RPC receives a JSON array of FULLY-RESOLVED, already-validated line
-- objects (the server helper `validateAndResolveDraft` resolves them
-- against the catalog/staff before the call). The RPC does NOT
-- re-validate against the catalog — its job is the all-or-nothing
-- persistence: one `tickets` row + N `ticket_items` rows + one
-- `ticket.created` audit row, all inside a single transaction.
--
-- Convention matches `pos_take_cash` (0004 / 0007): `security definer`,
-- `set search_path = public, pg_temp`, `revoke all from public`,
-- `grant execute to service_role`. Audit insert uses the same
-- `audit_log` column set (`acting_as_staff_id`, `action`, `entity_type`,
-- `entity_id`, `payload`).
--
-- Also drops the now-dead `tickets_open_by_operator_recent_idx` — that
-- partial index existed solely for the resume-or-create hot path
-- (opening /checkout reused an operator's most recent open ticket).
-- With ephemeral drafts there is no resume path, so the index has no
-- reader. `tickets_status_created_at_idx` and `ticket_items_by_ticket_idx`
-- stay — they back the "list paid tickets" and "load a ticket's cart"
-- queries that remain in use.

-- ----------------------------------------------------------------------
-- 1. Drop the dead resume-hot-path index.
-- ----------------------------------------------------------------------
drop index if exists tickets_open_by_operator_recent_idx;

-- ----------------------------------------------------------------------
-- 2. pos_create_ticket_from_draft — the atomic draft-to-ticket writer.
-- ----------------------------------------------------------------------
-- `p_items` is a JSON array of line objects. Two shapes:
--   service:  { "kind":"service", "ref_id":<uuid>, "name_snapshot":<text>,
--               "unit_price_cents":<int>, "assigned_staff_id":<uuid>,
--               "price_unconfirmed":<bool> }
--   discount: { "kind":"discount", "name_snapshot":<text>,
--               "unit_price_cents":<int (final, <= 0)>,
--               "discount_pct":<numeric|null>, "note":<text|null> }
-- `qty` is not supplied — every line is qty 1.
--
-- Steps (single transaction):
--   1) insert one `tickets` row (status='open', totals 0 — set in step 4)
--   2) insert one `ticket_items` row per element of `p_items`
--   3) compute v_subtotal (service lines) + v_total
--   4) update the ticket with the computed totals
--   5) insert one `ticket.created` audit row
--   6) return (ticket_id, subtotal_cents, total_cents)
--
-- Any FK / CHECK violation rolls back the whole transaction — no orphan
-- ticket, no orphan items.
create or replace function public.pos_create_ticket_from_draft(
  p_operator uuid,
  p_items    jsonb
) returns table(ticket_id uuid, subtotal_cents int, total_cents int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id uuid;
  v_subtotal  int;
  v_total     int;
  v_line_count int;
  v_item      jsonb;
begin
  -- 1) Insert the ticket shell. Totals start at 0 and are written in
  --    step 4 once every line has landed.
  insert into public.tickets (status, opened_by_staff_id, subtotal_cents, tax_cents, total_cents)
    values ('open', p_operator, 0, 0, 0)
    returning id into v_ticket_id;

  -- 2) Insert one ticket_items row per element of p_items. The kind maps
  --    to the service/discount column shape enforced by
  --    `ticket_items_kind_columns_chk` — service rows carry ref_id +
  --    assigned_staff_id (discount_pct null); discount rows carry
  --    ref_id null + assigned_staff_id null.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'kind') = 'service' then
      insert into public.ticket_items (
        ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty,
        assigned_staff_id, price_unconfirmed
      ) values (
        v_ticket_id,
        'service',
        (v_item ->> 'ref_id')::uuid,
        v_item ->> 'name_snapshot',
        (v_item ->> 'unit_price_cents')::int,
        1,
        (v_item ->> 'assigned_staff_id')::uuid,
        coalesce((v_item ->> 'price_unconfirmed')::boolean, false)
      );
    elsif (v_item ->> 'kind') = 'discount' then
      insert into public.ticket_items (
        ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty,
        assigned_staff_id, price_unconfirmed, discount_pct, note
      ) values (
        v_ticket_id,
        'discount',
        null,
        v_item ->> 'name_snapshot',
        (v_item ->> 'unit_price_cents')::int,
        1,
        null,
        false,
        nullif(v_item ->> 'discount_pct', '')::numeric,
        nullif(v_item ->> 'note', '')
      );
    else
      raise exception 'unknown_line_kind: %', v_item ->> 'kind'
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3) Compute the totals from the persisted rows. Subtotal is the sum of
  --    service-line amounts; total folds the (already-negative) discount
  --    amounts in, floored at 0. The `ti.` qualifier disambiguates the
  --    table's `ticket_id` column from this function's OUT column of the
  --    same name (RETURNS TABLE columns are in scope inside the body).
  select coalesce(sum(ti.unit_price_cents) filter (where ti.kind = 'service'), 0)
    into v_subtotal
    from public.ticket_items ti
    where ti.ticket_id = v_ticket_id;

  select greatest(
           0,
           v_subtotal
             + coalesce(sum(ti.unit_price_cents) filter (where ti.kind = 'discount'), 0)
         ),
         count(*)
    into v_total, v_line_count
    from public.ticket_items ti
    where ti.ticket_id = v_ticket_id;

  -- 4) Write the computed totals. `tax_cents` stays 0, so
  --    `total_cents = subtotal_cents` satisfies
  --    `tickets_total_matches_subtotal_chk` (subtotal mirrors total here).
  update public.tickets
    set subtotal_cents = v_total,
        total_cents    = v_total,
        updated_at     = now()
    where id = v_ticket_id;

  -- 5) Audit ('ticket.created' — controlled vocab in lib/auth/audit.ts).
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (p_operator, 'ticket.created', 'ticket', v_ticket_id,
            jsonb_build_object('line_count', v_line_count, 'subtotal_cents', v_subtotal));

  -- 6) Return the new ticket id + totals for the caller.
  return query select v_ticket_id, v_subtotal, v_total;
end;
$$;

revoke all on function public.pos_create_ticket_from_draft(uuid, jsonb) from public;
grant execute on function public.pos_create_ticket_from_draft(uuid, jsonb) to service_role;
