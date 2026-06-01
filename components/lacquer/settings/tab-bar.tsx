"use client";

// Settings tab bar — Staff · Onboarding · Square.
//
// Deviation from task T015's "Server Component" guidance: making this a
// small client island (~30 lines) is cleaner than the alternatives
// (`headers().get("x-pathname")` requires middleware support; a child
// client wrapper splits one trivial component into two). The bundle cost
// is < 1 KB.
//
// Services lives at `/services` (top-level studio destination, reached via
// the sidebar) rather than under Settings — see feature 008-services-catalog.
//
// All visual values resolve to Lacquer tokens via `styles/settings.css`.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  id: string;
  label: string;
  href: string;
};

const TABS: readonly Tab[] = [
  { id: "staff", label: "Staff", href: "/settings/staff" },
  // 012-user-onboarding FR-001 — Onboarding tab sits after Staff. The
  // page enforces the owner-only role gate inline.
  { id: "onboarding", label: "Onboarding", href: "/settings/onboarding" },
  // 015-square-terminal-payment FR-001 — Square tab gates owner/manager
  // inline on the page; layout stays open.
  { id: "square", label: "Square", href: "/settings/square" },
] as const;

export function TabBar() {
  const pathname = usePathname() ?? "/settings/staff";

  // On phone portrait (#169) the tab bar is a horizontal scroller (see the
  // `@media (max-width: 640px)` block in styles/settings.css). Scroll the
  // active tab into view on navigation so a tab past the right edge is never
  // stranded off-screen. `block: "nearest"` keeps it from nudging the page
  // vertically; on desktop the bar doesn't overflow, so this is a no-op.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} className="settings-tab-bar" aria-label="Settings sections">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            data-active={isActive ? "true" : "false"}
            style={{
              // Mirror prototype `.settings-tab` — fixed 46px height, the
              // active underline aligns with the bar's bottom border via
              // `margin-bottom: -1px` so it cleanly replaces the divider.
              height: "calc(var(--space-12) - var(--space-1) * 0.5)",
              padding: "0 var(--space-4)",
              display: "inline-flex",
              alignItems: "center",
              fontSize: "var(--text-sm, 14px)",
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
              textDecoration: "none",
              borderBottom: isActive ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: "-1px",
              transition:
                "color 150ms var(--ease-out, ease-out), border-color 150ms var(--ease-out, ease-out)",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
