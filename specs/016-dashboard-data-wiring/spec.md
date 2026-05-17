# Feature Specification: Dashboard — Real Supabase Data Wiring

**Feature Branch**: `016-dashboard-data-wiring`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Wire the studio dashboard at /(studio)/dashboard to real Supabase data, replacing the in-repo mock dataset so every number on the page reflects what actually happened in the salon. The visual contract from specs/002-dashboard-page is preserved — same Variation B Stats-rich layout, same four headline stat tiles (Transactions, Services, Revenue, Tips) plus the Payment-mix card, same Today/Week/Month period toggle, same quick actions, same Lacquer tokens. The only intentional visual deltas are listed under Intentional Visual Changes."

## Overview

The studio dashboard (`app/(studio)/dashboard/page.tsx`) is the post-login landing for the owner and front-desk staff. It was shipped by `specs/002-dashboard-page` as a deliberately static surface that reads every number from an in-repo mock dataset (`lib/dashboard/mock-data.ts`) and extrapolates Week / Month by multiplying Today by hard-coded factors (1× / 6.4× / 27×).

Since 002 landed, the cash-checkout (011) and cart-polish (013) features have wired the real take-payment flow. Every cash sale now writes real rows to `tickets`, `ticket_items`, and `payments`. Square Terminal (015 — separate branch) will add card payments. The dashboard's numbers no longer reflect what's happening in the salon — they reflect a frozen prototype. The moment real sales flow in production, the dashboard will actively mislead the owner.

This feature replaces the dashboard's data layer with live Supabase aggregates while preserving the visual contract from 002. Three small, deliberately-scoped visual deltas are called out explicitly so the design auditor reads them as approved scope (not violations).

This feature is read-only. The dashboard never writes; it never subscribes to realtime; it re-fetches on navigation.

## Clarifications

### Session 2026-05-16

- Q: With no `clients` table in the schema and every paid ticket today writing `appointment_id: null`, what should the recent-transactions feed show for the client column? → A: Remove the client column from the feed entirely for v1. The service list and assigned techs become the row's identifying columns. A future client-capture feature can reintroduce the column when there is a real name to display.
- Q: How fresh is the dashboard on each navigation — is route-level caching allowed, or must every visit re-query Supabase? → A: Always fresh. The dashboard is fully dynamic; every navigation triggers a fresh aggregate query. No route-level cache, no `revalidate` window. The SC-005 performance budget covers the per-visit query cost.
- Q: When a ticket is paid with split tender (e.g. $20 cash + remainder card), what does the recent-transactions feed's method pill show? → A: A dedicated `Split` pill — a new method-pill variant rendered in place of a single-method pill whenever a ticket's successful payments span two or more methods. Honest about the split, no row-layout change. Single-method tickets continue to render their existing card / cash / gift pill.
- Q: Are discount line items included in the recent-transactions row's service-summary string? → A: No. The summary string is built from `ticket_items` where `kind != 'discount'`, mirroring FR-003's count rule. A two-service-plus-discount ticket reads as `Service 1, Service 2`; discounts never push other services into the `+N more` collapse.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Today's real numbers on landing (Priority: P1)

When the owner or a front-desk staffer signs in and lands on the dashboard, the four headline tiles (Transactions, Services, Revenue, Tips) and the Payment-mix card show what has actually happened in the salon today — counted from paid tickets, services rendered, payments captured, and tips collected — not a static prototype. The header subtitle shows today's real weekday, date, and the time of the salon's most recent sale.

**Why this priority**: This is the entire point of the feature. As long as the dashboard is showing fabricated numbers from a prototype, owners cannot trust it as a glance surface, and the moment real sales flow it becomes worse than useless. If only this story works, the dashboard already replaces the spreadsheet glance most salons still rely on.

**Independent Test**: Seed the test database with a known set of paid tickets for today (e.g. 5 tickets, 8 services total, $420 revenue across 3 card and 2 cash payments). Open the dashboard. Verify the Today tiles show exactly those values, the Payment-mix card shows the card/cash split as proportions of $420, and the subtitle shows today's weekday, date, and the timestamp of the latest payment.

**Acceptance Scenarios**:

