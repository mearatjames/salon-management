// tests/unit/payroll/aggregate.test.ts
// -----------------------------------------------------------------------------
// Constitution IV (Test-First for Critical Paths) — the payroll money math is
// written test-first. These tests are authored and confirmed FAILING before
// `lib/payroll/aggregate.ts` exists.
//
// Covers the pure ledger projection:
//   - `applyRates` — commission % over commissionable income, tip % over card
//     tips, and the cash-payment clamp `max(0, incomeAfterSplit +
//     tipsAfterSplit − checkPortion)`;
//   - `projectPayrollLedger` — per-tech rows, state derivation
//     (`pending` / `paid` / `no_work` / `unpaid_closed`), the merge of frozen
//     `payroll_payouts` snapshots over live-computed rows, and the period
//     totals + KPI roll-up.

import { describe, expect, it } from "vitest";

import {
  applyRates,
  projectDailyActivity,
  projectPayrollLedger,
  type PayrollPayoutRow,
  type PayrollStaffRow,
  type ProjectDailyActivityInput,
  type ProjectPayrollLedgerInput,
} from "@/lib/payroll/aggregate";
import type { PayPeriodRef } from "@/lib/payroll/window";
import type { ReportTransaction, TechnicianReport } from "@/lib/report/aggregate";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OPEN_PERIOD: PayPeriodRef = {
  id: "70000000-0000-0000-0000-000000000001",
  startsOn: "2026-05-16",
  endsOn: "2026-05-31",
  payDate: "2026-06-02",
  status: "open",
  label: "May 16 – 31, 2026",
  shortLabel: "May 16 – 31",
  offset: 0,
  isCurrent: true,
};

const CLOSED_PERIOD: PayPeriodRef = {
  ...OPEN_PERIOD,
  id: "70000000-0000-0000-0000-000000000002",
  status: "closed",
};

// A minimal staff row — only the payroll-relevant columns.
function staff(over: Partial<PayrollStaffRow> & { id: string }): PayrollStaffRow {
  return {
    id: over.id,
    display_name: over.display_name ?? "Tech",
    role: over.role ?? "technician",
    color_token: over.color_token ?? "--avatar-rose",
    service_commission_pct: over.service_commission_pct ?? 0,
    tip_split_pct: over.tip_split_pct ?? 0,
    check_portion_cents: over.check_portion_cents ?? 0,
  };
}

// A minimal TechnicianReport — only the fields the ledger projection reads.
function techReport(over: { staffId: string } & Partial<TechnicianReport>): TechnicianReport {
  return {
    staffId: over.staffId,
    displayName: over.displayName ?? "Tech",
    colorToken: over.colorToken ?? "--avatar-rose",
    transactionCount: over.transactionCount ?? 0,
    serviceCount: over.serviceCount ?? 0,
    grossCents: over.grossCents ?? 0,
    cardFeeCents: over.cardFeeCents ?? 0,
    supplyCents: over.supplyCents ?? 0,
    totalDeductionsCents: over.totalDeductionsCents ?? 0,
    commissionableCents: over.commissionableCents ?? 0,
    cardTipsCents: over.cardTipsCents ?? 0,
    transactions: over.transactions ?? [],
  };
}

// ─── applyRates ──────────────────────────────────────────────────────────────

