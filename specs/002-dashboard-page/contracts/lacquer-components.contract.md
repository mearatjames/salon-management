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

## `<PeriodToggle />` (client)

```ts
"use client";
type PeriodToggleProps = {
  value: DashboardPeriod;
  onChange: (next: DashboardPeriod) => void;
};
```
- Three buttons (`Today / Week / Month`); exactly one carries `.active`.
- Implementation guard: `if (next === value) return;` so re-clicks are no-ops
  (Edge case).
- Keyboard: each button is a native `<button>` and inherits focus-visible
  from the shadcn primitive.

## `<PeriodSummary />` (client)

```ts
"use client";
type PeriodSummaryProps = {
  summaries: Record<DashboardPeriod, DashboardSummary>;
  comparisons: DashboardData["comparisons"];
};
```
- Holds the active-period state and renders four `<StatCard />` + one
  `<PaymentMixCard />`. Receives the precomputed summaries as props (the page
  computes once on the server), so toggling is a pure render swap.
- Mounts `<PeriodToggle />` as a sibling so the header band sees the same
  state via prop drilling (or a tiny shared context confined to this island).

## Stability commitment

These prop shapes are the contract the Supabase-wiring feature inherits. The
component bodies can evolve (e.g., add an empty-state illustration) but the
prop names and types stay stable.
