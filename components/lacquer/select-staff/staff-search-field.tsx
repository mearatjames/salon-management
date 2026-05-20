// StaffSearchField — controlled search input for the `/select-staff` roster.
//
// 044-select-staff-redesign US2 (T014): a single search field that narrows the
// avatar grid to display-name matches as the operator types. It lives in the
// pinned header region of `select-staff-screen.client.tsx` (above the grid,
// outside the single scrollable region) so it stays visible while the grid
// scrolls (FR-006).
//
// Controlled: the screen owns the `query` state; this component only renders
// the input and forwards `onChange`. No debounce, no submit — the filter is a
// synchronous `useMemo` in the screen (research R5).
//
// Adapted from `SearchField` in
// `design-system/prototypes/select-staff/select-staff-variants.jsx` (Option D).
// All visuals trace to `select-staff-*` classes in `styles/select-staff.css`
// (the search-field rules ship in T016 — Constitution Principle I, FR-026).
// Lucide `Search` icon only, 1.5px stroke.

import { Search } from "lucide-react";

export type StaffSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export function StaffSearchField({ value, onChange }: StaffSearchFieldProps) {
  return (
    <div className="select-staff-search">
      <Search className="select-staff-search-icon" size={16} aria-hidden="true" />
      <input
        type="text"
        className="select-staff-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search staff"
      />
    </div>
  );
}
