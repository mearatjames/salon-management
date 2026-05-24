# Contract: Report Page — route, queries, read model, nav

**Feature**: 046-report-page · **Date**: 2026-05-20

This is a read-only UI feature. There are no HTTP API endpoints and no Server
Actions. The contracts below are the **internal interface seams** the build must
honour: the route + search params, the server query/projection signatures, the
read-model shapes, the CSV format, and the one nav-config change.

---

## C1 — Route & search-param contract

- **Route**: `app/(studio)/report/page.tsx` — App Router, `export const dynamic
  = "force-dynamic"`. A `loading.tsx` sibling renders the skeleton during a
  period re-fetch.
- **Search params**: `?period=day|week|semi` and `?offset=<non-positive int>`.
  - Missing/invalid `period` → `day`. Missing/invalid/positive `offset` → `0`.
  - Switching granularity resets to `offset=0`. `offset` is omitted from the URL
    when `0` (clean current-period URL).
- **Access**: the Server Component calls `requireStudioSession()`, then
  `redirect("/dashboard")` unless `viewer.staff.role ∈ {owner, manager}`. This
  redirect — not the sidebar filter — is the security boundary (FR-002,
  Constitution II). The redirect is silent (no flash).

## C2 — Server query layer (`lib/report/queries.ts`, server-only)

```ts
loadReportPage(supabase, window: ReportWindow): Promise<{
  report: ReportReadModel;
  tz: string;
}>
```

Orchestrates, in order:

1. `getSalonTimezone(supabase)`.
2. Query `tickets` — `status='paid'`, `closed_at ∈ [window.start, window.end)`.
   Empty → return `{ report: { technicians: [], totals: <zeros>,
   isEmpty: true }, tz }` with no child queries.
3. By `ticket_id IN (…)`: `ticket_items` (all columns in data-model §1) and
   `payments` (`status='succeeded'`), concurrently.
4. Resolve `services` for the distinct non-null `ref_id`s — `id, card_fee_mode,
   card_fee_custom_cents, supply_amount_cents, supply_type_id`.
5. Resolve `staff` for the distinct `assigned_staff_id`s of **service** items —
   `id, display_name, color_token, card_fee_exempt, supply_mode, supply_except`.
   `.in("id", performerIds)` — **no `active` filter** (R8).
6. `projectReport({ tz, tickets, items, payments, staff, services })` →
   `ReportReadModel`.

All reads RLS-bound via the cookie-aware server client. No RPC.

## C3 — Projection & math (`lib/report/aggregate.ts`, pure, client-importable)

| Export | Signature | Contract |
|--------|-----------|----------|
| `projectReport` | `(ProjectReportInput) => ReportReadModel` | raw rows → read model (data-model §3) |
| `effectiveCardFeeCents` | `(service \| null) => number` | data-model §2.2 |
| `computeLineDeductions` | `(item, service, tech, isCardSettled) => { cardFeeCents, supplyCents, lines }` | data-model §2.3 |
| `splitCardTip` | `(totalCents, weights: number[]) => number[]` | largest-remainder; `Σ result === totalCents` (R4) |
| `deriveMethod` | reused from `lib/dashboard/aggregate` | single method or `"split"` |

`projectReport` is **pure** (no I/O, no `Date.now()`), so the unit suite drives
it with fixed fixtures. `splitCardTip` is the constitutionally test-first piece
(Principle IV — "tip-split math").

## C4 — Window layer (`lib/report/window.ts`, pure)

| Export | Signature |
|--------|-----------|
| `ReportGranularity` | `"day" \| "week" \| "semi"` |
| `ReportWindow` | shape in data-model §4 |
| `parseReportPeriodParams` | `({period?, offset?}) => { granularity, offset }` |
| `resolveReportWindow` | `(tz, granularity, offset, now) => ReportWindow` |

New in `lib/time/period-windows.ts`:

```ts
semiMonthlyWindowAt(tz: string, now: Date, offset: number): readonly [Date, Date]
```

Half-month windows; `offset` steps by whole half-months across month boundaries.

## C5 — CSV contract (`lib/report/csv.ts`, pure)

```ts
buildReportCsv(report: ReportReadModel, window: ReportWindow): string
```

- Header row: `Tech, Services, Gross, Card Fee, Supply, Total Deductions,
  Commissionable, Card Tips`.
- One row per `TechnicianReport` (order: `displayName` asc); money columns
  are decimal dollars (`75.00`).
- Final `TOTAL` row from `ReportTotals`.
- Every value is double-quoted; rows joined with `\n`.
- The client island downloads it as `Report-<window.rangeLabel>.csv` via a
  `data:text/csv;charset=utf-8` anchor. Values match the on-screen overview
  exactly (SC-007).

## C6 — Component contract (`components/lacquer/report/`)

| Component | Kind | Responsibility |
|-----------|------|----------------|
| `report-period-controls.tsx` | Server | Day/Week/Semi-monthly toggle + ‹ › arrows as `<Link>`s over `?period=&offset=`; "next" disabled at `isCurrent` |
| `report-actions.client.tsx` | Client | Print (`window.print()`) + Export CSV buttons; receives `report` + `window` |
| `report-summary.tsx` | Server | 3-stat strip — gross revenue, total deductions (Card / Supply), card tips (FR-022) |
| `report-view.client.tsx` | Client island | owns `selectedTechId` + `expandedTxIds`; renders left list + right panel |
| `all-staff-overview.tsx` | Presentational | overview table + totals row + legend (FR-021, FR-023) |
| `tech-detail.tsx` | Presentational | per-tech transaction table; expandable rows; omits deduction columns when `totalDeductionsCents === 0` (FR-024, FR-025, FR-026) |
| `report-empty-state.tsx` | Presentational | shown when `report.isEmpty` (FR-029) |

Stable `data-slot` / `data-*` hooks for e2e: `data-slot="report-actions"`,
`data-slot="period-controls"`, `data-tech-id`, `data-slot="all-staff"`,
`data-slot="totals-row"`, `data-expandable`, `data-slot="empty-state"`.

## C7 — Nav-config contract change (`components/lacquer/sidebar/nav-items.ts`)

The Operations-group placeholder

```ts
{ id: "day-report", label: "Day Report", icon: FileBarChart, href: null, disabled: true }
```

becomes

```ts
{ id: "report", label: "Report", icon: FileBarChart, href: "/report",
  roles: ["owner", "manager"] }
```

`validateNavConfig` still passes (non-null `href`, no trailing slash, unique
`id`/`href`). `roles` filtering is UX-only (Constitution II) — C1's redirect is
the boundary. `tests/e2e/sidebar.spec.ts` `EXPECTED_NAV_IDS` swaps `day-report`
→ `report`; any nav-config unit test updates with it.

## C8 — Cross-page consistency (FR-030 / SC-004 — see research R10)

The report does **not** query or import Transactions-page code. Consistency is
structural: both surfaces project `status='paid'` tickets by `closed_at`, and the
report's `totals.transactionCount` counts **distinct** tickets — so for any day
the two transaction counts are equal and both reflect the identical ticket set.
The report's "gross revenue" (gross service earnings) is a deliberately distinct
metric from the Transactions page's tip-inclusive gross KPI.
</content>
