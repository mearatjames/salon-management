// TechDetail — the right-panel per-technician transaction view for the Report
// page (US2, FR-024 … FR-025).
//
// Presentational component (no `"use client"` — research R11). Renders one
// `.dr-table` row per `ReportTransaction` (newest-first, already sorted by
// `projectReport`): time, client, services, gross, card-fee deduction, supply
// deduction, net, and a payment-method pill — plus a header summary (gross,
// deducted, commissionable, card tips) and a per-technician totals row.
//
// For an exempt technician (`hasNoDeductions === true`, FR-025) the two
// deduction columns (card fee + supply) are omitted; each transaction's net
// then equals its gross. The header drops the "Deducted" figure too.
//
// A transaction with at least one deduction or a card tip (`isExpandable`)
// renders as a clickable row carrying `data-expandable`; clicking it toggles an
// itemised breakdown row (each deduction line, a "Total deducted" subtotal,
// and — when there is a card tip — that tip with its percentage, FR-026). A
// non-expandable row is inert: no `data-expandable`, no click handler, no
// hover affordance. The expand state lives in the `report-view.client.tsx`
// island and arrives here as `expandedTxIds` / `onToggleTx`.
//
// Adapted from `design-system/prototypes/transaction/DayReport.jsx`
// (`DrTechDetailView`, the `layout='page'` variant — its `dr-tx-row` / caret /
// `dr-expand-*` breakdown markup). Every value traces to a `styles/report.css`
// / `styles/tokens.css` token (Constitution Principle I). Currency is the
// shared `formatCurrency` helper (whole-dollar, app-wide).

import { ChevronDown } from "lucide-react";

import { formatCurrency } from "@/lib/dashboard/format";
import type { ReportTransaction, TechnicianReport } from "@/lib/report/aggregate";
import { MethodPill } from "@/components/lacquer/method-pill";
import { TechAvatar } from "@/components/lacquer/tech-avatar";

export type TechDetailProps = {
  technician: TechnicianReport;
  /** The expanded transaction ids — the ticket ids whose breakdown is open. */
  expandedTxIds?: ReadonlySet<string>;
  /** Toggles a transaction's expanded state (collapses it when already open). */
  onToggleTx?: (ticketId: string) => void;
};

// A deduction cell: an em-dash when the deduction is zero, otherwise the
// negative dollar amount.
function deductionCell(cents: number): string {
  return cents === 0 ? "—" : `−${formatCurrency(cents / 100)}`;
}

// A negative dollar amount for a deduction line / subtotal.
function negCurrency(cents: number): string {
  return `−${formatCurrency(cents / 100)}`;
}

