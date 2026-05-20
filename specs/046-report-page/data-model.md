# Phase 1 — Data Model: Report Page

**Feature**: 046-report-page · **Date**: 2026-05-20

This feature is **read-only**. It introduces **no** database tables, columns,
enums, RPCs, indexes, or migrations. Every column it reads already exists
(checkout `0004`, services-deductions `0016`, supply-types `0017`, staff
payout-exemptions `0018`). This document describes (1) the existing tables it
reads, (2) the deduction & tip math, (3) the in-memory read model the server
projects, and (4) the period-window model.

---

## 1. Source tables (existing — read only)

All carry `select to authenticated using (true)` RLS; read through the
cookie-aware Supabase server client.

### `public.tickets`

| Column | Used as |
|--------|---------|
| `id` (uuid) | transaction identity; bucketing key |
| `status` (enum) | filter — only `'paid'` rows are reported |
| `closed_at` (timestamptz) | window filter; transaction time; day grouping |

Filter: `status='paid' AND closed_at >= window.start AND closed_at < window.end`.

### `public.ticket_items`

| Column | Used as |
|--------|---------|
| `ticket_id` (uuid) | bucket items onto their transaction |
| `kind` (enum `service`/`discount`/`product`) | **only `service` is reported** (FR-009) |
| `ref_id` (uuid → services, null on discount) | join key for deduction config |
| `name_snapshot` (text) | service name in the detail view + breakdown |
| `unit_price_cents` (int) | gross earnings (price snapshot — historically accurate) |
| `qty` (int) | per-unit deduction multiplier; service count |
| `assigned_staff_id` (uuid → staff, null on discount) | the performing technician (FR-008) |

### `public.payments`

| Column | Used as |
|--------|---------|
| `ticket_id` (uuid) | bucket payments onto their transaction |
| `method` (enum `card`/`cash`/`gift`) | *card-settled* test; card-tip filter |
| `status` (enum) | filter — only `'succeeded'` rows count |
| `tip_cents` (int) | card tip = Σ over `method ∈ {card,gift}` |

### `public.staff`

| Column | Used as |
|--------|---------|
| `id` (uuid) | resolve performing-tech identity |
| `display_name` (text) | row label |
| `role` (text) | **only** gates page access (FR-002) — never filters report rows (FR-008a) |
| `color_token` (text) | avatar color |
| `card_fee_exempt` (bool) | skip card-fee deduction for this tech (FR-016) |
| `supply_mode` (text `apply`/`partial`/`exempt`) | supply-deduction policy (FR-017) |
| `supply_except` (uuid[]) | supply-type ids skipped when `supply_mode='partial'` |

Staff are fetched **by id for the window's performers, without the `active`
filter** — a removed tech still appears in past periods (R8).

### `public.services`

| Column | Used as |
|--------|---------|
| `id` (uuid) | join target for `ticket_items.ref_id` |
| `card_fee_mode` (text `default`/`custom`/`exempt`) | per-service card-fee rule |
| `card_fee_custom_cents` (int, null unless custom) | custom card fee |
| `supply_amount_cents` (int, null when no supply) | per-service supply cost |
| `supply_type_id` (uuid → supply_types, null when no supply) | matched against `staff.supply_except` |

Deduction config is read **live** (R2) — not snapshotted.

---

## 2. Deduction & tip math (pure — `lib/report/aggregate.ts`)

### 2.1 Per-transaction facts

For a paid ticket `tx` with succeeded payments `P`:

- `isCardSettled(tx)` = `P.some(p => p.method === 'card' || p.method === 'gift')`.
- `cardTipCents(tx)` = `Σ p.tip_cents` over `p ∈ P` with `p.method ∈ {card,gift}`.
- `method(tx)` = `deriveMethod(P)` — single method, or `'split'` for ≥2 distinct
  (reuses the Transactions/dashboard `deriveMethod`).
- Service items only: `S = tx.items.filter(i => i.kind === 'service')`.

### 2.2 Effective per-unit card fee for a service

