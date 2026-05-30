# Implementation Plan: Payroll — Reversals & Adjustments

**Branch**: `053-payroll-reversals-adjustments` | **Date**: 2026-05-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/053-payroll-reversals-adjustments/spec.md`

## Summary

Two related payroll corrections (issue #154, follow-up to feature 052):

1. **Reversal-aware pay (Part 1).** Decouple the revenue Report from the payroll
   earnings source — both today share `loadReportPage` filtered to
   `status='paid'`, which silently drops every reversed sale. After: payroll
   counts `refunded` / `partially_refunded` tickets at **original** service
   amounts (tech keeps commission), still pays $0 for `void`; the Report shows
   revenue **net** of refunds. Delivered by widening the shared ticket fetch and
   making `projectReport` refund-aware (new `refundedCents`), with payroll
   reading the original figure and the Report reading original − refunded. No
   `applyRates` change. The refund-preserved note/flag UI is **omitted** (FR-006).

2. **Manual payout adjustments (Part 2).** A new `payout_adjustments` table +
   three SECURITY DEFINER RPCs let an owner/manager add, edit, and (hard-)delete
   signed adjustment lines on an **open** period for a tech **with work**, each
   with a required reason and full audit trail. Adjustments fold into a derived
   **net payout** (no payout-snapshot schema change) shown across the ledger
   (new Adj. / Net payout columns + KPI) and the tech detail (folded breakdown +
   net big number). Entry is a centered **Dialog** (FR-013). Once the period
   closes or the tech is paid out, the scope locks server-side (FR-012).

See [research.md](./research.md) for the decoupling decision (R1) and the
adjustments data design (R2–R3).

## Technical Context

**Language/Version**: TypeScript 5 · Next.js 16 (App Router, RSC + Server Actions) · React 18

**Primary Dependencies**: Supabase (Postgres/RLS, service-role RPC) · shadcn/ui + Tailwind + Lucide · Vitest · Playwright

**Storage**: Postgres via Supabase. New table `public.payout_adjustments`; new migration `0028`. No other schema change (refund rows from 052 already exist; `payroll_payouts` stays immutable).

**Testing**: Vitest (pure money math — `lib/report/aggregate.ts`, `lib/payroll/aggregate.ts`, test-first per Constitution IV) + Playwright e2e against seeded local Supabase (`payroll.spec.ts`, `report.spec.ts`, `refund-ticket.spec.ts`, `void-sale.spec.ts`).

**Target Platform**: Vercel-hosted web app; back-office payroll surface (owner/manager only).

**Project Type**: Web application (Next.js monolith) — existing structure, no new top-level layout.

**Performance Goals**: Page-load read budget stays tight — Part 1 adds **zero** new ticket queries (reuses the widened shared fetch); Part 2 adds one grouped `payout_adjustments` read per ledger/detail load and one per History load.

**Constraints**: Free-tier infra, ~$25–45/mo (Constitution V) — no new services. Server-authoritative (Constitution II): all writes via Server Actions → service-role RPC; client never trusted with money. Money integrity (Constitution III): refund allocation sums exactly; adjustments are explicit append rows; every write audited.

**Scale/Scope**: Single salon, ~6–10 staff, semi-monthly periods, a handful of adjustments per period — small data; correctness, not throughput, is the constraint.

## Constitution Check

*GATE: must pass before Phase 0 and again after Phase 1 design.*

- **I — Design System Fidelity**: ✅ The Dialog reuses the shadcn `Dialog`
  primitive already used by `close-period-dialog.client.tsx`; all adjustment
  styles are ported from the design handoff's `payroll/extra.css` resolving to
  existing `styles/tokens.css` tokens. The omitted refund-note is a deliberate
  scope cut (FR-006), not a fidelity gap. Lucide icons, 1.5px. Side-by-side
  check against the design's `screens/03-09-dialog.png` and `01-ledger.png`
  before "done".
- **II — Server-Authoritative**: ✅ Adjustment create/edit/delete go through
  Server Actions → service-role RPC; role gate (owner+manager) enforced in the
  action AND the lock in the RPC. No client DB writes. *Privileged-action PIN
  (II) note:* refunds/voids/settings require an inline manager-PIN; payroll
  adjustments are **not** in that set (consistent with `recordPayout`, which has
  no PIN), and the clarification confirmed no PIN — so this is compliant, not a
  deviation.
- **III — Auditability & Money Integrity**: ✅ Three new audited verbs
  (`payroll.adjustment_added/edited/removed`), delete audits before the row is
  gone. Refund allocation uses the exact `splitCardTip` largest-remainder
  (Σ = ticket refund). No money is silently mutated — adjustments are explicit
  signed rows; refunds remain the 052 `kind='refund'` rows.
- **IV — Test-First for Critical Paths**: ✅ The refund/adjustment math is money
  logic → Vitest cases written-to-fail first; a Playwright e2e ships for each
  user story (refund-keeps-commission, void-$0, add/edit/delete adjustment,
  closed-period lock).
- **V — Scope Discipline**: ✅ Payroll is in-scope (constitution 1.0.4 / feature
  047). No deferred items pulled in; the three explicit out-of-scope items
  (auto refund→pay coupling, clawback, per-tech refund attribution for pay) are
  honored. No new dependency or paid service.

**Result: PASS** (no violations; Complexity Tracking not required).

*Post-Phase-1 re-check:* the design (one new table, derived net payout, no
snapshot schema change, reused Dialog/action/RPC patterns) introduces no new
constitutional risk. **PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/053-payroll-reversals-adjustments/
├── plan.md            # this file
├── spec.md
├── research.md        # Phase 0 — R1 decoupling … R6 test footprint
├── data-model.md      # Phase 1 — payout_adjustments + projection type changes
├── quickstart.md      # Phase 1 — manual verification + gates
├── contracts/
│   ├── server-actions.md   # addAdjustment / editAdjustment / deleteAdjustment
│   ├── db-rpc.md           # 0028 RPCs + lock guard + RLS
│   └── read-model.md       # query-layer + UI component changes
└── checklists/requirements.md
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0029_payout_adjustments.sql        # NEW — table, RLS, 3 RPCs, assert helper

lib/
├── report/
│   ├── aggregate.ts                   # refund-aware projectReport (+refundedCents)
│   ├── queries.ts                     # widen ticket filter; fetch refund rows
│   └── csv.ts                         # net-revenue export
├── payroll/
│   ├── aggregate.ts                   # AdjustmentLine + net payout fold-in
│   └── queries.ts                     # load/group adjustments; history net total
└── auth/audit.ts                      # +3 payroll.adjustment_* verbs

app/(studio)/payroll/
├── actions.ts                         # +addAdjustment/editAdjustment/deleteAdjustment
└── [staffId]/page.tsx                 # render AdjustmentsCard

components/lacquer/payroll/
├── adjustments-card.client.tsx        # NEW — list + Dialog (AdjustmentForm)
├── payroll-ledger.tsx                 # +Adj. / Net payout columns
├── payroll-kpis.tsx                   # +Adjustments KPI; Cash-to-pay = net
├── tech-breakdown.tsx                 # fold adjustments → net payout
├── tech-detail-header.tsx             # net payout big number
└── tech-pay-action.client.tsx         # "Mark {net} paid"

components/lacquer/report/*, app/(studio)/report/*   # net-revenue display

styles/payroll.css                     # port .adj-*/.pp-adj-*/.pl-adj/.adj-modal-* (omit refund-note)

tests/
├── unit/report/aggregate.test.ts      # refund allocation + net (test-first)
├── unit/payroll/aggregate.test.ts     # adjustments + net payout (test-first)
└── e2e/{payroll,report,refund-ticket,void-sale}.spec.ts
supabase/seed*                          # add a refunded + a voided sale in the open period
```

