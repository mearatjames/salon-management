# Research: Project Scaffolding

**Feature**: 001-project-scaffolding
**Date**: 2026-05-13

This document resolves the open technical decisions for scaffolding the Tang Nails repository.
Inputs: `docs/system-design.md` (stack, repo layout, build order), the project constitution, and
the user directive: **"do the proper npm install of the packages; do not construct package.json
by hand."**

## Decision 1: Scaffolding method — generated, never hand-authored

**Decision**: Build the project by running official generators and `npm install`, never by writing
`package.json` or lockfiles by hand:

1. `npx create-next-app@latest` (non-interactive, flags below) to produce the Next.js 16 base,
   `package.json`, `package-lock.json`, `tsconfig.json`, ESLint flat config, and Tailwind v4.
2. `npm install <pkg>...` for each additional runtime/dev dependency from the system design stack.
3. `npx shadcn@latest init` to generate `components.json` and the `cn` utility.
4. `npm init playwright@latest` to generate the Playwright config and browser setup.
5. `npm pkg set scripts.*` / `npm pkg set engines.*` to add scripts and the engines field —
   editing fields via the npm CLI, not hand-editing the dependency map.

**Rationale**: The user explicitly required this. It also guarantees versions resolve from the
registry, the lockfile is authoritative (constitution Principle III: reproducibility; SC-006), and
config files match each tool's current expectations rather than stale hand-copied snippets.

**create-next-app flags**: `--typescript --tailwind --eslint --app --no-src-dir --import-alias
"@/*" --use-npm --no-turbopack`. `--no-src-dir` is required because the system design repo layout
places `app/`, `components/`, `lib/`, `styles/` at the repository root, not under `src/`.

**Version note (implementation)**: `create-next-app@latest` now resolves to **Next.js 16**
(installed: 16.2.6, React 19.2.4), not 15 — Next 16 is the current stable and `@latest` is what
the user directive ("proper npm install") implies. The App Router, RSC, and Server Actions model
this feature wires up is unchanged. One flag fell away: `--no-turbopack` is no longer honored by
create-next-app for Next 16 — Turbopack is the default builder for both `dev` and `build`, and the
scaffold runs clean on it.

**Alternatives considered**: Hand-authoring `package.json` (rejected — violates the user directive
and drifts from tool defaults); a monorepo tool like Turborepo/Nx (rejected — single deployable
app, constitution Principle V forbids speculative structure).

## Decision 2: Runtime and package manager

**Decision**: Node.js 24 LTS, npm as the package manager. Pin with `.nvmrc` (`24`) and
`package.json` `engines.node` (`>=24 <25`).

**Rationale**: The local environment is Node v24.15.0 / npm 11.12.1; Node 24 is the current
active LTS. The user said "npm packages," so npm — no pnpm/yarn. Pinning satisfies FR-013 and the
edge case where a developer is on an unsupported runtime (clear `engines` error).

**Alternatives considered**: Node 22 LTS (rejected — older than the installed/active LTS, no
benefit); pnpm (rejected — user specified npm).

## Decision 3: Styling layer wiring (tokens deferred)

**Decision**: `create-next-app` emits `app/globals.css`. Relocate global styling to match the
system design layout: create `styles/globals.css` and `styles/tokens.css`, import `tokens.css`
from `globals.css`, import `globals.css` in `app/layout.tsx`, and point Tailwind at `styles/`.
`styles/tokens.css` is created as a **placeholder** in this feature — the actual Lacquer token
values (`design-system/colors_and_type.css`) are vendored by a later styling-foundation feature
(spec Assumptions).

**Rationale**: FR-017 requires the styling system be wired so tokens "drop in" later with no
rework. The Lacquer file is plain CSS custom properties on `:root`/`.dark` over Tailwind v4, so the
wiring is just the import chain plus a Tailwind `@theme inline` mapping stub. Keeping token *values*
out honors constitution Principle V and the spec's scope boundary.

