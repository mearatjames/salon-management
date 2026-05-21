// FilterBar — the search / method / tech filter row above the KPI strip.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (the `tp-filters` block + `TechFilterPop`). Carries: a search input, the
// payment-method chip group with a live per-method count, a tech multi-select
// popover, the active-tech pills, and a "Clear filters" reset. v1 drops the
// prototype's status filter (the read model has no transaction status —
// analyze remediation), so this is search / method / tech only.
//
// Presentational: every filter value and every count is passed in by the
// owning client island (`transactions-view.client.tsx`); this component holds
// no filter state of its own, only the popover open/close UI state.
//
// The tech multi-select reuses the repo's shadcn `Popover` primitive (Radix
// under the hood) for outside-click / Escape dismissal and the 200ms open
// animation — no second popover library. Its `.tp-pop*` chrome comes from
// `styles/transactions.css`, which carries the tokenised versions of the
// prototype's popover rules; `PopoverContent`'s default Tailwind styling is
// cleared so only the token classes apply (Constitution Principle I).

"use client";

import { useState } from "react";
import { Banknote, ChevronDown, CreditCard, Gift, Search, X } from "lucide-react";

import type { Technician } from "@/lib/dashboard/aggregate";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// The method filter is "all" or one of the three payment methods. `"split"`
// is a render-time marker on a transaction, never a filter option.
export type MethodFilter = "all" | "card" | "cash" | "gift";

// Per-method match counts under the *other* active filters (search + tech),
// keyed by the chip ids. `all` is the total of the otherwise-filtered set.
export type MethodCounts = Record<MethodFilter, number>;

export type FilterBarProps = {
  /** Current search text (raw, untrimmed — the predicate trims). */
  search: string;
  onSearchChange: (next: string) => void;
  /** Current payment-method filter. */
  method: MethodFilter;
  onMethodChange: (next: MethodFilter) => void;
  /** Selected tech ids; empty ⇒ no tech filter. */
  techIds: readonly string[];
  onTechIdsChange: (next: readonly string[]) => void;
  /** Staff roster for the tech multi-select + active pills. */
  staff: readonly Technician[];
  /** Live per-method counts (composed with search + tech). */
  methodCounts: MethodCounts;
  /** True when any of search / method / tech is active. */
  hasActiveFilters: boolean;
  /** Resets every filter to its empty state. */
  onClearFilters: () => void;
};

const METHOD_CHIPS: ReadonlyArray<{
  id: MethodFilter;
  label: string;
  icon: typeof CreditCard | null;
}> = [
  { id: "all", label: "All", icon: null },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "gift", label: "Gift", icon: Gift },
];

export function FilterBar({
  search,
  onSearchChange,
  method,
  onMethodChange,
  techIds,
  onTechIdsChange,
  staff,
  methodCounts,
  hasActiveFilters,
  onClearFilters,
}: FilterBarProps) {
  const [techPopOpen, setTechPopOpen] = useState(false);

  function toggleTech(id: string): void {
    onTechIdsChange(techIds.includes(id) ? techIds.filter((x) => x !== id) : [...techIds, id]);
  }

  return (
    <div className="tp-filters" data-slot="transactions-filter-bar">
      <div className="tp-search">
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <input
          type="search"
          placeholder="Search client, service, or ID…"
          aria-label="Search transactions"
          data-slot="transactions-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="tp-chipgroup" role="group" aria-label="Filter by payment method">
        {METHOD_CHIPS.map((chip) => {
          const Icon = chip.icon;
          const active = method === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              className={active ? "active" : undefined}
              aria-pressed={active}
              data-slot="method-chip"
              data-method={chip.id}
              onClick={() => onMethodChange(chip.id)}
            >
              {Icon ? <Icon size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
              {chip.label}
              <span className="pill" data-slot="method-chip-count">
                {methodCounts[chip.id]}
              </span>
            </button>
          );
        })}
      </div>

      <Popover open={techPopOpen} onOpenChange={setTechPopOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={"tp-filter-btn" + (techIds.length > 0 ? " has-value" : "")}
            data-slot="tech-filter-trigger"
          >
            Tech
            {techIds.length > 0 ? <span className="ct">{techIds.length}</span> : null}
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="tp-pop" data-slot="tech-filter-pop">
          <div className="tp-pop-h">Filter by tech</div>
          {staff.map((tech) => {
            const on = techIds.includes(tech.id);
            return (
              <div
                key={tech.id}
                className="tp-pop-row"
                role="checkbox"
                aria-checked={on}
                tabIndex={0}
                data-slot="tech-filter-row"
                data-staff-id={tech.id}
                onClick={() => toggleTech(tech.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleTech(tech.id);
                  }
                }}
              >
                <span className={"check" + (on ? " on" : "")} aria-hidden="true">
                  {on ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  ) : null}
                </span>
                <InitialsAvatar name={tech.displayName} colorToken={tech.colorToken} size={20} />
                <span style={{ flex: 1 }}>{tech.displayName}</span>
              </div>
            );
          })}
          <div className="tp-pop-foot">
            <button type="button" className="tp-pop-clear" onClick={() => onTechIdsChange([])}>
              Clear all
            </button>
            <button type="button" className="tp-pop-clear" onClick={() => setTechPopOpen(false)}>
              Done
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="tp-filter-spacer" />

      {techIds.length > 0 ? (
        <div className="tp-active-filters" data-slot="active-tech-filters">
          {techIds.map((id) => {
            const tech = staff.find((s) => s.id === id);
            if (!tech) return null;
            return (
              <span key={id} className="tp-active-pill" data-slot="active-tech-pill">
                <InitialsAvatar name={tech.displayName} colorToken={tech.colorToken} size={14} />
                {tech.displayName.split(/\s+/)[0]}
                <button
                  type="button"
                  aria-label={`Remove ${tech.displayName}`}
                  onClick={() => onTechIdsChange(techIds.filter((x) => x !== id))}
                >
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {hasActiveFilters ? (
        <button
          type="button"
          className="tp-filter-btn"
          data-slot="clear-filters"
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
