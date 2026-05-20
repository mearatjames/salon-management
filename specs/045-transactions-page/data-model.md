# Phase 1 Data Model: Transactions Page

**Feature**: 045-transactions-page · **Date**: 2026-05-19

This feature is **read-only**. It introduces **no** database tables, columns,
enums, RPCs, or migrations. This document describes (a) the existing tables it
reads and (b) the in-memory read model the query layer projects for the UI.

---

## 1. Source tables (existing — read only)

All tables already exist and carry `select to authenticated using (true)` RLS.
The query layer reads them through the cookie-aware Supabase server client.

### `public.tickets`

| Column | Used as |
|--------|---------|
| `id` (uuid) | transaction identity; `data-tx-id`; source of the display ID |
| `status` (enum) | filter — only `'paid'` rows are transactions |
| `subtotal_cents` (int) | receipt subtotal; KPI revenue base |
| `tax_cents` (int) | carried into `totalCents` math (always `0`; not shown in the UI) |
| `total_cents` (int) | cross-check (`= subtotal + tax`) |
| `closed_by_staff_id` (uuid → staff) | the cashier shown in the receipt drawer |
| `closed_at` (timestamptz) | transaction time; day grouping; window filter |

Filter: `status = 'paid' AND closed_at >= window.start AND closed_at < window.end`.

### `public.ticket_items`

| Column | Used as |
|--------|---------|
| `ticket_id` (uuid → tickets) | bucketing items onto their transaction |
| `kind` (enum `service`/`discount`/`product`) | line classification |
| `ref_id` (uuid → services) | join key for line-item category |
| `name_snapshot` (text) | line item name (always shown) |
| `unit_price_cents` (int) | line price |
| `qty` (int) | line quantity; "services rendered" KPI |
| `assigned_staff_id` (uuid → staff) | per-line tech; row tech stack |

### `public.payments`

| Column | Used as |
|--------|---------|
| `ticket_id` (uuid → tickets) | bucketing payments onto their transaction |
| `method` (enum `card`/`cash`/`gift`) | per-transaction method; `split` derived |
| `status` (enum) | filter — only `'succeeded'` rows count |
| `amount_cents` (int) | payment amount in the receipt drawer |
| `tip_cents` (int) | tip total; "tips collected" KPI |

### `public.staff`

`id`, `display_name`, `color_token`, `active` — resolves tech IDs and the
cashier to display names + avatar colors. Reuses the dashboard's
`queryStaffRoster` shape (`Technician`).

### `public.services`

`id`, `category` — joined via `ticket_items.ref_id` to label each service
line's category in the receipt drawer.

### `public.settings`

`salon.timezone` — read via the existing `getSalonTimezone` helper; all day
windowing and time formatting are salon-local.

---

## 2. Read model (in-memory — projected by the query layer)

Defined in `lib/transactions/aggregate.ts`. Plain serialisable objects passed
from the Server Component to the client island. **No timezone data crosses to
the client** — the server pre-formats every time string and day key.

### `PaymentMethod`

Reuses `type PaymentMethod = "card" | "cash" | "gift" | "split"` from
`lib/dashboard/aggregate.ts` — single source of truth, also what `<MethodPill>`
consumes.

### `TransactionLineItem`

| Field | Type | Source |
|-------|------|--------|
| `name` | `string` | `ticket_items.name_snapshot` |
| `category` | `string \| null` | `services.category` via `ref_id`; `null` for non-service / deleted |
| `kind` | `"service" \| "discount" \| "product"` | `ticket_items.kind` |
| `qty` | `number` | `ticket_items.qty` |
| `unitPriceCents` | `number` | `ticket_items.unit_price_cents` |
| `lineTotalCents` | `number` | `unit_price_cents * qty` (derived) |
| `techId` | `string \| null` | `ticket_items.assigned_staff_id` |

### `TransactionPayment`

| Field | Type | Source |
|-------|------|--------|
| `method` | `"card" \| "cash" \| "gift"` | `payments.method` (succeeded only) |
| `amountCents` | `number` | `payments.amount_cents` |
| `tipCents` | `number` | `payments.tip_cents` |

### `TransactionDetail`

The per-transaction row + drawer payload.

