"use client";

// Settings tab bar — General · Staff · Notifications · Billing.
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

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  id: string;
  label: string;
  href: string;
};

const TABS: readonly Tab[] = [
  { id: "general", label: "General", href: "/settings/general" },
  { id: "staff", label: "Staff", href: "/settings/staff" },
  // 012-user-onboarding FR-001 — Onboarding tab sits between Staff and
  // Notifications. The page enforces the owner-only role gate inline.
  { id: "onboarding", label: "Onboarding", href: "/settings/onboarding" },
  { id: "notifications", label: "Notifications", href: "/settings/notifications" },
  { id: "billing", label: "Billing", href: "/settings/billing" },
] as const;

export function TabBar() {
  const pathname = usePathname() ?? "/settings/staff";
  return (
    <nav className="settings-tab-bar" aria-label="Settings sections">
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
