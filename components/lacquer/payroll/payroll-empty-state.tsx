// PayrollEmptyState — the empty-period state for the Payroll page (US1).
//
// Presentational Server Component. Rendered in place of the ledger when the
// resolved pay period holds no completed tickets — a calm, single-sentence
// state, not an error or a blank table.
//
// Every value traces to a `styles/payroll.css` / `styles/tokens.css` token
// (Constitution Principle I).

import { Wallet } from "lucide-react";

export function PayrollEmptyState() {
  return (
    <div className="pr-empty" data-slot="payroll-empty-state">
      <div className="pr-empty-icon">
        <Wallet size={24} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="pr-empty-ttl">No completed sales in this pay period</div>
      <div className="pr-empty-sub">
        Each technician&apos;s earnings, tips, and cash payment will show up here once your salon
        rings up a sale in this period.
      </div>
    </div>
  );
}
