// PayrollHeader — the Payroll page header band (US1).
//
// Eyebrow ("Payroll · 1st half cycle"), the period label as the H1, and a
// subtitle with the pay date, cash remaining, and the paid/eligible progress.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (the `.pr-header`
// `.pr-header-titles` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I). Currency via the shared
// `formatCurrency` helper; counts via `formatCount`.

import { formatCount, formatCurrency } from "@/lib/dashboard/format";
import type { PayrollLedgerModel } from "@/lib/payroll/aggregate";
import { formatPayDate, formatPeriodEyebrow } from "@/lib/payroll/format";

export type PayrollHeaderProps = {
  model: PayrollLedgerModel;
};

export function PayrollHeader({ model }: PayrollHeaderProps) {
  const { period } = model;

  return (
    <div className="pr-header-titles" data-slot="payroll-header">
      <div className="pr-eyebrow">{formatPeriodEyebrow(period)}</div>
      <h1 className="pr-h1">{period.label}</h1>
      <div className="pr-h1-sub">
        Pay date <b>{formatPayDate(period)}</b> ·{" "}
        <b className="tnum">{formatCurrency(model.cashRemainingCents / 100)}</b> in cash remaining ·{" "}
        <span className="tnum">
          {formatCount(model.paidCount)}/{formatCount(model.eligibleCount)}
        </span>{" "}
        techs paid
      </div>
    </div>
  );
}
