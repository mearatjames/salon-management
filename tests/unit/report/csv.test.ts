// Unit tests for `buildReportCsv` — the pure CSV builder behind the Report
// page's Export action (contract C5, FR-028).
//
// Test-first (Constitution Principle IV): these tests were written and seen to
// fail before `lib/report/csv.ts` existed. They pin the exact header row, the
// one-row-per-technician body, the trailing `TOTAL` row, the every-value
// double-quoting rule, and — crucially — value-for-value agreement with the
// `ReportTotals` an on-screen overview would render.

import { describe, expect, it } from "vitest";

import type { ReportReadModel, ReportTotals, TechnicianReport } from "@/lib/report/aggregate";
import type { ReportWindow } from "@/lib/report/window";
import { buildReportCsv } from "@/lib/report/csv";

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A non-exempt technician — every deduction column is non-zero.
const ADA: TechnicianReport = {
  staffId: "s-ada",
  displayName: "Ada Non-Exempt",
  colorToken: "--avatar-rose",
  transactionCount: 2,
  serviceCount: 3,
  grossCents: 13_000,
  cardFeeCents: 300,
  supplyCents: 500,
  totalDeductionsCents: 800,
  commissionableCents: 12_200,
  cardTipsCents: 1_000,
  hasNoDeductions: false,
  transactions: [],
};

// A fully exempt technician — `hasNoDeductions` true, zero deductions.
const BEA: TechnicianReport = {
  staffId: "s-bea",
  displayName: "Bea Exempt",
  colorToken: "--avatar-amber",
  transactionCount: 1,
  serviceCount: 1,
  grossCents: 8_000,
  cardFeeCents: 0,
  supplyCents: 0,
  totalDeductionsCents: 0,
  commissionableCents: 8_000,
  cardTipsCents: 1_200,
  hasNoDeductions: true,
  transactions: [],
};

const TOTALS: ReportTotals = {
  technicianCount: 2,
  transactionCount: 3,
  serviceCount: 4,
  grossCents: 21_000,
  cardFeeCents: 300,
  supplyCents: 500,
  totalDeductionsCents: 800,
  commissionableCents: 20_200,
  cardTipsCents: 2_200,
};

const REPORT: ReportReadModel = {
  technicians: [ADA, BEA], // already sorted by displayName asc
  totals: TOTALS,
  isEmpty: false,
};

const WINDOW = {
  granularity: "day",
  offset: 0,
  start: new Date("2026-05-20T07:00:00Z"),
  end: new Date("2026-05-21T07:00:00Z"),
  isCurrent: true,
  label: "Today",
  rangeLabel: "May 20, 2026",
} satisfies ReportWindow;

// Splits one CSV line into its quoted field values (strips the surrounding
// double quotes). The builder quotes every value, so a plain comma split on
// the de-quoted form is sufficient for these fixtures (no embedded commas).
function fields(line: string): string[] {
  return line.split(",").map((cell) => cell.replace(/^"/, "").replace(/"$/, ""));
}

// ─── Header row ──────────────────────────────────────────────────────────────

describe("buildReportCsv — header row", () => {
  it("emits exactly the nine contract C5 columns in order", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    expect(fields(lines[0])).toEqual([
      "Tech",
      "Exempt",
      "Services",
      "Gross",
      "Card Fee",
      "Supply",
      "Total Deductions",
      "Commissionable",
      "Card Tips",
    ]);
  });
});

// ─── Per-technician rows ─────────────────────────────────────────────────────

