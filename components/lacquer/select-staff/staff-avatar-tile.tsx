// StaffAvatarTile — presentational avatar tile for the `/select-staff` grid.
//
// 044-select-staff-redesign US1 (T008): one tile per eligible staff member in
// the avatar grid. A `<button>` rendering a token-tinted initials avatar, the
// display name (single-line, truncated for the long-name edge case), and the
// role label. Tapping it fires `onSelect(staff.id)` — the screen owns the
// selection state and opens the PIN-entry modal.
//
// Adapted from `VariantAvatarGrid` in
// `design-system/prototypes/select-staff/select-staff-variants.jsx` (Option D)
// and the now-deleted `components/lacquer/staff-tile.tsx` (the `initials` /
// `roleLabel` / admin-PIN-reset-notice idioms). All visuals trace to
// `select-staff-*` classes in `styles/select-staff.css` (Constitution
// Principle I — FR-026).
//
// When `staff.pin_reset_admin_at` is non-null an owner has reset this staff
// member's PIN — the tile shows a Lucide `Info` badge with a tooltip telling
// them to try the new PIN (US3 / T020, FR-021).

import { Info } from "lucide-react";

import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { roleLabel } from "@/components/lacquer/staff/initials";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { StaffRosterEntry } from "./select-staff-screen.client";

// Exact copy for the admin-PIN-reset notice (FR-021) — used as both the
// tooltip text and the badge's accessible label.
const PIN_RESET_NOTICE = "Your PIN was reset by an owner. Try your new PIN.";

export type StaffAvatarTileProps = {
  staff: StaffRosterEntry;
  onSelect: (staffId: string) => void;
};

export function StaffAvatarTile({ staff, onSelect }: StaffAvatarTileProps) {
  const pinResetNotice = staff.pin_reset_admin_at !== null;

  return (
    <button
      type="button"
      className="select-staff-tile"
      data-staff-id={staff.id}
      onClick={() => onSelect(staff.id)}
    >
      <InitialsAvatar
        name={staff.display_name}
        colorToken={staff.color_token}
        size={56}
        className="select-staff-tile-avatar"
      />
      <span className="select-staff-tile-name">{staff.display_name}</span>
      <span className="select-staff-tile-role">{roleLabel(staff.role)}</span>
      {pinResetNotice && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="select-staff-tile-pin-reset"
                data-slot="pin-reset-notice"
                data-staff-name={staff.display_name}
                aria-label={PIN_RESET_NOTICE}
              >
                <Info size={16} strokeWidth={1.5} aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{PIN_RESET_NOTICE}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </button>
  );
}
