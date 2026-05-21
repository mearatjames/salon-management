// lib/payroll/aggregate.ts
// -----------------------------------------------------------------------------
// Pure payroll-ledger projection + the rate / clamp money math.
//
// This module is the constitutionally test-first piece (Constitution IV — the
// payroll money math): `applyRates` and `projectPayrollLedger` have unit tests
// written and seen to fail before this implementation existed.
//
// Pure — no I/O, no Supabase, no `Date.now()`. The live query layer
// (`lib/payroll/queries.ts`) feeds it the per-tech `TechnicianReport`s the
// Report query already projected, plus the raw `pay_periods` / `payroll_payouts`
// rows; the unit suite feeds it fixed fixtures.
//
// See specs/047-payroll-page/contracts/read-model.md.

import type { PayPeriodRef } from "@/lib/payroll/window";
import type { ReportTransaction, TechnicianReport } from "@/lib/report/aggregate";
import { salonDateString } from "@/lib/time/format";

// ─── Raw input row shapes (what the query layer projects) ───────────────────

/** The payroll-relevant columns of a `public.staff` row. */
export type PayrollStaffRow = {
  readonly id: string;
  readonly display_name: string;
  readonly role: string;
  readonly color_token: string;
  /** Current service commission share, 0–1. */
  readonly service_commission_pct: number;
  /** Current tip split share, 0–1. */
  readonly tip_split_pct: number;
  /** Current per-period check portion, integer cents. */
  readonly check_portion_cents: number;
};

/** A `public.payroll_payouts` row — the immutable per-(period, tech) snapshot. */
export type PayrollPayoutRow = {
  readonly staff_id: string;
  readonly paid: boolean;
  readonly method: "cash" | "zelle" | "check" | null;
  readonly paid_on: string | null;
  readonly recorded_by_staff_id: string | null;
  readonly commissionable_cents: number;
  readonly income_after_split_cents: number;
  readonly card_tips_cents: number;
  readonly tips_after_split_cents: number;
  readonly check_portion_cents: number;
  readonly cash_payment_cents: number;
  readonly service_commission_pct: number;
  readonly tip_split_pct: number;
};

export type ProjectPayrollLedgerInput = {
  readonly period: PayPeriodRef;
  /** Active staff rows — one ledger row is projected per staff member. */
  readonly staff: readonly PayrollStaffRow[];
  /** Per-tech earnings projected by the Report query for the period window. */
  readonly technicianReports: readonly TechnicianReport[];
  /** Frozen payout snapshots for this period (recorded ⇔ a row exists). */
  readonly payouts: readonly PayrollPayoutRow[];
  /** `staff.id` → display name, for resolving `recordedByName`. */
  readonly recordedByNames: Readonly<Record<string, string>>;
};

// ─── Read-model types (serialisable, projected server-side) ─────────────────

export type PayrollLedgerRow = {
  readonly staffId: string;
  readonly displayName: string;
  readonly role: string;
  readonly colorToken: string;
  readonly serviceCommissionPct: number; // 0–1
  readonly tipSplitPct: number; // 0–1
  readonly ticketCount: number;
  readonly commissionableCents: number; // net of supply + card-fee deductions
  readonly incomeAfterSplitCents: number; // commissionable × commission %
  readonly cardTipsCents: number;
  readonly tipsAfterSplitCents: number; // cardTips × tip %
  readonly checkPortionCents: number;
  readonly cashPaymentCents: number; // max(0, incomeAfterSplit + tipsAfterSplit − check)
  readonly state: "pending" | "paid" | "no_work" | "unpaid_closed";
  readonly payout: {
    readonly method: "cash" | "zelle" | "check" | null;
    readonly paidOn: string | null;
    readonly recordedByName: string | null;
  } | null;
};

export type PayrollLedgerTotals = {
  readonly technicianCount: number;
  readonly ticketCount: number;
  readonly grossServiceIncomeCents: number; // salon top-line GROSS (KPI)
  readonly commissionableCents: number;
  readonly incomeAfterSplitCents: number;
  readonly cardTipsCents: number;
  readonly tipsAfterSplitCents: number;
  readonly checkPortionCents: number;
  readonly cashPaymentCents: number;
};

export type PayrollLedgerModel = {
  readonly period: PayPeriodRef;
  readonly rows: readonly PayrollLedgerRow[];
  readonly totals: PayrollLedgerTotals;
  readonly eligibleCount: number; // rows with state ≠ "no_work"
  readonly paidCount: number;
  readonly cashRemainingCents: number; // Σ cashPayment of non-paid eligible rows
  readonly recentPeriods: readonly PayPeriodRef[];
  readonly isEmpty: boolean; // no completed tickets in the window
  readonly readOnly: boolean; // true when period.status === "closed"
};

