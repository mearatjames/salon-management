---

description: "Tasks for feature 002: Dashboard (Front-Desk Landing)"
---

# Tasks: Dashboard (Front-Desk Landing)

**Input**: Design documents from `/specs/002-dashboard-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/dashboard-page.contract.md, contracts/dashboard-data.contract.md,
contracts/lacquer-components.contract.md, quickstart.md

**Tests**: INCLUDED. Constitution Principle IV mandates one Playwright e2e
per v1 feature; Vitest unit coverage is mandated for any helper exercised by
the page (formatters, aggregates, FR-018 zero-branch).

**Organization**: Tasks are grouped by the three user stories defined in
`spec.md` (US1 / US2 / US3). Phases 1–2 are blocking prerequisites; Phases
3–5 deliver one user story each; Phase 6 is cross-cutting polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to a `spec.md` user story (`[US1]`, `[US2]`, `[US3]`)
- Every task lists exact file paths

## Path Conventions

This feature is the Next.js App Router monorepo laid down by feature 001 —
repo-root, no `src/`. All paths below are relative to
`/Users/mearathou/Dev/salon-management/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pull forward the build-order prerequisites the dashboard
depends on. None of these are user-facing on their own.

- [X] T001 Replace the placeholder `styles/tokens.css` with a verbatim copy of `design-system/colors_and_type.css`. Do NOT edit `:root` tokens already in `styles/globals.css` — the imported file supplies them. After this task, every `var(--background)`, `var(--card)`, `var(--primary)`, `var(--shadow-xs)`, `var(--success)`, `var(--destructive)`, `var(--ring)`, etc. resolves at runtime. Verify in DevTools: opening the placeholder home page shows the new background color (`--neutral-50`).
- [X] T002 [P] Create `styles/dashboard.css` containing **only** the Variation-B classes from `design-system/prototypes/transaction/transaction.css` — `.tx-landing`, `.tx-landing-top`, `.tx-period`, `.tx-stat-card` (label/value/delta variants), `.tx-cta-primary` (icon/sub variants), `.tx-secondary-action` (lbl/h variants), `.tx-method-bar` (card/cash/gift segments), `.tx-method-row` (nm/dot/num), `.tx-feed`, `.tx-feed-h`, `.tx-feed-list`, `.tx-feed-row` (time/client/svc/amt/meth), `.tx-meth-pill` (card/cash/gift variants), `.tx-tech-avatars`, `.tx-tech-avatar`, `.tx-tech-overflow`, `.tnum`, `.muted`, `.sub`. Strip everything else. Confirm every property value resolves to a `var(--*)` from `styles/tokens.css` (no raw hex). Constitution Principle I.
- [X] T003 [P] Add three shadcn primitives via `npx shadcn@latest add button card avatar`. Confirm the generator writes `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/avatar.tsx` and does not modify any other file. No other primitives are added in this feature (Principle V).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Studio shell, auth stub, mock dataset, pure helpers, and root
redirect — everything every user story below leans on. NO user-story work
begins until this phase is green.

**⚠️ CRITICAL**: Every task here ships with its own unit coverage (where
applicable). All gates (`typecheck`, `lint`, `test`) must pass before Phase 3.

