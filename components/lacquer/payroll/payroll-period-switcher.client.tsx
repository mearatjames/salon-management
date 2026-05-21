"use client";

// PayrollPeriodSwitcher — the segmented control of recent pay periods in the
// Payroll page header (US1).
//
// Each chip is a `next/link` that rewrites the `?offset=` search param; the
// open period (`offset 0`) drops the param so the current-period URL stays the
// clean `/payroll`. Switching the period re-fetches the server component.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `.pr-period-switch` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { PayPeriodRef } from "@/lib/payroll/window";

export type PayrollPeriodSwitcherProps = {
  /** The recent periods, newest first (the open period leads). */
  periods: readonly PayPeriodRef[];
  /** The currently-displayed period's `offset`. */
  activeOffset: number;
};

export function PayrollPeriodSwitcher({ periods, activeOffset }: PayrollPeriodSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build a `/payroll?…` href that swaps `offset` and keeps `filter`.
  const hrefFor = (offset: number): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === 0) params.delete("offset");
    else params.set("offset", String(offset));
    const query = params.toString();
    return query === "" ? pathname : `${pathname}?${query}`;
  };

  return (
    <div
      className="pr-period-switch"
      role="group"
      aria-label="Pay period"
      data-slot="period-switcher"
    >
      {periods.map((period) => {
        const isActive = period.offset === activeOffset;
        return (
          <Link
            key={period.offset}
            href={hrefFor(period.offset)}
            className={isActive ? "on" : undefined}
            data-offset={period.offset}
            aria-current={isActive ? "true" : undefined}
          >
            <span className={`dot ${period.status === "closed" ? "closed" : "open"}`} />
            {period.shortLabel}
          </Link>
        );
      })}
    </div>
  );
}
