# Implementation Plan: Transactions Page

**Branch**: `feat/045-transactions-page` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/045-transactions-page/spec.md`

## Summary

Add a dedicated **Transactions** page that lists every completed sale the salon
has recorded, filterable by period (Today / This week / This month) with
backward/forward stepping, grouped by day, summarised by a KPI strip, and
drillable into a per-transaction receipt drawer. Reachable from a new
owner/manager-only sidebar item and from the dashboard's "View all" control.

**Technical approach**: a new App Router route at `app/(studio)/transactions/`
following the established studio-page pattern. The page is a `force-dynamic`
Server Component that role-gates (owner/manager), resolves the active date
window from URL search params (`period`, `offset`), and queries the existing
`tickets` / `ticket_items` / `payments` / `staff` / `services` tables — **no
schema migration is required**. The window's transactions are projected to a
rich client read model and handed to a client island that owns instant search /
method / tech filtering, the recomputed KPI strip, the day-grouped table, and
the receipt drawer. Period stepping is plain server navigation (`<Link>` →
new search params → fresh RSC query), mirroring the dashboard's "re-query on
every navigation" freshness model.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 16 (App Router, RSC +
Server Components)

**Primary Dependencies**: Next.js App Router, `@supabase/supabase-js`
(cookie-aware server client), Lucide React icons, the Lacquer design system
(`styles/tokens.css`)

**Storage**: Supabase Postgres — existing tables only: `public.tickets`,
`public.ticket_items`, `public.payments`, `public.staff`, `public.services`,
`public.settings`. No new tables, columns, enums, RPCs, or indexes.

**Testing**: Vitest (unit — pure window math, aggregation, projection,
formatting, filter predicates) and Playwright (one e2e spec, `main` project)

**Target Platform**: Salon-floor tablet/desktop browsers; studio shell

**Project Type**: Web application (Next.js single project)

**Performance Goals**: Page interactive within 2 s for a typical month of
transactions (SC-006); client-side filter/search updates within 1 s (SC-007 —
in practice instant, since filtering is in-memory over the loaded period)

**Constraints**: Read-only feature — no mutations, no money writes, no audit
entries. Owner/manager only. All visual values resolve to Lacquer tokens
(Constitution Principle I). No new schema (Principle V).

**Scale/Scope**: Single salon; a period payload is at most one calendar month
of paid tickets (low hundreds), each with a handful of line items and payments.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I — Design System Fidelity** | UI adapts the `Transactions.html` prototype; `styles/transactions.css` is derived from the handoff's `transactions-page.css` with every value resolved to a `styles/tokens.css` token. The prototype's raw-`oklch` method-pill colors are replaced by reusing the existing tokenised `<MethodPill>`; the KPI delta colors use `--success` / `--destructive`. Icons are Lucide 1.5px. The prototype is copied into `design-system/prototypes/transaction/` (FR-020). | PASS |
| **II — Server-Authoritative** | Reads via RSC against Supabase through the cookie-aware server client. Authorization (owner/manager) is enforced in the Server Component with a silent redirect — the route redirect is the security boundary; the sidebar role-filter is UX only. The feature performs **no mutations**, so there is no client-write surface. | PASS |
| **III — Auditability & Money Integrity** | Read-only — no writes, no money mutations, no audit rows. Displayed money is server-authoritative: the subtotal comes straight from `tickets.*_cents`, tips from `payments.tip_cents`; the client never recomputes monetary truth, only formats it. | PASS |
| **IV — Test-First for Critical Paths** | Not a constitutionally "critical path" (no payments/refunds/auth/tip-allocation/audit writes), but aggregation correctness underwrites SC-003. Plan commits to Vitest unit tests for every pure function (window resolution, KPI aggregation, projection, formatting, filter predicate) written test-first, plus one Playwright e2e. | PASS |
| **V — Scope Discipline & Cost Restraint** | Zero new schema, zero new dependencies, zero new paid infrastructure. Refund/void and CSV export stay deferred (out of scope per spec). Tax stays a reserved always-$0 field — no tax compute path, and the receipt drawer omits the tax line, so no tax UI is added either. Reuses existing query/format helpers wherever they fit. | PASS |

**Result**: PASS — no violations. Complexity Tracking table intentionally empty.

**Post-Phase-1 re-check**: PASS — the design introduces no new tables, no second
component library, no client-side authority, and no schema drift. The only
cross-cutting change (a `roles?` field on `NavItem` + a `role` prop threaded to
the sidebar client island) is additive and UX-layer; the route redirect remains
the enforced boundary.

## Project Structure

### Documentation (this feature)

```text
specs/045-transactions-page/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (/speckit-specify output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── transactions-read-model.md   # Phase 1 — read model, query + route + nav contracts
└── checklists/
    └── requirements.md  # Spec quality checklist (/speckit-specify output)
```

### Source Code (repository root)

```text
app/(studio)/transactions/
├── page.tsx                       # NEW — Server Component: role gate, window
│                                  #       resolve from searchParams, query, render
└── loading.tsx                    # NEW — skeleton shown during period re-fetch

lib/transactions/
├── queries.ts                     # NEW — server-only: queryTransactions(window),
│                                  #       queryPeriodCount(window) for the KPI delta
├── aggregate.ts                   # NEW — pure: read-model types, deriveMethod(),
│                                  #       computeKpis(), groupByDay()
├── window.ts                      # NEW — pure: (granularity, offset) → window +
│                                  #       labels; dispatches to lib/time helpers
└── format.ts                      # NEW — pure: formatTxId(), day-label / range-label

lib/time/
└── period-windows.ts              # MODIFIED — add offset-aware full-period window
                                   #            functions (dayWindowAt / weekWindowAt /
                                   #            monthWindowAt); tz math stays here

components/lacquer/transactions/
├── period-controls.tsx            # NEW — Server Component: period toggle + ‹ › arrows
│                                  #       rendered as <Link>s over searchParams
├── transactions-view.client.tsx   # NEW — client island root: owns search / method /
│                                  #       tech / selected-row state
├── kpi-strip.tsx                  # NEW — KPI cards (presentational)
├── filter-bar.tsx                 # NEW — search input, method chips, tech popover,
│                                  #       active-filter pills
├── transactions-table.tsx         # NEW — day-grouped table with per-day headers
└── receipt-drawer.tsx             # NEW — right-side receipt detail drawer (ESC/backdrop)

components/lacquer/
└── recent-transactions-feed.tsx   # MODIFIED — "View all" becomes a <Link href="/transactions">

components/lacquer/sidebar/
├── nav-items.ts                   # MODIFIED — add optional roles?: StudioRole[] to
│                                  #            NavItem; add the "transactions" item
├── studio-sidebar.tsx             # MODIFIED — pass staff.role through to SidebarShell
└── sidebar-shell.client.tsx       # MODIFIED — accept role prop; filter role-gated items

styles/
└── transactions.css               # NEW — .tp-* page styles, adapted from the
                                   #       handoff's transactions-page.css, all tokenised

design-system/prototypes/transaction/
├── Transactions.html              # NEW — copied from the Lacquer handoff (FR-020)
├── TransactionsPage.jsx           # NEW — copied
├── transactions-page.css          # NEW — copied
└── StudioShell.jsx                # UPDATED — copied (handoff version adds the nav item)

tests/
├── unit/transactions/             # NEW — Vitest: window.test.ts, aggregate.test.ts,
│                                  #       format.test.ts
├── unit/time/period-windows.test.ts  # MODIFIED — cover the new offset-aware windows
└── e2e/
    ├── transactions.spec.ts       # NEW — Playwright (main project): nav visibility +
    │                              #       role gate, "View all", listing, period
    │                              #       stepping, drawer, search/filter
    ├── _affected-map.mjs          # MODIFIED — map new paths → transactions.spec.ts
    └── sidebar.spec.ts            # MODIFIED — EXPECTED_NAV_IDS gains "transactions"
```

**Structure Decision**: Single Next.js project (the repo's only structure). The
feature follows the established studio-page convention exactly — a route folder
under `app/(studio)/` with a `force-dynamic` Server Component `page.tsx` and a
`loading.tsx`, a feature-scoped `lib/transactions/` for server queries + pure
logic, a `components/lacquer/transactions/` folder for the UI, and a single
page-scoped stylesheet in `styles/`. This mirrors how `dashboard`,
`end-of-day`, and `services` are each laid out, so it needs no new architectural
pattern.

## Phase 0 — Research

See [research.md](./research.md). Ten decisions resolved, summarised:

1. **Arbitrary-window query layer** — new `lib/transactions/queries.ts`; the
   existing `lib/dashboard/queries.ts` only windows "ending at now", so a
   dedicated read accepting an explicit `[start, end)` is required.
2. **Period + stepping math** — extend `lib/time/period-windows.ts` with
   offset-aware full-period windows (the constitution mandates one `lib/time/*`
   tz surface); `lib/transactions/window.ts` adds granularity dispatch + labels.
3. **Client/server split** — `period` + `offset` in URL search params drive a
   server re-fetch; search / method / tech filtering and the drawer are
   client-side over the loaded period payload (instant, no network).
4. **Transaction ID display** — `#` + last 6 uppercase hex of the ticket UUID;
   searchable; the underlying UUID is never shown.
5. **Client name** — no `clients` table exists in v1; every transaction
   displays "Walk-in". Documented gap, consistent with the dashboard already
   dropping its client column.
6. **Line-item category** — joined from `services.category` via
   `ticket_items.ref_id`; degrades to `null` for non-service or deleted lines.
7. **Role-gated nav item** — add optional `roles?` to `NavItem`; thread the
   viewer `role` (a plain string, safe across the RSC boundary) into the
   sidebar client island and filter there.
8. **e2e isolation** — the spec self-seeds historical paid tickets in-test and
   asserts presence/detail/role/filter behaviour, never global aggregate
   counts, so it runs safely in the parallel `main` project.
9. **Method & delta colors** — reuse the tokenised `<MethodPill>`; KPI delta
   uses `--success` / `--destructive`. No raw `oklch` enters the codebase.
10. **No migration** — refund/void and CSV export are out of scope, so the
    feature is fully served by existing tables; ship zero schema changes.

## Phase 1 — Design & Contracts

- **Data model**: [data-model.md](./data-model.md) — the `TransactionDetail` /
  `TransactionLineItem` / `TransactionKpis` read model, the source columns each
  field projects from, and the (read-only) relationship to existing tables.
- **Contracts**: [contracts/transactions-read-model.md](./contracts/transactions-read-model.md)
  — the route + search-param contract, the query function signatures, the
  client read-model shapes, and the `NavItem.roles` contract addition.
- **Quickstart**: [quickstart.md](./quickstart.md) — how to run and verify the
  feature locally, including the gate set.
- **Agent context**: the `<!-- SPECKIT -->` plan pointer in `CLAUDE.md` is
  updated to this plan.

## Complexity Tracking

> No Constitution Check violations — this table is intentionally empty.
