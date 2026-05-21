// Settings → Onboarding loading.tsx — rendered by Next.js while the
// server-side data fetch for `app/(studio)/settings/onboarding/page.tsx`
// is in flight (roster + hero-stats queries).
//
// Mirrors the live page's `.onb-page` chrome so the layout doesn't shift
// when real content arrives: the `.onb-hero` band (title, subtitle, three
// stat counters, search + CTA), the `.onb-notice` info aside, and three
// `.onb-section` blocks (Pending / Active / Offboarded) each with ~2–4
// `.onb-row` skeleton rows.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/onboarding.css";

import { Skeleton } from "@/components/ui/skeleton";

// One onboarding-section skeleton: header block + N user-row skeletons.
function OnbSectionSkeleton({ rowCount }: { rowCount: number }) {
  return (
    <div className="onb-section">
      {/* Section head: icon + title + count chip + sub */}
      <div className="onb-section-head">
        <Skeleton width={16} height={16} radius="var(--radius-sm)" style={{ marginTop: 4 }} />
        <div className="onb-section-text">
          <Skeleton width={120} height={14} radius="var(--radius-md)" />
          <Skeleton width={280} height={10} radius="var(--radius-md)" style={{ marginTop: 4 }} />
        </div>
      </div>
      {/* Section body: bordered card with user rows */}
      <div className="onb-section-body">
        {Array.from({ length: rowCount }).map((_, i) => (
          <div key={i} className="onb-row">
            {/* Person cell: avatar + name + email */}
            <div className="onb-person">
              <Skeleton width={32} height={32} radius="var(--radius-full)" />
              <div className="onb-person-text">
                <Skeleton width={120} height={13} radius="var(--radius-md)" />
                <Skeleton
                  width={160}
                  height={10}
                  radius="var(--radius-md)"
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
            {/* Role chip */}
            <Skeleton width={72} height={12} radius="var(--radius-md)" />
            {/* Meta (invite / last sign-in timestamp) */}
            <Skeleton width={80} height={10} radius="var(--radius-md)" />
            {/* Status pill */}
            <Skeleton width={80} height={22} radius="var(--radius-full)" />
            {/* Row actions (⋯ menu trigger) */}
            <div className="onb-row-actions">
              <Skeleton width={28} height={28} radius="var(--radius-sm)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingSettingsLoading() {
  return (
    <div className="onb-page" aria-hidden="true">
      {/* Hero band */}
      <header className="onb-hero">
        <div>
          {/* Title + subtitle */}
          <Skeleton width={180} height={28} radius="var(--radius-md)" />
          <Skeleton width={340} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          {/* Stat counters */}
          <div className="onb-hero-stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="onb-hero-stat">
                <Skeleton width={32} height={28} radius="var(--radius-md)" />
                <Skeleton
                  width={56}
                  height={10}
                  radius="var(--radius-md)"
                  style={{ marginTop: 4 }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Search input + Onboard CTA */}
        <div className="onb-hero-cta">
          <Skeleton width={240} height={40} radius="var(--radius-xs)" />
          <Skeleton width={120} height={40} radius="var(--radius-sm)" />
        </div>
      </header>

      {/* Owners-only notice */}
      <div className="onb-notice">
        <Skeleton width={16} height={16} radius="var(--radius-sm)" style={{ marginTop: 4 }} />
        <Skeleton width={380} height={10} radius="var(--radius-md)" />
      </div>

      {/* Pending / Active / Offboarded sections */}
      <OnbSectionSkeleton rowCount={2} />
      <OnbSectionSkeleton rowCount={4} />
      <OnbSectionSkeleton rowCount={2} />
    </div>
  );
}
