// HistoryList — the Past Cash Counts list panel (feature 020, US1).
// Server-renderable; composes `<HistoryRow />` + `<HistoryEmpty />`.
//
// Renders the panel head ("Past cash counts" + count chip), a scrollable
// list of rows ordered newest-first (server already returns in
// business_day desc), and a "Show earlier" link when there's a next page.
//
// All values resolve to tokens via the `.eod-history-*` and shared
// `.eod-panel-*` classes in `styles/end-of-day.css`.

import Link from "next/link";

import type { CashHistoryRow } from "@/lib/end-of-day/history";

import { HistoryEmpty } from "@/components/lacquer/eod/history/history-empty";
import { HistoryRow } from "@/components/lacquer/eod/history/history-row";

export type HistoryListProps = {
  rows: CashHistoryRow[];
  hasMore: boolean;
  nextOffset: number;
};

export function HistoryList({ rows, hasMore, nextOffset }: HistoryListProps) {
  if (rows.length === 0) {
    return (
      <div className="eod-history-shell" data-slot="eod-history-list">
        <div className="eod-panel-head">
          <span className="eod-panel-title">Past cash counts</span>
          <span className="eod-count-chip" data-slot="eod-history-count">
            0
          </span>
        </div>
        <HistoryEmpty />
      </div>
    );
  }

  return (
    <div className="eod-history-shell" data-slot="eod-history-list">
      <div className="eod-panel-head">
        <span className="eod-panel-title">Past cash counts</span>
        <span className="eod-count-chip" data-slot="eod-history-count">
          {rows.length}
        </span>
      </div>
      <div className="eod-history-scroll">
        {rows.map((row) => (
          <HistoryRow
            key={row.sessionId}
            sessionId={row.sessionId}
            businessDay={row.businessDay}
            expectedCents={row.expectedCents}
            countedCents={row.countedCents}
            varianceCents={row.varianceCents}
            closedByName={row.closedByName}
            closedAt={new Date(row.closedAt)}
            edited={row.edited}
          />
        ))}
        {hasMore ? (
          <Link
            href={`/end-of-day/history?offset=${nextOffset}`}
            className="eod-history-more"
            data-slot="eod-history-more"
          >
            Show earlier
          </Link>
        ) : null}
      </div>
    </div>
  );
}
