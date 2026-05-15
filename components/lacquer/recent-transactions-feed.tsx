import type { TransactionRow } from "@/lib/dashboard/aggregate";
import { formatCurrency } from "@/lib/dashboard/format";
import { TechStack } from "@/components/lacquer/tech-stack";

export type RecentTransactionsFeedProps = {
  rows: readonly TransactionRow[];
};

// Server component — applies the `.tx-feed` chrome (background / border /
// radius all tokenised via the CSS class). DOM order per row matches the
// grid in `styles/dashboard.css` (`.tx-feed-row` is a 6-col grid):
//   .time | .client | .svc | <TechStack /> | method pill | .amt
//
// The "View all" control is intentionally inert in v1 — a `<button>` styled
// as a link via `.tx-link`. No `/transactions` route exists yet (Constitution
// Principle V — Scope Discipline).
export function RecentTransactionsFeed({
  rows,
}: RecentTransactionsFeedProps) {
  return (
    <div className="tx-feed" data-slot="recent-transactions-feed">
      <div className="tx-feed-h">
        <span className="ttl">Recent transactions</span>
        <button type="button" className="tx-link">
          View all
        </button>
      </div>
      <div className="tx-feed-list">
        {rows.map((row) => (
          <div
            key={row.id}
            className="tx-feed-row"
            data-tx-id={row.id}
          >
            <span className="time tnum">{row.time}</span>
            <span className="client">{row.client}</span>
            <span className="svc">{row.serviceLabel}</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TechStack ids={row.techIds} size={20} />
            </span>
            <span className={`tx-meth-pill ${row.method}`}>{row.method}</span>
            <span className="amt tnum">{formatCurrency(row.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
