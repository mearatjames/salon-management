// End-of-Day History loading.tsx — rendered by Next.js while the server-side
// data fetch for `app/(studio)/end-of-day/history/page.tsx` is in flight.
//
// Mirrors the live page's `.eod-app` chrome so the layout doesn't shift
// when real content arrives: the `.tx-landing-top` header band, the
// `.eod-history-shell` panel with `.eod-panel-head`, and ~6 session-row
// skeletons inside `.eod-history-scroll` using the `.eod-history-row` grid
// (132 px date | 1fr amounts | auto closer).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/end-of-day.css";
import "@/styles/dashboard.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function HistoryLoading() {
  return (
    <div
      className="eod-app"
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      aria-hidden="true"
    >
      {/* Header band — mirrors .tx-landing-top */}
      <div
        className="tx-landing-top"
        style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton width={88} height={10} radius="var(--radius-md)" />
          <Skeleton width={220} height={26} radius="var(--radius-md)" />
          <Skeleton width={300} height={12} radius="var(--radius-md)" />
        </div>
      </div>

      {/* History list shell */}
      <div className="eod-history-shell">
        <div className="eod-panel-head">
          <Skeleton width={140} height={13} radius="var(--radius-md)" />
          <Skeleton width={20} height={20} radius="var(--radius-full)" />
        </div>
        <div className="eod-history-scroll">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="eod-history-row" style={{ pointerEvents: "none" }}>
              {/* Date column */}
              <Skeleton width={110} height={13} radius="var(--radius-md)" />

              {/* Amounts column — Expected / Counted / Variance */}
              <div className="eod-history-amounts">
                {[0, 1, 2].map((j) => (
                  <div key={j} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <Skeleton width={52} height={10} radius="var(--radius-md)" />
                    <Skeleton width={64} height={14} radius="var(--radius-md)" />
                  </div>
                ))}
              </div>

              {/* Closer column */}
              <div className="eod-history-closer">
                <Skeleton width={80} height={13} radius="var(--radius-md)" />
                <Skeleton width={56} height={11} radius="var(--radius-md)" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
