# Contract: Transactions Page

**Feature**: 045-transactions-page · **Date**: 2026-05-19

This is a UI feature with no external API. The "contracts" below are the
internal interfaces between layers — the route, the server query layer, the
client read model, and the one cross-cutting change to the sidebar nav config.
They are the surfaces the unit tests and the e2e spec verify.

---

## C1 — Route & search-param contract

**Route**: `/transactions` — `app/(studio)/transactions/page.tsx`, a
`force-dynamic` Server Component inside the `(studio)` layout (sidebar +
topbar + auth guard).

**Search params** (all optional):

| Param | Values | Default | Meaning |
|-------|--------|---------|---------|
| `period` | `today` \| `week` \| `month` | `week` | period granularity |
| `offset` | integer `≤ 0` | `0` | periods back from current |

- Invalid / missing `period` → `week`. Invalid / positive / non-integer
  `offset` → `0`.
- `offset` is clamped to `≤ 0` (no browsing the future).
- The page is bookmarkable and back-button-correct: each `(period, offset)`
  pair is a distinct URL that re-queries on navigation.

**Access**: `requireStudioSession()` first; then if
`role ∉ { owner, manager }` → `redirect("/dashboard")` (silent, no flash).
This redirect is the **security boundary** (Constitution Principle II); the
sidebar role-filter (C5) is UX only.

---

## C2 — Server query layer

Module: `lib/transactions/queries.ts` (server-only).

```ts
queryTransactions(
  supabase: SupabaseClient<Database>,
  tz: string,
  window: PeriodWindow,
): Promise<readonly TransactionDetail[]>
```

- Returns every `status = 'paid'` ticket with
  `closed_at ∈ [window.start, window.end)`, projected to `TransactionDetail`
  (see data-model.md § 2), newest-first.
- Reads `tickets`, then `ticket_items` + `payments` (succeeded only) by
  `.in("ticket_id", ids)`, then `staff` and `services` for name/category
  resolution. Empty window → `[]` with no child queries.

```ts
queryPeriodCount(
  supabase: SupabaseClient<Database>,
  window: PeriodWindow,
): Promise<number>
```

- Returns the count of `status = 'paid'` tickets with `closed_at` in the
  window. Used for the KPI "vs previous period" delta against the
  *previous* window.

```ts
loadTransactionsPage(
  supabase: SupabaseClient<Database>,
  window: PeriodWindow,
): Promise<{
  transactions: readonly TransactionDetail[];
  staff: readonly Technician[];
  previousPeriodCount: number;
  tz: string;
  todayKey: string;            // salon-local YYYY-MM-DD of "now"
}>
```

- Orchestrator the page calls. Resolves tz, runs `queryTransactions`,
  `queryPeriodCount` (previous window), and the staff roster concurrently.

---

## C3 — Window resolution

Module: `lib/transactions/window.ts` (pure).

```ts
type PeriodGranularity = "today" | "week" | "month";

resolveWindow(
  tz: string,
  granularity: PeriodGranularity,
  offset: number,
  now: Date,
): PeriodWindow      // { granularity, offset, start, end, isCurrent, label, rangeLabel }

parsePeriodParams(
  raw: { period?: string; offset?: string },
): { granularity: PeriodGranularity; offset: number }   // sanitises per C1
```

Timezone math is delegated to new offset-aware helpers in
`lib/time/period-windows.ts`:

```ts
dayWindowAt(tz: string, now: Date, offset: number):   readonly [Date, Date]
weekWindowAt(tz: string, now: Date, offset: number):  readonly [Date, Date]   // Monday-start
monthWindowAt(tz: string, now: Date, offset: number): readonly [Date, Date]   // calendar month
```

Each returns the **full** period (`offset` steps back); the existing
`todayWindow` / `weekWindow` / `monthWindow` (which end at `now`) are untouched.

---

## C4 — Client read model & pure helpers

Module: `lib/transactions/aggregate.ts` (pure; importable on the client).

```ts
type TransactionLineItem = { … }      // data-model.md § 2
type TransactionPayment  = { … }
type TransactionDetail   = { … }
type TransactionKpis     = { … }
type DayGroup            = { … }

deriveMethod(payments: readonly TransactionPayment[]): PaymentMethod
computeKpis(transactions: readonly TransactionDetail[]): TransactionKpis
groupByDay(transactions: readonly TransactionDetail[]): readonly DayGroup[]
```

Module: `lib/transactions/format.ts` (pure):

```ts
formatTxId(uuid: string): string                       // "#A3F029"
formatDayLabel(dayKey: string): string                 // "May 12, 2026"
formatRelativeDay(dayKey: string, todayKey: string): string  // "Today" | "Yesterday" | "3 days ago" | "Mon"
```

**Filter predicate** (client island, over the loaded period):

```
visible(tx) =
     (search empty   OR  search matches tx.client | tx.displayId | any item.name)
  AND (method = all  OR  tx.method = method)
  AND (techIds empty OR  tx.techIds ∩ selectedTechIds ≠ ∅)
```

Search is case-insensitive, trimmed, substring. The KPI strip and day-grouped
table both render from the filtered set.

---

## C5 — Sidebar nav contract addition

File: `components/lacquer/sidebar/nav-items.ts`.

- `NavItem` gains an optional field:

  ```ts
  /** Roles allowed to see this item. Absent ⇒ visible to all roles. */
  roles?: readonly StudioRole[];
  ```

- New item added to the **Workspace** group, **between `checkout` and
  `walkin`** (matching the handoff `StudioShell.jsx`):

  ```ts
  { id: "transactions", label: "Transactions", icon: Receipt,
    href: "/transactions", roles: ["owner", "manager"] }
  ```

- `validateNavConfig` — unchanged invariants (1–4 still hold; `roles` is
  optional and adds no new rule). `id` `"transactions"` and `href`
  `"/transactions"` are unique.

- `SidebarShell` (`sidebar-shell.client.tsx`) gains a `role: string` prop,
  passed from `StudioSidebar`. An item is rendered iff
  `item.roles === undefined || item.roles.includes(role)`. Active-match,
  `data-nav-id`, disabled handling — all unchanged.

- DOM contract: the item renders with `data-nav-id="transactions"` exactly
  as every other item; for owner/manager it is an `<a>`, for technician /
  front_desk it is **absent from the DOM**.

---

## C6 — Wiring contract

- `components/lacquer/recent-transactions-feed.tsx` — the "View all" control
  changes from an inert `<button className="tx-link">` to
  `<Link href="/transactions" className="tx-link">View all</Link>`. Same class,
  same text; only the element and destination change.

---

## Verification map

| Contract | Verified by |
|----------|-------------|
| C1 route / params / role gate | `transactions.spec.ts` (owner sees page; technician redirected); `window.test.ts` (`parsePeriodParams`) |
| C2 query layer | `transactions.spec.ts` (seeded rows appear with correct detail) |
| C3 window math | `window.test.ts`, `period-windows.test.ts` (offset-aware windows, clamp) |
| C4 read model / helpers / filter | `aggregate.test.ts`, `format.test.ts`; `transactions.spec.ts` (search/method/tech narrow the list + KPIs) |
| C5 nav contract | `transactions.spec.ts` (item visible for owner, absent for technician); `sidebar.spec.ts` (`EXPECTED_NAV_IDS`) |
| C6 wiring | `transactions.spec.ts` ("View all" navigates to `/transactions`) |
