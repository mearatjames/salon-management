// Inline pill showing the active operator: avatar circle (initials, color
// derived from `color_token`), display name, role chip.
//
// Server component — renders inside the studio topbar. Wrap in <OperatorMenu>
// to make it the dropdown trigger.
//
// Styled via the `.studio-operator*` classes in `styles/studio.css` (not inline
// styles) so the phone breakpoint can condense it to the avatar alone: a
// media-query rule can override a class but never an inline `style`. The
// name / role / caret carry their own class hooks for that reason.

import type { ButtonHTMLAttributes } from "react";

import { ChevronDown } from "lucide-react";

import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { roleLabel } from "@/components/lacquer/staff/initials";

type StaffShape = {
  display_name: string;
  role: string;
  color_token: string;
};

export type OperatorChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  staff: StaffShape;
};

export function OperatorChip({ staff, className, ...buttonProps }: OperatorChipProps) {
  return (
    <button
      type="button"
      data-slot="operator-chip"
      className={["studio-operator", className].filter(Boolean).join(" ")}
      {...buttonProps}
    >
      <InitialsAvatar name={staff.display_name} colorToken={staff.color_token} size={32} />
      <span className="studio-operator-name">{staff.display_name}</span>
      <span className="studio-operator-role">{roleLabel(staff.role)}</span>
      <ChevronDown
        className="studio-operator-caret"
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </button>
  );
}
