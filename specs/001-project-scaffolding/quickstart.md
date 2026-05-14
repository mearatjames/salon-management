# Quickstart: Tang Nails

**Feature**: 001-project-scaffolding
**Date**: 2026-05-13

This is the setup-and-verify walkthrough for the scaffolded repository. It doubles as the
acceptance script for the feature's user stories — every step maps to an acceptance scenario or
success criterion in [spec.md](./spec.md).

## Prerequisites

- **Node.js 24 LTS** (see `.nvmrc`). With nvm: `nvm use`.
- **npm 10+** (ships with Node 24).
- A modern browser.

## Setup (US1 — clone, install, run)

```bash
# 1. Install dependencies (reproducible from the committed lockfile)
npm ci

# 2. Create your local environment file from the template
cp .env.example .env.local
#    The placeholder values are enough to boot the scaffold; real services come later.

# 3. Start the development server
npm run dev
```

Open the printed URL (default `http://localhost:3000`). You should see the **placeholder landing
page**. → satisfies US1 scenarios 1–2, SC-001.

```bash
# 4. Verify the production build
npm run build
```

Build completes with no errors. → satisfies US1 scenario 3, FR-005.

## Quality gates (US2 — run the gates)

Each command must run to completion and report success on the untouched scaffold:

| Command | Checks | Maps to |
|---------|--------|---------|
| `npm run lint` | ESLint (Next flat config) | US2-1, FR-007 |
| `npm run format:check` | Prettier — code already formatted | US2-3, FR-007 |
| `npm run typecheck` | `tsc --noEmit`, strict mode | US2-2, FR-006 |
| `npm test` | Vitest unit suite (sample test passes) | US2-4, FR-008 |
| `npm run test:e2e` | Playwright e2e suite (sample test passes) | US2-5, FR-009 |
| `npm run build` | Production build | US1-3, FR-005 |

`npm run dev` and `npm run start` round out the eight documented commands (SC-002).

### Continuous integration (US2 — gates on every change)

`.github/workflows/ci.yml` runs all of the above on push and pull request. The repository has no
git remote yet; the workflow activates automatically once a GitHub remote is added. → FR-015,
SC-004.

## Project structure (US3 — find your way around)

The directory tree matches `docs/system-design.md` §"Repo layout". Top level:

```
app/         Next.js App Router — route groups (auth), (studio), kiosk, api
components/  ui/ (shadcn primitives)  ·  lacquer/ (composed components)
lib/         db/ square/ auth/ realtime/ time/  ·  utils.ts (cn helper)
styles/      globals.css  ·  tokens.css (placeholder — Lacquer tokens vendored later)
supabase/    migrations/ (empty — schema is a later feature)
public/      icons/
tests/       unit/ (Vitest)  ·  e2e/ (Playwright)
```

Empty directories are held by `.gitkeep` so the structure is version-controlled. → SC-003, US3-1.

Conventional files: `.env.example` (every env var, US3-2 / FR-012), `.editorconfig` (shared editor
settings, US3-3 / FR-014), `.nvmrc` (runtime pin, FR-013), `README.md` (setup, commands, structure
— US3-4 / FR-016).

## What this scaffold is NOT

Per [spec.md](./spec.md) FR-019 and the Assumptions section, the scaffold contains **placeholders
only**. The following arrive in their own later features and are intentionally absent:

- Lacquer design-token values in `styles/tokens.css`
- Any real shadcn/ui components or `components/lacquer/*`
- The database schema (`supabase/migrations/0001_init.sql`)
- Square SDK wrappers, auth helpers, realtime helpers
- The PWA manifest and service worker
- Any real application surface (calendar, clients, checkout, walk-in, end-of-day)
