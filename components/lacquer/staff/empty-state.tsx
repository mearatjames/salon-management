"use client";

// EmptyState — the right-column "Select a staff member" placeholder.
// Copy is verbatim from
// `specs/006-staff-management/contracts/ui.contract.md` § Empty-states.
//
// 023-staff-payout-exemptions § US4 / FR-020 adds a second exported helper,
// `StaffNoResultsState`, used by the staff table's empty-row slot. The copy
// is filter-aware and includes a "Switch to Active" inline link in the
// Inactive-but-empty case. Because that helper needs an onClick handler,
// the whole file graduates to a client component — Server Components can
// still render `<StaffEmptyState />` directly (Next 16 allows the parent
// page.tsx to mount it as a client child).

import { Users } from "lucide-react";

import type { StaffFilter } from "@/components/lacquer/staff/roster-filter-chips.client";

export function StaffEmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        padding: "var(--space-12) var(--space-6)",
        textAlign: "center",
        color: "var(--muted-foreground)",
      }}
      data-slot="staff-empty-state"
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-12)",
          height: "var(--space-12)",
          borderRadius: "var(--radius-full)",
          background: "oklch(from var(--muted-foreground) l c h / 0.10)",
          color: "var(--muted-foreground)",
        }}
      >
        <Users size={24} strokeWidth={1.5} />
      </span>
      <h3
        style={{
          margin: 0,
          fontSize: "var(--text-lg)",
          fontWeight: 600,
          color: "var(--foreground)",
        }}
      >
        Select a staff member
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          maxWidth: "calc(var(--space-16) * 5)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        Choose someone from the roster to edit their details, change their role, or update their
        PIN.
      </p>
    </div>
  );
}

/**
 * StaffNoResultsState — the empty row inside the roster table when the
 * current filter (+ optional search term) yields zero rows. Copy is
 * filter-aware per FR-020.
 *
 * For `filter='inactive'` the message is followed by a "Switch to Active"
 * inline link button. Clicking it calls `onFilterChange('active')` which
 * the table client island wires back into both its local state AND the
 * chip bar's persisted selection.
 *
 * For `filter='active'` and `filter='all'` no link is rendered (those copy
 * variants have no clear actionable next step from this surface).
 */
export type StaffNoResultsStateProps = {
  /** Current roster filter; drives the copy variant. */
  filter: StaffFilter;
  /** If the user typed a search term that produced zero rows, show the
   *  legacy "No staff match your search." copy instead of the filter
   *  variants — search-empty is a different intent than filter-empty. */
  hasSearchTerm: boolean;
  /** Switch-to-active handler (only invoked from the Inactive variant). */
  onFilterChange: (filter: StaffFilter) => void;
};

export function StaffNoResultsState({
  filter,
  hasSearchTerm,
  onFilterChange,
}: StaffNoResultsStateProps) {
  // Search-empty takes priority over filter-empty: if the user is actively
  // searching, the relevant feedback is "your search matched nothing,"
  // not "the salon has no inactive staff."
  if (hasSearchTerm) {
    return (
      <p
        data-slot="staff-no-results"
        style={{
          margin: 0,
          padding: "var(--space-8) var(--space-4)",
          textAlign: "center",
          fontSize: "var(--text-sm)",
          color: "var(--muted-foreground)",
        }}
      >
        No staff match your search.
      </p>
    );
  }

  let copy: string;
  if (filter === "active") {
    copy = "No active staff.";
  } else if (filter === "inactive") {
    copy = "No inactive staff.";
  } else {
    copy = "No staff in this salon yet.";
  }

  return (
    <p
      data-slot="staff-no-results"
      style={{
        margin: 0,
        padding: "var(--space-8) var(--space-4)",
        textAlign: "center",
        fontSize: "var(--text-sm)",
        color: "var(--muted-foreground)",
      }}
    >
      {copy}
      {filter === "inactive" ? (
        <>
          {" "}
          <button
            type="button"
            data-slot="staff-switch-to-active"
            onClick={() => onFilterChange("active")}
            className="staff-switch-to-active-link"
          >
            Switch to Active
          </button>
        </>
      ) : null}
    </p>
  );
}
