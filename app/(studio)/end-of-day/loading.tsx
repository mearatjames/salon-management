// End-of-Day loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/end-of-day/page.tsx` is in flight.
//
// Mirrors the live page's `.eod-app` chrome so the layout doesn't shift
// when real content arrives: the `.tx-landing-top` header band with status
// pill and history link, and the two-column `.eod-body` (left `.eod-left`
// cash-list panel, right `.eod-right` count panel with display, numpad,
// and comparison block).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/end-of-day.css";
import "@/styles/dashboard.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function EndOfDayLoading() {
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
          <Skeleton width={160} height={26} radius="var(--radius-md)" />
          <Skeleton width={200} height={12} radius="var(--radius-md)" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          {/* Status pill */}
          <Skeleton width={64} height={22} radius="var(--radius-full)" />
          {/* "View past counts" link */}
          <Skeleton width={120} height={14} radius="var(--radius-md)" />
        </div>
      </div>

      {/* Two-column body */}
      <div className="eod-body">
        {/* Left: cash-list panel */}
        <div className="eod-left">
          <div className="eod-panel-head">
            <Skeleton width={120} height={13} radius="var(--radius-md)" />
            <Skeleton width={20} height={20} radius="var(--radius-full)" />
          </div>
          <div className="eod-tx-scroll">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="eod-tx-row">
                <Skeleton width={52} height={11} radius="var(--radius-md)" />
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <Skeleton width={120} height={13} radius="var(--radius-md)" />
                  <Skeleton width={88} height={10} radius="var(--radius-md)" />
                </div>
                <div
                  className="eod-tx-amt-col"
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <Skeleton width={44} height={14} radius="var(--radius-md)" />
                  <Skeleton width={32} height={10} radius="var(--radius-md)" />
                </div>
              </div>
            ))}
          </div>
          <div className="eod-list-foot">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Skeleton width={80} height={10} radius="var(--radius-md)" />
              <Skeleton width={96} height={11} radius="var(--radius-md)" />
            </div>
            <Skeleton width={72} height={26} radius="var(--radius-md)" />
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, background: "var(--border)", flexShrink: 0 }} />

        {/* Right: count panel */}
        <div className="eod-right">
          {/* Amount display */}
          <div className="eod-display">
            <Skeleton width="100%" height={56} radius="var(--radius-md)" />
          </div>

          {/* Numpad grid */}
          <div className="eod-numpad">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
              <Skeleton key={i} height={44} radius="var(--radius-sm)" />
            ))}
          </div>

          {/* Comparison block */}
          <div className="eod-comparison">
            {[0, 1].map((i) => (
              <div key={i} className="eod-comp-row">
                <Skeleton width={100} height={13} radius="var(--radius-md)" />
                <Skeleton width={64} height={15} radius="var(--radius-md)" />
              </div>
            ))}
            <div className="eod-comp-divider" />
            <div className="eod-diff-row eod-comp-row">
              <Skeleton width={80} height={13} radius="var(--radius-md)" />
              <Skeleton width={72} height={20} radius="var(--radius-md)" />
            </div>
          </div>

          {/* Notes textarea placeholder */}
          <Skeleton height={72} radius="var(--radius-sm)" />

          {/* Close button */}
          <Skeleton height={40} radius="var(--radius-sm)" />
        </div>
      </div>
    </div>
  );
}
