# Implementation Plan: Switch Staff — Standalone Top‑Nav Button

**Branch**: `009-switch-staff-button` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-switch-staff-button/spec.md`

## Summary

Promote the "Switch staff" action from a hidden item in the operator chip's dropdown to a first-class, labeled button in the studio topbar. The button sits to the left of the operator chip, separated by a thin vertical divider, and renders the swap/repeat icon plus the literal label "Switch staff" — the "Option B — labeled button" variant in the `Switch Staff Nav` design mockup. The dropdown is reduced to just "Sign out." No data model, server contract, or permission change; the new button submits the existing `switchStaff` Server Action.

**Technical approach**: add a small client component `components/lacquer/switch-staff-button.tsx` that renders a `<form action={switchStaff}>` wrapping a button styled with Lacquer tokens. Add a `.studio-topbar-sep` divider class to `styles/studio.css`. Slot both into `.studio-topbar-right` in `app/(studio)/layout.tsx`, before the existing `<OperatorMenu><OperatorChip /></OperatorMenu>`. Remove the "Switch staff" item from `components/lacquer/operator-menu.tsx`. Update the five existing e2e callsites that open the chip dropdown to reach "Switch staff" so they click the new button instead, add new unit + e2e coverage for the new affordance and the trimmed dropdown.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 (Next.js 16 App Router; Server Components + Server Actions).

**Primary Dependencies**: Next.js 16, React 19, shadcn/ui (Radix primitives), Tailwind CSS, `lucide-react` (icons), Supabase JS clients (only via existing `requireStudioSession()`; this feature does not call Supabase directly).

**Storage**: N/A. Switch‑staff identity continues to live in the existing signed `acting_as_staff_id` cookie; `switchStaff()` redirects to `/select-staff`, which already owns the next-step persistence. No schema change.

**Testing**: Vitest + Testing Library (unit) and Playwright against a seeded local Supabase (e2e). Both are mandated by Constitution Principle IV for the auth critical path; switch-staff is part of that path.

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest), shared salon devices. The studio shell already assumes desktop ≥ 1024px width.

**Project Type**: Web application — single Next.js app (no separate backend repo). Files live under `app/(studio)/`, `components/lacquer/`, `styles/`, and `tests/`.

**Performance Goals**: One paint frame to render the new button on shell load (it's rendered inside the existing topbar — no measurable delta). Activation latency unchanged from today: the underlying `switchStaff()` Server Action's redirect to `/select-staff` is the bottleneck and is not modified.

**Constraints**: Constitution Principle I (Design System Fidelity, NON‑NEGOTIABLE) — every visual value must resolve to a token in `styles/tokens.css`; icon must be Lucide at 1.5px stroke, sized 16. Constitution Principle II (Server‑Authoritative) — activation must go through the existing `switchStaff()` Server Action; no client write. Constitution Principle IV — unit + e2e coverage must be added/updated. Constitution Principle V — no new runtime dependencies, no scope creep into the `/select-staff` page or PIN flow.

**Scale/Scope**: Single button + divider in one layout, one dropdown item removed, one new unit spec, one new e2e test, ~5 existing e2e callsites updated. Estimated ~70–110 LOC net change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.3.

| Principle | Status | How this plan satisfies it |
|-----------|--------|----------------------------|
| **I. Design System Fidelity (NON‑NEGOTIABLE)** | PASS | Visual treatment is the `Switch Staff Nav` mockup's "Option B — labeled button" variant. Every value (height, border, radius, padding, gap, font size, hover/focus colors) resolves to an existing token in `styles/tokens.css`. The swap glyph is `lucide-react`'s `Repeat`, already used today inside the dropdown; rendered at `size={16} strokeWidth={1.5}`. No second component library, no raw hex, no off‑scale spacing. The 1px topbar divider uses `var(--border)` at `var(--space-5)` (20px) height — on‑scale. Side‑by‑side comparison against `design-system/preview/Switch Staff Nav.html` (extracted from the source design archive) is part of the verification checklist. |
| **II. Server‑Authoritative Architecture** | PASS | The new button submits a `<form action={switchStaff}>`. `switchStaff()` already lives in `app/(studio)/actions.ts` and performs the audit row + redirect server-side. No client-side write, no new endpoint, no new credential surface. Authorization is unchanged — it inherits from `requireStudioSession()` exactly as today's dropdown item does. |
| **III. Auditability & Money Integrity (NON‑NEGOTIABLE)** | PASS | The `staff.switched` audit row is emitted inside `switchStaff()`; no change. No money flow is touched. |
| **IV. Test-First for Critical Paths** | PASS | Switch‑staff is part of the auth critical path. The plan adds a Vitest unit spec for `<SwitchStaffButton>` and for the trimmed `<OperatorMenu>` (asserting no "Switch staff" item), and a Playwright e2e test that the topbar button reaches `/select-staff` in one click. The five existing e2e callsites that open the chip dropdown to click "Switch staff" are updated in the same change set so the suite reflects the new entry point. Test order: write the failing tests first (red), then change the layout + components + dropdown to green. |
| **V. Scope Discipline & Cost Restraint** | PASS | This is a UI relocation. No new runtime dependencies, no new schema, no new API. `/select-staff`, PIN flow, audit contract, RLS, Square integration, and degraded-session handling are unchanged. Roughly ~70–110 LOC. No infrastructure cost change. |

**Initial gate: PASS.** Re-checked after Phase 1 design — see "Post-design Constitution Re-check" below.

## Project Structure

### Documentation (this feature)

```text
specs/009-switch-staff-button/
├── plan.md                # This file
├── research.md            # Phase 0 — design + behavior decisions
├── quickstart.md          # Phase 1 — developer "build, run, verify" walkthrough
├── checklists/
│   └── requirements.md    # Spec quality checklist (from /speckit-specify)
└── spec.md                # /speckit-specify output
# data-model.md and contracts/ are intentionally omitted — see Phase 1 below.
```

### Source Code (repository root)

```text
app/(studio)/
├── layout.tsx                          # MODIFY — slot <SwitchStaffButton/> + divider before <OperatorMenu> in .studio-topbar-right
└── actions.ts                          # NO CHANGE — switchStaff() is reused as-is

