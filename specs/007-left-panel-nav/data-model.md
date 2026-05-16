# Data Model: Studio Left Navigation Panel

**Feature**: 007-left-panel-nav
**Phase**: 1
**Date**: 2026-05-15

This feature introduces **no persistent data**. There are no new database tables, columns, indexes, RLS rules, audit-log actions, or settings rows. The only "data" is:

1. A static, in-memory navigation config (TypeScript constant).
2. A per-device UI preference held in browser `localStorage`.
3. Read-only consumption of existing studio session data.

Each is documented below.

---

## 1. Navigation Config (in-memory, build-time constant)

**Where it lives**: `components/lacquer/sidebar/nav-items.ts`

**Shape** (also defined in `contracts/nav-items.contract.md`):

```ts
export type NavItem = {
  /** Stable id used for React keys and test selectors. */
  id: string;
  /** Display label shown next to the icon (expanded) and as the title tooltip (collapsed). */
  label: string;
  /** Lucide icon name (imported via `lucide-react`). */
  icon: LucideIcon;
  /**
   * Top-level URL segment owned by this item. The item is active when the current
   * pathname equals this value or starts with `<href>/`. Set to `null` for disabled
   * placeholders that have no real route.
   */
  href: string | null;
  /**
   * True for items shown in the IA but not yet routable (Services, Day Report).
   * Rendered as an `<span aria-disabled="true">` with no navigation.
   */
  disabled?: boolean;
};

export type NavGroup = {
  id: string;
  /** Section header text shown above the items (hidden when sidebar is collapsed). */
  label: string;
  items: NavItem[];
};
```

**The full config** (matches the prototype `UMSidebar`):

| group | item id | label | icon (Lucide) | href | disabled |
|---|---|---|---|---|---|
| *(top, ungrouped)* | `dashboard` | Dashboard | `Home` | `/dashboard` | – |
| `workspace` (label: "Workspace") | `schedule` | Schedule | `Calendar` | `/calendar` | – |
| | `clients` | Clients | `Users` | `/clients` | – |
| | `services` | Services | `Sparkles` | `null` | `true` |
| | `checkout` | Checkout | `DollarSign` | `/checkout` | – |
| | `walkin` | Walk-in | `Footprints` | `/walkin` | – |
| `operations` (label: "Operations") | `end-of-day` | End of Day Cash | `Banknote` | `/end-of-day` | – |
| | `day-report` | Day Report | `FileBarChart` | `null` | `true` |
| | `settings` | Settings | `Settings` | `/settings` | – |

**Validation rules**:
- `id` is unique across the whole config (enforced by a sanity check at module load — see contract).
- If `disabled` is `true`, `href` MUST be `null`. If `disabled` is `false`/absent, `href` MUST be a non-empty path starting with `/`.
- Order matters and is the rendering order. The Dashboard item is rendered above the first group, separated by a hairline rule (per prototype).

**State transitions**: None — this is a static constant. Changing it requires a code edit + a fresh deploy.

---

## 2. Collapse Preference (per-device `localStorage`)

**Where it lives**: Browser `localStorage` only. Not persisted server-side, not synced across devices.

**Key**: `tn:studio:sidebar-collapsed`

**Value**: A string, exactly `"1"` (collapsed) or `"0"` (expanded). Any other value (including `null` / missing key) is treated as expanded.

**Validation / parsing**:
- On read: `localStorage.getItem(KEY) === "1"`. Anything else = expanded.
- On write: write the literal string `"1"` or `"0"`.

**Lifecycle**:
- **Initialization**: An inline script in `app/(studio)/layout.tsx` runs before React paints, reads the key, and sets `<html data-studio-sidebar-collapsed="true|false">`. This avoids a flash-of-uncollapsed-content on every navigation.
- **Read**: The client island reads from the `<html>` attribute on mount (avoids a second `localStorage` round trip).
- **Write**: Updated by the collapse toggle's onClick. Also updates the `<html>` attribute synchronously so the CSS-driven layout responds immediately.

**Lifecycle diagram**:

```text
        ┌──────────────────────────────────┐
        │ Page navigation / full reload    │
        └──────────────┬───────────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │ Inline script reads localStorage │
        │ → sets <html data-…="true|false">│
        └──────────────┬───────────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │ CSS sees attribute → grid sized  │
        │ correctly on first paint         │
        └──────────────┬───────────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │ React hydrates; client island    │
        │ reads attribute → seeds useState │
        └──────────────┬───────────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │ User clicks toggle → setCollapsed│
        │ → write localStorage + update    │
        │   <html> attribute               │
        └──────────────────────────────────┘
```

**Edge cases**:
- `localStorage` throws (Safari private mode, etc.): swallow the error in a try/catch. The toggle still works in-memory for the session; preference simply won't persist.
- User clears site data: state resets to expanded on next visit. Acceptable per spec ("matches the prototype").

---

## 3. Studio Session (read-only consumption)

The sidebar **consumes** the session data already fetched by `app/(studio)/layout.tsx`. It does not fetch session data itself.

**Source**: `getStudioSessionOrDegraded()` from `@/lib/auth/session` — already called at the top of `app/(studio)/layout.tsx`.

**Fields used by the sidebar footer**:

| Field | Source | Used for |
|---|---|---|
| `staff.display_name` | session.staff.display_name (or `"…"` if degraded) | Footer name text + avatar initials |
| `staff.role` | session.staff.role (or `"technician"` if degraded) | Footer role label ("Owner" / "Manager" / "Tech" / "Front desk") |
| `staff.color_token` | session.staff.color_token (or `"--muted"` if degraded) | Footer avatar background color (resolved via `var(${color_token})`) |
| *(implicit)* `degraded` boolean | `"degraded" in session` in the layout | Whether to render the neutral placeholder treatment in the footer |

**No mutations**: The sidebar never writes any session state.

---

## What this feature does NOT change

- Database schema: no migrations, no new tables, no new columns, no new indexes, no new RLS policies.
- Audit log: no new `audit_log.action` values.
- Idempotency keys: N/A (no Square or money flows).
- Settings rows: no new keys.
- Cookies: no new cookies (collapse pref is localStorage, not a cookie).
- Server Actions: none added.
