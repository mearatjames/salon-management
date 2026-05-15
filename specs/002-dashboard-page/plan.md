# Implementation Plan: Dashboard (Front-Desk Landing)

**Branch**: `002-dashboard-page` | **Date**: 2026-05-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-dashboard-page/spec.md`

## Summary

Ship the studio app's front-desk landing surface — a calm, glanceable read-only
dashboard that shows today's transactions, services, revenue, tips, and payment
mix, exposes a permanent **"New transaction"** CTA, and offers four quick
actions plus the day's tech roster and a most-recent-transactions feed. The
visual contract is `LandingStats` (Variation B) in
`design-system/prototypes/transaction/Landing.jsx` (lines 282–372).

**Technical approach**: The dashboard is a React Server Component at
`app/(studio)/dashboard/page.tsx` that imports a TypeScript port of the
prototype's mock dataset (`lib/dashboard/mock-data.ts`), pre-aggregates the
`today` / `week` / `month` summaries once on the server, and renders the
header, six-column stat grid, and two-column lower split. A small client
island (`components/lacquer/period-toggle.tsx`) lifts the active-period state
so toggling between Today / Week / Month swaps preprovisioned values without a
network round-trip. Token wiring, three shadcn primitives (`button`, `card`,
`avatar`), and a minimal studio shell layout ride along because this feature
is the first user-visible UI in the repo. Auth gating is a stubbed
`requireStudioSession()` and becomes real when the auth feature lands. See
[research.md](./research.md) for the decision record.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (matches the repo's
`engines`).

**Primary Dependencies**: Next.js 16 (App Router, RSC), React 19, Tailwind
CSS v4 + the existing `@import "./tokens.css"` chain, shadcn/ui primitives
(adds `button`, `card`, `avatar` — Radix-backed), `lucide-react` (already
installed) for every icon at 1.5 px stroke. No new runtime dependencies.

**Storage**: None for this feature. The dashboard reads from an in-repo TS
mock module (`lib/dashboard/mock-data.ts`) modeled on
`design-system/prototypes/transaction/data.jsx`. Supabase wiring is explicitly
deferred (spec FR-017, assumption #2).

**Testing**: Vitest (unit) at `tests/unit/dashboard/*.test.ts` for the pure
helpers (`txTotals`, `txAggregate`, `applyPeriodFactor`, the service-summary
formatter, currency / percent / count formatters, the payment-mix width
calculator with its FR-018 zero-total branch). Playwright e2e at
`tests/e2e/dashboard.spec.ts` exercising the rendered page against `npm run
dev`: tile labels, period-toggle state machine, recent-feed order, CTA
navigation, viewport reflow at 720 px.

**Target Platform**: Web (modern evergreen browsers). The salon counter
tablet (1024 × 768) is the primary form factor; the page must remain legible
from 360 px to 1440 px wide (SC-006). No PWA work in this feature.

**Project Type**: Next.js App Router web application (single repo root, no
`src/` — matches the scaffolding decision).

**Performance Goals**: Period toggle swaps every tile in **under 200 ms with
no network round-trip** (SC-003). Time-to-first-stat is bounded by
server-render of a small precomputed JSON blob — no client-side aggregation,
no Supabase call on this page.

**Constraints**:
- **No raw values**: every color, spacing, radius, shadow, and type-weight
  used by the page must resolve to a `var(--*)` token from
  `styles/tokens.css` (Principle I, FR-014).
- **Mock-data only**: no Supabase queries on this page (FR-017).
- **Read-only**: no mutations, no Server Actions wired up beyond navigation
  (FR-017, spec assumption #7).
- **No second component library**: only shadcn primitives composed into
  `components/lacquer/*` (Principle I).
- **Lucide-only icons** at 1.5 px stroke, sized 14/16/18/20/24 (FR-015).
- **Tabular numerals** on every numeric tile, time stamp, and currency
  (FR-013).
- **No horizontal scroll** at any supported viewport (FR-019, SC-006).
- **Auth gate is stubbed** for this feature; the call site
  (`requireStudioSession()`) is stable so the real implementation drops in
  later without touching the page (see research R2).

**Scale/Scope**: One page, one studio-shell layout, one new client island,
≈10 small presentational components in `components/lacquer/`, one TS mock
data module, one ported stylesheet (Variation-B classes only), one Vitest
suite, one Playwright spec. Three shadcn primitives added. Tokens vendored
verbatim from `design-system/colors_and_type.css`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status | Notes |
|-----------|----------|--------|-------|
| I. Design System Fidelity | **Yes (load-bearing)** | **PASS** | Page adapts `LandingStats` (Variation B) line-by-line (FR-002…FR-013). Tokens are vendored verbatim from `design-system/colors_and_type.css` in this feature (R3). Ported `.tx-*` classes preserve the names the design auditor matches against (R5). shadcn primitives are added in `components/ui/*` and composed into `components/lacquer/*` — no second library (R4). Icons are Lucide only at 1.5 px stroke (FR-015). |
| II. Server-Authoritative Architecture | **Yes (partial)** | **PASS w/ noted deferral** | Page is a Server Component reading from an in-repo source (R6); no client-side fetching. **FR-016 is deferred and stubbed** for this feature only: `requireStudioSession()` returns a fixed demo viewer today; the real Supabase/PIN check + 12-hour cookie + middleware redirect to `/select-staff` lands with feature 007 (auth) per the build order in `docs/system-design.md`. The dashboard call site does not change when the real implementation drops in. No secrets, no Server Actions, no Square calls touched. |
| III. Auditability & Money Integrity | **No** | **N/A** | No mutations, no money writes, no Square calls. The page renders projected display totals from mock data only; nothing reaches `audit_log`, `tickets`, or `payments`. Money invariants are not exercised. |
| IV. Test-First for Critical Paths | **Yes** | **PASS** | A Playwright e2e covers the rendered page end-to-end (period toggle, feed order, CTA navigation, FR-018 zero-period branch, FR-019 reflow). Vitest unit suite locks formatters and the `txAggregate` math used by every tile. Both run in CI. The dashboard is not a "critical money path" per Principle IV.2, so the strict "tests fail before impl" gate does not apply — but the feature ships green test suites that the next features extend. |
| V. Scope Discipline & Cost Restraint | **Yes** | **PASS** | Strictly the spec's scope. Deferred items called out and resisted: real auth (deferred), Supabase wiring (deferred), other shadcn primitives we don't need (deferred), realtime (deferred), PWA (deferred). No paid services introduced. Token-copy + studio-shell + root-redirect ride along only because they are unblockers explicitly listed in the build order (`docs/system-design.md` steps 2 and 9) — see Complexity Tracking. |

**Gate result**: PASS. The only flagged deviations are *deferrals*, not new
complexity: FR-016 is satisfied by a stubbed call site (documented), and tokens
+ studio shell + root redirect are pulled forward exactly as the build order
prescribes. Both are recorded in Complexity Tracking.

*Post-design re-check (after Phase 1)*: The contracts in `contracts/` and the
data model add no new logic beyond what this section already covers; the
Server Component / client island split is preserved; no new dependencies were
introduced by Phase 1. **Constitution Check still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/002-dashboard-page/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decision record
├── data-model.md        # Phase 1 — read-models for the dashboard
├── quickstart.md        # Phase 1 — run & verify walkthrough
├── contracts/
│   ├── README.md
│   ├── dashboard-page.contract.md   # Route + page-shape contract
│   ├── dashboard-data.contract.md   # mock-data.ts public API
│   └── lacquer-components.contract.md  # props for components/lacquer/*
└── checklists/
    └── (existing — untouched by this command)
```

### Source Code (repository root)

```text
app/
├── layout.tsx                       # (existing — root layout, unchanged)
├── page.tsx                         # MODIFIED — server redirect to /dashboard
└── (studio)/
    ├── layout.tsx                   # NEW — studio shell (background, max-width container, stub "Switch staff" + Reconnecting banner)
    └── dashboard/
        └── page.tsx                 # NEW — RSC: load mocks, precompute period summaries, render the page

components/
├── ui/                              # NEW — populated by `npx shadcn add button card avatar`
│   ├── button.tsx
│   ├── card.tsx
│   └── avatar.tsx
└── lacquer/
    ├── stat-card.tsx                # NEW — server component
    ├── payment-mix-card.tsx         # NEW — server component
    ├── new-transaction-cta.tsx      # NEW — server component (links to /checkout)
    ├── secondary-actions.tsx        # NEW — server component (4 quick-action buttons)
    ├── techs-on-shift.tile.tsx      # NEW — server component
    ├── tech-avatar.tsx              # NEW — server component (initials + tone)
    ├── tech-stack.tsx               # NEW — server component (overlap stack)
    ├── recent-transactions-feed.tsx # NEW — server component
    ├── period-toggle.tsx            # NEW — "use client" — lifts active-period state
    └── period-summary.client.tsx    # NEW — "use client" — small wrapper that selects which precomputed summary to display based on active period (the stat-card values + payment-mix props swap here)

lib/
├── auth/
│   └── session.ts                   # NEW — `requireStudioSession()` stub (see research R2)
├── dashboard/
│   ├── mock-data.ts                 # NEW — TS port of `design-system/prototypes/transaction/data.jsx` (STAFF, SERVICES, TX_HISTORY, PERIOD_FACTOR)
│   ├── aggregate.ts                 # NEW — `txTotals`, `txAggregate`, `applyPeriodFactor`, `buildDashboardSummary`
│   └── format.ts                    # NEW — currency / percent / count / service-summary formatters
└── (existing dirs unchanged)

styles/
├── tokens.css                       # MODIFIED — replace placeholder with verbatim copy of `design-system/colors_and_type.css`
├── globals.css                      # UNCHANGED (already imports tokens.css)
└── dashboard.css                    # NEW — Variation-B `.tx-*` classes ported from `design-system/prototypes/transaction/transaction.css`

tests/
├── unit/
│   └── dashboard/
│       ├── aggregate.test.ts        # NEW — txTotals, txAggregate, applyPeriodFactor, buildDashboardSummary (incl. FR-018 zero-total)
│       └── format.test.ts           # NEW — currency / percent / count / service-summary formatters
└── e2e/
    └── dashboard.spec.ts            # NEW — Playwright: render + period toggle + feed + CTA navigation + 720 px reflow
```

**Structure Decision**: Web application (single Next.js app, App Router,
repo-root layout — same as feature 001). The dashboard introduces the first
real studio surface, so this feature also lands the minimal pieces of the
studio shell (`app/(studio)/layout.tsx`) and the design tokens
(`styles/tokens.css`) it depends on. No new top-level directories are
introduced; everything fits inside the scaffolding the previous feature laid
down.

## Phase outputs (for /speckit-tasks)

- **Phase 0**: [research.md](./research.md) — 11 decisions, every
  `NEEDS CLARIFICATION` resolved.
- **Phase 1**:
  - [data-model.md](./data-model.md) — read-models the page renders.
  - [contracts/](./contracts) — page contract, mock-data contract, lacquer-
    component contracts.
  - [quickstart.md](./quickstart.md) — run + verify walkthrough.

## Complexity Tracking

> Two items pulled forward into this feature beyond the spec's headline scope
> because they unblock it and they are exactly what the `docs/system-design.md`
> build order prescribes.

| Item | Why included here | Simpler alternative rejected because |
|------|-------------------|--------------------------------------|
| Vendor `design-system/colors_and_type.css` into `styles/tokens.css` (build-order step 2) | Every `.tx-*` class in the prototype reads tokens (`--card`, `--primary`, `--shadow-xs`, …). Without them FR-014 ("values exclusively from Lacquer tokens") is structurally unachievable. The copy is verbatim — no decisions. | Splitting into a "tokens-only" prerequisite feature adds calendar drag for a one-commit drop-in and produces nothing user-visible on its own. |
| Introduce `app/(studio)/layout.tsx` minimal shell (build-order step 9) | The dashboard is the first studio page. Either it ships the shell or a wrapper feature lands first to do nothing else. | Inlining the shell into `page.tsx` would force every later studio feature (calendar, clients, …) to re-derive the same chrome. |
| `requireStudioSession()` stub call site for FR-016 | The real auth feature (steps 7–8) is not yet built. The page still needs *something* to call so the swap-in later is one file, not a refactor. | Building Supabase auth + PIN + 12-hour cookie + middleware inside this feature would triple its scope and violate Principle V. |
| Three shadcn primitives (`button`, `card`, `avatar`) | The page actually uses them; future surfaces will too. | Pulling the whole list from `docs/system-design.md` step 3 (dialog, sheet, tabs, dropdown-menu, table, calendar, command, popover, select, tooltip, toast, badge, input) here ships dead JS the feature does not need (Principle V). |

No other deviations. Standard implementation discipline applies: keep the page
a Server Component, keep the toggle a single small client island, keep every
visual value pointing at a token.
