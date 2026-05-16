# Research: Studio Left Navigation Panel

**Feature**: 007-left-panel-nav
**Phase**: 0 (Outline & Research)
**Date**: 2026-05-15

The Technical Context in `plan.md` has no `NEEDS CLARIFICATION` markers — the stack is fixed by the repo and the prototype is fixed by `design-system/`. The research below captures the design decisions that turn that fixed context into an implementation, with rationales and rejected alternatives.

---

## R1 — Active-section matching strategy

**Decision**: Match active state by the **first URL segment under `/`**. Each nav item declares a `sectionRoot` (e.g. `/settings`); the item is active when `pathname === sectionRoot || pathname.startsWith(sectionRoot + '/')`. `Dashboard` matches only `/dashboard` (no children to worry about).

**Rationale**:
- Matches the spec (US2 acceptance scenario 2: `/settings/staff` highlights "Settings").
- Mirrors the precedent set in `components/lacquer/settings/tab-bar.tsx`:
  ```ts
  const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  ```
  Reusing the same idiom keeps two related nav surfaces consistent.
- Trivial to test as a pure function (`isActiveSection(pathname, sectionRoot)`).

**Alternatives considered**:
- *Exact path match* — rejected: `/settings/staff` wouldn't highlight Settings, contradicting US2 scenario 2.
- *Regex per item* — rejected: more rope, no extra power for this nav shape.
- *Compare against `usePathname()` directly in JSX* — rejected: makes the active rule unobservable in tests and duplicates logic.

---

## R2 — Server vs client component split

**Decision**: Two-piece split mirroring `settings/tab-bar.tsx`'s precedent.
- **Server component** (`studio-sidebar.tsx`): renders the `<aside>` shell, the nav list, and the operator footer. Reads from props passed in by `app/(studio)/layout.tsx` (which already does the server-side `getStudioSessionOrDegraded()` call).
- **Client island** (`sidebar-shell.client.tsx`): a `"use client"` wrapper that owns: (a) the `collapsed` boolean (persisted to `localStorage`), (b) the `usePathname()`-driven active state applied via `data-active`/`aria-current` to children, (c) the collapse toggle button. It accepts the nav items + operator footer as `children` (or as render-props) so the server can still own the shape and the client only owns the dynamic attributes.

**Rationale**:
- `usePathname()` and `localStorage` both require client execution; everything else (icon SVGs, labels, the `<Link>` elements themselves) can be server-rendered.
- Keeps the client bundle small (~1 KB target). The Lucide icons used here are tree-shakeable but render server-side in this split.
- Lets us pre-compute the operator footer markup on the server, so the avatar tile renders before hydration — important because the panel is part of the studio shell and shouldn't flash.

**Alternatives considered**:
- *Everything in one server component, `pathname` from `headers()`* — rejected: Next.js 16 `headers()` doesn't give us pathname without middleware support, and `tab-bar.tsx` already chose the small-island approach for the same reason.
- *Everything in one client component* — rejected: forces the operator footer (which depends on server-only `getStudioSessionOrDegraded()`) to be passed as serialized props, and inflates the client bundle with all the icon JSX. The tab-bar precedent specifically calls out splitting trivial code into two as the wrong trade — but the tab-bar is a single uniform list. Our sidebar has a heterogenous shell + footer, where a hybrid pays off.
- *Three+ components* — rejected: unnecessary fragmentation.

---

## R3 — Collapse-state persistence

