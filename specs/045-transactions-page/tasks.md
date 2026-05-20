---

description: "Task list for Transactions Page"
---

# Tasks: Transactions Page

**Input**: Design documents from `specs/045-transactions-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The plan commits to Vitest unit tests for every pure
module (written test-first) and one Playwright e2e spec — see plan.md §
Constitution Check, Principle IV.

**Organization**: Tasks are grouped by user story. US1 is the MVP; US2 and US3
build on it without breaking it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 — setup, foundational, and polish tasks carry no story label
- File paths are repo-root-relative (worktree `.claude/worktrees/045-transactions-page`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring the design source into the repo and create the page stylesheet

- [X] T001 Copy the Lacquer transaction prototype handoff into `design-system/prototypes/transaction/` (FR-020) — copy `Transactions.html`, `TransactionsPage.jsx`, `transactions-page.css` and overwrite `StudioShell.jsx` + `data.jsx` with the handoff versions. Source: the extracted handoff at `/tmp/design-handoff/lacquer-salon-design-system/project/prototypes/transaction/`; if absent, re-fetch and extract the handoff archive from the URL in `specs/045-transactions-page/spec.md` (Input).
- [X] T002 Create `styles/transactions.css` by adapting `design-system/prototypes/transaction/transactions-page.css` — drop the `@import` of `colors_and_type.css` and `user-management.css` and the `body { overflow: hidden }` override; keep only the `.tp-*` rules; resolve every color/spacing/radius/shadow to a `styles/tokens.css` token (no raw hex or `oklch` literals — the prototype's raw method/delta colors are handled by `<MethodPill>` and `--success`/`--destructive` in later tasks). Depends on T001.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The complete `lib/transactions/` data + logic layer plus the
`lib/time` extension. Every UI story imports the read model and helpers built
here.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first — must FAIL before the matching implementation)

- [X] T003 [P] Extend `tests/unit/time/period-windows.test.ts` with cases for the new offset-aware windows `dayWindowAt` / `weekWindowAt` / `monthWindowAt` — offset 0/-1/-2, Monday-start weeks, calendar-month boundaries, DST edges, full-period `end` (not "ending at now").
- [X] T004 [P] Create `tests/unit/transactions/window.test.ts` — `parsePeriodParams` sanitisation (invalid/missing period → `week`, positive/non-integer offset → `0`, clamp `> 0` → `0`) and `resolveWindow` (bounds, `isCurrent`, `label`, `rangeLabel`).
- [X] T005 [P] Create `tests/unit/transactions/format.test.ts` — `formatTxId` (`#` + last 6 uppercase hex), `formatDayLabel` (`May 12, 2026`), `formatRelativeDay` (`Today` / `Yesterday` / `3 days ago` / weekday).
- [X] T006 [P] Create `tests/unit/transactions/aggregate.test.ts` — `deriveMethod` (single method, `split` for ≥2 distinct), `projectTransactions` (bucketing, tech-id dedupe, totals incl. tip), `computeKpis` (count/revenue/services/tips/avgs, empty set → zeros), `groupByDay` (day buckets, newest-first ordering).

### Implementation

- [X] T007 [P] Extend `lib/time/period-windows.ts` with offset-aware full-period helpers `dayWindowAt(tz, now, offset)`, `weekWindowAt(tz, now, offset)`, `monthWindowAt(tz, now, offset)` returning `[Date, Date)` for the period `offset` steps back; reuse the existing private `localStartOf*Utc` primitives; leave `todayWindow`/`weekWindow`/`monthWindow` untouched. Makes T003 pass.
- [X] T008 [P] Create `lib/transactions/format.ts` — pure `formatTxId(uuid)`, `formatDayLabel(dayKey)`, `formatRelativeDay(dayKey, todayKey)`. Makes T005 pass.
- [X] T009 [P] Create `lib/transactions/aggregate.ts` — read-model types (`TransactionLineItem`, `TransactionPayment`, `TransactionDetail`, `TransactionKpis`, `DayGroup`; re-export `PaymentMethod` from `lib/dashboard/aggregate`) and pure functions `deriveMethod`, `projectTransactions`, `computeKpis`, `groupByDay` per data-model.md § 2. Makes T006 pass.
- [X] T010 Create `lib/transactions/window.ts` — `PeriodGranularity`, `PeriodWindow`, `parsePeriodParams`, `resolveWindow` (dispatches to the T007 helpers, builds labels, clamps `offset ≤ 0`) per contracts/transactions-read-model.md § C3. Makes T004 pass. Depends on T007.
- [X] T011 Create `lib/transactions/queries.ts` — server-only `queryTransactions(supabase, tz, window)`, `queryPeriodCount(supabase, window)`, and the `loadTransactionsPage(supabase, window)` orchestrator per contract C2; reads `tickets`/`ticket_items`/`payments`/`staff`/`services`, calls `projectTransactions` from `aggregate.ts`. Depends on T009, T010.

