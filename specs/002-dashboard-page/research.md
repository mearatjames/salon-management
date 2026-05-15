# Research: Dashboard (Front-Desk Landing)

**Feature**: 002-dashboard-page
**Date**: 2026-05-14
**Scope**: Resolve every `NEEDS CLARIFICATION` raised by the plan template before
Phase 1 design, and record the decision behind each technology choice the
dashboard depends on.

The dashboard ships **mock-data only** and is the studio app's first user-visible
surface after sign-in. The visual contract is `LandingStats` (Variation B) in
`design-system/prototypes/transaction/Landing.jsx` (lines 282–372).

## R1. Where do dashboard numbers come from? (FR-017)

- **Decision**: An in-repo TypeScript port of `design-system/prototypes/transaction/data.jsx`,
  living at `lib/dashboard/mock-data.ts`, exposing the same shapes the prototype
  uses (`SERVICES`, `STAFF`, `TX_HISTORY`, `PERIOD_FACTOR`, `txTotals`,
  `txAggregate`).
- **Rationale**: Spec FR-017 + assumption #2 are explicit — wiring to Supabase
  is out of scope. The dashboard must look and behave exactly like the prototype
  Variation B, so reusing the prototype's data shape verbatim removes a class of
  drift bugs and lets the later Supabase-wiring feature swap the source without
  touching the page. Keeping the file under `lib/dashboard/` (not `app/`) keeps
  the page component thin and free of bundled JS the user does not need.
- **Alternatives considered**:
  - *Import the prototype `.jsx` directly* — rejected; it writes to `window.*`,
    references React/`useState` as globals, and is meant for the static preview
    sandbox, not a Next.js build.
  - *Random-generated mock per render* — rejected; SC-003 needs deterministic
    tile values across period toggles and a stable Recent-Transactions feed for
    e2e screenshots.
  - *Read from a JSON fixture in `tests/`* — rejected; the page is production
    code, not a test fixture; we'd just be moving the same data one level over.

## R2. Auth gating for the dashboard route (FR-016)

- **Decision**: For this feature the dashboard route is **not gated** by a real
  session check. We add a single-call placeholder `requireStudioSession()` in
  `lib/auth/session.ts` that today returns a stub viewer (`{ id: "demo-staff",
  name: "Maya Patel" }`) and will be replaced by the real Supabase/PIN check
  when feature **007 (auth)** lands per `docs/system-design.md` "Files to
  create" steps 7–8. The dashboard imports the helper; the call site does not
  change when the implementation does.
- **Rationale**: The spec's auth gate (FR-016) and assumption ("login /
  select-staff flow is unchanged") presume the auth feature exists. It does
  not — `app/(auth)/login` and `app/(auth)/select-staff` are empty placeholders
  from scaffolding, and the build order in `docs/system-design.md` places auth
  before any studio page. Building the auth flow inside this feature would
  break Principle V (scope discipline) and triple the surface area. The
  placeholder lets us honor the contract *shape* now and flip the
  implementation in one place later without touching the dashboard.
- **Alternatives considered**:
  - *Build a minimal Supabase auth + PIN gate now* — rejected; that is an
    entire feature with its own RLS, migrations, and tests. Out of scope.
  - *No auth helper at all; rely on the eventual middleware* — rejected; the
    page needs the operator name + on-shift roster for the header subtitle, so
    it must call something today.
- **Spec impact**: A `clarification` note is added inline in `plan.md`
  (Constitution Check, Principle II) explaining that FR-016 is **deferred and
  stubbed** for this feature only; the redirect behavior becomes real with the
  auth feature.

## R3. Design tokens (`styles/tokens.css`) — populate now? (FR-014, Principle I)

- **Decision**: Copy `design-system/colors_and_type.css` verbatim into
  `styles/tokens.css` as part of this feature. Replace the current placeholder
  comment with the full token file (palette + semantic + radius + shadow +
  spacing + type). Do **not** edit `app/globals.css` token defaults beyond
  what the new tokens file already supplies.
