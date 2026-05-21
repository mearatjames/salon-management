// Settings → Staff loading.tsx — rendered by Next.js while the
// server-side data fetch for `app/(studio)/settings/staff/page.tsx` is
// in flight (staff roster query).
//
// Mirrors the live page's `.settings-staff-grid` chrome so the layout
// doesn't shift when real content arrives: the two-column grid with the
// roster column on the left (page header + chip bar + table rows) and
// the edit-panel column on the right (empty-state).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/settings.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function StaffSettingsLoading() {
  return (
    <div className="settings-staff-grid" data-slot="staff-page" aria-hidden="true">
      {/* Left column: roster */}
      <div className="settings-staff-roster">
        {/* Page header: title + subtitle */}
        <div>
          <Skeleton width={80} height={26} radius="var(--radius-md)" />
          <Skeleton width={220} height={12} radius="var(--radius-md)" style={{ marginTop: 6 }} />
        </div>

        {/* Control bar: search + chip bar + Add Staff button */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {/* Search input */}
          <Skeleton height={36} radius="var(--radius-xs)" />
          {/* Filter chip bar: All · Active · Inactive */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {[72, 60, 72].map((w, i) => (
              <Skeleton key={i} width={w} height={28} radius="var(--radius-full)" />
            ))}
          </div>
        </div>

        {/* Staff table rows */}
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
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-3) var(--space-4)",
                borderBottom: i < 5 ? "1px solid var(--border)" : undefined,
              }}
            >
              {/* Avatar */}
              <Skeleton width={32} height={32} radius="var(--radius-full)" />
              {/* Name + role */}
              <div style={{ flex: 1 }}>
                <Skeleton width={120} height={13} radius="var(--radius-md)" />
                <Skeleton
                  width={72}
                  height={10}
                  radius="var(--radius-md)"
                  style={{ marginTop: 4 }}
                />
              </div>
              {/* Status pill */}
              <Skeleton width={56} height={20} radius="var(--radius-full)" />
            </div>
          ))}
        </div>
      </div>

      {/* Right column: edit panel (empty state) */}
      <aside className="settings-staff-panel">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            padding: "var(--space-12) var(--space-6)",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            textAlign: "center",
          }}
        >
          <Skeleton width={44} height={44} radius="var(--radius-full)" />
          <Skeleton width={160} height={16} radius="var(--radius-md)" />
          <Skeleton width={200} height={12} radius="var(--radius-md)" style={{ marginTop: 4 }} />
        </div>
      </aside>
    </div>
  );
}