**Checkpoint**: `npx vitest run tests/unit/transactions tests/unit/time/period-windows.test.ts` green — the logic + data layer is complete.

---

## Phase 3: User Story 1 - Browse the full transaction history by period (Priority: P1) 🎯 MVP

**Goal**: A dedicated `/transactions` page, reachable from an owner/manager-only
sidebar item and the dashboard's "View all", that lists every completed sale
grouped by day with per-day totals and a KPI strip, filterable by period
(Today / This week / This month) with backward/forward stepping.

**Independent Test**: Sign in as owner → the sidebar shows "Transactions" and
the page lists seeded paid tickets grouped by day with KPIs; toggle period and
step ‹ › → the list and range label update; sign in as technician → no nav item
and `/transactions` redirects to `/dashboard`; the dashboard "View all" control
navigates to `/transactions`.

### Tests for User Story 1

- [X] T012 [P] [US1] Create `tests/e2e/transactions.spec.ts` (Playwright, `main` project) with the self-seeding harness — `beforeAll` inserts a handful of historical paid tickets (own UUIDs, salon-local instants via `tests/e2e/_la-time.ts`, admin client) across several days; `afterAll` deletes them. Cover US1: owner sees `[data-nav-id="transactions"]` and the page lists the seeded rows grouped by day with KPIs; period toggle + ‹ › stepping change the range; technician is redirected from `/transactions`; dashboard "View all" navigates to `/transactions`. Assert on seeded `data-tx-id`s and structure — never global aggregate counts (research R8).
- [X] T015 [P] [US1] Update `tests/e2e/sidebar.spec.ts` — add `"transactions"` to `EXPECTED_NAV_IDS` between `"checkout"` and `"walkin"` (the spec runs as owner).

### Implementation for User Story 1

- [X] T013 [US1] In `components/lacquer/sidebar/nav-items.ts` add an optional `roles?: readonly StudioRole[]` field to the `NavItem` type (JSDoc: absent ⇒ visible to all) and add the item `{ id: "transactions", label: "Transactions", icon: Receipt, href: "/transactions", roles: ["owner", "manager"] }` to the Workspace group between `checkout` and `walkin`; import `Receipt` from `lucide-react`.
- [X] T014 [US1] Thread the viewer role into the sidebar: in `components/lacquer/sidebar/studio-sidebar.tsx` pass `staff.role` to `SidebarShell`; in `components/lacquer/sidebar/sidebar-shell.client.tsx` accept a `role: string` prop and skip rendering any item where `item.roles` is set and does not include `role`. Depends on T013.
- [X] T016 [P] [US1] In `components/lacquer/recent-transactions-feed.tsx` change the inert `<button className="tx-link">View all</button>` to `<Link href="/transactions" className="tx-link">View all</Link>` (import `Link` from `next/link`); update the file's "View all is intentionally inert" comment.
- [X] T017 [P] [US1] Create `components/lacquer/transactions/kpi-strip.tsx` — the 5 KPI cards (transactions with vs-previous-period delta, gross revenue, services rendered, tips collected, avg ticket) from a `TransactionKpis` + `previousPeriodCount`; delta colored with `--success` / `--destructive`; `.tp-kpis` / `.tp-kpi` classes; Lucide icons; currency via `formatCurrency`.
- [X] T018 [P] [US1] Create `components/lacquer/transactions/transactions-table.tsx` — day-grouped table: per-day header (date, relative label, count / revenue / tips) and rows (time, `displayId`, client, services summary, `<TechStack>`, `<MethodPill>`, subtotal, tip, total) with tabular numerals; accepts `onRowClick` + `selectedId` props (selected-row styling) and renders the period-empty state when there are no transactions. `.tp-table*` / `.tp-day-*` classes.
- [X] T019 [P] [US1] Create `components/lacquer/transactions/period-controls.tsx` — Server Component: the Today / This week / This month toggle and ‹ › arrows rendered as `next/link` `<Link>`s over `?period=&offset=`; the "next" arrow disabled when `window.isCurrent`; shows `window.label` + `window.rangeLabel`. `.tp-period*` / `.tp-range` classes.
- [X] T020 [US1] Create `components/lacquer/transactions/transactions-view.client.tsx` — `"use client"` island root receiving `{ transactions, staff, previousPeriodCount, todayKey }`; for US1 compute KPIs over the full list with `computeKpis` and render `<KpiStrip>` + `<TransactionsTable>` (day groups via `groupByDay`). Depends on T017, T018, T009.
- [X] T021 [US1] Create `app/(studio)/transactions/page.tsx` — `export const dynamic = "force-dynamic"`; `import "@/styles/transactions.css"`; `requireStudioSession()`, then `redirect("/dashboard")` if `role ∉ {owner, manager}`; `parsePeriodParams(await searchParams)` → `resolveWindow` → `loadTransactionsPage`; render the page header (title "Transactions", description, a `<NewTransactionCTA>` / "New transaction" link to `/checkout`), `<PeriodControls>`, and `<TransactionsView>`. Depends on T010, T011, T019, T020.
- [X] T022 [P] [US1] Create `app/(studio)/transactions/loading.tsx` — a skeleton matching the page header + KPI strip + table chrome, shown during period re-fetch.
- [X] T023 [P] [US1] Add entries to `tests/e2e/_affected-map.mjs` mapping `app/(studio)/transactions/**`, `components/lacquer/transactions/**`, `lib/transactions/**`, `components/lacquer/sidebar/**`, and `components/lacquer/recent-transactions-feed.tsx` → `["tests/e2e/transactions.spec.ts"]` (keep the existing dashboard/sidebar mappings).

