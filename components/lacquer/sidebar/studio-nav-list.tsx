"use client";

// Shared studio nav list — the Dashboard item, hairline divider, and grouped
// items, rendered identically in the persistent left sidebar (`SidebarShell`)
// and the mobile off-canvas drawer (`MobileNav`). Owns the URL-driven active
// state via `usePathname()`, so both surfaces highlight the current section the
// same way.
//
// `emitNavId` controls the `data-nav-id` e2e test hook. The sidebar emits it
// (specs select `[data-nav-id="…"]`, some unscoped — see sidebar/payroll/
// transactions specs); the drawer does NOT, so the two in-DOM copies never
// collide under Playwright's strict locator mode. The drawer is still
// targetable via `.studio-drawer` + `href`.
//
// `onNavigate` fires when a real (non-disabled) item is tapped — the drawer
// passes its close handler so a nav tap dismisses the overlay before the route
// transition.
//
// Constitution Principle II: pure UI plumbing — no business logic, no
// mutations, no auth. Just pathname → `data-active` mapping. DOM attribute
// contract: see specs/007-left-panel-nav/contracts/nav-items.contract.md § 4.

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveSection } from "./is-active-section";
import { NAV_CONFIG, type NavItem } from "./nav-items";

export type StudioNavListProps = {
  /**
   * The viewer's studio role. Items carrying a `roles` allow-list that does
   * not include this role are skipped (not rendered). UX only — the route's
   * own redirect is the security boundary (Constitution Principle II).
   */
  role: string;
  /** Fired when a routable item is tapped (drawer passes its close handler). */
  onNavigate?: () => void;
  /** Emit the `data-nav-id` test hook. Default true; the drawer sets false. */
  emitNavId?: boolean;
};

// An item is rendered when it is not `hidden` (its page isn't built yet) AND
// it is visible to the viewer's role — it carries no `roles` allow-list, or
// its allow-list includes the viewer's role.
function isItemVisible(item: NavItem, role: string): boolean {
  if (item.hidden === true) return false;
  return item.roles === undefined || item.roles.includes(role as never);
}

function renderItem(item: NavItem, isActive: boolean, emitNavId: boolean, onNavigate?: () => void) {
  const Icon = item.icon;

  if (item.disabled === true) {
    return (
      <span
        key={item.id}
        className="studio-nav-item"
        data-nav-id={emitNavId ? item.id : undefined}
        data-active="false"
        data-disabled="true"
        aria-disabled="true"
        tabIndex={-1}
        title="Coming soon"
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="studio-nav-label">{item.label}</span>
      </span>
    );
  }

  // Non-disabled items per the contract MUST have a non-null href.
  // `validateNavConfig` enforces this at module load.
  const href = item.href as string;

  return (
    <Link
      key={item.id}
      href={href}
      className="studio-nav-item"
      data-nav-id={emitNavId ? item.id : undefined}
      data-active={String(isActive)}
      data-disabled="false"
      aria-current={isActive ? "page" : undefined}
      title={item.label}
      onClick={onNavigate}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span className="studio-nav-label">{item.label}</span>
    </Link>
  );
}

export function StudioNavList({ role, onNavigate, emitNavId = true }: StudioNavListProps) {
  const pathname = usePathname() ?? "";

  return (
    <>
      {NAV_CONFIG.top
        .filter((item) => isItemVisible(item, role))
        .map((item) =>
          renderItem(item, isActiveSection(pathname, item.href), emitNavId, onNavigate)
        )}

      <hr className="studio-nav-divider" />

      {NAV_CONFIG.groups.map((group) => (
        <div key={group.id}>
          <div className="studio-nav-section">{group.label}</div>
          {group.items
            .filter((item) => isItemVisible(item, role))
            .map((item) =>
              renderItem(item, isActiveSection(pathname, item.href), emitNavId, onNavigate)
            )}
        </div>
      ))}
    </>
  );
}
