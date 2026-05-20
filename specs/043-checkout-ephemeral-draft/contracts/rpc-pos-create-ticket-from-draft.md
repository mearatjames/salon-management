# Contract: `pos_create_ticket_from_draft` RPC

**Feature**: `043-checkout-ephemeral-draft`
**Migration**: `supabase/migrations/0020_checkout_ephemeral_draft.sql`

The single atomic writer that turns a validated ephemeral draft into a persisted
`Ticket` + `Ticket Items`. Invoked as the first step of every payment-initiating
server action when the input is a draft (see `server-actions.md` R5 path).

## Signature

```sql
pos_create_ticket_from_draft(
  p_operator uuid,
  p_items    jsonb
) returns table(ticket_id uuid, subtotal_cents int, total_cents int)
```

- `language plpgsql`, `security definer`, `set search_path = public, pg_temp`.
- `revoke all on function ... from public;`
- `grant execute on function ... to service_role;`

Convention matches `pos_take_cash` (migration `0004`).

## Input — `p_items`

A JSON **array** of fully-resolved, already-validated line objects. The TS server
action builds this; the RPC does **not** re-validate against the catalog.

Service line:
```json
{
  "kind": "service",
  "ref_id": "<services.id uuid>",
  "name_snapshot": "<catalog-derived name>",
  "unit_price_cents": 4500,
  "assigned_staff_id": "<staff.id uuid>",
  "price_unconfirmed": false
}
```

Discount line:
```json
{
  "kind": "discount",
  "name_snapshot": "<discount label>",
  "unit_price_cents": -500,
  "discount_pct": 10.00,
  "note": "loyalty"
}
```

`unit_price_cents` for discount lines is the **final** amount (percent discounts
already folded against the subtotal by the caller). `discount_pct` is `null` for
flat discounts. `qty` defaults to 1 (not supplied).

## Behavior (single transaction)

1. INSERT one `tickets` row: `status='open'`, `opened_by_staff_id = p_operator`,
   `subtotal_cents = 0`, `total_cents = 0` (totals written in step 4).
2. INSERT one `ticket_items` row per element of `p_items`, mapping `kind` to the
   `service` / `discount` column shape required by `ticket_items_kind_columns_chk`
   (service rows: `ref_id` + `assigned_staff_id` set, `discount_pct` null;
   discount rows: `ref_id` null, `assigned_staff_id` null).
3. Compute `v_subtotal = sum(unit_price_cents) where kind='service'` and
   `v_total = greatest(0, v_subtotal + sum(unit_price_cents) where kind='discount')`.
4. UPDATE the ticket: `subtotal_cents = v_subtotal`, `total_cents = v_total`.
5. INSERT one `audit_log` row: `acting_as_staff_id = p_operator`,
   `action = 'ticket.created'`, `entity_type = 'ticket'`, `entity_id = <ticket id>`,
   `payload = jsonb_build_object('line_count', <n>, 'subtotal_cents', v_subtotal)`.
6. `return query select <ticket id>, v_subtotal, v_total;`

All-or-nothing: any failure (FK violation, CHECK violation) rolls back the entire
transaction — no partial ticket is ever left behind (FR-006).

## Errors

The RPC trusts its caller to have validated. Defensive failures surface as
standard Postgres errors:

- FK violation on `ref_id` / `assigned_staff_id` / `opened_by_staff_id` →
  `23503`.
- CHECK violation (`ticket_items_kind_columns_chk`,
  `ticket_items_unit_price_cents_chk`, `tickets_total_matches_subtotal_chk`) →
  `23514`.

The TS caller's validation makes these unreachable in normal operation; they are
a backstop, not a control-flow path. The empty-cart / unconfirmed-price refusals
are enforced **before** the RPC is called (see `checkout-draft.md`).

## Postconditions

- Exactly one `tickets` row (`status='open'`), `N` `ticket_items` rows, and one
  `ticket.created` `audit_log` row exist — or none of them do.
- `total_cents = subtotal_cents` (tax is 0).
- No `payments` row exists yet — payment is the caller's next step.