**Checkpoint**: `/transactions` lists, groups, and KPI-summarises seeded paid tickets; period toggle + stepping work; nav item and route are owner/manager-gated; "View all" navigates. US1 is independently demoable — this is the MVP.

---

## Phase 4: User Story 2 - Inspect a transaction's full receipt (Priority: P2)

**Goal**: Clicking a transaction row opens a right-side receipt drawer with the
full line-item, payment, totals, staff, and activity detail.

**Independent Test**: With the list showing, click a row → a drawer opens with
line items (name, category, tech, price), subtotal/tip/total, the payment
method and amount, the cashier, and a "sale completed" activity line; it closes
via the ✕, the backdrop, and the Escape key.

### Tests for User Story 2

- [X] T024 [US2] Add US2 scenarios to `tests/e2e/transactions.spec.ts` — clicking a known seeded row opens the receipt drawer; the drawer shows that ticket's line items, subtotal/tip/total, payment block, cashier, and activity line; the drawer closes via the close control, a backdrop click, and the Escape key.

### Implementation for User Story 2

- [X] T025 [P] [US2] Create `components/lacquer/transactions/receipt-drawer.tsx` — the right-side drawer from a `TransactionDetail`: header (client, `displayId`, date + time), meta (techs via `<TechStack>`/`<TechAvatar>`, cashier), itemised line items (name, `category`, assigned tech, line price), subtotal/tip/total, payment block (per `TransactionPayment`), and the activity line ("Sale completed by {cashier} · {date} {time}"); backdrop + ✕ + `Escape` close, body scroll-lock. `.tp-drawer*` / `.tp-d-*` classes. The Print/Email/Refund footer actions from the prototype are out of scope — omit them.
- [X] T026 [US2] Wire selection into `components/lacquer/transactions/transactions-view.client.tsx` — add `selectedId` state, pass an `onRowClick` setter and `selectedId` to `<TransactionsTable>`, and render `<ReceiptDrawer>` for the selected `TransactionDetail`. Depends on T025.

**Checkpoint**: US1 still works; any row opens a complete, correct receipt drawer that closes three ways.

---

## Phase 5: User Story 3 - Narrow the list with search and filters (Priority: P3)

**Goal**: Search and method/tech filters that narrow the list and recompute the
KPI strip live.

**Independent Test**: With a populated period, type a service name or
transaction ID → list and KPIs narrow; toggle a method chip (counts shown) →
only that method remains; pick techs → only their transactions remain, each as
a removable pill; "Clear filters" resets; a no-match combination shows the
filtered-empty state with a "Clear filters" action.

### Tests for User Story 3

- [X] T027 [US3] Add US3 scenarios to `tests/e2e/transactions.spec.ts` — search by service name / `displayId` narrows the list and the KPI strip; a method chip filters and shows a live count; the tech multi-select filters and renders removable pills; "Clear filters" restores the full period; a no-match filter combination shows the filtered-empty state with a working "Clear filters".

### Implementation for User Story 3

- [X] T028 [P] [US3] Create `components/lacquer/transactions/filter-bar.tsx` — the search input, payment-method chips with live per-method counts, the tech multi-select popover, the active-filter pills, and "Clear filters"; presentational, all state via props. `.tp-filters` / `.tp-chipgroup` / `.tp-pop*` / `.tp-active-*` classes.
- [X] T029 [US3] Add filter state to `components/lacquer/transactions/transactions-view.client.tsx` — `search` / `method` / `techIds` state; apply the filter predicate from contract C4; recompute `computeKpis` and `groupByDay` from the filtered set; render `<FilterBar>` above the KPI strip. Depends on T028.
- [X] T030 [US3] Add the filtered-empty state to `components/lacquer/transactions/transactions-table.tsx` — distinct from the period-empty state (T018), shown when filters are active but match nothing, with a "Clear filters" action wired to a reset callback. Depends on T029.