/**
 * The tech-detail read model — a single tech's payroll for a period plus the
 * daily-activity grouping the detail screen charts. `prevStaffId` / `nextStaffId`
 * are the ledger-order (displayName-sorted) neighbours, for prev/next nav.
 */
export type TechDetailModel = {
  readonly period: PayPeriodRef;
  /** The tech's ledger row — same shape the `/payroll` table renders. */
  readonly row: PayrollLedgerRow;
  /** One entry per calendar day of the period window. */
  readonly days: readonly DayActivity[];
  readonly bestDay: { readonly date: string; readonly amountCents: number } | null;
  readonly avgPerWorkingDayCents: number;
  readonly workingDayCount: number;
  /** Ledger-order neighbours — `null` at the first / last row. */
  readonly prevStaffId: string | null;
  readonly nextStaffId: string | null;
  readonly readOnly: boolean;
};

// ─── applyRates ──────────────────────────────────────────────────────────────

export type ApplyRatesInput = {
  readonly commissionableCents: number;
  readonly cardTipsCents: number;
  readonly serviceCommissionPct: number; // 0–1
  readonly tipSplitPct: number; // 0–1
  readonly checkPortionCents: number;
};

export type ApplyRatesResult = {
  readonly incomeAfterSplitCents: number;
  readonly tipsAfterSplitCents: number;
  readonly cashPaymentCents: number;
};

/**
 * Applies the per-tech payroll rates to a period's commissionable income and
 * card tips, then derives the cash payment with the floor clamp.
 *
 *  - `incomeAfterSplitCents = round(commissionable × serviceCommissionPct)`;
 *  - `tipsAfterSplitCents   = round(cardTips × tipSplitPct)`;
 *  - `cashPaymentCents      = max(0, incomeAfterSplit + tipsAfterSplit − check)`.
 *
 * Rounding convention: `Math.round` (half-up) — a single consistent rule for
 * both rate products, exercised by the unit suite.
 */
export function applyRates(input: ApplyRatesInput): ApplyRatesResult {
  const incomeAfterSplitCents = Math.round(input.commissionableCents * input.serviceCommissionPct);
  const tipsAfterSplitCents = Math.round(input.cardTipsCents * input.tipSplitPct);
  const cashPaymentCents = Math.max(
    0,
    incomeAfterSplitCents + tipsAfterSplitCents - input.checkPortionCents
  );
  return { incomeAfterSplitCents, tipsAfterSplitCents, cashPaymentCents };
}

// ─── projectPayrollLedger ────────────────────────────────────────────────────

const ZERO_TOTALS: PayrollLedgerTotals = {
  technicianCount: 0,
  ticketCount: 0,
  grossServiceIncomeCents: 0,
  commissionableCents: 0,
  incomeAfterSplitCents: 0,
  cardTipsCents: 0,
  tipsAfterSplitCents: 0,
  checkPortionCents: 0,
  cashPaymentCents: 0,
};

/**
 * Projects the staff roster, the Report-derived per-tech earnings, and the
 * frozen payout snapshots into the `PayrollLedgerModel`.
 *
 * Per-row rule (contracts/read-model.md):
 *  - a payout row exists ⇒ the row's figures come from the FROZEN snapshot and
 *    the state is `paid` (`paid=true`) or `unpaid_closed` (`paid=false`);
 *  - no payout row + zero computed earnings ⇒ `no_work`;
 *  - no payout row + non-zero earnings ⇒ `pending`, computed live from the
 *    current rates.
 *
 * Pure: no I/O, no `Date.now()`. `recentPeriods` is left empty — the query
 * layer fills it after assembling the period list.
 */
