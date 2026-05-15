# Data Model: Dashboard (Front-Desk Landing)

**Feature**: 002-dashboard-page
**Date**: 2026-05-14

## Summary

The dashboard renders display projections of an in-repo mock dataset; it
introduces **no persistent entities, no migrations, no schema**. The
`tickets` / `payments` / `staff` / `services` tables defined in
`docs/system-design.md` are out of scope and remain unbuilt at the end of this
feature.

What this document describes are the **read-models** the page assembles in
memory: typed TypeScript shapes that the page passes from server → server
component → optional client island. They live in `lib/dashboard/` and are the
public surface the later Supabase-wiring feature must preserve.

Every entity name below matches a Key Entity in `spec.md`.

---

## Source data (mock-only)

`lib/dashboard/mock-data.ts` is a verbatim TypeScript port of
`design-system/prototypes/transaction/data.jsx`. It exports four raw shapes
the rest of the module consumes.

### `Service`

| Field        | Type                          | Notes                                    |
|--------------|-------------------------------|------------------------------------------|
| `id`         | `string` (kebab-case slug)    | Stable identifier; match against `TxLineItem.id` to resolve a label. |
| `name`       | `string`                      | Human-readable service name.             |
| `cat`        | `"Manicure" \| "Pedicure" \| "Enhancement" \| "Add-ons" \| "Waxing" \| "Removal"` | Category bucket. Not rendered by the dashboard. |
| `time`       | `number`                      | Default duration in minutes. Not rendered. |
| `price`      | `number`                      | Default unit price (USD). Used only when the transaction line has no explicit `price`. |
| `variable?`  | `boolean`                     | Indicates per-booking pricing. Not rendered by the dashboard. |
| `priceFrom?` | `number`                      | Lower anchor for "from $X" labels. Not rendered by the dashboard. |
| `priceTo?`   | `number`                      | Upper anchor. Not rendered by the dashboard. |
| `presets?`   | `{ label: string; price: number }[]` | Quick-pick options. Not rendered. |
| `promo?`     | `boolean`                     | Promo flag. Not rendered.                |
| `note?`      | `string`                      | Free-form note. Not rendered.            |

**Validation**: `id` matches `/^[a-z][a-z0-9-]+$/`; `price ≥ 0`; if `priceFrom`
present then `priceTo ≥ priceFrom`.

### `Technician`

| Field    | Type     | Notes                                                                 |
|----------|----------|-----------------------------------------------------------------------|
| `id`     | `string` | Kebab slug; stable identifier used in `Transaction.techs` and avatar stacks. |
| `name`   | `string` | Short display name (`"Maya P."`).                                     |
| `full`   | `string` | Full name (`"Maya Patel"`); first token becomes the chip label.       |
| `tone`   | `number` | OKLCH hue (0–360); drives the avatar background and foreground.       |
| `initials` | `string` (derived) | Two-letter uppercase initials computed from `full` at module load. |

**Validation**: `id` matches `/^[a-z][a-z0-9-]+$/`; `tone` ∈ `[0, 360)`;
`initials.length === 2`.