**Checkpoint**: All three stories work; search/filters narrow the list and KPIs and clear cleanly, without breaking period browsing or the drawer.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Design-system fidelity and the final quality gate

- [X] T031 [P] Design-system audit — compare `/transactions` side-by-side with `design-system/prototypes/transaction/Transactions.html`; confirm every value in `styles/transactions.css` and the `components/lacquer/transactions/*` files resolves to a `styles/tokens.css` token (no raw hex / `oklch`), icons are Lucide 1.5px, and copy is sentence case (Constitution Principle I).
- [X] T032 [P] Run `specs/045-transactions-page/quickstart.md` validation — walk every "What to verify" item against a running dev server, including the empty-state and role-gate paths. (Verified via the full `transactions.spec.ts` e2e suite — 15 scenarios covering period filter + stepping, day grouping, KPI strip, receipt drawer, search/method/tech filters, both empty states, and the role gate — plus the three design-system audits.)
- [X] T033 Run the full quality gate set in order: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. (All green: format/lint/typecheck clean, 809 unit tests pass, 240 e2e tests pass.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T002 depends on T001.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational. US1 is the MVP; US2 and US3 each build on US1's UI but are independently testable increments.
- **Polish (Phase 6)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Delivers the standalone page.
- **US2 (P2)**: Depends on Foundational; touches US1's `transactions-view.client.tsx` and `transactions-table.tsx` (the table already exposes `onRowClick`/`selectedId` from T018). Independently testable.
- **US3 (P3)**: Depends on Foundational; touches US1's `transactions-view.client.tsx` and `transactions-table.tsx`. Independently testable.

### Within Each Phase

- Phase 2: T003–T006 (tests) before T007–T011 (impl). T007→T010; T009+T010→T011.
- Phase 3: T013→T014; T017+T018→T020; T019+T020→T021.
- Phase 4: T025→T026.
- Phase 5: T028→T029→T030.

### Parallel Opportunities

- **Phase 2 tests**: T003, T004, T005, T006 together.
- **Phase 2 impl**: T007, T008, T009 together (T010, T011 follow).
- **US1**: T012, T015, T016, T017, T018, T019, T022, T023 are all different files — run in parallel; T013→T014 and T020→T021 are the only ordered chains.
- **US2**: T024 and T025 together.
- **US3**: T027 and T028 together.
- **Polish**: T031 and T032 together (T033 last).

---

## Parallel Example: User Story 1

```bash
# After Foundational (Phase 2) completes, launch the independent US1 tasks:
Task: "T012 Create tests/e2e/transactions.spec.ts with the self-seeding harness + US1 scenarios"
Task: "T015 Add 'transactions' to EXPECTED_NAV_IDS in tests/e2e/sidebar.spec.ts"
Task: "T016 Wire dashboard 'View all' to /transactions in recent-transactions-feed.tsx"
Task: "T017 Create components/lacquer/transactions/kpi-strip.tsx"
Task: "T018 Create components/lacquer/transactions/transactions-table.tsx"
Task: "T019 Create components/lacquer/transactions/period-controls.tsx"
Task: "T022 Create app/(studio)/transactions/loading.tsx"
Task: "T023 Add _affected-map.mjs entries for the transactions paths"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001–T002).
2. Phase 2: Foundational (T003–T011) — **blocks everything**.
3. Phase 3: User Story 1 (T012–T023).
4. **STOP and VALIDATE**: run the US1 independent test; the page is demoable.

### Incremental Delivery

1. Setup + Foundational → logic layer ready.
2. US1 → the Transactions page works → demo (MVP).
3. US2 → receipt drawer → demo.
4. US3 → search & filters → demo.
5. Polish → design-system audit + full gate set → ready for PR.

---

## Notes

- **No database migration** — the feature reads existing tables only (research R10).
- `[P]` = different files, no dependency on an incomplete task.
- `tests/e2e/transactions.spec.ts` is created in US1 (T012) and appended to in US2 (T024) and US3 (T027) — those three tasks touch the same file and are sequential by phase.
- `components/lacquer/transactions/transactions-view.client.tsx` and `transactions-table.tsx` are extended across US1→US2→US3; each checkpoint must leave them working.
- Constitution Principle I: every UI task must trace its values to `styles/tokens.css` tokens and adapt the prototype, not redraw it.
- Commit after each task or logical group; verify unit tests fail before implementing the matching module.
