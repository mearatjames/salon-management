# Phase 0 — Research: Report Page

**Feature**: 046-report-page · **Date**: 2026-05-20

The spec went through `/speckit-clarify` (3 answers) and one further plan-time
clarification (R10 below). This document records every design decision the plan
depends on. Each entry: **Decision · Rationale · Alternatives rejected**.

---

## R1 — Period model & the semi-monthly window

**Decision**: The report's period control is `Day / Week / Semi-monthly`
(`?period=day|week|semi`), defaulting to **Day, current period**. A new
`lib/report/window.ts` mirrors `lib/transactions/window.ts`: `parseReportPeriodParams`
sanitises the raw search params, `resolveReportWindow` produces a fully-described
`ReportWindow` (UTC bounds + labels). Timezone math is delegated to
`lib/time/period-windows.ts`, which gains one new helper —
`semiMonthlyWindowAt(tz, now, offset)`.

`semiMonthlyWindowAt` treats each calendar month as **two** periods: the 1st–15th
and the 16th–last-day. It indexes half-months as `year*24 + month*2 + half`
(`half ∈ {0,1}`), applies the integer `offset`, and decodes back — so backward
stepping crosses month boundaries correctly despite the irregular (15 vs 13–16
day) period lengths.

**Rationale**: The constitution mandates a single `lib/time/*` timezone surface;
`day`/`week` already have offset-aware helpers (`dayWindowAt` / `weekWindowAt`),
so only `semi` is new. Indexing half-months avoids fragile `+15 days` arithmetic
(the prototype's `n.setDate(n.getDate() + d*15)` drifts across months).

**Alternatives rejected**: Reusing the Transactions page's `today/week/month`
control — the spec (Clarifications, Assumptions) explicitly keeps the prototype's
`Day/Week/Semi-monthly` because the report is payroll-adjacent and Semi-monthly
mirrors the salon's pay period.

## R2 — Deduction configuration is read live, not snapshotted

**Decision**: The report computes deductions from the **current**
`services.card_fee_mode` / `card_fee_custom_cents` / `supply_amount_cents` /
`supply_type_id` and the **current** `staff.card_fee_exempt` / `supply_mode` /
`supply_except`. These columns are not snapshotted onto `ticket_items` — only the
price (`unit_price_cents`) is snapshotted.

**Rationale**: The spec's Key Entities section names "Deduction policy inputs" as
*"existing entities the report reads, not created here,"* and every deduction FR
is written in the present tense (*"when the service **is** configured as
card-fee-exempt"*). The report is a derived analytical view, not a financial
ledger row. Snapshotting would require a schema migration, which Constitution V
forbids without a documented scope change. Ticket **prices** remain snapshotted,
so gross earnings are always historically accurate; only the deduction *rule*
follows current config.

**Alternatives rejected**: Adding deduction-snapshot columns to `ticket_items` —
a migration, out of scope, and unnecessary for a single salon that changes
deduction policy rarely.

## R3 — Card fee & supply: resolution and per-unit application

**Decision**: For one service line item (`kind='service'`, `qty` units):

- **Card fee** applies when the transaction is *card-settled* AND the performing
  technician is not `card_fee_exempt`. Per-unit amount =
  `effectiveCardFee(service)`: `card_fee_mode='default'` →
  `DEFAULT_CARD_FEE_CENTS` (300, from `lib/services/card-fee-default.ts`);
  `'custom'` → `card_fee_custom_cents`; `'exempt'` → 0. Line total = per-unit × `qty`.
- **Supply** applies when the service has a `supply_amount_cents` AND the
  technician's supply policy admits it: `supply_mode='apply'` → apply;
  `'exempt'` → skip; `'partial'` → apply unless `service.supply_type_id ∈
  staff.supply_except`. Line total = `supply_amount_cents × qty`.
- *Card-settled* = any succeeded payment on the ticket has `method ∈
  {card, gift}` (a split cash+card ticket is card-settled — Edge Cases).

**Rationale**: `DEFAULT_CARD_FEE_CENTS` and the `effectiveCardFee` resolution
already exist (`021-services-deductions`); the report reuses the constant.
Per-`qty` application matches the prototype (`3 * qty`, `5 * qty`) and the
semantics — a `qty` of 2 means the service was performed twice, so two card
swipes / two supply draws.

**Alternatives rejected**: Per-line (qty-insensitive) application —
inconsistent with the prototype and with `serviceCount = Σ qty`.

## R4 — Card-tip attribution & rounding

**Decision**: A transaction's **card tip** = Σ `tip_cents` over succeeded
payments whose `method ∈ {card, gift}` (cash-payment tips are excluded —
FR-019). That card tip is split across the transaction's technicians in
proportion to each technician's share of the transaction's **service subtotal**.
Splitting uses the **largest-remainder method** in integer cents: floor each
tech's share, then hand the leftover cents one-by-one to the techs with the
largest fractional remainders. Σ shares == the card tip exactly.

**Rationale**: FR-020 and the Assumptions mandate proportional-by-service-subtotal
attribution. Largest-remainder guarantees the Edge Case "*split tips never cause
a technician's parts to drift from the transaction or period totals*" and keeps
SC-002 (totals reconcile to 100%) exact.

**Alternatives rejected**: Reading a `tip_splits` table — no such table exists in
the current schema (the constitution names it as a *designed* entity, but no
migration has created it). Naive per-tech rounding — drifts by ±1¢.

## R5 — Service-to-technician attribution

**Decision**: Each service line is attributed to `ticket_items.assigned_staff_id`
directly. `assigned_staff_id` is `NOT NULL` for `kind='service'` rows (schema
0004); only `kind='discount'` rows carry a null tech.

**Rationale**: The real schema records the performing tech per line — the spec
(Assumptions: "*Each service line item carries the technician who performed
it*") says to use it directly. There is therefore **no "unassigned service"
edge case** for the report to handle.

**Alternatives rejected**: The prototype's index-based distribution
(`drTechItems` — tech *i* gets item *i*) — a mock-data crutch the real schema
makes obsolete.

## R6 — Non-service line items

**Decision**: Only `kind='service'` items contribute to gross earnings,
deductions, the service count, and the tip-split weighting. `discount` and
`product` lines are ignored entirely (FR-009). The seed's Ticket 5 carries a
`kind='discount'` line (null `ref_id`, null `assigned_staff_id`, negative
price) — it must not appear under any technician.

**Rationale**: FR-009. A discount is salon-level, earned by no technician; a
product is deferred scope (Constitution V — no products in v1).

## R7 — "Exempt" / "no deductions" is behavioral, not config-derived

**Decision**: A technician is shown with the "No deductions" / "Exempt"
indicator, and their detail view omits the deduction columns, **iff their
computed total deductions for the period are exactly 0**. The report does not
read a single "exempt" flag.

**Rationale**: This one rule satisfies every relevant requirement at once:
FR-018 ("*a technician with no deductions applied*"), FR-025 ("*for an exempt
technician … omit the deduction columns*"), US1-AS3 (fully-exempt tech), and the
"Partially exempt technician" edge case (a tech with *some* deductions is
correctly *not* flagged). A fully config-exempt tech naturally computes to 0; so
does a tech whose period was all-cash with no supply services — and "no
deductions" is accurate for both.

**Alternatives rejected**: The prototype's binary `isExempt` set
(`{maya, linh}`) — a hardcoded mock; cannot express partial supply exemption.

## R8 — Report subjects: who is a row

**Decision**: A report row exists for every staff member with ≥1 `kind='service'`
item in the window, **regardless of role** (FR-008a — owners/managers who do
nails included). Staff rows are fetched **by id, without the `active` filter**,
so a removed/inactive technician still appears in a past period where they
worked (Edge Case "Inactive or removed technician with past activity").

**Rationale**: FR-008a and FR-010 define the subject set by *activity*, not
role. The existing `queryStaffRoster` filters `active=true` — the report needs a
different fetch (`.in("id", performerIds)`, no active filter).

## R9 — Transaction count is distinct, not summed-per-tech

**Decision**: The period-level transaction count (summary strip, "All Staff"
button) is the count of **distinct paid tickets** in the window. The per-tech
"clients / transactions" count stays per-tech (tickets that tech appears on).

**Rationale**: The prototype computes the grand total as `Σ per-tech txCount`,
which **double-counts** every multi-technician transaction. Distinct-ticket
counting is correct and is what makes FR-030's "transaction count matches the
Transactions page" achievable.

**Alternatives rejected**: Keeping the prototype's summed count — a prototype
bug; would never match the Transactions page.

## R10 — Cross-page reconciliation with the Transactions page (plan-time clarification)

**Decision** *(user-confirmed, 2026-05-20)*: The report is **self-contained** —
it issues no query against, and does not import, any Transactions-page code or
data. FR-030/SC-004 are satisfied by: (a) the report's transaction count equals
the Transactions page's for the same day (both count distinct paid tickets — R9),
and (b) both surfaces project the identical set of paid tickets. The report's
"gross revenue" is **gross service earnings** (Σ service-line prices, pre-deduction,
excluding tips, tax, and discounts) and is *intentionally a different metric*
from the Transactions page's tip-inclusive "gross revenue" KPI. The spec's FR-030
and SC-004 were reworded to state this; the Clarifications section records the Q/A.

**Rationale**: The report (payroll-prep: what each tech earned) and the
Transactions page (sales ledger: money in) answer different questions. With tips
and discounts present — the seed ships a discount ticket — the two "gross"
figures cannot be byte-identical, and forcing them to roll up would mix the two
concerns. Matching on count + ticket set keeps the surfaces provably consistent
without coupling.

**Alternatives rejected**: Redefining the report's gross as Σ ticket subtotals
(breaks the totals-row = Σ-tech-rows reconciliation, SC-002, once discounts
appear); adding tip/discount roll-up lines to the report (mixes payroll and
sales-ledger concerns — most complex).

## R11 — Client / server split

**Decision**: The Server Component (`app/(studio)/report/page.tsx`,
`force-dynamic`) role-gates, resolves the window from `?period=&offset=`, runs
every query, and computes the **entire** read model server-side (per-tech stats,
deductions, tip splits, grand totals — all pure functions). It hands a plain
serialisable payload to a thin client island that owns only: the selected
technician, the set of expanded transaction rows, and the Print / Export
handlers. Period stepping is plain server navigation (`<Link>` → new search
params → fresh RSC render).

**Rationale**: Mirrors `045-transactions-page` and the dashboard's
"re-query on every navigation" freshness model. Heavy aggregation server-side
keeps the client bundle thin and the math testable in isolation. No timezone
data crosses to the client (the server pre-formats every time string).

## R12 — Missing / deleted service configuration

**Decision**: A `kind='service'` line whose `ref_id` does not resolve to a
current `services` row (service hard-deleted) still counts toward the tech's
gross (the price snapshot is on the line). Its deductions degrade gracefully:
card fee is treated as `mode='default'` (`DEFAULT_CARD_FEE_CENTS`), supply is
treated as absent.

**Rationale**: Gross must stay accurate (the price is snapshotted). Card fee
defaults to the salon-wide floor — the most common configuration — rather than
silently dropping a deduction. Supply cannot be invented without a
`supply_amount_cents`, so it is omitted.

## R13 — Print

**Decision**: Print is `window.print()` plus an `@media print` block in
`styles/report.css` that hides the studio sidebar, top bar, period controls, and
the Print/Export buttons. Because `window.print()` captures the live DOM,
whichever view is on screen (All-Staff overview or a technician's detail) is what
prints — satisfying the clarified FR-027 with no extra rendering path.

## R14 — CSV export

**Decision**: A pure `buildReportCsv(report, window)` in `lib/report/csv.ts`
produces the CSV string (one row per technician + a `TOTAL` row; columns: Tech,
Exempt, Services, Gross, Card Fee, Supply, Total Deductions, Commissionable,
Card Tips). The client island triggers a browser download via a
`data:text/csv` anchor, filename `Report-<rangeLabel>.csv`.

**Rationale**: FR-028. Pure builder ⇒ unit-testable; matches the prototype's
`exportCSV`. Browser-side generation needs no server round-trip (Assumptions).

## R15 — Styling

**Decision**: One page-scoped stylesheet `styles/report.css`, adapted from
`design-system/prototypes/transaction/day-report-page.css`, with **every** value
resolved to a `styles/tokens.css` token. The prototype's raw `oklch(...)` colors
(avatar tones, pay-method badges, positive/negative figures) are replaced with
tokens / existing tokenised components. The page chrome reads identically to the
Transactions page by resolving to the **same tokens** — not by importing
`transactions.css` (the repo convention is one stylesheet per page:
`dashboard.css`, `end-of-day.css`, …).

**Rationale**: Constitution Principle I — tokens, not raw values; adapt the
prototype. "Reuse the chrome" (spec Assumptions) is satisfied by visual/structural
fidelity through shared tokens. Route-scoped CSS imports mean `report.css` and
`transactions.css` never load together, so prototype class names (`dr-*`, `tp-*`)
carry over without collision.

## R16 — Sidebar navigation

**Decision**: Repurpose the existing disabled `day-report` placeholder in the
Operations group of `components/lacquer/sidebar/nav-items.ts` into a live item:
`{ id: "report", label: "Report", icon: FileBarChart, href: "/report",
roles: ["owner","manager"] }` — `disabled`/`href:null` removed, `roles` added
(the same role-gate pattern `045` added for `transactions`).

**Rationale**: FR-001 (replace the disabled "Day Report" placeholder), FR-002
(owner/manager only). The `id` changes `day-report` → `report` so it matches the
`/report` segment (the config's convention); `sidebar.spec.ts`'s
`EXPECTED_NAV_IDS` and any nav-config unit test update in lockstep.

## R17 — e2e isolation

**Decision**: `tests/e2e/report.spec.ts` runs in the parallel `main` project
(not a baseline phase). It self-seeds its fixture — a couple of services with
known deduction config, an exempt/partially-exempt staff state, and paid tickets
— into a **past** period, using the worker-scoped staff trio from
`tests/e2e/_fixtures.ts`. Assertions are **presence + internal reconciliation**
(seeded techs appear; the totals row equals the sum of the *rendered* rows;
drill-in / expand / role-gate / empty-state / CSV behaviour) — never a global
period-wide count.

**Rationale**: The report renders every tech in the window, so an exact
period-wide count would race the parallel pool (same hazard `dashboard.spec.ts`
hits). Presence + "totals == Σ rendered rows" hold no matter how many other
workers' rows share the period, so the spec is parallel-safe and needs no
baseline project. Mirrors how `transactions.spec.ts` self-seeds and asserts
presence.
</content>
</invoke>
