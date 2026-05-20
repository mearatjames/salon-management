"use client";

// Studio sidebar client island.
//
// Owns the URL-driven active state for every nav item via `usePathname()`.
// Imports `NAV_CONFIG` directly rather than receiving it through props —
// Lucide icon components are functions and React Server Components cannot
// serialize functions across the server→client boundary as plain props.
// Treating the static config as a module-level import keeps the icon
// references on the client where they're rendered.
//
// Renders the full shell shape: header slot + Dashboard + divider +
// grouped items + spacer + footer slot (children).
//
// Constitution Principle II: pure UI plumbing — no business logic, no
// mutations, no auth. Just pathname → `data-active` mapping.
//
// DOM attribute contract: see
//   specs/007-left-panel-nav/contracts/nav-items.contract.md § 4.
//
// Deviation note: the original task text suggested re-using the server
// `<NavItem>` component from inside this client island. Server Components
// cannot be rendered from Client Components in App Router, so we inline the
// same markup here (Option 1 in the phase brief). This matches the precedent
// in `components/lacquer/settings/tab-bar.tsx`. The server `<NavItem>` file
// is deleted in this phase.

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";

import { isActiveSection } from "./is-active-section";
import { NAV_CONFIG, type NavItem } from "./nav-items";

export type SidebarShellProps = {
  /**
   * The viewer's studio role. Items carrying a `roles` allow-list that does
   * not include this role are skipped (not rendered). UX only — the route's
   * own redirect is the security boundary (Constitution Principle II). In a
   * degraded session the layout passes the placeholder `"technician"`, so
   * role-gated items default to hidden.
   */
  role: string;
  children?: ReactNode;
};

// DOM attribute + cookie contract for collapse persistence. The cookie
// (`tn-studio-sidebar-collapsed=1|0`) is read by `app/layout.tsx` on the
// server so `<html data-studio-sidebar-collapsed>` ships with the correct
// initial value — no inline init script, no hydration mismatch. The toggle
// writes the cookie via `document.cookie`; this component is the runtime owner
// of the `<html>` attribute.
const COOKIE_NAME = "tn-studio-sidebar-collapsed";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year
const ATTR = "data-studio-sidebar-collapsed";

// `useSyncExternalStore` keeps the toggle's icon in lockstep with the `<html>`
// attribute (the single source of truth) without triggering the
// `react-hooks/set-state-in-effect` lint rule. `getServerSnapshot` reads from
// `document` is impossible on the server, so we return `false`; on the
// client, `getSnapshot` reads the attribute that the root layout has already
// rendered from the cookie — so the very first client snapshot matches what
// the user actually has persisted, and the icon renders correctly.
function subscribeToCollapsedAttr(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR],
  });
  return () => observer.disconnect();
}

function getCollapsedSnapshot(): boolean {
  return document.documentElement.getAttribute(ATTR) === "true";
}

function getCollapsedServerSnapshot(): boolean {
  return false;
}

function renderItem(item: NavItem, isActive: boolean) {
  const Icon = item.icon;

  if (item.disabled === true) {
    return (
      <span
        key={item.id}
        className="studio-nav-item"
        data-nav-id={item.id}
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
      data-nav-id={item.id}
      data-active={String(isActive)}
      data-disabled="false"
      aria-current={isActive ? "page" : undefined}
      title={item.label}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span className="studio-nav-label">{item.label}</span>
    </Link>
  );
}

// An item is visible to the viewer when it carries no `roles` allow-list, or
// when its allow-list includes the viewer's role.
function isVisibleToRole(item: NavItem, role: string): boolean {
  return item.roles === undefined || item.roles.includes(role as never);
}

export function SidebarShell({ role, children }: SidebarShellProps) {
  const pathname = usePathname() ?? "";

  // Reads the `<html data-studio-sidebar-collapsed>` attribute (seeded by the
  // pre-paint init script). SSR returns false to match the layout's default
  // markup so hydration sees a consistent tree; the client immediately reads
  // the real attribute once mounted.
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedAttr,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );

  const onToggle = () => {
    const next = !collapsed;
    // Mutate the attribute — the MutationObserver subscription pipes the
    // change back into React via useSyncExternalStore, so the icon swap and
    // the CSS-driven grid resize fire from the same source of truth.
    document.documentElement.setAttribute(ATTR, String(next));
    // Persist via cookie so the root layout can SSR the correct attribute on
    // the next request — no inline init script, no flash, no hydration diff.
    document.cookie = `${COOKIE_NAME}=${next ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  };

  return (
    <>
      <div className="studio-sidebar-header">
        <button
          type="button"
          className="studio-sidebar-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="studio-sidebar"
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>

      {NAV_CONFIG.top
        .filter((item) => isVisibleToRole(item, role))
        .map((item) => renderItem(item, isActiveSection(pathname, item.href)))}

      <hr className="studio-nav-divider" />

      {NAV_CONFIG.groups.map((group) => (
        <div key={group.id}>
          <div className="studio-nav-section">{group.label}</div>
          {group.items
            .filter((item) => isVisibleToRole(item, role))
            .map((item) => renderItem(item, isActiveSection(pathname, item.href)))}
        </div>
      ))}

      <div className="studio-sidebar-spacer" />

      {children}
    </>
  );
}
