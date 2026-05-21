# Phase 0 Research: Payroll Page

All open questions from the Technical Context and the spec's deferred items are resolved below. Each item is **Decision / Rationale / Alternatives considered**.

## R1 — Card-tip data availability

**Decision**: Per-tech card tips are **derived**, not stored. Reuse the Report aggregate's `splitCardTip()` (largest-remainder allocation) which distributes a ticket's `payments.tip_cents` across the techs on that ticket, weighted by each tech's service subtotal.

**Rationale**: Migration `0008_square_terminal_payment.sql` relaxed `payments.tip_cents` from `check (tip_cents = 0)` to `check (tip_cents >= 0)` — card tips are real and captured on card-method payment rows. There is **no `tip_splits` table**; `lib/report/aggregate.ts` already computes the per-tech split deterministically and is unit-tested (Constitution IV). Payroll consumes the same `projectReport()` output. (This corrects an earlier exploration note that referenced a `tip_splits` table — none exists.)

**Alternatives considered**: A persisted `tip_splits` table — rejected: needless schema, and the deterministic on-the-fly split is already proven. Recording cash tips — rejected: out of scope (spec FR-010; cash tips pass client→tech and are never recorded).

## R2 — Income basis for the commission calculation

**Decision**: Apply each tech's service commission % to **commissionable service income** = the Report aggregate's per-tech `commissionableCents` (`grossCents − cardFeeCents − supplyCents`, honoring `staff.card_fee_exempt` and `supply_mode`/`supply_except` from spec 023).

**Rationale**: Clarified with the maintainer on 2026-05-20 (spec Clarifications). The app already computes this exact figure in `lib/report/aggregate.ts::projectReport`; reusing it keeps payroll and the Report page consistent and avoids a second deduction implementation. The salon-level "Gross service income" KPI remains gross (a separate top-line measure).

**Alternatives considered**: Commission on gross service revenue (prototype mock data) — rejected by the maintainer. Itemizing deductions as separate post-commission line items — rejected: adds columns the Pulse layout doesn't have.

## R3 — Reuse of the Report data layer

**Decision**: `lib/payroll/queries.ts` calls the existing Report query + projection to obtain per-tech `{ commissionableCents, cardTipsCents, transactions[] }` for a pay-period window, then `lib/payroll/aggregate.ts` (pure) applies rates, computes payout math, groups transactions into per-day activity, and merges in frozen payout snapshots.

**Rationale**: `projectReport()` is pure and already returns everything payroll needs as inputs. The semi-monthly window (`semiMonthlyWindowAt` in `lib/time/period-windows.ts`) is the native payroll period. Building on proven, tested code satisfies Constitution IV and V (simplest mechanism).

**Alternatives considered**: A bespoke payroll SQL aggregation — rejected: duplicates deduction + tip-split math, drift risk. A database view — rejected: the largest-remainder tip split is awkward in SQL and already exists in TS.

## R4 — Pay-period lifecycle & creation

**Decision**: Pay periods are **semi-monthly** (1st–15th, 16th–end of month). A `pay_periods` row is **lazily created** the first time the page resolves a period that has no row — the page's loader calls a small `ensure`-style path (mirroring the cash-drawer RPC's "insert if not exists"). `pay_date = ends_on + 2 days`, stored at creation. A period is `open` until an owner closes it.

**Rationale**: Lazy creation avoids a cron/scheduler (Constitution V — simplest mechanism; the app already uses "webhook + poll" over cron). The cash-drawer RPC (`pos_close_cash_drawer`) already establishes the lazy-open insert-if-not-exists pattern. `ends_on + 2 days` matches the prototype's pay dates (May 1–15 → May 17; Apr 16–30 → May 2).

**Alternatives considered**: A scheduled job that pre-creates periods — rejected: new infra, against Constitution V. Owner-entered pay date per period — rejected: unnecessary input; the +2-day rule is predictable and editable later if ever needed.

## R5 — Where the payout snapshot is computed

**Decision**: The **Server Action** recomputes the tech's payroll figures fresh (via `lib/payroll/aggregate`) at the moment of mark-paid, then passes the snapshot to the `payroll_record_payout` RPC. The client sends only `{ payPeriodId, staffId, method }` — no money figures. The RPC validates (period open, tech eligible, not already paid) and stores the snapshot + audit atomically.

**Rationale**: Payroll earnings math (deductions, largest-remainder tip split) is complex and already lives, tested, in TypeScript. Reimplementing it in plpgsql would duplicate logic and invite drift. Computing in the Server Action keeps authority server-side (Constitution II — the client is never trusted with money); the RPC remains the atomic transaction + audit boundary.

**Alternatives considered**: Re-derive figures inside the RPC (the cash-drawer "stale-data guard" pattern) — rejected: the cash-drawer guard works because its quantity (sum of cash payments) is trivial in SQL; payroll's is not. Trusting client-supplied figures — rejected outright (Constitution II/III).

## R6 — Closed-period immutability for unpaid techs

**Decision**: `payroll_close_period` snapshots **every eligible tech** for the period. Paid techs already have a `payroll_payouts` row; for each eligible-but-unpaid tech the RPC inserts a frozen row (`paid = false`, method/paid_on/recorded_by null) carrying the computed snapshot. The Server Action computes those snapshots and passes them as a JSONB array. After close, the ledger reads exclusively from `payroll_payouts` rows.

**Rationale**: FR-031 requires a closed period's figures to be immutable. Pending techs have no payout row in an open period (rows mean "recorded"), so closing must materialize their snapshot. A uniform per-tech row keeps the closed-period read identical to the open-period paid read and keeps History queryable.

