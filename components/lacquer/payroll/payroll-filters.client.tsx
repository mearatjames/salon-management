"use client";

// PayrollFilters — the All techs / To pay / Paid tab filter on the Payroll
// ledger (US1).
//
// Each tab is a `next/link` that rewrites the `?filter=` search param, so the
// active filter is a bookmarkable URL and switching re-fetches the server
// component (mirrors the Report page's period controls).
//
// Each `<Link>` keeps its real `href` (bookmarkable, middle-click, a11y) but
// intercepts the plain left-click into `usePendingNav().navigate(href)` so the
// soft navigation runs inside a transition and the sibling `<PendingContent>`
// ledger region dims while the re-fetch is in flight (issue #197). The clicked
// tab also flips active instantly via local optimistic state, resetting once
// the new server `active` filter arrives.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `.pl-tabs` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I).

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { formatCount } from "@/lib/dashboard/format";
import type { PayrollFilter } from "@/lib/payroll/window";
import { isModifiedClick, usePendingNav } from "@/components/lacquer/pending-nav.client";

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
  const { navigate } = usePendingNav();

  // Optimistic filter so the clicked tab activates instantly while the
  // transition still holds the OLD `active`; cleared the moment a new resolved
  // `active` filter arrives via the render-phase reset pattern (React "You
  // Might Not Need an Effect") — no effect, no stale highlight.
  const [optimistic, setOptimistic] = useState<PayrollFilter | null>(null);
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    setOptimistic(null);
  }
  const shownActive = optimistic ?? active;

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

  const handleClick = (e: MouseEvent, filter: PayrollFilter, href: string) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    setOptimistic(filter);
    navigate(href);
  };

  return (
    <div className="pl-tabs" role="group" aria-label="Filter techs" data-slot="payroll-filters">
      {TABS.map((tab) => {
        const isActive = tab.filter === shownActive;
        const href = hrefFor(tab.filter);
        return (
          <Link
            key={tab.filter}
            href={href}
            className={isActive ? "pl-tab on" : "pl-tab"}
            data-filter={tab.filter}
            aria-current={isActive ? "true" : undefined}
            onClick={(e) => handleClick(e, tab.filter, href)}
          >
            {tab.label} <span className="ct">{formatCount(countFor(tab.filter))}</span>
          </Link>
        );
      })}
    </div>
  );
}
