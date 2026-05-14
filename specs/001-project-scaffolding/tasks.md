---
description: "Task list for feature 001-project-scaffolding"
---

# Tasks: Project Scaffolding

**Input**: Design documents from `specs/001-project-scaffolding/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: This feature's deliverables *include* the test harness itself, so the sample Vitest and
Playwright tests appear as implementation tasks (not separate TDD test-first tasks) — they exist to
prove the runners work, per spec FR-008 / FR-009.

**Hard constraint (user directive)**: Do a proper `npm install`. Never hand-author `package.json`
or `package-lock.json`. Dependency entries come only from `create-next-app`, `npm install`,
`npx shadcn`, and `npm init playwright`. Scripts and `engines` are set with `npm pkg set`.

**Organization**: Tasks are grouped by user story. Path conventions follow plan.md — repo-root
layout, no `src/` directory.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Generate the Next.js 15 base project with official tooling.

- [ ] T001 Generate the Next.js base in the repo root by running `npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack` (accept overwrite of the existing directory; do NOT let it remove `design-system/`, `docs/`, `specs/`, `.specify/`, `.claude/`, `.agents/`, `CLAUDE.md`, `SKILL.md`, `skills-lock.json`, `.gitignore` — if the generator refuses due to a non-empty directory, scaffold into a temp dir and copy `app/`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, and any `app/globals.css` into place)
- [ ] T002 Verify the base boots: run `npm run dev`, confirm the default page renders at `http://localhost:3000` with no errors, then stop the server

**Checkpoint**: A runnable Next.js 15 project exists at the repo root.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Install the complete v1 dependency stack. Blocks all user stories — US1 needs the
runtime stack present (FR-002, US1 scenario 1), US2 needs the test runners.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [ ] T003 Install the runtime dependency stack with a single `npm install` command: `@supabase/supabase-js @supabase/ssr square @tanstack/react-query zustand lucide-react` (Next.js, React, Tailwind v4 are already present from T001)
- [ ] T004 Install the dev / test dependency stack with `npm install -D`: `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test prettier eslint-config-prettier`
- [ ] T005 Confirm `package.json` and `package-lock.json` were updated only by the npm CLI (no hand edits) and stage both; verify `npm ci` reinstalls cleanly from the lockfile

**Checkpoint**: Full v1 dependency stack installed and lockfile authoritative — user stories can begin.

---

## Phase 3: User Story 1 - Clone, install, and run the app (Priority: P1) 🎯 MVP

**Goal**: A developer can clone, install, start the dev server, and see a placeholder landing
page; the production build succeeds; unsupported runtimes get a clear message.

**Independent Test**: On a fresh `npm ci`, run `npm run dev` and see the Tang Nails placeholder
page; run `npm run build` and get a clean build.

### Implementation for User Story 1

- [ ] T006 [P] [US1] Replace `app/page.tsx` with an explicit Tang Nails placeholder landing page (a single calm heading + one line noting the app is scaffolded; no real features, no design tokens — plain styling only, per FR-019)
- [ ] T007 [P] [US1] Create `.nvmrc` at the repo root containing `24`
- [ ] T008 [P] [US1] Add dependency/build artifacts to `.gitignore` if not already covered by the create-next-app output: `node_modules/`, `.next/`, `out/`, `.env*.local`, `playwright-report/`, `test-results/`, `coverage/`
- [ ] T009 [US1] Set the runtime version constraint with `npm pkg set engines.node=">=24 <25"` (do not hand-edit `package.json`)
- [ ] T010 [US1] Verify US1: `npm ci` succeeds, `npm run dev` serves the placeholder page, `npm run build` completes with no errors, and an unsupported Node version surfaces the `engines` constraint

**Checkpoint**: The app installs, runs to a placeholder page, and builds — MVP is functional.

---

## Phase 4: User Story 2 - Run the quality gates (Priority: P2)

**Goal**: Linting, formatting check, type checking, unit tests, and end-to-end tests are all
configured and pass on the untouched scaffold; CI runs them on every change.

