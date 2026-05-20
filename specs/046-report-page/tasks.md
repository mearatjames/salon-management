---

description: "Task list for Report Page"
---

# Tasks: Report Page

**Input**: Design documents from `specs/046-report-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The plan commits to Vitest unit tests for every pure module
(written test-first — `splitCardTip` and the deduction math are Constitution
Principle IV "tip-split math") and one Playwright e2e spec — see plan.md §
Constitution Check.

**Organization**: Tasks are grouped by user story in priority order. US1 is the
MVP; US2–US5 build on it without breaking it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 — setup, foundational, and polish tasks carry no story label
- File paths are repo-root-relative (worktree `.claude/worktrees/046-report-page`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the design source is in the repo and create the page stylesheet

- [ ] T001 Confirm the Lacquer Day Report prototype is present in `design-system/prototypes/transaction/` — `Day Report.html`, `DayReport.jsx`, `day-report-page.css` (spec Input / FR-031). They are already vendored; if any is missing, re-export the Lacquer handoff and copy them in. No code change if present.
- [ ] T002 Create `styles/report.css` by adapting `design-system/prototypes/transaction/day-report-page.css` — drop any `@import` of `colors_and_type.css` / sibling prototype CSS and any `body { overflow }` override; keep the `.dr-*` report-body rules and the `.tp-head` / `.tp-period-row` / `.tp-range` page-chrome rules; resolve every color / spacing / radius / shadow / type value to a `styles/tokens.css` token (no raw hex or `oklch` literals — research R15). Depends on T001.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The complete `lib/report/` data + logic layer plus the `lib/time`
extension. Every UI story imports the read model and helpers built here.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first — must FAIL before the matching implementation)

- [ ] T003 [P] Extend `tests/unit/time/period-windows.test.ts` with cases for `semiMonthlyWindowAt` — offset 0/-1/-2; the 1st–15th and 16th–end half-months; stepping across month and year boundaries; a 28-day February; that `end` is the exclusive start of the next half-month.
- [ ] T004 [P] Create `tests/unit/report/window.test.ts` — `parseReportPeriodParams` sanitisation (invalid/missing `period` → `day`, non-integer/positive `offset` → `0`, clamp `> 0` → `0`) and `resolveReportWindow` for `day` / `week` / `semi` (UTC bounds, `isCurrent`, `label`, `rangeLabel` incl. "Today"/"Yesterday" and the semi-monthly range label).
- [ ] T005 [P] Create `tests/unit/report/aggregate.test.ts` — **test-first, Constitution IV**: `effectiveCardFeeCents` (default/custom/exempt, missing service → default); `computeLineDeductions` (per-`qty` card fee only when card-settled and tech not `card_fee_exempt`; supply per `supply_mode` apply/partial/exempt and `supply_except`); `splitCardTip` (largest-remainder — `Σ result === total` exactly, zero-weight and zero-subtotal cases); `projectReport` (per-tech aggregation, **distinct** transaction count, `hasNoDeductions ⇔ totalDeductions===0`, non-service items excluded, removed/inactive performer still included, totals row === Σ tech rows).

### Implementation

- [ ] T006 [P] Add `semiMonthlyWindowAt(tz, now, offset)` to `lib/time/period-windows.ts` — returns `[Date, Date)` for the half-month `offset` steps from the one containing `now` (`[1st,16th)` when `day ≤ 15`, else `[16th, 1st-of-next-month)`); index half-months as `year*24 + month*2 + half` so stepping crosses month boundaries (research R1). Reuse the existing private local-midnight UTC primitives; leave the existing helpers untouched. Makes T003 pass.
- [ ] T007 [P] Create `lib/report/aggregate.ts` — read-model types (`ReportDeductionLine`, `ReportTransaction`, `TechnicianReport`, `ReportTotals`, `ReportReadModel`; re-use `PaymentMethod` + `deriveMethod` from `lib/dashboard/aggregate`) and the pure functions `effectiveCardFeeCents`, `computeLineDeductions`, `splitCardTip`, and `projectReport`, per data-model.md §2–§3 and contract C3. Import `DEFAULT_CARD_FEE_CENTS` from `lib/services/card-fee-default.ts`. No I/O, no `Date.now()`. Makes T005 pass.
- [ ] T008 Create `lib/report/window.ts` — `ReportGranularity` (`day`/`week`/`semi`), `ReportWindow`, `parseReportPeriodParams`, `resolveReportWindow` (dispatches to `dayWindowAt` / `weekWindowAt` / `semiMonthlyWindowAt`, builds labels, clamps `offset ≤ 0`, default granularity `day`) per data-model.md §4 / contract C4. Makes T004 pass. Depends on T006.
- [ ] T009 Create `lib/report/queries.ts` — server-only `loadReportPage(supabase, window)` per contract C2: query `status='paid'` tickets in `[window.start, window.end)`; by `ticket_id` fetch `ticket_items` + succeeded `payments`; resolve `services` (deduction columns) for distinct `ref_id`s and `staff` (identity + exemption columns) for distinct service-item `assigned_staff_id`s **with no `active` filter**; call `projectReport`. Empty ticket set → empty read model, no child queries. Depends on T007, T008.

**Checkpoint**: `npx vitest run tests/unit/report tests/unit/time/period-windows.test.ts` green — the logic + data layer is complete.

---

## Phase 3: User Story 1 - See all-staff earnings and deductions for the day (Priority: P1) 🎯 MVP

**Goal**: A `/report` page, reachable from an owner/manager-only sidebar item,
that on first load shows the current day's All-Staff overview — every technician
with services count, gross, card-fee deduction, supply deduction, commissionable
amount, and card tips, plus a reconciling totals row, a period summary strip,
and the deduction legend.

**Independent Test**: Sign in as owner → the sidebar shows "Report"; the page
lists every seeded technician with the seven overview columns; the totals row
equals the sum of the technician rows; a fully-exempt technician shows the "no
deductions" indicator with commissionable = gross; sign in as a technician →
`/report` redirects to `/dashboard`.

### Tests for User Story 1

- [ ] T010 [P] [US1] Create `tests/e2e/report.spec.ts` (Playwright, `main` project) with a self-seeding harness — `beforeAll` inserts, via the admin client, a fixture with its own UUIDs dated to a fixed **past** day (salon-local instants via `tests/e2e/_la-time.ts`): 2–3 `services` (one `card_fee_mode='default'`, one with `supply_amount_cents`+`supply_type_id`), 2–3 `staff` rows with known exemption config (one non-exempt; one `card_fee_exempt=true`+`supply_mode='exempt'`), and several paid `tickets` with service `ticket_items` + succeeded `payments` (card and cash); `afterAll` deletes them. Cover US1: owner sees `[data-nav-id="report"]`; the page lists the seeded technicians with svcs / gross / card fee / supply / commissionable / card tips; `[data-slot="totals-row"]` equals the sum of the rendered rows; the summary strip and legend render; the exempt technician shows the no-deduction indicator; a technician/front-desk user is redirected from `/report` (reuse the role-gate auth pattern from `transactions.spec.ts`). Assert on seeded ids + reconciliation — never global aggregate counts (research R17).
- [ ] T011 [P] [US1] Update `tests/e2e/sidebar.spec.ts` — replace `"day-report"` with `"report"` in `EXPECTED_NAV_IDS` (keep its position before `"settings"`); update/remove any assertion that the item is a disabled placeholder and the item-count comment if present.

### Implementation for User Story 1

- [ ] T012 [US1] In `components/lacquer/sidebar/nav-items.ts` replace the disabled Operations-group placeholder `{ id: "day-report", … href: null, disabled: true }` with the live item `{ id: "report", label: "Report", icon: FileBarChart, href: "/report", roles: ["owner", "manager"] }` (`FileBarChart` is already imported; `validateNavConfig` keeps passing — non-null href, unique id/href). The sidebar role-filter (from `045`) already hides it for technician/front-desk.
- [ ] T013 [P] [US1] Create `components/lacquer/report/all-staff-overview.tsx` — presentational overview from `{ technicians, totals }`: the `.dr-table` with one row per `TechnicianReport` (avatar via `components/lacquer/tech-avatar.tsx` + name + "Exempt" tag when `hasNoDeductions`, svcs, gross, card fee, supply, commissionable, card tips — em-dash for a zero/exempt deduction cell), the `tfoot` totals row (`data-slot="totals-row"`), and the deduction legend (FR-021–FR-023). Tabular numerals; currency via the shared cents formatter.
- [ ] T014 [P] [US1] Create `components/lacquer/report/report-summary.tsx` — presentational `.dr-summary` strip from `ReportTotals`: Gross Revenue (+ `transactionCount` transactions · `serviceCount` services), Total Deductions (negative, with the `Card $… · Supply $…` split), and Card Tips (FR-022). Server component.
- [ ] T015 [P] [US1] Create `components/lacquer/report/report-staff-list.tsx` — presentational left panel: an "All Staff" button (`technicianCount` techs · `transactionCount` transactions) and one card per `TechnicianReport` (avatar, name, "Exempt" tag, svc count, gross/deduct/net, card tips). Props `{ technicians, totals, selectedTechId?, onSelect? }` — when `onSelect` is absent the cards render non-interactive (US2 wires it).
- [ ] T016 [P] [US1] Create `components/lacquer/report/report-empty-state.tsx` — the `.dr-empty` empty-period state shown when `report.isEmpty` (FR-029).
- [ ] T017 [US1] Create `components/lacquer/report/report-view.client.tsx` — `"use client"` island root receiving `{ report }`; holds `selectedTechId` state (null for US1) and renders the `.dr-body` with `<ReportStaffList>` on the left and `<AllStaffOverview>` on the right. Depends on T013, T015.
- [ ] T018 [US1] Create `app/(studio)/report/page.tsx` — `export const dynamic = "force-dynamic"`; `import "@/styles/report.css"`; `requireStudioSession()`, then `redirect("/dashboard")` if `role ∉ {owner, manager}` (the redirect is the security boundary, contract C1); resolve the window with `resolveReportWindow(tz, "day", 0, salonNow(tz))` (current day — the period control is US4); `loadReportPage` → render the `.tp-head` header (title "Report", the FR-003 description; actions slot empty for now), then `report.isEmpty ? <ReportEmptyState/> : (<ReportSummary/> + <ReportView/>)`. Depends on T009, T014, T016, T017.
- [ ] T019 [P] [US1] Create `app/(studio)/report/loading.tsx` — a skeleton matching the page header + summary strip + body chrome, shown during the period re-fetch.
- [ ] T020 [P] [US1] Add entries to `tests/e2e/_affected-map.mjs` mapping `app/(studio)/report/**`, `components/lacquer/report/**`, `lib/report/**`, and `components/lacquer/sidebar/**` → `["tests/e2e/report.spec.ts"]` (keep existing mappings; the sidebar path may now map to both `sidebar.spec.ts` and `report.spec.ts`).

**Checkpoint**: `/report` shows the current day's all-staff overview with a reconciling totals row, summary strip, and legend; the nav item and route are owner/manager-gated. US1 is independently demoable — this is the MVP.

---

## Phase 4: User Story 2 - Drill into one technician's transactions (Priority: P2)

**Goal**: Selecting a technician from the left list switches the right panel to
that technician's transaction-by-transaction view, with a per-technician totals
row and header summary.

**Independent Test**: With the page open, click a technician in the left list →
the right panel shows only that technician's transactions for the period (time,
client, services, gross, card fee, supply, net, payment method) with a totals
row matching their overview row; an exempt technician's detail omits the
deduction columns; clicking "All Staff" returns to the overview.

### Tests for User Story 2

- [ ] T021 [US2] Add US2 scenarios to `tests/e2e/report.spec.ts` — selecting a seeded technician shows their transaction rows for the period with the per-transaction columns and a totals row matching that technician's overview row; an exempt technician's detail view omits the deduction columns and every net equals its gross; "All Staff" returns to the overview.

### Implementation for User Story 2

- [ ] T022 [P] [US2] Create `components/lacquer/report/tech-detail.tsx` — presentational per-technician view from a `TechnicianReport`: a header summary (gross, deducted, commissionable, card tips) and the `.dr-table` of `ReportTransaction` rows (time, client, services, gross, card fee, supply, net, `<MethodPill>`-style payment badge) plus the per-tech totals row; when `hasNoDeductions` the two deduction columns are omitted and net === gross (FR-024, FR-025). Accepts `expandedTxIds?` / `onToggleTx?` props in its signature (unused until US3).
- [ ] T023 [US2] Wire selection into `components/lacquer/report/report-view.client.tsx` — pass `selectedTechId` + `onSelect` to `<ReportStaffList>`, and render `<TechDetail>` for the selected `TechnicianReport` (else `<AllStaffOverview>`); the "All Staff" button clears the selection. Depends on T022.

**Checkpoint**: US1 still works; selecting a technician shows a correct, reconciling detail view; "All Staff" returns to the overview.

---

## Phase 5: User Story 3 - Expand a transaction to see its deduction breakdown (Priority: P3)

**Goal**: Inside a technician's detail view, a transaction row with deductions
or a card tip expands to itemised deduction lines, a "total deducted" line, and
the card tip with its percentage.

**Independent Test**: In a technician's detail view, click a transaction with
deductions → it expands to one line per deduction (type, service, amount) summing
to the transaction's total deduction, plus a card-tip line with its percentage
when a card tip applies; a transaction with neither is not expandable; clicking
an expanded row collapses it.

### Tests for User Story 3

- [ ] T024 [US3] Add US3 scenarios to `tests/e2e/report.spec.ts` — a transaction row with deductions expands to itemised lines whose amounts sum to its total deduction, plus a card-tip line with its percentage when applicable; a row with no deductions and no card tip carries no `data-expandable` and does not expand; clicking an expanded row collapses it.

### Implementation for User Story 3

- [ ] T025 [US3] Extend `components/lacquer/report/tech-detail.tsx` — render each `ReportTransaction` with `isExpandable` as a clickable row carrying `data-expandable`; on expand show the `ReportDeductionLine` items (type, service name, amount), a "Total deducted" line, and — when `cardTipCents > 0` — a card-tip line with `tipPct` (FR-026); a non-expandable row is inert.
- [ ] T026 [US3] Add `expandedTxIds` state + a toggle to `components/lacquer/report/report-view.client.tsx` and pass it through `<TechDetail>` as `expandedTxIds` / `onToggleTx`. Depends on T025.

**Checkpoint**: All three view stories work; transaction rows expand/collapse and itemise every deducted dollar, without breaking the overview or detail views.

---

## Phase 6: User Story 4 - Change the reporting period (Priority: P4)

**Goal**: A Day / Week / Semi-monthly period control with backward/forward
stepping; the report and all totals recalculate to the selected range, always
shown as a readable label.

**Independent Test**: With the page open, switch between Day, Week, and
Semi-monthly and step ‹ › through periods → the report contents and the range
label update consistently for each selection; a period with no transactions
shows the empty state; stepping forward past the current period is not possible.

### Tests for User Story 4

- [ ] T027 [US4] Add US4 scenarios to `tests/e2e/report.spec.ts` — switching to Week and Semi-monthly and stepping ‹ › changes the range label and the rendered report; navigating to a period the fixture left empty shows `[data-slot="empty-state"]`; the "next" arrow is disabled when the window `isCurrent`.

### Implementation for User Story 4

- [ ] T028 [P] [US4] Create `components/lacquer/report/report-period-controls.tsx` — Server Component: the Day / Week / Semi-monthly toggle and ‹ › arrows rendered as `next/link` `<Link>`s over `?period=&offset=` on `/report`; switching granularity resets `offset` to `0`; the "next" arrow is disabled when `window.isCurrent`; shows `window.label` + `window.rangeLabel`. Reuses the `.tp-period*` / `.tp-range` chrome (contract C6).
- [ ] T029 [US4] Wire the period control into `app/(studio)/report/page.tsx` — replace the hardcoded day window with `parseReportPeriodParams(await searchParams)` → `resolveReportWindow`, and render `<ReportPeriodControls window={window}/>` below the header. Depends on T028.

**Checkpoint**: US1–US3 still work; the period control switches granularity and steps through periods, recalculating the report and labels; empty periods and the forward-stepping clamp behave correctly.

---

## Phase 7: User Story 5 - Print and export the report (Priority: P5)

**Goal**: A Print action that produces a clean printout with no application
chrome, and an Export action that downloads the per-technician summary as CSV.

**Independent Test**: Use Print → the printed output excludes the sidebar, top
bar, period controls, and action buttons. Use Export → a CSV downloads with one
row per technician plus a totals row, its values matching the on-screen overview.

### Tests for User Story 5

- [ ] T030 [US5] Add US5 scenarios to `tests/e2e/report.spec.ts` — the header exposes Print and Export controls (`data-slot="report-actions"`); clicking Export triggers a CSV download whose rows/values match the rendered overview (assert via the download event); the print stylesheet hides the sidebar / top bar / controls (assert the `@media print` rules or the print-hidden markers).

### Implementation for User Story 5

- [ ] T031 [P] [US5] Create `tests/unit/report/csv.test.ts` — **test-first**: `buildReportCsv` header row, one quoted row per `TechnicianReport` (Exempt Yes/No, decimal-dollar money columns), the trailing `TOTAL` row, and value-for-value agreement with `ReportTotals` (contract C5).
- [ ] T032 [P] [US5] Create `lib/report/csv.ts` — pure `buildReportCsv(report, window)` returning the CSV string per contract C5. Makes T031 pass.
- [ ] T033 [US5] Create `components/lacquer/report/report-actions.client.tsx` — `"use client"` Print + Export CSV buttons (`data-slot="report-actions"`): Print calls `window.print()`; Export builds the CSV via `buildReportCsv` and downloads it as `Report-<rangeLabel>.csv` through a `data:text/csv` anchor. Receives `{ report, window }`. Depends on T032.
- [ ] T034 [US5] Render `<ReportActions report={report} window={window}/>` in the `.tp-head` actions slot of `app/(studio)/report/page.tsx`. Depends on T033.
- [ ] T035 [P] [US5] Add an `@media print` block to `styles/report.css` — hide the studio sidebar, top bar, `.tp-period-row`, and `.dr-*`/`.tp-*` action buttons so the printout is the report content only (FR-027, research R13).

**Checkpoint**: All five stories work; Print yields a chrome-free printout of the current view and Export downloads a CSV matching the overview.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Design-system fidelity and the final quality gate

- [ ] T036 [P] Design-system audit — compare `/report` (overview and a technician's detail) side-by-side with `design-system/prototypes/transaction/Day Report.html`; confirm every value in `styles/report.css` and the `components/lacquer/report/*` files resolves to a `styles/tokens.css` token (no raw hex / `oklch`), icons are Lucide 1.5px sized 16/20/24, numerals are tabular, and copy is sentence case (Constitution Principle I, FR-031).
- [ ] T037 [P] Run `specs/046-report-page/quickstart.md` validation — walk every "Verify" and "Manual-test focus" item against a running dev server, including the exempt-tech, multi-tech tip-split, cash-vs-card, empty-period, and role-gate paths.
- [ ] T038 Run the full quality gate set in order: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T002 depends on T001.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–7)**: All depend on Foundational. US1 is the MVP; US2–US5 each build on US1's UI but are independently testable increments.
- **Polish (Phase 8)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Delivers the standalone page (current-day overview).
- **US2 (P2)**: Depends on Foundational; touches US1's `report-view.client.tsx` and consumes `report-staff-list.tsx`'s already-exposed `onSelect`/`selectedTechId` props. Independently testable.
- **US3 (P3)**: Depends on US2 (extends `tech-detail.tsx` and `report-view.client.tsx`). Independently testable.
- **US4 (P4)**: Depends on Foundational; touches US1's `page.tsx`. Independently testable.
- **US5 (P5)**: Depends on US1 (`page.tsx` header) + Foundational. Independently testable.

### Within Each Phase

- Phase 2: T003–T005 (tests) before T006–T009 (impl). T006→T008; T007+T008→T009.
- Phase 3: T013+T015→T017; T009+T014+T016+T017→T018.
- Phase 4: T022→T023.
- Phase 5: T025→T026.
- Phase 6: T028→T029.
- Phase 7: T031→T032→T033→T034.

### Parallel Opportunities

- **Phase 2 tests**: T003, T004, T005 together.
- **Phase 2 impl**: T006, T007 together (T008, T009 follow).
- **US1**: T010, T011, T013, T014, T015, T016, T019, T020 are all different files — run in parallel; T012 is standalone; T017→T018 is the only ordered chain.
- **US5**: T031 and T035 together; T032 follows T031.
- **Polish**: T036 and T037 together (T038 last).

---

## Parallel Example: User Story 1

```bash
# After Foundational (Phase 2) completes, launch the independent US1 tasks:
Task: "T010 Create tests/e2e/report.spec.ts with the self-seeding harness + US1 scenarios"
Task: "T011 Swap day-report → report in EXPECTED_NAV_IDS in tests/e2e/sidebar.spec.ts"
Task: "T013 Create components/lacquer/report/all-staff-overview.tsx"
Task: "T014 Create components/lacquer/report/report-summary.tsx"
Task: "T015 Create components/lacquer/report/report-staff-list.tsx"
Task: "T016 Create components/lacquer/report/report-empty-state.tsx"
Task: "T019 Create app/(studio)/report/loading.tsx"
Task: "T020 Add _affected-map.mjs entries for the report paths"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001–T002).
2. Phase 2: Foundational (T003–T009) — **blocks everything**.
3. Phase 3: User Story 1 (T010–T020).
4. **STOP and VALIDATE**: run the US1 independent test; the page is demoable.

### Incremental Delivery

1. Setup + Foundational → logic layer ready.
2. US1 → the all-staff overview works → demo (MVP).
3. US2 → per-technician drill-down → demo.
4. US3 → transaction deduction breakdown → demo.
5. US4 → Day/Week/Semi-monthly period control → demo.
6. US5 → Print & CSV export → demo.
7. Polish → design-system audit + full gate set → ready for PR.

---

## Notes

- **No database migration** — the feature reads existing tables only; every
  deduction/exemption column already exists (`0016`/`0017`/`0018`). Research R2.
- `[P]` = different files, no dependency on an incomplete task.
- `tests/e2e/report.spec.ts` is created in US1 (T010) and appended to in US2
  (T021), US3 (T024), US4 (T027), and US5 (T030) — those tasks touch the same
  file and are sequential by phase.
- `app/(studio)/report/page.tsx` is created in US1 (T018) and modified in US4
  (T029, period wiring) and US5 (T034, actions); `report-view.client.tsx` is
  created in US1 (T017) and extended in US2 (T023) and US3 (T026); `tech-detail.tsx`
  is created in US2 (T022) and extended in US3 (T025); `styles/report.css` is
  created in T002 and extended in US5 (T035). Each checkpoint must leave them
  working.
- Constitution Principle IV: T005 and T031 are **test-first** — the deduction +
  tip-split + CSV tests must be written and seen to FAIL before T007 / T032.
- Constitution Principle I: every UI task traces its values to `styles/tokens.css`
  tokens and adapts the prototype, never redraws it.
- Commit after each task or logical group.
</content>
