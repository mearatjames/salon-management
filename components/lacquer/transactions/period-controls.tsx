// PeriodControls — the period toggle + range stepper for the Transactions page.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (the `tp-period-row` block). The prototype drove the window from client
// state; here every control is a `next/link` `<Link>` that rewrites the
// `?period=&offset=` search params, so each window is a bookmarkable URL and
// stepping re-fetches the server component (research R3 — mirrors the
// dashboard's `force-dynamic` "re-query on every navigation" model).
//
// Server Component. Chrome lives in `styles/transactions.css` under
// `.tp-period*` / `.tp-range`. The "next" arrow is disabled at `isCurrent`
// (forward stepping past the current period is forbidden — data-model.md § 4).
// Icons are Lucide at 13px, 1.5px stroke (Constitution Principle I).

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PeriodGranularity, PeriodWindow } from "@/lib/transactions/window";

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
  // Switching the granularity always resets to the current period (offset 0):
  // a "this week"/"this month" offset has no meaning under a new granularity.
  return (
    <div className="tp-period-row" data-slot="period-controls">
      <div className="tx-period" role="group" aria-label="Period">
        {PERIOD_TABS.map((tab) => {
          const active = window.granularity === tab.granularity;
          return (
            <Link
              key={tab.granularity}
              href={periodHref(tab.granularity, 0)}
              className={active ? "active" : undefined}
              data-period={tab.granularity}
              aria-current={active ? "true" : undefined}
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
          >
            <ChevronRight size={13} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
