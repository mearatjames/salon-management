// StaffRow — one row in the roster table. Server Component (pure layout).
// Renders avatar + name + role badge + PIN status + active badge + the
// formatted "Added Mon YYYY" date. The row is a `<Link>` that toggles the
// `?selected=` query param so the edit panel surfaces (US3 wires the actual
// panel; US1 just navigates with empty-state on the right).
//
// All visual values resolve to Lacquer tokens.

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/lacquer/badge";
import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";

import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";

const ROLE_LABEL: Record<RosterStaff["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};

// Format `Added <Mon YYYY>` using locale-stable English month names so the
// e2e spec can assert exact text regardless of the runner's locale.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatAddedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `Added ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type StaffRowProps = {
  staff: RosterStaff;
  isSelected: boolean;
  /** Pre-built href that toggles `?selected=` (page builds it once). */
  href: string;
};

export function StaffRow({ staff, isSelected, href }: StaffRowProps) {
  const muted = !staff.active;
  return (
    <Link
      href={href}
      // `aria-pressed` is documented on button-like rows in ui.contract.md;
      // we satisfy the toggle semantics without colliding with `role="row"`
      // by leaving the implicit link role and exposing the selected state
      // via `aria-current` (which screenreaders announce as "current item").
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={isSelected}
      data-staff-id={staff.id}
      data-selected={isSelected ? "true" : "false"}
      data-active={staff.active ? "true" : "false"}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto auto auto",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        background: isSelected ? "oklch(from var(--primary) l c h / 0.06)" : "var(--card)",
        borderBottom: "1px solid var(--border)",
        color: muted ? "var(--muted-foreground)" : "var(--card-foreground)",
        textDecoration: "none",
        opacity: muted ? 0.7 : 1,
        transition: "background 150ms var(--ease-out)",
      }}
    >
      <StaffAvatar name={staff.display_name} colorToken={staff.color_token} size={40} />
      <span
        style={{
          fontWeight: 500,
          fontSize: "var(--text-sm)",
          color: "var(--foreground)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {staff.display_name}
      </span>
      <Badge variant="muted">{ROLE_LABEL[staff.role]}</Badge>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          fontSize: "var(--text-xs)",
          color: "var(--muted-foreground)",
        }}
        aria-label={staff.pin_set ? "PIN set" : "No PIN set"}
      >
        {staff.pin_set ? (
          <>
            <ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>Set</span>
          </>
        ) : (
          <span aria-hidden="true">—</span>
        )}
      </span>
      <Badge variant={staff.active ? "success" : "muted"}>
        {staff.active ? "Active" : "Inactive"}
      </Badge>
      <span
        className="tnum"
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--muted-foreground)",
          whiteSpace: "nowrap",
        }}
      >
        {formatAddedDate(staff.created_at)}
      </span>
    </Link>
  );
}