describe("applyRates", () => {
  it("applies the commission % to commissionable income and the tip % to card tips", () => {
    const r = applyRates({
      commissionableCents: 100_000,
      cardTipsCents: 20_000,
      serviceCommissionPct: 0.65,
      tipSplitPct: 0.9,
      checkPortionCents: 0,
    });
    expect(r.incomeAfterSplitCents).toBe(65_000);
    expect(r.tipsAfterSplitCents).toBe(18_000);
  });

  it("rounds half-cent results to the nearest cent (consistent convention)", () => {
    // 12345 × 0.6500 = 8024.25 → 8024; 777 × 0.9 = 699.3 → 699.
    const r = applyRates({
      commissionableCents: 12_345,
      cardTipsCents: 777,
      serviceCommissionPct: 0.65,
      tipSplitPct: 0.9,
      checkPortionCents: 0,
    });
    expect(r.incomeAfterSplitCents).toBe(8024);
    expect(r.tipsAfterSplitCents).toBe(699);
    // 101 × 0.5 = 50.5 → rounds up to 51.
    expect(
      applyRates({
        commissionableCents: 101,
        cardTipsCents: 0,
        serviceCommissionPct: 0.5,
        tipSplitPct: 0,
        checkPortionCents: 0,
      }).incomeAfterSplitCents
    ).toBe(51);
  });

  it("cash payment = income after split + tips after split − check portion", () => {
    const r = applyRates({
      commissionableCents: 100_000,
      cardTipsCents: 20_000,
      serviceCommissionPct: 0.65, // → 65000
      tipSplitPct: 0.9, // → 18000
      checkPortionCents: 30_000,
    });
    // 65000 + 18000 − 30000 = 53000.
    expect(r.cashPaymentCents).toBe(53_000);
  });

  it("clamps the cash payment to zero when the check portion exceeds earnings", () => {
    const r = applyRates({
      commissionableCents: 10_000,
      cardTipsCents: 0,
      serviceCommissionPct: 0.5, // → 5000
      tipSplitPct: 1,
      checkPortionCents: 250_000, // a large W-2 check portion
    });
    // max(0, 5000 + 0 − 250000) = 0.
    expect(r.cashPaymentCents).toBe(0);
  });

  it("zero commissionable + zero tips → all-zero result", () => {
    const r = applyRates({
      commissionableCents: 0,
      cardTipsCents: 0,
      serviceCommissionPct: 0.9,
      tipSplitPct: 1,
      checkPortionCents: 0,
    });
    expect(r.incomeAfterSplitCents).toBe(0);
    expect(r.tipsAfterSplitCents).toBe(0);
    expect(r.cashPaymentCents).toBe(0);
  });
});

// ─── projectPayrollLedger — row state derivation ─────────────────────────────

