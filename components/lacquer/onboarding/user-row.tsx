// UserRow — a single roster line inside one of the three onboarding
// sections (Pending / Active / Offboarded).
//
// Server Component. Layout-only — the menu (Resend / Reset PIN /
// Offboard / Remove etc.) lands as a `menu?: ReactNode` slot so the
// page can compose the right client island per bucket without forcing
// every row through the client boundary.
//
// Avatar uses the shared StaffAvatar (tinted by color_token). Status
// badge color tracks the lifecycle state. Person + role + status +
// metadata grid mirrors `design-system/prototypes/onboarding/Components.jsx`.

import type { ReactNode } from "react";

import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";
import { roleLabel } from "@/components/lacquer/staff/initials";

import type { OnboardingUser } from "@/app/(studio)/settings/onboarding/_types";

type Props = {
  user: OnboardingUser;
  /** What to render in the meta column (e.g. "Invited 2h ago"). */
  meta: string;
  menu?: ReactNode;
};

function statusBadge(state: OnboardingUser["state"]) {
  switch (state) {
    case "invited":
      return { className: "onb-status onb-status-invited", label: "Pending" };
    case "active":
      return { className: "onb-status onb-status-active", label: "Active" };
    case "offboarded":
      return { className: "onb-status onb-status-offboard", label: "Offboarded" };
  }
}

export function UserRow({ user, meta, menu }: Props) {
  const badge = statusBadge(user.state);
  return (
    <div
      className={`onb-row${user.is_you ? " is-you" : ""}`}
      data-user-id={user.id}
      data-state={user.state}
    >
      <div className="onb-person">
        <StaffAvatar name={user.display_name} colorToken={user.color_token} size={32} />
        <div className="onb-person-text">
          <div className="onb-person-name">
            {user.display_name}
            {user.is_you ? <span className="onb-you-tag">You</span> : null}
          </div>
          <div className="onb-person-email">{user.email ?? "—"}</div>
        </div>
      </div>
      <div className="onb-role-chip">
        <span
          className="onb-role-dot"
          style={{ background: `var(${user.color_token})` }}
          aria-hidden
        />
        {roleLabel(user.role)}
      </div>
      <div className="onb-meta">{meta}</div>
      <div>
        <span className={badge.className}>
          <span className="dot" aria-hidden />
          {badge.label}
        </span>
      </div>
      <div className="onb-row-actions">{menu}</div>
    </div>
  );
}
