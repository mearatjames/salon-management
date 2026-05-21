// Settings → Square loading.tsx — rendered by Next.js while the
// server-side data fetch for `app/(studio)/settings/square/page.tsx` is
// in flight (square_oauth + square_devices queries + Square API refresh).
//
// Mirrors the live page's inline flex-column chrome so the layout doesn't
// shift when real content arrives: the page header (title + subtitle),
// a connection-status card skeleton, and a device-list block of ~3 rows.
//
// The page uses inline styles exclusively (no named CSS class), so this
// skeleton matches the same inline layout tokens.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import { Skeleton } from "@/components/ui/skeleton";

export default function SquareSettingsLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "var(--space-6) 0",
      }}
      data-slot="square-settings-page"
      aria-hidden="true"
    >
      {/* Page header: title + subtitle */}
      <header>
        <Skeleton width={80} height={28} radius="var(--radius-md)" />
        <Skeleton
          width={300}
          height={12}
          radius="var(--radius-md)"
          style={{ marginTop: "var(--space-1)" }}
        />
      </header>

      {/* Connect card skeleton */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "var(--space-5)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        {/* Card header: icon + title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Skeleton width={40} height={40} radius="var(--radius-md)" />
            <div>
              <Skeleton width={140} height={16} radius="var(--radius-md)" />
              <Skeleton
                width={200}
                height={11}
                radius="var(--radius-md)"
                style={{ marginTop: 6 }}
              />
            </div>
          </div>
          {/* Connect / Disconnect button */}
          <Skeleton width={120} height={34} radius="var(--radius-sm)" />
        </div>
      </div>

      {/* Device list skeleton */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        {/* List heading */}
        <Skeleton width={140} height={16} radius="var(--radius-md)" />
        {/* Device rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-4)",
                padding: "var(--space-3) var(--space-4)",
                borderBottom: i < 2 ? "1px solid var(--border)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <Skeleton width={20} height={20} radius="var(--radius-sm)" />
                <div>
                  <Skeleton width={160} height={13} radius="var(--radius-md)" />
                  <Skeleton
                    width={100}
                    height={10}
                    radius="var(--radius-md)"
                    style={{ marginTop: 4 }}
                  />
                </div>
              </div>
              {/* Default badge / actions */}
              <Skeleton width={64} height={22} radius="var(--radius-full)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