**Lifecycle**: For v1, every entry in `STAFF` is considered "on shift" — there
is no scheduling join (spec assumption #6). The "Techs on shift" tile renders
the entire list.

### `Transaction` (one row of `TX_HISTORY`)

| Field    | Type                                      | Notes                                                                            |
|----------|-------------------------------------------|----------------------------------------------------------------------------------|
| `id`     | `string` (`"tx-####"`)                    | Stable identifier for React keys.                                                |
| `time`   | `string` (`"H:MM AM"`)                    | Display time of sale. Already-formatted; no timezone math on the dashboard.      |
| `client` | `string`                                  | Client name, or `"Walk-in"` for unbooked sales. Truncated with ellipsis in feed. |
| `techs`  | `Technician.id[]`                         | One or more tech ids performing the service. Rendered as an overlap stack of avatars. |
| `items`  | `TxLineItem[]`                            | One or more services purchased.                                                  |
| `tipPct` | `number` ∈ `[0, 1]`                       | Tip as fraction of subtotal.                                                     |
| `method` | `"card" \| "cash" \| "gift"`              | Payment method. Drives the method-pill color and the payment-mix bucket.         |

**Ordering invariant**: `TX_HISTORY` is sorted oldest-first; the feed renders
`TX_HISTORY.slice(-7).reverse()` to display most-recent-first.

### `TxLineItem`

| Field    | Type     | Notes                                                                                |
|----------|----------|--------------------------------------------------------------------------------------|
| `id`     | `Service.id` | Foreign key into `SERVICES`.                                                     |
| `qty`    | `number ≥ 1` | Defaults to `1` when absent.                                                     |
| `price?` | `number ≥ 0` | Optional per-line override. When absent, the resolver falls back to `Service.price`. |

---

## Derived read-models (what the page actually renders)

These shapes live in `lib/dashboard/aggregate.ts` and `lib/dashboard/format.ts`
and are the **only types crossing the page boundary**. They are stable; the
later Supabase-wiring feature must produce identical shapes from the live
tables.

### `DashboardPeriod`

```ts
type DashboardPeriod = "today" | "week" | "month";
```

- The user-selected reporting window. Drives every numeric tile on the page.
- The active value is held by the client island `<PeriodToggle />`; the page
  renders all three precomputed `DashboardSummary` values and `<PeriodSummary
  />` selects between them on toggle (zero round-trip).

### `DashboardSummary`

A single period's aggregate. The Server Component precomputes one of these for
each of `today`, `week`, `month` at request time.

| Field           | Type                                          | Rendered as                          |
|-----------------|-----------------------------------------------|--------------------------------------|
| `period`        | `DashboardPeriod`                             | (identifier only — not rendered)     |
| `count`         | `number` (integer)                            | Transactions card value              |
| `services`      | `number` (integer)                            | Services card value                  |
| `subtotal`      | `number` (USD)                                | Hidden — used to compute tip %       |
| `tip`           | `number` (USD)                                | Tips card value (`$1,240`)           |
| `tax`           | `number` (USD)                                | Hidden — used inside `total`         |
| `total`         | `number` (USD)                                | Revenue card value (`$1,240`)        |
| `byMethod`      | `{ card: number; cash: number; gift: number }` (USD per method) | Payment-mix bar segments + legend rows |
| `avgServicesPerSale` | `number` (one decimal place)             | Services card sub-line (`1.4/sale`)  |
| `tipPctAvg`     | `number` (integer 0–100)                      | Tips card sub-line (`18% avg`)       |

**Validation invariants** (asserted by Vitest):
- `count >= 0`, `services >= 0`, `total >= 0`, `tip >= 0`, `tax >= 0`, `subtotal >= 0`.
- `byMethod.card + byMethod.cash + byMethod.gift ≈ total` (within `$0.01`).
- When `count === 0` (FR-018): all numeric fields are `0`, `byMethod` is
  `{ card: 0, cash: 0, gift: 0 }`, `avgServicesPerSale === 0`,
  `tipPctAvg === 0`. The payment-mix bar must render as a single neutral
  segment in this case — see `paymentMixWidths()` below.

**Period derivation** (mock-only, v1): each non-today summary is computed by
applying the prototype's `PERIOD_FACTOR = { today: 1, week: 6.4, month: 27 }`
to the today aggregates. The factor is documented in `mock-data.ts` and
removed when real date-bounded aggregation lands.

### `DashboardData` (the top-level prop on `<DashboardPage />`)

```ts
type DashboardData = {
  greeting: {
    eyebrow: "Lacquer Studio · Front desk";   // FR-003
    title: "Today at the salon";              // FR-003
    subtitle: string;                          // e.g. "Tuesday, May 12 · 8 techs on shift · Last sale 4:14 PM"
  };
  summaries: Record<DashboardPeriod, DashboardSummary>;  // FR-004, FR-005
  staff: Technician[];                          // FR-010 (everyone on shift)
  recent: TransactionRow[];                     // FR-011, FR-012 — exactly 7 rows, newest first
  comparisons: {                                // FR-006 — always the literal static object below;
    transactionsVsAvg: "+3 vs avg";             // <PeriodSummary /> decides display per active period
    revenueDelta: "+12%";                       // (renders only when period === "today").
  };
  quickActions: QuickAction[];                  // FR-009 — fixed 4-item list
};
```

### `TransactionRow` (one row of the feed)

| Field           | Type                                | Source / rule                                                                 |
|-----------------|-------------------------------------|-------------------------------------------------------------------------------|
| `id`            | `Transaction.id`                    | Stable React key.                                                             |
| `time`          | `Transaction.time`                  | Pre-formatted `"H:MM AM"`.                                                    |
| `client`        | `string`                            | `Transaction.client`; truncated with CSS ellipsis when the row is too narrow. |
| `serviceLabel`  | `string`                            | Per FR-012: `≤2 items` → `"A, B"`; `≥3 items` → `"A +N more"`. Computed by `formatServiceLabel(items)`. |
| `techIds`       | `Technician.id[]`                   | Drives the overlap avatar stack via `<TechStack />`.                          |
| `method`        | `"card" \| "cash" \| "gift"`        | Drives the method-pill color + text label.                                    |
| `total`         | `number` (USD, integer dollars)     | `txTotals(transaction).total` rounded to no decimals (FR-013).                |

**Ordering**: the array is most-recent-first and contains exactly `min(7,
TX_HISTORY.length)` rows.

### `QuickAction`

A static, four-item list rendered as a single-column stack of secondary
buttons under the stat grid. The list is constant — not user-editable in this
feature.

| Field    | Type                                              | Notes                              |
|----------|---------------------------------------------------|------------------------------------|
| `id`     | `"calendar" \| "walkin" \| "report" \| "cashout"` | Matches the prototype's `id`s.     |
| `label`  | `string`                                          | The button text.                   |
| `hint`   | `string`                                          | One-line subtitle under the label. |
| `icon`   | `LucideIcon`                                      | Lucide React icon component.       |
| `href`   | `string`                                          | Target studio route.               |

The four rows are fixed:

| `id`        | `label`              | `hint`                         | `icon`         | `href`                       |
|-------------|----------------------|--------------------------------|----------------|------------------------------|
| `calendar`  | Today's calendar     | See appointments + chairs      | `Calendar`     | `/calendar`                  |
| `walkin`    | Quick walk-in        | Skip the appointment book      | `PersonStanding` | `/walkin`                  |
| `report`    | Day report (X-out)   | Sales by tech, by service      | `Receipt`      | `/end-of-day?view=report`    |
| `cashout`   | End-of-day cash      | Reconcile the till             | `DollarSign`   | `/end-of-day`                |

(Target routes are placeholders today — those features ship later. Each click
must navigate; the destination is allowed to be a stub page.)

---

## State transitions

There is exactly one piece of UI state on this page: the active period.

```text
       click "Today"          click "Week"          click "Month"
 ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
 │  period: today   │──│  period: week    │──│  period: month   │──┐
 └──────────────────┘  └──────────────────┘  └──────────────────┘  │
        ▲                                                          │
        └──────────────── (any → today on remount) ────────────────┘
```

- Stored in the `<PeriodToggle />` client island.
- The toggle re-clicks the currently active value as a no-op (FR Edge case
  "Period switch during slow render" — must not double-render). Implementation:
  `onChange` is guarded by `if (next === current) return;`.

No other client state exists on this page.

---

## Authentication context (stubbed)

`lib/auth/session.ts` exposes:

```ts
export type StudioViewer = { id: string; staffId: string; displayName: string };
export async function requireStudioSession(): Promise<StudioViewer>;
```

- v1 implementation returns a fixed demo viewer
  (`{ id: "demo", staffId: "maya", displayName: "Maya Patel" }`).
- Dashboard imports this once at the top of `page.tsx`. The header subtitle
  reads `displayName` only; no other field is surfaced.
- The function signature is the **contract for the auth feature** — when real
  auth lands, the body changes; this file's caller (`page.tsx`) does not.

---

## What is NOT in this data model

Out of scope for this feature, explicitly:

- `tickets`, `payments`, `tip_splits`, `audit_log`, `staff`, `services`,
  `clients` (all defined in `docs/system-design.md`).
- Supabase RLS policies.
- Any persistent storage of `DashboardPeriod` across sessions.
- Any historical period rollup beyond the placeholder multipliers documented
  in [research.md](./research.md) R9.

These land with the schema/RLS feature and the auth feature, respectively.