**Alternatives considered**: A single JSONB blob on `pay_periods.closed_snapshot` — rejected: less queryable for History totals, breaks the uniform per-tech read. Recomputing closed periods live — rejected: violates FR-031.

## R7 — Tech detail: route vs. client view-swap

**Decision**: A real nested route, `app/(studio)/payroll/[staffId]/page.tsx`, carrying the period via search params. Back returns to `/payroll?period=…&offset=…&filter=…`; prev/next link to sibling `[staffId]` routes.

**Rationale**: Real routes give native browser back/forward, deep links, and per-tech RSC data loading. FR-019's "back restores ledger scroll & filter state" works because filter lives in the URL and the browser restores scroll on back.

**Alternatives considered**: Client-side `route` state (as the prototype does) — rejected: loses deep-linking and RSC loading, and reimplements history.

## R8 — Persistence of per-tech rates & the closed-period rate question

**Decision**: Three columns on `staff`: `service_commission_pct numeric(5,4)` (fraction 0–1), `tip_split_pct numeric(5,4)` (0–1), `check_portion_cents int` (≥ 0). These are the *current* rates, edited via the existing `updateStaff` Server Action. Closed periods do **not** read live rates — they read frozen `payroll_payouts` snapshots — so no per-period rate history table is needed.

**Rationale**: Rates are a property of employment (maintainer's clarified choice — Staff settings). `numeric(5,4)` as a 0–1 fraction matches the prototype data (`0.90`, `0.65`). The payout snapshot already freezes the *outcome*; freezing the rate is unnecessary for correctness, though the snapshot also stores the two pcts for receipt/audit display (FR-023 shows "65% of $X").

**Alternatives considered**: A `staff_payroll_rates` history table keyed by period — rejected: the payout snapshot makes it redundant (Constitution V — no speculative generality). Basis-points integers — rejected: `numeric` is exact and the codebase already uses `numeric` for `discount_pct`.

## R9 — Undo and the "money is never silently deleted" rule

**Decision**: `payroll_undo_payout` is permitted only on an **open** period. It writes the full payout snapshot into the `audit_log` payload (`action = 'payroll.payout_undone'`) **before** deleting the `payroll_payouts` row, in one transaction.

**Rationale**: Constitution III forbids silently destroying financial records. A payout is not a `payments` row (no `kind='refund'` linkage applies), but the undo must remain fully traceable — the append-only `audit_log` retains the complete undone snapshot. Hard-deleting the row keeps the `unique(pay_period_id, staff_id)` constraint and the open-period model clean (no row = pending).

**Alternatives considered**: Soft-delete (`voided_at`) — rejected: complicates the unique constraint and the "row exists ⇔ recorded" invariant; the audit log already provides the durable trail.

## R10 — Role enforcement granularity

**Decision**: Page access (owner + manager) and the owner-only actions (edit rates, close period) are enforced in **Server Actions / page guards** in TypeScript, copying the Report page's `viewer.staff.role` check. RLS stays the project-standard `select … to authenticated using (true)` with all writes via service-role RPCs.

**Rationale**: Matches Constitution II ("RLS is a backstop … never the primary authorization layer") and every existing feature. The nav item's `roles: ["owner","manager"]` is UX-only filtering; the route's own redirect is the security boundary.

**Alternatives considered**: Role-aware RLS policies — rejected: the codebase deliberately keeps RLS simple and enforces authorization in Server Actions.

## R11 — E2E test scoping (parallel-safe)

**Decision**: `payroll.spec.ts` runs in the parallel `main` Playwright project. It uses the worker-scoped staff fixture (`tests/e2e/_fixtures.ts`) and seeds its own pay period + tickets with unique-prefix UUIDs, asserting per-tech rows for *its* techs. It does **not** assert salon-wide period KPI totals (those race the shared `tickets`/`payments` tables). If a period-total assertion is genuinely needed, that single test is split into a baseline project per the CLAUDE.md "two-phase e2e" rule.

**Rationale**: The Payroll ledger aggregates over shared tables; only worker-scoped data is race-safe to assert, exactly as `report.spec.ts` and `transactions.spec.ts` do. Add `tests/e2e/_affected-map.mjs` entries so phase gates pull the spec in.

**Alternatives considered**: Making the whole spec a baseline project — rejected: most of it (per-tech rows, navigation, pay/undo) is parallel-safe; only a global-total assertion would not be, and that is avoidable.

## R12 — Vendoring the design prototype (FR-036)

**Decision**: Copy the handoff's `prototypes/payroll/` (`Payroll.html`, `payroll.css`, `Components.jsx`, `data.jsx`, `PayrollLedger.jsx`, `PayrollStack.jsx`, `PayrollPulse.jsx`, `design-canvas.jsx`, `tweaks-panel.jsx`, `_studio-shell.css`, `lacquer-mark.svg`) into `design-system/prototypes/payroll/`. This is a build prerequisite: Constitution I requires UI to adapt a prototype that lives under `design-system/prototypes/`.

**Rationale**: The repo's `design-system/` is a vendored snapshot that predates the payroll prototype. The maintainer explicitly asked for the prototype to be added. Vendoring it makes it the in-repo source of truth for side-by-side design verification.

**Alternatives considered**: Re-exporting the entire Lacquer handoff zip over `design-system/` — rejected: out of scope, would churn unrelated files; CLAUDE.md's "single commit" sync rule is for a full design-system refresh, not one feature.
