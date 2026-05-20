// ReportEmptyState — the empty-period state for the Report page (US1, FR-029).
//
// Presentational Server Component. Rendered in place of the summary strip and
// body when `report.isEmpty` — the resolved reporting window holds no paid
// tickets. A calm, single-sentence state, not an error or a blank table.
//
// Every value traces to a `styles/report.css` / `styles/tokens.css` token
// (Constitution Principle I).

import { FileBarChart } from "lucide-react";

export function ReportEmptyState() {
  return (
    <div className="dr-empty" data-slot="empty-state">
      <div className="dr-empty-icon">
        <FileBarChart size={24} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="dr-empty-ttl">No paid sales in this period</div>
      <div className="dr-empty-sub">
        Earnings and deductions will show up here once your salon rings up a sale in this period.
      </div>
    </div>
  );
}
