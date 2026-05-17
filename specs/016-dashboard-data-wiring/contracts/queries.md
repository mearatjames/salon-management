# Contract: Dashboard read-query helpers

**Feature**: 016-dashboard-data-wiring
**Module**: `lib/dashboard/queries.ts` (new)
**Related**: `lib/dashboard/aggregate.ts` (rewritten — `summarizeRows()`), `lib/db/settings.ts` (new — settings reader), `lib/time/period-windows.ts` (new — window math)

This file pins the *internal* contracts for the read helpers the dashboard depends on. The dashboard exposes no external HTTP API or SDK surface — these are module-level TypeScript contracts.

---

## 1. `getSalonTimezone(supabase)`

```ts
function getSalonTimezone(supabase: SupabaseClient<Database>): Promise<string>
```

**Input**: an authenticated server-side Supabase client (`lib/db/server.ts`).

**Output**: the IANA timezone string from `public.settings.salon.timezone`. Falls back to `"America/Los_Angeles"` when the row is missing.

**SQL emitted (in plain English)**: a single `select value from settings where key = 'salon.timezone' limit 1` — the row's `value` is a jsonb-encoded string; the helper unwraps and returns it.

**Failure modes**:
- Settings row missing → return the default `"America/Los_Angeles"` without throwing (FR-008).
- Supabase unreachable → propagate the supabase error (the dashboard's loading/error states catch it; FR-026).
- jsonb value not a string → throw a typed `InvalidSettingError` (defensive — the seed always writes a string).

---

## 2. `salonNow(tz)` *(from `lib/time/period-windows.ts`)*

```ts
function salonNow(tz: string): Date
```

**Input**: an IANA timezone string.

**Output**: a `Date` whose UTC millis represent the current wall-clock instant. The `tz` parameter is informational to the caller; the helper just returns `new Date()` and is used by the orchestrator as the time-reference passed to the window helpers. Tested as a thin wrapper to keep the orchestrator pure (the unit tests inject a fixed instant).

---

## 3. `querySummaryRows(supabase, tz, period, now)`

```ts
function querySummaryRows(
  supabase: SupabaseClient<Database>,
  tz: string,
  period: "today" | "week" | "month",
  now: Date,
): Promise<DashboardSummary>
```

**Input**: server-side supabase client, salon timezone, the period to compute, the "now" instant.

**Output**: a `DashboardSummary` with the per-period aggregates (FR-002..FR-006). When the period has zero paid tickets, returns the empty-shape summary (`count=0`, all currency values `0`, `byMethod = { card: 0, cash: 0, gift: 0 }`, `avgServicesPerSale=0`, `tipPctAvg=0`) — FR-018.

**Window math**: uses `todayWindow(tz, now)` / `weekWindow(tz, now)` / `monthWindow(tz, now)` from `lib/time/period-windows.ts` to compute the `[startUtc, endUtc]` bound.

**SQL emitted (in plain English)**: two reads joined in-memory:

1. `select tickets.id, tickets.total_cents from tickets where status = 'paid' and closed_at >= $start and closed_at <= $end` → the paid ticket IDs in the window. The partial index `tickets_status_closed_at_idx` makes this an index-only scan.
2. For those ticket IDs: `select ticket_items.ticket_id, ticket_items.qty, ticket_items.kind from ticket_items where ticket_id = any($ticketIds)` and `select payments.ticket_id, payments.method, payments.amount_cents, payments.tip_cents from payments where ticket_id = any($ticketIds) and status = 'succeeded'`.

The helper then passes the three result sets to `summarizeRows()` (pure helper) which produces the `DashboardSummary`.

**Failure modes**:
- Empty window → returns the empty-shape summary, no throw.
- Supabase error → propagates the error; orchestrator catches it.

**Invariants**:
- Discarded tickets are excluded by the `status = 'paid'` filter.
- Discount items (`kind = 'discount'`) are excluded from the Services count and from `avgServicesPerSale`.
- Failed/pending payments are excluded by the `status = 'succeeded'` filter — Revenue and the Payment-mix card never count them.
- `byMethod` totals sum to `Revenue` (currency-precision; FR-006).

---

## 4. `queryTodayFeed(supabase, tz, now)`

```ts
function queryTodayFeed(
  supabase: SupabaseClient<Database>,
  tz: string,
  now: Date,
): Promise<readonly TransactionRow[]>
```

**Input**: server-side supabase client, salon timezone, the "now" instant.

**Output**: the full ordered list of today's paid tickets as `TransactionRow`s (FR-011, FR-014, FR-014a, FR-023). Ordered by `closed_at desc`. Empty array when today has no paid tickets (the page renders the empty state).

**Window math**: uses `todayWindow(tz, now)`. The feed is *pinned to today regardless of the period toggle* (FR-011).

**SQL emitted (in plain English)**:

1. `select id, total_cents, closed_at from tickets where status = 'paid' and closed_at between $today_start and $now order by closed_at desc` → the paid ticket IDs and totals for today.
2. For those ticket IDs: `select ticket_id, name_snapshot, assigned_staff_id, kind from ticket_items where ticket_id = any($ticketIds)` — filters to `kind != 'discount'` *in the in-memory projection* (the SQL pulls everything for the in-memory split-tender detection, but the service-summary and tech-stack projections both filter out discounts).
3. `select ticket_id, method from payments where ticket_id = any($ticketIds) and status = 'succeeded'` — used for both the per-row method pill and the split-tender detection.

For each ticket, the projection then computes:
- `time` — `closed_at` formatted via `formatTime(d, tz)` from `lib/time/format.ts`.
- `serviceLabel` — built from the non-discount `name_snapshot` values (1–2 → comma-separated; 3+ → `"{first}, +N more"`).
- `techIds` — unique `assigned_staff_id` values from the non-discount items, in the order they appear on the ticket.
- `method` — the `payments.method` value when the ticket has exactly one method, else the literal `"split"` when 2+ methods are represented (FR-014a).
- `total` — `total_cents / 100`, returned as a number (the row component formats it as currency).

**Failure modes**:
- Empty today → returns `[]`.
- Supabase error → propagates.

**Invariants**:
- All filters mirror `querySummaryRows` (paid tickets only, succeeded payments only).
- The discount-exclusion rule is applied consistently: discount items never contribute to `serviceLabel`, `techIds`, or the `+N more` count.

---

## 5. `queryLastSaleTime(supabase, tz, now)`

```ts
function queryLastSaleTime(
  supabase: SupabaseClient<Database>,
  tz: string,
  now: Date,
): Promise<Date | null>
```

**Input**: server-side supabase client, salon timezone, the "now" instant.

**Output**: the most recent `payments.processed_at` for today (succeeded payments only). `null` when today has no successful payments yet — the orchestrator drops the `· Last sale …` clause from the header subtitle (FR-010).

**SQL emitted (in plain English)**: `select max(processed_at) from payments where status = 'succeeded' and processed_at between $today_start and $now`. The partial index `payments_status_processed_at_idx` makes this O(1).

---

## 6. `loadDashboard(supabase)` — orchestrator

```ts
function loadDashboard(supabase: SupabaseClient<Database>): Promise<DashboardData>
```

**Input**: server-side supabase client. (No other inputs — the orchestrator owns timing and timezone resolution.)

**Output**: the full `DashboardData` shape the dashboard page consumes.

**Sequence**:

1. `const tz = await getSalonTimezone(supabase)` — one round trip.
2. `const now = salonNow(tz)` — pure local.
3. `const [today, week, month, recent, lastSale, staff] = await Promise.all([
     querySummaryRows(supabase, tz, "today", now),
     querySummaryRows(supabase, tz, "week", now),
     querySummaryRows(supabase, tz, "month", now),
     queryTodayFeed(supabase, tz, now),
     queryLastSaleTime(supabase, tz, now),
     queryStaffRoster(supabase),  // simple `select id, display_name, color_token from staff where active = true`
   ])` — six parallel reads (five aggregates + roster).
4. Compose the `DashboardData`:
   - `greeting.subtitle` = `${formatSubtitle(now, tz)}${lastSale ? ` · Last sale ${formatTime(lastSale, tz)}` : ""}` (FR-010).
   - `summaries = { today, week, month }`.
   - `recent`, `staff`, `quickActions` (static, imported from a constant).

**Failure modes**:
- A `Promise.all` rejection propagates and the route's `error.tsx` boundary handles it (calm error state; FR-026).

**Performance**: meets SC-005's 300ms p95 target with the partial indexes and the parallel-read pattern (research §2 + §3).

---

## 7. `summarizeRows({ tickets, items, payments }, period)` *(from `lib/dashboard/aggregate.ts`)*

```ts
function summarizeRows(
  input: { tickets: TicketRow[]; items: ItemRow[]; payments: PaymentRow[] },
  period: "today" | "week" | "month",
): DashboardSummary
```

**Pure function** — no Supabase, no React. Owned and unit-tested in isolation.

**Behavior**: groups the input rows by ticket, sums `qty` across `kind != 'discount'` items per ticket, sums `amount_cents + tip_cents` across `status = 'succeeded'` payments per ticket, computes `byMethod` totals across all payments (split tender contributes to each method it touches), computes `count`, `services`, `subtotal`, `tip`, `tax`, `total`, `avgServicesPerSale`, `tipPctAvg`. Returns the empty-summary shape when there are no tickets.

---

## Caller-side contract

The dashboard page (`app/(studio)/dashboard/page.tsx`) is the only caller of `loadDashboard()` in v1. The page is annotated `export const dynamic = 'force-dynamic'` so every navigation runs through `loadDashboard()` (FR-027). The function's result is wrapped in the existing `<PeriodProvider summaries={data.summaries}>` (with `comparisons` removed from the provider's type — FR-020), and consumed by the existing `<PeriodSummary />`, the new `<EmptyFeedState />` (when `recent.length === 0`), the modified `<RecentTransactionsFeed rows={data.recent} />`, the existing `<SecondaryActions actions={data.quickActions} />`, the existing `<NewTransactionCTA />`, and the existing `<PeriodToggle />`. `<TechsOnShiftTile />` is removed (FR-019).
