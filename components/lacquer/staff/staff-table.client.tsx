"use client";

// StaffTable — client island that owns the search query and the roster
// filter state. Receives a pre-sorted roster from the page Server Component,
// applies the in-memory filter helper, and renders the search input, the
// chip bar (Active / Inactive / All), the table, and the empty-state row.
//
// 023-staff-payout-exemptions § US4 — the previous show-inactive Switch
// (storage key `tn:settings:staff:show-inactive`) is replaced by the three
// filter chips (storage key `tn:settings:staff:filter`). The summary line
// is removed in this pass — the chip counts already convey the same info
// (Active 3 · Inactive 0 · All 3).
//
// All visuals trace to Lacquer tokens.

import { useCallback, useMemo, useState } from "react";

import { Search } from "lucide-react";

import { AddStaffButton } from "@/components/lacquer/staff/add-staff-button.client";
import { StaffNoResultsState } from "@/components/lacquer/staff/empty-state";
import {
  RosterFilterChips,
  type StaffFilter,
} from "@/components/lacquer/staff/roster-filter-chips.client";
import { StaffRow } from "@/components/lacquer/staff/staff-row";
import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";
import type { StudioRole } from "@/app/(studio)/settings/staff/permissions";

export type StaffTableProps = {
  roster: RosterStaff[];
  selectedId: string | null;
  /** Operator's role — drives the Add wizard's role-option scope (US2). */
  operatorRole: StudioRole;
  /** 023-staff-payout-exemptions / US4 — per-status counts for the chip bar.
   *  Optional only for backwards compatibility with intermediate phases; the
   *  page always passes it once US4 is wired. Defaults derive from `roster`
   *  if absent. */
  counts?: { all: number; active: number; inactive: number };
};

function buildHref(currentId: string, selectedId: string | null): string {
  if (selectedId === currentId) {
    return "/settings/staff";
  }
  return `/settings/staff?selected=${encodeURIComponent(currentId)}`;
}

export function StaffTable({ roster, selectedId, operatorRole, counts }: StaffTableProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");

  // SSR-safe default matches `RosterFilterChips`' SSR default. The chip
  // bar's post-mount useEffect fires `onFilterChange` to graduate this
  // state to the persisted value (if any).
  const [filter, setFilter] = useState<StaffFilter>("active");

  // Memoize the handler so `RosterFilterChips`' one-shot useEffect doesn't
  // see a new identity on every render and re-fire (its effect deps are
  // intentionally empty, so the identity change wouldn't refire anyway —
  // but keeping the reference stable is the right invariant).
  const handleFilterChange = useCallback((next: StaffFilter) => {
    setFilter(next);
  }, []);

  const effectiveCounts = useMemo(() => {
    if (counts) return counts;
    const active = roster.filter((r) => r.active).length;
    return { all: roster.length, active, inactive: roster.length - active };
  }, [counts, roster]);

  const visible = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return roster.filter((row) => {
      // Filter predicate (chip).
      if (filter === "active" && !row.active) return false;
      if (filter === "inactive" && row.active) return false;
      // 'all' matches everything.
      // Search predicate composes with the filter predicate.
      if (needle.length === 0) return true;
      return row.display_name.toLowerCase().includes(needle);
    });
  }, [roster, searchQuery, filter]);

  const hasSearchTerm = searchQuery.trim().length > 0;

  return (
    <section
      data-slot="staff-table"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Top control bar: chip bar + search + Add staff CTA. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <RosterFilterChips
          value={filter}
          counts={effectiveCounts}
          onFilterChange={handleFilterChange}
        />
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flex: "1 1 auto",
            justifyContent: "flex-end",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-2) var(--space-3)",
              background: "var(--card)",
              border: "1px solid var(--input)",
              borderRadius: "var(--radius-xs)",
              color: "var(--muted-foreground)",
              minWidth: `calc(var(--space-16) * 4)`,
              flex: "1 1 auto",
              maxWidth: `calc(var(--space-16) * 6)`,
            }}
          >
            <Search size={16} strokeWidth={1.5} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search staff"
              aria-label="Search staff"
              data-slot="staff-search-input"
              style={{
                flex: "1 1 auto",
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: "var(--text-sm)",
                color: "var(--foreground)",
                minWidth: 0,
              }}
            />
          </label>
          <AddStaffButton operatorRole={operatorRole} />
        </div>
      </div>

      {/* Roster rows or filter-aware empty-state. */}
      <div
        role="table"
        aria-label="Staff roster"
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {visible.length === 0 ? (
          <StaffNoResultsState
            filter={filter}
            hasSearchTerm={hasSearchTerm}
            onFilterChange={handleFilterChange}
          />
        ) : (
          visible.map((row) => (
            <StaffRow
              key={row.id}
              staff={row}
              isSelected={row.id === selectedId}
              href={buildHref(row.id, selectedId)}
            />
          ))
        )}
      </div>
    </section>
  );
}