| Field | Type | Source / Rule |
|-------|------|---------------|
| `id` | `string` | `tickets.id` (raw UUID — `data-tx-id`, drawer key) |
| `displayId` | `string` | `formatTxId(id)` → `#` + last 6 hex, uppercase |
| `client` | `string` | `"Walk-in"` (v1 — no clients table; see research R5) |
| `closedAtIso` | `string` | `tickets.closed_at` ISO (drawer activity line) |
| `time` | `string` | `formatTime(closed_at, tz)` — pre-formatted, e.g. `2:45 PM` |
| `dayKey` | `string` | `salonDateString(tz, closed_at)` → `YYYY-MM-DD`, the day-group key |
| `techIds` | `readonly string[]` | distinct non-discount `assigned_staff_id`, first-seen order |
| `items` | `readonly TransactionLineItem[]` | all `ticket_items` for the ticket |
| `payments` | `readonly TransactionPayment[]` | succeeded `payments` for the ticket |
| `method` | `PaymentMethod` | `deriveMethod(payments)` — single method, or `split` for ≥2 distinct |
| `subtotalCents` | `number` | `tickets.subtotal_cents` |
| `taxCents` | `number` | `tickets.tax_cents` — always `0`; used only for `totalCents`, not displayed (spec Assumptions / Constitution V) |
| `tipCents` | `number` | Σ `payments.tip_cents` |
| `totalCents` | `number` | `subtotalCents + taxCents + tipCents` (revenue incl. tip) |
| `serviceCount` | `number` | Σ `qty` over non-discount items |
| `cashierName` | `string \| null` | `staff.display_name` for `closed_by_staff_id` |

**Sort**: `closedAtIso` descending (newest first), matching `queryTodayFeed`.

### `TransactionKpis`

Computed by `computeKpis(transactions)` — **pure**, run client-side over the
*filtered* set so the strip tracks active filters (prototype behaviour).

| Field | Type | Rule |
|-------|------|------|
| `count` | `number` | number of transactions |
| `grossRevenueCents` | `number` | Σ `totalCents` |
| `servicesRendered` | `number` | Σ `serviceCount` |
| `tipsCents` | `number` | Σ `tipCents` |
| `avgTicketCents` | `number` | `count > 0 ? grossRevenueCents / count : 0` |
| `avgServicesPerSale` | `number` | `count > 0 ? servicesRendered / count : 0` |

The "vs previous period" delta is **not** part of `TransactionKpis`: the server
supplies a single `previousPeriodCount` number (from `queryPeriodCount` over
the previous window); the strip computes
`deltaPct = previousPeriodCount > 0 ? round((count − previousPeriodCount) / previousPeriodCount × 100) : null`.

### `DayGroup`

Produced client-side by `groupByDay(transactions)` for the table.

| Field | Type | Rule |
|-------|------|------|
| `dayKey` | `string` | `YYYY-MM-DD` |
| `transactions` | `readonly TransactionDetail[]` | that day's rows, newest-first |
| `count` | `number` | `transactions.length` |
| `revenueCents` | `number` | Σ `totalCents` |
| `tipsCents` | `number` | Σ `tipCents` |

Groups are ordered by `dayKey` descending.

---

## 3. Window model

`PeriodGranularity = "today" | "week" | "month"`.

`PeriodWindow` (from `lib/transactions/window.ts`):

| Field | Type | Meaning |
|-------|------|---------|
| `granularity` | `PeriodGranularity` | active granularity |
| `offset` | `number` | periods back from current (`0` = current; clamped `≤ 0`) |
| `start` | `Date` | inclusive UTC start of the period |
| `end` | `Date` | exclusive UTC end of the period |
| `isCurrent` | `boolean` | `offset === 0` — disables the "next" arrow |
| `label` | `string` | e.g. `"This week"`, `"Last week"`, `"Week of May 5"` |
| `rangeLabel` | `string` | e.g. `"May 12, 2026"` or `"May 5 – 11, 2026"` |

---

## 4. Validation & invariants

- **Only paid tickets are transactions** — `status = 'paid'` is filtered at the
  query; `open` / `discarded` tickets never appear.
- **Only succeeded payments count** — `payments.status = 'succeeded'`; mirrors
  the dashboard aggregator.
- **Money is server-authoritative** — `subtotalCents` / `taxCents` come
  straight from `tickets`; `tipCents` is summed from `payments`. The client
  formats, never recomputes, monetary truth.
- **Forward stepping clamps at the current period** — `offset` can never be
  positive; `window.ts` clamps and the "next" control is disabled when
  `isCurrent`.
- **Empty windows are valid** — a period with no paid tickets yields an empty
  `TransactionDetail[]`; the UI shows the empty state, KPIs read zero.
- **No state transitions** — read-only feature; transactions are immutable
  from this page's perspective.