**Decision**: Store a single boolean under the `localStorage` key `tn:studio:sidebar-collapsed` (value `"1"` or `"0"`, matching the prototype's `'um-sidebar-collapsed'` scheme).

To avoid a hydration flash (server renders expanded, client reads `localStorage` and snaps to collapsed), inline a tiny blocking script in `app/(studio)/layout.tsx` that reads the key and sets a `data-collapsed` attribute on `<html>` (or on the studio shell wrapper) **before** React paints. CSS keys off `[data-collapsed="true"] .studio-shell { grid-template-columns: 56px 1fr; }`. The client island reads the same attribute to initialize state.

**Rationale**:
- The prototype proves the UX works with localStorage; no server-side preference store needed for v1.
- The pre-paint script is the cheapest way to avoid the FOUC (flash of un-collapsed content) that would otherwise happen on every navigation. Same pattern shadcn uses for theme.
- Single boolean = single source of truth; no state-machine complexity.

**Alternatives considered**:
- *Cookie-based, read by the server* — rejected: a cookie round-trip per request for a pure UI preference is overkill. Also means every studio request varies by cookie, complicating caching.
- *URL search param* — rejected: would pollute history.
- *Per-staff DB preference* — rejected: scope creep, requires schema + RLS, contradicts spec assumption "per-device."
- *Skip the inline script, accept the flash* — rejected: causes a visible layout jump on every page load, which contradicts US3 acceptance scenario 1 ("the change animates smoothly (no layout jump)") and is generally jarring.

---

## R4 — Disabled placeholder items (Services, Day Report)

**Decision**: Render disabled items as a `<span>` (not `<a>` / `<Link>`) with `aria-disabled="true"`, `data-disabled="true"`, `tabIndex={-1}`, and `title="Coming soon"`. Visually they get the same icon + label but at `var(--muted-foreground)` color and no hover background.

**Rationale**:
- A disabled `<a>` is an accessibility lie (still focusable, still clickable). `<span>` with `aria-disabled` is the correct semantic.
- The title attribute satisfies FR-005's "communicate their unavailable state via a tooltip or equivalent affordance" without requiring a real tooltip component.
- Keeps the IA intact (the spec is explicit: "items consistent with the prototype's information architecture").

**Alternatives considered**:
- *Hide them entirely* — rejected: contradicts FR-005 and spec US1 acceptance scenario 5.
- *Render as `<button disabled>`* — rejected: a button implies an action; a `<span>` doesn't.
- *Render as a real `<Link>` to a placeholder page* — rejected: spawns scope (need to design + ship placeholder pages) and creates dead routes.

---

## R5 — Studio shell layout shape

**Decision**: Restructure `app/(studio)/layout.tsx` to wrap its current `<header>` + `<main>` in a single shell div with `display: grid; grid-template-columns: var(--sidebar-w, 224px) 1fr; grid-template-rows: 56px 1fr; height: 100dvh;`. The sidebar `<aside>` spans `grid-row: 1 / -1` (full height, both rows). The topbar and main slot keep their existing markup, just moved into the right-hand column.

```text
┌────────┬────────────────────────────────┐
│        │ studio-topbar (56px)           │
│ sidebar├────────────────────────────────┤
│ (224 / │                                │
│  56px) │ studio-main                    │
│        │                                │
└────────┴────────────────────────────────┘
```

**Rationale**:
- Matches the prototype's `.app` grid (`grid-template-columns: 224px 1fr`) and its collapsed variant (`56px 1fr`).
- Spanning the sidebar across both rows is what makes the topbar terminate at the sidebar's right edge — the prototype look.
- Existing `.studio-topbar` and `.studio-main` rules already token-clean; they just live in a new parent.

**Alternatives considered**:
- *Sidebar floats over the topbar (full-height aside `position: fixed`)* — rejected: forces the topbar to know the sidebar width to apply left-padding; couples them unnecessarily. The grid approach is self-balancing.
- *Topbar spans full width, sidebar starts below it* — rejected: visually different from the prototype and creates an awkward corner.

---

## R6 — Icon choices (Lucide mapping)

The prototype uses inline SVG icons via a `mkIcon` factory. Mapping each to its Lucide name:

| Prototype `UM.*` | Lucide name | Used by |
|---|---|---|
| `UM.Home` | `Home` | Dashboard |
| `UM.Calendar` | `Calendar` | Schedule |
| `UM.Users` | `Users` | Clients |
| `UM.Sparkles` | `Sparkles` | Services |
| `UM.Dollar` | `DollarSign` | Checkout |
| `UM.Footprints` | `Footprints` | Walk-in |
| `UM.Cash` | `Banknote` | End of Day Cash |
| `UM.FileBar` | `FileBarChart` | Day Report |
| `UM.Settings` | `Settings` | Settings |
| `ChevronLeft` / `ChevronRight` | `ChevronLeft` / `ChevronRight` | Collapse toggle |

All Lucide icons rendered at `size={16}` `strokeWidth={1.5}` per Constitution Principle I (Lucide 1.5px stroke, sized 16/20/24). The collapse-toggle chevrons render at `size={14}` to match the prototype's `13px` (rounded to the nearest token-friendly size).

**Decision**: Use the Lucide names above. Bundle impact is negligible (icons already used elsewhere in the app).

---

## R7 — Test strategy

**Decision**:
- **Unit (Vitest)**: `tests/unit/sidebar/is-active-section.test.ts` covers the `isActiveSection(pathname, sectionRoot)` helper. Cases: exact match (`/calendar` → `/calendar`), nested (`/settings/staff` → `/settings`), unrelated (`/dashboard` → `/calendar` false), root edge case (`/` → `/dashboard` false), trailing-slash normalization.
- **E2E (Playwright)**: `tests/e2e/sidebar.spec.ts`, single `test.describe` block:
  1. Sign in (reuse the helper from `tests/e2e/auth.spec.ts`), visit `/dashboard`, assert the sidebar `<aside>` is present and lists the expected 9 items in order.
  2. Click "Schedule" → URL becomes `/calendar`, "Schedule" has `data-active="true"`.
  3. Visit `/settings/staff` directly → "Settings" has `data-active="true"`.
  4. Click the disabled "Services" → URL does not change; element has `aria-disabled="true"`.
  5. Click the collapse toggle → `.studio-shell[data-collapsed="true"]` exists, sidebar visible width ≈ 56px (assert via bounding box). Reload page → still collapsed.
  6. Click toggle again → expanded; reload → still expanded.
- **Run with**: `--workers=1` for parity with the existing suite's `audit_log` race avoidance, even though this feature doesn't write to `audit_log`. The CI command stays unchanged.

**Rationale**: Principle IV says TDD-with-failing-tests is mandatory for money/auth/audit code; the sidebar isn't on that list, so a standard "write tests with the feature" approach is acceptable. Unit + e2e together prove FR-001 through FR-009 (FR-010 / FR-011 covered visually + via fallback-render assertion in the e2e).

---

## R8 — How operator footer handles the degraded session

**Decision**: `app/(studio)/layout.tsx` already constructs a `staff` shape (real or `{ display_name: "…", role: "technician", color_token: "--muted" }`) and passes it to the existing topbar `OperatorChip`. The new sidebar takes the **same** prop. In the sidebar footer, when `degraded` is true (signaled by passing a separate `degraded: boolean` prop, or by sentinel display name `"…"`), render a neutral grey tile and the placeholder label instead of the operator chip composition. No crash, no stale data — same contract as the topbar chip today.

**Rationale**:
- Reuses the layout's existing branching; no duplicate session fetching.
- Matches FR-011 and spec US4 acceptance scenario 3.

**Alternatives considered**:
- *Re-call `getStudioSessionOrDegraded()` inside the sidebar component* — rejected: duplicate request to Supabase per render is wasteful and breaks the layout's single-source-of-truth pattern.

---

## Summary

All 8 decisions resolve without `NEEDS CLARIFICATION` flags. The plan can proceed to Phase 1 (data model, contracts, quickstart).
