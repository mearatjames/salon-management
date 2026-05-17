import type { Technician, TransactionRow } from "@/lib/dashboard/aggregate";
import { formatCurrency } from "@/lib/dashboard/format";
import { EmptyFeedState } from "@/components/lacquer/empty-feed-state";
import { MethodPill } from "@/components/lacquer/method-pill";
import { TechStack } from "@/components/lacquer/tech-stack";

export type RecentTransactionsFeedProps = {
  rows: readonly TransactionRow[];
  staff: readonly Technician[];
};

// Server component — applies the `.tx-feed` chrome (background / border /
// radius all tokenised via the CSS class). DOM order per row matches the
// grid in `styles/dashboard.css` (`.tx-feed-row` is a 5-col grid):
//   .time | .svc | <TechStack /> | <MethodPill /> | .amt
//
// FR-023: the client-name column is removed.
// FR-014a: the method pill renders via `<MethodPill />` so the `split`
//          variant has a single source of truth.
// FR-013: when there are no rows, the feed header (title + inert "View
//         all" control) stays mounted and the body collapses to an
//         `<EmptyFeedState />`.
//
// The "View all" control is intentionally inert in v1 — a `<button>` styled
// as a link via `.tx-link`. No `/transactions` route exists yet (Constitution
// Principle V — Scope Discipline).
export function RecentTransactionsFeed({ rows, staff }: RecentTransactionsFeedProps) {
  return (
    <div className="tx-feed" data-slot="recent-transactions-feed">
      <div className="tx-feed-h">
        <span className="ttl">Recent transactions</span>
        <button type="button" className="tx-link">
          View all
        </button>
      </div>
      {rows.length === 0 ? (
        <EmptyFeedState />
      ) : (
        <div className="tx-feed-list">
          {rows.map((row) => (
            <div key={row.id} className="tx-feed-row" data-tx-id={row.id}>
              <span className="time tnum">{row.time}</span>
              <span className="svc">{row.serviceLabel}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <TechStack staff={staff} ids={row.techIds} size={20} />
              </span>
              <MethodPill method={row.method} />
              <span className="amt tnum">{formatCurrency(row.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
