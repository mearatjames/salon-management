"use client";

// TechDetailNav — the tech-detail screen's top navigation row (US2).
//
// A back-to-ledger link on the left, prev/next tech links on the right. All
// three are real route links: back returns to `/payroll?offset=&filter=`,
// prev/next go to the sibling `/payroll/[staffId]?offset=&filter=` route,
// preserving the period params (R7 — real nested routes). Prev/next are
// disabled (rendered as inert spans) at the first / last ledger row.
//
// Client Component — it composes Next.js `<Link>`s and reads no server data;
// `"use client"` keeps it a self-contained navigation island. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (`PulseDetailScreen`'s
// `.pp-detail-topbar` block). Lucide icons, 1.5px stroke (Constitution I).

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

export type TechDetailNavProps = {
  /** The query-string suffix carrying the period params, e.g. "?offset=-1". */
  periodQuery: string;
  /** The period range label shown beside the back chevron. */
  periodLabel: string;
  /** Ledger-order neighbours — `null` disables that control. */
  prevStaffId: string | null;
  nextStaffId: string | null;
};

export function TechDetailNav({
  periodQuery,
  periodLabel,
  prevStaffId,
  nextStaffId,
}: TechDetailNavProps) {
  return (
    <div className="pp-detail-topbar" data-slot="tech-detail-nav">
      <Link href={`/payroll${periodQuery}`} className="pp-back" data-slot="back-to-ledger">
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        Payroll · {periodLabel}
      </Link>

      <div className="pp-detail-topbar-nav">
        {prevStaffId ? (
          <Link
            href={`/payroll/${prevStaffId}${periodQuery}`}
            className="pp-detail-nav-btn"
            data-slot="prev-tech"
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            Previous
          </Link>
        ) : (
          <span className="pp-detail-nav-btn" data-slot="prev-tech" aria-disabled="true">
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            Previous
          </span>
        )}
        {nextStaffId ? (
          <Link
            href={`/payroll/${nextStaffId}${periodQuery}`}
            className="pp-detail-nav-btn"
            data-slot="next-tech"
          >
            Next
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        ) : (
          <span className="pp-detail-nav-btn" data-slot="next-tech" aria-disabled="true">
            Next
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
