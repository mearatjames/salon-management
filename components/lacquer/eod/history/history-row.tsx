// HistoryRow — one row in the Past Cash Counts list (feature 020, US1).
// Pure presentational, server-renderable.
//
// Renders the `.eod-history-row` link with:
//   - Business day (e.g. "Mon, May 11")
//   - Expected / Counted / Variance columns (tnum currency)
//   - Variance text colored by sign (FR-002): zero → muted-foreground,
//     positive → warning, negative → destructive
//   - Closer name + close time
//   - "Edited" pill when `edited === true` (US3 wires this through; US1
//     ships the prop already so US3 is a pure CSS toggle)
//
// All values resolve to tokens via the `.eod-history-*` classes in
// `styles/end-of-day.css` (Constitution Principle I).

import Link from "next/link";

export type HistoryRowProps = {
  sessionId: string;
  businessDay: string; // YYYY-MM-DD
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  closedByName: string;
  closedAt: Date;
  edited: boolean;
};

// Business-day formatter: salon-local YYYY-MM-DD → "Mon, May 11".
const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

// Close-time formatter: mirrors `done-screen.tsx` ("h:mm a").
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}

function fmtAbs(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

// Parse a salon-local YYYY-MM-DD into a Date that, when formatted with
// `Intl.DateTimeFormat`, yields the right weekday/month/day labels.
// We pin to UTC noon to avoid edge-of-day tz drift in any runtime tz.
function parseBusinessDay(businessDay: string): Date {
  const [y, m, d] = businessDay.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

export function HistoryRow({
  sessionId,
  businessDay,
  expectedCents,
  countedCents,
  varianceCents,
  closedByName,
  closedAt,
  edited,
}: HistoryRowProps) {
  const varianceState: "zero" | "over" | "short" =
    varianceCents === 0 ? "zero" : varianceCents > 0 ? "over" : "short";
  const varianceLabel =
    varianceCents === 0
      ? `$${fmt(0)}`
      : varianceCents > 0
        ? `+$${fmtAbs(varianceCents)}`
        : `−$${fmtAbs(varianceCents)}`;

  return (
    <Link
      href={`/end-of-day/history/${sessionId}`}
      className="eod-history-row"
      data-slot="eod-history-row"
      data-session-id={sessionId}
    >
      <div className="eod-history-date">{DAY_FMT.format(parseBusinessDay(businessDay))}</div>

      <div className="eod-history-amounts">
        <div>
          <div className="eod-history-amount-label">Expected</div>
          <div className="eod-history-amount-value tnum">${fmt(expectedCents)}</div>
        </div>
        <div>
          <div className="eod-history-amount-label">Counted</div>
          <div className="eod-history-amount-value tnum">${fmt(countedCents)}</div>
        </div>
        <div>
          <div className="eod-history-amount-label">Variance</div>
          <div
            className={`eod-history-amount-value tnum eod-history-variance ${varianceState}`}
            data-slot="eod-history-variance"
            data-state={varianceState}
          >
            {varianceLabel}
          </div>
        </div>
      </div>

      <div className="eod-history-closer">
        {closedByName ? <span className="eod-history-closer-name">{closedByName}</span> : null}
        <span className="eod-history-closer-time">
          <span>{TIME_FMT.format(closedAt)}</span>
          {edited ? (
            <span className="eod-edited-pill" data-slot="eod-edited-pill">
              Edited
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}
