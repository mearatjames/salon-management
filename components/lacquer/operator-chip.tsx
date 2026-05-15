// Inline pill showing the active operator: avatar circle (initials, color
// derived from `color_token`), display name, role chip.
//
// Server component — renders inside the studio topbar. Wrap in <OperatorMenu>
// to make it the dropdown trigger.

import type { ButtonHTMLAttributes } from "react";

import { ChevronDown } from "lucide-react";

type StaffShape = {
  display_name: string;
  role: string;
  color_token: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "technician":
      return "Tech";
    case "front_desk":
      return "Front desk";
    default:
      return role;
  }
}

export type OperatorChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  staff: StaffShape;
};

export function OperatorChip({ staff, ...buttonProps }: OperatorChipProps) {
  const colorVar = `var(${staff.color_token})`;

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
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-8)",
          height: "var(--space-8)",
          borderRadius: "var(--radius-full)",
          background: colorVar,
          color: "var(--primary-foreground)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-wide)",
        }}
      >
        {initials(staff.display_name)}
      </span>
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