describe("projectPayrollLedger — row state", () => {
  const baseInput = (over: Partial<ProjectPayrollLedgerInput>): ProjectPayrollLedgerInput => ({
    period: OPEN_PERIOD,
    staff: over.staff ?? [],
    technicianReports: over.technicianReports ?? [],
    payouts: over.payouts ?? [],
    recordedByNames: over.recordedByNames ?? {},
  });

  it("a tech with zero earnings and no payout row → no_work", () => {
    const model = projectPayrollLedger(
      baseInput({
        staff: [staff({ id: "s1", display_name: "Zoe", service_commission_pct: 0.9 })],
        technicianReports: [],
      })
    );
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].state).toBe("no_work");
    expect(model.rows[0].cashPaymentCents).toBe(0);
    expect(model.rows[0].payout).toBeNull();
  });

  it("an eligible tech in an open period with no payout row → pending", () => {
    const model = projectPayrollLedger(
      baseInput({
        staff: [staff({ id: "s1", display_name: "Ana", service_commission_pct: 0.65 })],
        technicianReports: [
          techReport({ staffId: "s1", commissionableCents: 100_000, cardTipsCents: 0 }),
        ],
      })
    );
    expect(model.rows[0].state).toBe("pending");
    expect(model.rows[0].incomeAfterSplitCents).toBe(65_000);
    expect(model.rows[0].payout).toBeNull();
  });

  it("a tech with a paid=true payout row → paid, and the payout is exposed", () => {
    const payout: PayrollPayoutRow = {
      staff_id: "s1",
      paid: true,
      method: "zelle",
      paid_on: "2026-05-20",
      recorded_by_staff_id: "owner1",
      commissionable_cents: 100_000,
      income_after_split_cents: 65_000,
      card_tips_cents: 0,
      tips_after_split_cents: 0,
      check_portion_cents: 0,
      cash_payment_cents: 65_000,
      service_commission_pct: 0.65,
      tip_split_pct: 0,
    };
    const model = projectPayrollLedger(
      baseInput({
        staff: [staff({ id: "s1", display_name: "Ana", service_commission_pct: 0.65 })],
        technicianReports: [
          techReport({ staffId: "s1", commissionableCents: 100_000, cardTipsCents: 0 }),
        ],
        payouts: [payout],
        recordedByNames: { owner1: "Maya Patel" },
      })
    );
    expect(model.rows[0].state).toBe("paid");
    expect(model.rows[0].payout).not.toBeNull();
    expect(model.rows[0].payout?.method).toBe("zelle");
    expect(model.rows[0].payout?.paidOn).toBe("2026-05-20");
    expect(model.rows[0].payout?.recordedByName).toBe("Maya Patel");
  });

  it("a tech with a paid=false payout row → unpaid_closed", () => {
    const payout: PayrollPayoutRow = {
      staff_id: "s1",
      paid: false,
      method: null,
      paid_on: null,
      recorded_by_staff_id: null,
      commissionable_cents: 50_000,
      income_after_split_cents: 32_500,
      card_tips_cents: 0,
      tips_after_split_cents: 0,
      check_portion_cents: 0,
      cash_payment_cents: 32_500,
      service_commission_pct: 0.65,
      tip_split_pct: 0,
    };
    const model = projectPayrollLedger(
      baseInput({
        period: CLOSED_PERIOD,
        staff: [staff({ id: "s1", display_name: "Ana", service_commission_pct: 0.65 })],
        technicianReports: [],
        payouts: [payout],
      })
    );
    expect(model.rows[0].state).toBe("unpaid_closed");
    expect(model.rows[0].payout?.method).toBeNull();
  });
});

// ─── projectPayrollLedger — snapshot merge ───────────────────────────────────

describe("projectPayrollLedger — frozen snapshot merge", () => {
  it("a paid row's figures come from the frozen snapshot, not the live report", () => {
    // The live report says $1000 commissionable, but the frozen payout snapshot
    // recorded $900 (the tech earned more after the payout was recorded).
    const payout: PayrollPayoutRow = {
      staff_id: "s1",
      paid: true,
      method: "cash",
      paid_on: "2026-05-20",
      recorded_by_staff_id: "owner1",
      commissionable_cents: 90_000,
      income_after_split_cents: 58_500,
      card_tips_cents: 10_000,
      tips_after_split_cents: 9_000,
      check_portion_cents: 0,
      cash_payment_cents: 67_500,
      service_commission_pct: 0.65,
      tip_split_pct: 0.9,
    };
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [staff({ id: "s1", service_commission_pct: 0.65, tip_split_pct: 0.9 })],
      technicianReports: [
        techReport({ staffId: "s1", commissionableCents: 100_000, cardTipsCents: 12_000 }),
      ],
      payouts: [payout],
      recordedByNames: { owner1: "Maya Patel" },
    });
    const row = model.rows[0];
    // Frozen snapshot, not the live $100000.
    expect(row.commissionableCents).toBe(90_000);
    expect(row.incomeAfterSplitCents).toBe(58_500);
    expect(row.cardTipsCents).toBe(10_000);
    expect(row.tipsAfterSplitCents).toBe(9_000);
    expect(row.cashPaymentCents).toBe(67_500);
  });

  it("a pending row in an open period is computed live", () => {
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [staff({ id: "s1", service_commission_pct: 0.65, tip_split_pct: 0.9 })],
      technicianReports: [
        techReport({ staffId: "s1", commissionableCents: 100_000, cardTipsCents: 20_000 }),
      ],
      payouts: [],
      recordedByNames: {},
    });
    const row = model.rows[0];
    expect(row.commissionableCents).toBe(100_000);
    expect(row.incomeAfterSplitCents).toBe(65_000);
    expect(row.tipsAfterSplitCents).toBe(18_000);
  });
});