- [X] T004 Create `lib/auth/session.ts` exporting `type StudioViewer = { id: string; staffId: string; displayName: string }` and `export async function requireStudioSession(): Promise<StudioViewer>` that returns the fixed stub `{ id: "demo", staffId: "maya", displayName: "Maya Patel" }`. Top of the file documents (single short comment) that the body is replaced by the auth feature; the signature is the contract. (research.md R2, plan.md Complexity Tracking row 3.)
- [X] T005 [P] Create `lib/dashboard/mock-data.ts` — a TypeScript port of `design-system/prototypes/transaction/data.jsx`. Export `Service`, `Technician`, `TxLineItem`, `Transaction` types matching `data-model.md`, plus `SERVICES`, `STAFF`, `TX_HISTORY` (every row verbatim from the prototype, in the same order), and `PERIOD_FACTOR = { today: 1, week: 6.4, month: 27 }`. Drop the `window.*` assignments. Top-of-file `// TODO` comment cites the Supabase-wiring feature as the replacement point. (research.md R1, R9.)
- [X] T006 [P] Create `lib/dashboard/format.ts` exporting `formatCurrency(amount)`, `formatPercent(fraction)`, `formatCount(n)`, `formatServiceLabel(items, services)`, and `paymentMixWidths(byMethod, total)` exactly as specified in `contracts/dashboard-data.contract.md`. Use `Intl.NumberFormat("en-US", …)` for currency / percent / count. `paymentMixWidths` returns `{ card, cash, gift, neutral }` percentages — `{0,0,0,100}` when `total === 0` (FR-018 zero branch).
- [X] T007 [P] Create `tests/unit/dashboard/format.test.ts` covering: integer currency rendering with comma thousands (`$1,240`), zero currency (`$0`), percent rounding (`0.184 → "18%"`, `0.185 → "19%"`), `formatServiceLabel` ≤2-items (`"A, B"`) and ≥3-items (`"A +2 more"`) cases, and `paymentMixWidths` happy-path + zero-total branch. Run `npm test -- format` to confirm green.
- [X] T008 Create `lib/dashboard/aggregate.ts` exporting `txTotals(tx)`, `txAggregate(list)`, `applyPeriodFactor(base, period)`, and `buildDashboardData()`. Mirror the prototype math from `design-system/prototypes/transaction/data.jsx:183-209`. `applyPeriodFactor` rounds `count` and `services` to integers and short-circuits to all-zeroes when `base.count === 0`. `buildDashboardData()` is pure and returns the full `DashboardData` shape from `data-model.md`. Specifically it must populate every field: (i) `greeting = { eyebrow: "Lacquer Studio · Front desk", title: "Today at the salon", subtitle: \`Tuesday, May 12 · ${STAFF.length} techs on shift · Last sale 4:14 PM\` }` — static prototype strings for v1 (see spec.md Assumptions, research.md R6); (ii) `summaries` — precompute all three periods by calling `applyPeriodFactor` over `txAggregate(TX_HISTORY)`; (iii) `staff = STAFF` (everyone is "on shift" in v1); (iv) `recent = TX_HISTORY.slice(-7).reverse().map(txToRow)` where `txToRow` projects each transaction into a `TransactionRow` using `formatServiceLabel` and `txTotals(...).total`; (v) `comparisons` — always the literal static object `{ transactionsVsAvg: "+3 vs avg", revenueDelta: "+12%" }` (display gating happens in `<PeriodSummary />`); (vi) `quickActions` — the four-row fixed list from `data-model.md`'s QuickAction table. (Depends on T005, T006.)
- [X] T009 Create `tests/unit/dashboard/aggregate.test.ts` covering: `txTotals` for a single-item and a multi-item transaction (incl. add-on with explicit `price` override), `txAggregate` totals invariant (`byMethod.card + .cash + .gift ≈ total`), `applyPeriodFactor` integer rounding (`count`, `services` are integers for every period), FR-018 zero-count short-circuit, and `buildDashboardData()` end-to-end: `greeting.eyebrow === "Lacquer Studio · Front desk"`, `greeting.title === "Today at the salon"`, `greeting.subtitle.startsWith("Tuesday, May 12")`, `summaries.today.count === 17`, `summaries.week.count === Math.round(17 * 6.4)`, `summaries.month.count === Math.round(17 * 27)`, `recent.length === 7`, `recent[0].id === "tx-0130"` (most recent), `recent[6].id === "tx-0124"`, `comparisons === { transactionsVsAvg: "+3 vs avg", revenueDelta: "+12%" }` (always populated — display gating is the page's job), `quickActions.length === 4`, and `staff.length === STAFF.length`. Run `npm test -- aggregate` to confirm green. (Depends on T008.)
- [X] T010 Create `app/(studio)/layout.tsx` — a minimal studio shell. Render `<html>`-less (root layout owns it); the studio segment wraps its children in a centered `<main className="tx-landing" data-density="regular">` container that imports `styles/dashboard.css` (top of file). Add visible-but-disabled header controls "Switch staff" (anchor with `aria-disabled`) and a "Reconnecting…" banner placeholder (CSS-hidden by default). One short comment notes both are wired by later features. (plan.md Complexity Tracking row 2, quickstart.md Known placeholders.)
- [X] T011 Replace `app/page.tsx` with a Server Component that calls `redirect("/dashboard")` from `next/navigation`. Remove the placeholder JSX entirely. After this task, `npm run dev` + opening `localhost:3000` should issue a 307 to `/dashboard` (which returns 404 until T016). (FR-001, SC-005.)

**Checkpoint**: All four gates green (`npm run typecheck && npm run lint && npm test`). `/dashboard` 404s; everything below now has its prerequisites.

---

## Phase 3: User Story 1 — At-a-glance day summary (Priority: P1) 🎯 MVP

**Goal**: Render the dashboard's header band + 5 stat tiles (Transactions,
Services, Revenue, Tips, Payment mix) and wire the Today / Week / Month
toggle so all five tiles update in unison from precomputed summaries — with
no network round-trip and no partial refresh (SC-003).

