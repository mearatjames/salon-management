# Implementation Plan: Report Page

**Branch**: `046-report-page` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/046-report-page/spec.md`

## Summary

Add a new owner/manager-only **Report** page at `/report` that answers, for any
Day / Week / Semi-monthly period: **how much did each technician earn, and what
was deducted?** Per technician it shows gross service earnings, the
card-processing-fee and supply deductions applied, the commissionable amount
that remains, and card tips — with an All-Staff overview, per-technician
drill-down, per-transaction deduction breakdown, period stepping, Print, and CSV
export.

**Technical approach**: a new App Router route `app/(studio)/report/`, following
the established studio-page pattern and adapting the Lacquer
`DayReport.jsx` prototype (the `layout='page'` variant). The page is a
`force-dynamic` Server Component that role-gates (owner/manager), resolves the
period window from `?period=&offset=`, queries the existing `tickets` /
`ticket_items` / `payments` / `staff` / `services` tables, and computes the
**entire** read model server-side — per-technician aggregates, the card-fee and
supply deductions (from the live `021`/`022`/`023` deduction model), the
proportional card-tip split, and the grand totals. A thin client island owns
only the selected technician, expanded rows, Print, and CSV export. Period
stepping is plain server navigation, mirroring `045-transactions-page`. **No
schema migration** — every column already exists (checkout `0004`,
services-deductions `0016`, supply-types `0017`, staff payout-exemptions `0018`).

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 16 (App Router, RSC)

**Primary Dependencies**: Next.js App Router, `@supabase/supabase-js`
(cookie-aware server client), Lucide React icons, the Lacquer design system
(`styles/tokens.css`). Reuses `DEFAULT_CARD_FEE_CENTS`
(`lib/services/card-fee-default.ts`), `deriveMethod`
(`lib/dashboard/aggregate.ts`), and the `lib/time/*` window helpers.

**Storage**: Supabase Postgres — existing tables only: `public.tickets`,
`public.ticket_items`, `public.payments`, `public.staff`, `public.services`,
`public.settings`. No new tables, columns, enums, RPCs, or indexes.

**Testing**: Vitest (unit — window resolution incl. semi-monthly, deduction
math, tip-split, projection, CSV) and Playwright (one e2e spec, `main` project).

**Target Platform**: Salon-floor tablet/desktop browsers; studio shell.

**Project Type**: Web application (Next.js single project).

**Performance Goals**: Page interactive within 2 s for a typical day of 30–60
transactions (SC-006); period changes re-render within 2 s.

**Constraints**: Read-only — no mutations, no money writes, no audit entries.
Owner/manager only. Every visual value resolves to a Lacquer token (Principle
I). No new schema (Principle V).

**Scale/Scope**: Single salon; a period payload is at most one semi-monthly
window of paid tickets (low hundreds), each with a handful of line items and
payments.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I — Design System Fidelity** | UI adapts the `DayReport.jsx` prototype (`layout='page'` variant); `styles/report.css` is derived from the handoff's `day-report-page.css` with every value resolved to a `styles/tokens.css` token. The prototype's raw-`oklch` avatar/badge/figure colors are replaced with tokens and existing tokenised components. Icons are Lucide 1.5px. The prototype is already copied into `design-system/prototypes/transaction/`. | PASS |
| **II — Server-Authoritative** | Reads via RSC against Supabase through the cookie-aware server client. The owner/manager role check is enforced in the Server Component with a silent `redirect` — that redirect is the security boundary; the sidebar role-filter is UX only. The feature performs **no mutations**, so there is no client-write surface. | PASS |
| **III — Auditability & Money Integrity** | Read-only — no writes, no money mutations, no audit rows. Gross earnings derive from snapshotted `ticket_items.unit_price_cents`, so history is accurate. Deduction *rules* are read from live `services`/`staff` config (research R2) — consistent with the spec, which names deduction policy as "existing entities the report reads, not created here"; no migration, no compute path added to reserved fields. Tip-split math sums exactly to the card tip (largest-remainder, R4). | PASS |
| **IV — Test-First for Critical Paths** | Not a constitutional critical path (no payments/refunds/auth/audit writes). But the report performs **tip-split math**, which Principle IV names as MANDATORY Vitest coverage — `splitCardTip` and the deduction functions are written **test-first** (failing tests before implementation). Plus Vitest for window resolution / projection / CSV, and one Playwright e2e. | PASS |
| **V — Scope Discipline & Cost Restraint** | Zero new schema, zero new dependencies, zero new paid infrastructure. The report stops at commissionable earnings — the commission split / final payout stays out of scope. No clients directory, no report mutation, no scheduled/emailed runs. Reuses existing constants, helpers, and query patterns. | PASS |

**Result**: PASS — no violations. Complexity Tracking table intentionally empty.

**Post-Phase-1 re-check**: PASS — the design adds no tables, no second component
library, no client-side authority, no schema drift. The only cross-cutting
change (repurposing the disabled `day-report` nav placeholder into a live,
role-gated `report` item) is additive and UX-layer; the route redirect remains
the enforced boundary.

## Project Structure

### Documentation (this feature)

```text
specs/046-report-page/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (/speckit-specify + /speckit-clarify)
├── research.md          # Phase 0 output — 17 decisions
├── data-model.md        # Phase 1 output — source tables, math, read model, window
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── report-read-model.md   # Phase 1 — route, queries, read model, CSV, nav contracts
└── checklists/
    └── requirements.md  # Spec quality checklist (/speckit-specify output)
```

### Source Code (repository root)

```text
app/(studio)/report/
├── page.tsx                       # NEW — Server Component: role gate, window
│                                  #       resolve, query, project, render
└── loading.tsx                    # NEW — skeleton shown during period re-fetch

lib/report/
├── queries.ts                     # NEW — server-only: loadReportPage(window)
├── aggregate.ts                   # NEW — pure: read-model types, projectReport,
│                                  #       deduction math, splitCardTip
├── window.ts                      # NEW — pure: (granularity, offset) → ReportWindow
│                                  #       + labels; day/week/semi dispatch
└── csv.ts                         # NEW — pure: buildReportCsv(report, window)

lib/time/
└── period-windows.ts              # MODIFIED — add semiMonthlyWindowAt(tz, now, offset)

components/lacquer/report/
├── report-period-controls.tsx     # NEW — Server Component: Day/Week/Semi toggle + ‹ ›
├── report-actions.client.tsx      # NEW — client: Print + Export CSV buttons
├── report-summary.tsx             # NEW — 3-stat summary strip (presentational)
├── report-view.client.tsx         # NEW — client island: owns selected tech +
│                                  #       expanded rows; left list + right panel
├── all-staff-overview.tsx         # NEW — overview table, totals row, legend
├── tech-detail.tsx                # NEW — per-tech transaction table, expand rows
└── report-empty-state.tsx         # NEW — empty-period state

components/lacquer/sidebar/
└── nav-items.ts                   # MODIFIED — disabled "day-report" placeholder
                                   #            → live owner/manager "report" item

styles/
└── report.css                     # NEW — .dr-* / chrome page styles, adapted from
                                   #       the handoff's day-report-page.css, tokenised

tests/
├── unit/report/                   # NEW — Vitest: window.test.ts, aggregate.test.ts
│                                  #       (deduction + tip-split, test-first), csv.test.ts
├── unit/time/period-windows.test.ts  # MODIFIED — cover semiMonthlyWindowAt
└── e2e/
    ├── report.spec.ts             # NEW — Playwright (main project): nav + role gate,
    │                              #       overview + reconciliation, drill-in, expand,
    │                              #       period switch, empty state, print, CSV
    ├── _affected-map.mjs          # MODIFIED — map new paths → report.spec.ts
    └── sidebar.spec.ts            # MODIFIED — EXPECTED_NAV_IDS: day-report → report
```

**Structure Decision**: Single Next.js project (the repo's only structure). The
feature follows the studio-page convention exactly — a route folder under
`app/(studio)/` with a `force-dynamic` Server Component `page.tsx` + `loading.tsx`,
a feature-scoped `lib/report/` for server queries and pure logic, a
`components/lacquer/report/` folder for the UI, and a single page-scoped
stylesheet. This mirrors `045-transactions-page`, `dashboard`, and `end-of-day`,
so it needs no new architectural pattern.

## Phase 0 — Research

See [research.md](./research.md). Seventeen decisions resolved, summarised:

1. **Period model** — `Day/Week/Semi-monthly`, default Day; new `lib/report/window.ts`;
   `semiMonthlyWindowAt` added to `lib/time/period-windows.ts`.
2. **Deduction config read live**, not snapshotted — consistent with the spec;
   prices stay snapshotted so gross is historically accurate.
3. **Card fee & supply** — resolved per service (`effectiveCardFee`), applied per
   `qty`; card fee only when the ticket is card-settled.
4. **Card-tip attribution** — card/gift tips only; proportional by service
   subtotal; largest-remainder rounding sums exactly.
5. **Tech attribution** — `ticket_items.assigned_staff_id` directly; `NOT NULL`
   for service lines, so no "unassigned service" edge case.
6. **Non-service items excluded** — only `kind='service'`; discounts/products dropped.
7. **"No deductions" is behavioral** — `totalDeductions === 0`; covers config-exempt
   and all-cash-no-supply; detail view omits deduction columns.
8. **Report subjects** — every service performer regardless of role; staff
   fetched by id with no `active` filter (removed techs still appear in the past).
9. **Distinct transaction count** — fixes the prototype's per-tech double-count;
   makes the FR-030 count match correct.
10. **Cross-page reconciliation** *(user-clarified)* — count + ticket set only;
    the report is self-contained; the two "gross revenue" metrics differ by
    tips/discounts by design.
11. **Client/server split** — full read model computed server-side; thin client
    island owns selected tech + expanded rows + Print + CSV.
12. **Missing service config** — degrade to default card fee, no supply.
13. **Print** — `window.print()` + `@media print` CSS hiding chrome.
14. **CSV** — pure `buildReportCsv`; browser download.
15. **Styling** — `styles/report.css` from `day-report-page.css`, self-contained,
    fully tokenised.
16. **Nav** — repurpose the disabled `day-report` placeholder into a live
    owner/manager `report` item.
17. **e2e isolation** — `report.spec.ts` in `main`; self-seeds a past window;
    asserts presence + reconciliation, never global counts.

## Phase 1 — Design & Contracts

- **Data model**: [data-model.md](./data-model.md) — the source tables read, the
  deduction & tip math, the `ReportTransaction` / `TechnicianReport` /
  `ReportTotals` / `ReportReadModel` read model, and the window model.
- **Contracts**: [contracts/report-read-model.md](./contracts/report-read-model.md)
  — the route + search-param contract, the query/projection signatures, the pure
  math seam (`splitCardTip` is the test-first piece), the window layer, the CSV
  format, the component contract, and the nav-config change.
- **Quickstart**: [quickstart.md](./quickstart.md) — how to run and verify the
  feature locally, including the gate set.
- **Agent context**: the `<!-- SPECKIT -->` plan pointer in `CLAUDE.md` is
  updated to this plan.

## Complexity Tracking

> No Constitution Check violations — this table is intentionally empty.
</content>
