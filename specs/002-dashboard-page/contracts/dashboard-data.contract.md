# Contract: `lib/dashboard/*` public API

**Feature**: 002-dashboard-page
**Files**: `lib/dashboard/mock-data.ts`, `lib/dashboard/aggregate.ts`,
`lib/dashboard/format.ts`

This is the data layer the dashboard page imports today and the Supabase-
wiring feature replaces tomorrow. **Function signatures and return shapes are
fixed**; the bodies may change when real data arrives.

## `lib/dashboard/mock-data.ts`

Verbatim TS port of `design-system/prototypes/transaction/data.jsx`.

```ts
export const SERVICES: readonly Service[];
export const STAFF: readonly Technician[];
export const TX_HISTORY: readonly Transaction[];
export const PERIOD_FACTOR: Readonly<Record<DashboardPeriod, number>>;
```

- `STAFF` and `TX_HISTORY` are the exact values listed in
  `design-system/prototypes/transaction/data.jsx`. Drift fails the e2e test.
- `PERIOD_FACTOR = { today: 1, week: 6.4, month: 27 }`.
- A `// TODO` comment at module top points to the Supabase-wiring feature.

## `lib/dashboard/aggregate.ts`

All functions are **pure** — same input → same output, no I/O, no `Date.now()`.

```ts
export function txTotals(tx: Transaction): {
  subtotal: number; tip: number; tax: number; total: number; services: number;
};
```
- Mirrors the prototype's `txTotals` (data.jsx:183). Tax = 8.75% applied on
  `subtotal + tip`. `total = subtotal + tip + tax`. `services = Σ qty`.

```ts
export function txAggregate(list: readonly Transaction[]): {
  count: number; services: number; subtotal: number; tip: number; tax: number;
  total: number; byMethod: { card: number; cash: number; gift: number };
};
```
- Mirrors the prototype's `txAggregate` (data.jsx:197). `count = list.length`.

```ts
export function applyPeriodFactor(
  base: ReturnType<typeof txAggregate>,
  period: DashboardPeriod,
): DashboardSummary;
```
- Multiplies `count`, `services`, `subtotal`, `tip`, `tax`, `total`, and each
  `byMethod.*` by `PERIOD_FACTOR[period]`. Rounds `count` and `services` to
  the nearest integer. Returns a fully-populated `DashboardSummary` (including
  the computed `avgServicesPerSale` and `tipPctAvg` sub-line fields).
- **FR-018 branch**: if `base.count === 0`, returns an all-zeroes summary
  unchanged regardless of `period`.

```ts
export function buildDashboardData(): DashboardData;
```
- The single function the page calls. Computes all three period summaries
  off `TX_HISTORY`, builds the seven-row `TransactionRow[]` for the feed,
  attaches the four `QuickAction`s, and produces the comparison strings only
  for `today`. Pure (no `Date.now()`); the header subtitle uses static strings
  matching the prototype.

## `lib/dashboard/format.ts`

```ts
export function formatCurrency(amount: number): string;        // "$1,240"
export function formatPercent(fraction: number): string;       // 0.18 → "18%"
export function formatCount(n: number): string;                // 12 → "12"
export function formatServiceLabel(
  items: readonly TxLineItem[],
  services: readonly Service[],
): string;
//   ≤2 items → "Classic mani, Paraffin (feet)"
//   ≥3 items → "Classic mani +2 more"
//   Takes `services` as an explicit parameter (rather than importing
//   `SERVICES` from `mock-data.ts`) so `format.ts` stays decoupled from
//   the data source — the Supabase-wiring feature passes the live catalog.
export function paymentMixWidths(
  byMethod: { card: number; cash: number; gift: number },
  total: number,
): { card: number; cash: number; gift: number; neutral: number };
//   - Returns percentages 0..100 that sum to ≤100.
//   - When total === 0: { card: 0, cash: 0, gift: 0, neutral: 100 } (FR-018).
//   - Otherwise: { card: pct, cash: pct, gift: pct, neutral: 0 }.
```

- All formatters use `Intl.NumberFormat("en-US", …)` with `{
  maximumFractionDigits: 0 }`; currency uses `style: "currency", currency:
  "USD"`. No ad-hoc concatenation.

## Stability commitment

The Supabase-wiring feature MUST:
- Keep the exact names and signatures of `buildDashboardData`, `txTotals`,
  `txAggregate`, `applyPeriodFactor`, and every formatter.
- Replace `mock-data.ts` with a real-data implementation; the page must not
  need any other change.
- Preserve the `DashboardData` / `DashboardSummary` / `TransactionRow` shapes
  exported from `data-model.md`.
