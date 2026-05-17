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
   parallel workers; set `PLAYWRIGHT_PROD=1` to opt into the same prebuilt
   `npm run start` server CI uses (avoids next-dev JIT compile flake under
   load). Audit-log assertions are cursor-scoped per-test (see
   `tests/e2e/_db.ts` — `newAuditCursor()` / `getAuditLogRowsSince()`),
   so parallel workers no longer race on the shared `audit_log` table.

All five MUST be green locally. Constitution v1.0.3 § Development Workflow
& Quality Gates is the authority.

### Scoping intermediate phase gates

When generating or executing a `specs/<feature>/tasks.md`, intermediate
per-phase gates (e.g. "Phase 5 verification" between user stories) should
run **scoped** commands instead of the full versions. The full suite
belongs at the final gate only.

**E2E** — filter by user story:
- Phase N verifying User Story M: `npx playwright test tests/e2e/<file>.spec.ts -g "USm"`
  (the describe-name convention `US1: …`, `US2: …`, `010-US3: …` is what
  the `-g` filter matches.)

**Prettier + ESLint** — scope to the files the phase touched:
- `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`
- `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`

The `git diff` form covers tracked changes since the last commit; if
nothing is modified the eslint fallback runs the project default (`.`).

**Typecheck and unit tests** stay full-suite even at intermediate gates —
TypeScript's project-wide type graph and Vitest's fast watch mode mean
scoping them adds complexity without meaningful savings.

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
  (format:check, lint, typecheck, test) — never sequentially.
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

<!-- SPECKIT START -->
Active feature plan: `specs/018-gift-card-split-tender/plan.md` — read it for the
current feature's technical context, project structure, and build steps.
<!-- SPECKIT END -->