1. **Given** the salon has 5 paid tickets today totalling $420 across 3 card and 2 cash payments with 8 services rendered, **When** the staff member lands on the dashboard with Today selected, **Then** the Transactions tile shows `5`, the Services tile shows `8`, the Revenue tile shows `$420`, the Payment-mix card shows three labelled rows summing to $420 (Card, Cash, Gift card with $0), and the bar segments are proportional to those totals.
2. **Given** the salon has zero paid tickets today, **When** the staff member lands on the dashboard with Today selected, **Then** every numeric tile renders `0` or `$0`, the Payment-mix bar renders as a single neutral segment, the Tips tile shows `$0.00` (with no average tip percent), and the recent-transactions feed shows an empty-state message.
3. **Given** today has at least one paid ticket, **When** the staff member reads the header subtitle, **Then** they see the real weekday and date (e.g. `Saturday, May 16`) followed by `Last sale {time}` where the time matches the most recent successful payment's processed-at timestamp formatted in the salon's local timezone.
4. **Given** today has zero paid tickets, **When** the staff member reads the header subtitle, **Then** they see only the weekday and date — the `Last sale …` clause is omitted.

---

### User Story 2 - Period switching across real calendar windows (Priority: P1)

The owner can switch the dashboard between Today, This Week (the current Monday-through-Sunday calendar week), and This Month (the current calendar month). All four stat tiles and the Payment-mix card recalculate from the real ticket history to reflect the selected calendar window — these are real aggregates, not extrapolations of today.

**Why this priority**: Owners glance at week and month totals every day to check pace versus expectation. Without real aggregates behind Week and Month, the toggle is theatre and the owner has to leave the page to find the real numbers. This story is what makes the dashboard a useful operational surface rather than a Today-only widget.

**Independent Test**: Seed the test database with paid tickets spread across (a) today, (b) earlier-this-week (Mon–today), (c) earlier-this-month (1st–today), and (d) last week / last month for control. Toggle the period between Today, Week, and Month. Verify each tile recalculates to the sum of the in-window tickets only — control data outside the window is excluded.

**Acceptance Scenarios**:

1. **Given** the dashboard is showing Today totals, **When** the user taps `Week`, **Then** every numeric tile recalculates to the aggregate over paid tickets between the most recent Monday 00:00 and now in the salon's local timezone, the active toggle visually moves to `Week`, and tickets from prior weeks are not included.
2. **Given** the dashboard is showing Week totals, **When** the user taps `Month`, **Then** every numeric tile recalculates to the aggregate over paid tickets between the 1st of the current month at 00:00 and now in the salon's local timezone, and tickets from prior months are not included.
3. **Given** the dashboard has been toggled to Month, **When** the user taps `Today`, **Then** every numeric tile recalculates back to today's aggregate within ~200 ms with no stale values left over from the previous selection.
4. **Given** the selected period has zero paid tickets, **When** the tiles render, **Then** all values show `0` or `$0` and the Payment-mix bar renders as a single neutral segment without dividing by zero.

---

### User Story 3 - Browse the full day's transaction log (Priority: P2)

A front-desk staffer or owner can scroll through every paid ticket from today directly on the dashboard, ordered most-recent first, without leaving the page. Each row shows the time, a service summary, the assigned techs, the payment method, and the dollar total — the row shape is the 002 row minus the client column (see FR-023), and no longer capped at 7 rows.

**Why this priority**: Useful and frequently asked for ("what was that last sale?", "did Maya already cash out the 2 PM appointment?"), but the dashboard is still useful with only the headline tiles. This deepens the surface without being load-bearing for the post-login glance.

**Independent Test**: Seed the test database with 15 paid tickets today. Open the dashboard. Verify the recent-transactions feed shows all 15 rows in `closed_at desc` order, the feed container is scrollable inside its existing layout slot (the page does not grow vertically), and the toggle between Today / Week / Month does not change which rows the feed shows — it stays pinned to today.

**Acceptance Scenarios**:

