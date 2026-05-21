# Implementation Plan: Payroll Page

**Branch**: `047-payroll-page` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/047-payroll-page/spec.md`

## Summary

Build a dedicated **Payroll** page (Lacquer "Pulse" variation) that replaces the salon's twice-monthly payroll spreadsheet. The page presents the open semi-monthly pay period as a full-width per-tech ledger; clicking a row routes to a dedicated tech-detail screen with a daily-activity chart, earnings breakdown, and pay action. Owners and managers record payouts (cash / Zelle / check) that persist as immutable snapshots; owners close periods, which freezes the figures and adds them to payroll history. Per-tech rates (service commission %, tip split %, check portion) become editable in Staff settings.

**Technical approach**: A new `app/(studio)/payroll/` route pair (ledger + `[staffId]` detail), a `lib/payroll/` data layer that **reuses** the existing Report aggregate (`lib/report/aggregate.ts` — deductions, `splitCardTip`) and the existing semi-monthly window helper (`lib/time/period-windows.ts` → `semiMonthlyWindowAt`), one new migration (`0021_payroll.sql`) adding two tables + three `staff` columns + three `SECURITY DEFINER` RPCs, and Server Actions following the established end-of-day pattern. UI is composed from `components/lacquer/payroll/*` over `components/ui/*` primitives, adapted from the vendored prototype.

## Technical Context

**Language/Version**: TypeScript 5.x · Next.js 16 (App Router, React Server Components + Server Actions) · React 19

**Primary Dependencies**: Supabase JS (Postgres / RLS / Auth) · shadcn/ui + Tailwind CSS + Lucide · the vendored Lacquer design system (`design-system/`, `styles/tokens.css`)

**Storage**: Supabase Postgres. New: tables `pay_periods` and `payroll_payouts`; columns `service_commission_pct`, `tip_split_pct`, `check_portion_cents` on `staff`; enums `pay_period_status`, `payout_method`; RPCs `payroll_record_payout`, `payroll_undo_payout`, `payroll_close_period`.

**Testing**: Vitest (unit — payroll money math, test-first per Constitution IV) · Playwright (e2e — one spec per user story, `US<n>:` describe convention)

**Target Platform**: Desktop-first web (the studio app); same chrome as Report / Transactions

**Project Type**: Web application — single Next.js app, App Router, server-authoritative

**Performance Goals**: Payroll ledger interactive in < 2 s on period open (SC-001). Aggregation scans ~2 weeks of `tickets`/`payments` for one salon — trivial volume.

**Constraints**: Tokens-only UI (Constitution I) · server-authoritative, no client business logic (II) · every mutation audited, money in integer cents, payouts snapshotted (III) · free-tier infra, no new paid services (V)

**Scale/Scope**: Single salon · ~7 active techs · 24 pay periods/year · 5 prioritized user stories · 1 new page + 1 detail route + a Staff-settings extension

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Design System Fidelity** (NON-NEGOTIABLE) | ✅ Pass | UI adapts the Lacquer "Payroll" prototype (V3 Pulse). FR-036 vendors `design-system/prototypes/payroll/` first (a prerequisite — Constitution I requires adapting a prototype that lives under `design-system/prototypes/`). Every value traces to `styles/tokens.css`; Lucide icons; shadcn primitives composed into `components/lacquer/payroll/*`. |
| **II. Server-Authoritative Architecture** | ✅ Pass | Ledger & detail are RSC reads. Mutations are Server Actions → `SECURITY DEFINER` RPCs via the service-role client. Role checks (owner/manager gate; owner-only for close + rate edit) enforced in Server Actions. Clients send only ids + method — never money figures. No Square calls in this feature. |
| **III. Auditability & Money Integrity** (NON-NEGOTIABLE) | ✅ Pass | Every payroll mutation writes `audit_log` inside the RPC transaction. Payouts store an immutable figure snapshot at payment (the "historical snapshot" rule). Money is integer cents. Undo writes the full undone snapshot into the audit payload before deleting the row, so nothing is silently lost. No idempotency keys needed (no external payment calls). |
| **IV. Test-First for Critical Paths** | ✅ Pass | Payroll earnings/payout math is new money logic → Vitest unit tests authored before implementation (`tests/unit/payroll/`). One Playwright e2e spec per user story in CI. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Payroll was a deferred v1 item under Constitution V. The maintainer approved this scope change and **the constitution was amended to v1.0.4 (2026-05-20)**, removing "payroll reporting" from the Principle V deferred list and from `docs/system-design.md`'s "Out (deferred)" list (payroll now appears in that doc's v1 "In" scope). No deviation remains. Scope is held minimal: no pay-stub emailing, no cash-drawer integration (both deferred in the spec); no new paid infrastructure. |

**Gate result**: PASS. No deviations — the former Principle V scope item was resolved by constitution amendment v1.0.4.

## Project Structure

### Documentation (this feature)

```text
specs/047-payroll-page/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities, schema, state transitions
├── quickstart.md        # Phase 1 — build/verify walkthrough
├── contracts/           # Phase 1 — interface contracts
│   ├── database-rpcs.md     # RPC signatures, validation, audit
│   ├── server-actions.md    # Server Action signatures & result shapes
│   └── read-model.md        # Page data contract (read model)
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
app/(studio)/payroll/
├── page.tsx                       # RSC — ledger (US1); ?period= & ?offset= & ?filter=
├── [staffId]/
│   └── page.tsx                   # RSC — tech detail screen (US2)
└── actions.ts                     # Server Actions: recordPayout, undoPayout, closePeriod

lib/payroll/
├── window.ts                      # Pay-period resolution (wraps semiMonthlyWindowAt); param parsing
├── queries.ts                     # loadPayrollLedger / loadTechDetail / loadPayrollHistory
├── aggregate.ts                   # Pure: applyRates, payout math, daily grouping, period totals,
│                                  #   merge of live-computed rows with frozen payout snapshots
├── csv.ts                         # buildPayrollCsv
└── format.ts                      # Period-label / pay-date helpers (reuses lib/dashboard/format)

components/lacquer/payroll/
├── payroll-header.tsx             # Eyebrow, period label, pay date, cash remaining, progress
├── payroll-period-switcher.client.tsx
├── payroll-kpis.tsx               # 4 KPI cards
├── payroll-ledger.tsx             # Full-width ledger table + footer totals
├── payroll-filters.client.tsx     # All / To pay / Paid tabs
├── payroll-export.client.tsx      # CSV export button
├── payroll-empty-state.tsx
├── payroll-history.client.tsx     # History view / sheet
├── tech-detail-header.tsx         # Avatar, state badge, "cash to hand over"
├── tech-detail-nav.client.tsx     # Back + prev/next
├── tech-daily-chart.tsx           # Large daily-activity chart
├── tech-breakdown.tsx             # Earnings breakdown
├── tech-pay-action.client.tsx     # Method tabs + mark-paid / undo / receipt
└── close-period-dialog.client.tsx # Close confirmation (names unpaid techs)

components/lacquer/staff/
└── payroll-rates-section.client.tsx   # New: commission %, tip %, check portion (US5)

app/(studio)/settings/staff/
├── actions.ts                     # EXTEND updateStaff: 3 new fields + validation + audit diff
└── _validation.ts                 # EXTEND: percentage (0–100) + check-portion validators

components/lacquer/sidebar/
└── nav-items.ts                   # EXTEND NAV_CONFIG.groups[operations]: add "Payroll" item

supabase/
├── migrations/0021_payroll.sql    # New tables, staff columns, enums, RPCs, RLS, indexes
└── seed.sql                       # EXTEND: seeded rates + 1 open + 1 closed period w/ payouts

lib/db/types.ts                    # REGENERATE after migration
lib/auth/audit.ts                  # EXTEND: payroll.* AuditAction members + entity-type mapping

design-system/prototypes/payroll/  # FR-036 — vendored prototype (source of truth)

tests/unit/payroll/
├── aggregate.test.ts              # Payout math, daily grouping, totals, snapshot merge
└── window.test.ts                 # Pay-period resolution & labels

tests/e2e/
├── payroll.spec.ts                # US1–US5 (describe blocks "US1:" … "US5:")
└── _affected-map.mjs              # EXTEND: map payroll paths → payroll.spec.ts
```

**Structure Decision**: Single Next.js App-Router web app. The Payroll feature mirrors the established **Report** feature topology — a route under `app/(studio)/`, a pure-logic + queries `lib/<feature>/` layer, and presentational components under `components/lacquer/<feature>/`. The detail screen is a real nested route (`/payroll/[staffId]`) rather than a client view-swap, giving native back/forward, deep links, and per-tech RSC data loading (satisfies FR-018/FR-019). Period selection rides URL search params (`?period=`, `?offset=`, `?filter=`) exactly as Report/Transactions do, so browser back restores ledger state.

## Complexity Tracking

No Constitution violations remain. Payroll was a deferred v1 item under Principle V; the maintainer approved the scope change and the constitution was amended to **v1.0.4** (2026-05-20) to bring payroll into v1 — so there is no deviation to justify.

The persistence model (durable `pay_periods` + `payroll_payouts` tables rather than an on-the-fly computed view) is not a complexity exception either: it is the system-of-record behavior the maintainer explicitly chose during `/speckit-clarify` (FR-025, FR-029, FR-031, SC-004/SC-006), and snapshotting historical records is itself a Constitution III requirement.
