// Report loading.tsx — rendered by Next.js while the server-side data fetch
// for `app/(studio)/report/page.tsx` is in flight, including the re-fetch
// triggered by stepping the reporting period (US4 `?period=&offset=`).
//
// Mirrors the live page's `.dr-app-page` chrome so the layout doesn't shift
// when real content arrives: the `.tp-head` band, the three-card `.dr-summary`
// strip, and the left-panel / right-panel `.dr-body` shell.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/report.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function ReportLoading() {
  return (
    <div className="dr-app dr-app-page" aria-hidden="true">
      <div className="tp-head">
        <div>
          <Skeleton width={140} height={28} radius="var(--radius-md)" />
          <Skeleton width={420} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
        </div>
        <div className="actions">
          <Skeleton width={160} height={30} radius="var(--radius-sm)" />
        </div>
      </div>

      <div className="dr-summary">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dr-stat">
            <Skeleton width={110} height={10} radius="var(--radius-md)" />
            <Skeleton width={96} height={26} radius="var(--radius-md)" style={{ marginTop: 6 }} />
            <Skeleton width={150} height={10} radius="var(--radius-md)" style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>

      <div className="dr-body">
        <div className="dr-left">
          <div className="dr-allstaff-btn">
            <Skeleton width={80} height={14} radius="var(--radius-md)" />
            <Skeleton width={140} height={10} radius="var(--radius-md)" style={{ marginTop: 4 }} />
          </div>
          <div className="dr-tech-list">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={96} radius="var(--radius-md)" />
            ))}
          </div>
        </div>
        <div className="dr-right">
          <div className="dr-detail">
            <div className="dr-detail-head">
              <Skeleton width={200} height={16} radius="var(--radius-md)" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={36} radius="var(--radius-sm)" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
