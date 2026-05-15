# Contract: `components/lacquer/*` props

**Feature**: 002-dashboard-page

Each component below is a thin, token-only React component composed from
shadcn primitives (`button`, `card`, `avatar`) and Lucide icons. All props
are typed; no `any` is allowed. Server components are the default — only
files that explicitly need state are marked `"use client"`.

## `<StatCard />` (server)

```ts
type StatCardProps = {
  label: string;                  // "Transactions" — uppercase via CSS, not prop
  value: string | number;         // "1,240" or "$1,240"
  sub?: string;                   // "today" or "1.4/sale"
  delta?: string | null;          // "+3 vs avg" — only when period === "today"
  icon?: ReactNode;               // Lucide icon at size={14}
};
```
- Renders the `.tx-stat-card` chrome. `delta` is hidden when `null`. Value
  uses `.tnum`.

## `<PaymentMixCard />` (server)

```ts
type PaymentMixCardProps = {
  byMethod: { card: number; cash: number; gift: number };  // USD
  total: number;                                            // USD
};
```
- Uses `paymentMixWidths(byMethod, total)` to compute segment widths.
- FR-018: when `total === 0`, renders one neutral segment via the `neutral`
  width returned by the formatter.

## `<NewTransactionCTA />` (server)

```ts
type NewTransactionCTAProps = {
  href?: string;                   // default "/checkout"
  sub?: string;                    // default "Charge a sale"
};
```
- Renders an anchor styled with `.tx-cta-primary`. Lucide `<Plus />` at 20 px
  inside a 36 px circular badge; `<ChevronRight />` at 18 px on the right.

## `<SecondaryActions />` (server)

```ts
type SecondaryActionsProps = {
  actions: QuickAction[];          // exactly the four-row list from data-model
  cols?: 1 | 2;                    // dashboard renders cols={1}
};
```
- Maps each action to an anchor styled with `.tx-secondary-action`. Icon at
  18 px. Label + hint.

## `<TechsOnShiftTile />` (server)

```ts
type TechsOnShiftTileProps = {
  staff: Technician[];
};
```
- Wrap-flex container; per-tech cell = `<TechAvatar tech={t} size={32} />` +
  10 px first-name. Wraps to multiple rows when the roster exceeds the row
  width (Edge case).

## `<TechAvatar />` (server)

```ts
type TechAvatarProps = {
  tech: Technician;
  size?: number;                   // px, default 36
  ring?: boolean;                  // default false; adds primary ring (used elsewhere)
};
```
- Mirrors `TechPicker.jsx` line 12 verbatim modulo TypeScript types.

## `<TechStack />` (server)

```ts
type TechStackProps = {
  ids: Technician.id[];
  size?: number;                   // px, default 20
  max?: number;                    // default 3
};
```
- Overlap stack. Renders `+N` overflow chip when `ids.length > max`.

## `<RecentTransactionsFeed />` (server)

```ts
type RecentTransactionsFeedProps = {
  rows: TransactionRow[];
};
```
- Header `"Recent transactions"` + `"View all"` button (no-op anchor in v1,
  but rendered).
- Renders one `.tx-feed-row` per `TransactionRow`. Each row shows
  `time | client | serviceLabel | <TechStack /> | <method pill> | $<total>`.
- Method pill class derived from `row.method` (`.tx-meth-pill.card |
  .cash | .gift`).

## Period island (client)

The active-period state is shared across the header band (where the toggle
lives) and the stat grid (where the values render). Both consumers read from
a single React Context owned by `<PeriodProvider />`. All three exports below
live in **`components/lacquer/period-toggle.tsx`** (one client module — keeps
the island self-contained and avoids a circular import between sibling files).

```ts
"use client";

// (a) Provider — wraps both consumers in the page.
type PeriodProviderProps = {
  summaries: Record<DashboardPeriod, DashboardSummary>;
  comparisons: DashboardData["comparisons"];
  children: ReactNode;
};
export function PeriodProvider(props: PeriodProviderProps): JSX.Element;

// (b) Hook — used by every consumer.
type PeriodContextValue = {
  period: DashboardPeriod;
  setPeriod: (next: DashboardPeriod) => void;
  summary: DashboardSummary;                  // = summaries[period]
  comparisons: DashboardData["comparisons"];
};
export function usePeriod(): PeriodContextValue;  // throws if outside provider

// (c) Toggle — header consumer. No props.
export function PeriodToggle(): JSX.Element;
//   Three buttons `Today / Week / Month`; exactly one carries `.active`.
//   onClick handler short-circuits when `next === period` (Edge case
//   "Period switch during slow render").
//   Each button is a native <button>; focus-visible inherits from the shadcn
//   primitive used as a base.
```

## `<PeriodSummary />` (client)

```ts
"use client";
// No props — reads from `usePeriod()`.
export function PeriodSummary(): JSX.Element;
```
- Lives in `components/lacquer/period-summary.client.tsx`.
- Renders four `<StatCard />` + one `<PaymentMixCard />`, reading the active
  `summary` from `usePeriod()`. Toggling is a pure render swap (no network).
- Passes `comparisons.transactionsVsAvg` / `comparisons.revenueDelta` to the
  Transactions / Revenue card `delta` props **only when `period === "today"`**;
  passes `null` otherwise (FR-006).

## Stability commitment

These prop shapes are the contract the Supabase-wiring feature inherits. The
component bodies can evolve (e.g., add an empty-state illustration) but the
prop names and types stay stable.
