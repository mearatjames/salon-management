---
description: "Task list for 007-left-panel-nav"
---

# Tasks: Studio Left Navigation Panel

**Input**: Design documents from `/specs/007-left-panel-nav/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Constitution IV requires test-first for money/auth/audit critical paths. This feature touches none of those. Per plan.md, we still ship a Vitest unit test (`isActiveSection` pure helper) and one Playwright e2e (`sidebar.spec.ts`); the unit test is written before its implementation as a small discipline; the e2e is written alongside the feature and validated after the implementation tasks land.

**Organization**: Phases follow plan.md § Phase outputs. User stories run in priority order (US1 → US2 → US3 → US4) and are independently testable per spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US4); omitted in Setup, Foundational, and Polish phases

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: This feature adds no new dependencies, no migrations, no new shadcn primitives. Setup is intentionally tiny — just the directory namespace where every later phase's files will land.

- [X] T001 Create the empty directory `components/lacquer/sidebar/` and add an empty `.gitkeep` file so the namespace is tracked before any source files exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure helper, its unit test, the canonical nav config, and the CSS / layout shell that the studio sidebar will plug into. **No user story work can begin until this phase is complete.**

### Pure helper + unit test (Vitest, written first)

- [X] T002 Write `tests/unit/sidebar/is-active-section.test.ts` covering every row of the behaviour table in `specs/007-left-panel-nav/contracts/nav-items.contract.md` § 3: exact (`/calendar` → `/calendar`), nested (`/settings/staff` → `/settings`), trailing-slash normalization (`/settings/` → `/settings`), prefix collision avoided (`/calendar-archive` vs `/calendar` → false), unrelated (`/dashboard` vs `/calendar` → false), root edge case (`/` vs `/dashboard` → false), `href === null` always false, empty pathname always false. Tests MUST FAIL initially (helper file does not exist yet).

- [X] T003 Create `components/lacquer/sidebar/is-active-section.ts` exporting the pure helper `export function isActiveSection(pathname: string, href: string | null): boolean` per `contracts/nav-items.contract.md` § 3 (implementation skeleton in the contract). Verify T002 now passes.

### Canonical nav config

- [X] T004 Create `components/lacquer/sidebar/nav-items.ts` containing:
  - the `NavItem`, `NavGroup`, `NavConfig` type exports verbatim from `contracts/nav-items.contract.md` § 1,
  - the `NAV_CONFIG: NavConfig` constant matching the table in `contracts/nav-items.contract.md` § 2 exactly (Dashboard top item, Workspace group of 5, Operations group of 3; Services and Day Report with `href: null, disabled: true`),
  - a module-scoped `validateNavConfig(NAV_CONFIG)` call that throws synchronously if any invariant (unique ids, disabled⇒href null, href format, unique hrefs) is violated. Implement `validateNavConfig` in the same file. Icons imported from `lucide-react` as named exports.

### CSS shell + layout grid restructure (no sidebar yet)

- [X] T005 Extend `styles/studio.css` with the new shell rules (all values from `styles/tokens.css`):
  - `.studio-shell { display: grid; grid-template-columns: 224px 1fr; grid-template-rows: 56px 1fr; height: 100dvh; transition: grid-template-columns 220ms var(--ease-out); }`
  - `[data-studio-sidebar-collapsed="true"] .studio-shell { grid-template-columns: 56px 1fr; }`
  - `.studio-sidebar { grid-row: 1 / -1; background: var(--card); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: var(--space-3) var(--space-3); gap: var(--space-1); overflow: hidden; }`
  - `[data-studio-sidebar-collapsed="true"] .studio-sidebar { padding: var(--space-3) var(--space-2); align-items: center; }`
  - move the existing `.studio-topbar` and `.studio-main` rules to live as descendants of `.studio-shell` (they already exist; this task does NOT change their declarations, only documents that they now live inside the grid). Update the `min-height` calc on `.studio-main` from `calc(100dvh - 56px)` to `100%` since the grid now owns the height.
  - The existing topbar values stay untouched.

- [X] T006 Edit `app/(studio)/layout.tsx` to wrap the existing `<header className="studio-topbar">` and `<main className="studio-main">` in a single `<div className="studio-shell">`, with a `<aside className="studio-sidebar" aria-label="Studio navigation" id="studio-sidebar">` placeholder element placed BEFORE the header inside the new div. The placeholder `<aside>` renders nothing inside it yet (empty children) — this proves the grid is wired before any sidebar markup lands. Also inject the pre-paint preference script using Next.js's `<Script id="studio-sidebar-init" strategy="beforeInteractive">` primitive (imported from `next/script`). The script body is a self-contained build-time literal — no user-supplied content — that reads `localStorage.getItem("tn:studio:sidebar-collapsed") === "1"` and calls `document.documentElement.setAttribute("data-studio-sidebar-collapsed", "true"|"false")`. Wrap the localStorage read in try/catch so Safari private mode does not throw.

**Checkpoint**: Foundation ready — grid renders, sidebar slot is empty but reserved. Helper + nav config exist and are unit-tested. User story implementation can begin.

---

## Phase 3: User Story 1 — Navigate between studio surfaces from any page (Priority: P1) 🎯 MVP

**Goal**: Every page under `app/(studio)/*` renders the full nav list (Dashboard + Workspace group + Operations group). Items with real routes navigate; the two disabled items (Services, Day Report) render as `<span aria-disabled="true">` and do nothing on click.

**Independent Test**: Visit `/dashboard`. The sidebar renders all 9 items in the expected order. Click each routable item — URL changes, the matching page renders. Click Services or Day Report — nothing happens, the items look de-emphasised, hovering shows a tooltip.

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `components/lacquer/sidebar/nav-item.tsx` (Server Component). Accepts a `NavItem` prop and an `isActive: boolean` prop. Renders:
  - For routable items (`disabled` falsy, `href` non-null): a `<Link href={item.href}>` with `className="studio-nav-item"`, `data-nav-id={item.id}`, `data-active={String(isActive)}`, `data-disabled="false"`, `aria-current={isActive ? "page" : undefined}`, and `title={item.label}` (so the native tooltip surfaces the label whenever the panel is collapsed — harmless when expanded).
  - For disabled items (`disabled === true`): a `<span>` with `className="studio-nav-item"`, `data-nav-id={item.id}`, `data-active="false"`, `data-disabled="true"`, `aria-disabled="true"`, `tabIndex={-1}`, `title="Coming soon"`.
  - Inside the element: `<Icon size={16} strokeWidth={1.5} aria-hidden="true" />` followed by `<span className="studio-nav-label">{item.label}</span>`. `Icon` is the `item.icon` Lucide component.

- [X] T008 [P] [US1] Create `components/lacquer/sidebar/studio-sidebar.tsx` (Server Component). Imports `NAV_CONFIG` from `./nav-items` and the `NavItem` component from `./nav-item`. Accepts a `staff` prop (the same shape `app/(studio)/layout.tsx` builds for the existing `OperatorChip`) and a `degraded: boolean` prop. Renders, inside an outer fragment (no `<aside>` — the layout owns the aside; this component returns its CHILDREN):
  - A header row containing a placeholder div for the collapse toggle (toggle itself comes in US3 — for now render an empty `<div className="studio-sidebar-header" />` so the spacing is right).
  - The Dashboard top item via `<NavItem item={NAV_CONFIG.top[0]} isActive={false} />`.
  - A `<hr className="studio-nav-divider" />`.
  - For each group in `NAV_CONFIG.groups`: a `<div className="studio-nav-section">{group.label}</div>` then each item as `<NavItem item={item} isActive={false} />` (active state wired in US2; pass `false` for all in US1).
  - A `<div className="studio-sidebar-spacer" />` to push the footer to the bottom.
  - A footer slot — for US1, render `null` (footer arrives in US4).

- [X] T009 [US1] Extend `styles/studio.css` with the nav-item visual rules (every value from `styles/tokens.css`):
  - `.studio-sidebar-header` — fixed 28px height, flex row, justify-content end (toggle space).
  - `.studio-nav-section` — uppercase, `--text-xs`, `--muted-foreground`, `--tracking-wide`, padding `var(--space-3) var(--space-2) var(--space-2)`, font-weight 500.
  - `.studio-nav-divider` — 1px solid `var(--border)`, full width, margin `var(--space-2) 0`, border:none + background.
  - `.studio-nav-item` — flex row, gap `var(--space-3)`, padding `var(--space-2) var(--space-3)`, radius `var(--radius-md)` (the 6px button radius), font `--text-sm`, color `var(--foreground)`, no underline, cursor pointer, transition `background-color 150ms var(--ease-out)`, white-space nowrap.
  - `.studio-nav-item:hover` — `background: var(--accent)`.
  - `.studio-nav-item[data-active="true"]` — `background: var(--accent); font-weight: 500;`.
  - `.studio-nav-item[data-disabled="true"]` — `color: var(--muted-foreground); cursor: default;` and no hover background.
  - `.studio-nav-item svg` — `color: var(--muted-foreground); flex-shrink: 0;`.
  - `.studio-nav-item[data-active="true"] svg` — `color: var(--foreground);`.
  - `.studio-nav-label` — flex 1, min-width 0, overflow hidden, text-overflow ellipsis.
  - `.studio-sidebar-spacer` — `flex: 1 1 auto;`.
  - Collapsed-state hides labels and section headers: `[data-studio-sidebar-collapsed="true"] .studio-nav-label, [data-studio-sidebar-collapsed="true"] .studio-nav-section { display: none; }` and `[data-studio-sidebar-collapsed="true"] .studio-nav-item { padding: var(--space-2); justify-content: center; }`.

- [X] T010 [US1] Edit `app/(studio)/layout.tsx` to render `<StudioSidebar staff={staff} degraded={degraded} />` INSIDE the `<aside className="studio-sidebar">` placeholder (replacing the empty children from T006). Import `StudioSidebar` from `@/components/lacquer/sidebar/studio-sidebar`. No other changes to the layout in this task.

**Checkpoint**: User Story 1 is complete. Navigate to `/dashboard` — sidebar renders, all 9 items present in order, routable items navigate on click, Services/Day Report look de-emphasised and do nothing. Visit any other `(studio)` page — same sidebar appears.

---

## Phase 4: User Story 2 — Show where I am right now (Priority: P2)

**Goal**: Exactly one nav item is rendered with the active visual treatment, and it matches the current URL's top-level section (`/settings/staff` highlights "Settings", etc.).

**Independent Test**: Visit each studio route in turn (`/dashboard`, `/calendar`, `/clients`, `/checkout`, `/walkin`, `/end-of-day`, `/settings`, `/settings/staff`). Inspect the DOM: exactly one `.studio-nav-item` per page has `data-active="true"` and matches the expected item.

### Implementation for User Story 2

- [X] T011 [US2] Create `components/lacquer/sidebar/sidebar-shell.client.tsx` (`"use client"`). The component accepts the structured nav config (`top: NavItem[]; groups: NavGroup[]`) as a prop, calls `usePathname()` from `next/navigation`, computes `isActive` per item via `isActiveSection(pathname, item.href)`, and renders the same JSX shape as the server `<StudioSidebar>`: header slot + top items + divider + grouped items + spacer + footer slot (children prop for the footer). Reuses the `<NavItem>` server component (it's safe to import a server component from a client component as a render target since `NavItem` receives only serializable props). Exports `SidebarShell`.

- [X] T012 [US2] Refactor `components/lacquer/sidebar/studio-sidebar.tsx` to render via `<SidebarShell top={NAV_CONFIG.top} groups={NAV_CONFIG.groups}>{footer}</SidebarShell>` where `{footer}` is `null` for now (US4 will populate it). Move the section headers and divider rendering into `SidebarShell` (since active state needs to surround them in the same component for layout coherence). The server `<StudioSidebar>` shrinks to: accept `staff`+`degraded`, build the footer (null in US2), and return `<SidebarShell>` with the nav config plumbed in.

- [X] T013 [US2] Verify by manual smoke (per quickstart.md § 2) that `/dashboard`, `/calendar`, `/clients`, `/checkout`, `/walkin`, `/end-of-day`, `/settings`, and `/settings/staff` each show exactly the expected item as `data-active="true"`. No new test file is required at this step — the Playwright spec in Phase 7 covers it.

**Checkpoint**: User Story 2 is complete. Active highlight follows the URL on every studio page, including nested routes.

---

## Phase 5: User Story 3 — Reclaim horizontal space when I need it (Priority: P2)

**Goal**: The collapse toggle shrinks the panel to a 56px icon rail. Preference persists across navigations and reloads via `localStorage`. The pre-paint init script (already in place from T006) prevents flash-of-uncollapsed-content.

**Independent Test**: On any studio page, click the collapse toggle. Panel shrinks to ~56px. Reload. Panel is still collapsed. Click again to expand. Reload. Panel is still expanded. While collapsed, hovering any nav item shows the label as a native tooltip.

### Implementation for User Story 3

- [X] T014 [US3] Extend `components/lacquer/sidebar/sidebar-shell.client.tsx` to render and own the collapse toggle inside the header slot. On mount, read `document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "true"` into a `useState` (seeded by the pre-paint init script — single source of truth). The toggle button's onClick toggles the state, writes `localStorage.setItem("tn:studio:sidebar-collapsed", next ? "1" : "0")` (try/catch), and synchronously sets `document.documentElement.setAttribute("data-studio-sidebar-collapsed", String(next))` so the CSS-driven grid resize fires immediately. Button uses Lucide `ChevronLeft` (expanded) / `ChevronRight` (collapsed) icons at `size={14} strokeWidth={1.5}`, has `aria-label="Collapse sidebar"` / `"Expand sidebar"`, `aria-expanded={!collapsed}`, and `aria-controls="studio-sidebar"`.

- [X] T015 [US3] Update `components/lacquer/sidebar/studio-sidebar.tsx` so the header-row placeholder from T008 is no longer needed — `SidebarShell` now renders the entire header internally (with the toggle button). Remove the placeholder `<div className="studio-sidebar-header" />` from the server component; `SidebarShell` owns it from this task forward.

- [X] T016 [US3] Add the collapse-toggle styles to `styles/studio.css` (tokens only):
  - `.studio-sidebar-toggle` — width/height `var(--space-7)` (28px), border 1px solid `var(--border)`, radius `var(--radius-md)` (6px), background transparent, color `var(--muted-foreground)`, cursor pointer, transition `background-color 150ms var(--ease-out), color 150ms var(--ease-out), border-color 150ms var(--ease-out)`, flex-shrink 0, margin-left auto (sits at the right of the header row when expanded).
  - `.studio-sidebar-toggle:hover` — `background: var(--accent); color: var(--foreground); border-color: var(--ring);`.
  - `[data-studio-sidebar-collapsed="true"] .studio-sidebar-toggle` — `margin-left: 0;` (centered when the panel is just an icon column).

- [X] T017 [US3] Manually verify per quickstart.md § 2: toggle → collapses; reload → stays collapsed (no flash); toggle → expands; reload → stays expanded; while collapsed, hover any nav item to confirm the native `title` tooltip surfaces the label. The Playwright spec in Phase 7 covers this for CI.

**Checkpoint**: User Story 3 is complete. Collapse is functional, persisted, and flash-free.

---

## Phase 6: User Story 4 — See who's signed in as operator (Priority: P3)

**Goal**: The panel footer shows the operator's avatar tile (initials in their color token), display name, and role label. Falls back to a neutral placeholder when the studio session is in the degraded state. Collapsed view shows only the avatar tile, centered, with the name+role available via `title`.

**Independent Test**: Sign in as a known staff member; visit any studio page; confirm the footer shows that staff member's initials in their color token, name, and role label. Collapse the panel; confirm only the avatar tile is visible. Trigger the auth-degraded path; confirm the footer shows a neutral placeholder rather than crashing.

### Implementation for User Story 4

- [X] T018 [US4] Extract the `initials()` and `roleLabel()` helpers from `components/lacquer/operator-chip.tsx` into a new shared module `components/lacquer/staff/initials.ts` (a small file with both pure functions and their types). Update `operator-chip.tsx` to import from that module so the duplication disappears. Add a tiny Vitest in `tests/unit/staff/initials.test.ts` covering: single-word name → first two letters uppercased; two-word name → first+last initial; multi-word name → first+last; empty name → `"?"`; the four role-label mappings (`owner` → "Owner", `manager` → "Manager", `technician` → "Tech", `front_desk` → "Front desk", unknown → passthrough).

- [X] T019 [US4] Create `components/lacquer/sidebar/sidebar-footer.tsx` (Server Component). Accepts `staff: { display_name: string; role: string; color_token: string }` and `degraded: boolean`. Imports the helpers from `@/components/lacquer/staff/initials`. The footer renders:
  - When `degraded` is true: `<div className="studio-sidebar-footer studio-sidebar-footer-degraded" title="Loading operator">` with a neutral grey avatar tile (background `var(--muted)`, foreground `var(--muted-foreground)`, no initials) and no visible text — sized like the active-state tile so the layout doesn't jump when the session resolves.
  - Otherwise: `<div className="studio-sidebar-footer" title={`${staff.display_name} · ${roleLabel(staff.role)}`}>` containing the avatar tile (26px square, `border-radius: var(--radius-full)`, background `var(${staff.color_token})`, color `var(--primary-foreground)`, centered initials) plus a text column showing `display_name` (`--text-sm`, font-weight 500) and the role label (`--text-xs`, `--muted-foreground`).

- [X] T020 [US4] Update `components/lacquer/sidebar/studio-sidebar.tsx` to pass `<SidebarFooter staff={staff} degraded={degraded} />` as the children prop into `<SidebarShell>` (replacing the `null` from T012).

- [X] T021 [US4] Add the footer styles to `styles/studio.css` (tokens only):
  - `.studio-sidebar-footer` — flex row, align-items center, gap `var(--space-3)`, padding `var(--space-3) var(--space-2)`, border-top 1px solid `var(--border)`, width 100%, min-width 0.
  - `.studio-sidebar-footer-avatar` — 26px square, radius `var(--radius-full)`, display inline-flex, align-items+justify-content center, font-size `var(--text-xs)`, font-weight 600.
  - `.studio-sidebar-footer-text` — flex 1, min-width 0; child `.studio-sidebar-footer-name` is `var(--text-sm)`, font-weight 500, white-space nowrap, overflow hidden, text-overflow ellipsis; child `.studio-sidebar-footer-role` is `var(--text-xs)`, `var(--muted-foreground)`.
  - `[data-studio-sidebar-collapsed="true"] .studio-sidebar-footer-text { display: none; }` and `[data-studio-sidebar-collapsed="true"] .studio-sidebar-footer { justify-content: center; padding: var(--space-3) 0; }`.

**Checkpoint**: User Story 4 is complete. Footer renders the operator chip, collapses cleanly, and degrades gracefully.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T022 Write `tests/e2e/sidebar.spec.ts` (Playwright) covering, in one `test.describe`:
  1. Sign in (reuse helper from `tests/e2e/auth.spec.ts`), visit `/dashboard` → assert the sidebar `<aside aria-label="Studio navigation">` is present and renders the 9 expected items in order via `data-nav-id` selectors.
  2. Click "Schedule" → URL becomes `/calendar` and `[data-nav-id="schedule"]` has `data-active="true"`; no other item does.
  3. Visit `/settings/staff` directly → `[data-nav-id="settings"]` has `data-active="true"`.
  4. Locate `[data-nav-id="services"]` → it has `aria-disabled="true"` and `data-disabled="true"`. Click it → URL does not change.
  5. Click the collapse toggle → `<html data-studio-sidebar-collapsed="true">` exists; the sidebar's bounding-box width is ~56px (±4 for borders). Reload → still collapsed. Click again to expand → ~224px. Reload → still expanded.
  Run with `--workers=1` to match the rest of the e2e suite's serialization (no `audit_log` writes here, but consistency with the suite avoids surprises).

- [X] T023 [P] Side-by-side acceptance per quickstart.md § 3. Covered by `speckit-design-auditor` source-level audit (PASS): every value traces to a Lacquer token, layout shape matches prototype 224/56px grid, group order matches, icons are Lucide 1.5px (size 16 nav items, 14 toggle chevrons per spec rounding from 13), three distinct interaction states, 220ms ease-out collapse transition, disabled items use `<span aria-disabled="true">`.

- [X] T024 [P] Token verification done in the same audit — no raw hex codes in any of the touched files; `styles/studio.css` resolves every color/spacing/radius/transition to a `var(--*)` from `styles/tokens.css`; documented on-scale substitutions (`--space-7` not in scale → `--space-8` for toggle, `--space-6` for avatar) are commented inline.

- [X] T025 Run the full pre-push gate set in this exact order (Constitution § Development Workflow):
  1. `npm run format:check`
  2. `npm run lint`
  3. `npm run typecheck`
  4. `npm test` (Vitest — includes `tests/unit/sidebar/is-active-section.test.ts` and `tests/unit/staff/initials.test.ts`)
  5. `npm run test:e2e -- --workers=1` (Playwright — includes `tests/e2e/sidebar.spec.ts`)
  All five MUST be green locally before push. Fix any failures at root cause; do NOT skip hooks or use `--no-verify`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no dependencies — start immediately.
- **Foundational (Phase 2)** depends on Setup completion and BLOCKS all user-story phases. T002 must precede T003; T003 unblocks T004; T005 and T006 can run in parallel with T002–T004.
- **User Story 1 (Phase 3)** depends only on Foundational. T007 and T008 are parallelizable (different files); T009 depends on T007/T008 having declared the class names they use; T010 depends on T008 (imports `StudioSidebar`).
- **User Story 2 (Phase 4)** depends on US1 (T012 refactors `studio-sidebar.tsx` from T008).
- **User Story 3 (Phase 5)** depends on US2 (T014 extends `sidebar-shell.client.tsx` from T011). Could in principle be built before US2, but in practice both touch the same client island file, so US2 → US3 is the cleanest order.
- **User Story 4 (Phase 6)** depends only on US1 (replaces the footer slot in `studio-sidebar.tsx`). Can run in parallel with US2/US3 if you have two implementers, because it touches different files (`sidebar-footer.tsx` + footer CSS rules) — flagged below.
- **Polish (Phase 7)** depends on all four user stories being complete.

### User Story dependencies

- **US1 (P1)**: blocked only by Foundational. MVP.
- **US2 (P2)**: depends on US1 (refactors `studio-sidebar.tsx`).
- **US3 (P2)**: depends on US2 (extends `sidebar-shell.client.tsx`).
- **US4 (P3)**: depends on US1 (replaces footer slot). **Independent of US2/US3** — different files.

### Parallel opportunities

- **Within Setup**: T001 is the only setup task.
- **Within Foundational**: T002 + T005 can run in parallel; T003 and T004 each depend on the unit tests/contract being authored.
- **Within US1**: T007 and T008 are `[P]` (different files). T009 (CSS) depends on the class names landing in T007/T008. T010 (layout edit) depends on T008.
- **Across stories with two implementers**: after US1 ships, **US4 can run in parallel with US2 → US3** (different files: footer vs. client island).
- **Within Polish**: T023 and T024 are `[P]` (manual checks on different facets); T022 (e2e test) and T025 (gate run) are not parallel — the gate run depends on the e2e existing.

---

## Parallel Example: User Story 1

```bash
# After Foundational is green, launch both server components for the sidebar in parallel:
Task: "T007 [P] [US1] Create components/lacquer/sidebar/nav-item.tsx"
Task: "T008 [P] [US1] Create components/lacquer/sidebar/studio-sidebar.tsx"

# Once both land, run CSS + layout edit sequentially (they read the class names):
Task: "T009 [US1] Extend styles/studio.css with nav-item visual rules"
Task: "T010 [US1] Edit app/(studio)/layout.tsx to render <StudioSidebar />"
```

## Parallel Example: across stories (after US1 ships)

```bash
# Implementer A
Task: "T011 [US2] Create components/lacquer/sidebar/sidebar-shell.client.tsx (active-state only)"
Task: "T012 [US2] Refactor studio-sidebar.tsx to use SidebarShell"
Task: "T014 [US3] Extend sidebar-shell.client.tsx with collapse toggle + localStorage"

# Implementer B (in parallel)
Task: "T018 [US4] Extract initials/roleLabel to components/lacquer/staff/initials.ts"
Task: "T019 [US4] Create components/lacquer/sidebar/sidebar-footer.tsx"
Task: "T020 [US4] Wire SidebarFooter into studio-sidebar.tsx"
Task: "T021 [US4] Add footer styles to styles/studio.css"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 (T001) and Phase 2 (T002–T006).
2. Complete Phase 3 (T007–T010) — sidebar renders on every studio page with working navigation.
3. **STOP and VALIDATE**: open `/dashboard`, click every routable item, confirm Services/Day Report are visually disabled and no-op.
4. This is shippable on its own — the studio gains a working nav even if active highlight and collapse arrive in a later PR.

### Incremental delivery

1. Foundational + US1 = working nav (MVP).
2. Add US2 = active highlight reflects current URL.
3. Add US3 = collapse with persistence.
4. Add US4 = operator footer.
5. Polish (T022–T025) = e2e + visual acceptance + gates.

Each increment can ship independently; each one only adds to the surface, none removes or breaks the previous.

### Parallel team strategy (two implementers, after US1 ships)

- **Implementer A**: US2 → US3 (same client island file, must be serial).
- **Implementer B** in parallel: US4 (different files, fully independent).
- Both rejoin at Phase 7 polish.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks.
- `[Story]` label maps each implementation task to its user story for traceability.
- Each user story is independently testable per spec.md, and each story phase ends at a Checkpoint where the story's Independent Test can be run.
- The pure helper test (T002) is written first per a light TDD discipline — Constitution IV does not require TDD for this non-critical-path feature, but the helper is small enough that the cost is zero and the test doubles as living documentation of the active-match rule.
- Commit after each task or logical group; the auto-commit `after_tasks` hook fires after this generation step.
- Avoid: vague tasks, same-file conflicts within `[P]` claims, cross-story dependencies that would break independent testability.
