# Tang Nails

Salon management web app for a single nail salon, built on the **Lacquer** design system.

- Architecture and scope: [`docs/system-design.md`](docs/system-design.md)
- Design system: [`design-system/`](design-system/) (read its `README.md` and `SKILL.md` before
  writing any UI)
- Feature specs: [`specs/`](specs/) — scaffolding (001), dashboard (002), login flow (003)

## Prerequisites

- **Node.js 24 LTS** — pinned in [`.nvmrc`](.nvmrc); the `engines` field requires `>=24 <25`.
  With nvm: `nvm use`.
- **npm 10+** (ships with Node 24).
- **Supabase CLI** — `brew install supabase/tap/supabase`. Required to boot the local Postgres +
  Auth stack the login flow reads from.
- **Docker Desktop** (running) — the Supabase CLI launches Postgres, Auth, and Inbucket as
  containers.
- A modern browser.

## Setup

```bash
# 1. Install dependencies reproducibly from the committed lockfile
npm ci

# 2. Create your local environment file from the template
cp .env.example .env.local

# 3. Boot Supabase locally (first run pulls Docker images — a few minutes)
supabase start
supabase status        # prints API URL, anon key, service_role key

# 4. Fill in .env.local
#    - NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    - NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
#    - SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>
#    - ACTING_AS_COOKIE_SECRET=$(openssl rand -base64 32)
#    Leave Square placeholders as-is — they aren't exercised by the login flow.

# 5. Apply migrations + seed dev accounts, then regenerate Supabase types
supabase db reset
npx supabase gen types typescript --local > lib/db/types.ts

# 6. Start the development server
npm run dev
```

Open `http://localhost:3000/dashboard` — middleware will bounce you through the gate.

### Seeded dev accounts

After `supabase db reset`, three staff exist with PIN hashes:

| Display name | Email (Supabase user)     | Password         | PIN    |
| ------------ | ------------------------- | ---------------- | ------ |
| Maya Patel   | `owner@tangnails.dev`     | `tang-nails-dev` | `1234` |
| Jordan Lee   | `manager@tangnails.dev`   | `tang-nails-dev` | `5678` |
| Sam Chen     | _(PIN-only, no email)_    | —                | `9999` |

Magic-link emails (the fallback link on `/login`) land in Inbucket at
`http://127.0.0.1:54324`.

For per-scenario walkthroughs (wrong password, wrong PIN, switch staff, sign out, soft-degrade
when Supabase is down) see [`specs/003-login-flow/quickstart.md`](specs/003-login-flow/quickstart.md).

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
app/         Next.js App Router — route groups (auth), (studio), plus kiosk/, auth/, api/
components/  ui/ (shadcn primitives)  ·  lacquer/ (composed project components)
lib/         db/ auth/  ·  utils.ts (cn helper) — square/, realtime/, time/ arrive with later features
middleware.ts  Edge: Supabase session + operator-cookie gate; preserves ?next=
styles/      globals.css  ·  tokens.css  ·  auth.css  ·  dashboard.css  ·  studio.css
supabase/    migrations/0001_auth_schema.sql  ·  seed.sql (dev accounts above)
public/      icons/
tests/       unit/ (Vitest)  ·  e2e/ (Playwright)
docs/        system-design.md — source of truth for the build
design-system/  vendored Lacquer brand & component library
specs/       feature specs, plans, and tasks
```

The tree mirrors `docs/system-design.md` §"Repo layout".

Conventional files at the root: `.env.example` (every v1 environment variable, documented),
`.editorconfig` (shared editor settings), `.nvmrc` (runtime pin), `.prettierrc` /
`.prettierignore` (formatting), `components.json` (shadcn/ui config).

## What's shipped vs. what's coming

Shipped through feature 003: the project scaffold, the Lacquer dashboard surface, and the
two-layer login gate (Supabase device session + staff PIN with HMAC-signed operator cookie and
audit logging). Still to come in their own features: calendar, clients, checkout, walk-in,
end-of-day, Square SDK wrappers, realtime helpers, and the PWA manifest/service worker.

## Stack

Next.js 16 (App Router, RSC + Server Actions) · Vercel · Supabase (Postgres/RLS, Auth, Realtime,
Storage) · Square SDK (server-side) · shadcn/ui + Tailwind v4 + Lucide. See
[`docs/system-design.md`](docs/system-design.md) for the full picture.
