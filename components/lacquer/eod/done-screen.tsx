// DoneScreen — the "Day closed out" confirmation block.
//
// Pure presentational; server-renderable. Renders the `.eod-done` block
// from the prototype: icon tinted by variance state, headline, sub
// ("Logged at HH:MM"), breakdown card (Expected / Counted / Difference)
// and an optional italic note. For v1 the "Start new count" button is
// intentionally omitted — no reopen flow ships in v1 (per spec edge case).

import { Check } from "lucide-react";

export type DoneScreenProps = {
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  notes: string | null;
  closedAt: Date;
};

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function fmtAbs(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function DoneScreen({
  expectedCents,
  countedCents,
  varianceCents,
  notes,
  closedAt,
}: DoneScreenProps) {
  const state: "match" | "short" | "over" =
    varianceCents === 0 ? "match" : varianceCents < 0 ? "short" : "over";

  const diffLabel = state === "match" ? "Difference" : state === "short" ? "Short" : "Over";
  const diffValue =
    state === "match"
      ? "Exact match"
      : state === "over"
        ? `+$${fmtAbs(varianceCents)}`
        : `−$${fmtAbs(varianceCents)}`;

  return (
    <div className="eod-done" data-slot="eod-done-screen" data-state={state}>
      <div className={`eod-done-icon ${state}`}>
        <Check size={30} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Day closed out</div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
        Logged at {TIME_FMT.format(closedAt)}
      </div>
      <div className="eod-done-card">
        <div className="eod-done-row">
          <span>Expected cash</span>
          <span className="tnum">${fmt(expectedCents)}</span>
        </div>
        <div className="eod-done-row">
          <span>Counted cash</span>
          <span className="tnum">${fmt(countedCents)}</span>
        </div>
        <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
        <div className={`eod-done-row eod-done-diff ${state}`} data-slot="eod-done-diff">
          <span>{diffLabel}</span>
          <span className="tnum">{diffValue}</span>
        </div>
        {notes ? <div className="eod-done-note">&ldquo;{notes}&rdquo;</div> : null}
      </div>
    </div>
  );
}
