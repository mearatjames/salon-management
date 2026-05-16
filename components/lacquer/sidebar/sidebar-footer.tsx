// Studio sidebar footer — Server Component.
//
// Renders the operator chip at the bottom of the left navigation panel: an
// avatar tile in the staff member's color token plus their display name and
// role label. Mirrors the topbar `OperatorChip` (without the dropdown affordance)
// so a degraded auth session never crashes the chrome.
//
// Degraded fallback (research.md § R8): when `degraded === true`, render a
// neutral grey tile sized identically to the active state so the layout doesn't
// shift once the session resolves.
//
// Visual rules: `.studio-sidebar-footer*` classes in `styles/studio.css`. The
// 26px avatar tile from the prototype is approximated as `var(--space-6)`
// (24px) to stay on the 4/8/12/16/20/24/32/40/48/64 scale — Constitution
// Principle I forbids introducing a new off-scale token. 24 is the closest
// on-scale value to 26 (the alternative, 32, would visually dominate the
// 56px collapsed rail).

import { initials, roleLabel } from "@/components/lacquer/staff/initials";

export type SidebarFooterProps = {
  staff: {
    display_name: string;
    role: string;
    color_token: string;
  };
  degraded: boolean;
};

export function SidebarFooter({ staff, degraded }: SidebarFooterProps) {
  if (degraded) {
    return (
      <div
        className="studio-sidebar-footer studio-sidebar-footer-degraded"
        title="Loading operator"
      >
        <span
          aria-hidden="true"
          className="studio-sidebar-footer-avatar"
          style={{
            background: "var(--muted)",
            color: "var(--muted-foreground)",
          }}
        />
      </div>
    );
  }

  const colorVar = `var(${staff.color_token})`;
  const label = roleLabel(staff.role);

  return (
    <div className="studio-sidebar-footer" title={`${staff.display_name} · ${label}`}>
      <span
        aria-hidden="true"
        className="studio-sidebar-footer-avatar"
        style={{
          background: colorVar,
          color: "var(--primary-foreground)",
        }}
      >
        {initials(staff.display_name)}
      </span>
      <div className="studio-sidebar-footer-text">
        <div className="studio-sidebar-footer-name">{staff.display_name}</div>
        <div className="studio-sidebar-footer-role">{label}</div>
      </div>
    </div>
  );
}