// One transaction: its main row, plus — when expanded — an itemised deduction
// breakdown row. An expandable transaction (`tx.isExpandable`) carries
// `data-expandable` and toggles on click; a non-expandable one is inert.
function TransactionRows({
  tx,
  showDeductions,
  isExpanded,
  columnCount,
  onToggle,
}: {
  tx: ReportTransaction;
  showDeductions: boolean;
  isExpanded: boolean;
  columnCount: number;
  onToggle?: (ticketId: string) => void;
}) {
  const services = tx.serviceNames.join(", ");
  const totalDeductionCents = tx.cardFeeCents + tx.supplyCents;

  return (
    <>
      <tr
        className={`dr-tx-row${tx.isExpandable ? " click" : ""}${isExpanded ? " exp" : ""}`}
        data-slot="tx-row"
        data-tx-id={tx.ticketId}
        {...(tx.isExpandable ? { "data-expandable": "" } : {})}
        onClick={tx.isExpandable && onToggle ? () => onToggle(tx.ticketId) : undefined}
      >
        <td className="dr-time">{tx.time}</td>
        <td className="dr-client">{tx.client}</td>
        <td className="dr-svcs" title={services}>
          {tx.isExpandable ? (
            <span className={`dr-expand-caret${isExpanded ? " open" : ""}`} aria-hidden="true">
              <ChevronDown size={16} strokeWidth={1.5} />
            </span>
          ) : null}
          {services}
        </td>
        <td className="num">{formatCurrency(tx.grossCents / 100)}</td>
        {showDeductions ? (
          <>
            <td className={`num dc${tx.cardFeeCents > 0 ? " on" : ""}`}>
              {deductionCell(tx.cardFeeCents)}
            </td>
            <td className={`num dc${tx.supplyCents > 0 ? " on" : ""}`}>
              {deductionCell(tx.supplyCents)}
            </td>
          </>
        ) : null}
        <td className="num net-cell">{formatCurrency(tx.netCents / 100)}</td>
        <td>
          <MethodPill method={tx.method} />
        </td>
      </tr>

      {tx.isExpandable && isExpanded ? (
        <tr className="dr-expand-row" data-slot="tx-breakdown" data-tx-id={tx.ticketId}>
          <td colSpan={columnCount}>
            <div className="dr-expand-inner">
              {tx.deductionLines.length > 0 ? (
                <div className="dr-expand-sec">
                  <div className="dr-expand-ttl">Deduction detail</div>
                  {tx.deductionLines.map((line, idx) => (
                    <div
                      key={`${line.type}-${idx}`}
                      className="dr-expand-line"
                      data-slot="breakdown-line"
                    >
                      <span>
                        <span className="dr-expand-type">
                          {line.type === "card" ? "Card fee" : "Supply"}
                        </span>
                        <span className="dr-expand-name"> — {line.serviceName}</span>
                      </span>
                      <span className="dr-expand-ded num">{negCurrency(line.amountCents)}</span>
                    </div>
                  ))}
                  <div className="dr-expand-subtotal" data-slot="breakdown-total">
                    <span>Total deducted</span>
                    <span className="dr-expand-ded num">{negCurrency(totalDeductionCents)}</span>
                  </div>
                </div>
              ) : null}
              {tx.cardTipCents > 0 ? (
                <div className="dr-expand-sec">
                  <div className="dr-expand-ttl">Card tip received</div>
                  <div className="dr-expand-line" data-slot="breakdown-tip">
                    <span className="dr-expand-name">{tx.tipPct ?? 0}% — paid out to tech</span>
                    <span className="dr-htotal-v tip num" style={{ fontSize: "var(--text-xs)" }}>
                      {formatCurrency(tx.cardTipCents / 100)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TechDetail({ technician, expandedTxIds, onToggleTx }: TechDetailProps) {
  const showDeductions = !technician.hasNoDeductions;
  // The transaction table's column count — the expanded breakdown row spans it.
  // Time, Client, Services, Gross, Net, Pay = 6; plus Card fee + Supply when
  // the technician is not exempt.
  const columnCount = showDeductions ? 8 : 6;

  return (
    <div className="dr-detail" data-slot="tech-detail" data-tech-id={technician.staffId}>
      <div className="dr-detail-head">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <TechAvatar
            tech={{
              id: technician.staffId,
              displayName: technician.displayName,
              colorToken: technician.colorToken,
            }}
            size={38}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "var(--text-md)",
                  letterSpacing: "var(--tracking-tight)",
                }}
              >
                {technician.displayName}
              </span>
              {technician.hasNoDeductions ? (
                <span className="dr-exempt-badge" data-slot="exempt-tag">
                  No deductions
                </span>
              ) : null}
            </div>
            <div className="dr-scope-sub">
              {technician.transactionCount} transactions · {technician.serviceCount} services
            </div>
          </div>
        </div>
        <div className="dr-head-totals">
          <div className="dr-htotal">
            <div className="dr-htotal-l">Gross</div>
            <div className="dr-htotal-v">{formatCurrency(technician.grossCents / 100)}</div>
          </div>
          {showDeductions ? (
            <div className="dr-htotal">
              <div className="dr-htotal-l">Deducted</div>
              <div className="dr-htotal-v neg">
                −{formatCurrency(technician.totalDeductionsCents / 100)}
              </div>
            </div>
          ) : null}
          <div className="dr-htotal">
            <div className="dr-htotal-l">Commissionable</div>
            <div className="dr-htotal-v pos">
              {formatCurrency(technician.commissionableCents / 100)}
            </div>
          </div>
          <div className="dr-htotal">
            <div className="dr-htotal-l">Card tips</div>
            <div className="dr-htotal-v tip">{formatCurrency(technician.cardTipsCents / 100)}</div>
          </div>
        </div>
      </div>

      <div className="dr-table-wrap">
        <table className="dr-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Services</th>
              <th className="num">Gross</th>
              {showDeductions ? (
                <>
                  <th className="num ded">Card fee</th>
                  <th className="num ded">Supply</th>
                </>
              ) : null}
              <th className="num">Net</th>
              <th>Pay</th>
            </tr>
          </thead>
          <tbody>
            {technician.transactions.map((tx: ReportTransaction) => {
              const isExpanded = tx.isExpandable && (expandedTxIds?.has(tx.ticketId) ?? false);
              return (
                <TransactionRows
                  key={tx.ticketId}
                  tx={tx}
                  showDeductions={showDeductions}
                  isExpanded={isExpanded}
                  columnCount={columnCount}
                  onToggle={onToggleTx}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr className="dr-foot-row" data-slot="totals-row">
              <td colSpan={3}>Total · {technician.transactionCount} transactions</td>
              <td className="num">{formatCurrency(technician.grossCents / 100)}</td>
              {showDeductions ? (
                <>
                  <td className="num dc on">{deductionCell(technician.cardFeeCents)}</td>
                  <td className="num dc on">{deductionCell(technician.supplyCents)}</td>
                </>
              ) : null}
              <td className="num net-cell">
                {formatCurrency(technician.commissionableCents / 100)}
              </td>
              <td className="num tip-cell">{formatCurrency(technician.cardTipsCents / 100)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
