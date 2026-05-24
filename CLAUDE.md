# Tang Nails — Repo Guide

This repo is **Tang Nails**, a salon management web app for a single nail salon. The visual language is the **Lacquer** design system (a separate brand identity Tang Nails uses, generated in Claude Design). Source of truth for the build:

- **System design**: `docs/system-design.md` — architecture, scope, data model, flows, build order.
- **Design system**: `design-system/` — the Lacquer brand & component library (tokens, prototypes, UI kits). Vendored copy of the [Claude Design project](https://claude.ai/design/p/019e0124-88cc-7ec5-b59a-055dd1301a03). When the live project changes, re-export the handoff zip and replace `design-system/`.

## Design system rules (non-negotiable)

When writing or reviewing UI code in this repo, you MUST follow `design-system/`:

1. **Read `design-system/README.md` and `design-system/SKILL.md` first** before writing any component or page.
2. **Tokens, not hardcoded values.** All colors, spacing, radii, shadows, and type come from `design-system/colors_and_type.css` (copied into `styles/tokens.css`). No raw hex codes, no off-scale spacing, no custom font weights.
3. **Components** — use shadcn/ui primitives (`components/ui/*`) composed into project-specific components in `components/lacquer/*`. Do not introduce a second component library.
4. **Icons** — Lucide only, 1.5px stroke, sized 16/20/24. No emoji in chrome.
5. **Type** — Inter only, weights 400/500/600. Tabular numerals on every numeric column, time, and currency. Body 14px / 1.5.
6. **Color** — neutral foundation + `--primary` (Lacquer Rose) accent. Semantic colors muted. No gradients in chrome.
7. **Spacing** — 4px base; only the scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
8. **Radii** — `4` inputs, `6` buttons, `8` chips/small cards, `12` cards, `16` sheets/dialogs, `999` pills.
9. **Animation** — 150ms hover/press, 200ms popovers, 300ms sheets/dialogs, ease-out-expo. No bounce/spring/scale.
10. **Copy** — calm, specific, second-person, sentence case, numerals always (`3 services`, `$45`). See README "Content fundamentals."

## Reuse the prototypes

`design-system/ui_kits/studio/*.jsx` and `design-system/prototypes/**/*.jsx` are the reference layouts for v1 surfaces. Do not redraw — adapt them. Mapping is in `docs/system-design.md` under "Reuse from the design system handoff."

## When you change UI

Before claiming a UI task complete:
- Compare your output side-by-side with the matching prototype in `design-system/`.
- Confirm every value used (color, spacing, radius, shadow) traces back to a token.
- Run the design-system preview HTML files (`design-system/preview/*.html`) in a browser if you need to eyeball the canonical look.

## Pre-push quality gates

Before `git push` (or before claiming any feature done), run the full local
gate set — CI runs the same commands and a missed one will bounce the PR.
Run them in this order so the cheapest checks fail fast:

1. `npm run format:check` — Prettier. Fix with `npm run format`.
2. `npm run lint` — ESLint.
3. `npm run typecheck` — `tsc --noEmit`.
4. `npm test` — Vitest unit suite.
5. `npm run test:e2e` — Playwright against a local Supabase. Defaults to
   parallel workers and to the same prebuilt `npm run start` server CI uses
   (sets `PLAYWRIGHT_PROD=1` internally), so cold paths don't pay the
   next-dev JIT compile tax under load. Before Playwright starts, the
   `scripts/test-e2e.mjs` wrapper runs `supabase db reset` (migrate +
   reseed) so every full run begins from the seed baseline — without it
   the suite mutates shared tables and successive local runs accumulate
   rows until seed-baseline assertions fail (issue #92). The reset is
   skipped when the local Supabase stack is unreachable (specs then
   self-skip). For iterating on a single failing spec, use `npm run
   test:e2e:dev` instead — it leaves `PLAYWRIGHT_PROD` unset so `npm run
   dev` hot-reloads edits between runs, and it does NOT reset the DB
   (that would wipe the state you're iterating on). The script is
   wrapped in `flock /tmp/tang-nails-e2e.lock` so
   parallel Claude Code sessions (each in its own worktree) sharing the
   local Supabase stack serialize their e2e runs — see "Parallel sessions"
   below. Two state-scoping patterns let the suite run with `workers > 1`:
   - **Audit-log cursor**: per-test cursors via `newAuditCursor()` /
     `getAuditLogRowsSince()` in `tests/e2e/_db.ts` keep parallel workers
     from racing on the shared `audit_log` table.
   - **Worker-scoped staff fixture**: `tests/e2e/_fixtures.ts` provisions
     a per-worker staff trio (`Test Owner / Manager / Tech [w<N>]`) plus
     auth users. Specs that mutate staff (`staff.spec.ts`,
     `onboarding.spec.ts`, `staff-payout-exemptions.spec.ts`,
     `auth.spec.ts`, `staff-add-wizard.spec.ts`, `staff-mobile.spec.ts`,
     `staff-panel-structure.spec.ts`, `staff-roster-chrome.spec.ts`)
     import `test` from `_fixtures` and operate only on their worker's
     trio. Read-only specs that pick the seeded Maya tile by name keep
     working because the fixture's `[w<N>]` suffix avoids selector
     collisions.

All five MUST be green locally. Constitution v1.0.3 § Development Workflow
& Quality Gates is the authority.

### Parallel sessions

Multiple Claude Code sessions can work on different GitHub issues
concurrently — one git worktree per issue (under `.claude/worktrees/`,
which `.worktreeinclude` auto-populates with env files + local Claude
settings). All worktrees share the **same** locally-running Supabase
stack: `supabase start` is namespaced by `project_id` in
`supabase/config.toml`, identical across worktrees, so the first session
that boots it wins and others' calls no-op against that shared stack.

That's fine for non-e2e work (typecheck, lint, unit tests, `npm run
dev` smoke). But two e2e runs against one shared Postgres would race —
the test suite mutates shared tables (`staff`, `tickets`, `audit_log`)
and `supabase db reset` between runs would wipe another session's seed
state mid-test.

`npm run test:e2e` is wrapped in `flock /tmp/tang-nails-e2e.lock` to
serialize concurrent runs across sessions: only one e2e invocation holds
the lock at a time, others block until release. The `supabase db reset`
the wrapper runs before Playwright happens inside that same lock — one
critical section spans reset + run, so a reset never wipes another
session's in-flight seed state. Single-session runs are unaffected —
uncontended `flock` acquires immediately. **One-time setup on macOS:
`brew install flock`** (Linux ships it via `util-linux`).

`npm run dev` doesn't share state via the lock; if you need to run dev
servers in two worktrees simultaneously, set `PORT=3001` (etc.) in the
second worktree's `.env.local` to avoid the port-3000 collision.

### Two-phase e2e projects

The Playwright suite runs as four chained projects
(`playwright.config.ts`):

1. `baseline-services` — `services.spec.ts` only.
2. `baseline-eod` — `end-of-day-cash.spec.ts` only, depends on
   `baseline-services`.
3. `baseline-dashboard` — `dashboard.spec.ts` only, depends on
   `baseline-eod`.
4. `main` — every other spec, depends on `baseline-dashboard`.

Playwright runs them strictly in order via project `dependencies`: each
baseline project is a single file (one worker, no concurrency), then
`main` runs fully parallel once all three finish.

Why: three specs assert a **global aggregate over a shared table** that
the parallel pool would race —

- `services.spec.ts` — page-computed catalog aggregates (`5 active · 6
  total`, the group-header set); also its US1 empty-state test wipes
  `services` / `tickets` / `payments` globally.
- `end-of-day-cash.spec.ts` — today's cash total (seeded `$115`); also
  wipes every today-paid ticket via `clearAllTodayPaidTickets()`.
- `dashboard.spec.ts` — the exact today-feed row count.

The page renders every row regardless of which worker created it, so no
test-side filter can make these assertions both correct and parallel —
and the destructive wipes would corrupt any concurrent spec's tickets.
Running them in their own serial phase, first, on the freshly-reset DB
(the `test:e2e` wrapper resets before Playwright) keeps the assertions
strong. Order matters: `dashboard.spec.ts` runs last so its `afterAll`
`restoreSeededPaidTickets()` leaves the seeded tickets the earlier
wipes removed in place, so `main` starts from the seed baseline.

The serial baseline phase adds roughly +1–1.5 min to a full
`npm run test:e2e`. `npm run test:e2e:dev` and `npm run test:e2e:changed`
pass Playwright's `--no-deps`, so single-spec / scoped runs skip the
chain and stay fast — only the full `npm run test:e2e` runs it end to
end.

When you add a spec that asserts a global count or summary over a
shared table, add it to a baseline project's `testMatch` (and the
`main` project's `testIgnore`) — otherwise it races the parallel pool.

### Scoping intermediate phase gates

When generating or executing a `specs/<feature>/tasks.md`, intermediate
per-phase gates (e.g. "Phase 5 verification" between user stories) should
run **scoped** commands instead of the full versions. The full suite
belongs at the final gate only.

**E2E** — pick the cheapest tool that fits the phase:

- Default: `npm run test:e2e:changed`. Runs only the specs Playwright
  considers changed (transitive import graph via `--only-changed=<base>`)
  plus any specs the affected-map in `tests/e2e/_affected-map.mjs` pulls
  in for the diff. Base defaults to `origin/main`; override with
  `E2E_BASE=<ref> npm run test:e2e:changed`. No working-tree changes vs
  base prints a no-op message and exits 0. Changes to spec-imported
  helpers (`tests/e2e/_*.ts`) or `playwright.config.ts` fall back to the
  full suite (their blast radius makes scoping unsafe).
- Phase N verifying User Story M (manual override): `npx playwright test
  tests/e2e/<file>.spec.ts -g "USm"`. Use this when you want to target a
  specific user-story slice that the affected-map can't infer — the
  describe-name convention `US1: …`, `US2: …`, `010-US3: …` is what the
  `-g` filter matches.
- When adding a new production code path that no spec imports directly,
  add an entry to `tests/e2e/_affected-map.mjs` so future phases that
  touch it pull the right specs in automatically.

**Prettier + ESLint** — scope to the files the phase touched:
- `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`
- `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`

The `git diff` form covers tracked changes since the last commit; if
nothing is modified the eslint fallback runs the project default (`.`).

**Unit tests** — run `npm run test:changed` at intermediate gates. It
uses Vitest's `--changed` module graph to run only the test files whose
imports transitively touch files changed vs `origin/main` (override the
base with `VITEST_BASE=<ref> npm run test:changed`). No affected files
prints a no-op and exits 0. Full `npm test` belongs at the final gate.

**Typecheck** stays full-suite even at intermediate gates —
TypeScript's project-wide type graph means scoping it adds complexity
without meaningful savings.

**Final gate** (the one before "feature done"): run everything full.
`npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`.

Rationale: a typical 70-task feature ran the full e2e ~3 times in
intermediate gates (≈ 7 min wasted on tests not touched by the phase),
and prettier/lint over the whole repo at every checkpoint adds another
~30s × N. The final full-suite gate still catches anything a scoped run
missed, so the safety net is intact.

### Skill-level optimizations (in `.claude/`)

The project-local agents and skills under `.claude/agents/` and
`.claude/skills/` codify the patterns above so any `/speckit-implement`
run picks them up automatically:

- `speckit-gate-runner` runs the four cheap gates concurrently
  (format:check, lint, typecheck, unit tests) — never sequentially. At
  intermediate phase gates the unit gate is the scoped `npm run
  test:changed`; the final gate uses full `npm test`.
- `speckit-phase-executor` does NOT re-read design docs the orchestrator
  inlines in its dispatch prompt, and does NOT re-install dependencies
  after Phase 1.
- `/speckit-implement` only dispatches `speckit-design-auditor` after
  phases that touched `components/` / `app/` / `styles/`.

## Supabase migrations

`supabase/migrations/**` are applied automatically by GitHub Actions —
**never run `supabase db push` against the hosted projects by hand** unless
explicitly recovering from a CI failure:

- `.github/workflows/db-migrate-preview.yml` — runs on every PR that touches
  `supabase/migrations/**`. Applies to the preview Supabase project so the
  Vercel preview deploy of that PR has the matching schema.
- `.github/workflows/db-migrate-prod.yml` — runs on push to `main`. Applies
  to the production Supabase project.

Both workflows need three repo secrets (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PREVIEW_DB_PASSWORD`, `SUPABASE_PROD_DB_PASSWORD`) and two repo
variables (`SUPABASE_PREVIEW_PROJECT_REF`, `SUPABASE_PROD_PROJECT_REF`).
Constitution v1.0.3 § Development Workflow & Quality Gates — "Schema drift
forbidden" — is the authority.

## Stack reminder

Next.js 16 (App Router, RSC + Server Actions) · Vercel · Supabase (Postgres/RLS, Auth, Realtime, Storage) · Square SDK (server-side) · shadcn/ui + Tailwind + Lucide. See `docs/system-design.md` for the full picture.

## Working on a GitHub issue

Default workflow when asked to work on issue #N:

1. `git -C <repo-root> fetch origin main`
2. `git -C <repo-root> worktree add .claude/worktrees/<N>-<slug> -b <type>/<N>-<slug> origin/main`
   — `<type>` is `chore`, `fix`, or `feat`. Use a worktree (not a plain
   `git checkout -b`) so parallel sessions on other issues stay isolated
   from each other's working directory.
3. Work in the worktree. Run the pre-push gate set there (see "Pre-push
   quality gates" above; e2e is `flock`-serialized so it's safe to run
   even with other sessions active).
4. Commit, push the branch, open a PR with `Closes #N` in the body.
5. Leave the worktree in place for verification; remove after merge with
   `git worktree remove .claude/worktrees/<N>-<slug>`.

Never commit directly to `main`, even for one-line fixes. Check
`git rev-parse --abbrev-ref HEAD` before any commit if unsure.

If the issue is large enough that it doesn't fit a single session, use
Spec Kit (`/speckit-specify`, `/speckit-plan`, etc.) inside the worktree
instead of trying to ship it in one PR.

<!-- SPECKIT START -->
Active plan: `specs/050-reassign-paid-line-tech/plan.md`
<!-- SPECKIT END -->
