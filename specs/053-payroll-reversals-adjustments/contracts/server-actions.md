# Contract: Payroll adjustment Server Actions

Added to `app/(studio)/payroll/actions.ts`. Each follows the established 8-step
prelude (see `recordPayout`): viewer → role gate → validate → recompute fresh →
service-role RPC → map error → `revalidatePath` → discriminated result. Reuses
the existing `ActionResult<T>` and `PayrollErrorCode` unions and `mapRpcError`.

Role gate for all three: `ROLES_ALLOWED = {owner, manager}` (no PIN override).

## `addAdjustment`

```ts
type AddAdjustmentInput = {
  payPeriodId: string;
  staffId: string;
  amountCents: number;   // signed, ≠ 0 (+ add / − deduct)
  reason: string;        // trimmed 1–80
};
addAdjustment(input): Promise<ActionResult<{ adjustmentId: string }>>
```

Behavior:
1. Viewer + role gate → `FORBIDDEN` otherwise.
2. Validate: `payPeriodId`/`staffId` non-empty strings; `amountCents` integer,
   `≠ 0`; `reason` trimmed length 1–80 → `INVALID` otherwise.
3. Recompute the **open** ledger (`loadPayrollLedger(…, 0)`). Refuse if
   `ledger.period.id !== payPeriodId` or `ledger.readOnly` → `PERIOD_CLOSED`;
   if the target row is missing or `state === 'no_work'` → `INVALID` (FR-007);
   if the row is already `paid` → `ALREADY_PAID`.
4. RPC `payroll_add_adjustment` via service role.
5. `revalidatePath('/payroll')` + `revalidatePath('/payroll/' + staffId)`.
6. `{ ok: true, adjustmentId }`.

## `editAdjustment`

```ts
type EditAdjustmentInput = {
  adjustmentId: string;
  amountCents: number;   // signed, ≠ 0
  reason: string;        // trimmed 1–80
};
editAdjustment(input): Promise<ActionResult>
```

Behavior: viewer+role gate; validate shape; RPC `payroll_edit_adjustment`
(the RPC re-derives the period/staff from the adjustment row and enforces the
open-scope lock — the action does not need the period id); map error;
revalidate `/payroll` and the affected `/payroll/{staffId}` (the RPC returns the
`staff_id` so the action can target the detail path). Locked scope →
`PERIOD_CLOSED` / `ALREADY_PAID`; unknown id → `INVALID`.

## `deleteAdjustment`

```ts
type DeleteAdjustmentInput = { adjustmentId: string };
deleteAdjustment(input): Promise<ActionResult>
```

Behavior: viewer+role gate; RPC `payroll_delete_adjustment` (hard delete,
audit-before-delete, open-scope lock enforced in the RPC); map error;
revalidate. Locked scope refuses; unknown id → `INVALID` (no-op/refused, per
spec concurrent-edit edge case).

## Error-code mapping (extends `mapRpcError`)

| RPC raise token | `PayrollErrorCode` | message |
|---|---|---|
| `payroll_period_not_open` | `PERIOD_CLOSED` | "This pay period is closed — adjustments can no longer change." |
| `payroll_payout_exists` | `ALREADY_PAID` | "This technician is already paid — adjustments are locked." |
| `payroll_adjustment_missing` | `INVALID` | "That adjustment no longer exists." |

The existing `payroll_period_not_open` / `payroll_payout_exists` tokens are
reused; only `payroll_adjustment_missing` is new. (The two existing tokens
currently map to slightly different copy for payouts; the adjustment actions may
pass a context-specific message or reuse the shared map — implementation detail.)
