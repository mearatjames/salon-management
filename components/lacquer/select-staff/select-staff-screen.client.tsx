"use client";

// SelectStaffScreen — client component. The full-viewport device surface for
// `/select-staff` (the `(device)` route group, full-bleed via
// `app/(device)/layout.tsx`).
//
// 044-select-staff-redesign: this replaces the old `(auth)` two-panel layout
// with a dedicated device screen — a header row (brand wordmark + sign-out)
// over a scrollable body that holds the title block and, in later phases, the
// avatar grid / search field / PIN-keypad modal.
//
// This file is the typecheck anchor for `app/(device)/select-staff/page.tsx`
// (T006): the `StaffRosterEntry` type and `SelectStaffScreenProps` are final.
//
// US1 (T009/T012) added the avatar grid + the PIN-entry modal. US2 (search)
// and US3 (recovery polish) extend this file further.
//
// All visuals trace to `select-staff-*` classes in `styles/select-staff.css`.
// Brand wordmark idiom adapted from `components/lacquer/auth-brand-panel.tsx`
// (the LacquerMark SVG). Lucide icons only, 1.5px stroke.

import { useMemo, useState } from "react";

import { signOut } from "@/app/(studio)/actions";
import { LacquerMark } from "@/components/lacquer/lacquer-mark";

import { PinEntryModal } from "./pin-entry-modal.client";
import { StaffAvatarTile } from "./staff-avatar-tile";
import { StaffSearchField } from "./staff-search-field";

// One active, PIN-enabled staff row in the roster. The query in `page.tsx`
// (T006) selects exactly these columns; later phases consume the full shape.
export type StaffRosterEntry = {
  id: string;
  display_name: string;
  role: string;
  color_token: string;
  pin_reset_admin_at: string | null;
};

export type SelectStaffScreenProps = {
  roster: StaffRosterEntry[];
  next: string;
};

// Role display order for the grid (FR-004). The RSC query's `order by role`
// is alphabetical (front_desk, manager, owner, technician) — wrong; the grid
// sorts client-side by this priority, then display_name within each role.
const ROLE_PRIORITY: Record<string, number> = {
  owner: 0,
  manager: 1,
  technician: 2,
  front_desk: 3,
};

function roleRank(role: string): number {
  return ROLE_PRIORITY[role] ?? Number.MAX_SAFE_INTEGER;
}

export function SelectStaffScreen({ roster, next }: SelectStaffScreenProps) {
  // Which tile's modal is open. `null` = grid only, no modal. A tile's
  // `onSelect` sets it; the modal's `onClose` clears it.
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  // US2 search state — the controlled `<StaffSearchField>` drives this. The
  // filter is a synchronous `useMemo` (no debounce, no submit — research R5);
  // the roster is ≤25 rows so per-keystroke filtering is free.
  const [query, setQuery] = useState("");

  // Filter FIRST, then sort — so filtered results keep the same role-then-name
  // order as the full grid (data-model.md). Case-insensitive partial match on
  // `display_name` only — role labels are not matched (FR-008, FR-009).
  const sortedRoster = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? roster.filter((s) => s.display_name.toLowerCase().includes(needle))
      : roster;
    return [...filtered].sort((a, b) => {
      const byRole = roleRank(a.role) - roleRank(b.role);
      if (byRole !== 0) return byRole;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [roster, query]);

  // Empty-result state: the query is non-empty but matched nothing. An empty
  // *roster* is handled upstream by the RSC page's "No staff configured"
  // guidance — distinct from this no-match case (FR-010).
  const noMatches = query.trim().length > 0 && sortedRoster.length === 0;

  const selectedRow = selectedStaffId
    ? (roster.find((s) => s.id === selectedStaffId) ?? null)
    : null;

  return (
    <div className="select-staff-screen">
      <header className="select-staff-header">
        <div className="select-staff-brand">
          <LacquerMark size={26} />
          <span className="select-staff-brand-name">Tang Nails Studio</span>
        </div>
        {/* A Server Action used as a form `action` works inside a client
            component — this ends the device session (FR-007). */}
        <form action={signOut}>
          <button type="submit" className="select-staff-signout">
            Sign out
          </button>
        </form>
      </header>

      <div className="select-staff-body">
        <div className="select-staff-screen-header">
          <h1 className="select-staff-title">Who&apos;s using this device?</h1>
          <p className="select-staff-subtitle">Tap your avatar to sign in</p>
        </div>

        {/* The search field is pinned BELOW the title/subtitle and ABOVE the
            avatar grid — a sibling of the grid, not a child of it. The grid
            is the single scrollable region, so keeping the search field
            outside it means it stays visible while the grid scrolls
            (FR-006, research R5/R7). */}
        <StaffSearchField value={query} onChange={setQuery} />

        {/* The avatar grid is the single scrollable region — the header and
            the search field stay pinned when the grid overflows (FR-006,
            research R7). On a no-match query the grid is replaced by an
            empty-result message that names the typed text (FR-010). */}
        {noMatches ? (
          <p className="select-staff-empty-result">No staff match &ldquo;{query}&rdquo;</p>
        ) : (
          <div className="select-staff-grid">
            {sortedRoster.map((staff) => (
              <StaffAvatarTile key={staff.id} staff={staff} onSelect={setSelectedStaffId} />
            ))}
          </div>
        )}
      </div>

      {/* PIN-entry modal — mounted only while a tile is selected. Threading
          `next` end to end: page.tsx → here → modal → submitPin FormData
          (FR-025). */}
      {selectedRow && (
        <PinEntryModal staff={selectedRow} next={next} onClose={() => setSelectedStaffId(null)} />
      )}
    </div>
  );
}
