// lib/report/csv.ts
// -----------------------------------------------------------------------------
// Pure CSV builder behind the Report page's Export action (contract C5,
// FR-028). `buildReportCsv` turns a `ReportReadModel` + its `ReportWindow`
// into a CSV string — one row per technician plus a reconciling `TOTAL` row.
//
// Pure: no I/O, no `Date.now()`, no DOM. The browser-side download (anchor
// click) lives in `report-actions.client.tsx`; keeping the string-building
// here makes it unit-testable (Constitution Principle IV — the constitutional
// test-first piece of User Story 5).
//
// See data-model.md and contracts/report-read-model.md § C5.

import type { ReportReadModel } from "@/lib/report/aggregate";
import type { ReportWindow } from "@/lib/report/window";

// The header row, verbatim per contract C5. The column order differs from the
// `TechnicianReport` field order — the row builders below map carefully.
const HEADER: readonly string[] = [
  "Tech",
  "Exempt",
  "Services",
  "Gross",
  "Card Fee",
  "Supply",
  "Total Deductions",
  "Commissionable",
  "Card Tips",
];

// Cents → two-decimal dollar string, e.g. `300 → "3.00"`, `13000 → "130.00"`.
// Matches the on-screen overview's underlying values (the page formats the
// same cents to whole dollars; the CSV keeps the cents precision).
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Every CSV value is double-quoted (contract C5). A literal double quote in a
// value is escaped CSV-style by doubling it.
function quote(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Joins one row's already-stringified cells into a quoted CSV line.
function row(cells: readonly (string | number)[]): string {
  return cells.map(quote).join(",");
}

/**
 * Builds the Report-page export CSV for `report` over `window`.
 *
 *  - a header row (the nine contract-C5 columns);
 *  - one row per `TechnicianReport` (already sorted `displayName` asc) —
 *    `Exempt` is `Yes`/`No` from `hasNoDeductions`, money columns are
 *    two-decimal dollars derived from the `*Cents` fields;
 *  - a trailing `TOTAL` row built from `ReportTotals` (blank `Exempt`).
 *
 * Every value is double-quoted; rows are joined with `\n` (no trailing
 * newline). `window` is accepted for parity with the client island's
 * filename derivation and future range-stamping; the body itself is fully
 * determined by `report`.
 */
export function buildReportCsv(report: ReportReadModel, _window: ReportWindow): string {
  const lines: string[] = [row(HEADER)];

  for (const tech of report.technicians) {
    lines.push(
      row([
        tech.displayName,
        tech.hasNoDeductions ? "Yes" : "No",
        tech.serviceCount,
        dollars(tech.grossCents),
        dollars(tech.cardFeeCents),
        dollars(tech.supplyCents),
        dollars(tech.totalDeductionsCents),
        dollars(tech.commissionableCents),
        dollars(tech.cardTipsCents),
      ])
    );
  }

  const t = report.totals;
  lines.push(
    row([
      "TOTAL",
      "", // Exempt is blank on the totals row.
      t.serviceCount,
      dollars(t.grossCents),
      dollars(t.cardFeeCents),
      dollars(t.supplyCents),
      dollars(t.totalDeductionsCents),
      dollars(t.commissionableCents),
      dollars(t.cardTipsCents),
    ])
  );

  return lines.join("\n");
}
