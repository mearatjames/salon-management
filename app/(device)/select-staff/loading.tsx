// Select-staff loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(device)/select-staff/page.tsx` is in flight (staff roster
// query + auth check).
//
// Mirrors the live page's `.select-staff-screen` chrome so the layout does
// not shift when real content arrives: the `.select-staff-header` band
// (brand wordmark + sign-out) and the body with the title block, a search
// field placeholder, and an 8-tile `.select-staff-grid` avatar placeholder
// grid — each tile is a circular avatar `<Skeleton>` plus a short name line.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/select-staff.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function SelectStaffLoading() {
  return (
    <div className="select-staff-screen" aria-hidden="true">
      {/* Header band — brand wordmark + sign-out button */}
      <header className="select-staff-header">
        <div className="select-staff-brand">
          <Skeleton width={26} height={26} radius="var(--radius-sm)" />
          <Skeleton width={140} height={18} radius="var(--radius-md)" />
        </div>
        <Skeleton width={56} height={14} radius="var(--radius-md)" />
      </header>

      {/* Body — title block, search field, avatar grid */}
      <div className="select-staff-body">
        {/* Title / subtitle */}
        <div className="select-staff-screen-header">
          <Skeleton width={300} height={36} radius="var(--radius-md)" />
          <Skeleton width={180} height={14} radius="var(--radius-md)" style={{ marginTop: 4 }} />
        </div>

        {/* Search field placeholder */}
        <div className="select-staff-search">
          <Skeleton width="100%" height={44} radius="var(--radius-xs)" />
        </div>

        {/* Avatar tile grid — 8 placeholder tiles */}
        <div className="select-staff-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="select-staff-tile">
              {/* Circular avatar */}
              <Skeleton width={56} height={56} radius="var(--radius-full)" />
              {/* Name line */}
              <Skeleton width={72} height={12} radius="var(--radius-md)" />
              {/* Role label */}
              <Skeleton width={48} height={10} radius="var(--radius-md)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
