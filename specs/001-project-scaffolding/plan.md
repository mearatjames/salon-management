# Implementation Plan: Project Scaffolding

**Branch**: `001-project-scaffolding` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-project-scaffolding/spec.md`

## Summary

Stand up the Tang Nails repository as a runnable, conventional Next.js 16 project: generate the
app with official tooling, install the full v1 dependency stack via npm, wire the styling and
component workflows so design tokens drop in later, establish both test harnesses (Vitest +
Playwright), lint/format, CI, and the directory skeleton from the system design — all producing
only a placeholder landing page, no real features.

**Technical approach**: Everything is generated, never hand-authored. `create-next-app@latest`
produces the base; `npm install` adds each stack dependency; `npx shadcn@latest init` and
`npm init playwright@latest` generate their own configs; scripts and `engines` are set via
`npm pkg set`. See [research.md](./research.md) for the decision record.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (local: v24.15.0, npm 11.12.1)

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server Actions), React 19, Tailwind CSS v4,
shadcn/ui + Radix primitives, lucide-react, `@supabase/supabase-js` + `@supabase/ssr`, `square`
(Node SDK), `@tanstack/react-query` v5, `zustand` v5. Dev: Vitest + React Testing Library +
`@testing-library/jest-dom`, Playwright, Prettier + `eslint-config-prettier` (ESLint 9 flat config
from create-next-app).

**Storage**: N/A for this feature — no database wiring. `supabase/migrations/` directory is
created empty; schema is a later feature.

**Testing**: Vitest (unit, `jsdom`) under `tests/unit/`; Playwright (end-to-end) under
`tests/e2e/`. One passing sample test each.

**Target Platform**: Web — installable PWA later; for this feature, a server-rendered Next.js app
running locally and building for Vercel.

**Project Type**: Web application (single Next.js app, App Router, repo-root layout — no `src/`).

**Performance Goals**: Not a runtime-performance feature. Process goal: fresh clone → running dev
server in under 5 minutes (SC-001).

**Constraints**:
- **User directive (hard)**: do a proper `npm install`; do not construct `package.json` by hand.
  All dependency entries come from generators and `npm install`; only scripts/`engines` are set
  via `npm pkg set`.
- Near-zero cost (constitution Principle V) — no paid services introduced.
- Repo layout MUST match `docs/system-design.md` (FR-010).
- Scaffold contains placeholders only — no v1 features, no deferred items (FR-019).

**Scale/Scope**: One app, ~17 top-level directories from the system design layout, 8 npm scripts,
1 CI workflow, 2 sample tests, 1 placeholder page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status | Notes |
|-----------|----------|--------|-------|
| I. Design System Fidelity | Partial | PASS | No UI is built. Styling/component workflow is *wired* so Lacquer tokens and shadcn primitives drop in later with no rework (FR-017, FR-018). Token values stay out by design. |
| II. Server-Authoritative Architecture | Structural | PASS | No logic is written, but the skeleton (`lib/db` server/browser split, `app/api/`, route groups) is laid out to support it. |
| III. Auditability & Money Integrity | Structural | PASS | No money/audit code. Reproducibility arm of the principle is honored: committed lockfile, `npm ci` in CI (SC-006). |
| IV. Test-First for Critical Paths | Yes | PASS | This feature *is* the test harness. Vitest + Playwright are set up green from day one so test-first work can begin; CI runs both (FR-008/009/015). |
| V. Scope Discipline & Cost Restraint | Yes | PASS | Strictly scaffolding. Deferred v1 items explicitly excluded (research.md "Out of scope"); no paid services; no speculative structure beyond the documented layout. |

**Gate result**: PASS — no violations. Complexity Tracking section omitted (nothing to justify).

*Post-design re-check*: Phase 1 produced no new structure beyond the documented repo layout and
introduced no logic. Constitution Check still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-scaffolding/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decision record
├── data-model.md        # Phase 1 — N/A rationale (no domain entities)
├── quickstart.md        # Phase 1 — setup & verification walkthrough
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks
```