- **Rationale**: Every `tx-*` class in the prototype reads from `var(--card)`,
  `var(--border)`, `var(--primary)`, `var(--shadow-xs)`, `var(--success)`,
  `var(--destructive)`, `var(--ring)`, etc. These tokens do not exist yet —
  `styles/tokens.css` is a placeholder per the scaffolding research record.
  Without them, FR-014 ("colors, spacing, radii, shadows, type weights …
  exclusively from the Lacquer design tokens") is structurally unachievable.
  The system design lists token vendoring as step 2 in the build order, so
  doing it here unblocks every UI feature that follows.
- **Alternatives considered**:
  - *Split into a separate "tokens + shadcn primitives" feature first* —
    rejected as overkill; the file is a verbatim copy with no decisions in it,
    and gating this feature on a one-commit prerequisite adds calendar drag.
    The plan calls out the token-copy step as a discrete task with its own
    verification so it stays auditable.
  - *Inline the tokens at the bottom of `app/globals.css`* — rejected; the
    scaffolded `globals.css` already `@import "./tokens.css"`. Honor that wiring.

## R4. shadcn/ui primitives needed by the dashboard

- **Decision**: This feature pulls in three primitives via `npx shadcn add`:
  - `button` — used by the period toggle, the "New transaction" CTA, secondary
    quick-action buttons, and the "View all" link.
  - `card` — backing surface for stat tiles, payment-mix card, feed container,
    and the "Techs on shift" tile.
  - `avatar` — Lucide-styled circular initials for the tech roster + the
    avatar stack in feed rows.
  - **Icons** are `lucide-react` (already installed); no `icon` primitive.
- **Rationale**: Principle I forbids a second component library. The prototype
  already uses CSS classes (`.tx-stat-card`, `.tx-cta-primary`, etc.) on plain
  buttons/divs; we wrap those classes around shadcn primitives so future
  variants inherit `aria-*`, focus-visible, and disabled states without
  re-deriving them. We deliberately do **not** add `dialog`, `sheet`, `tabs`,
  or `dropdown-menu` here — those land with the features that actually need
  them (Principle V).
- **Alternatives considered**:
  - *Vendor every primitive listed in `docs/system-design.md` step 3* —
    rejected; YAGNI for this read-only surface and it bloats first paint with
    Radix code paths the page never invokes.

## R5. Where do the dashboard's CSS classes live?

- **Decision**: Add a single new stylesheet `styles/dashboard.css` that ports
  *only* the prototype classes Variation B actually uses
  (`.tx-landing`, `.tx-landing-top`, `.tx-period`, `.tx-stat-card`,
  `.tx-cta-primary`, `.tx-secondary-action`, `.tx-method-bar`,
  `.tx-method-row`, `.tx-feed`, `.tx-feed-h`, `.tx-feed-list`, `.tx-feed-row`,
  `.tx-meth-pill`, `.tx-tech-avatar`, `.tnum`). Import it once from
  `app/(studio)/dashboard/page.tsx`. Every property continues to resolve to
  the tokens we vendor in R3.
- **Rationale**: The prototype uses one big `transaction.css` shared by *every*
  transaction surface (POS, Landing, EndOfDay, DayReport). Importing all of
  it here would ship hundreds of unused rules. Tailwind utility migration is
  also wrong: the prototype encodes a specific layout grammar (e.g. method-bar
  segment widths, period-toggle active-state inset shadow) that survives best
  when kept as named, token-backed classes the next prototype edit can be
  diffed against. The page can still use Tailwind utilities for trivial spacing
  inside Server Component composition; the named classes carry the chrome.
- **Alternatives considered**:
  - *CSS Modules* — rejected; the prototype's class names are the audit anchor
    (Principle I, "side-by-side comparison"). Mangled module names break that.
  - *Tailwind-only rewrite* — rejected; high churn risk, and the design-system
    auditor matches against the canonical `.tx-*` names.

## R6. Client/server boundary for the page

- **Decision**: `app/(studio)/dashboard/page.tsx` is a **React Server Component**
  that loads the mock dataset, computes the four period aggregates once at
  request time, and renders the static header + tiles + roster + feed. The
  *period toggle* is a small `"use client"` island that lifts a single piece of
  state — the active period — and the four stat cards + payment-mix card read
  their values from a precomputed `{ today, week, month }` summary passed as
  props.
- **Rationale**: Aligns with Principle II ("reads for read-heavy pages MUST
  use React Server Components"). The page has no mutations and no user input
  beyond a toggle. Precomputing all three periods on the server avoids
  shipping `txAggregate` to the browser and keeps the toggle a pure UI swap —
  satisfying SC-003's "under 200 ms / no partial refreshes" target without a
  network round trip.
- **Alternatives considered**:
  - *Whole-page client component (matches the prototype)* — rejected; ships
    `SERVICES`, `STAFF`, `TX_HISTORY`, and helpers to the browser for no gain.
  - *Server actions to recompute on toggle* — rejected; introduces latency and
    breaks SC-003.

## R7. Comparison strings on Week / Month (FR-006)

- **Decision**: The "+3 vs avg" and "+12%" comparison strings render *only*
  when the active period is `today`. For `week` and `month` the `delta` prop
  on `<StatCard />` is `null` and the row collapses (no placeholder dash).
- **Rationale**: Matches the prototype source line 312 and 318 (`delta={period
  === "today" ? "+3 vs avg" : null}`) and the spec's FR-006. The prototype's
  multipliers are explicitly "plausible-looking placeholders" (spec
  assumption), so claiming a real percentage delta against mock historicals
  would be misleading.
- **Alternatives considered**:
  - *Compute a synthetic delta against last period's mock* — rejected;
    fabricated math doesn't help users and quietly violates "calm, specific"
    copy.

## R8. Test strategy for the feature

- **Decision**: Two test layers:
  1. **Vitest unit tests** (`tests/unit/dashboard/*.test.ts`) for the pure
     helpers: `txTotals`, `txAggregate`, `applyPeriodFactor`, the service
     summary string formatter, currency / percent / count formatters, and the
     payment-mix width calculator (must handle the divide-by-zero branch in
     FR-018).
  2. **Playwright e2e test** (`tests/e2e/dashboard.spec.ts`) running against
     `npm run dev`: loads `/dashboard`, asserts the five tile labels are
     present, clicks each period button, asserts every tile updates to its
     expected value from the mock dataset, asserts the recent-transactions
     list shows exactly 7 rows in most-recent-first order, asserts the "New
     transaction" CTA navigates to `/checkout`.
- **Rationale**: Principle IV mandates a Playwright e2e per feature. Currency
  and percent formatting were the source of a meaningful chunk of POS bugs in
  prior salon software, so unit-locking those formatters is cheap insurance
  even though the dashboard is read-only.
- **Alternatives considered**:
  - *Snapshot-only Playwright* — rejected; visual regressions are real but a
    snapshot can't tell you "the toggle wired the period correctly", which is
    the heart of SC-003.

## R9. Period multipliers — keep as-is?

- **Decision**: Reuse the prototype's `PERIOD_FACTOR = { today: 1, week: 6.4,
  month: 27 }` verbatim. Surface a `// TODO` comment in `mock-data.ts`
  pointing to the future Supabase-backed window aggregation. Document this in
  `quickstart.md` "Known placeholders".
- **Rationale**: Spec assumption — these are deliberate placeholders, not real
  rollups. Picking different multipliers now solves nothing and risks
  divergence from the canonical prototype the design auditor compares against.
- **Alternatives considered**:
  - *Generate per-period mock datasets so multipliers are unnecessary* —
    rejected as scope creep; the page reads from the same single TX list
    today, and the multiplier swap is a one-line change when real data lands.

## R10. Studio shell layout

- **Decision**: This feature introduces `app/(studio)/layout.tsx` as a minimal
  shell — `<html>`-side font/body remain in the root layout; the studio
  segment adds the dashboard frame (Lacquer background, max-width container,
  scroll container) so the dashboard *and* future studio pages share it.
  "Switch staff" and "Reconnecting…" banner are stubbed (rendered but
  disabled) and wired by the auth + realtime features later.
- **Rationale**: The dashboard is the first studio page; either it ships the
  shell or the shell ships in a wrapper feature. System design step 9 places
  the shell before any studio page; bundling it here keeps the page and its
  surrounding chrome inside one PR for design review.
- **Alternatives considered**:
  - *Render the shell inside `page.tsx`* — rejected; the next feature (calendar)
    would then re-derive it. Layout file is the right primitive.

## R11. Root redirect

- **Decision**: Replace the current `app/page.tsx` placeholder with a Server
  Component that returns `redirect("/dashboard")` (Next 16 `redirect` from
  `next/navigation`). Per assumption #3 the dashboard becomes the studio
  default landing.
- **Rationale**: Direct, satisfies FR-001 and SC-005 with one server-side
  redirect. When auth lands, the redirect target stays `/dashboard`; only the
  middleware-level gate ahead of it changes.

---

## Decisions summary (for `plan.md` Technical Context cross-reference)

| Topic                          | Decision                                                            |
|--------------------------------|----------------------------------------------------------------------|
| Data source                    | TS port of prototype `data.jsx` at `lib/dashboard/mock-data.ts`     |
| Auth gating                    | Stub `requireStudioSession()`; real gate deferred to auth feature   |
| Design tokens                  | Vendor `colors_and_type.css` verbatim into `styles/tokens.css`      |
| shadcn primitives added now    | `button`, `card`, `avatar` only                                     |
| CSS port location              | `styles/dashboard.css` (Variation B classes only)                   |
| RSC vs client                  | Page is RSC; period toggle is a small client island                 |
| Comparison strings             | Only on `today` (matches prototype + FR-006)                        |
| Tests                          | Vitest unit (formatters/aggregates) + Playwright e2e (`/dashboard`) |
| Period multipliers             | Reuse `{ today: 1, week: 6.4, month: 27 }` placeholders             |
| Studio shell                   | Introduce `app/(studio)/layout.tsx` here                            |
| Root redirect                  | `app/page.tsx` → `redirect("/dashboard")`                           |

All `NEEDS CLARIFICATION` placeholders introduced by the plan template are
resolved by the decisions above.
