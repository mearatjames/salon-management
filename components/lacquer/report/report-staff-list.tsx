// ReportStaffList — the left panel of the Report page body (US1).
//
// Presentational component. Renders an "All Staff" button followed by one
// card per `TechnicianReport` — avatar, name, service count, gross / deduct
// / net, and card tips. The Deduct line collapses when the tech's
// `totalDeductionsCents === 0` so a zero-deduction card stays compact.
//
// Props `selectedTechId` / `onSelect` are exposed for US2's drill-down: when
// `onSelect` is absent (US1) the "All Staff" button and the tech cards render
// as inert `<div>`s — no hover affordance, no click handler. US2 supplies
// `onSelect` from the client island to make them interactive.
//
// Adapted from `design-system/prototypes/transaction/DayReport.jsx`
// (the left `.dr-left` panel, `variant='original'`). Every value traces to a
// `styles/report.css` / `styles/tokens.css` token (Constitution Principle I).

import { formatCurrency } from "@/lib/dashboard/format";
import type { ReportTotals, TechnicianReport } from "@/lib/report/aggregate";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";

export type ReportStaffListProps = {
  technicians: readonly TechnicianReport[];
  totals: ReportTotals;
  /** The selected technician's id, or `null` for the All-Staff overview. */
  selectedTechId?: string | null;
  /** When supplied, the cards become interactive (US2). `null` = All Staff. */
  onSelect?: (techId: string | null) => void;
};

export function ReportStaffList({
  technicians,
  totals,
  selectedTechId = null,
  onSelect,
}: ReportStaffListProps) {
  const interactive = typeof onSelect === "function";

  return (
    <div className="dr-left">
      {/* "All Staff" button — selected when no technician is drilled into. */}
      {interactive ? (
        <button
          type="button"
          className={`dr-allstaff-btn${selectedTechId === null ? " on" : ""}`}
          onClick={() => onSelect?.(null)}
          data-slot="all-staff"
          aria-pressed={selectedTechId === null}
        >
          <div style={{ fontWeight: 700, fontSize: "var(--text-sm)" }}>All staff</div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--muted-foreground)",
              marginTop: 1,
            }}
          >
            {totals.technicianCount} techs · {totals.transactionCount} transactions
          </div>
        </button>
      ) : (
        <div className="dr-allstaff-btn on" data-slot="all-staff">
          <div style={{ fontWeight: 700, fontSize: "var(--text-sm)" }}>All staff</div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--muted-foreground)",
              marginTop: 1,
            }}
          >
            {totals.technicianCount} techs · {totals.transactionCount} transactions
          </div>
        </div>
      )}

      <div className="dr-tech-list">
        {technicians.map((tech) => {
          const hasDeductions = tech.totalDeductionsCents > 0;
          const body = (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <InitialsAvatar name={tech.displayName} colorToken={tech.colorToken} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>
                      {tech.displayName}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
                    {tech.serviceCount} services
                  </div>
                </div>
              </div>

              <div className="dr-card-nums">
                <div className="dr-card-num">
                  <span className="dr-cn-l">Gross</span>
                  <span className="dr-cn-v">{formatCurrency(tech.grossCents / 100)}</span>
                </div>
                {hasDeductions ? (
                  <div className="dr-card-num">
                    <span className="dr-cn-l">Deduct</span>
                    <span className="dr-cn-v neg">
                      −{formatCurrency(tech.totalDeductionsCents / 100)}
                    </span>
                  </div>
                ) : null}
                <div className="dr-card-num">
                  <span className="dr-cn-l">Net</span>
                  <span className="dr-cn-v bold">
                    {formatCurrency(tech.commissionableCents / 100)}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "var(--space-1)",
                  paddingTop: "var(--space-1)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--muted-foreground)",
                    textTransform: "uppercase",
                    letterSpacing: "var(--tracking-wide)",
                    fontWeight: 600,
                  }}
                >
                  Card tips
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: 600,
                    color: "var(--success)",
                  }}
                >
                  {formatCurrency(tech.cardTipsCents / 100)}
                </span>
              </div>
            </>
          );

          return interactive ? (
            <button
              key={tech.staffId}
              type="button"
              className={`dr-tech-card${selectedTechId === tech.staffId ? " on" : ""}`}
              onClick={() => onSelect?.(tech.staffId)}
              data-tech-id={tech.staffId}
              aria-pressed={selectedTechId === tech.staffId}
            >
              {body}
            </button>
          ) : (
            <div
              key={tech.staffId}
              className="dr-tech-card"
              data-tech-id={tech.staffId}
              style={{ cursor: "default" }}
            >
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
