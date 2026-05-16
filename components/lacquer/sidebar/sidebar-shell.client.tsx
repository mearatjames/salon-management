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
  children?: ReactNode;
};

// `localStorage` key + DOM attribute contract for collapse persistence — see
// specs/007-left-panel-nav/research.md § R3. The pre-paint init script in
// `app/(studio)/layout.tsx` seeds `<html data-studio-sidebar-collapsed>` from
// the stored value before first paint; this component is the runtime owner.
const STORAGE_KEY = "tn:studio:sidebar-collapsed";
const ATTR = "data-studio-sidebar-collapsed";

// `useSyncExternalStore` keeps the toggle's icon in lockstep with the `<html>`
// attribute (the single source of truth) without triggering the
// `react-hooks/set-state-in-effect` lint rule, and without producing a
// hydration mismatch — `getServerSnapshot` returns the SSR default (false),
// and the client snapshot reads the attribute that the pre-paint init script
// has already seeded.
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

export function SidebarShell({ children }: SidebarShellProps) {
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
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Safari private mode etc. — preference reverts on reload, which is fine.
    }
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

      {NAV_CONFIG.top.map((item) => renderItem(item, isActiveSection(pathname, item.href)))}

      <hr className="studio-nav-divider" />

      {NAV_CONFIG.groups.map((group) => (
        <div key={group.id}>
          <div className="studio-nav-section">{group.label}</div>
          {group.items.map((item) => renderItem(item, isActiveSection(pathname, item.href)))}
        </div>
      ))}

      <div className="studio-sidebar-spacer" />

      {children}
    </>
  );
}
