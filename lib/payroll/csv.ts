// lib/payroll/csv.ts
// -----------------------------------------------------------------------------
// Pure CSV builder behind the Payroll page's Export action (US1).
// `buildPayrollCsv` turns a `PayrollLedgerModel` into a CSV string — a header
// row, one row per technician, and a reconciling `TOTAL` row.
//
// Pure: no I/O, no `Date.now()`, no DOM. The browser-side download (anchor
// click) lives in `payroll-export.client.tsx`; keeping the string-building
// here makes it unit-testable and mirrors `lib/report/csv.ts`.

import type { PayrollLedgerModel } from "@/lib/payroll/aggregate";

// The header row — the ledger's eight money/count columns plus name + state.
const HEADER: readonly string[] = [
  "Employee",
  "Role",
  "Tickets",
  "Income",
  "After split",
  "Card tips",
  "Tips after split",
  "Check",
  "Cash",
  "State",
];

// Cents → two-decimal dollar string, e.g. `300 → "3.00"`. The page formats the
// same cents to whole dollars; the CSV keeps the cents precision.
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Every CSV value is double-quoted. A literal double quote is escaped CSV-style
// by doubling it.
function quote(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Joins one row's cells into a quoted CSV line.
function row(cells: readonly (string | number)[]): string {
  return cells.map(quote).join(",");
}

// Human-readable label for a ledger-row state.
const STATE_LABEL: Record<PayrollLedgerModel["rows"][number]["state"], string> = {
  pending: "Pending",
  paid: "Paid",
  no_work: "No work",
  unpaid_closed: "Unpaid",
};

/**
 * Builds the Payroll-page export CSV for `model`.
 *
 *  - a header row (the ten columns above);
 *  - one row per ledger row (already sorted `displayName` asc) — money columns
 *    are two-decimal dollars from the `*Cents` fields, `State` is the human
 *    label;
 *  - a trailing `TOTAL` row built from `model.totals` (blank Role / State).
 *
 * Rows are joined with `\n`, no trailing newline.
 */
export function buildPayrollCsv(model: PayrollLedgerModel): string {
  const lines: string[] = [row(HEADER)];

  for (const r of model.rows) {
    lines.push(
      row([
        r.displayName,
        r.role,
        r.ticketCount,
        dollars(r.commissionableCents),
        dollars(r.incomeAfterSplitCents),
        dollars(r.cardTipsCents),
        dollars(r.tipsAfterSplitCents),
        dollars(r.checkPortionCents),
        dollars(r.cashPaymentCents),
        STATE_LABEL[r.state],
      ])
    );
  }

  const t = model.totals;
  lines.push(
    row([
      "TOTAL",
      "", // Role is blank on the totals row.
      t.ticketCount,
      dollars(t.commissionableCents),
      dollars(t.incomeAfterSplitCents),
      dollars(t.cardTipsCents),
      dollars(t.tipsAfterSplitCents),
      dollars(t.checkPortionCents),
      dollars(t.cashPaymentCents),
      "", // State is blank on the totals row.
    ])
  );

  return lines.join("\n");
}