```
effectiveCardFeeCents(service):
  service missing            → DEFAULT_CARD_FEE_CENTS   (R12)
  card_fee_mode === 'exempt' → 0
  card_fee_mode === 'custom' → card_fee_custom_cents ?? 0
  otherwise ('default')      → DEFAULT_CARD_FEE_CENTS    (300)
```

### 2.3 Per-service-line deduction (for one item `i`, performed by tech `t`)

```
gross(i)      = i.unit_price_cents * i.qty
cardFee(i)    = (isCardSettled(tx) && !t.card_fee_exempt)
                  ? effectiveCardFeeCents(service(i)) * i.qty : 0
supplyApplies = service(i).supply_amount_cents != null && (
                  t.supply_mode === 'apply'  ||
                  (t.supply_mode === 'partial' &&
                   !t.supply_except.includes(service(i).supply_type_id)))
supply(i)     = supplyApplies ? service(i).supply_amount_cents * i.qty : 0
```

Each non-zero `cardFee(i)` / `supply(i)` also emits a **deduction line**
(`{ type, serviceName, amountCents }`) for the expand row (FR-026).

### 2.4 Tip split (per transaction)

```
txServiceSubtotal = Σ gross(i)  over i ∈ S
techSubtotal(t)   = Σ gross(i)  over i ∈ S where i.assigned_staff_id === t
```

`cardTipCents(tx)` is divided across the transaction's distinct technicians by
the **largest-remainder method** weighted by `techSubtotal(t) / txServiceSubtotal`
— floor each share, then distribute leftover cents to the largest remainders.
`Σ shares === cardTipCents(tx)` exactly (R4). `txServiceSubtotal === 0` → all
shares 0.

### 2.5 Invariants

- `commissionableCents = grossCents − totalDeductionsCents` per tech and in
  total (FR-012). Never presented as a payout (the commission split is out of
  scope).
- `totalDeductionsCents = cardFeeCents + supplyCents`.
- Totals row: every grand total === Σ of that column across tech rows (SC-002).
- `hasNoDeductions` (a tech) ⇔ `totalDeductionsCents === 0` (R7).
- Period `transactionCount` = distinct paid tickets in the window (R9) — **not**
  Σ per-tech counts.

---

## 3. Read model (in-memory — projected server-side)

Plain serialisable objects (`lib/report/aggregate.ts`), passed from the Server
Component to the client island. **No timezone data crosses to the client** — the
server pre-formats every time string.

### `ReportDeductionLine`

| Field | Type | Source |
|-------|------|--------|
| `type` | `"card" \| "supply"` | which deduction |
| `serviceName` | `string` | `ticket_items.name_snapshot` |
| `amountCents` | `number` | `cardFee(i)` or `supply(i)` |

### `ReportTransaction` — one transaction as seen for one technician

| Field | Type | Source / Rule |
|-------|------|---------------|
| `ticketId` | `string` | `tickets.id` |
| `time` | `string` | `formatTime(closed_at, tz)` — pre-formatted, e.g. `2:45 PM` |
| `closedAtIso` | `string` | `tickets.closed_at` — sort key |
| `client` | `string` | `"Walk-in"` (v1 — no clients table) |
| `serviceNames` | `readonly string[]` | this tech's service-line names on the ticket |
| `method` | `PaymentMethod` | `deriveMethod` of the ticket's payments |
| `grossCents` | `number` | Σ `gross(i)` for this tech on this ticket |
| `cardFeeCents` | `number` | Σ `cardFee(i)` |
| `supplyCents` | `number` | Σ `supply(i)` |
| `netCents` | `number` | `grossCents − cardFeeCents − supplyCents` |
| `cardTipCents` | `number` | this tech's largest-remainder tip share |
| `tipPct` | `number \| null` | `round(cardTip / techSubtotal × 100)`; `null` when no card tip |
| `deductionLines` | `readonly ReportDeductionLine[]` | itemised lines (§2.3) |
| `isExpandable` | `boolean` | `deductionLines.length > 0 || cardTipCents > 0` (FR-026) |

### `TechnicianReport` — one technician's period aggregate (a report row)

