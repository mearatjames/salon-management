# Contract: Studio Sidebar Nav Items

**Feature**: 007-left-panel-nav
**Phase**: 1
**Audience**: implementers of `components/lacquer/sidebar/*` and authors of any future feature that wants to register a destination in the studio left panel.

This feature exposes one internal contract: the **shape, ordering, and matching rules** of the studio sidebar's nav configuration. There is no public HTTP API, no Server Action, no DB contract — the panel is a pure UI shell.

---

## 1. Nav config TypeScript shape

The canonical config lives in `components/lacquer/sidebar/nav-items.ts` and conforms exactly to:

```ts
import type { LucideIcon } from "lucide-react";

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
```

### Invariants (enforced at module load by a `validateNavConfig()` helper called from `nav-items.ts`)

1. All `id` values across `top` and every `groups[*].items` are unique.
2. If `item.disabled === true` then `item.href === null`.
3. If `item.disabled` is `false`/absent then `item.href` is a non-empty string, starts with `/`, and does NOT end with `/`.
4. All `href` values across the whole config are unique (no two items point at the same route).
5. The render order is the array order — implementations MUST NOT sort.

`validateNavConfig()` throws synchronously on any violation. The unit test asserts that mutating the config to violate any invariant causes the throw.

---

## 2. Canonical config — the v1 config

This is the data the v1 implementation MUST ship with (any deviation is a spec change):

| Position | Group | id | label | icon | href | disabled |
|---|---|---|---|---|---|---|
| top | – | `dashboard` | Dashboard | `Home` | `/dashboard` | – |
| group 1 | Workspace | `schedule` | Schedule | `Calendar` | `/calendar` | – |
| | | `clients` | Clients | `Users` | `/clients` | – |
| | | `services` | Services | `Sparkles` | `null` | `true` |
| | | `checkout` | Checkout | `DollarSign` | `/checkout` | – |
| | | `walkin` | Walk-in | `Footprints` | `/walkin` | – |
| group 2 | Operations | `end-of-day` | End of Day Cash | `Banknote` | `/end-of-day` | – |
| | | `day-report` | Day Report | `FileBarChart` | `null` | `true` |
| | | `settings` | Settings | `Settings` | `/settings` | – |

---

## 3. Active-state matching contract

A pure helper, exported and unit-tested:

```ts
export function isActiveSection(pathname: string, href: string | null): boolean;
```

**Behaviour table**:

| `pathname` | `href` | `isActiveSection` returns |
|---|---|---|
| `"/calendar"` | `"/calendar"` | `true` (exact) |
| `"/settings/staff"` | `"/settings"` | `true` (nested) |
| `"/settings"` | `"/settings"` | `true` (exact, no trailing slash) |
| `"/settings/"` | `"/settings"` | `true` (trailing slash normalized) |
| `"/dashboard"` | `"/calendar"` | `false` (unrelated) |
| `"/calendar-archive"` | `"/calendar"` | `false` (prefix collision avoided — must be `/calendar` or `/calendar/...`) |
| `"/"` | `"/dashboard"` | `false` (root is not the dashboard) |
| anything | `null` | `false` (disabled items are never active) |
| `""` | `"/calendar"` | `false` (empty pathname is never active) |

**Implementation skeleton** (the implementer can deviate as long as the table holds):

```ts
export function isActiveSection(pathname: string, href: string | null): boolean {
  if (!href || !pathname) return false;
  const p = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return p === href || p.startsWith(href + "/");
}
```

The Vitest spec (`tests/unit/sidebar/is-active-section.test.ts`) asserts every row of the table.

---

## 4. Rendered DOM contract (for tests + accessibility)

Each nav item, regardless of state, renders with these stable attributes:

| Attribute | Value | Purpose |
|---|---|---|
| `data-nav-id` | the item's `id` | E2E test selector |
| `data-active` | `"true"` or `"false"` | Test assertion + CSS state hook |
| `data-disabled` | `"true"` or `"false"` | Test assertion + CSS state hook |
| `aria-current` | `"page"` when active, otherwise omitted | A11y for active state |
| `aria-disabled` | `"true"` when disabled, otherwise omitted | A11y for disabled state |
| `title` | the item's `label` when sidebar is collapsed; otherwise omitted | Native tooltip when icon-only |

The sidebar root renders:

| Attribute | Value | Purpose |
|---|---|---|
| Element | `<aside>` | Landmark |
| `aria-label` | `"Studio navigation"` | A11y label |
| `data-collapsed` | `"true"` or `"false"` | Mirrors `<html data-studio-sidebar-collapsed>`; lets the e2e assert state directly |

The collapse toggle renders:

| Attribute | Value | Purpose |
|---|---|---|
| Element | `<button type="button">` | Semantic |
| `aria-label` | `"Collapse sidebar"` when expanded, `"Expand sidebar"` when collapsed | A11y |
| `aria-controls` | the sidebar `<aside>`'s id | A11y |

---

## 5. Out of scope for this contract

- HTTP / Server Action endpoints: this feature exposes none.
- Database schema or RLS: this feature changes none.
- Real-time / Realtime channels: none subscribed.
- Tracking / analytics events: none emitted (can be added in a later feature without changing this contract).
- Tooltip component / portal: native `title` is sufficient for v1. A future tooltip primitive could replace `title` without changing the nav-item config shape.