No `contracts/` directory: scaffolding exposes no external API, CLI, or UI contract. The "contract"
of this feature is the set of npm scripts and the directory layout, captured in quickstart.md.

### Source Code (repository root)

```text
app/
├── layout.tsx                      # Root layout; imports styles/globals.css
├── page.tsx                        # Placeholder landing page
├── (auth)/
│   ├── login/                      # .gitkeep
│   └── select-staff/               # .gitkeep
├── (studio)/
│   ├── calendar/                   # .gitkeep
│   ├── clients/                    # .gitkeep
│   ├── checkout/                   # .gitkeep
│   ├── walkin/                     # .gitkeep
│   ├── end-of-day/                 # .gitkeep
│   └── settings/                   # .gitkeep
├── kiosk/[token]/                  # .gitkeep
└── api/
    ├── webhooks/square/            # .gitkeep
    └── square/                     # .gitkeep
components/
├── ui/                             # .gitkeep — shadcn primitives land here
└── lacquer/                        # .gitkeep — composed components land here
lib/
├── db/                             # .gitkeep
├── square/                         # .gitkeep
├── auth/                           # .gitkeep
├── realtime/                       # .gitkeep
├── time/                           # .gitkeep
└── utils.ts                        # cn helper (generated by shadcn init)
styles/
├── globals.css                     # global styles; imports tokens.css
└── tokens.css                      # placeholder — Lacquer tokens vendored later
supabase/
└── migrations/                     # .gitkeep
public/
└── icons/                          # .gitkeep
tests/
├── unit/                           # sample Vitest test
└── e2e/                            # sample Playwright test
.github/workflows/ci.yml            # quality-gate pipeline
components.json                     # shadcn config
vitest.config.ts                    # unit test config
playwright.config.ts                # e2e config
next.config.ts  tsconfig.json  tailwind/postcss config  eslint config   # generated
.prettierrc  .prettierignore  .nvmrc  .env.example  .editorconfig  README.md
package.json  package-lock.json     # generated by create-next-app + npm install
```

**Structure Decision**: Single Next.js 16 web application with the App Router at the repository
root (no `src/` directory), exactly matching the repo layout in `docs/system-design.md` §"Repo
layout". This is the structure every subsequent v1 feature builds into.

## Phase 0 — Outline & Research

Complete. See [research.md](./research.md) — 9 decisions resolved (scaffolding method, runtime,
styling wiring, component workflow, test harness, lint/format, CI, env template, directory
skeleton) plus a confirmed out-of-scope list. No `NEEDS CLARIFICATION` markers remain.

## Phase 1 — Design & Contracts

- **data-model.md**: Created — documents that scaffolding has no domain entities and explains why.
- **contracts/**: Intentionally omitted — no external interface (see Project Structure note).
- **quickstart.md**: Created — the clone → install → run → verify-gates walkthrough, doubling as
  the acceptance script for the spec's user stories.
- **Agent context**: `CLAUDE.md` updated between the `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->`
  markers to reference this plan.

## Phase 2 — Next step

Run `/speckit-tasks` to generate `tasks.md`. Expected task groups, in order:
1. Generate the Next.js base (`create-next-app`) and verify it runs.
2. Install the v1 dependency stack via `npm install`.
3. Initialize shadcn/ui and relocate styling to `styles/`.
4. Set up the Vitest harness + sample unit test.
5. Set up the Playwright harness + sample e2e test.
6. Add Prettier, scripts, and `engines` (via `npm pkg set`).
7. Create the directory skeleton (`.gitkeep`) and the placeholder page.
8. Add `.env.example`, `.nvmrc`, `.editorconfig`, ignore files, `README.md`.
9. Add the CI workflow.
10. Full verification pass against quickstart.md.