// ─── projectPayrollLedger — totals + KPI roll-up ─────────────────────────────

describe("projectPayrollLedger — totals and counts", () => {
  it("rows are sorted by displayName ascending", () => {
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [
        staff({ id: "s2", display_name: "Bea", service_commission_pct: 0.5 }),
        staff({ id: "s1", display_name: "Ada", service_commission_pct: 0.5 }),
        staff({ id: "s3", display_name: "Cy", service_commission_pct: 0.5 }),
      ],
      technicianReports: [
        techReport({ staffId: "s1", commissionableCents: 10_000 }),
        techReport({ staffId: "s2", commissionableCents: 10_000 }),
        techReport({ staffId: "s3", commissionableCents: 10_000 }),
      ],
      payouts: [],
      recordedByNames: {},
    });
    expect(model.rows.map((r) => r.displayName)).toEqual(["Ada", "Bea", "Cy"]);
  });

  it("totals sum every row; KPI gross is the salon top-line gross", () => {
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [
        staff({ id: "s1", display_name: "Ada", service_commission_pct: 0.6, tip_split_pct: 1 }),
        staff({ id: "s2", display_name: "Bea", service_commission_pct: 0.5, tip_split_pct: 1 }),
      ],
      technicianReports: [
        techReport({
          staffId: "s1",
          transactionCount: 3,
          grossCents: 100_000,
          commissionableCents: 90_000,
          cardTipsCents: 10_000,
        }),
        techReport({
          staffId: "s2",
          transactionCount: 2,
          grossCents: 60_000,
          commissionableCents: 50_000,
          cardTipsCents: 5_000,
        }),
      ],
      payouts: [],
      recordedByNames: {},
    });
    expect(model.totals.technicianCount).toBe(2);
    expect(model.totals.ticketCount).toBe(5);
    // Gross KPI = salon top-line gross (before deductions), NOT commissionable.
    expect(model.totals.grossServiceIncomeCents).toBe(160_000);
    expect(model.totals.commissionableCents).toBe(140_000);
    // Ada 90000×0.6=54000, Bea 50000×0.5=25000.
    expect(model.totals.incomeAfterSplitCents).toBe(79_000);
    expect(model.totals.cardTipsCents).toBe(15_000);
    // Ada 10000×1, Bea 5000×1.
    expect(model.totals.tipsAfterSplitCents).toBe(15_000);
    expect(model.totals.cashPaymentCents).toBe(79_000 + 15_000);
  });

  it("eligibleCount excludes no_work rows; paidCount counts paid rows; cashRemaining is non-paid eligible cash", () => {
    const paidS1: PayrollPayoutRow = {
      staff_id: "s1",
      paid: true,
      method: "cash",
      paid_on: "2026-05-20",
      recorded_by_staff_id: "owner1",
      commissionable_cents: 100_000,
      income_after_split_cents: 60_000,
      card_tips_cents: 0,
      tips_after_split_cents: 0,
      check_portion_cents: 0,
      cash_payment_cents: 60_000,
      service_commission_pct: 0.6,
      tip_split_pct: 1,
    };
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [
        staff({ id: "s1", display_name: "Ada", service_commission_pct: 0.6 }), // paid
        staff({ id: "s2", display_name: "Bea", service_commission_pct: 0.5 }), // pending
        staff({ id: "s3", display_name: "Cy", service_commission_pct: 0.5 }), // no_work
      ],
      technicianReports: [
        techReport({ staffId: "s1", commissionableCents: 100_000 }),
        techReport({ staffId: "s2", commissionableCents: 40_000 }), // 40000×0.5=20000
      ],
      payouts: [paidS1],
      recordedByNames: { owner1: "Maya" },
    });
    expect(model.eligibleCount).toBe(2); // Ada + Bea, not Cy
    expect(model.paidCount).toBe(1); // Ada
    // cashRemaining = non-paid eligible rows' cash = Bea's $200.
    expect(model.cashRemainingCents).toBe(20_000);
  });

  it("isEmpty is true when no completed tickets in the window", () => {
    const model = projectPayrollLedger({
      period: OPEN_PERIOD,
      staff: [staff({ id: "s1", display_name: "Ada", service_commission_pct: 0.6 })],
      technicianReports: [],
      payouts: [],
      recordedByNames: {},
    });
    expect(model.isEmpty).toBe(true);
  });

  it("readOnly is true for a closed period", () => {
    const model = projectPayrollLedger({
      period: CLOSED_PERIOD,
      staff: [staff({ id: "s1", display_name: "Ada" })],
      technicianReports: [],
      payouts: [],
      recordedByNames: {},
    });
    expect(model.readOnly).toBe(true);
    expect(model.period.status).toBe("closed");
  });
});

