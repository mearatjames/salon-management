// Payroll detail loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/payroll/[staffId]/page.tsx` is in flight, including
// the re-fetch triggered by stepping prev/next tech or switching the period.
//
// Mirrors the live page's `.pr-app.pp-detail-screen` chrome so the layout
// doesn't shift when real content arrives: the `.pp-detail-topbar` nav row,
// the `.pp-detail-header` band (avatar + name left, state + bignum right),
// and the two-column `.pp-detail-grid` (chart card left, breakdown side right).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/payroll.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function PayrollDetailLoading() {
  return (
    <div className="pr-app pp-detail-screen dr-app-page" aria-hidden="true">
      {/* Top navigation: back link + prev/next buttons */}
      <div className="pp-detail-topbar">
        <Skeleton width={180} height={20} radius="var(--radius-sm)" />
        <div className="pp-detail-topbar-nav">
          <Skeleton width={80} height={28} radius="var(--radius-sm)" />
          <Skeleton width={68} height={28} radius="var(--radius-sm)" />
        </div>
      </div>

      {/* Tech header band: avatar + name/meta left, state badge + bignum right */}
      <div className="pp-detail-header">
        <div className="pp-detail-header-l">
          {/* Avatar */}
          <Skeleton width={56} height={56} radius="var(--radius-full)" />
          <div>
            <Skeleton width={80} height={10} radius="var(--radius-md)" />
            <Skeleton width={220} height={32} radius="var(--radius-md)" style={{ marginTop: 8 }} />
            <Skeleton width={300} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          </div>
        </div>
        <div className="pp-detail-header-r">
          {/* State badge */}
          <Skeleton width={120} height={22} radius="var(--radius-full)" />
          {/* Big cash-to-hand-over figure */}
          <div className="pp-detail-bignum">
            <Skeleton width={120} height={10} radius="var(--radius-md)" />
            <Skeleton width={200} height={44} radius="var(--radius-md)" style={{ marginTop: 8 }} />
            <Skeleton width={160} height={10} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          </div>
        </div>
      </div>

      {/* Two-column grid: chart card left, breakdown side right */}
      <div className="pp-detail-grid">
        {/* Chart card */}
        <div className="pp-detail-chart-card">
          <div className="pp-detail-chart-card-head">
            <div>
              <Skeleton width={160} height={18} radius="var(--radius-md)" />
              <Skeleton
                width={120}
                height={10}
                radius="var(--radius-md)"
                style={{ marginTop: 6 }}
              />
            </div>
            <div className="pp-detail-chart-stats">
              <div className="pp-stat">
                <Skeleton width={64} height={10} radius="var(--radius-md)" />
                <Skeleton
                  width={80}
                  height={22}
                  radius="var(--radius-md)"
                  style={{ marginTop: 6 }}
                />
                <Skeleton
                  width={72}
                  height={10}
                  radius="var(--radius-md)"
                  style={{ marginTop: 6 }}
                />
              </div>
              <div className="pp-stat">
                <Skeleton width={64} height={10} radius="var(--radius-md)" />
                <Skeleton
                  width={80}
                  height={22}
                  radius="var(--radius-md)"
                  style={{ marginTop: 6 }}
                />
                <Skeleton
                  width={72}
                  height={10}
                  radius="var(--radius-md)"
                  style={{ marginTop: 6 }}
                />
              </div>
            </div>
          </div>
          {/* Bar chart placeholder */}
          <Skeleton height={200} radius="var(--radius-sm)" />
        </div>

        {/* Side rail: breakdown card + pay action card */}
        <div className="pp-detail-side">
          <div className="pp-detail-card">
            <Skeleton width={120} height={10} radius="var(--radius-md)" />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 12,
              }}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={32} radius="var(--radius-sm)" />
              ))}
            </div>
            {/* Total row */}
            <Skeleton height={40} radius="var(--radius-sm)" style={{ marginTop: 12 }} />
          </div>
          {/* Pay action card */}
          <div className="pp-detail-card">
            <Skeleton width={100} height={10} radius="var(--radius-md)" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                marginTop: 12,
              }}
            >
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={56} radius="var(--radius-md)" />
              ))}
            </div>
            <Skeleton height={40} radius="var(--radius-sm)" style={{ marginTop: 12 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