**Independent Test**: On a fresh install, each of `npm run lint`, `npm run format:check`,
`npm run typecheck`, `npm test`, `npm run test:e2e` runs to completion and reports success.

### Implementation for User Story 2

- [ ] T011 [P] [US2] Create `vitest.config.ts` at the repo root: `@vitejs/plugin-react`, `jsdom` environment, `globals: true`, a setup file `tests/setup.ts` importing `@testing-library/jest-dom`, and `include: ['tests/unit/**/*.test.{ts,tsx}']`
- [ ] T012 [P] [US2] Create `.prettierrc` (agreed style) and `.prettierignore` (`.next/`, `node_modules/`, `package-lock.json`, `playwright-report/`, `test-results/`); wire `eslint-config-prettier` into `eslint.config.mjs` so ESLint and Prettier do not conflict
- [ ] T013 [US2] Initialize Playwright by running `npm init playwright@latest` (TypeScript, tests dir `tests/e2e`, no GitHub Actions from the wizard); edit the generated `playwright.config.ts` so `testDir` is `tests/e2e` and `webServer` runs `npm run dev` against `http://localhost:3000`
- [ ] T014 [P] [US2] Create the sample unit test `tests/unit/sample.test.ts` — a trivial passing assertion that proves the Vitest runner works (FR-008)
- [ ] T015 [P] [US2] Create the sample e2e test `tests/e2e/placeholder.spec.ts` — navigates to `/` and asserts the placeholder landing page heading is visible (FR-009)
- [ ] T016 [US2] Add the remaining npm scripts with `npm pkg set` (do not hand-edit `package.json`): `typecheck` = `tsc --noEmit`, `test` = `vitest run`, `test:watch` = `vitest`, `test:e2e` = `playwright test`, `format` = `prettier --write .`, `format:check` = `prettier --check .` (`dev`, `build`, `start`, `lint` already exist from create-next-app)
- [ ] T017 [US2] Run `npm run format` once so the whole scaffold is Prettier-clean, then verify all eight gates green: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`
- [ ] T018 [US2] Create `.github/workflows/ci.yml`: trigger on `push` and `pull_request`; steps — checkout, `actions/setup-node` with Node 24 + npm cache, `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npx playwright install --with-deps`, `npm run test:e2e` (add a comment noting CI activates once a GitHub remote is added)

**Checkpoint**: All quality gates pass locally and a CI pipeline is committed.

---

## Phase 5: User Story 3 - Find your way around the project (Priority: P3)

**Goal**: The directory skeleton matches the system design repo layout, the styling and component
workflows are wired for later features, and the conventional project files are present.

**Independent Test**: Compare the directory tree against `docs/system-design.md` §"Repo layout";
confirm `.env.example`, `.editorconfig`, and `README.md` are present and accurate.

### Implementation for User Story 3

- [ ] T019 [P] [US3] Create the directory skeleton from plan.md / `docs/system-design.md`, holding each empty directory with a `.gitkeep` file: `app/(auth)/{login,select-staff}/`, `app/(studio)/{calendar,clients,checkout,walkin,end-of-day,settings}/`, `app/kiosk/[token]/`, `app/api/webhooks/square/`, `app/api/square/`, `components/ui/`, `components/lacquer/`, `lib/{db,square,auth,realtime,time}/`, `supabase/migrations/`, `public/icons/`
- [ ] T020 [P] [US3] Create `.env.example` listing every v1 environment variable with placeholder (non-secret) values and one-line descriptions: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_ENVIRONMENT`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `ACTING_AS_COOKIE_SECRET`, `SALON_TZ`
- [ ] T021 [P] [US3] Create `.editorconfig` at the repo root with shared editor settings (UTF-8, LF, final newline, 2-space indent) consistent with the Prettier config
- [ ] T022 [US3] Relocate global styling to match the repo layout: move create-next-app's `app/globals.css` to `styles/globals.css`, create a placeholder `styles/tokens.css` (a comment block stating Lacquer tokens are vendored by the later styling-foundation feature) imported from `styles/globals.css`, update the import in `app/layout.tsx` to `@/styles/globals.css`, and confirm `npm run dev` + `npm run build` still pass
- [ ] T023 [US3] Initialize shadcn/ui by running `npx shadcn@latest init` (style: default, base color: neutral, CSS file: `styles/globals.css`, CSS variables: yes); verify `components.json` resolves UI components to `components/ui` and the `cn` helper to `lib/utils.ts`, then confirm `npx shadcn@latest add button` would succeed (run it, then revert the added file — only the workflow is being proven, no components ship per FR-018/FR-019)
- [ ] T024 [US3] Write `README.md` at the repo root covering: prerequisites (Node 24), setup steps (`npm ci`, `cp .env.example .env.local`, `npm run dev`), the eight npm commands and what each checks, and the project structure (mirroring `quickstart.md`)

