// CashList — left-side panel of the End-of-Day Cash page.
//
// Server-renderable. Renders the `.eod-left` shell from the prototype:
// panel header ("Cash today" + count chip) → scrollable list of
// `<CashRow />`s → sticky footer ("Expected cash total" label + sub-row
// + amount in tnum). Empty state reuses the shared `<EmptyFeedState />`
// with "No cash today." copy.
//
// All colors / spacings resolve to tokens via the `.eod-*` classes in
// `styles/end-of-day.css` (Constitution Principle I).

import type { CashRow as CashRowType } from "@/lib/end-of-day/aggregate";
import { CashRow } from "@/components/lacquer/eod/cash-row";

export type CashListProps = {
  rows: CashRowType[];
  expectedCents: number;
  /**
   * Feature 052 (US2): when true (viewer is owner/manager), each payment row
   * gets a "Refund" affordance opening the shared refund composition sheet.
   * The End-of-Day page is already owner/manager-only, so this defaults true;
   * threaded explicitly so the affordance has a single source of truth.
   */
  canRefund?: boolean;
};

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatTimeShort(d: Date): string {
  return TIME_FMT.format(d);
}

export function CashList({ rows, expectedCents, canRefund = false }: CashListProps) {
  const txCount = rows.length;
  const expected = (expectedCents / 100).toFixed(2);
  return (
    <div className="eod-left" data-slot="eod-cash-list">
      <div className="eod-panel-head">
        <span className="eod-panel-title">Cash today</span>
        <span className="eod-count-chip" data-slot="eod-count-chip">
          {txCount}
        </span>
      </div>

      <div className="eod-tx-scroll">
        {txCount === 0 ? (
          <EmptyCashState />
        ) : (
          rows.map((row) => (
            <CashRow
              key={row.id}
              kind={row.kind}
              time={formatTimeShort(row.processedAt)}
              client={row.client}
              services={row.services}
              techs={row.techs}
              amountCents={row.amountCents}
              tipCents={row.tipCents}
              ticketId={row.ticketId}
              canRefund={canRefund}
            />
          ))
        )}
      </div>

      <div className="eod-list-foot">
        <div>
          <div className="eod-foot-label">Expected cash total</div>
          <div className="eod-foot-sub">
            {txCount} cash {txCount === 1 ? "transaction" : "transactions"}
          </div>
        </div>
        <div className="eod-foot-amount tnum" data-slot="eod-foot-amount">
          ${expected}
        </div>
      </div>
    </div>
  );
}

// Inline empty state — uses the same calm chrome pattern as
// `components/lacquer/empty-feed-state.tsx` but with EOD-specific copy.
function EmptyCashState() {
  return (
    <div
      data-slot="eod-empty-cash"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        minHeight: 120,
        color: "var(--muted-foreground)",
        fontSize: 12,
      }}
    >
      No cash today.
    </div>
  );
}
