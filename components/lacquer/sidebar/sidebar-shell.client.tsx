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
// Renders the full shell shape: header slot + nav list + spacer + footer slot
// (children). The nav list itself (Dashboard + divider + grouped items, with
// URL-driven active state) lives in the shared `<StudioNavList>` so the mobile
// drawer (`MobileNav`) renders the exact same navigation.
//
// Constitution Principle II: pure UI plumbing — no business logic, no
// mutations, no auth. Just the collapse toggle + the shared nav list.
//
// DOM attribute contract: see
//   specs/007-left-panel-nav/contracts/nav-items.contract.md § 4.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { StudioNavList } from "./studio-nav-list";

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

export function SidebarShell({ role, children }: SidebarShellProps) {
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

      <StudioNavList role={role} />

      <div className="studio-sidebar-spacer" />

      {children}
    </>
  );
}
