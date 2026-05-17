// DetailView — the Past Cash Count detail page body (feature 020, US1).
// Server-renderable; pure presentational.
//
// Layout:
//   - Back link (←  Past cash counts) to the list
//   - Header (business day + closer name + close timestamp)
//   - Breakdown card (Expected / Counted / Difference) — mirrors the
//     close-screen `done-screen.tsx` `.eod-done-card` pattern so the
//     visual rhythm matches what the closer just saw.
//   - Note block (italicized) or "No note recorded" placeholder
//   - Edit count CTA (placeholder for US1; US2 swaps it to wire the
//     edit form via `?edit=1` per T026)
//
// All values resolve to tokens via the `.eod-detail-*` and `.eod-done-*`
// classes in `styles/end-of-day.css` (Constitution Principle I).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import type { CashHistoryDetail } from "@/lib/end-of-day/history";
import { EditForm } from "@/components/lacquer/eod/history/edit-form.client";

export type DetailViewProps = {
  detail: CashHistoryDetail;
  // When true, the breakdown card is swapped for the edit form. Driven
  // by the `?edit=1` query param on the page (see [sessionId]/page.tsx).
  edit?: boolean;
};

// Business-day formatter: salon-local YYYY-MM-DD → "Monday, May 11".
const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
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

function parseBusinessDay(businessDay: string): Date {
  const [y, m, d] = businessDay.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

export function DetailView({ detail, edit = false }: DetailViewProps) {
  const { session } = detail;
  const state: "match" | "short" | "over" =
    session.varianceCents === 0 ? "match" : session.varianceCents < 0 ? "short" : "over";

  const diffLabel = state === "match" ? "Difference" : state === "short" ? "Short" : "Over";
  const diffValue =
    state === "match"
      ? "Exact match"
      : state === "over"
        ? `+$${fmtAbs(session.varianceCents)}`
        : `−$${fmtAbs(session.varianceCents)}`;

  const closedAt = session.closedAt ? new Date(session.closedAt) : null;

  return (
    <div className="eod-detail-shell" data-slot="eod-history-detail">
      <Link href="/end-of-day/history" className="eod-detail-back" data-slot="eod-detail-back">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        Past cash counts
      </Link>

      <div className="eod-detail-header">
        <div className="eod-detail-title">
          {DAY_FMT.format(parseBusinessDay(session.businessDay))}
        </div>
        <div className="eod-detail-subtitle">
          {session.closedByName ? <>Closed by {session.closedByName}</> : <>Closed</>}
          {closedAt ? <> &middot; {TIME_FMT.format(closedAt)}</> : null}
        </div>
      </div>

      {edit ? (
        <EditForm
          sessionId={session.sessionId}
          expectedCents={session.expectedCents}
          openingCents={session.openingCents}
          initialCountedCents={session.countedCents}
          initialNotes={session.notes}
        />
      ) : (
        <>
          <div className="eod-done-card" data-slot="eod-history-breakdown" data-state={state}>
            <div className="eod-done-row">
              <span>Expected cash</span>
              <span className="tnum">${fmt(session.expectedCents)}</span>
            </div>
            <div className="eod-done-row">
              <span>Counted cash</span>
              <span className="tnum">${fmt(session.countedCents)}</span>
            </div>
            <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
            <div className={`eod-done-row eod-done-diff ${state}`} data-slot="eod-history-diff">
              <span>{diffLabel}</span>
              <span className="tnum">{diffValue}</span>
            </div>
            {session.notes ? (
              <div className="eod-done-note" data-slot="eod-history-note">
                &ldquo;{session.notes}&rdquo;
              </div>
            ) : (
              <div
                className="eod-done-note eod-history-note-empty"
                data-slot="eod-history-note-empty"
              >
                No note recorded
              </div>
            )}
          </div>

          <div className="eod-detail-actions">
            <Link
              href={`/end-of-day/history/${session.sessionId}?edit=1`}
              className="eod-history-more"
              data-slot="eod-history-edit-cta"
            >
              Edit count
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
