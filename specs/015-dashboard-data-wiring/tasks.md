---

description: "Task list for Dashboard — Real Supabase Data Wiring"
---

# Tasks: Dashboard — Real Supabase Data Wiring

**Input**: Design documents from `/specs/015-dashboard-data-wiring/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/queries.md](./contracts/queries.md), [contracts/period-windows.md](./contracts/period-windows.md), [quickstart.md](./quickstart.md).

**Tests**: REQUIRED. Constitution Principle IV (Test-First for Critical Paths) covers the read-side money correctness (Revenue / Tips / Services-count / Payment-mix are what owners *trust the dashboard for*) plus the timezone-window math (DST, Monday-week rollover, month boundary — bugs that only surface at midnight). This task list sequences red-baseline tests before the implementations that satisfy them in every phase. `test:e2e` invocations use the project default (parallel workers, scoped via `-g "USn"` at intermediate gates per `CLAUDE.md`).

**Organization**: Tasks are grouped by user story so each story can ship independently. MVP scope is Phase 1 + Phase 2 + Phase 3 (US1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories — [US1], [US2], [US3]
- Setup, Foundational, and Polish tasks have no story label.

## Path Conventions

Repo root: this is the worktree at `/Users/mearathou/Dev/salon-management/.worktrees/dashboard-specs/`. Paths below are repo-relative. Single Next.js project — Option 1 from the template, as recorded in `plan.md` § Project Structure. The route group `(studio)`, the dashboard route, and `components/lacquer/` already exist from feature 002; everything in this task list either modifies those or adds alongside them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the one new top-level directory this feature introduces. Everything else slots into existing directories.

- [X] T001 [P] Create `lib/time/` directory so the timezone-helper module files have a target. The constitution mandates a single `lib/time/*` helper as the only timezone surface (§ Security & Data Integrity Constraints); this directory IS that surface. No code yet.

**Checkpoint**: Directory exists; foundational work can proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration, types regen, time helpers, settings reader, pure aggregator, and the query layer — every user story depends on these.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Schema (data-model.md)

- [X] T002 Create `supabase/migrations/0008_dashboard_data_wiring.sql` per `data-model.md` § "Migration shape": (a) one `INSERT INTO public.settings (key, value) VALUES ('salon.timezone', to_jsonb('America/Los_Angeles'::text)) ON CONFLICT (key) DO NOTHING`; (b) `CREATE INDEX IF NOT EXISTS tickets_status_closed_at_idx ON public.tickets (status, closed_at DESC) WHERE status = 'paid'`; (c) `CREATE INDEX IF NOT EXISTS payments_status_processed_at_idx ON public.payments (status, processed_at DESC) WHERE status = 'succeeded'`. No schema changes, no policy changes.
- [X] T003 Run `supabase db reset` locally to apply the new migration. Verify with `psql`: `select key, value from public.settings where key = 'salon.timezone'` returns one row with value `"America/Los_Angeles"`; `select indexname from pg_indexes where tablename in ('tickets','payments') and indexname like '%status%'` includes both new index names. No success on rerun (idempotent INSERT — the `ON CONFLICT` clause makes the re-run a no-op).
- [X] T004 Update `supabase/seed.sql` to append a dev-only paid-tickets fixture per `data-model.md` § "Seed-fixture data spec". Five paid tickets dated today in salon TZ across all four method outcomes (card, cash, gift, split-tender, card-with-discount-line); non-zero `tip_cents` on four of five; mixed techs from existing roster; one ticket includes a `kind='discount'` line so the discount-exclusion projection is exercised. Wrap in `do $$ begin if exists (select 1 from auth.users where email = 'owner@tangnails.dev') then <inserts here>; end if; end $$;` so the block never executes against production. Re-run `supabase db reset`; confirm `select count(*) from public.tickets where status='paid' and closed_at >= now()::date` returns `5` and `select count(distinct method) from public.payments p join public.tickets t on t.id = p.ticket_id where t.status='paid' and t.closed_at >= now()::date` is `3` (cash, card, gift — the split ticket contributes both cash and card rows).
- [X] T005 Regenerate `lib/db/types.ts` from the updated schema (`supabase gen types typescript --local > lib/db/types.ts` — match the convention used by feature 013). No new tables/columns, but the regen keeps the file in lockstep with the live schema; the two new indexes don't change the type, which is fine.

### Red-baseline tests (write FIRST, ensure they FAIL)

- [X] T006 [P] Create `tests/unit/time/period-windows.test.ts` per `contracts/period-windows.md`: cover `todayWindow` / `weekWindow` / `monthWindow` across (a) the canonical happy path in America/Los_Angeles (`now = 2026-05-16T22:14:00.000Z` → today_start `2026-05-16T07:00:00.000Z`, week_start `2026-05-11T07:00:00.000Z`, month_start `2026-05-01T07:00:00.000Z`); (b) DST spring-forward (`now = 2026-03-08T15:00:00.000Z` → today_start `2026-03-08T08:00:00.000Z`, lost-hour window length); (c) DST fall-back (`now = 2026-11-01T13:00:00.000Z` → today_start `2026-11-01T07:00:00.000Z`, gained-hour window length); (d) Sunday→Monday week rollover (`now = 2026-05-17T06:59:00.000Z` Sunday 23:59 PDT → week_start `2026-05-11T07:00:00.000Z`; `now = 2026-05-18T07:01:00.000Z` Monday 00:01 PDT → week_start `2026-05-18T07:00:00.000Z`); (e) month boundary (`now = 2026-03-01T07:59:00.000Z` Feb 28 23:59 PST → month_start `2026-02-01T08:00:00.000Z`; `now = 2026-03-01T08:01:00.000Z` Mar 1 00:01 PST → month_start `2026-03-01T08:00:00.000Z`); (f) far-from-UTC tz (`tz = "Asia/Tokyo"`, same `now` → today_start is 9 hours earlier than the LA case, proves the helper isn't UTC-coupled). Red baseline before T012.
- [X] T007 [P] Create `tests/unit/time/format.test.ts` per `contracts/period-windows.md`: cover `formatSubtitle(d, tz)` returning `"Saturday, May 16"` for `(2026-05-16T22:14:00.000Z, "America/Los_Angeles")` and `"Sunday, May 17"` for the same instant with `"Asia/Tokyo"` (proves the TZ argument is honored); cover `formatTime(d, tz)` returning `"3:14 PM"` for the LA case and `"5:00 PM"` for `(2026-05-16T00:00:00.000Z, "America/Los_Angeles")` (the previous-day instant). Red baseline before T013.
- [X] T008 [P] Create `tests/unit/db/settings.test.ts` per `contracts/queries.md` § 1: against a mocked supabase client, cover (a) happy path — row exists with jsonb-string value `"America/Los_Angeles"` → `getSetting('salon.timezone')` returns the string; (b) row missing — `getSalonTimezone(supabase)` returns the default `"America/Los_Angeles"` without throwing (FR-008 — the dashboard read tolerates a missing row); (c) jsonb non-string value — `getSetting('foo')` returning a number throws a typed `InvalidSettingError` (defensive against future bad data). Red baseline before T014.
- [X] T009 [P] REWRITE `tests/unit/dashboard/aggregate.test.ts` per the new `summarizeRows()` contract from `contracts/queries.md` § 7: delete the existing tests for `buildDashboardData` / `txAggregate` / `txTotals` / `applyPeriodFactor` (those exports are being removed in Polish). New cases: (a) empty input → empty-summary shape (`count=0`, all currency 0, `byMethod = { card: 0, cash: 0, gift: 0 }`, `avgServicesPerSale=0`, `tipPctAvg=0`); (b) one ticket with two service items + one discount item → Services count is `2` (discount excluded), Revenue is the payment amount + tip; (c) two paid tickets with a `status='failed'` payment row mixed in → failed payment excluded from Revenue/Tips/byMethod; (d) split-tender ticket (one cash payment, one card payment on the same ticket) → `byMethod.card` and `byMethod.cash` both receive the respective amounts; the row-level "split" marker is *not* `summarizeRows`'s concern (it's per-row in `queryTodayFeed`). Red baseline before T015.
- [X] T010 [P] MODIFY `tests/unit/dashboard/format.test.ts` for the new `formatServiceLabel(names: readonly string[])` signature (per T016 below — drop the old `(items, services)` form): cover (a) zero names → empty string; (b) one name → that name; (c) two names → `"A, B"`; (d) three names → `"A, +2 more"`; (e) five names → `"A, +4 more"`. Remove the now-obsolete `Service` and `TxLineItem` imports from `@/lib/dashboard/mock-data`. The existing tests for `formatCurrency` / `formatCount` / `formatPercent` / `paymentMixWidths` stay — those helpers are unchanged. Red baseline before T016.
- [X] T011 [P] Create `tests/unit/dashboard/queries.test.ts` per `contracts/queries.md` §§ 3–6: against a mocked supabase client, cover (a) `querySummaryRows(supabase, tz, 'today', now)` selects from `tickets` with the right `(status, closed_at)` filter using `todayWindow(tz, now)` bounds, and returns the empty-summary shape when the result is empty; (b) `querySummaryRows(…, 'week', …)` uses `weekWindow`; (c) `querySummaryRows(…, 'month', …)` uses `monthWindow`; (d) `queryTodayFeed(…)` returns rows sorted `closed_at desc`, projects `serviceLabel` from non-discount `name_snapshot` only, projects `techIds` from non-discount item `assigned_staff_id` only (unique, preserves first-occurrence order), marks `method = 'split'` when a ticket has ≥2 distinct succeeded-payment methods, otherwise the single method; (e) `queryLastSaleTime(…)` returns the max `processed_at` for today's succeeded payments or `null` when none; (f) `queryStaffRoster(…)` selects `id, display_name, color_token` for `active = true` rows. Red baseline before T017.

### Implementations (make the red tests green)

- [X] T012 [P] Implement `lib/time/period-windows.ts` per `contracts/period-windows.md` using `Intl.DateTimeFormat` only (no external library — research § 1). Export `salonNow(tz)`, `todayWindow(tz, now)`, `weekWindow(tz, now)` (week starts Monday — FR-007), `monthWindow(tz, now)`. Use the "two-step technique" (`Intl.DateTimeFormat(tz, ...).formatToParts(d)` then re-ask `Intl` for the offset at the candidate boundary) so DST transitions produce correct boundaries. Pure functions, no Supabase, no React, no Node-only APIs. T006 should now pass.
- [X] T013 [P] Implement `lib/time/format.ts` per `contracts/period-windows.md`: export `formatSubtitle(d, tz)` returning `"{Weekday}, {Month} {day}"` via `Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })`; export `formatTime(d, tz)` returning `"{h}:{mm} {AM|PM}"` via `Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })`. T007 should now pass.
- [X] T014 [P] Implement `lib/db/settings.ts` per `contracts/queries.md` § 1: export `getSetting<T = unknown>(supabase, key)` (one-row `select value from settings where key = $key`, returns `data?.value as T` on hit, `null` on miss, throws `InvalidSettingError` on jsonb non-T value when T is typed); export `getSalonTimezone(supabase)` (calls `getSetting<string>(supabase, 'salon.timezone')`, returns `'America/Los_Angeles'` on null per FR-008). Export the `InvalidSettingError` class. Server-only — file lives outside any `"use client"` boundary. T008 should now pass.
- [X] T015 REWRITE `lib/dashboard/aggregate.ts` per `data-model.md` § "Read-model types" and `contracts/queries.md` § 7: (a) export `summarizeRows({ tickets, items, payments }, period)` — pure function — using the rules from T009's tests; (b) MOVE the types `DashboardPeriod`, `PaymentMethod`, `Technician`, `DashboardSummary`, `TransactionRow`, `QuickAction`, `DashboardData` into this file (they previously lived in or were re-exported from `mock-data.ts`); (c) EXTEND `PaymentMethod` to include the literal `"split"` so `TransactionRow.method` can carry it (FR-014a); (d) DROP `comparisons` from the `DashboardData` type (FR-020); (e) DROP `client` from the `TransactionRow` type (FR-023); (f) keep the existing `txAggregate`, `txTotals`, `applyPeriodFactor`, `buildDashboardData`, `PERIOD_FACTOR`, `QUICK_ACTIONS` exports INTACT for now (they continue to import from `mock-data.ts` so the dashboard page keeps rendering during foundational; they get deleted in Polish T037). T009 should now pass; the build remains green because nothing's been removed yet.
- [X] T016 [P] Refactor `lib/dashboard/format.ts` per T010: change `formatServiceLabel` from `(items, services)` to `(names: readonly string[])` — drop the lookup, use the names directly (1–2 → comma-separated; 3+ → `"{first}, +N more"`). Remove the `Service` / `TxLineItem` imports from `@/lib/dashboard/mock-data`. The other exports (`formatCurrency`, `formatCount`, `formatPercent`, `paymentMixWidths`) are unchanged. T010 should now pass.
- [X] T017 Implement `lib/dashboard/queries.ts` per `contracts/queries.md` §§ 2–7: export `salonNow` (re-export from `lib/time/period-windows`), `querySummaryRows(supabase, tz, period, now)`, `queryTodayFeed(supabase, tz, now)`, `queryLastSaleTime(supabase, tz, now)`, `queryStaffRoster(supabase)`, and the `loadDashboard(supabase)` orchestrator. `loadDashboard` reads `salon.timezone` via `getSalonTimezone()`, computes `now = salonNow(tz)`, then `Promise.all`s the five reads + builds the `DashboardData` (greeting subtitle from `formatSubtitle(now, tz)` + `formatTime(lastSale, tz)` when non-null per FR-010; quick actions imported from a constant moved out of `aggregate.ts` if needed). The four query helpers use the partial indexes from T002 for the hot paths. T011 should now pass.

**Checkpoint**: All foundational tests green (T006, T007, T008, T009, T010, T011). Build remains green (old `aggregate.ts` exports still functional). `lib/dashboard/mock-data.ts` is still imported by `tech-stack.tsx`, `period-toggle.tsx`, `tech-avatar.tsx`, `techs-on-shift-tile.tsx`, and the old `aggregate.ts` exports — those imports get migrated in US1 and the file gets deleted in Polish.

---

## Phase 3: User Story 1 — Today's real numbers on landing (Priority: P1) 🎯 MVP

**Goal**: Replace the dashboard's mock-data render with live today's aggregates. The four headline tiles (Transactions, Services, Revenue, Tips) and the Payment-mix card show the real counts and totals from `tickets` + `ticket_items` + `payments` for today's calendar window in the salon's local timezone. The header subtitle shows the real weekday + date + last-sale time. The recent-transactions feed shows today's paid tickets with the new row shape (no client column; `Split` pill on split-tender; calm empty state when there are no sales). The techs-on-shift tile is gone; the per-tile comparison badges are gone; the subtitle's `· N techs on shift` clause is gone. Covers FR-001..FR-006, FR-010, FR-013, FR-014, FR-014a, FR-018, FR-019, FR-020, FR-021, FR-023, FR-024, FR-025, FR-026, FR-027.

**Independent Test**: Run `supabase db reset` (T003 + T004 leave 5 paid tickets seeded for today). Sign in, land on the dashboard. Verify all four tiles populate from the seed; the Payment-mix card's three rows sum to the seed total; the subtitle reads `{today's weekday}, {today's month + day} · Last sale {seeded latest time}`; the recent-transactions feed shows 5 rows with no client column; one row shows a `Split` pill; no tile shows a `+N vs avg` or `+N%` badge; the lower-left column has only Quick Actions (no Techs-on-shift tile or label); the header subtitle has no `· N techs on shift` clause. Truncate today's paid tickets via the SQL from `quickstart.md § 5`; the tiles render `0` / `$0`, the Payment-mix bar is a single neutral segment, the Tips tile shows `$0.00` with no sub-line, the feed shows `No sales yet today.`, and the subtitle collapses to `{weekday}, {month + day}`. SC-001, SC-002, SC-004.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [X] T018 [US1] Create `tests/e2e/dashboard.spec.ts` with describe block `"US1: today's real numbers"`. Uses the seed fixture from T004; assertions match the Acceptance Scenarios in `spec.md § US1`. (a) After `supabase db reset`, navigate to `/dashboard`, assert the four tiles show the correct seeded values; assert the Payment-mix legend rows show `Card`, `Cash`, `Gift` with the correct dollar totals (and the seeded Gift redemption produces a non-zero Gift row); assert the subtitle matches `{weekday}, {month + day} · Last sale {time}` where weekday/month/day come from today in `America/Los_Angeles` and `time` matches the latest seeded payment's `processed_at` formatted as `h:mm AM/PM`; assert no element with text matching `+\d+ vs avg` or `\+\d+%` exists in the stat tiles; assert no element matching `data-slot="techs-on-shift-tile"` or text `"Techs on shift"` exists; assert the feed rows do NOT contain a `.client` cell; assert exactly one row contains the `Split` pill. (b) Truncate paid tickets via the SQL from `quickstart.md § 5`; reload; assert every numeric tile is `0` or `$0`; assert the Payment-mix bar has exactly one segment with neutral style; assert the feed shows `No sales yet today.`; assert the subtitle has no `· Last sale` text. Audit-cursor: this feature emits no audit rows, so use `newAuditCursor()` to assert that after navigating the dashboard, `getAuditLogRowsSince()` returns an empty array (read-only verification). Red baseline before T019–T030 land.

> Run `npm test && npm run test:e2e -g "US1"`. T018 should fail (page still uses mock data, still mounts techs-on-shift, still shows comparison badges). Move on once you've confirmed it's red.

### UI primitives (parallelizable — separate files)

- [X] T019 [P] [US1] Create `components/lacquer/method-pill.tsx` — extracts the existing inline `.tx-meth-pill` `<span>` from `recent-transactions-feed.tsx` into a standalone Server Component. Props: `{ method: 'card' | 'cash' | 'gift' | 'split' }`. Renders `<span className={\`tx-meth-pill \${method}\`}>{LABEL[method]}</span>` where `LABEL = { card: 'Card', cash: 'Cash', gift: 'Gift', split: 'Split' }`. The `.split` styling is added in T021.
- [X] T020 [P] [US1] Create `components/lacquer/empty-feed-state.tsx` — calm empty state for the recent-transactions feed. Server Component. Props: none. Renders a centered `<div>` with the muted-foreground token; copy: `No sales yet today.` (period terminator, sentence case — research § 6). Sized to roughly match an empty `.tx-feed-list` slot so the feed container's overall height stays close to the populated case.
- [X] T021 [P] [US1] Modify `styles/dashboard.css` for the two visual deltas owned by US1: (a) add `.tx-meth-pill.split { background: var(--muted); color: var(--foreground); border-color: var(--border); }` — same border-radius/padding/typography as the other variants, neutral fill (research § 7); (b) change the `.tx-feed-row` rule's `grid-template-columns` from the existing 6-column declaration (time | client | svc | techs | method | amt) to a 5-column declaration (time | svc | techs | method | amt) — redistribute the client column's width allocation proportionally between `svc` and `techs` using the existing 4px-base scale. No off-scale values; no raw hex.

### Import-path migration (parallelizable — separate files, each is a single-line import change)

- [X] T022 [P] [US1] Modify `components/lacquer/tech-avatar.tsx`: change the `import type { Technician } from "@/lib/dashboard/mock-data"` line to `import type { Technician } from "@/lib/dashboard/aggregate"`. No other change.
- [X] T023 [P] [US1] Modify `components/lacquer/period-toggle.tsx`: change the `import type { DashboardPeriod } from "@/lib/dashboard/mock-data"` line to `import type { DashboardPeriod } from "@/lib/dashboard/aggregate"`. ALSO drop the `comparisons` field from the `PeriodProviderProps` type, from the context value type, and from `usePeriod()`'s return type (FR-020). The provider stops requiring/passing the comparisons string set.
- [X] T024 [US1] Refactor `components/lacquer/tech-stack.tsx`: remove the `import { STAFF } from "@/lib/dashboard/mock-data"` line. Add a new required prop `staff: readonly Technician[]` (type imported from `@/lib/dashboard/aggregate`). Replace the internal `STAFF.find(s => s.id === id)` lookup with `staff.find(s => s.id === id)`. Update the callers — the only caller in v1 is `recent-transactions-feed.tsx` (T026) which receives `staff` from `DashboardData.staff` via prop drilling.

### Component edits

- [X] T025 [US1] Modify `components/lacquer/period-summary.client.tsx`: remove the `transactionsDelta = period === "today" ? comparisons.transactionsVsAvg : null` and `revenueDelta = period === "today" ? comparisons.revenueDelta : null` derivations; stop passing the `delta` prop to the Transactions and Revenue `<StatCard />` mounts (FR-020). Stop reading `comparisons` from `usePeriod()`. No other change.
- [X] T026 [US1] Modify `components/lacquer/recent-transactions-feed.tsx`: (a) drop the `<span className="client">{row.client}</span>` cell from each row (FR-023); (b) replace the inline `<span className={\`tx-meth-pill \${row.method}\`}>{row.method}</span>` with `<MethodPill method={row.method} />` so the new `split` variant has a single source of truth; (c) add a `staff: readonly Technician[]` prop and pass it through to `<TechStack staff={staff} ids={row.techIds} size={20} />` (T024 now requires it); (d) when `rows.length === 0`, render `<EmptyFeedState />` in place of the `<div className="tx-feed-list">` list; the header (title and inert `View all` button) stays visible (FR-013). Import `MethodPill` from `@/components/lacquer/method-pill` and `EmptyFeedState` from `@/components/lacquer/empty-feed-state`.
- [X] T027 [US1] Modify `components/lacquer/stat-card.tsx`: narrow `delta` from required `string | null` to optional `delta?: string | null` so callers that no longer pass it (US1's Transactions/Revenue tiles) typecheck. No render-behavior change — when `delta` is missing/null, no delta element renders, exactly as today. Update any other consumers if the typecheck flags them.
- [X] T028 [US1] DELETE `components/lacquer/techs-on-shift-tile.tsx` (FR-019). The component is no longer mounted by `page.tsx` after T030. No other consumer exists in the repo.

### Loading state

- [X] T029 [US1] Create `app/(studio)/dashboard/loading.tsx`. Server Component that renders the same `.tx-landing` chrome as the live render: the header band slot, the four `.tx-stat-card` slots + a `.tx-stat-card` spanning two columns for the Payment-mix slot, and an empty feed-shell. Each placeholder uses `background: var(--muted)` and `border-radius` from the existing token scale. Add a single CSS rule to `styles/dashboard.css`: `@keyframes tx-skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } } .tx-skeleton { animation: tx-skeleton-pulse 1500ms ease-in-out infinite; }` — apply `.tx-skeleton` to each placeholder. The 1500ms ambient pulse is intentional (research § 5); it doesn't compete with the constitution's 150/200/300 ms reactive-affordance bands because it never indicates progress.

### Page wiring

- [X] T030 [US1] Modify `app/(studio)/dashboard/page.tsx`: (a) add `export const dynamic = "force-dynamic";` at the top of the file (FR-027 — every navigation re-queries Supabase per research § 4); (b) get an authenticated server-side Supabase client by importing the helper from `@/lib/db/server` and calling it (match the pattern other studio routes use — check an existing call site if uncertain); (c) replace `const data = buildDashboardData()` with `const data = await loadDashboard(supabase)` (import from `@/lib/dashboard/queries`); (d) remove the `import { TechsOnShiftTile } from "@/components/lacquer/techs-on-shift-tile"` line; (e) remove the `<div className="muted">Techs on shift</div>` label JSX and the `<TechsOnShiftTile staff={data.staff} />` mount (FR-019); (f) pass `staff={data.staff}` down to `<RecentTransactionsFeed rows={data.recent} staff={data.staff} />` (T026 added the prop); (g) drop the `comparisons={data.comparisons}` prop from `<PeriodProvider>` (T023 removed it from the provider's type); (h) preserve all other layout — the header band, the period toggle, the new-transaction CTA, the period summary, the quick actions, and the recent-transactions feed all stay in their existing slots.

### Verification

- [X] T031 [US1] Scoped intermediate gate per `CLAUDE.md § Scoping intermediate phase gates`: `npm test` (every unit test from T006–T011 green AND no regression) and `npx playwright test tests/e2e/dashboard.spec.ts -g "US1"` (T018 green). Then run scoped Prettier + ESLint over the diff: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` and `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`. `npm run typecheck` stays full-suite.

**Checkpoint**: US1 is fully functional. The dashboard reads live data for today; the techs-on-shift tile is gone; the comparison badges are gone; the recent-transactions feed has the new row shape (no client column, `Split` pill, empty state). Week / Month tile values are technically already correct (because `loadDashboard` already Promises-all all three periods) but the e2e proof for that is US2.

---

## Phase 4: User Story 2 — Period switching across real calendar windows (Priority: P1)

**Goal**: The Today / Week / Month toggle recalculates every tile from real aggregates over the salon's calendar windows — not a multiplier extrapolation. Today = local day; Week = current Monday-through-now in salon TZ; Month = first-of-current-month-through-now in salon TZ. Tickets outside the window are excluded. Covers FR-007 (calendar boundaries), FR-008 (salon timezone source), and the SC-003 "200 ms toggle" target. Implementation work is already done in `loadDashboard` (T017) — this phase is the e2e proof that the per-period reads land in the right tiles.

**Independent Test**: Seed extra paid tickets at controlled dates: (a) earlier this week (Mon–today exclusive of today), (b) earlier this month (1st–today exclusive of this week), (c) last week + last month for negative control. Open the dashboard. Verify Today's tile values match the today-only subset; toggling to Week increases the values to include this week's earlier-than-today tickets; toggling to Month increases further to include this month's earlier-than-this-week tickets; the last-week/last-month rows are NEVER included. SC-003 — toggle updates every tile within 200 ms perceived latency.

### Tests for User Story 2 (write FIRST, ensure they FAIL or are green from T017 — fix the implementation if e2e bugs surface)

- [X] T032 [US2] Extend `tests/e2e/dashboard.spec.ts` with describe block `"US2: period switching across calendar windows"`. Seeding strategy: drive the seed via a helper at the top of the spec file (uses `tests/e2e/_db.ts` for the supabase admin client) that inserts paid tickets at `closed_at` values pinned to specific points: today at noon LA, two days ago at noon LA (in this calendar week unless today is Monday — branch on the day of week and pin to "Tuesday of this week 14:00 LA"), 5 days into the current month (definitely before "this week" unless we're in the first week of the month — branch and pick a safe in-month-but-not-in-week instant), last Tuesday 14:00 LA (last week's negative control), 5 days before last week's Monday (last month's negative control when applicable). For each toggle position, assert the tile totals. Assertion shape: numeric tile values reflect the in-window subset; the negative-control tickets never contribute. Use a fresh `newAuditCursor()` to assert zero audit writes during the read-only navigation. The fixture seeding cleans up at the end via the `_db.ts` helpers.

> Run `npm run test:e2e -g "US2"`. T032 may pass straight away if T017's `loadDashboard` and the four `querySummaryRows` calls are correctly implemented with the right per-period windows — that's the goal. If it fails, the failure points at a bug in the window-helper math or the SQL filters; fix the helper (revisit T012) or the query (revisit T017) until green. No story-specific implementation tasks should be needed.

### Verification

- [X] T033 [US2] Scoped intermediate gate: `npx playwright test tests/e2e/dashboard.spec.ts -g "US2"` (T032 green); scoped Prettier + ESLint over the diff; `npm run typecheck` full.

**Checkpoint**: US2 complete. The period toggle correctly recalculates across real calendar windows.

---

## Phase 5: User Story 3 — Browse the full day's transaction log (Priority: P2)

**Goal**: The recent-transactions feed shows every paid ticket from today (not capped at 7), scrollable inside its existing layout slot. The feed is pinned to today regardless of which period the toggle is on. Covers FR-011 (pinned to today), FR-012 (scrollable inside slot, no horizontal scroll), FR-022 (cap removed).

**Independent Test**: Seed 15 paid tickets today (well above the previous 7-row cap). Open the dashboard. Verify the feed shows all 15 rows ordered `closed_at desc`; the feed container scrolls internally (the outer page doesn't grow); toggling the period to Week or Month does NOT change which rows the feed shows.

### Tests for User Story 3 (write FIRST, ensure it FAILs)

- [X] T034 [US3] Extend `tests/e2e/dashboard.spec.ts` with describe block `"US3: scrollable today feed"`. Test setup: seed 15 paid tickets today via a fixture helper that mirrors the structure of `quickstart.md § 8`'s SQL but for 15 tickets at staggered `closed_at` values throughout the day. Assertions: (a) `await page.locator('.tx-feed-row').count()` equals 15; (b) the rows are in `closed_at desc` order (read the first and last row's `time` cell and confirm the first is later than the last); (c) the feed list container scrolls vertically — use `await page.locator('.tx-feed-list').evaluate(el => el.scrollHeight > el.clientHeight)` and assert true; (d) the outer page does NOT introduce horizontal scrolling — `await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)` and assert true; (e) click the period toggle's `Week` button, wait for the toggle to register, and re-assert the feed row count is still 15 with the same `closed_at desc` order (feed pinned to today regardless of toggle); (f) audit-cursor zero-writes assertion as in T018. Red baseline before T035.

### Implementation

- [X] T035 [US3] Modify `styles/dashboard.css` — extend the existing `.tx-feed-list` rule with `overflow-y: auto;`, `max-height: 100%;`, and `min-height: 0;` so the row list scrolls inside its slot when the row count overflows the container's available height (FR-012). The outer `.tx-feed` already enforces the slot's outer height via the `.tx-landing-bottom-right` flex from feature 002; no change needed there. Confirm the `.tx-feed` wrapper still has `min-height: 0` so the inner scroll is honored. Make T034 pass.

### Verification

- [X] T036 [US3] Scoped intermediate gate: `npx playwright test tests/e2e/dashboard.spec.ts -g "US3"` (T034 green); scoped Prettier + ESLint over the diff; `npm run typecheck` full.

**Checkpoint**: US3 complete. The feed is uncapped, scrollable, and pinned to today.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Delete the now-dead mock data and the obsolete `aggregate.ts` exports, run the design-auditor side-by-side, and run the final full-suite gate.

- [X] T037 DELETE `lib/dashboard/mock-data.ts`. Confirm via `grep -rn "from \"@/lib/dashboard/mock-data\"" --include='*.ts' --include='*.tsx'` that no consumer remains; T022 + T023 + T024 migrated the last three component imports, and T015's `aggregate.ts` keeps a temporary import that gets deleted in T038.
- [X] T038 Clean up `lib/dashboard/aggregate.ts`: delete the now-orphan exports `txAggregate`, `txTotals`, `applyPeriodFactor`, `buildDashboardData`, `PERIOD_FACTOR`, and the `QUICK_ACTIONS` constant (the latter should already have been moved into `queries.ts` by T017 — confirm and delete the duplicate). Delete the mock-data imports. Confirm the only remaining exports are: the types (`DashboardPeriod`, `PaymentMethod`, `Technician`, `DashboardSummary`, `TransactionRow`, `QuickAction`, `DashboardData`), the new `summarizeRows()` function, and the supporting input-row types `summarizeRows()` consumes. `npm run typecheck` must remain green after this delete.
- [X] T039 [P] Verify the `<!-- SPECKIT START -->` marker block in `CLAUDE.md` line 122–124 still points to `specs/015-dashboard-data-wiring/plan.md` (set by the plan phase). If not, fix it.
- [X] T040 Walk through `quickstart.md §§ 1–7` manually to confirm the developer journey works end-to-end: `supabase db reset` → live tiles populated → period toggle recalculates → salon-timezone change shifts the day boundary → empty-state path renders cleanly → gate suite runs.
- [X] T041 Side-by-side design comparison per `quickstart.md § 7`: open `design-system/prototypes/transaction/Landing.jsx` lines 282–372 (the `LandingStats` Variation B function) and the live `http://localhost:3000/dashboard` in adjacent windows. Verify (a) every color/spacing/radius/shadow on the live page traces to a token in `styles/tokens.css` (no raw hex, no off-scale spacing); (b) every Lucide icon is at 1.5px stroke, sized 14/16/18/20/24; (c) Inter only, weights 400/500/600; tabular numerals on every currency and count; (d) the five intentional deltas (FR-019 techs-on-shift removed, FR-020 comparison badges removed, FR-021 subtitle clause removed, FR-022 feed scroll + cap removed, FR-023 feed client column removed) all present; (e) the one additive (FR-014a `Split` pill) reuses `.tx-meth-pill` chrome with a muted-family fill; (f) nothing else has drifted vs. 002. Fix any drift before moving to T042.
- [X] T042 Final full-suite gate (CLAUDE.md § Pre-push quality gates): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five MUST be green. If any fails, the feature is not done.

**Checkpoint**: Feature complete. Mock data deleted. Build green. Design audit passed. Full gate green. Ready to push and open a PR.

---

## Dependencies

```text
Phase 1 (Setup)         T001
        │
        ▼
Phase 2 (Foundational)  T002 → T003 → T004 → T005
                        T006 ──┐
                        T007 ──┤
                        T008 ──┤
                        T009 ──┼─► T012 (T006 green)
                        T010 ──┤   T013 (T007 green)
                        T011 ──┤   T014 (T008 green)
                                ▼   T015 (T009 green)
                                    T016 (T010 green)
                                    T017 (T011 green)
        │
        ▼
Phase 3 (US1)           T018 (red)
                        T019, T020, T021 — parallelizable UI primitives
                        T022, T023 — parallelizable import path swaps (Tech-Avatar, Period-Toggle)
                        T024 — sequential (depends on T015's exported Technician type)
                        T025, T026, T027 — sequential within file but T025/T027 can run in parallel with T026
                        T028 — DELETE techs-on-shift-tile (depends on T030 unmount, technically can run after T030)
                        T029 — loading.tsx (parallelizable with T030 — different file)
                        T030 — page.tsx rewrite (depends on T015, T017, T024, T025, T026, T028)
                        T031 — gate (depends on all above)
        │
        ▼
Phase 4 (US2)           T032 (depends on T017, T012 — and on US1 because the page renders the toggle)
                        T033 — gate
        │
        ▼
Phase 5 (US3)           T034 (depends on T017, T026 — feed must already exist)
                        T035 (depends on T034)
                        T036 — gate
        │
        ▼
Phase 6 (Polish)        T037, T038, T039, T040, T041, T042
```

## Parallel execution opportunities

Within Phase 2, the red-baseline tests (T006–T011) can be authored in parallel (separate files). The implementations that satisfy them (T012, T013, T014) can land in parallel (separate files). T015, T016, T017 are sequential within Phase 2 because T017 depends on T015's exported types and T016's `formatServiceLabel` signature.

Within Phase 3, the UI primitives (T019 MethodPill, T020 EmptyFeedState, T021 CSS) and the type-import swaps (T022, T023) can all proceed in parallel. The component edits (T025, T026, T027) and the `loading.tsx` (T029) can mostly run concurrently — only T026 and T030 are tightly coupled because T030 passes `staff` down to T026's modified feed.

Phases 4 and 5 each have a single e2e test + at most one implementation tweak, so parallelism inside them is limited.

## Implementation strategy

- **MVP scope** = Phase 1 + Phase 2 + Phase 3 (US1). Ship the dashboard reading live today's data as the smallest deployable unit. The period toggle's Week/Month tiles already show correct values (because `loadDashboard` does all three windows from day one) — Phase 4 just adds the e2e proof. Phase 5 adds the scroll-and-uncap polish.

- **Order of merge** within the MVP: foundational tests → foundational implementations → US1 e2e (red) → UI primitives in parallel → import swaps → page wiring → gate. Each story phase is independently testable; if a phase's gate fails, the prior phase's checkpoint state is still mergeable.

- **Test discipline**: red baselines come BEFORE implementations in every phase. The most expensive failure mode is a timezone-window bug that only surfaces at midnight in production; the unit tests in T006 + T007 pin the contract against fixed dates so the implementation can't accidentally regress.

- **Schema discipline**: T002's migration is auto-applied by `.github/workflows/db-migrate-{preview,prod}.yml` (CLAUDE.md § Supabase migrations); do NOT run `supabase db push` against the hosted projects by hand.

- **Design-system discipline**: every visual value traces to `styles/tokens.css`. The design-auditor side-by-side in T041 is the last guard before push; if any drift is flagged, fix it locally rather than ship.
