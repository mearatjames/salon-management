-- Migration: 0023_per_service_discount_scope.sql
-- Feature: 049-per-service-discount
--
-- Adds per-service discount scoping. Today every discount line applies to
-- the entire service subtotal of its ticket. This feature lets the
-- operator scope a discount to a chosen subset of service lines.
--
-- Two pieces of schema change:
--   1. New nullable `discount_target_line_ids uuid[]` on
--      `public.ticket_items`. `null` = "applies to all services" (today's
--      default — backward-compatible). Non-null = scoped to those service
--      lines on the SAME ticket. Empty array forbidden by CHECK.
--   2. The `pos_create_ticket_from_draft` RPC body is replaced so its
--      payload accepts `client_line_id` on service-line objects + an
--      optional `target_client_line_ids` array on discount-line objects.
--      It now performs a two-pass insert: services first (capturing each
--      service's `client_line_id → ticket_items.id` mapping), then
--      discounts (resolving each `target_client_line_ids` array through
--      the map into the new `discount_target_line_ids` column).
--
-- Both pieces ship in one migration because the RPC's NEW behavior
-- depends on the column existing — splitting would leave a window where
-- the RPC body references a non-existent column.
--
-- The "every target must be a real same-ticket service line" invariant
-- is enforced in the **application** layer (recompute helper + draft
-- resolver). The DB CHECK only guards on kind + non-empty. A miss in the
-- RPC's map resolution raises an exception so a malformed payload rolls
-- back the whole transaction.

-- ----------------------------------------------------------------------
-- 1. New column + CHECKs on ticket_items.
-- ----------------------------------------------------------------------

alter table public.ticket_items
  add column discount_target_line_ids uuid[] null;

alter table public.ticket_items
  add constraint ticket_items_discount_targets_kind_chk check (
    discount_target_line_ids is null or kind = 'discount'
  );

alter table public.ticket_items
  add constraint ticket_items_discount_targets_non_empty_chk check (
    discount_target_line_ids is null or array_length(discount_target_line_ids, 1) >= 1
  );

-- ----------------------------------------------------------------------
-- 2. Replace pos_create_ticket_from_draft body — two-pass insert with
--    client_line_id → ticket_items.id resolution for scoped discounts.
-- ----------------------------------------------------------------------
-- Payload shapes (backward-compatible — both new fields are optional):
--   service:  { "kind":"service",
--               "client_line_id":<uuid|null>,           -- NEW (optional)
--               "ref_id":<uuid>, "name_snapshot":<text>,
--               "unit_price_cents":<int>,
--               "assigned_staff_id":<uuid>,
--               "price_unconfirmed":<bool> }
--   discount: { "kind":"discount", "name_snapshot":<text>,
--               "unit_price_cents":<int (final, <= 0)>,
--               "discount_pct":<numeric|null>, "note":<text|null>,
--               "target_client_line_ids":<uuid[]|null> } -- NEW (optional)
--
-- A discount with `target_client_line_ids: null` (or omitted) persists
-- with `discount_target_line_ids = null` — today's "applies to all
-- services" behavior. A non-null array resolves each entry through the
-- service map built in pass 1; a miss raises
-- `unknown_target_client_line_id`. The resolver should have already
-- failed earlier, but the RPC is defense-in-depth.
--
-- Service-line objects without `client_line_id` (legacy payloads) skip
-- the map entry — only the keyed services are reachable from a discount's
-- target list.
--
-- Steps (single transaction):
--   1) insert one `tickets` row (status='open', totals 0)
--   2) PASS 1: insert one `ticket_items` row per service line; record
--      (client_line_id → new id) pairs for those that supplied an id
--   3) PASS 2: insert one `ticket_items` row per discount line; resolve
--      `target_client_line_ids` through the map and write the result to
--      `discount_target_line_ids`
--   4) compute v_subtotal (service lines) + v_total
--   5) update the ticket with the computed totals
--   6) insert one `ticket.created` audit row
--   7) return (ticket_id, subtotal_cents, total_cents)

