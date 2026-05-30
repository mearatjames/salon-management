# Contract: Read-model & query-layer changes

## `lib/report/queries.ts::loadReportPage`

- Ticket query filter changes from `.eq("status","paid")` to
  `.in("status", ["paid","refunded","partially_refunded"])` (still
  `closed_at ∈ [start,end)`). `void` / `discarded` remain excluded.
- Payments select adds `kind, amount_cents` and **drops** the implicit
  payment-only assumption: keep `.eq("status","succeeded")` but include refund
  rows (they are also `succeeded` once finalized). `projectReport` splits by
  `kind`.
- Output shape unchanged except the new `refundedCents` fields (data-model §2).
- **Consumers:** the Report page + CSV must now display **net** = original −
  `refundedCents`. Payroll's `assemblePayrollLedger` keeps reading
  `commissionableCents` / `cardTipsCents` (original) — **no change there**.

## `lib/payroll/queries.ts::assemblePayrollLedger`

- After loading payouts, add one query: `payout_adjustments` for `period.id`,
  selecting `id, staff_id, amount_cents, reason, created_by_staff_id,
  created_by_user_id, created_at, updated_at`. Group by `staff_id` into
  `AdjustmentLine[]` (resolve `createdByName` from the staff-name map already
  built for `recordedByNames`; format `createdAtLabel` via the salon-time
  helper; `edited = updated_at !== null`).
- Pass `adjustmentsByStaff` into `projectPayrollLedger`.
- `loadTechDetail` needs no new query — the row it returns already carries
  `adjustments`.

## `lib/payroll/queries.ts::loadPayrollHistory`

- Per-period paid total gains the period's `Σ amount_cents` from
  `payout_adjustments` so the History figure equals what was actually handed out
  (`cash_payment + check + adjustments`). One extra grouped query over the
  closed-period ids.

## `lib/payroll/aggregate.ts::projectPayrollLedger`

- Input gains `adjustmentsByStaff`. Each row sets `adjustments`,
  `adjustmentsCents = Σ`, `netPayoutCents = cashPaymentCents + adjustmentsCents`.
  Totals gain `adjustmentsCents` and `netPayoutCents`. `cashRemainingCents`
  (KPI "cash to pay") switches to Σ `netPayoutCents` of non-paid eligible rows.
- Paid/closed rows: adjustments are still read and summed (they are locked, so
  the live sum = sum at payout/close time — R3).

## UI components

| File | Change |
|---|---|
| `components/lacquer/payroll/payroll-ledger.tsx` | Add **Adj.** + **Net payout** columns (and tfoot totals). `—` for no-work / zero. |
| `components/lacquer/payroll/payroll-kpis.tsx` | Add **Adjustments** KPI (signed); **Cash to pay** reads net. |
| `components/lacquer/payroll/tech-breakdown.tsx` | When adjustments exist: insert a **Cash payment** sub-row, one row per adjustment line (signed), and a **Net payout** total. No refund note (FR-006). |
| `components/lacquer/payroll/tech-detail-header.tsx` | Big number shows **Net payout**; sub shows `{cash} cash {±adj} adj` when adjustments exist. |
| `components/lacquer/payroll/tech-pay-action.client.tsx` | CTA reads "Mark {netPayout} paid"; foot notes the net = cash + adjustments. |
| `components/lacquer/payroll/adjustments-card.client.tsx` | **NEW** — list + add/edit/delete + centered Dialog (`AdjustmentForm`). Read-only "Period closed" lock state. Rendered only for `!no_work` rows. |
| `app/(studio)/payroll/[staffId]/page.tsx` | Render `AdjustmentsCard` (pass `readOnly = detail.readOnly || row.state==='paid'`, `payPeriodId`, `staffId`). |
| `styles/payroll.css` | Port the design's `.adj-*` / `.pp-adj-*` / `.pl-adj` / `.pl-bd-row.adj` / `.adj-modal-*` token-styles; **omit** the refund-note styles. |

The Report-page/CSV net-revenue display change lives in the report layer
(`lib/report/*`, `app/(studio)/report/*`, `components/lacquer/report/*`,
`lib/report/csv.ts`) — read `commissionableCents − refundedCents`.