1. **Given** today has 15 paid tickets, **When** the user looks at the recent-transactions feed, **Then** they see 15 rows ordered most-recent-first; the feed container scrolls internally; the rest of the page remains visible without horizontal scrolling.
2. **Given** today has zero paid tickets, **When** the user looks at the recent-transactions feed, **Then** they see a calm empty-state message (e.g. `No sales yet today`) in place of the row list.
3. **Given** today has paid tickets and the user toggles the period to Week or Month, **When** the toggle settles, **Then** the recent-transactions feed continues to show today's tickets — the feed is pinned to today and is not affected by the period toggle.
4. **Given** a ticket row is rendered, **When** the user reads it, **Then** the row shows: time of `closed_at` in the salon's local timezone, a service-summary string (one or two services comma-separated, three-or-more rendered as `{first}, +N more`), the assigned technicians as stacked avatars, the payment method as a pill, and the total in dollars. The client column is not rendered (see FR-023).

---

### Edge Cases

- **Discarded tickets** (`tickets.status = 'discarded'`) are excluded from every count, every revenue total, the payment-mix bar, and the recent-transactions feed.
- **Open tickets** (`tickets.status = 'open'`) are excluded from every count, every revenue total, and the recent-transactions feed — the dashboard only counts what has actually closed and been paid.
- **Discount line items** (`ticket_items.kind = 'discount'`) are excluded from the Services count — they reduce the subtotal but are not a service rendered.
- **Refunded payments**: the current schema has no refund concept yet (no `refunded` ticket status, no `refunded` payment status). When refund support lands later, refunded amounts must be subtracted from Revenue and from the Payment-mix card; this feature must not block that addition.
- **Failed or pending payments** (`payments.status != 'succeeded'`) are excluded from Revenue, Tips, and the Payment-mix card.
- **Tips today are always `$0.00`** until card-payment tips ship — `payments.tip_cents` is currently zero in production. The Tips tile must render `$0.00` honestly without hiding the tile or showing a placeholder. Local development seeds non-zero `tip_cents` on a few tickets so the tile is visually verifiable end-to-end before card tips land.
- **Empty period**: every numeric tile renders `0` or `$0`, the Payment-mix bar renders a single neutral segment, the Tips tile drops the tip-percent sub-line, and the recent-transactions feed shows an empty-state message.
- **Salon-timezone first-run**: when a fresh database has no `salon.timezone` setting row, the dashboard must not crash. The bootstrap path inserts the default before the dashboard reads, and the dashboard read also tolerates a missing row by falling back to the default rather than throwing.
- **Settings cache after timezone change**: if an operator changes `salon.timezone` (via the settings surface that will exist in a future feature), the dashboard must read the new value on its next render — no stale cache that would mis-bucket "today".
- **Slow or unreachable Supabase**: the dashboard renders a graceful loading state during the first render and a calm error state (not a stack trace, not a blank page) when the aggregate query fails; the page is still navigable away via the studio shell.
- **Period boundary crossings**: when a payment is captured a few seconds before midnight in the salon's local timezone and the page is opened just after midnight, the captured payment must appear in *yesterday*'s Today aggregate (i.e. it does not appear in today's Today), because today's window starts at the new local midnight.
- **Multiple-day windows that span a daylight-savings transition** must remain consistent — the Week and Month aggregates use the salon's local-time calendar boundaries, not 7×24h / 30×24h spans.

## Requirements *(mandatory)*

### Functional Requirements — data layer

- **FR-001**: The dashboard MUST source every numeric value on the page (the four headline tiles, the Payment-mix card, the recent-transactions feed, and the header subtitle's date and last-sale time) from live Supabase queries against `tickets`, `ticket_items`, `payments`, `staff`, and `services`. The in-repo mock dataset and the hard-coded `PERIOD_FACTOR` multipliers MUST be removed.
- **FR-002**: `Transactions` MUST equal the count of tickets with `status = 'paid'` whose `closed_at` falls inside the active period window.
- **FR-003**: `Services` MUST equal the sum of `qty` across `ticket_items` whose parent ticket is paid in the window AND whose `kind` is not `'discount'`.
- **FR-004**: `Revenue` MUST equal the sum of `payments.amount_cents` (plus `payments.tip_cents` if any) for payments with `status = 'succeeded'` whose parent ticket is paid in the window. The tile MUST render the cents-precise total formatted as whole-dollar US currency.
- **FR-005**: `Tips` MUST equal the sum of `payments.tip_cents` across the same payment set as Revenue. Until card-payment tips ship, this MUST honestly render `$0.00` in production rather than showing a placeholder or hiding the tile.
- **FR-006**: The Payment-mix card MUST group successful payment totals (amount + tip) by `payments.method` and render three labelled rows (Card, Cash, Gift card) plus a proportional bar whose segments sum to the period's Revenue. Methods not represented in the data MUST still appear in the legend with `$0`.
- **FR-007**: The dashboard MUST compute period windows in the salon's local timezone using calendar boundaries:
  - `Today` = `[today_00:00, now]`
  - `Week` = `[most_recent_monday_00:00, now]` (week starts Monday)
  - `Month` = `[first_of_current_month_00:00, now]`
- **FR-008**: The dashboard MUST read the salon's local timezone from the `public.settings` key `salon.timezone`. The value is a string IANA timezone identifier (e.g. `America/Los_Angeles`). If the row is missing, the dashboard MUST fall back to the seeded default rather than throwing.
- **FR-009**: A data migration MUST seed `public.settings` with `('salon.timezone', '"America/Los_Angeles"')` on first run, idempotently (no overwrite if the row already exists). No schema migration is needed — `public.settings` is already a generic key/value table.

### Functional Requirements — header and feed

- **FR-010**: The header subtitle MUST render `{weekday}, {Month} {day} · Last sale {time}` where `{weekday}`, `{Month} {day}`, and `{time}` are derived from real data in the salon's local timezone. When today has zero successful payments, the subtitle MUST collapse to `{weekday}, {Month} {day}` (the `Last sale …` clause is omitted). The previous `· N techs on shift` clause MUST be removed.
- **FR-011**: The recent-transactions feed MUST show every ticket with `status = 'paid'` and `closed_at` inside *today*'s window in the salon's local timezone, ordered by `closed_at` descending. The feed is pinned to today and MUST NOT change when the period toggle moves to Week or Month.
- **FR-012**: The recent-transactions feed container MUST scroll vertically inside its existing layout slot when the row list overflows; the rest of the page MUST NOT grow vertically and MUST NOT introduce horizontal scrolling.
- **FR-013**: When today has zero paid tickets, the recent-transactions feed MUST render a calm empty-state message in place of the row list (sample copy: `No sales yet today`). The feed's header and `View all` control remain visible.
- **FR-014**: Each recent-transactions row MUST render: time from `closed_at` in salon-local timezone (12-hour with AM/PM); a service-summary string built from `ticket_items.name_snapshot` filtered to `kind != 'discount'` (one or two services comma-separated; three-or-more rendered as `{first}, +N more` — discount items never contribute to this count and never push other services into the collapse); assigned technicians as stacked avatars from `ticket_items.assigned_staff_id` joined to `staff` over the same non-discount item set; a payment-method pill (see FR-014a); and the ticket's `total_cents` formatted as US currency. The client column is intentionally not rendered — see FR-023.
- **FR-014a**: The payment-method pill MUST render the single method's pill (`card` / `cash` / `gift`) when all successful payments on the ticket share one method, and a new `Split` pill variant when the ticket's successful payments span two or more methods. The `Split` pill MUST follow the existing `.tx-meth-pill` chrome (same shape, same Lacquer token surface) with a visually distinct but neutral color. The pill takes the same cell as the single-method pill — no row-layout change.

### Functional Requirements — visual contract

- **FR-015**: The dashboard MUST continue to render the Variation B Stats-rich layout from 002: a header band, a six-column stat grid (four headline tiles spanning one column each, Payment-mix spanning two), and a lower split with quick actions on the left and the recent-transactions feed on the right.
- **FR-016**: The dashboard MUST continue to display a primary `New transaction` CTA in the header and the four secondary quick-action buttons (`Today's calendar`, `Quick walk-in`, `Day report (X-out)`, `End-of-day cash`) with their existing routes. The lower-left column MUST become a single Quick-Actions stack — see FR-019 (techs-on-shift removal).
- **FR-017**: All visual values (color, spacing, radius, shadow, type) MUST continue to trace to Lacquer tokens in `styles/tokens.css`. No raw hex codes, off-scale spacing, or custom font weights are permitted.
- **FR-018**: The dashboard MUST continue to use Lucide icons at 1.5px stroke (sized 14/16/18/20/24) — no emoji in chrome.

### Functional Requirements — intentional visual deltas vs. 002

- **FR-019**: The `Techs on shift` tile and its `Techs on shift` label MUST be removed from the dashboard. A real "on shift" concept does not exist in the schema yet; rather than display a fake one (the previous behaviour listed the entire active roster), the tile is removed and the concept is deferred to a future feature. The lower-left column's width and column ratio MUST NOT change.
- **FR-020**: The per-tile comparison strings on Today (`+3 vs avg` on Transactions and `+12%` on Revenue) MUST be removed from the stat tiles. The badge slot collapses with no placeholder. Real period-over-period comparisons are deferred to a future feature; rendering fabricated comparisons is one of the bugs this feature is closing.
- **FR-021**: The header subtitle's `· N techs on shift` clause MUST be removed (see FR-010). The subtitle's other components (weekday, date, last-sale time) remain.
- **FR-022**: The recent-transactions feed's previous 7-row cap MUST be removed (see FR-011 and FR-012). The feed now shows every paid ticket from today in a scrollable container.
- **FR-023**: The recent-transactions feed's `client` column MUST be removed from each row. The current schema has no `clients` table and every paid ticket is created with `appointment_id: null` (no client linkage), so there is no truthful name to display for v1. The row's identifying columns become the service-summary string and the assigned-tech avatar stack. The CSS grid for `.tx-feed-row` collapses from six columns to five (time, service, techs, method pill, amount). A future client-capture feature can reintroduce the column when there is a real name to display.

### Functional Requirements — non-functional

- **FR-024**: The dashboard MUST be reachable only by an authenticated studio session; the auth-redirect contract from 002 (FR-016) is unchanged.
- **FR-025**: The dashboard MUST be read-only. No CTAs on this page perform mutations. Navigation away (via the primary CTA, the quick actions, or the studio shell) remains the only state change the page initiates.
- **FR-026**: The dashboard MUST render a graceful loading indicator during the first server fetch and a calm error state (no stack trace, no blank page) when an aggregate query fails. The page MUST remain navigable away via the studio shell in either state.
- **FR-027**: The dashboard MUST be fully dynamic — every navigation to the dashboard route MUST re-query Supabase for fresh aggregates. No route-level cache, no `revalidate` window, no stale-while-revalidate. The dashboard MUST NOT subscribe to realtime updates either; refresh happens only on navigation. Realtime is deferred to a future feature.

### Key Entities *(include if feature involves data)*

- **DashboardPeriod** (read-model): One of `today`, `week`, `month`. Drives every numeric value on the page except the recent-transactions feed (which is pinned to today).
- **DashboardSummary** (read-model): The aggregated numbers for a given period — transaction count, services count, revenue, tips, and the `byMethod` breakdown (`card`, `cash`, `gift`). Derived live from `tickets` + `ticket_items` + `payments`.
- **TransactionRow** (read-model for the feed): A single paid ticket's display projection — time from `closed_at`, a service-summary string from `ticket_items.name_snapshot`, the assigned techs from `ticket_items.assigned_staff_id`, the dominant payment method, and the total in dollars. No client name (see FR-023).
- **SalonTimezone** (settings): The IANA timezone identifier used to compute calendar windows and to format times on the page. Stored on the existing `public.settings` key/value table under the key `salon.timezone`. Default `America/Los_Angeles` (the salon's address per the seeded `salon.address` row).
- **Staff** (read-only here): The roster joined into the recent-transactions feed for tech avatars. Unchanged from existing schema.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of numeric values on the dashboard (the four headline tiles, the Payment-mix card totals, and the recent-transactions feed) are derived from live Supabase queries against the real ticket / payment / service tables. Zero hard-coded numbers, zero in-repo mock dataset usage, zero `PERIOD_FACTOR`-style extrapolation.
- **SC-002**: When a paid ticket is created in the database, it appears on the dashboard's Today tiles, the Payment-mix card, and the recent-transactions feed on the next page render — no manual refresh of fixtures, no edit to a mock-data file, no rebuild required.
- **SC-003**: Switching the period toggle updates every tile to the correct calendar-window aggregate within **200 ms** of perceived latency (excluding initial page load), and 100% of switches show fully recalculated values with no stale tiles.
- **SC-004**: With zero paid tickets in the selected period, every numeric tile shows `0` or `$0`, the Payment-mix bar renders without crashing or showing `NaN`, and the recent-transactions feed shows an empty-state message — verified by an end-to-end test that seeds an empty database.
- **SC-005**: Server-side render of the dashboard completes within **300 ms p95** under typical load (a single salon's ticket history, < 100 tickets per day, < 3000 tickets per month).
- **SC-006**: The dashboard route renders correctly across viewport widths from 720 px to 1440 px wide without horizontal scrolling and without truncating numeric tile values.
- **SC-007**: A side-by-side comparison with the prototype-and-002 visual baseline passes the `speckit-design-auditor` spot-check **except** for the five intentional deltas in FR-019, FR-020, FR-021, FR-022, FR-023 — those deltas are explicitly approved scope rather than violations.
- **SC-008**: The salon's local timezone, as stored in `public.settings.salon.timezone`, governs every "today" / "this week" / "this month" boundary on the page — verified by changing the setting and confirming the dashboard's day boundary shifts on the next render.

## Assumptions

- The visual baseline (layout, tokens, type, icon usage, copy tone) is `specs/002-dashboard-page/spec.md` and the corresponding implementation under `app/(studio)/dashboard/` and `components/lacquer/`. This feature preserves the contract except for the five intentional deltas in FR-019–FR-023, plus one additive: the new `Split` payment-pill variant introduced by FR-014a (split tender wasn't representable in 002's mock data; the pill follows the existing `.tx-meth-pill` chrome and adds a single neutral-color variant).
- The salon's local timezone default is `America/Los_Angeles`, derived from the seeded `salon.address` row (`218 Hayes St · San Francisco, CA` in `0007_cart_polish.sql`). If the salon's operating timezone differs, the operator overrides it later via the settings surface (separate feature) and the dashboard picks up the new value on its next render.
- `public.settings` is already an existing key/value table (`key text primary key`, `value jsonb`) from migration `0007_cart_polish.sql`. Adding the salon timezone requires only an idempotent data INSERT; no schema migration to the table itself.
- The `tickets`, `ticket_items`, `payments`, `staff`, and `services` tables (from migrations `0001`, `0003`, `0004`, `0006`, `0007`) are the authoritative read source. No new tables are introduced.
- Tip data lives on `payments.tip_cents` and is always `0` in production until card-payment tips ship via the Square Terminal feature on the parallel branch. This feature reads the field truthfully (showing `$0.00`) rather than hiding the tile or rendering placeholder data. Local development seeds non-zero `tip_cents` on a few tickets so the tile is visually verifiable end-to-end before card tips land.
- Refunds are not in the schema today (no `refunded` ticket status, no `refunded` payment status). When a refunds feature lands, refunded amounts will be subtracted from Revenue and from the Payment-mix card — this feature's data shape leaves room for that addition without rework.
- Discarded tickets and any payment that is not `status = 'succeeded'` are excluded from all aggregates and from the recent-transactions feed.
- Discount ticket-items (`ticket_items.kind = 'discount'`) reduce the ticket total but are excluded from the Services count, because they are not a service rendered.
- "Techs on shift" is intentionally removed as a concept on this page. A future feature will reintroduce the tile with a real shift definition (e.g. driven by a `shifts` table or by per-day staff scheduling). The dashboard's lower-left column collapses to the existing Quick-Actions stack with no width change.
- Period-over-period comparisons (the `+3 vs avg`, `+12%` badges) are removed. A future feature may reintroduce them with real historical baselines (e.g. trailing-4-week average for "vs avg", same-period-last-week for "%"); the current feature explicitly does not compute or render them.
- The `View all` link in the recent-transactions feed remains inert — no `/transactions` route is being added. The link stays in the DOM so the chrome matches 002 and the route can light up in a future feature.
- The dashboard is read-only and re-fetches on navigation. Realtime / live updates are deferred — a future feature can wire Supabase Realtime to invalidate the cache without changing the spec surface.
- The Square Terminal feature on the parallel branch (`015-square-terminal-payment` in the main checkout) will introduce a card payment method and tip support on `payments`. This feature's data shape and queries already account for `method` values beyond `'cash'`, so card sales will appear in the dashboard automatically once the schema enum is extended and the Terminal feature writes those rows.
- Performance target (SC-005, p95 < 300 ms server-side render) is appropriate for the dashboard's role as the post-login landing surface and is achievable with index-supported aggregate queries against the existing schema for a single-salon dataset.