// ─── projectDailyActivity — per-day grouping for the tech detail screen ───────
//
// Constitution IV — the daily-activity math is the tech-detail screen's load-
// bearing aggregation. These tests are authored and confirmed FAILING before
// `projectDailyActivity` exists.

// A minimal ReportTransaction — only the fields the daily grouping reads
// (`closedAtIso`, `grossCents`, `cardFeeCents`, `supplyCents`, `cardTipCents`).
function tx(over: { closedAtIso: string } & Partial<ReportTransaction>): ReportTransaction {
  return {
    ticketId: over.ticketId ?? `tk-${over.closedAtIso}`,
    time: over.time ?? "",
    closedAtIso: over.closedAtIso,
    client: over.client ?? "Walk-in",
    serviceNames: over.serviceNames ?? [],
    method: over.method ?? "card",
    grossCents: over.grossCents ?? 0,
    cardFeeCents: over.cardFeeCents ?? 0,
    supplyCents: over.supplyCents ?? 0,
    netCents: over.netCents ?? 0,
    cardTipCents: over.cardTipCents ?? 0,
    tipPct: over.tipPct ?? null,
    deductionLines: over.deductionLines ?? [],
    isExpandable: over.isExpandable ?? false,
  };
}

// A short closed period — May 16–18, 2026 (UTC tz keeps the wall-date math
// trivial: a "…T12:00:00Z" instant lands on its own ISO date).
const SHORT_PERIOD: PayPeriodRef = {
  ...OPEN_PERIOD,
  startsOn: "2026-05-16",
  endsOn: "2026-05-18",
};

