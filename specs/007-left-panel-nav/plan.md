# Implementation Plan: Studio Left Navigation Panel

**Branch**: `007-left-panel-nav` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-left-panel-nav/spec.md`

## Summary

Add the persistent left navigation panel from `design-system/prototypes/user-management/` (the `UMSidebar` component) to the Tang Nails Studio shell so every page under `app/(studio)/*` renders it. The panel groups destinations into Workspace (Schedule, Clients, Services, Checkout, Walk-in) and Operations (End of Day Cash, Day Report, Settings), with a Dashboard item above the groups and an operator chip footer. It collapses to a 56px icon rail with `localStorage`-persisted state and highlights the current top-level section. Items whose routes do not yet exist (Services, Day Report) render as visible-but-disabled placeholders so the IA matches the prototype.

Approach: extend `app/(studio)/layout.tsx` to wrap `<header>` + `<main>` in a 2-column CSS grid (`<aside>` sidebar + content column). Server-render the sidebar shell with the session-derived operator data already fetched by the layout; mount one tiny client island for the collapse toggle (mirroring the `settings/tab-bar.tsx` precedent of using a small `"use client"` component when `usePathname()` is needed). Reuse `lucide-react` icons and the existing `initials()` / role-label logic from `OperatorChip`. All new styles live in `styles/studio.css`, every value from `styles/tokens.css`.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 (App Router + RSC + Server Actions)

**Primary Dependencies**: `next`, `react`, `react-dom`, `lucide-react`, `clsx` (already used in repo); shadcn/ui primitives in `components/ui/*` where applicable; Lacquer tokens in `styles/tokens.css`

**Storage**: None. Per-device collapse preference is in browser `localStorage` only.

**Testing**: Vitest for the active-match helper unit test; Playwright for the sidebar e2e (presence on every studio route, click navigation, active highlight, collapse + reload persistence).

**Target Platform**: Vercel (Next.js 16 Fluid Compute by default); browsers used by Tang Nails staff — modern Chrome/Safari on macOS, iPadOS, Windows laptops.

**Project Type**: Web application (single Next.js project at repo root — `app/`, `components/`, `lib/`, `styles/`, `tests/`).

**Performance Goals**: No measurable change to TTFB or LCP — the panel is a static, server-rendered shell element. Client JS added by this feature MUST stay under ~1 KB gzipped (one small client island for the collapse toggle + the active-match if it ends up client-side).

**Constraints**:
- No raw hex codes, no off-scale spacing, no font weights outside 400/500/600 (Constitution Principle I).
- The shell must render in the auth-degraded fallback (Constitution Principle II's server-authoritative model means the shell renders before/around session resolution).
- No new persistent data; no new RLS rules; no Square calls.
- Animation ≤220ms ease-out per the Lacquer motion language.

**Scale/Scope**: Single salon, ≤10 concurrent operator devices, ≤6 staff on shift. Scope of this feature: one new client component file, one new server component file (or a single file split sensibly), one CSS block in `styles/studio.css`, an edit to `app/(studio)/layout.tsx`, one unit test, one e2e test.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ Pass | Plan adapts `design-system/prototypes/user-management/Components.jsx` `UMSidebar` and its `user-management.css` rules. All new values resolve to `var(--*)` tokens in `styles/tokens.css`. Lucide icons only (Calendar, Users, Sparkles, DollarSign, Footprints, Banknote, FileBarChart, Settings, Home, ChevronLeft, ChevronRight). Acceptance includes a side-by-side comparison against the prototype HTML opened in a browser (per Principle I final bullet). |
| **II. Server-Authoritative Architecture** | ✅ Pass | The sidebar is a UI shell — no mutations, no Server Actions, no Square calls, no authorization decisions. Operator data is fetched server-side in `app/(studio)/layout.tsx` (the existing `getStudioSessionOrDegraded()` call) and passed to the sidebar as props. The one client island (`<SidebarCollapseProvider>` or equivalent) only handles localStorage and active matching. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ Pass — N/A | No writes, no money. No `audit_log` rows, no idempotency keys needed. |
| **IV. Test-First for Critical Paths** | ✅ Pass — partial scope | This is not a critical path (no payments, auth, audit, tip allocation). Per Principle IV, TDD-with-failing-tests is mandatory only for money/auth code. We still ship: (1) a Vitest unit test for the `isActiveSection(pathname, sectionRoot)` helper covering exact / nested / unrelated cases; (2) a Playwright e2e test (`sidebar.spec.ts`) covering presence on `/dashboard`, navigation click to `/calendar`, nested-active for `/settings/staff`, collapse-then-reload persistence, and the disabled-item no-op. Both run in CI alongside the existing suites. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Pure UI shell, no new dependencies, no new infra. Two prototype items without live routes (Services, Day Report) are rendered as visible-but-disabled placeholders rather than spawning new feature work — explicitly bounded in spec FR-005 and Assumptions. The "248" clients count is omitted to avoid pulling data fetching into this feature. No paid services touched; production cost envelope unchanged. |

**Gate result: PASS — proceed to Phase 0.** No violations to justify; Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/007-left-panel-nav/
├── plan.md                       # This file
├── spec.md                       # Already written (/speckit-specify)
├── research.md                   # Phase 0 — design + technical decisions
├── data-model.md                 # Phase 1 — no DB; documents the in-memory nav config and localStorage key
├── quickstart.md                 # Phase 1 — how to run, verify, and visually compare
├── contracts/
│   └── nav-items.contract.md     # Phase 1 — the canonical nav schema (id, label, icon, href, disabled)
└── checklists/
    └── requirements.md           # Already written (/speckit-specify)
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router project at the root. This feature touches:

```text
app/
└── (studio)/
    └── layout.tsx                # EDIT — wrap header+main in a 2-col grid; mount <StudioSidebar>

components/
└── lacquer/
    └── sidebar/                  # NEW — namespace for the studio left panel
        ├── studio-sidebar.tsx               # Server component: shell + nav list + operator footer
        ├── nav-items.ts                     # Canonical nav config (matches contracts/nav-items.contract.md)
        ├── sidebar-shell.client.tsx         # Client island: collapse toggle, localStorage, usePathname-driven active state
        └── nav-item.tsx                     # Server component for a single rendered <Link>/disabled <span> row

styles/
└── studio.css                    # EDIT — add .studio-shell grid, .studio-sidebar, .studio-nav-* rules

tests/
├── unit/
│   └── sidebar/
│       └── is-active-section.test.ts        # NEW — pure helper unit tests
└── e2e/
    └── sidebar.spec.ts                       # NEW — Playwright spec

CLAUDE.md                          # EDIT (auto by Phase 1 step 3) — update the SPECKIT block to point at this plan
```

**Structure Decision**: Single Next.js project (Option 1 — DEFAULT for this repo, established in 001-project-scaffolding and reinforced in 006-staff-management). The sidebar lives alongside the existing `components/lacquer/settings/`, `components/lacquer/staff/`, etc., under a new `components/lacquer/sidebar/` namespace so all panel pieces are co-located. The studio shell edit is confined to `app/(studio)/layout.tsx` — no other route files change.

## Complexity Tracking

No constitution violations to justify. Table intentionally omitted.
