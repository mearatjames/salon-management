// ReportSummary — the 3-stat summary strip at the top of the Report page body
// (US1, FR-022).
//
// Presentational Server Component. Renders the `.dr-summary` strip from
// `ReportTotals`: Gross Revenue (with the transaction + service counts),
// Total Deductions (negative, with the itemised Card / Supply split), and
// Card Tips.
//
// Adapted from `design-system/prototypes/transaction/DayReport.jsx`
// (the `variant='original'` `.dr-summary` block). Every value traces to a
// `styles/report.css` / `styles/tokens.css` token (Constitution Principle I).

import { formatCurrency } from "@/lib/dashboard/format";
import type { ReportTotals } from "@/lib/report/aggregate";

export type ReportSummaryProps = {
  totals: ReportTotals;
};

export function ReportSummary({ totals }: ReportSummaryProps) {
  return (
    <div className="dr-summary" data-slot="report-summary">
      <div className="dr-stat">
        <div className="dr-stat-l">Gross revenue</div>
        <div className="dr-stat-v">{formatCurrency(totals.grossCents / 100)}</div>
        <div className="dr-stat-s">
          {totals.transactionCount} transactions · {totals.serviceCount} services
          {totals.discountsCents > 0 ? (
            <>
              {" · "}
              <span data-slot="discounts-given">
                {formatCurrency(totals.discountsCents / 100)} discounted
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="dr-stat">
        <div className="dr-stat-l">Total deductions</div>
        <div className="dr-stat-v neg">−{formatCurrency(totals.totalDeductionsCents / 100)}</div>
        <div className="dr-stat-s">
          Card {formatCurrency(totals.cardFeeCents / 100)} · Supply{" "}
          {formatCurrency(totals.supplyCents / 100)}
        </div>
      </div>
      <div className="dr-stat last">
        <div className="dr-stat-l">Card tips</div>
        <div className="dr-stat-v tip">{formatCurrency(totals.cardTipsCents / 100)}</div>
        <div className="dr-stat-s">Cash tips kept by the tech, not reported</div>
      </div>
    </div>
  );
}
