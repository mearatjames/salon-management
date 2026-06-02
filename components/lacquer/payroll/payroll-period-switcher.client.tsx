"use client";

// PayrollPeriodSwitcher — the segmented control of recent pay periods in the
// Payroll page header (US1).
//
// Each chip is a `next/link` that rewrites the `?offset=` search param; the
// open period (`offset 0`) drops the param so the current-period URL stays the
// clean `/payroll`. Switching the period re-fetches the server component.
//
// Each `<Link>` keeps its real `href` (bookmarkable, middle-click, a11y) but
// intercepts the plain left-click into `usePendingNav().navigate(href)` so the
// soft navigation runs inside a transition and the sibling `<PendingContent>`
// ledger region dims while the re-fetch is in flight (issue #197). The clicked
// chip also flips active instantly via local optimistic state, resetting once
// the new server `activeOffset` arrives.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `.pr-period-switch` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I).

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { PayPeriodRef } from "@/lib/payroll/window";
import { isModifiedClick, usePendingNav } from "@/components/lacquer/pending-nav.client";

export type PayrollPeriodSwitcherProps = {
  /** The recent periods, newest first (the open period leads). */
  periods: readonly PayPeriodRef[];
  /** The currently-displayed period's `offset`. */
  activeOffset: number;
};

export function PayrollPeriodSwitcher({ periods, activeOffset }: PayrollPeriodSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { navigate } = usePendingNav();

  // Optimistic offset so the clicked chip activates instantly while the
  // transition still holds the OLD `activeOffset`; cleared the moment a new
  // resolved `activeOffset` arrives via the render-phase reset pattern (React
  // "You Might Not Need an Effect") — no effect, no stale highlight.
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [prevActiveOffset, setPrevActiveOffset] = useState(activeOffset);
  if (activeOffset !== prevActiveOffset) {
    setPrevActiveOffset(activeOffset);
    setOptimistic(null);
  }
  const shownOffset = optimistic ?? activeOffset;

  // Build a `/payroll?…` href that swaps `offset` and keeps `filter`.
  const hrefFor = (offset: number): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === 0) params.delete("offset");
    else params.set("offset", String(offset));
    const query = params.toString();
    return query === "" ? pathname : `${pathname}?${query}`;
  };

  const handleClick = (e: MouseEvent, offset: number, href: string) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    setOptimistic(offset);
    navigate(href);
  };

  return (
    <div
      className="pr-period-switch"
      role="group"
      aria-label="Pay period"
      data-slot="period-switcher"
    >
      {periods.map((period) => {
        const isActive = period.offset === shownOffset;
        const href = hrefFor(period.offset);
        return (
          <Link
            key={period.offset}
            href={href}
            className={isActive ? "on" : undefined}
            data-offset={period.offset}
            aria-current={isActive ? "true" : undefined}
            onClick={(e) => handleClick(e, period.offset, href)}
          >
            <span className={`dot ${period.status === "closed" ? "closed" : "open"}`} />
            {period.shortLabel}
          </Link>
        );
      })}
    </div>
  );
}
