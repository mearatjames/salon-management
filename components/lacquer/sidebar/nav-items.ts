import {
  Banknote,
  Calendar,
  DollarSign,
  FileBarChart,
  Footprints,
  Home,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  /**
   * Stable identifier. MUST be unique across the entire config. Used as React
   * key and as the e2e test selector via `data-nav-id="<id>"`.
   */
  id: string;

  /**
   * The human-readable label. Rendered next to the icon when the sidebar is
   * expanded, and emitted as the native `title` attribute when collapsed so it
   * surfaces as a tooltip on hover. Sentence case (Lacquer copy rule).
   */
  label: string;

  /**
   * A Lucide icon component (imported as a named export from `lucide-react`).
   * Rendered at size 16, strokeWidth 1.5 (Constitution Principle I).
   */
  icon: LucideIcon;

  /**
   * The top-level URL segment owned by this item. `null` ONLY when the item
   * is a disabled placeholder. Otherwise MUST be a non-empty string starting
   * with `/` and MUST NOT contain a trailing slash.
   *
   * Active-match rule: an item is "active" when
   *   pathname === href  ||  pathname.startsWith(href + "/")
   * — i.e. matches any nested route under the section.
   */
  href: string | null;

  /**
   * True when the item should be rendered (to preserve the prototype's IA)
   * but is not yet routable. Renders as an `<span>` with `aria-disabled="true"`,
   * `data-disabled="true"`, no hover, no click handler. MUST imply `href === null`.
   */
  disabled?: boolean;
};

export type NavGroup = {
  /** Stable group id, unique across the whole config. */
  id: string;
  /**
   * Group section header text, shown above the items when the sidebar is
   * expanded. Hidden (CSS `display: none`) when collapsed — the prototype
   * substitutes a hairline divider in that mode.
   */
  label: string;
  items: NavItem[];
};

export type NavConfig = {
  /** Items rendered ABOVE the first group, separated by a hairline rule. */
  top: NavItem[];
  /** Ordered list of groups, each rendered with its own section header. */
  groups: NavGroup[];
};

/**
 * Canonical studio sidebar nav config — matches
 * `specs/007-left-panel-nav/contracts/nav-items.contract.md` § 2 exactly.
 * Render order is the array order; do NOT sort.
 */
export const NAV_CONFIG: NavConfig = {
  top: [{ id: "dashboard", label: "Dashboard", icon: Home, href: "/dashboard" }],
  groups: [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { id: "schedule", label: "Schedule", icon: Calendar, href: "/calendar" },
        { id: "clients", label: "Clients", icon: Users, href: "/clients" },
        { id: "services", label: "Services", icon: Sparkles, href: "/services" },
        // Cart-building entry — `/checkout` renders the ephemeral cart screen
        // (no eager ticket create). A ticket row is materialized only when
        // the operator commits a payment.
        { id: "checkout", label: "Checkout", icon: DollarSign, href: "/checkout" },
        { id: "walkin", label: "Walk-in", icon: Footprints, href: "/walkin" },
      ],
    },
    {
      id: "operations",
      label: "Operations",
      items: [
        { id: "end-of-day", label: "End of Day Cash", icon: Banknote, href: "/end-of-day" },
        { id: "day-report", label: "Day Report", icon: FileBarChart, href: null, disabled: true },
        { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
      ],
    },
  ],
};

/**
 * Validates the invariants from the contract § 1:
 *   1. All `id` values are unique across `top` and every `groups[*].items`.
 *   2. If `disabled === true` then `href === null`.
 *   3. If `disabled` is `false`/absent then `href` is a non-empty string,
 *      starts with `/`, and does NOT end with `/`.
 *   4. All `href` values across the whole config are unique.
 *
 * Throws synchronously on any violation so a bad config breaks module load
 * (and the unit test that mutates the config sees the throw).
 */
export function validateNavConfig(config: NavConfig): void {
  const seenIds = new Set<string>();
  const seenHrefs = new Set<string>();
  const groupIds = new Set<string>();

  const allItems: NavItem[] = [...config.top, ...config.groups.flatMap((g) => g.items)];

  for (const group of config.groups) {
    if (groupIds.has(group.id)) {
      throw new Error(`NAV_CONFIG: duplicate group id "${group.id}"`);
    }
    groupIds.add(group.id);
  }

  for (const item of allItems) {
    if (seenIds.has(item.id)) {
      throw new Error(`NAV_CONFIG: duplicate nav item id "${item.id}"`);
    }
    seenIds.add(item.id);

    if (item.disabled === true) {
      if (item.href !== null) {
        throw new Error(
          `NAV_CONFIG: item "${item.id}" is disabled but href is not null (got ${JSON.stringify(item.href)})`
        );
      }
      continue;
    }

    if (typeof item.href !== "string" || item.href.length === 0) {
      throw new Error(
        `NAV_CONFIG: item "${item.id}" must have a non-empty string href when not disabled`
      );
    }
    if (!item.href.startsWith("/")) {
      throw new Error(`NAV_CONFIG: item "${item.id}" href "${item.href}" must start with "/"`);
    }
    if (item.href.length > 1 && item.href.endsWith("/")) {
      throw new Error(`NAV_CONFIG: item "${item.id}" href "${item.href}" must NOT end with "/"`);
    }
    if (seenHrefs.has(item.href)) {
      throw new Error(`NAV_CONFIG: duplicate href "${item.href}"`);
    }
    seenHrefs.add(item.href);
  }
}

validateNavConfig(NAV_CONFIG);
