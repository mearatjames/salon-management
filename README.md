# Tang Nails

Salon management web app for a single nail salon, built on the **Lacquer** design system.

This repository is currently **scaffolding only** — a runnable, conventional Next.js project with
the full v1 dependency stack, test harnesses, lint/format, CI, and the directory skeleton in place.
It renders a placeholder landing page; real features arrive in later specs.

- Architecture and scope: [`docs/system-design.md`](docs/system-design.md)
- Design system: [`design-system/`](design-system/) (read its `README.md` and `SKILL.md` before
  writing any UI)
- Active feature plan: [`specs/001-project-scaffolding/`](specs/001-project-scaffolding/)

## Prerequisites

- **Node.js 24 LTS** — pinned in [`.nvmrc`](.nvmrc); the `engines` field requires `>=24 <25`.
  With nvm: `nvm use`.
- **npm 10+** (ships with Node 24).
- A modern browser.

## Setup

```bash
# 1. Install dependencies reproducibly from the committed lockfile
npm ci

# 2. Create your local environment file from the template
cp .env.example .env.local
#    Placeholder values are enough to boot the scaffold; real services come later.

# 3. Start the development server
npm run dev
```

Open the printed URL (default `http://localhost:3000`) to see the Tang Nails placeholder page.

## npm commands

| Command                | What it checks                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | Starts the Next.js development server on `http://localhost:3000`. |
| `npm run build`        | Produces the optimized production build.                          |
| `npm run start`        | Serves the production build (run `npm run build` first).          |
| `npm run lint`         | ESLint using the Next.js flat config.                             |
| `npm run typecheck`    | `tsc --noEmit` — TypeScript in strict mode.                       |
| `npm test`             | Vitest unit suite (`tests/unit/`), single run.                    |
| `npm run test:e2e`     | Playwright end-to-end suite (`tests/e2e/`).                       |
| `npm run format:check` | Prettier — verifies the tree is already formatted.                |

Helper scripts: `npm run test:watch` (Vitest in watch mode) and `npm run format` (Prettier
`--write` to fix formatting).

Continuous integration ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs lint,
format check, typecheck, unit tests, build, and e2e tests on every push and pull request. It
activates once a GitHub remote is added.

## Project structure

```
app/         Next.js App Router — route groups (auth), (studio), plus kiosk/ and api/
components/  ui/ (shadcn primitives)  ·  lacquer/ (composed project components)
lib/         db/ square/ auth/ realtime/ time/  ·  utils.ts (cn helper)
styles/      globals.css  ·  tokens.css (placeholder — Lacquer tokens vendored later)
supabase/    migrations/ (empty — schema is a later feature)
public/      icons/
tests/       unit/ (Vitest)  ·  e2e/ (Playwright)
docs/        system-design.md — source of truth for the build
design-system/  vendored Lacquer brand & component library
specs/       feature specs, plans, and tasks
```

Empty directories are held by `.gitkeep` so the structure is version-controlled. The tree mirrors
`docs/system-design.md` §"Repo layout".

Conventional files at the root: `.env.example` (every v1 environment variable, documented),
`.editorconfig` (shared editor settings), `.nvmrc` (runtime pin), `.prettierrc` /
`.prettierignore` (formatting), `components.json` (shadcn/ui config).

## What this scaffold is NOT

Per [`specs/001-project-scaffolding/spec.md`](specs/001-project-scaffolding/spec.md), the scaffold
ships placeholders only. These arrive in their own later features:

- Lacquer design-token values in `styles/tokens.css`
- Real shadcn/ui components and `components/lacquer/*`
- The database schema (`supabase/migrations/`)
- Square SDK wrappers, auth, and realtime helpers
- The PWA manifest and service worker
- Any real application surface (calendar, clients, checkout, walk-in, end-of-day)

## Stack

Next.js 15 (App Router, RSC + Server Actions) · Vercel · Supabase (Postgres/RLS, Auth, Realtime,
Storage) · Square SDK (server-side) · shadcn/ui + Tailwind v4 + Lucide. See
[`docs/system-design.md`](docs/system-design.md) for the full picture.
