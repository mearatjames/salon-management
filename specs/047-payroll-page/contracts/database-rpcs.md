# Contract: Database RPCs

Three `SECURITY DEFINER` functions in `supabase/migrations/0021_payroll.sql`. Conventions match `pos_close_cash_drawer` (migration 0014): `p_*` params, `v_*` locals, `set search_path = public, pg_temp`, `for update` lock on the `pay_periods` row, validate-before-mutate, audit `insert` in the same transaction, `raise exception … using errcode = 'P0001'` for application errors, then `revoke all on function … from public` + `grant execute … to service_role`.

All three are called only from `app/(studio)/payroll/actions.ts` via the service-role client. Authorization is enforced in the Server Action *before* the call (R10).

---

## `payroll_record_payout`

Records a payout for one tech in an open period.

```sql
payroll_record_payout(
  p_pay_period_id            uuid,
  p_staff_id                 uuid,
  p_method                   public.payout_method,
  p_paid_on                  date,
  p_commissionable_cents     int,
  p_income_after_split_cents int,
  p_card_tips_cents          int,
  p_tips_after_split_cents   int,
  p_check_portion_cents      int,
  p_cash_payment_cents       int,
  p_service_commission_pct   numeric,
  p_tip_split_pct            numeric,
  p_operator                 uuid,   -- acting_as_staff_id
  p_device_user_id           uuid    -- auth.uid()
) returns uuid                       -- the new payroll_payouts.id
```

**Validation** (raise `P0001` on failure):
- `payroll_period_not_open` — the period row is missing or `status <> 'open'`.
- `payroll_payout_exists` — a `payroll_payouts` row already exists for `(p_pay_period_id, p_staff_id)`.
- `payroll_cash_mismatch` — `p_cash_payment_cents <> max(0, p_income_after_split_cents + p_tips_after_split_cents − p_check_portion_cents)` (snapshot self-consistency guard).

**Effect** (one transaction): lock the `pay_periods` row `for update`; insert a `payroll_payouts` row with `paid = true`, `method`, `paid_on`, `recorded_by_staff_id = p_operator`, `paid_at = now()`, and all snapshot columns; insert an `audit_log` row `action = 'payroll.payout_recorded'`, `entity_type = 'payroll'`, `entity_id = <new payout id>`, payload = `{ pay_period_id, staff_id, method, …all snapshot figures }`.

---

## `payroll_undo_payout`

Reverses a recorded payout in an open period (R9).

```sql
payroll_undo_payout(
  p_pay_period_id   uuid,
  p_staff_id        uuid,
  p_operator        uuid,
  p_device_user_id  uuid
) returns void
```

**Validation** (`P0001`):
- `payroll_period_not_open` — period missing or not `open`.
- `payroll_payout_missing` — no `payroll_payouts` row for `(p_pay_period_id, p_staff_id)`.

**Effect** (one transaction): lock the `pay_periods` row; read the payout row; insert an `audit_log` row `action = 'payroll.payout_undone'`, `entity_type = 'payroll'`, `entity_id = p_pay_period_id`, payload = `{ staff_id, …the complete snapshot of the row about to be deleted }`; **then** `delete` the `payroll_payouts` row. (Audit-before-delete so nothing is silently lost.)

---

## `payroll_close_period`

Closes an open period, freezing every eligible tech (R6).

```sql
payroll_close_period(
  p_pay_period_id   uuid,
  p_frozen_rows     jsonb,   -- [] when every eligible tech is already paid
  p_period_totals   jsonb,   -- { commissionable_cents, card_tips_cents, check_cents, cash_cents, … }
  p_operator        uuid,
  p_device_user_id  uuid
) returns void
```

`p_frozen_rows` is a JSON array, one object per **eligible-but-unpaid** tech, each:
`{ staff_id, commissionable_cents, income_after_split_cents, card_tips_cents, tips_after_split_cents, check_portion_cents, cash_payment_cents, service_commission_pct, tip_split_pct }`. The Server Action computes these from `lib/payroll/aggregate` immediately before the call.

**Validation** (`P0001`):
- `payroll_period_not_open` — period missing or not `open`.

**Effect** (one transaction): lock the `pay_periods` row `for update`; for each element of `p_frozen_rows`, insert a `payroll_payouts` row with `paid = false` (method/paid_on/recorded_by/paid_at null) and the snapshot figures — `on conflict (pay_period_id, staff_id) do nothing` (a tech paid between page-load and close already has a row; skip them); `update pay_periods set status = 'closed', closed_at = now(), closed_by_staff_id = p_operator`; insert an `audit_log` row `action = 'payroll.period_closed'`, `entity_type = 'payroll'`, `entity_id = p_pay_period_id`, payload = `{ frozen_staff_ids, p_period_totals }`.

> **Owner-only**: enforced in the Server Action, not the RPC (consistent with the codebase — the RPC trusts its caller).

---

## Postgres-error → Server-Action-code mapping

The Server Action inspects `error.message` and maps:

| Contains | Result code |
|----------|-------------|
| `payroll_period_not_open` | `PERIOD_CLOSED` |
| `payroll_payout_exists` | `ALREADY_PAID` |
| `payroll_payout_missing` | `NOT_PAID` |
| `payroll_cash_mismatch` | `UNEXPECTED` (logged — indicates a server bug) |
| anything else | `UNEXPECTED` (logged) |
