# Phase 1 Data Model: Payroll — Reversals & Adjustments

Feature: `053-payroll-reversals-adjustments` · See [research.md](./research.md)

## 1. New table — `public.payout_adjustments`

A signed manual correction to one technician's payout for one pay period.
Mutable only while the (period, staff) scope is open; **hard-deleted** when
removed (the audit log is the history).

```sql
create table public.payout_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  pay_period_id       uuid not null references public.pay_periods(id),
  staff_id            uuid not null references public.staff(id),
  amount_cents        int  not null check (amount_cents <> 0),     -- + add, − deduct
  reason              text not null check (char_length(btrim(reason)) between 1 and 80),
  created_by_staff_id uuid not null references public.staff(id),
  created_by_user_id  uuid,                                        -- device auth user
  created_at          timestamptz not null default now(),
  updated_at          timestamptz                                  -- set on edit; null = never edited
);

create index payout_adjustments_period_staff_idx
  on public.payout_adjustments (pay_period_id, staff_id);

alter table public.payout_adjustments enable row level security;

-- Select-only for authenticated; all writes go through the SECURITY DEFINER
-- RPCs via the service role (mirrors payroll_payouts, 0021).
drop policy if exists payout_adjustments_select_all on public.payout_adjustments;
create policy payout_adjustments_select_all
  on public.payout_adjustments for select to authenticated using (true);
```

**Validation rules (enforced in the RPC + the Server Action, not RLS):**
- `amount_cents` is a non-zero integer; the UI sends `+|amount|` or `−|amount|`.
- `reason` trimmed length 1–80.
- A row may be inserted/edited/deleted **only** while
  `pay_periods.status = 'open'` AND no `payroll_payouts` row exists for
  `(pay_period_id, staff_id)` — the lock (FR-012).
- The target `staff_id` must be a technician with computed earnings this period
  (FR-007) — enforced in the Server Action against the fresh ledger, not the DB.

**Lifecycle:** `created` → (`edited`*) → (`deleted` | frozen-on-lock). No state
column; "frozen" is implicit — once the scope locks, the RPCs refuse all writes,
so the rows are effectively read-only.

## 2. Changed projection types (`lib/report/aggregate.ts`)

`projectReport` becomes refund-aware. Existing money fields keep their meaning =
**original** (pre-refund) amounts; one new field carries the refund.

```ts
export type ReportTransaction = {
  // …unchanged…
  readonly refundedCents: number;   // NEW — succeeded refund allocated to this tech on this ticket (≥ 0)
};

export type TechnicianReport = {
  // …unchanged: grossCents / commissionableCents / cardTipsCents stay ORIGINAL…
  readonly refundedCents: number;   // NEW — Σ refunds allocated to this tech across the window (≥ 0)
};

export type ReportTotals = {
  // …unchanged…
  readonly refundedCents: number;   // NEW — Σ all succeeded refunds in the window
};
```

- Input row shapes gain: ticket `status` may now be `paid | refunded |
  partially_refunded`; payment rows gain `kind` (`'payment' | 'refund'`) and
  `amount_cents`. The gross/tip/deduction math reads only `kind='payment'`
  succeeded payments (unchanged numbers); refund rows feed `refundedCents`.
- Refund allocation on a multi-tech ticket: proportional by per-tech service
  subtotal via `splitCardTip(ticketRefundCents, techServiceSubtotals)` — exact
  largest-remainder, Σ = ticket refund.
- **Net** revenue = `commissionableCents − refundedCents` (and gross/net at the
  transaction and totals level); the Report page/CSV consume net, payroll
  consumes the original `commissionableCents`.

## 3. Changed payroll read model (`lib/payroll/aggregate.ts`)

```ts
export type AdjustmentLine = {                 // NEW
  readonly id: string;
  readonly amountCents: number;                // signed
  readonly reason: string;
  readonly createdByName: string | null;
  readonly createdAtLabel: string;             // pre-formatted salon-local
  readonly edited: boolean;                    // updated_at non-null
};

export type PayrollLedgerRow = {
  // …unchanged…
  readonly adjustments: readonly AdjustmentLine[];  // NEW — [] when none / no-work
  readonly adjustmentsCents: number;                // NEW — Σ adjustments (signed)
  readonly netPayoutCents: number;                  // NEW — cashPaymentCents + adjustmentsCents (may be < 0)
};

export type PayrollLedgerTotals = {
  // …unchanged…
  readonly adjustmentsCents: number;                // NEW — Σ over rows (signed)
  readonly netPayoutCents: number;                  // NEW — Σ netPayout over rows
};
```

- `projectPayrollLedger` input gains `adjustmentsByStaff: Record<string,
  AdjustmentLine[]>`. Each row folds in its lines; a row with no adjustments has
  `adjustments: []`, `adjustmentsCents: 0`, `netPayoutCents = cashPaymentCents`.
- **No `applyRates` change** — refund preservation is delivered purely by the
  widened ticket fetch feeding original `commissionableCents` (R1).
- `TechDetailModel` carries the row (which now includes `adjustments`), so the
  detail screen renders the lines + net payout with no extra field.
- `eligibleCount` / `paidCount` rules unchanged. "Cash to pay" KPI switches to
  Σ `netPayoutCents` of non-paid eligible rows (the design's "Cash to pay" tile).

## 4. Untouched tables / invariants

- `pay_periods`, `payroll_payouts`, `tickets`, `ticket_items`, `payments`,
  `staff` — **no schema change**. Refund rows already exist (feature 052). The
  payout snapshot stays immutable; net payout is derived, never stored (R3).
- `audit_log` — three new `action` values only; column shape unchanged.
- Money invariants preserved: refund allocation sums exactly to the ticket
  refund; adjustments are explicit append rows, never silent edits to earnings.
