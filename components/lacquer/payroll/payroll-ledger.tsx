// PayrollLedger — the full-width per-tech payroll table on the Payroll page
// (US1). One row per active tech — income, after-split, card tips,
// tips-after-split, check portion, cash payment, and a state pill — plus a
// footer totals row that reconciles every money column.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (the `.pp-full-table`
// block). Each row routes to that tech's detail screen (US2) — the name cell
// carries a stretched `<Link>` that overlays the whole row, preserving the
// period `?offset=&filter=` params. Every value traces to a `styles/payroll.css`
// / `styles/tokens.css` token (Constitution Principle I). Currency via the
// shared `formatCurrency`; percentages via `formatPercent`.

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatCount, formatCurrency, formatPercent } from "@/lib/dashboard/format";
import type { PayrollLedgerModel, PayrollLedgerRow } from "@/lib/payroll/aggregate";
import { TechAvatar } from "@/components/lacquer/tech-avatar";

export type PayrollLedgerProps = {
  model: PayrollLedgerModel;
  /** The rows already narrowed by the active filter (All / To pay / Paid). */
  rows: readonly PayrollLedgerRow[];
  /** The `?offset=&filter=` suffix each row link carries into the detail route. */
  periodQuery: string;
};

// The state pill — one per ledger-row state.
function StatePill({ row }: { row: PayrollLedgerRow }) {
  if (row.state === "no_work") {
    return (
      <span className="pl-state pl-state-skip" data-slot="state-pill" data-state="no_work">
        <span className="dot" /> No work
      </span>
    );
  }
  if (row.state === "paid") {
    const method = row.payout?.method;
    const methodLabel = method ? ` · ${method[0].toUpperCase()}${method.slice(1)}` : "";
    return (
      <span className="pl-state pl-state-paid" data-slot="state-pill" data-state="paid">
        <span className="dot" /> Paid{methodLabel}
      </span>
    );
  }
  if (row.state === "unpaid_closed") {
    return (
      <span className="pl-state pl-state-unpaid" data-slot="state-pill" data-state="unpaid_closed">
        <span className="dot" /> Unpaid
      </span>
    );
  }
  return (
    <span className="pl-state pl-state-pending" data-slot="state-pill" data-state="pending">
      <span className="dot" /> Pending
    </span>
  );
}

export function PayrollLedger({ model, rows, periodQuery }: PayrollLedgerProps) {
  const { totals } = model;

  return (
    <div className="pl-table-wrap" data-slot="payroll-ledger">
      <table className="pl-table pp-full-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th className="num">Tickets</th>
            <th className="num">Income</th>
            <th className="num">After split</th>
            <th className="num">Card tips</th>
            <th className="num">After split</th>
            <th className="num">Check</th>
            <th className="num">Cash</th>
            <th className="center">State</th>
            <th className="pp-chev-th" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.staffId}
              className="pl-row-link"
              data-slot="ledger-row"
              data-tech-id={row.staffId}
            >
              <td>
                <div className="pl-person">
                  <Link
                    href={`/payroll/${row.staffId}${periodQuery}`}
                    className="pl-row-stretch"
                    aria-label={`Open ${row.displayName}'s payroll detail`}
                    data-slot="ledger-row-link"
                  />
                  <TechAvatar
                    tech={{
                      id: row.staffId,
                      displayName: row.displayName,
                      colorToken: row.colorToken,
                    }}
                    size={30}
                  />
                  <div className="pl-person-text">
                    <div className="pl-person-name">{row.displayName}</div>
                    <div className="pl-person-rate">
                      {row.role} · {formatPercent(row.serviceCommissionPct)} svc /{" "}
                      {formatPercent(row.tipSplitPct)} tips
                    </div>
                  </div>
                </div>
              </td>
              <td className="num muted tnum">
                {row.ticketCount > 0 ? formatCount(row.ticketCount) : "—"}
              </td>
              <td className="num muted">{formatCurrency(row.commissionableCents / 100)}</td>
              <td className="num">{formatCurrency(row.incomeAfterSplitCents / 100)}</td>
              <td className="num tip">{formatCurrency(row.cardTipsCents / 100)}</td>
              <td className="num tip">{formatCurrency(row.tipsAfterSplitCents / 100)}</td>
              <td className="num muted">{formatCurrency(row.checkPortionCents / 100)}</td>
              <td className="num cash">{formatCurrency(row.cashPaymentCents / 100)}</td>
              <td className="center">
                <StatePill row={row} />
              </td>
              <td className="pp-chev-td">
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-slot="totals-row">
            <td className="muted">{formatCount(totals.technicianCount)} employees</td>
            <td className="num">{formatCount(totals.ticketCount)}</td>
            <td className="num">{formatCurrency(totals.commissionableCents / 100)}</td>
            <td className="num">{formatCurrency(totals.incomeAfterSplitCents / 100)}</td>
            <td className="num">{formatCurrency(totals.cardTipsCents / 100)}</td>
            <td className="num">{formatCurrency(totals.tipsAfterSplitCents / 100)}</td>
            <td className="num">{formatCurrency(totals.checkPortionCents / 100)}</td>
            <td className="num cash">{formatCurrency(totals.cashPaymentCents / 100)}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
