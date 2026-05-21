# Contract: Read Model (page data contract)

The shapes the RSC pages receive from `lib/payroll/queries.ts`. All money is integer **cents**; all percentages are **0–1 fractions**. UI formats via `lib/dashboard/format.ts` (`formatCurrency`, `formatPercent`, `formatCount`) and `lib/time/format.ts`.

## `lib/payroll/window.ts`

```ts
type PayPeriodRef = {
  id: string | null;          // null until the row is lazily created
  startsOn: string;           // "2026-05-16" (salon-local date)
  endsOn: string;             // "2026-05-31"
  payDate: string;            // "2026-06-02"  (endsOn + 2 days)
  status: "open" | "closed";
  label: string;              // "May 16 – 31, 2026"
  shortLabel: string;         // "May 16 – 31"
  offset: number;             // 0 = current, negative = past
  isCurrent: boolean;
};

// Wraps semiMonthlyWindowAt(tz, now, offset) from lib/time/period-windows.ts.
function resolvePayPeriod(tz: string, now: Date, offset: number): PayPeriodRef;
function parsePayrollParams(raw: { offset?: string; filter?: string }):
  { offset: number; filter: "all" | "to-pay" | "paid" };
```

## Ledger read model — `/payroll` (US1)

```ts
type PayrollLedgerRow = {
  staffId: string;
  displayName: string;
  role: string;
  colorToken: string;
  serviceCommissionPct: number;       // 0–1
  tipSplitPct: number;                // 0–1
  ticketCount: number;

  commissionableCents: number;        // net of supply + card-fee deductions (R2)
  incomeAfterSplitCents: number;      // commissionable × commission %
  cardTipsCents: number;
  tipsAfterSplitCents: number;        // cardTips × tip %
  checkPortionCents: number;
  cashPaymentCents: number;           // max(0, incomeAfterSplit + tipsAfterSplit − checkPortion)

  state: "pending" | "paid" | "no_work" | "unpaid_closed";
  payout: {                            // present iff a payroll_payouts row exists
    method: "cash" | "zelle" | "check" | null;
    paidOn: string | null;
    recordedByName: string | null;
  } | null;
};

type PayrollLedgerTotals = {
  technicianCount: number;
  ticketCount: number;
  grossServiceIncomeCents: number;     // salon top-line gross (KPI — not commissionable)
  commissionableCents: number;
  incomeAfterSplitCents: number;
  cardTipsCents: number;
  tipsAfterSplitCents: number;
  checkPortionCents: number;
  cashPaymentCents: number;
};

type PayrollLedgerModel = {
  period: PayPeriodRef;
  rows: readonly PayrollLedgerRow[];           // one per active tech, sorted by displayName
  totals: PayrollLedgerTotals;                 // footer row
  eligibleCount: number;                        // rows with state ≠ "no_work"
  paidCount: number;
  cashRemainingCents: number;                   // Σ cashPayment of non-paid eligible rows
  recentPeriods: readonly PayPeriodRef[];       // for the period switcher
  isEmpty: boolean;                             // no completed tickets in the window
  readOnly: boolean;                            // true when period.status === "closed"
};

function loadPayrollLedger(supabase, tz, offset): Promise<PayrollLedgerModel>;
```

**State derivation per row**: `no_work` if earnings = 0; else if a `payroll_payouts` row exists → `paid` (`paid=true`) or `unpaid_closed` (`paid=false`); else `pending`. For a **closed** period every figure comes from the frozen `payroll_payouts` row; for an **open** period, `pending` rows are computed live and `paid` rows use the snapshot.

## Tech-detail read model — `/payroll/[staffId]` (US2)

```ts
type DayActivity = {
  date: string;            // "2026-05-17"
  dayOfMonth: number;
  weekday: string;         // "Sat"
  closed: boolean;         // salon closed / no activity
  serviceIncomeCents: number;
  cardTipsCents: number;
  ticketCount: number;
};

type TechDetailModel = {
  period: PayPeriodRef;
  row: PayrollLedgerRow;                  // same shape as the ledger row
  days: readonly DayActivity[];           // one per calendar day of the period
  bestDay: { date: string; amountCents: number } | null;
  avgPerWorkingDayCents: number;
  workingDayCount: number;
  prevStaffId: string | null;            // ledger-order neighbours (FR-019)
  nextStaffId: string | null;
  readOnly: boolean;
};

function loadTechDetail(supabase, tz, offset, staffId): Promise<TechDetailModel>;
```

## History read model — US4

```ts
type PayrollHistoryEntry = {
  period: PayPeriodRef;                   // status always "closed"
  totalPaidCents: number;                 // Σ cashPayment + Σ checkPortion
  closedByName: string;
  closedAt: string;
};

function loadPayrollHistory(supabase, tz): Promise<readonly PayrollHistoryEntry[]>;
```

## Reuse note

`loadPayrollLedger` / `loadTechDetail` obtain per-tech `commissionableCents`, `cardTipsCents`, and per-transaction rows by calling the existing Report query + `projectReport()` for the pay-period window, then `lib/payroll/aggregate.ts` (pure, unit-tested) applies the rate math, the cash clamp, the daily grouping, and merges in `payroll_payouts` snapshots. No new ticket/payment SQL is written — only the new `pay_periods` / `payroll_payouts` reads.