**Structure Decision**: Extend the existing payroll/report feature slices
in-place — no new top-level modules. Part 1 lives in `lib/report` + `lib/payroll`
(math/queries) and the report UI; Part 2 adds one migration, one client
component, three actions, three RPCs, and column/KPI edits. This matches the
established 047 payroll layout and keeps the change legible.

## Build sequence (for `/speckit-tasks`)

Ordered so each step is independently testable and money math is proven first.

1. **Migration 0028** — `payout_adjustments` table, RLS, `payroll_assert_adjustable`, 3 RPCs.
2. **Audit verbs** — extend `AuditAction`.
3. **Part 1 math (test-first)** — refund-aware `projectReport` (+`refundedCents`, allocation); widen `loadReportPage` fetch; Report/CSV net display. Vitest + report e2e.
4. **Payroll earnings (test-first)** — confirm `projectPayrollLedger` keeps original commission once fed the widened set; add the refunded-ticket preservation unit test; refund/void payroll e2e.
5. **Adjustment read model** — `AdjustmentLine`, net payout in `projectPayrollLedger`; load/group in `lib/payroll/queries.ts`; history net total. Vitest.
6. **Server actions** — `addAdjustment` / `editAdjustment` / `deleteAdjustment` + `mapRpcError` tokens.
7. **UI** — `adjustments-card.client.tsx` (Dialog), ledger columns, KPIs, breakdown, header, pay-action; CSS port. Design-auditor pass.
8. **E2E + seed** — add/edit/delete adjustment, net payout, closed-period lock; seed a refunded + voided sale.
9. **Final gate** — full `format:check · lint · typecheck · test · test:e2e`.

## Complexity Tracking

No constitution violations — section intentionally empty.