describe("projectDailyActivity — per-day grouping", () => {
  const baseInput = (over: Partial<ProjectDailyActivityInput>): ProjectDailyActivityInput => ({
    tz: over.tz ?? "UTC",
    period: over.period ?? SHORT_PERIOD,
    transactions: over.transactions ?? [],
  });

  it("emits one DayActivity per calendar day of the period window", () => {
    const result = projectDailyActivity(baseInput({}));
    expect(result.days).toHaveLength(3);
    expect(result.days.map((d) => d.date)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
    expect(result.days.map((d) => d.dayOfMonth)).toEqual([16, 17, 18]);
  });

  it("labels each day with its weekday", () => {
    const result = projectDailyActivity(baseInput({}));
    // May 16 2026 is a Saturday, 17 a Sunday, 18 a Monday.
    expect(result.days.map((d) => d.weekday)).toEqual(["Sat", "Sun", "Mon"]);
  });

  it("sums service income (commissionable, net of deductions), card tips, and tickets per day", () => {
    const result = projectDailyActivity(
      baseInput({
        transactions: [
          // May 16 — two tickets: gross 10000−300 fee = 9700, gross 5000 net = 5000.
          tx({
            closedAtIso: "2026-05-16T12:00:00.000Z",
            grossCents: 10_000,
            cardFeeCents: 300,
            cardTipCents: 1_500,
          }),
          tx({ closedAtIso: "2026-05-16T15:00:00.000Z", grossCents: 5_000, cardTipCents: 500 }),
          // May 18 — one ticket: gross 8000 − 200 supply = 7800.
          tx({ closedAtIso: "2026-05-18T09:00:00.000Z", grossCents: 8_000, supplyCents: 200 }),
        ],
      })
    );
    const [d16, d17, d18] = result.days;
    expect(d16.serviceIncomeCents).toBe(9_700 + 5_000);
    expect(d16.cardTipsCents).toBe(2_000);
    expect(d16.ticketCount).toBe(2);
    expect(d17.serviceIncomeCents).toBe(0);
    expect(d17.ticketCount).toBe(0);
    expect(d18.serviceIncomeCents).toBe(7_800);
    expect(d18.ticketCount).toBe(1);
  });

  it("marks a day closed when the tech had zero service income AND zero card tips", () => {
    const result = projectDailyActivity(
      baseInput({
        transactions: [
          tx({ closedAtIso: "2026-05-17T12:00:00.000Z", grossCents: 6_000, cardTipCents: 0 }),
        ],
      })
    );
    const [d16, d17, d18] = result.days;
    expect(d16.closed).toBe(true); // no activity at all
    expect(d17.closed).toBe(false); // had service income
    expect(d18.closed).toBe(true);
  });

  it("a day with zero income but non-zero card tips is NOT closed", () => {
    const result = projectDailyActivity(
      baseInput({
        // A tip-only ticket (e.g. a fully-discounted service) — the tech worked.
        transactions: [
          tx({ closedAtIso: "2026-05-16T12:00:00.000Z", grossCents: 0, cardTipCents: 800 }),
        ],
      })
    );
    expect(result.days[0].closed).toBe(false);
    expect(result.days[0].cardTipsCents).toBe(800);
  });

  it("bestDay is the day with the highest service income + card tips", () => {
    const result = projectDailyActivity(
      baseInput({
        transactions: [
          tx({ closedAtIso: "2026-05-16T12:00:00.000Z", grossCents: 10_000, cardTipCents: 0 }),
          // May 17 — 8000 income + 5000 tips = 13000 total, the best.
          tx({ closedAtIso: "2026-05-17T12:00:00.000Z", grossCents: 8_000, cardTipCents: 5_000 }),
          tx({ closedAtIso: "2026-05-18T12:00:00.000Z", grossCents: 9_000, cardTipCents: 0 }),
        ],
      })
    );
    expect(result.bestDay).toEqual({ date: "2026-05-17", amountCents: 13_000 });
  });

  it("bestDay is null when there are no working days", () => {
    const result = projectDailyActivity(baseInput({ transactions: [] }));
    expect(result.bestDay).toBeNull();
  });

  it("workingDayCount counts non-closed days; avgPerWorkingDayCents divides total income+tips by it", () => {
    const result = projectDailyActivity(
      baseInput({
        transactions: [
          // May 16 — 6000 income + 1000 tips.
          tx({ closedAtIso: "2026-05-16T12:00:00.000Z", grossCents: 6_000, cardTipCents: 1_000 }),
          // May 18 — 4000 income, no tips. May 17 is closed.
          tx({ closedAtIso: "2026-05-18T12:00:00.000Z", grossCents: 4_000, cardTipCents: 0 }),
        ],
      })
    );
    expect(result.workingDayCount).toBe(2);
    // total = (6000+1000) + (4000+0) = 11000; ÷ 2 = 5500.
    expect(result.avgPerWorkingDayCents).toBe(5_500);
  });

  it("avgPerWorkingDayCents is 0 when there are no working days", () => {
    const result = projectDailyActivity(baseInput({ transactions: [] }));
    expect(result.workingDayCount).toBe(0);
    expect(result.avgPerWorkingDayCents).toBe(0);
  });
});