**Alternatives considered**: Vendoring tokens now (rejected — out of this feature's scope);
leaving styles in `app/` (rejected — diverges from the documented repo layout, FR-010).

## Decision 4: Component workflow — shadcn/ui

**Decision**: Run `npx shadcn@latest init` configured for Tailwind v4, base color **neutral**, CSS
file `styles/globals.css`, and the `@/*` alias. Configure `components.json` so generated primitives
land in `components/ui` and the `cn` helper in `lib/utils.ts`. Do **not** add any actual components
in this feature — only prove `npx shadcn@latest add <component>` works.

**Rationale**: FR-018 requires the design-system component workflow to function without further
setup. System design mandates the `components/ui` (primitives) + `components/lacquer` (composed)
split and forbids a second component library.

**CLI note (implementation)**: `npx shadcn@latest` resolves to **CLI v4.7.0**, which replaced the
old `--style default` flag with a template/base/preset system. The init command run was
`npx shadcn@latest init --template next --base radix --preset nova --css-variables --yes`. The
resulting `components.json` still satisfies every requirement above: `baseColor: "neutral"`,
`cssVariables: true`, `css: "styles/globals.css"`, `iconLibrary: "lucide"`, `ui: "@/components/ui"`,
`utils: "@/lib/utils"`. Its `style` field reads `"radix-nova"` (the preset name) rather than
`"default"` — cosmetic only, the generation behaviour is unchanged. Note v4.7.0's `init` now writes
a sample `components/ui/button.tsx` itself; per FR-018/FR-019 no components ship, so that file is
removed after the `add` workflow is proven, leaving the tree clean.

**Alternatives considered**: Adding the full component list from the system design now (rejected —
that is the styling-foundation/feature work, not scaffolding).

## Decision 5: Test harness

**Decision**: Two runners, matching the system design's verification section and constitution
Principle IV:

- **Unit**: Vitest + React Testing Library + `@testing-library/jest-dom`, `jsdom` environment, via
  `npm install -D`. Config in `vitest.config.ts`. One sample passing test under `tests/unit/`.
- **End-to-end**: Playwright via `npm init playwright@latest`. Config `playwright.config.ts` set to
  start the dev server and target it. One sample passing test under `tests/e2e/` that loads the
  placeholder page.

Scripts: `test` (Vitest run), `test:watch`, `test:e2e` (Playwright).

**Rationale**: FR-008/FR-009 require both harnesses green from day one; the constitution makes both
suites CI gates. Vitest pairs naturally with a Vite-aware Next.js project; Playwright is named
directly in the system design.

**Alternatives considered**: Jest (rejected — heavier config with Next 16 / ESM, Vitest is the
current default for new Next projects); Cypress (rejected — system design specifies Playwright).

## Decision 6: Lint and format

**Decision**: Keep the ESLint flat config from `create-next-app` (ESLint 9, `next/core-web-vitals`
+ `next/typescript`). Add Prettier + `eslint-config-prettier` via `npm install -D`. Scripts:
`lint` (ESLint), `format` (Prettier write), `format:check` (Prettier check). Add `.prettierrc` and
`.prettierignore`.

**Rationale**: FR-007 requires one agreed rule set, green on the untouched scaffold. ESLint ships
with the Next scaffold; Prettier owns formatting; `eslint-config-prettier` prevents the two from
fighting. Simple and conventional — constitution Principle V.

**Alternatives considered**: Biome (rejected — would replace the ESLint config Next ships and add a
non-standard tool); ESLint stylistic rules for formatting (rejected — Prettier is the convention).

## Decision 7: Continuous integration

**Decision**: Create `.github/workflows/ci.yml` running, on push and pull request: install (`npm
ci`), `lint`, `format:check`, `typecheck`, `test`, build, then `test:e2e` (with Playwright browser
install). The repository currently has **no git remote**; the workflow file is committed now and
becomes active automatically once a GitHub remote is added.

**Rationale**: FR-015 and constitution "CI gates" require every change to run the quality gates.
GitHub Actions is the default for the Spec Kit git extension's GitHub integration. Committing the
workflow now means zero extra work when the remote is wired up.

**Alternatives considered**: Deferring CI to a later feature (rejected — FR-015 puts it in
scaffolding scope); a different CI provider (rejected — no remote/provider chosen yet, GitHub
Actions is the lowest-friction default and matches the git extension).

## Decision 8: Environment variable template

**Decision**: Commit `.env.example` (and gitignore `.env*.local`) documenting every variable the
v1 app will need, with placeholder values and one-line descriptions. Derived from the system
design: Supabase URL + anon key + service role key, Square application id/secret + environment +
webhook signature key, the acting-as cookie signing secret, and `SALON_TZ`. No real secrets are
committed.

**Rationale**: FR-012 and the "missing env file" edge case. Listing the full v1 variable set now
(even though the services are wired later) gives every contributor one authoritative reference.

**Alternatives considered**: Adding variables incrementally per feature (rejected — leaves
contributors guessing; the system design already enumerates the integrations).

## Decision 9: Directory skeleton

**Decision**: Create the full top-level tree from the system design repo layout, using `.gitkeep`
in otherwise-empty directories so the structure is version-controlled:

```
app/(auth)/{login,select-staff}/  app/(studio)/{calendar,clients,checkout,walkin,end-of-day,settings}/
app/kiosk/[token]/  app/api/webhooks/square/  app/api/square/
components/ui/  components/lacquer/
lib/{db,square,auth,realtime,time}/
styles/  supabase/migrations/  public/icons/
tests/{unit,e2e}/
```

`app/layout.tsx` and a placeholder `app/page.tsx` are real files (FR-004). Everything else is a
`.gitkeep`-held directory awaiting its own feature.

**Rationale**: FR-010 and SC-003 require the skeleton to match the documented layout so later
features have a known home. `.gitkeep` is the standard way to commit an empty directory.

**Alternatives considered**: Creating directories lazily per feature (rejected — fails SC-003 and
makes the structure unpredictable for new contributors, US3).

## Out of scope (confirmed deferred)

- Lacquer design-token *values* (`styles/tokens.css` content) — styling-foundation feature.
- Actual shadcn/ui components and `components/lacquer/*` — later features.
- Database schema / `supabase/migrations/0001_init.sql` — schema feature.
- Square SDK wrappers, auth helpers, realtime helpers — their own features.
- PWA manifest and service worker — build-order step 17.
- Provisioning real Supabase/Square services or secrets.