| Field | Type | Rule |
|-------|------|------|
| `staffId` | `string` | `staff.id` |
| `displayName` | `string` | `staff.display_name` |
| `colorToken` | `string` | `staff.color_token` |
| `transactionCount` | `number` | distinct tickets this tech appears on |
| `serviceCount` | `number` | Σ `qty` of this tech's service items |
| `grossCents` | `number` | Σ `grossCents` of `transactions` |
| `cardFeeCents` | `number` | Σ `cardFeeCents` |
| `supplyCents` | `number` | Σ `supplyCents` |
| `totalDeductionsCents` | `number` | `cardFeeCents + supplyCents` |
| `commissionableCents` | `number` | `grossCents − totalDeductionsCents` |
| `cardTipsCents` | `number` | Σ `cardTipCents` |
| `hasNoDeductions` | `boolean` | `totalDeductionsCents === 0` (R7) |
| `transactions` | `readonly ReportTransaction[]` | this tech's reported transactions, newest-first |

`TechnicianReport[]` is ordered by `displayName` ascending.

### `ReportTotals` — period grand totals (totals row + summary strip)

| Field | Type | Rule |
|-------|------|------|
| `technicianCount` | `number` | `TechnicianReport[].length` |
| `transactionCount` | `number` | **distinct** paid tickets in the window (R9) |
| `serviceCount` | `number` | Σ tech `serviceCount` |
| `grossCents` | `number` | Σ tech `grossCents` |
| `cardFeeCents` | `number` | Σ tech `cardFeeCents` |
| `supplyCents` | `number` | Σ tech `supplyCents` |
| `totalDeductionsCents` | `number` | Σ tech `totalDeductionsCents` |
| `commissionableCents` | `number` | Σ tech `commissionableCents` |
| `cardTipsCents` | `number` | Σ tech `cardTipsCents` |

### `ReportReadModel` — the page payload

| Field | Type |
|-------|------|
| `technicians` | `readonly TechnicianReport[]` |
| `totals` | `ReportTotals` |
| `isEmpty` | `boolean` — `technicians.length === 0` (drives the empty state, FR-029) |

---

## 4. Window model — `lib/report/window.ts`

`ReportGranularity = "day" | "week" | "semi"`.

`ReportWindow`:

| Field | Type | Meaning |
|-------|------|---------|
| `granularity` | `ReportGranularity` | active granularity |
| `offset` | `number` | periods back from current (`0` = current; clamped `≤ 0`) |
| `start` | `Date` | inclusive UTC start |
| `end` | `Date` | exclusive UTC end |
| `isCurrent` | `boolean` | `offset === 0` — disables the "next" arrow |
| `label` | `string` | e.g. `"Today"`, `"Last week"`, `"This pay period"` |
| `rangeLabel` | `string` | e.g. `"May 11, 2026"`, `"May 5 – 11, 2026"`, `"May 1 – 15, 2026"` |

- `parseReportPeriodParams({period, offset})`: invalid/missing `period` →
  `"day"` (FR-004 default); non-integer `offset` → `0`; positive `offset`
  clamps to `0` (forward stepping forbidden — FR-005 / Edge Case "Future
  period").
- `resolveReportWindow(tz, granularity, offset, now)` dispatches to
  `dayWindowAt` / `weekWindowAt` / `semiMonthlyWindowAt` (the last is **new** in
  `lib/time/period-windows.ts`) and builds the labels.
- **Semi-monthly**: `offset 0` is the half-month containing `now` — `[1st,
  16th)` when `day(now) ≤ 15`, else `[16th, 1st-of-next-month)`. Stepping moves
  by whole half-months across month boundaries (R1).

---

## 5. Validation & invariants

- **Only paid tickets** — `status='paid'` filtered at the query.
- **Only succeeded payments** — `status='succeeded'`.
- **Only service items reported** — `kind='service'`; discounts/products dropped.
- **Forward stepping clamps** — `offset ≤ 0`; "next" disabled when `isCurrent`.
- **Empty windows are valid** — no service items → `isEmpty: true`, empty state.
- **Money is server-authoritative** — gross derives from snapshotted
  `unit_price_cents`; the client formats, never recomputes.
- **Read-only** — no writes, no `audit_log` rows, no state transitions.
</content>
