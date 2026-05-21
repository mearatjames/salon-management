import "@/styles/dashboard.css";

import { Skeleton } from "@/components/ui/skeleton";

// Dashboard loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/dashboard/page.tsx` is in flight.
//
// Mirrors the live page's `.tx-landing` chrome so the layout doesn't shift
// when real content arrives: a header band slot on top, the four
// `.tx-stat-card` slots + a two-column-spanning `.tx-stat-card` for the
// Payment-mix tile, and an empty feed-shell beneath.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).
export default function DashboardLoading() {
  return (
    <div className="tx-landing">
      <div
        className="tx-landing-top"
        style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}
      >
        <div style={{ width: "60%" }}>
          <Skeleton width={160} height={12} radius="var(--radius-md)" />
          <Skeleton width={220} height={24} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          <Skeleton width={280} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <Skeleton width={180} height={32} radius="var(--radius-full)" />
          <Skeleton width={200} height={56} radius="var(--radius-lg)" />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "16px 24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "auto",
        }}
      >
        <div
          className="tx-stat-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tx-stat-card" data-slot="stat-card">
              <Skeleton width={80} height={12} radius="var(--radius-md)" />
              <Skeleton width={96} height={24} radius="var(--radius-md)" style={{ marginTop: 6 }} />
              <Skeleton width={60} height={10} radius="var(--radius-md)" style={{ marginTop: 6 }} />
            </div>
          ))}
          <div style={{ gridColumn: "span 2" }}>
            <div className="tx-stat-card" data-slot="payment-mix-card" style={{ minHeight: 0 }}>
              <Skeleton width={96} height={12} radius="var(--radius-md)" />
              <Skeleton
                width="100%"
                height={8}
                radius="var(--radius-full)"
                style={{ marginTop: 8 }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                <Skeleton width="100%" height={12} radius="var(--radius-md)" />
                <Skeleton width="100%" height={12} radius="var(--radius-md)" />
                <Skeleton width="100%" height={12} radius="var(--radius-md)" />
              </div>
            </div>
          </div>
        </div>

        <div className="tx-landing-bottom">
          <div className="tx-landing-bottom-left">
            <div className="muted">Quick actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={56} radius="var(--radius-lg)" />
              ))}
            </div>
          </div>
          <div className="tx-feed" data-slot="recent-transactions-feed" aria-hidden="true">
            <div className="tx-feed-h">
              <span className="ttl">Recent transactions</span>
            </div>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={28} radius="var(--radius-sm)" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
