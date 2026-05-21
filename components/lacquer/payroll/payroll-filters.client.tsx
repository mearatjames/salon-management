"use client";

// PayrollFilters — the All techs / To pay / Paid tab filter on the Payroll
// ledger (US1).
//
// Each tab is a `next/link` that rewrites the `?filter=` search param, so the
// active filter is a bookmarkable URL and switching re-fetches the server
// component (mirrors the Report page's period controls). Client component only
// because `usePathname` / `useSearchParams` build the hrefs while preserving
// the current `?offset=`.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `.pl-tabs` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I).

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { formatCount } from "@/lib/dashboard/format";
import type { PayrollFilter } from "@/lib/payroll/window";

export type PayrollFiltersProps = {
  active: PayrollFilter;
  counts: { all: number; toPay: number; paid: number };
};

const TABS: readonly { filter: PayrollFilter; label: string }[] = [
  { filter: "all", label: "All techs" },
  { filter: "to-pay", label: "To pay" },
  { filter: "paid", label: "Paid" },
];

export function PayrollFilters({ active, counts }: PayrollFiltersProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build a `/payroll?…` href that swaps `filter` and keeps `offset`.
  const hrefFor = (filter: PayrollFilter): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "all") params.delete("filter");
    else params.set("filter", filter);
    const query = params.toString();
    return query === "" ? pathname : `${pathname}?${query}`;
  };

  const countFor = (filter: PayrollFilter): number =>
    filter === "all" ? counts.all : filter === "to-pay" ? counts.toPay : counts.paid;

  return (
    <div className="pl-tabs" role="group" aria-label="Filter techs" data-slot="payroll-filters">
      {TABS.map((tab) => {
        const isActive = tab.filter === active;
        return (
          <Link
            key={tab.filter}
            href={hrefFor(tab.filter)}
            className={isActive ? "pl-tab on" : "pl-tab"}
            data-filter={tab.filter}
            aria-current={isActive ? "true" : undefined}
          >
            {tab.label} <span className="ct">{formatCount(countFor(tab.filter))}</span>
          </Link>
        );
      })}
    </div>
  );
}