**Independent Test**: Open `/dashboard`. Verify the header text, the five
tiles populated with non-zero values from `TX_HISTORY`, and that clicking
each of the three period buttons swaps every tile's value in <200 ms. Verify
FR-006: comparison strings (`+3 vs avg`, `+12%`) only render when `Today` is
active.

### Implementation for User Story 1

- [X] T012 [P] [US1] Create `components/lacquer/stat-card.tsx` (server component) matching the `<StatCard />` props in `contracts/lacquer-components.contract.md`: `label`, `value`, optional `sub`, optional `delta`, optional `icon`. Wraps `components/ui/card.tsx` and applies the `.tx-stat-card` chrome. `delta` renders the up/down color via the `.up` / `.down` modifier classes when the string starts with `+` / `−`; null hides the delta. Value uses `.tnum`. (FR-005, FR-006, FR-013.)
- [X] T013 [P] [US1] Create `components/lacquer/payment-mix-card.tsx` (server component) matching the contract: `byMethod`, `total`. Uses `paymentMixWidths(byMethod, total)` to set segment widths on the `.tx-method-bar` and renders the three-row legend (`Card`, `Cash`, `Gift card`) via `.tx-method-row` (with `.dot.card/.cash/.gift`). Header reads "Payment mix" + Lucide `<Wallet />` at 14 px. FR-018: when `paymentMixWidths` returns `neutral === 100`, render a single `<span style={{ width: "100%", background: "var(--muted)" }} />` instead of the three method segments. (FR-007, FR-018.)
- [X] T014 [P] [US1] Create `components/lacquer/period-toggle.tsx` as a `"use client"` module. Export THREE things from this file (it is the island root for the period state): (a) `<PeriodProvider summaries comparisons>` that owns `useState<DashboardPeriod>("today")` and supplies context `{ period, setPeriod, summary: summaries[period], comparisons }`; (b) `usePeriod()` hook returning that context (throws when used outside the provider); (c) `<PeriodToggle />` (no props — reads from `usePeriod()`) — three `<button>` elements styled via `.tx-period` + `.active`; click calls `setPeriod(next)` but short-circuits when `next === period` (Edge case "Period switch during slow render"). Each button is a native `<button>` so focus-visible inherits from the shadcn primitive used as a base. (FR-004.)
- [X] T015 [US1] Create `components/lacquer/period-summary.client.tsx` as a `"use client"` component (no props — it reads from `usePeriod()` imported from `./period-toggle`). Renders a 6-column grid containing four `<StatCard />`s (Transactions / Services / Revenue / Tips) reading values from the context's `summary` plus one `<PaymentMixCard />` spanning 2 columns. Passes `comparisons.transactionsVsAvg` to the Transactions card's `delta` and `comparisons.revenueDelta` to the Revenue card's `delta` **only when `period === "today"`** (FR-006); pass `null` otherwise. (Depends on T012, T013, T014.)
- [X] T016 [US1] Create `app/(studio)/dashboard/page.tsx` as a React Server Component. Top of file: `import "@/styles/dashboard.css"` (idempotent — the studio layout also imports it, but this anchors the page to the stylesheet). Call `await requireStudioSession()` (T004) and `buildDashboardData()` (T008). Wrap the whole render in `<PeriodProvider summaries={data.summaries} comparisons={data.comparisons}>` (imported from `components/lacquer/period-toggle`). Inside the provider render the `<div className="tx-landing">` chrome containing `<div className="tx-landing-top">` with two columns: left column = eyebrow + `<h1>Today at the salon</h1>` + subtitle (use `data.greeting`); right column = `<PeriodToggle />` followed by a slot for the CTA that T019 fills. Below the header: render `<PeriodSummary />` (no props — reads context). Leave the lower split empty for now (T026 fills it). (FR-002, FR-003.)
- [X] T017 [US1] Create `tests/e2e/dashboard.spec.ts` (Playwright). Cover US1 only: navigate to `/dashboard`; assert the eyebrow, `<h1>`, and subtitle text from FR-003; assert the five tile labels are present (`Transactions`, `Services`, `Revenue`, `Tips`, `Payment mix`); assert the Today-default values (`17` transactions; `~$1,*** ` revenue; assert a deterministic value via the same constants the unit tests use — read them from `lib/dashboard/aggregate.ts` via a small helper export). Click `Week` and assert every tile value changes; click `Month` and assert every tile value changes again and `+3 vs avg` / `+12%` are NOT in the DOM (FR-006). Click `Today` again and assert deltas reappear. Re-click the already-active button and assert no value flicker (re-clicking is a no-op). Add a `page.route` listener and assert no `fetch` / XHR fires during the toggle (SC-003). (FR-004, FR-006, SC-003.)

