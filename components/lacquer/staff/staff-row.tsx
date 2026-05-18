// StaffRow — one row in the roster table. Server Component (pure layout).
//
// 023-staff-payout-exemptions § US5 redesign: each row now leads with a small
// status dot (success/muted tint), follows with the avatar + a two-line
// name/role stack, and trails with a tinted PIN pill, a tabular "Added MMM
// YYYY" date, and a mobile chevron that only shows under 900px wide. The
// inactive row's reduced opacity, the selected-row left accent bar, and the
// mobile chevron visibility are all CSS-driven via `data-active` /
// `data-selected` attributes + the `.staff-row*` rules in
// `styles/settings.css`. The row is still a `<Link>` that toggles the
// `?selected=` query param so the edit panel surfaces.
//
// All visual values resolve to Lacquer tokens — the only inline style left
// is `position: relative` (needed for the CSS `::before` accent bar) which
// pairs with the class-driven background, padding, gap, and typography.

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";
import { StatusDot } from "@/components/lacquer/staff/status-dot";

import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";

const ROLE_LABEL: Record<RosterStaff["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};

// Format `Added <Mon YYYY>` using locale-stable English month names so the
// e2e spec can assert exact text regardless of the runner's locale. We
// intentionally don't use `Intl.DateTimeFormat` here even though research
// § R5 mentions it — the test harness assertion expects the same English
// month abbreviation across CI locales, so the hand-rolled MONTHS array
// guarantees that. The Intl call would still resolve to "May" in en-US but
// would change under a different `LANG` env.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  return (
    <Link
      href={href}
      className="staff-row"
      // `aria-pressed` is documented on button-like rows in ui.contract.md;
      // we satisfy the toggle semantics without colliding with `role="row"`
      // by leaving the implicit link role and exposing the selected state
      // via `aria-current` (which screenreaders announce as "current item").
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={isSelected}
      data-staff-id={staff.id}
      data-selected={isSelected ? "true" : "false"}
      data-active={staff.active ? "true" : "false"}
    >
      <StatusDot active={staff.active} />
      <StaffAvatar name={staff.display_name} colorToken={staff.color_token} size={40} />
      <span className="staff-row-identity">
        <span className="staff-row-name">{staff.display_name}</span>
        <span className="staff-row-role">{ROLE_LABEL[staff.role]}</span>
      </span>
      {staff.pin_set ? (
        <span
          className="staff-pin-pill staff-pin-pill--set"
          data-slot="staff-pin-pill"
          aria-label="PIN set"
        >
          Set
        </span>
      ) : (
        <span
          className="staff-pin-pill staff-pin-pill--no-pin"
          data-slot="staff-pin-pill"
          aria-label="No PIN set"
        >
          No PIN
        </span>
      )}
      <span className="staff-row-added-date" data-slot="staff-row-added-date">
        {formatAddedDate(staff.created_at)}
      </span>
      <span className="staff-row-chevron" data-slot="staff-row-chevron" aria-hidden="true">
        <ChevronRight size={16} strokeWidth={1.5} />
      </span>
    </Link>
  );
}
