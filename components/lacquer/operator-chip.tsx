// Inline pill showing the active operator: avatar circle (initials, color
// derived from `color_token`), display name, role chip.
//
// Server component — renders inside the studio topbar. Wrap in <OperatorMenu>
// to make it the dropdown trigger.

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

export function OperatorChip({ staff, ...buttonProps }: OperatorChipProps) {
  return (
    <button
      type="button"
      data-slot="operator-chip"
      {...buttonProps}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-full)",
        padding: "var(--space-1) var(--space-3) var(--space-1) var(--space-1)",
        color: "var(--card-foreground)",
        cursor: "pointer",
        fontSize: "var(--text-sm)",
        ...(buttonProps.style ?? {}),
      }}
    >
      <InitialsAvatar name={staff.display_name} colorToken={staff.color_token} size={32} />
      <span style={{ fontWeight: 500 }}>{staff.display_name}</span>
      <span
        style={{
          fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          background: "var(--muted)",
          color: "var(--muted-foreground)",
          padding: "var(--space-1) var(--space-2)",
          borderRadius: "var(--radius-full)",
        }}
      >
        {roleLabel(staff.role)}
      </span>
      <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
