// ChangeHistory — collapsible audit-trail accordion for a single cash
// drawer session (feature 020, US3).
//
// Server-renderable (uses a native `<details>` element, no client state).
// Renders newest-first; each entry shows a meta line (editor + timestamp)
// and side-by-side before/after blocks with counted / variance / notes.
//
// All values resolve to tokens via the `.eod-change-history-*` classes in
// `styles/end-of-day.css` (Constitution Principle I).

import type { AuditEntry } from "@/lib/end-of-day/history";

export type ChangeHistoryProps = {
  audits: AuditEntry[];
};

// Combined "h:mm a · MMM D" formatter for each entry's timestamp.
const ENTRY_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  month: "short",
  day: "numeric",
});

function formatEntryTime(iso: string): string {
  const d = new Date(iso);
  // Intl returns e.g. "8:32 PM, May 15"; reshape to "8:32 PM · May 15"
  // to match the design prototype's middle-dot rhythm.
  const parts = ENTRY_FMT.formatToParts(d);
  let time = "";
  let date = "";
  let mode: "time" | "date" = "time";
  for (const p of parts) {
    if (p.type === "month" || p.type === "day") {
      mode = "date";
    }
    if (mode === "time") {
      time += p.value;
    } else {
      date += p.value;
    }
  }
  // The literal comma+space between time and date sneaks into `time`;
  // strip a trailing ", " if present.
  time = time.replace(/,\s*$/, "");
  return `${time.trim()} · ${date.trim()}`;
}

function fmtCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtSignedCurrency(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents > 0) return `+$${(cents / 100).toFixed(2)}`;
  return `−$${(Math.abs(cents) / 100).toFixed(2)}`;
}

type Side = { countedCents: number; varianceCents: number; notes: string | null };

function Block({ label, side }: { label: string; side: Side }) {
  return (
    <div className="eod-change-history-block" data-slot="eod-change-history-block">
      <div className="eod-change-history-block-label">{label}</div>
      <div className="eod-change-history-block-row">
        <span>Counted</span>
        <span className="tnum">{fmtCurrency(side.countedCents)}</span>
      </div>
      <div className="eod-change-history-block-row">
        <span>Variance</span>
        <span className="tnum">{fmtSignedCurrency(side.varianceCents)}</span>
      </div>
      {side.notes ? (
        <div className="eod-change-history-block-notes">&ldquo;{side.notes}&rdquo;</div>
      ) : (
        <div className="eod-change-history-block-notes">No note recorded</div>
      )}
    </div>
  );
}

export function ChangeHistory({ audits }: ChangeHistoryProps) {
  if (audits.length === 0) {
    return null;
  }

  const label = audits.length === 1 ? "1 entry" : `${audits.length} entries`;

  return (
    <details className="eod-change-history" data-slot="eod-change-history">
      <summary data-slot="eod-change-history-summary">
        <span>Change history · {label}</span>
      </summary>
      <ul className="eod-change-history-list" data-slot="eod-change-history-list">
        {audits.map((entry) => (
          <li
            key={entry.id}
            className="eod-change-history-entry"
            data-slot="eod-change-history-entry"
          >
            <div className="eod-change-history-meta">
              <span className="eod-change-history-editor">{entry.editorDisplayName || "—"}</span>
              <span className="eod-change-history-time">{formatEntryTime(entry.createdAt)}</span>
            </div>
            <div className="eod-change-history-blocks">
              <Block label="Before" side={entry.before} />
              <Block label="After" side={entry.after} />
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