**Checkpoint**: US1 is fully functional. `/dashboard` shows the header + 5
tiles + working toggle. Playwright spec covering US1 passes locally and in
CI. The lower half of the page is intentionally empty.

---

## Phase 4: User Story 2 — New transaction CTA (Priority: P1)

**Goal**: A permanent, prominent "New transaction" button in the dashboard
header that begins the checkout flow. Reachable by keyboard before any
secondary action (SC-002).

**Independent Test**: Open `/dashboard`. Confirm the CTA is visible in the
header, tabbing from the address bar reaches it before anything else
focusable on the page, and clicking / Enter navigates to `/checkout`.

### Implementation for User Story 2

- [X] T018 [P] [US2] Create `components/lacquer/new-transaction-cta.tsx` (server component) matching the contract: `href?: string` (default `/checkout`), `sub?: string` (default `"Charge a sale"`). Renders as a Next `<Link href={href}>` styled with `.tx-cta-primary`. Inside: a 36 px circular badge containing Lucide `<Plus size={20} />`, then a stacked label (`"New transaction"` on top, `sub` underneath as `.sub`), then `<ChevronRight size={18} />` on the right. The `<Link>` carries `tabIndex={0}` implicitly; no need to override. (FR-008.)
- [X] T019 [US2] Edit `app/(studio)/dashboard/page.tsx` to slot `<NewTransactionCTA />` into the header band's right-hand column, beneath the period toggle slot. Confirm via DevTools that the `<Link>` element's natural tab-order position is before the four secondary-action buttons that Phase 5 will add (SC-002). No layout class changes — the existing `.tx-landing-top` two-column layout already supports stacking.
- [X] T020 [US2] Extend `tests/e2e/dashboard.spec.ts` with a US2 test block: assert the CTA is in the DOM with the exact text `New transaction` and subtitle `Charge a sale`; click it and assert URL becomes `/checkout` (placeholder route — a 404 page is acceptable as long as the navigation fired). Add a keyboard-only assertion: press `Tab` from the page body and confirm the CTA receives focus before any `.tx-secondary-action` (which won't exist until Phase 5 — the keyboard assertion still passes today and remains valid after Phase 5). (FR-008, SC-002.)

**Checkpoint**: Both P1 user stories are functional. `/dashboard` now
matches the spec's MVP: stat grid + working toggle + permanent CTA.

---

## Phase 5: User Story 3 — Quick actions and supporting context (Priority: P2)

**Goal**: Render the lower half of the dashboard — four quick-action buttons
(stacked single-column), a "Techs on shift" tile listing the roster, and a
"Recent transactions" feed showing exactly 7 rows newest-first.

**Independent Test**: Open `/dashboard`. Verify the lower-left column shows
the four quick actions + the techs-on-shift wrap-flex tile; the lower-right
column shows the feed with 7 rows; at least one row uses the `+N more`
shortener; clicking each quick action navigates to its target route.

### Implementation for User Story 3

- [X] T021 [P] [US3] Create `components/lacquer/tech-avatar.tsx` (server component) matching the contract: `tech`, `size?` (default 36), `ring?` (default false). Port the visual from `design-system/prototypes/transaction/TechPicker.jsx:12-31` — circular `<Avatar>` (from `components/ui/avatar.tsx`) with `background` and `color` derived from `tech.tone` via OKLCH (`oklch(0.86 0.045 ${tone})` / `oklch(0.32 0.06 ${tone})`). Initials are computed from `tech.full` (first two whitespace-separated tokens). When `ring` is true, add the inset-shadow ring per the prototype. (Read-only for v1; the `ring` flag exists for future re-use.)
- [X] T022 [P] [US3] Create `components/lacquer/tech-stack.tsx` (server component) matching the contract: `ids`, `size?` (default 20), `max?` (default 3). Overlap stack rendering at most `max` `<TechAvatar />` children, each pulled from `STAFF` by id. When `ids.length > max`, render a final `.tx-tech-overflow` chip showing `+N`. Mirrors `TechPicker.jsx:34-60`.
- [X] T023 [P] [US3] Create `components/lacquer/secondary-actions.tsx` (server component) matching the contract: `actions: QuickAction[]`, `cols?: 1 | 2`. Renders a CSS grid (`gridTemplateColumns: repeat(${cols}, 1fr)`) of `<Link>` elements styled `.tx-secondary-action`. Each row shows the Lucide icon (size 18, color `var(--muted-foreground)`), the label `.lbl`, and the hint `.h`. The four `QuickAction` rows come from `buildDashboardData()` (already populated in T008) — don't hardcode them here.
- [X] T024 [P] [US3] Create `components/lacquer/techs-on-shift-tile.tsx` (server component) matching the contract: `staff: Technician[]`. Wrap-flex container (gap 4, padding 12, `background: var(--card)`, `border: 1px solid var(--border)`, `borderRadius: 10`). Each cell: small flex column with `<TechAvatar tech={t} size={32} />` + first-name caption at 10 px / weight 500. The container's `flexWrap: "wrap"` is non-negotiable — rosters > 8 must overflow to a new row (Edge case "Long tech rosters").
- [X] T025 [P] [US3] Create `components/lacquer/recent-transactions-feed.tsx` (server component) matching the contract: `rows: TransactionRow[]`. Wraps `components/ui/card.tsx` with `.tx-feed` chrome. Header (`.tx-feed-h`): the title `"Recent transactions"` + a `"View all"` `<button>` styled as a link (no-op anchor for v1 — Lucide-free, just a `tx-link` class on a button). List (`.tx-feed-list`): one `.tx-feed-row` per `TransactionRow` showing `.time` (uses `.tnum`), `.client` (CSS truncation), `.svc` (already-formatted serviceLabel), `<TechStack ids={row.techIds} size={20} />`, a `<span className={`tx-meth-pill ${row.method}`}>{row.method}</span>` pill, and `.amt.tnum` showing `formatCurrency(row.total)`. (Depends on T022.)
- [X] T026 [US3] Edit `app/(studio)/dashboard/page.tsx` to add the lower split — a CSS grid with `gridTemplateColumns: "1fr 1.6fr"`, gap 16, taking the remaining vertical space. Left column: a flex-column containing a `.muted` "Quick actions" eyebrow + `<SecondaryActions actions={data.quickActions} cols={1} />`, then a `.muted` "Techs on shift" eyebrow + `<TechsOnShiftTile staff={data.staff} />`. Right column: `<RecentTransactionsFeed rows={data.recent} />`. (Depends on T023, T024, T025.)
- [X] T027 [US3] Extend `tests/e2e/dashboard.spec.ts` with a US3 test block: assert exactly 4 `.tx-secondary-action` buttons with the labels and hints from the spec; click each and assert URL matches its `href` (placeholder routes 404 — that is fine, the navigation must fire); assert the techs-on-shift tile contains exactly 8 `<TechAvatar />` siblings (matching `STAFF.length`); assert `.tx-feed-row` count is exactly 7; assert `.tx-feed-row` order — first row is `tx-0130` (4:14 PM Walk-in), last visible row is `tx-0124`; assert every visible `.svc` cell is non-empty. **FR-012 (+N more shortener)** is fully covered by the `formatServiceLabel` unit test in T007 — canonical `TX_HISTORY` rows all have ≤2 items so the +N more branch is unreachable from the rendered DOM. Do NOT add a synthetic ≥3-item transaction here to manufacture coverage; that would drift `mock-data.ts` from the prototype. (FR-009, FR-010, FR-011.)

**Checkpoint**: All three user stories functional. The dashboard renders
the full Variation-B layout end-to-end. Every numbered FR in `spec.md` is
satisfied; every interactive element is keyboard-reachable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Responsive reflow, design-system audit, gate sweep, and a
manual walkthrough against `quickstart.md`. No new code paths.

- [X] T028 [P] Add a `@media (max-width: 720px)` block to `styles/dashboard.css` that: (a) collapses the stat grid to `gridTemplateColumns: repeat(2, 1fr)`, (b) collapses the lower split to `gridTemplateColumns: 1fr`, (c) shrinks `.tx-landing-top` to a single stacked column, (d) reduces `.tx-stat-card .val` font-size to `22px`. Verify in DevTools at 360 px, 720 px (boundary), 1024 px (tablet), and 1440 px that no horizontal scrollbar appears and no tile content overlaps. (FR-019, SC-006.)
- [X] T029 [P] Run the design-system auditor against `/dashboard`: invoke the `speckit-design-auditor` agent with target route `app/(studio)/dashboard/page.tsx` and the prototype reference `design-system/prototypes/transaction/Landing.jsx` lines 282–372. Address every reported violation. (SC-004, Constitution Principle I.)
- [X] T030 Run all quality gates locally: `npm run typecheck && npm run lint && npm test && npm run test:e2e`. All four MUST pass. Resolve any drift before requesting review. (Constitution Principle IV, Development Workflow & Quality Gates.)
- [ ] T031 Walk through `specs/002-dashboard-page/quickstart.md` end-to-end manually in a real browser at 1024 × 768 viewport. Tick every checkbox. Note in the PR description any "Known placeholder" deviations (auth stub, `/checkout` stub, period multipliers) so the reviewer doesn't flag them as bugs.

**Final checkpoint**: PR-ready. All FRs covered, all SCs measurable, all
five constitution principles upheld (Principle III is N/A — no money path).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No internal dependencies. T001, T002, T003 can run
  fully in parallel — they touch different files (`styles/tokens.css`,
  `styles/dashboard.css`, `components/ui/*`).
- **Phase 2 (Foundational)**: Depends on Phase 1 (T002 + T003 outputs are
  referenced by foundational and story tasks). Inside Phase 2, T005 / T006
  are parallel; T007 depends on T006; T008 depends on T005 + T006; T009
  depends on T008; T010 / T011 are independent of the `lib/dashboard/*`
  chain and can run in parallel with it. T004 is independent.
- **Phase 3 (US1)**: Depends on Phase 2 (page calls `requireStudioSession`,
  `buildDashboardData`, imports `styles/dashboard.css` via the layout, uses
  `components/ui/card`).
- **Phase 4 (US2)**: Depends on Phase 3's `app/(studio)/dashboard/page.tsx`
  existing (T019 edits it) and on `components/ui/button` (added in T003).
  Otherwise independent of Phase 3 internals.
- **Phase 5 (US3)**: Depends on Phase 3's `app/(studio)/dashboard/page.tsx`
  (T026 edits it). Some components depend on others within Phase 5: T022
  depends on T021; T025 depends on T022.
- **Phase 6 (Polish)**: Depends on Phases 3–5 being complete.

### Within Each User Story

- Components are written before the page edit that mounts them (T012-T015
  before T016; T018 before T019; T021-T025 before T026).
- The Playwright spec is extended once per phase (T017 → T020 → T027) so
  each phase ships with its own assertions. These three tasks touch the
  same file (`tests/e2e/dashboard.spec.ts`) and are therefore **sequential**,
  never parallel.

### Parallel Opportunities

- Phase 1: T001 / T002 / T003 all `[P]`.
- Phase 2: T005 / T006 / T010 / T011 (different files) can run in parallel.
  T007 needs T006; T008 needs T005 + T006; T009 needs T008.
- Phase 3: T012 / T013 / T014 are `[P]` (different files). T015 joins them;
  T016 then mounts everything; T017 extends the e2e spec last.
- Phase 4: T018 is `[P]`; T019 is the integration; T020 extends e2e.
- Phase 5: T021 / T023 / T024 are `[P]`; T022 needs T021; T025 needs T022;
  T026 mounts everything; T027 extends e2e.
- Phase 6: T028 / T029 are `[P]`; T030 / T031 are sequential.

---

## Parallel Example: User Story 1

```bash
# Once Phase 2 is green, launch the four parallel-eligible US1 component tasks together:
Task: "[US1] Create components/lacquer/stat-card.tsx"            # T012
Task: "[US1] Create components/lacquer/payment-mix-card.tsx"     # T013
Task: "[US1] Create components/lacquer/period-toggle.tsx"        # T014

# Then sequentially:
Task: "[US1] Create components/lacquer/period-summary.client.tsx" # T015 (depends on T012-T014)
Task: "[US1] Create app/(studio)/dashboard/page.tsx"              # T016
Task: "[US1] Create tests/e2e/dashboard.spec.ts"                  # T017
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) — vendor tokens, port CSS, install shadcn primitives.
2. Phase 2 (Foundational) — auth stub, mock data, helpers, layout, redirect.
3. Phase 3 (US1) — header + 5 stat tiles + working period toggle.
4. **STOP and VALIDATE**: run `quickstart.md` US1 section + Playwright US1
   block. The dashboard renders the spec's "report" half but no CTA yet.
5. Decide whether to demo or push through to US2 immediately.

### Incremental Delivery (recommended)

1. Phase 1 + Phase 2 → foundation ready.
2. Phase 3 (US1) → ship MVP-1: at-a-glance dashboard.
3. Phase 4 (US2) → ship MVP-2: dashboard + CTA = the spec's two P1 stories.
4. Phase 5 (US3) → ship the full V-B layout.
5. Phase 6 (Polish) → ship to `main`.

Each phase remains independently demoable; the page degrades gracefully as
sections are added (empty lower half between Phases 3 and 5 is intentional
and visually quiet).

### Parallel Team Strategy

With two developers after Phase 2 lands:

- Dev A: Phase 3 (US1) — owns `period-toggle.tsx`, `period-summary.client.tsx`,
  `stat-card.tsx`, `payment-mix-card.tsx`, and the initial e2e spec.
- Dev B: Phase 4 (US2) — owns `new-transaction-cta.tsx` and the US2 e2e
  block, ready to merge as soon as A's page.tsx lands.
- Both: split Phase 5 component tasks (T021 / T023 / T024 are independent
  files); merge on T026 once all five components exist.

---

## Notes

- `[P]` tasks touch different files. Tasks that edit the same file
  (`app/(studio)/dashboard/page.tsx` is edited in T016, T019, and T026;
  `tests/e2e/dashboard.spec.ts` is edited in T017, T020, and T027) are
  intentionally sequential.
- `[Story]` labels appear on Phase 3–5 tasks only. Phases 1, 2, and 6 carry
  no story label.
- Every component file MUST end up using only `var(--*)` from
  `styles/tokens.css` for color / shadow / radius and only `lucide-react`
  icons at 1.5 px stroke. The design-system auditor in T029 is the final
  arbiter (SC-004).
- Tests live in `tests/unit/dashboard/*` and `tests/e2e/dashboard.spec.ts`.
  CI runs all four gates on every PR (`typecheck`, `lint`, `vitest`,
  `playwright`) — see `.github/workflows/ci.yml` from feature 001.
- Commit after each task or each logical group; the `after_implement` hook
  in `.specify/extensions.yml` will commit at the end of `/speckit-implement`,
  but small per-task commits keep review legible.
- Stop at any checkpoint to validate the most recent user story before
  starting the next.
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that
  break independent testing.
