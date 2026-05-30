// TechBreakdown — the earnings-breakdown card on the tech-detail screen (US2).
//
// A small ledger that walks the cash-payment math row by row: service income
// after the commission split, card tips after the tip split, the total earned,
// the check portion subtracted, and the resulting cash payment. A `no_work`
// tech shows a "nothing owed" line.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (`PulseDetailScreen`'s
// `.pl-breakdown` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I). Currency via the shared
// `formatCurrency`; percentages via `formatPercent`.

import { formatCurrency, formatPercent } from "@/lib/dashboard/format";
import type { PayrollLedgerRow } from "@/lib/payroll/aggregate";

export type TechBreakdownProps = {
  row: PayrollLedgerRow;
};

// A net-payout label that carries its own minus sign when negative.
function netCurrency(cents: number): string {
  if (cents < 0) return `−${formatCurrency(Math.abs(cents) / 100)}`;
  return formatCurrency(cents / 100);
}

export function TechBreakdown({ row }: TechBreakdownProps) {
  const isNoWork = row.state === "no_work";
  const totalEarnedCents = row.incomeAfterSplitCents + row.tipsAfterSplitCents;
  const hasAdjustments = row.adjustments.length > 0;

  return (
    <div className="pp-detail-card" data-slot="tech-breakdown">
      <div className="pl-section-title">Earnings breakdown</div>

      {isNoWork ? (
        <div className="pl-detail-empty" data-slot="breakdown-empty">
          <div>Nothing owed this period.</div>
        </div>
      ) : (
        <div className="pl-breakdown">
          <div className="pl-bd-row">
            <div className="pl-bd-l">
              Service income{" "}
              <span className="rate">
                {formatPercent(row.serviceCommissionPct)} of{" "}
                {formatCurrency(row.commissionableCents / 100)}
              </span>
            </div>
            <div className="pl-bd-r">{formatCurrency(row.incomeAfterSplitCents / 100)}</div>
          </div>
          <div className="pl-bd-row">
            <div className="pl-bd-l">
              Card tips{" "}
              <span className="rate">
                {formatPercent(row.tipSplitPct)} of {formatCurrency(row.cardTipsCents / 100)}
              </span>
            </div>
            <div className="pl-bd-r">{formatCurrency(row.tipsAfterSplitCents / 100)}</div>
          </div>
          <div className="pl-bd-row sub">
            <div className="pl-bd-l">Total earned</div>
            <div className="pl-bd-r">{formatCurrency(totalEarnedCents / 100)}</div>
          </div>
          <div className="pl-bd-row">
            <div className="pl-bd-l">
              Check portion <span className="rate">W-2 wage</span>
            </div>
            <div className="pl-bd-r minus">{formatCurrency(row.checkPortionCents / 100)}</div>
          </div>

          {hasAdjustments ? (
            <>
              <div className="pl-bd-row cash-sub" data-slot="breakdown-cash-sub">
                <div className="pl-bd-l">Cash payment</div>
                <div className="pl-bd-r">{formatCurrency(row.cashPaymentCents / 100)}</div>
              </div>
              {row.adjustments.map((adj) => {
                const isAdd = adj.amountCents >= 0;
                return (
                  <div
                    className="pl-bd-row adj"
                    data-slot="breakdown-adjustment"
                    data-adj-id={adj.id}
                    key={adj.id}
                  >
                    <div className="pl-bd-l">{adj.reason}</div>
                    <div className={`pl-bd-r ${isAdd ? "add" : "deduct"}`}>
                      {isAdd ? "" : "−"}
                      {formatCurrency(Math.abs(adj.amountCents) / 100)}
                    </div>
                  </div>
                );
              })}
              <div className="pl-bd-row total" data-slot="breakdown-net-payout">
                <div className="pl-bd-l">Net payout</div>
                <div className={`pl-bd-r${row.netPayoutCents < 0 ? " negative" : ""}`}>
                  {netCurrency(row.netPayoutCents)}
                </div>
              </div>
            </>
          ) : (
            <div className="pl-bd-row total">
              <div className="pl-bd-l">Cash payment</div>
              <div className="pl-bd-r">{formatCurrency(row.cashPaymentCents / 100)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
