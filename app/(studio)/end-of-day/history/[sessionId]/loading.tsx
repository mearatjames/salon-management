// End-of-Day History Detail loading.tsx — rendered by Next.js while the
// server-side data fetch for
// `app/(studio)/end-of-day/history/[sessionId]/page.tsx` is in flight.
//
// Mirrors the live page's `.eod-app` / `.eod-detail-shell` chrome so the
// layout doesn't shift when real content arrives: a back-link row, the
// centered `.eod-detail-header` (title + subtitle), the `.eod-done-card`
// breakdown block (3 rows: Expected, Counted, Difference), a note block,
// and the `.eod-detail-actions` edit-CTA row.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/end-of-day.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function HistoryDetailLoading() {
  return (
    <div
      className="eod-app"
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      aria-hidden="true"
    >
      <div className="eod-detail-shell">
        {/* Back link */}
        <div className="eod-detail-back" style={{ pointerEvents: "none" }}>
          <Skeleton width={140} height={13} radius="var(--radius-md)" />
        </div>

        {/* Centered header */}
        <div className="eod-detail-header">
          <div className="eod-detail-title">
            <Skeleton width={220} height={22} radius="var(--radius-md)" />
          </div>
          <div className="eod-detail-subtitle">
            <Skeleton width={180} height={13} radius="var(--radius-md)" />
          </div>
        </div>

        {/* Breakdown card — mirrors .eod-done-card */}
        <div className="eod-done-card">
          {/* Expected */}
          <div className="eod-done-row">
            <Skeleton width={110} height={14} radius="var(--radius-md)" />
            <Skeleton width={64} height={14} radius="var(--radius-md)" />
          </div>
          {/* Counted */}
          <div className="eod-done-row">
            <Skeleton width={100} height={14} radius="var(--radius-md)" />
            <Skeleton width={64} height={14} radius="var(--radius-md)" />
          </div>
          {/* Divider */}
          <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
          {/* Difference */}
          <div className="eod-done-row eod-done-diff">
            <Skeleton width={80} height={14} radius="var(--radius-md)" />
            <Skeleton width={80} height={14} radius="var(--radius-md)" />
          </div>
          {/* Note */}
          <div className="eod-done-note">
            <Skeleton width="90%" height={12} radius="var(--radius-md)" />
          </div>
        </div>

        {/* Edit CTA */}
        <div className="eod-detail-actions">
          <Skeleton width={96} height={34} radius="var(--radius-sm)" />
        </div>
      </div>
    </div>
  );
}
