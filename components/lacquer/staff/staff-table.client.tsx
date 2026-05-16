"use client";

// StaffTable — client island that owns the search query and the
// show-inactive toggle state. Receives a pre-sorted roster from the page
// Server Component, applies the in-memory filter helper, and renders the
// search input, the table, the empty-state row, and the "X active · Y
// total" summary. Per execution rule #6 (the simpler alternative chosen in
// tasks.md), this component also renders the Show-inactive Switch and the
// Add staff (US2 stub) button — the page-header.tsx Server Component owns
// only the static title, and this island provides the interactive controls
// inline. Noted as a deliberate deviation from T029.
//
// All visuals trace to Lacquer tokens.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { Search } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { AddStaffButton } from "@/components/lacquer/staff/add-staff-button.client";
import { StaffRow } from "@/components/lacquer/staff/staff-row";
import { filterStaff } from "@/app/(studio)/settings/staff/_filter";
import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";
import type { StudioRole } from "@/app/(studio)/settings/staff/permissions";

const SHOW_INACTIVE_KEY = "tn:settings:staff:show-inactive";

export type StaffTableProps = {
  roster: RosterStaff[];
  selectedId: string | null;
  /** Operator's role — drives the Add wizard's role-option scope (US2). */
  operatorRole: StudioRole;
};

function buildHref(currentId: string, selectedId: string | null): string {
  if (selectedId === currentId) {
    return "/settings/staff";
  }
  return `/settings/staff?selected=${encodeURIComponent(currentId)}`;
}

// `useSyncExternalStore` reads sessionStorage without a setState-in-effect
// cascade. Subscribes to the `storage` event so other tabs (unlikely on a
// salon iPad, but cheap to wire) stay in sync; SSR snapshot is `false` so
// the initial server render matches the post-hydration default.
function subscribeToStorage(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function readShowInactive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SHOW_INACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShowInactive(next: boolean): void {
  try {
    window.sessionStorage.setItem(SHOW_INACTIVE_KEY, next ? "1" : "0");
  } catch {
    // ignore — non-fatal.
  }
}

export function StaffTable({ roster, selectedId, operatorRole }: StaffTableProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Track a local "version" counter so toggles in *this* tab notify the
  // store subscriber synchronously — the `storage` event only fires for
  // cross-tab updates, not same-tab writes.
  const [tick, setTick] = useState(0);
  const subscribe = useCallback(
    (notify: () => void) => {
      // Bump on storage events; the local-write path uses the tick counter
      // to force a fresh getSnapshot read on the next render.
      return subscribeToStorage(notify);
    },
    []
  );
  const getSnapshot = useCallback(() => {
    // Reading `tick` here keeps eslint happy and makes the subscription
    // re-evaluate after every local write below.
    void tick;
    return readShowInactive();
  }, [tick]);
  const showInactive = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const handleToggleShowInactive = (next: boolean) => {
    writeShowInactive(next);
    setTick((t) => t + 1);
  };

  const visible = useMemo(
    () => filterStaff(roster, searchQuery, showInactive),
    [roster, searchQuery, showInactive]
  );

  // Counts derive from the unfiltered roster so the summary doesn't jiggle
  // as the user types — "X active · Y total" describes the roster, not the
  // current search.
  const activeCount = roster.filter((r) => r.active).length;
  const totalCount = roster.length;

  return (
    <section
      data-slot="staff-table"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Top control bar: search + show-inactive toggle + Add staff CTA. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          justifyContent: "space-between",
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
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
            }}
            data-slot="show-inactive-toggle"
          >
            <Switch
              checked={showInactive}
              onCheckedChange={handleToggleShowInactive}
              aria-label="Show inactive"
            />
            <span>Show inactive</span>
          </label>
          <AddStaffButton operatorRole={operatorRole} />
        </div>
      </div>

      {/* Summary line — "X active · Y total". */}
      <p
        data-slot="staff-summary"
        className="tnum"
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          color: "var(--muted-foreground)",
        }}
      >
        {activeCount} active · {totalCount} total
      </p>

      {/* Roster rows or empty-state. */}
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