describe("buildReportCsv — one row per technician", () => {
  it("emits a row per technician plus header and TOTAL", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    // header + 2 technicians + TOTAL = 4 lines.
    expect(lines).toHaveLength(4);
  });

  it("rows follow `report.technicians` order (displayName asc)", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    expect(fields(lines[1])[0]).toBe("Ada Non-Exempt");
    expect(fields(lines[2])[0]).toBe("Bea Exempt");
  });

  it("Exempt is `No` for a deducting tech, `Yes` for an exempt tech", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    expect(fields(lines[1])[1]).toBe("No");
    expect(fields(lines[2])[1]).toBe("Yes");
  });

  it("Services is the integer service count", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    expect(fields(lines[1])[2]).toBe("3");
    expect(fields(lines[2])[2]).toBe("1");
  });

  it("money columns are two-decimal dollars from the *Cents fields", () => {
    const ada = fields(buildReportCsv(REPORT, WINDOW).split("\n")[1]);
    // Gross, Card Fee, Supply, Total Deductions, Commissionable, Card Tips.
    expect(ada[3]).toBe("130.00"); // grossCents 13000
    expect(ada[4]).toBe("3.00"); // cardFeeCents 300
    expect(ada[5]).toBe("5.00"); // supplyCents 500
    expect(ada[6]).toBe("8.00"); // totalDeductionsCents 800
    expect(ada[7]).toBe("122.00"); // commissionableCents 12200
    expect(ada[8]).toBe("10.00"); // cardTipsCents 1000
  });

  it("an exempt tech's deduction columns render 0.00", () => {
    const bea = fields(buildReportCsv(REPORT, WINDOW).split("\n")[2]);
    expect(bea[3]).toBe("80.00"); // gross
    expect(bea[4]).toBe("0.00"); // card fee
    expect(bea[5]).toBe("0.00"); // supply
    expect(bea[6]).toBe("0.00"); // total deductions
    expect(bea[7]).toBe("80.00"); // commissionable
    expect(bea[8]).toBe("12.00"); // card tips
  });
});

// ─── TOTAL row ───────────────────────────────────────────────────────────────

describe("buildReportCsv — TOTAL row", () => {
  it("the last row is the TOTAL row with a blank Exempt cell", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    const total = fields(lines[lines.length - 1]);
    expect(total[0]).toBe("TOTAL");
    expect(total[1]).toBe("");
  });

  it("the TOTAL row carries `ReportTotals` value-for-value", () => {
    const lines = buildReportCsv(REPORT, WINDOW).split("\n");
    const total = fields(lines[lines.length - 1]);
    expect(total[2]).toBe("4"); // serviceCount
    expect(total[3]).toBe("210.00"); // grossCents 21000
    expect(total[4]).toBe("3.00"); // cardFeeCents 300
    expect(total[5]).toBe("5.00"); // supplyCents 500
    expect(total[6]).toBe("8.00"); // totalDeductionsCents 800
    expect(total[7]).toBe("202.00"); // commissionableCents 20200
    expect(total[8]).toBe("22.00"); // cardTipsCents 2200
  });
});

// ─── Formatting invariants ───────────────────────────────────────────────────

describe("buildReportCsv — formatting invariants", () => {
  it("every value on every row is double-quoted", () => {
    const csv = buildReportCsv(REPORT, WINDOW);
    for (const line of csv.split("\n")) {
      for (const cell of line.split(",")) {
        expect(cell.startsWith('"')).toBe(true);
        expect(cell.endsWith('"')).toBe(true);
      }
    }
  });

  it("rows are joined with newlines and there is no trailing newline", () => {
    const csv = buildReportCsv(REPORT, WINDOW);
    expect(csv.endsWith("\n")).toBe(false);
    expect(csv.split("\n")).toHaveLength(4);
  });

  it("an empty report still emits the header and a zeroed TOTAL row", () => {
    const empty: ReportReadModel = {
      technicians: [],
      totals: {
        technicianCount: 0,
        transactionCount: 0,
        serviceCount: 0,
        grossCents: 0,
        cardFeeCents: 0,
        supplyCents: 0,
        totalDeductionsCents: 0,
        commissionableCents: 0,
        cardTipsCents: 0,
      },
      isEmpty: true,
    };
    const lines = buildReportCsv(empty, WINDOW).split("\n");
    expect(lines).toHaveLength(2); // header + TOTAL
    expect(fields(lines[0])[0]).toBe("Tech");
    const total = fields(lines[1]);
    expect(total[0]).toBe("TOTAL");
    expect(total[3]).toBe("0.00");
  });
});
