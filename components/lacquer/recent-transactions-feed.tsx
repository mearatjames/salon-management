import Link from "next/link";

import type { Technician, TransactionRow } from "@/lib/dashboard/aggregate";
import type { StudioRole } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/dashboard/format";
import { EmptyFeedState } from "@/components/lacquer/empty-feed-state";
import { MethodPill } from "@/components/lacquer/method-pill";
import { TechStack } from "@/components/lacquer/tech-stack";
import { RefundEntry } from "@/components/lacquer/transactions/refund-entry.client";

export type RecentTransactionsFeedProps = {
  rows: readonly TransactionRow[];
  staff: readonly Technician[];
  /**
   * Feature 052 (US2): the viewer's role. Owner + manager get a per-row
   * "Refund" affordance (opens the shared refund composition sheet for that
   * ticket); every other role sees the row exactly as before. The server
   * action re-checks the role (Principle II); this only gates the affordance.
   */
  viewerRole: StudioRole;
};

// Server component — applies the `.tx-feed` chrome (background / border /
// radius all tokenised via the CSS class). DOM order per row matches the
// grid in `styles/dashboard.css` (`.tx-feed-row` is a 5-col grid on desktop):
//   .time | .svc | .techs (<TechStack />) | <MethodPill /> | .amt
// The `.techs` wrapper carries a class purely so the phone breakpoint
// (issue #161, `max-width: 640px`) can place it via `grid-template-areas`
// when the row restacks into a card layout.
//
// FR-023: the client-name column is removed.
// FR-014a: the method pill renders via `<MethodPill />` so the `split`
//          variant has a single source of truth.
// FR-013: when there are no rows, the feed header (title + "View all"
//         control) stays mounted and the body collapses to an
//         `<EmptyFeedState />`.
//
// The "View all" control is a `next/link` `<Link>` styled as a link via
// `.tx-link`; it navigates to the `/transactions` page (feature 045).
export function RecentTransactionsFeed({ rows, staff, viewerRole }: RecentTransactionsFeedProps) {
  const canRefund = viewerRole === "owner" || viewerRole === "manager";
  return (
    <div className="tx-feed" data-slot="recent-transactions-feed">
      <div className="tx-feed-h">
        <span className="ttl">Recent transactions</span>
        <Link href="/transactions" className="tx-link">
          View all
        </Link>
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
                className="techs"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <TechStack staff={staff} ids={row.techIds} size={20} />
              </span>
              <MethodPill method={row.method} />
              <span
                className="amt tnum"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "var(--space-2)",
                }}
              >
                {row.reversal ? (
                  <span
                    className="tx-feed-badge"
                    data-slot="feed-reversal-badge"
                    data-reversal={row.reversal}
                  >
                    {row.reversal === "partially_refunded" ? "Partial" : "Refunded"}
                  </span>
                ) : null}
                {/* Reversed rows show the net kept; a fully-refunded sale has
                    nothing left to refund, so its affordance is hidden. */}
                {formatCurrency(row.reversal ? row.netTotal : row.total)}
                <RefundEntry
                  ticketId={row.id}
                  canRefund={canRefund && row.reversal !== "refunded"}
                  variant="feed"
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