components/lacquer/
├── switch-staff-button.tsx             # NEW — client component: <form action={switchStaff}> + styled button, useFormStatus disables during pending
├── operator-menu.tsx                   # MODIFY — remove the "Switch staff" <DropdownMenuItem>; keep "Sign out"
└── operator-chip.tsx                   # NO CHANGE — chip stays as the dropdown trigger for Sign out only

styles/
└── studio.css                          # MODIFY — add .studio-topbar-sep (1px × var(--space-5), bg var(--border))

tests/
├── unit/
│   └── auth/
│       └── operator-menu.test.tsx      # NEW — assert SwitchStaffButton renders form + label + icon; assert OperatorMenu dropdown contains only "Sign out"
└── e2e/
    └── auth.spec.ts                    # MODIFY — five existing callsites use the topbar button; add new test verifying chip dropdown contains only Sign out

CLAUDE.md                               # MODIFY — point the SPECKIT marker to specs/009-switch-staff-button/plan.md
```

**Structure Decision**: Single Next.js project — Option 1 from the template. No new top‑level directories. The feature is a localized topbar change plus one new co‑located component under `components/lacquer/`, matching the established repo convention (`operator-chip.tsx`, `operator-menu.tsx`).

## Phase 0 — Research

See [research.md](./research.md). Summary:

1. **Mockup match**: extracted the original `Switch Staff Nav.html` from the design archive and confirmed Option B's geometry, tokens, and copy ("Switch staff", swap/repeat icon, divider to the right of the button, chip dropdown reduced to "Sign out").
2. **Button placement**: inside `.studio-topbar-right`, **before** `<OperatorMenu>`, with the divider between them. `.studio-topbar-right` already uses `display:flex; gap: var(--space-2)`, so no flex rewrite is needed.
3. **Re‑entry guard (FR‑007)**: use `useFormStatus()` from `react-dom` inside the client button to set `disabled` while `pending` is true. Matches the React 19 / Next.js 16 idiom and adds no dependencies.
4. **Failure feedback (FR‑008)**: `switchStaff()` either redirects on success or throws on session loss. Errors propagate to the nearest `error.tsx`, identical to the current dropdown-item path. No new toast plumbing is in scope.
5. **Degraded session**: the studio shell already renders a placeholder operator chip when the session is degraded; the new button is unaffected by that branch — it is rendered unconditionally and the Server Action handles the recoverability path.
6. **Test strategy**: Vitest + Testing Library for the trimmed dropdown and the new button's render contract; Playwright updates the five existing chip‑dropdown switch‑staff callsites to use the new topbar button.

## Phase 1 — Design & Contracts

**Prerequisites**: `research.md` complete.

### Entities → data-model.md

**Not applicable.** This feature is a UI relocation. No persisted entities are added, removed, or reshaped. No `data-model.md` is produced.

### Interface contracts → contracts/

**Not applicable.** This feature does not expose a public API, CLI surface, webhook, or new internal RPC. The single touch point is the existing `switchStaff()` Server Action, whose signature is unchanged. No `contracts/` directory is produced. (The plan-template's contracts step explicitly says "Skip if project is purely internal.")

### Quickstart → quickstart.md

Produced — see [quickstart.md](./quickstart.md). It walks an implementer through: token reference, exact JSX skeleton for the new button, CSS for the divider, the `<OperatorMenu>` trim, and the local + e2e verification commands.

### Agent context update

`CLAUDE.md`'s SPECKIT marker is updated to point at this plan in the same change set (handled as the final write of `/speckit-plan`):

```text
<!-- SPECKIT START -->
Active feature plan: `specs/009-switch-staff-button/plan.md` — read it for the
current feature's technical context, project structure, and build steps.
<!-- SPECKIT END -->
```

### Post-design Constitution Re-check

| Principle | Re-check | Notes |
|-----------|----------|-------|
| I. Design System Fidelity | PASS | The Phase 1 artifacts (quickstart.md, CSS additions, JSX skeleton) name only existing tokens. No new tokens, no raw values. |
| II. Server-Authoritative | PASS | No new client-side branch; `switchStaff()` is invoked unchanged. |
| III. Audit/Money | PASS | Audit row is emitted inside the unchanged action. |
| IV. Test-First | PASS | Unit + e2e test files are listed under "Source Code"; the implementation order in tasks (next command) will write tests before changing components. |
| V. Scope Discipline | PASS | No additions beyond the mockup's Option B. |

**Re-check: PASS.** No complexity-tracking entries are needed.

## Complexity Tracking

*No constitution violations — this section is intentionally empty.*
