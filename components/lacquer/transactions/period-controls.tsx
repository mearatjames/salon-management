"use client";

// PeriodControls — the period toggle + range stepper for the Transactions page.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (the `tp-period-row` block). The prototype drove the window from client
// state; here every control is a `next/link` `<Link>` that rewrites the
// `?period=&offset=` search params, so each window is a bookmarkable URL and
// stepping re-fetches the server component (research R3 — mirrors the
// dashboard's `force-dynamic` "re-query on every navigation" model).
//
// Client Component: each `<Link>` keeps its real `href` (bookmarkable,
// middle-click, a11y) but intercepts the plain left-click into
// `usePendingNav().navigate(href)` so the soft navigation runs inside a
// transition and the sibling `<PendingContent>` data region dims while the
// re-fetch is in flight (issue #197). The clicked granularity also flips active
// instantly via local optimistic state — no dead-click feeling — and resets
// once the new server `window` arrives.
//
// Chrome lives in `styles/transactions.css` under `.tp-period*` / `.tp-range`.
// The "next" arrow is disabled at `isCurrent` (forward stepping past the
// current period is forbidden — data-model.md § 4). Icons are Lucide at 13px,
// 1.5px stroke (Constitution Principle I).

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PeriodGranularity, PeriodWindow } from "@/lib/transactions/window";
import { isModifiedClick, usePendingNav } from "@/components/lacquer/pending-nav.client";

export type PeriodControlsProps = {
  window: PeriodWindow;
};

const PERIOD_TABS: readonly { granularity: PeriodGranularity; label: string }[] = [
  { granularity: "today", label: "Today" },
  { granularity: "week", label: "This week" },
  { granularity: "month", label: "This month" },
];

// Builds a `/transactions?period=&offset=` href. `offset` is omitted when 0 so
// the current-period URL stays the clean `?period=…`.
function periodHref(granularity: PeriodGranularity, offset: number): string {
  const params = new URLSearchParams({ period: granularity });
  if (offset !== 0) params.set("offset", String(offset));
  return `/transactions?${params.toString()}`;
}

export function PeriodControls({ window }: PeriodControlsProps) {
  const { navigate } = usePendingNav();

  // Optimistic granularity so the clicked tab activates instantly: while the
  // transition is pending the server still holds the OLD `window`, so without
  // this the active tab wouldn't move until the re-fetch resolved. Cleared the
  // moment a new resolved `window` arrives (the re-fetch landed, or browser
  // back/forward) via the render-phase reset pattern — React "You Might Not
  // Need an Effect" — so there is no effect and no stale highlight.
  const [optimistic, setOptimistic] = useState<PeriodGranularity | null>(null);
  const windowKey = `${window.granularity}:${window.offset}`;
  const [prevWindowKey, setPrevWindowKey] = useState(windowKey);
  if (windowKey !== prevWindowKey) {
    setPrevWindowKey(windowKey);
    setOptimistic(null);
  }
  const activeGranularity = optimistic ?? window.granularity;

  // Switching the granularity always resets to the current period (offset 0):
  // a "this week"/"this month" offset has no meaning under a new granularity.
  const handleTab = (e: MouseEvent, granularity: PeriodGranularity) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    setOptimistic(granularity);
    navigate(periodHref(granularity, 0));
  };

  const handleStep = (e: MouseEvent, href: string) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <div className="tp-period-row" data-slot="period-controls">
      <div className="tx-period" role="group" aria-label="Period">
        {PERIOD_TABS.map((tab) => {
          const active = activeGranularity === tab.granularity;
          return (
            <Link
              key={tab.granularity}
              href={periodHref(tab.granularity, 0)}
              className={active ? "active" : undefined}
              data-period={tab.granularity}
              aria-current={active ? "true" : undefined}
              onClick={(e) => handleTab(e, tab.granularity)}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="tp-range">
        <Link
          className="arrow"
          href={periodHref(window.granularity, window.offset - 1)}
          aria-label="Previous period"
          data-slot="period-prev"
          onClick={(e) => handleStep(e, periodHref(window.granularity, window.offset - 1))}
        >
          <ChevronLeft size={13} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <span className="lbl" data-slot="period-label">
          {window.label} · {window.rangeLabel}
        </span>
        {window.isCurrent ? (
          <span
            className="arrow"
            aria-disabled="true"
            aria-label="Next period"
            data-slot="period-next"
            data-disabled="true"
          >
            <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
          </span>
        ) : (
          <Link
            className="arrow"
            href={periodHref(window.granularity, window.offset + 1)}
            aria-label="Next period"
            data-slot="period-next"
            onClick={(e) => handleStep(e, periodHref(window.granularity, window.offset + 1))}
          >
            <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