export function projectPayrollLedger(input: ProjectPayrollLedgerInput): PayrollLedgerModel {
  const { period, staff, technicianReports, payouts, recordedByNames } = input;

  const reportByStaff = new Map(technicianReports.map((t) => [t.staffId, t]));
  const payoutByStaff = new Map(payouts.map((p) => [p.staff_id, p]));

  const rows: PayrollLedgerRow[] = staff
    .map((s): PayrollLedgerRow => {
      const report = reportByStaff.get(s.id) ?? null;
      const payout = payoutByStaff.get(s.id) ?? null;

      if (payout !== null) {
        // Recorded — every figure is the immutable frozen snapshot.
        return {
          staffId: s.id,
          displayName: s.display_name,
          role: s.role,
          colorToken: s.color_token,
          serviceCommissionPct: payout.service_commission_pct,
          tipSplitPct: payout.tip_split_pct,
          ticketCount: report?.transactionCount ?? 0,
          commissionableCents: payout.commissionable_cents,
          incomeAfterSplitCents: payout.income_after_split_cents,
          cardTipsCents: payout.card_tips_cents,
          tipsAfterSplitCents: payout.tips_after_split_cents,
          checkPortionCents: payout.check_portion_cents,
          cashPaymentCents: payout.cash_payment_cents,
          state: payout.paid ? "paid" : "unpaid_closed",
          payout: {
            method: payout.method,
            paidOn: payout.paid_on,
            recordedByName: payout.recorded_by_staff_id
              ? (recordedByNames[payout.recorded_by_staff_id] ?? null)
              : null,
          },
        };
      }

      // No payout row — compute live from the current rates.
      const commissionableCents = report?.commissionableCents ?? 0;
      const cardTipsCents = report?.cardTipsCents ?? 0;
      const rated = applyRates({
        commissionableCents,
        cardTipsCents,
        serviceCommissionPct: s.service_commission_pct,
        tipSplitPct: s.tip_split_pct,
        checkPortionCents: s.check_portion_cents,
      });
      // `no_work` when there is nothing to pay — zero income and zero tips.
      const hasEarnings = rated.incomeAfterSplitCents > 0 || rated.tipsAfterSplitCents > 0;

      return {
        staffId: s.id,
        displayName: s.display_name,
        role: s.role,
        colorToken: s.color_token,
        serviceCommissionPct: s.service_commission_pct,
        tipSplitPct: s.tip_split_pct,
        ticketCount: report?.transactionCount ?? 0,
        commissionableCents,
        incomeAfterSplitCents: rated.incomeAfterSplitCents,
        cardTipsCents,
        tipsAfterSplitCents: rated.tipsAfterSplitCents,
        checkPortionCents: s.check_portion_cents,
        cashPaymentCents: rated.cashPaymentCents,
        state: hasEarnings ? "pending" : "no_work",
        payout: null,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Totals reconcile every row. `grossServiceIncomeCents` is the salon top-line
  // gross (before deductions) — a KPI, not a payout figure.
  const totals: PayrollLedgerTotals =
    rows.length === 0
      ? ZERO_TOTALS
      : {
          technicianCount: rows.length,
          ticketCount: rows.reduce((a, r) => a + r.ticketCount, 0),
          grossServiceIncomeCents: technicianReports.reduce((a, t) => a + t.grossCents, 0),
          commissionableCents: rows.reduce((a, r) => a + r.commissionableCents, 0),
          incomeAfterSplitCents: rows.reduce((a, r) => a + r.incomeAfterSplitCents, 0),
          cardTipsCents: rows.reduce((a, r) => a + r.cardTipsCents, 0),
          tipsAfterSplitCents: rows.reduce((a, r) => a + r.tipsAfterSplitCents, 0),
          checkPortionCents: rows.reduce((a, r) => a + r.checkPortionCents, 0),
          cashPaymentCents: rows.reduce((a, r) => a + r.cashPaymentCents, 0),
        };

  const eligibleRows = rows.filter((r) => r.state !== "no_work");
  const eligibleCount = eligibleRows.length;
  const paidCount = rows.filter((r) => r.state === "paid").length;
  const cashRemainingCents = eligibleRows
    .filter((r) => r.state !== "paid")
    .reduce((a, r) => a + r.cashPaymentCents, 0);

  return {
    period,
    rows,
    totals,
    eligibleCount,
    paidCount,
    cashRemainingCents,
    recentPeriods: [],
    isEmpty: technicianReports.length === 0,
    readOnly: period.status === "closed",
  };
}

// ─── projectDailyActivity — per-day grouping for the tech detail screen ──────

/** One calendar day of the tech-detail daily-activity chart. */
export type DayActivity = {
  /** Salon-local ISO date, e.g. `"2026-05-17"`. */
  readonly date: string;
  readonly dayOfMonth: number;
  /** Short weekday name, e.g. `"Sat"`. */
  readonly weekday: string;
  /**
   * A "closed" day for this tech — they had zero service income AND zero card
   * tips. A per-tech no-activity heuristic, NOT coupled to salon-hours data.
   */
  readonly closed: boolean;
  /** Service income net of supply + card-fee deductions (commissionable). */
  readonly serviceIncomeCents: number;
  readonly cardTipsCents: number;
  readonly ticketCount: number;
};

export type ProjectDailyActivityInput = {
  /** Salon timezone — the day a transaction lands in is its salon-local date. */
  readonly tz: string;
  /** The pay period whose calendar days `days[]` enumerates. */
  readonly period: PayPeriodRef;
  /** The tech's per-transaction rows for the period window (from `projectReport`). */
  readonly transactions: readonly ReportTransaction[];
};

export type DailyActivityResult = {
  /** One entry per calendar day of the period window, in date order. */
  readonly days: readonly DayActivity[];
  /** The day with the highest `serviceIncome + cardTips`; `null` if none worked. */
  readonly bestDay: { readonly date: string; readonly amountCents: number } | null;
  /** Total income+tips ÷ `workingDayCount`; `0` when no working days. */
  readonly avgPerWorkingDayCents: number;
  /** Count of non-`closed` days. */
  readonly workingDayCount: number;
};

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/**
 * Enumerates the calendar days of a `[startsOn, endsOn]` window (inclusive).
 * Both bounds are plain "YYYY-MM-DD" salon-local dates — UTC math on the
 * calendar parts is safe and timezone-free here.
 */
function enumerateDays(startsOn: string, endsOn: string): string[] {
  const [sy, sm, sd] = startsOn.split("-").map(Number);
  const [ey, em, ed] = endsOn.split("-").map(Number);
  const end = Date.UTC(ey, em - 1, ed);
  const out: string[] = [];
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  while (cursor.getTime() <= end) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > 366) break; // hard guard against a malformed window
  }
  return out;
}

/**
 * Groups a tech's period transactions into one `DayActivity` per calendar day
 * of the pay-period window (every day, not only days with activity).
 *
 *  - `serviceIncomeCents` is the commissionable figure — gross net of the
 *    card-fee and supply deductions the Report query already computed;
 *  - `closed` is a per-tech heuristic: zero service income AND zero card tips;
 *  - `bestDay` maximises `serviceIncome + cardTips` (`null` if no working day);
 *  - `avgPerWorkingDayCents` = Σ(income+tips) ÷ `workingDayCount` (0 if none).
 *
 * Pure: no I/O, no `Date.now()`.
 */
export function projectDailyActivity(input: ProjectDailyActivityInput): DailyActivityResult {
  const { tz, period, transactions } = input;

  // Accumulate per salon-local day.
  type DayAccum = { serviceIncomeCents: number; cardTipsCents: number; ticketCount: number };
  const byDate = new Map<string, DayAccum>();
  for (const t of transactions) {
    if (!t.closedAtIso) continue;
    const date = salonDateString(tz, new Date(t.closedAtIso));
    const accum = byDate.get(date) ?? {
      serviceIncomeCents: 0,
      cardTipsCents: 0,
      ticketCount: 0,
    };
    accum.serviceIncomeCents += t.grossCents - t.cardFeeCents - t.supplyCents;
    accum.cardTipsCents += t.cardTipCents;
    accum.ticketCount += 1;
    byDate.set(date, accum);
  }

  const days: DayActivity[] = enumerateDays(period.startsOn, period.endsOn).map((date) => {
    const accum = byDate.get(date) ?? {
      serviceIncomeCents: 0,
      cardTipsCents: 0,
      ticketCount: 0,
    };
    const [y, m, d] = date.split("-").map(Number);
    const weekday = WEEKDAY_FMT.format(new Date(Date.UTC(y, m - 1, d)));
    const closed = accum.serviceIncomeCents === 0 && accum.cardTipsCents === 0;
    return {
      date,
      dayOfMonth: d,
      weekday,
      closed,
      serviceIncomeCents: accum.serviceIncomeCents,
      cardTipsCents: accum.cardTipsCents,
      ticketCount: accum.ticketCount,
    };
  });

  const workingDays = days.filter((d) => !d.closed);
  const workingDayCount = workingDays.length;

  let bestDay: { date: string; amountCents: number } | null = null;
  for (const d of workingDays) {
    const amountCents = d.serviceIncomeCents + d.cardTipsCents;
    if (bestDay === null || amountCents > bestDay.amountCents) {
      bestDay = { date: d.date, amountCents };
    }
  }

  const totalCents = workingDays.reduce((a, d) => a + d.serviceIncomeCents + d.cardTipsCents, 0);
  const avgPerWorkingDayCents = workingDayCount > 0 ? Math.round(totalCents / workingDayCount) : 0;

  return { days, bestDay, avgPerWorkingDayCents, workingDayCount };
}