**Checkpoint**: Structure matches the system design; styling and component workflows are wired;
conventional files are in place.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification that the whole scaffold satisfies the spec.

- [ ] T025 Run the full `quickstart.md` walkthrough end to end on a clean state (`npm ci` → `cp .env.example .env.local` → `npm run dev` → all eight gates) and confirm every step passes
- [ ] T026 Verify reproducibility (SC-006): on a second clean checkout/clone, `npm ci` produces an unchanged `package-lock.json`
- [ ] T027 Verify SC-003: every top-level directory in `docs/system-design.md` §"Repo layout" exists in the scaffold; run `npm run format:check` one final time to confirm the tree is clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Phase 2. Recommended sequential by priority
  (US1 → US2 → US3) because US2's e2e test loads US1's placeholder page and US3's styling
  relocation touches US1's `app/layout.tsx` import. They can be parallelized only with care.
- **Polish (Phase 6)**: Depends on US1–US3 complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Independently testable (dev server + build).
- **US2 (P2)**: Depends on Foundational; its sample e2e test exercises US1's placeholder page, so
  US1 should be done first for a green `test:e2e`.
- **US3 (P3)**: Depends on Foundational; T022 updates the `app/layout.tsx` import created in US1.
  Re-run US1's verify (T010) after T022 to confirm nothing regressed.

### Within Each User Story

- US1: T006/T007/T008 [P] → T009 → T010 (verify last).
- US2: T011/T012 [P], then T013 → T014/T015 [P] → T016 → T017 → T018.
- US3: T019/T020/T021 [P] → T022 → T023; T024 last.

### Parallel Opportunities

- **US1**: T006 (`app/page.tsx`), T007 (`.nvmrc`), T008 (`.gitignore`) — different files.
- **US2**: T011 (`vitest.config.ts`), T012 (`.prettierrc`/`eslint.config.mjs`) — different files;
  later T014 (`tests/unit/...`) and T015 (`tests/e2e/...`) — different files.
- **US3**: T019 (skeleton dirs), T020 (`.env.example`), T021 (`.editorconfig`) — different files.

---

## Parallel Example: User Story 1

```bash
# Launch the independent US1 file-creation tasks together:
Task: "Replace app/page.tsx with the Tang Nails placeholder landing page"
Task: "Create .nvmrc containing 24"
Task: "Add dependency/build artifacts to .gitignore"
# Then T009 (npm pkg set engines), then T010 (verify).
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — `create-next-app` base.
2. Phase 2: Foundational — full `npm install` of the v1 stack.
3. Phase 3: US1 — placeholder page, runtime pin, verify dev + build.
4. **STOP and VALIDATE**: a developer can clone, install, and run. MVP reached.

### Incremental Delivery

1. Setup + Foundational → runnable project with all deps.
2. US1 → clone/install/run works → MVP.
3. US2 → quality gates green + CI committed.
4. US3 → structure, styling/component wiring, conventional files.
5. Polish → full quickstart verification.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- [Story] label maps each task to its user story for traceability.
- **Never hand-author `package.json` / `package-lock.json`** — generators and `npm` only.
- Token *values*, real components, the DB schema, Square/auth/realtime code, and the PWA manifest
  are out of scope (research.md "Out of scope") — this feature ships placeholders only.
- Commit after each phase or logical group; stop at any checkpoint to validate the story.
