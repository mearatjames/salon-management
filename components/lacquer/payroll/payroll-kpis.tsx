// PayrollKpis — the 4-tile KPI band on the Payroll page (US1).
//
// Gross service income (with the ticket count), card tips collected, owed to
// techs (with the check / cash split), and the paid-progress count.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (the `Kpis` component).
// Every value traces to a `styles/payroll.css` / `styles/tokens.css` token
// (Constitution Principle I). Currency via the shared `formatCurrency` helper.

import { formatCount, formatCurrency } from "@/lib/dashboard/format";
import type { PayrollLedgerModel } from "@/lib/payroll/aggregate";

export type PayrollKpisProps = {
  model: PayrollLedgerModel;
};

// A signed adjustment label, e.g. "+$12" / "−$5"; "$0" when nothing yet.
function signedCurrency(cents: number): string {
  if (cents === 0) return formatCurrency(0);
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${formatCurrency(Math.abs(cents) / 100)}`;
}

// A net cash-to-pay label that carries its own minus sign when negative.
function netCurrency(cents: number): string {
  if (cents < 0) return `−${formatCurrency(Math.abs(cents) / 100)}`;
  return formatCurrency(cents / 100);
}

export function PayrollKpis({ model }: PayrollKpisProps) {
  const { totals } = model;
  // Owed to techs = the cash payout + the check portion (the full earned sum).
  const owedCents = totals.cashPaymentCents + totals.checkPortionCents;

  return (
    <div className="pr-kpis" data-slot="payroll-kpis">
      <div className="pr-kpi">
        <div className="pr-kpi-label">Gross service income</div>
        <div className="pr-kpi-value">{formatCurrency(totals.grossServiceIncomeCents / 100)}</div>
        <div className="pr-kpi-sub">
          <b>{formatCount(totals.ticketCount)}</b> tickets across the period
        </div>
      </div>

      <div className="pr-kpi">
        <div className="pr-kpi-label">Card tips collected</div>
        <div className="pr-kpi-value tip">{formatCurrency(totals.cardTipsCents / 100)}</div>
        <div className="pr-kpi-sub">Cash tips not recorded</div>
      </div>

      <div className="pr-kpi">
        <div className="pr-kpi-label">Owed to techs</div>
        <div className="pr-kpi-value cash">{formatCurrency(owedCents / 100)}</div>
        <div className="pr-kpi-sub">
          <b>{formatCurrency(totals.checkPortionCents / 100)}</b> check ·{" "}
          <b>{formatCurrency(totals.cashPaymentCents / 100)}</b> cash
        </div>
      </div>

      <div className="pr-kpi" data-slot="kpi-adjustments">
        <div className="pr-kpi-label">Adjustments</div>
        <div className="pr-kpi-value">{signedCurrency(totals.adjustmentsCents)}</div>
        <div className="pr-kpi-sub">
          Cash to pay <b>{netCurrency(model.cashRemainingCents)}</b>
        </div>
      </div>

      <div className="pr-kpi">
        <div className="pr-kpi-label">Progress</div>
        <div className="pr-kpi-value">
          {formatCount(model.paidCount)}
          <span className="pr-kpi-frac">/{formatCount(model.eligibleCount)}</span>
        </div>
        <div className="pr-kpi-sub">Techs marked paid</div>
      </div>
    </div>
  );
}
