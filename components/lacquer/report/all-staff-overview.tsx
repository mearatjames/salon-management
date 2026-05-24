// AllStaffOverview — the right-panel "All Staff" overview table for the Report
// page (US1, FR-021 … FR-023).
//
// Presentational Server Component. Renders one `.dr-table` row per
// `TechnicianReport` — avatar + name, services count, gross, card-fee
// deduction, supply deduction, commissionable amount, card tips — plus a
// `tfoot` totals row (`data-slot="totals-row"`) whose every value is the sum
// of the technician rows, and the deduction legend.
//
// Adapted from `design-system/prototypes/transaction/DayReport.jsx`
// (`DrAllStaffView`, the `layout='page'` variant). Every value traces to a
// `styles/report.css` / `styles/tokens.css` token (Constitution Principle I).
// Currency is the shared `formatCurrency` helper (whole-dollar, app-wide).

import { Info } from "lucide-react";

import { formatCurrency } from "@/lib/dashboard/format";
import type { ReportTotals, TechnicianReport } from "@/lib/report/aggregate";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";

export type AllStaffOverviewProps = {
  technicians: readonly TechnicianReport[];
  totals: ReportTotals;
};

// A deduction cell: an em-dash when the deduction is zero, otherwise the
// negative dollar amount.
function deductionCell(cents: number): string {
  return cents === 0 ? "—" : `−${formatCurrency(cents / 100)}`;
}

export function AllStaffOverview({ technicians, totals }: AllStaffOverviewProps) {
  return (
    <div className="dr-detail" data-slot="all-staff-overview">
      <div className="dr-detail-head">
        <div>
          <div className="dr-scope-ttl">All staff — overview</div>
          <div className="dr-scope-sub">
            {totals.technicianCount} technicians · {totals.transactionCount} transactions ·{" "}
            {totals.serviceCount} services
          </div>
        </div>
        <div className="dr-head-totals">
          <div className="dr-htotal">
            <div className="dr-htotal-l">Gross</div>
            <div className="dr-htotal-v">{formatCurrency(totals.grossCents / 100)}</div>
          </div>
          <div className="dr-htotal">
            <div className="dr-htotal-l">Deducted</div>
            <div className="dr-htotal-v neg">
              −{formatCurrency(totals.totalDeductionsCents / 100)}
            </div>
          </div>
          <div className="dr-htotal">
            <div className="dr-htotal-l">Commissionable</div>
            <div className="dr-htotal-v pos">
              {formatCurrency(totals.commissionableCents / 100)}
            </div>
          </div>
          <div className="dr-htotal">
            <div className="dr-htotal-l">Card tips</div>
            <div className="dr-htotal-v tip">{formatCurrency(totals.cardTipsCents / 100)}</div>
          </div>
        </div>
      </div>

      <div className="dr-table-wrap">
        <table className="dr-table">
          <thead>
            <tr>
              <th>Tech</th>
              <th className="num">Svcs</th>
              <th className="num">Gross</th>
              <th className="num ded">Card fee</th>
              <th className="num ded">Supply</th>
              <th className="num">Commissionable</th>
              <th className="num">Card tips</th>
            </tr>
          </thead>
          <tbody>
            {technicians.map((tech) => (
              <tr key={tech.staffId} className="dr-staff-row" data-tech-id={tech.staffId}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <InitialsAvatar
                      name={tech.displayName}
                      colorToken={tech.colorToken}
                      size={26}
                    />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>
                        {tech.displayName}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="num">{tech.serviceCount}</td>
                <td className="num">{formatCurrency(tech.grossCents / 100)}</td>
                <td className={`num dc${tech.cardFeeCents > 0 ? " on" : ""}`}>
                  {deductionCell(tech.cardFeeCents)}
                </td>
                <td className={`num dc${tech.supplyCents > 0 ? " on" : ""}`}>
                  {deductionCell(tech.supplyCents)}
                </td>
                <td className="num net-cell">{formatCurrency(tech.commissionableCents / 100)}</td>
                <td className="num tip-cell">{formatCurrency(tech.cardTipsCents / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="dr-foot-row" data-slot="totals-row">
              <td>Total</td>
              <td className="num">{totals.serviceCount}</td>
              <td className="num">{formatCurrency(totals.grossCents / 100)}</td>
              <td className="num dc on">{deductionCell(totals.cardFeeCents)}</td>
              <td className="num dc on">{deductionCell(totals.supplyCents)}</td>
              <td className="num net-cell">{formatCurrency(totals.commissionableCents / 100)}</td>
              <td className="num tip-cell">{formatCurrency(totals.cardTipsCents / 100)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Deduction legend — FR-021 … FR-023. */}
      <div className="dr-legend" data-slot="report-legend">
        <Info size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>
          <strong>Card fee</strong> applies per service when a ticket is paid by card or gift card.
        </span>
        <span className="dr-legend-sep">·</span>
        <span>
          <strong>Supply</strong> covers the per-service supply cost a technician owes on the
          services they performed.
        </span>
      </div>
    </div>
  );
}
