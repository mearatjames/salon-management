"use client";

// RosterFilterChips — three-pill segmented control used above the staff
// roster (Settings → Staff). Replaces the previous show-inactive Switch
// (storage key `tn:settings:staff:show-inactive` — removed entirely).
//
// Controlled component: the parent owns the canonical `value` and reacts
// to `onFilterChange`. This component owns only the post-mount hydration
// of the persisted localStorage value and the persistence write on each
// click. Keeping the state in the parent lets sibling surfaces (e.g. the
// empty-state's "Switch to Active" link) update the chip selection through
// the same `onFilterChange` callback without a second source of truth.
//
// State model (per research § R4):
//   - SSR + first paint: parent passes `value='active'` (SSR-safe default).
//   - After mount: read `tn:settings:staff:filter` from localStorage; if
//     it differs from the SSR default, emit it to the parent so the visible
//     roster matches the chip in the same render pass.
//   - User click: writes localStorage + emits to parent (parent re-renders
//     with the new `value`).
//
// Every value (radius, padding, color, font) traces to a token in
// `styles/tokens.css` / `styles/settings.css`. The component renders semantic
// class names only — visuals live in `styles/settings.css` under
// `.staff-filter-chips*` (T045).

import { useEffect, useRef } from "react";

export const STAFF_FILTER_STORAGE_KEY = "tn:settings:staff:filter";

export type StaffFilter = "all" | "active" | "inactive";

export type RosterFilterChipsProps = {
  /** Controlled value. The parent owns the canonical filter state so other
   *  surfaces (e.g. the empty-state "Switch to Active" link) can update
   *  this chip bar via `onFilterChange` without a second source of truth. */
  value: StaffFilter;
  /** Per-status row counts. Computed by the page Server Component and
   *  passed in so the chip labels stay in sync without an extra fetch. */
  counts: { all: number; active: number; inactive: number };
  /** Notified with the initial filter (after the post-mount localStorage
   *  read) AND every subsequent selection. The parent owns the table's
   *  filter predicate; this component owns only the UI + persistence. */
  onFilterChange: (filter: StaffFilter) => void;
};

function readStoredFilter(): StaffFilter | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STAFF_FILTER_STORAGE_KEY);
    if (stored === "all" || stored === "inactive" || stored === "active") {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredFilter(next: StaffFilter): void {
  try {
    window.localStorage.setItem(STAFF_FILTER_STORAGE_KEY, next);
  } catch {
    // non-fatal — Safari private mode etc.
  }
}

const CHIPS: ReadonlyArray<{ value: StaffFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

export function RosterFilterChips({ value, counts, onFilterChange }: RosterFilterChipsProps) {
  // Track whether we've already done the post-mount hydration so we don't
  // double-emit on subsequent renders. We use a ref instead of a state
  // because flipping it shouldn't trigger a re-render.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = readStoredFilter();
    // If the persisted filter differs from the current (SSR) value, emit
    // it to the parent so the visible roster and chip selection graduate
    // to the persisted state in a single render pass.
    if (stored && stored !== value) {
      onFilterChange(stored);
    }
    // Intentional: we want this to run exactly once after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (next: StaffFilter) => {
    writeStoredFilter(next);
    onFilterChange(next);
  };

  return (
    <div className="staff-filter-chips" role="group" aria-label="Filter staff by status">
      {CHIPS.map((chip) => {
        const selected = chip.value === value;
        const count = counts[chip.value];
        return (
          <button
            key={chip.value}
            type="button"
            className="staff-filter-chip"
            data-slot="staff-filter-chip"
            data-filter={chip.value}
            data-selected={selected ? "true" : "false"}
            aria-pressed={selected}
            onClick={() => handleSelect(chip.value)}
          >
            <span className="staff-filter-chip-label">{chip.label}</span>
            <span className="staff-filter-chip-count" data-slot="staff-filter-chip-count">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
