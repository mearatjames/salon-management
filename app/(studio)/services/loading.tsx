// Services loading.tsx — rendered by Next.js while the server-side data fetch
// for `app/(studio)/services/page.tsx` is in flight.
//
// Mirrors the live page's `.settings-services-grid` chrome so the layout
// doesn't shift when real content arrives: the page header (title + "Edit
// Policy" action button), and the two-pane `.services-two-pane` shell — the
// left pane shows the catalog list skeleton (search bar + grouped service rows)
// and the right pane shows the edit-panel skeleton (closed/empty state).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/settings.css";

import { Skeleton } from "@/components/ui/skeleton";

// A single group: one category header skeleton + N service-row skeletons.
function CatalogGroupSkeleton({ rowCount }: { rowCount: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {/* Category group header */}
      <Skeleton width={100} height={10} radius="var(--radius-md)" />
      {/* Service rows */}
      {Array.from({ length: rowCount }).map((_, i) => (
        <Skeleton key={i} height={44} radius="var(--radius-md)" />
      ))}
    </div>
  );
}

export default function ServicesLoading() {
  return (
    <div className="settings-services-grid" aria-hidden="true">
      {/* Page header band: title + subtitle left, action button right */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <Skeleton width={100} height={26} radius="var(--radius-md)" />
          <Skeleton width={140} height={12} radius="var(--radius-md)" style={{ marginTop: 6 }} />
        </div>
        {/* Edit Policy button */}
        <Skeleton width={120} height={34} radius="var(--radius-sm)" />
      </header>

      {/* Two-pane shell */}
      <div className="services-two-pane">
        {/* Left pane: catalog list */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {/* Control bar: search input + show-archived toggle + add button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <Skeleton height={36} radius="var(--radius-xs)" style={{ flex: "1 1 auto" }} />
            <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-4)" }}>
              <Skeleton width={110} height={20} radius="var(--radius-md)" />
              <Skeleton width={108} height={34} radius="var(--radius-sm)" />
            </div>
          </div>

          {/* Grouped catalog rows — 3 groups with 3, 4, and 3 rows */}
          <CatalogGroupSkeleton rowCount={3} />
          <CatalogGroupSkeleton rowCount={4} />
          <CatalogGroupSkeleton rowCount={3} />
        </section>

        {/* Right pane: edit-panel (closed / empty state) */}
        <div className="services-edit-panel">
          <div className="services-edit-panel__empty">
            <div className="services-edit-panel__empty-inner">
              <Skeleton
                width={44}
                height={44}
                radius="var(--radius-full)"
                style={{ marginBottom: 12 }}
              />
              <Skeleton width={140} height={16} radius="var(--radius-md)" />
              <Skeleton
                width={200}
                height={12}
                radius="var(--radius-md)"
                style={{ marginTop: 8 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
