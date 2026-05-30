# Contract: DB RPCs — migration `0029_payout_adjustments.sql`

All `language plpgsql security definer set search_path = public, pg_temp`.
Writes go only through these (RLS is select-only). Audit inserts mirror the
`payroll_record_payout` convention: `(actor_user_id, acting_as_staff_id, action,
entity_type, entity_id, payload)` with `actor_user_id = p_device_user_id`,
`acting_as_staff_id = p_operator`, `entity_type = 'payroll'`.

## Shared lock guard

```
payroll_assert_adjustable(p_pay_period_id uuid, p_staff_id uuid) returns void
```
- `select status from public.pay_periods where id = p_pay_period_id for update`.
  - null or `<> 'open'` → `raise exception 'payroll_period_not_open' using errcode='P0001'`.
- `if exists (select 1 from public.payroll_payouts where pay_period_id =
  p_pay_period_id and staff_id = p_staff_id)` → `raise exception
  'payroll_payout_exists' using errcode='P0001'`.

Implements FR-012 at the DB layer (period closed OR tech paid out ⇒ no writes).

## `payroll_add_adjustment(p_pay_period_id, p_staff_id, p_amount_cents, p_reason, p_operator, p_device_user_id) returns uuid`

1. `payroll_assert_adjustable(p_pay_period_id, p_staff_id)`.
2. Guard `p_amount_cents <> 0` and `char_length(btrim(p_reason)) between 1 and 80`
   (defense in depth; the column CHECKs also hold) → raise `payroll_invalid` on
   violation.
3. `insert into payout_adjustments (pay_period_id, staff_id, amount_cents,
   reason, created_by_staff_id, created_by_user_id) values (…, btrim(p_reason),
   p_operator, p_device_user_id) returning id`.
4. Audit `payroll.adjustment_added`, `entity_id = <new adjustment id>`, payload
   `{ pay_period_id, staff_id, amount_cents, reason }`.
5. Return the new id.

## `payroll_edit_adjustment(p_adjustment_id, p_amount_cents, p_reason, p_operator, p_device_user_id) returns uuid`

Returns the affected `staff_id` (so the action can revalidate the detail path).
1. `select pay_period_id, staff_id into … from payout_adjustments where id =
   p_adjustment_id for update`; not found → raise `payroll_adjustment_missing`.
2. `payroll_assert_adjustable(pay_period_id, staff_id)`.
3. Validate amount/reason as above.
4. `update payout_adjustments set amount_cents = p_amount_cents, reason =
   btrim(p_reason), updated_at = now() where id = p_adjustment_id`.
5. Audit `payroll.adjustment_edited`, `entity_id = p_adjustment_id`, payload
   `{ pay_period_id, staff_id, amount_cents, reason, edited: true }`.
6. Return `staff_id`.

## `payroll_delete_adjustment(p_adjustment_id, p_operator, p_device_user_id) returns uuid`

Returns the affected `staff_id`.
1. `select * into v_adj from payout_adjustments where id = p_adjustment_id for
   update`; not found → raise `payroll_adjustment_missing`.
2. `payroll_assert_adjustable(v_adj.pay_period_id, v_adj.staff_id)`.
3. Audit **before** delete: `payroll.adjustment_removed`, `entity_id =
   p_adjustment_id`, payload carrying the full line (`amount_cents`, `reason`,
   `created_by_staff_id`, `created_at`).
4. `delete from payout_adjustments where id = p_adjustment_id`.
5. Return `v_adj.staff_id`.

## RLS / grants

```sql
alter table public.payout_adjustments enable row level security;
create policy payout_adjustments_select_all
  on public.payout_adjustments for select to authenticated using (true);
-- no insert/update/delete policy: service-role RPCs only.
```

## Audit verbs (TypeScript side)

`lib/auth/audit.ts` `AuditAction` union gains:
`"payroll.adjustment_added" | "payroll.adjustment_edited" |
"payroll.adjustment_removed"`. `deriveEntityType` already routes `payroll.*` →
`"payroll"` — **no change** there.