create or replace function public.pos_create_ticket_from_draft(
  p_operator uuid,
  p_items    jsonb
) returns table(ticket_id uuid, subtotal_cents int, total_cents int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket_id    uuid;
  v_subtotal     int;
  v_total        int;
  v_line_count   int;
  v_item         jsonb;
  v_client_id    uuid;
  v_new_line_id  uuid;
  v_targets_json jsonb;
  v_target_text  text;
  v_target_cli   uuid;
  v_target_db    uuid;
  v_resolved     uuid[];
  v_line_map     jsonb := '{}'::jsonb;  -- client_line_id (text) -> new ticket_items.id (text)
begin
  -- 1) Insert the ticket shell. Totals start at 0 and are written in
  --    step 5 once every line has landed.
  insert into public.tickets (status, opened_by_staff_id, subtotal_cents, tax_cents, total_cents)
    values ('open', p_operator, 0, 0, 0)
    returning id into v_ticket_id;

  -- 2) PASS 1 — insert every SERVICE line first, recording each
  --    `client_line_id → new ticket_items.id` pair so the discount pass
  --    can resolve scope targets.
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
      )
      returning id into v_new_line_id;

      -- Build the map only when the payload supplied a client_line_id
      -- (legacy payloads omit it — those services aren't reachable from
      -- a scope list, which is fine).
      v_client_id := nullif(v_item ->> 'client_line_id', '')::uuid;
      if v_client_id is not null then
        v_line_map := v_line_map || jsonb_build_object(v_client_id::text, v_new_line_id::text);
      end if;
    elsif (v_item ->> 'kind') = 'discount' then
      -- Skip in pass 1 — handled in pass 2.
      null;
    else
      raise exception 'unknown_line_kind: %', v_item ->> 'kind'
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3) PASS 2 — insert every DISCOUNT line, resolving any
  --    `target_client_line_ids` through the map into
  --    `discount_target_line_ids`.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if (v_item ->> 'kind') = 'discount' then
      v_resolved := null;
      v_targets_json := v_item -> 'target_client_line_ids';
      if v_targets_json is not null
         and jsonb_typeof(v_targets_json) = 'array'
         and jsonb_array_length(v_targets_json) > 0
      then
        v_resolved := array[]::uuid[];
        for v_target_text in select jsonb_array_elements_text(v_targets_json)
        loop
          v_target_cli := v_target_text::uuid;
          v_target_db := nullif(v_line_map ->> v_target_cli::text, '')::uuid;
          if v_target_db is null then
            raise exception 'unknown_target_client_line_id: %', v_target_cli
              using errcode = 'P0001';
          end if;
          v_resolved := array_append(v_resolved, v_target_db);
        end loop;
      end if;

      insert into public.ticket_items (
        ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty,
        assigned_staff_id, price_unconfirmed, discount_pct, note,
        discount_target_line_ids
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
        nullif(v_item ->> 'note', ''),
        v_resolved
      );
    end if;
  end loop;

  -- 4) Compute the totals from the persisted rows. Subtotal is the sum of
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

  -- 5) Write the computed totals. `tax_cents` stays 0, so
  --    `total_cents = subtotal_cents` satisfies
  --    `tickets_total_matches_subtotal_chk` (subtotal mirrors total here).
  update public.tickets
    set subtotal_cents = v_total,
        total_cents    = v_total,
        updated_at     = now()
    where id = v_ticket_id;

  -- 6) Audit ('ticket.created' — controlled vocab in lib/auth/audit.ts).
  insert into public.audit_log (acting_as_staff_id, action, entity_type, entity_id, payload)
    values (p_operator, 'ticket.created', 'ticket', v_ticket_id,
            jsonb_build_object('line_count', v_line_count, 'subtotal_cents', v_subtotal));

  -- 7) Return the new ticket id + totals for the caller.
  return query select v_ticket_id, v_subtotal, v_total;
end;
$$;

revoke all on function public.pos_create_ticket_from_draft(uuid, jsonb) from public;
grant execute on function public.pos_create_ticket_from_draft(uuid, jsonb) to service_role;
