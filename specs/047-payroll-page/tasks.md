---
description: "Task list for the Payroll Page feature"
---

# Tasks: Payroll Page

**Input**: Design documents from `/specs/047-payroll-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks ARE included — Constitution IV (Test-First for Critical Paths) requires unit tests, written first, for all new payroll money math, and one Playwright e2e per feature.

**Organization**: Tasks are grouped by user story. US1 is the MVP. US2–US4 build incrementally on the prior story (the Pulse pay action lives on the detail screen, so US3 needs US2; closing needs payouts, so US4 needs US3). US5 is independent of US2–US4 but verifies against US1's ledger.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 — only on user-story phase tasks
- Every task lists an exact file path

## Path Conventions

Single Next.js App-Router web app. New code under `app/(studio)/payroll/`, `lib/payroll/`, `components/lacquer/payroll/`; the migration under `supabase/migrations/`; tests under `tests/unit/payroll/` and `tests/e2e/`. Paths follow plan.md → Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the design source of truth available before any UI work (Constitution I requires UI to adapt a prototype that lives under `design-system/prototypes/`).

- [ ] T001 Vendor the Lacquer payroll prototype into `design-system/prototypes/payroll/` — copy `Payroll.html`, `payroll.css`, `Components.jsx`, `data.jsx`, `PayrollLedger.jsx`, `PayrollStack.jsx`, `PayrollPulse.jsx`, `design-canvas.jsx`, `tweaks-panel.jsx`, `_studio-shell.css`, `lacquer-mark.svg` from the Lacquer "Payroll" handoff (FR-036, research R12).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, generated types, seed data, audit vocabulary, and the pay-period helper that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Create migration `supabase/migrations/0021_payroll.sql` — enums `pay_period_status` & `payout_method`; `alter table public.staff add column` for `service_commission_pct`, `tip_split_pct`, `check_portion_cents`; tables `pay_periods` and `payroll_payouts` with all constraints and indexes; `select`-only RLS policies; and the three `security definer` RPCs `payroll_record_payout`, `payroll_undo_payout`, `payroll_close_period` — exactly per `data-model.md` and `contracts/database-rpcs.md`.
- [ ] T003 Apply the migration with `supabase db reset`, then regenerate `lib/db/types.ts` via `npx supabase gen types typescript --local > lib/db/types.ts` (depends on T002).
- [ ] T004 Extend `supabase/seed.sql` — a guarded `do $$` block keyed to the seeded staff UUIDs: seeded payroll rates on the three seed staff, one open pay period (2026-05-16 – 31), and one closed pay period (2026-05-01 – 15) with a few frozen `payroll_payouts` rows, per data-model.md → "Seed data" (depends on T002).
- [ ] T005 [P] Extend `lib/auth/audit.ts` — add `payroll.payout_recorded`, `payroll.payout_undone`, `payroll.period_closed` to the `AuditAction` union and map the `payroll.` action prefix to `entity_type = "payroll"` in `deriveEntityType`.
- [ ] T006 [P] Write failing unit test `tests/unit/payroll/window.test.ts` — semi-monthly pay-period resolution, period labels/short-labels, `pay_date = ends_on + 2 days`, and `parsePayrollParams` (offset clamp, filter parsing).
- [ ] T007 Implement `lib/payroll/window.ts` — `PayPeriodRef`, `resolvePayPeriod` (wraps `semiMonthlyWindowAt` from `lib/time/period-windows.ts`), `parsePayrollParams`; make T006 pass (depends on T006).

**Checkpoint**: Schema, types, seed, audit vocabulary, and period resolution are ready — user stories can begin.

---

## Phase 3: User Story 1 - Review the open pay period's payroll ledger (Priority: P1) 🎯 MVP

**Goal**: An owner/manager opens **Payroll** from the side nav and sees the open period's full-width per-tech ledger — income, after-split, tips, after-split, check, cash, state — with KPI cards, a period header, filters, footer totals, and CSV export.

**Independent Test**: Open Payroll from the menu as an owner; confirm the ledger lists every active tech with computed values that match a hand calculation, and that the KPI cards and footer totals reconcile to the row sums.

### Tests for User Story 1

> Write T008 FIRST and confirm it FAILS before implementing T009 (Constitution IV — money math is test-first).

- [ ] T008 [P] [US1] Write failing unit tests `tests/unit/payroll/aggregate.test.ts` — `applyRates` (commission % and tip % applied to commissionable income / card tips), cash-payment clamp `max(0, incomeAfterSplit + tipsAfterSplit − checkPortion)`, period totals, ledger-row state derivation (`pending`/`paid`/`no_work`/`unpaid_closed`), and the merge of frozen `payroll_payouts` snapshots over live-computed rows.

### Implementation for User Story 1

- [ ] T009 [US1] Implement `lib/payroll/aggregate.ts` — pure ledger projection: `applyRates`, payout math + clamp, `PayrollLedgerRow` / `PayrollLedgerTotals` / `PayrollLedgerModel` shapes, row-state derivation, and snapshot merge; make T008 pass (depends on T008).
- [ ] T010 [US1] Implement `lib/payroll/queries.ts` `loadPayrollLedger` — resolve the period, lazily ensure the `pay_periods` row, reuse the Report query + `projectReport()` (`lib/report/`) for the period window to get per-tech `commissionableCents`/`cardTipsCents`, read `payroll_payouts`, and assemble `PayrollLedgerModel` per `contracts/read-model.md` (depends on T009).
- [ ] T011 [P] [US1] Implement `lib/payroll/csv.ts` `buildPayrollCsv` — header row + one row per tech + a totals row, mirroring `lib/report/csv.ts`.
- [ ] T012 [P] [US1] Implement `lib/payroll/format.ts` — period-label and pay-date display helpers (reusing `lib/dashboard/format.ts` and `lib/time/format.ts`).
- [ ] T013 [P] [US1] Add the **Payroll** nav item to `components/lacquer/sidebar/nav-items.ts` — Operations group, a Lucide icon, `href: "/payroll"`, `roles: ["owner", "manager"]` (FR-001).
- [ ] T014 [P] [US1] Build `components/lacquer/payroll/payroll-header.tsx` (eyebrow, period label, pay date, cash remaining, progress) and `components/lacquer/payroll/payroll-kpis.tsx` (4 KPI cards).
- [ ] T015 [P] [US1] Build `components/lacquer/payroll/payroll-ledger.tsx` (full-width table + footer totals row) and `components/lacquer/payroll/payroll-empty-state.tsx`.
- [ ] T016 [P] [US1] Build client components `components/lacquer/payroll/payroll-filters.client.tsx` (All / To pay / Paid), `payroll-period-switcher.client.tsx`, and `payroll-export.client.tsx` (CSV download).
- [ ] T017 [US1] Implement `app/(studio)/payroll/page.tsx` — RSC: owner/manager role gate (copy the Report-page guard), parse `?period`/`?offset`/`?filter`, call `loadPayrollLedger`, default to the open period, render header + KPIs + ledger + filters + period switcher + export (depends on T010, T013, T014, T015, T016).
- [ ] T018 [US1] Create `tests/e2e/payroll.spec.ts` with the `US1:` describe block (worker-fixture-scoped per-tech assertions only — no salon-wide period totals — so it stays parallel-safe in the `main` project, research R11), and add `app/(studio)/payroll/**`, `lib/payroll/**`, `components/lacquer/payroll/**` → `tests/e2e/payroll.spec.ts` to `tests/e2e/_affected-map.mjs`.

**Checkpoint**: Payroll is reachable from the nav and shows an accurate open-period ledger — a working MVP that replaces the spreadsheet's calculation.

---

## Phase 4: User Story 2 - Open a tech's detail screen (Priority: P2)

**Goal**: Clicking a ledger row routes to a dedicated full-screen tech detail — daily-activity chart, quick stats, earnings breakdown, back + prev/next navigation.

**Independent Test**: Click a tech row; confirm a dedicated detail screen opens with that tech's daily chart, quick stats, and breakdown; use prev/next and back.

### Tests for User Story 2

- [ ] T019 [P] [US2] Extend `tests/unit/payroll/aggregate.test.ts` with failing tests for daily-activity grouping — per-day income/tips/ticket counts, `bestDay`, `avgPerWorkingDay`, `workingDayCount`, closed-day detection.

### Implementation for User Story 2

- [ ] T020 [US2] Extend `lib/payroll/aggregate.ts` — `DayActivity` grouping from the period's transactions plus `bestDay` / `avgPerWorkingDay` / `workingDayCount`; make T019 pass (depends on T019).
- [ ] T021 [US2] Extend `lib/payroll/queries.ts` — `loadTechDetail` returning `TechDetailModel` (single tech, `days[]`, prev/next ledger-order neighbours) per `contracts/read-model.md` (depends on T020).
- [ ] T022 [P] [US2] Build `components/lacquer/payroll/tech-detail-header.tsx` (avatar, state badge, "cash to hand over") and `components/lacquer/payroll/tech-breakdown.tsx` (earnings breakdown).
- [ ] T023 [P] [US2] Build `components/lacquer/payroll/tech-daily-chart.tsx` — the large daily-activity chart (per-day income + card-tip bars, best-day highlight, closed days).
- [ ] T024 [P] [US2] Build `components/lacquer/payroll/tech-detail-nav.client.tsx` — back-to-ledger control + prev/next tech controls (disabled at first/last).
- [ ] T025 [US2] Implement `app/(studio)/payroll/[staffId]/page.tsx` — RSC tech detail: role gate, `loadTechDetail`, render header + chart + breakdown + nav; and make `payroll-ledger.tsx` rows link to `/payroll/[staffId]` carrying the period params (depends on T021, T022, T023, T024).
- [ ] T026 [US2] Extend `tests/e2e/payroll.spec.ts` — `US2:` describe block (open detail, prev/next, back).

**Checkpoint**: Ledger + detail screen both work — the full Pulse review surface.

---

## Phase 5: User Story 3 - Mark a tech paid and record the payment method (Priority: P3)

**Goal**: An owner/manager records a payout (cash / Zelle / check) from the detail screen; it persists as an immutable snapshot, shows a receipt, and can be undone.

**Independent Test**: On a pending tech's detail screen pick a method, mark paid, reload — still Paid with the recorded method/date; then undo — back to Pending.

**Depends on**: US2 (the pay action lives on the detail screen).

### Implementation for User Story 3

- [ ] T027 [US3] Implement `app/(studio)/payroll/actions.ts` — `recordPayout` and `undoPayout` Server Actions per `contracts/server-actions.md`: owner/manager role gate, recompute the tech's snapshot fresh via `lib/payroll/aggregate` (never trust client figures), call `payroll_record_payout` / `payroll_undo_payout`, map Postgres errors to result codes, `revalidatePath("/payroll")` and `/payroll/[staffId]`.
- [ ] T028 [P] [US3] Build `components/lacquer/payroll/tech-pay-action.client.tsx` — payment-method tabs (cash / Zelle / check), mark-paid button, undo, and the paid receipt/confirmation.
- [ ] T029 [US3] Wire `tech-pay-action` into `app/(studio)/payroll/[staffId]/page.tsx`; ensure ledger and detail state badges reflect Paid/Pending and that no pay/undo action is offered for a `no_work` tech or a closed period (depends on T027, T028).
- [ ] T030 [US3] Extend `tests/e2e/payroll.spec.ts` — `US3:` describe block (mark paid → reload → still paid → undo → pending).

**Checkpoint**: Payouts persist durably — Payroll is now a system of record.

---

## Phase 6: User Story 4 - Close a pay period and browse payroll history (Priority: P4)

**Goal**: An owner closes the open period (freezing every eligible tech), and a period switcher + History view let anyone review closed periods.

**Independent Test**: With all techs paid, close the period; confirm it becomes read-only; reopen it via the switcher/History and confirm the figures are unchanged.

**Depends on**: US3 (closing freezes payouts).

### Implementation for User Story 4

- [ ] T031 [US4] Add the `closePeriod` Server Action to `app/(studio)/payroll/actions.ts` per `contracts/server-actions.md` — owner-only gate, recompute the ledger, build the eligible-unpaid `frozen_rows` + period totals, return an `INVALID` result naming unpaid techs unless `confirmedUnpaid`, then call `payroll_close_period`.
- [ ] T032 [US4] Extend `lib/payroll/queries.ts` — `loadPayrollHistory` returning closed periods with total paid and closed-by name, per `contracts/read-model.md`.
- [ ] T033 [P] [US4] Build `components/lacquer/payroll/close-period-dialog.client.tsx` (confirmation that names unpaid techs) and `components/lacquer/payroll/payroll-history.client.tsx`.
- [ ] T034 [US4] Wire close + history into `app/(studio)/payroll/page.tsx` — Close-period action, History view, and read-only rendering for closed periods (no pay/undo/close); ensure the period switcher reaches closed periods (depends on T031, T032, T033).
- [ ] T035 [US4] Extend `tests/e2e/payroll.spec.ts` — `US4:` describe block (close period, read-only, history review).

**Checkpoint**: Periods can be locked and browsed — the spreadsheet's old tabs are replaced.

---

## Phase 7: User Story 5 - Configure per-tech payroll rates in Staff settings (Priority: P5)

**Goal**: An owner edits each staff member's service commission %, tip split %, and check portion in Staff settings; the open period recomputes.

**Independent Test**: Change a tech's service commission % in Staff settings; return to Payroll and confirm that tech's after-split and cash figures recompute.

**Depends on**: US1 (the ledger is what verifies the recompute). Independent of US2–US4.

### Tests for User Story 5

- [ ] T036 [P] [US5] Write failing unit test `tests/unit/staff/payroll-rates-validation.test.ts` — percentage bounds (0–100% in the UI), negative check-portion rejection, non-numeric rejection.

### Implementation for User Story 5

- [ ] T037 [US5] Extend `app/(studio)/settings/staff/_validation.ts` — validators for `service_commission_pct`, `tip_split_pct`, `check_portion_cents`; make T036 pass (depends on T036).
- [ ] T038 [US5] Extend `app/(studio)/settings/staff/actions.ts` `updateStaff` and `app/(studio)/settings/staff/permissions.ts` — parse/diff/UPDATE the three new fields, restrict the rate fields to owners, join them into the `staff.updated` audit diff (FR-035), and `revalidatePath("/payroll")` (depends on T037).
- [ ] T039 [P] [US5] Build `components/lacquer/staff/payroll-rates-section.client.tsx` (commission %, tip %, check-portion inputs) and wire it into the staff edit panel.
- [ ] T040 [US5] Extend `tests/e2e/payroll.spec.ts` — `US5:` describe block (edit a rate → the open-period ledger recomputes).

**Checkpoint**: All five user stories are functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Design fidelity, audit coverage, and the final quality gate.

- [ ] T041 [P] Design-system audit — compare `/payroll` and `/payroll/[staffId]` side by side with `design-system/prototypes/payroll/Payroll.html` (Variation 3 — Pulse); confirm every color, spacing, radius, shadow, and type value traces to `styles/tokens.css` (Constitution I; run the `speckit-design-auditor`).
- [ ] T042 [P] Verify audit-log coverage — confirm `recordPayout`, `undoPayout`, `closePeriod`, and the rate edit each write an `audit_log` row with the acting user (FR-035); undo's payload carries the full undone snapshot (research R9).
- [ ] T043 Run the `quickstart.md` manual verification checklist end to end against the seeded local stack.
- [ ] T044 Run the full quality gate: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **US1 (Phase 3)**: depends on Foundational. The MVP.
- **US2 (Phase 4)**: depends on US1 (extends `lib/payroll/aggregate.ts` & `queries.ts`; ledger rows link into the detail route).
- **US3 (Phase 5)**: depends on US2 (the pay action is rendered on the detail screen).
- **US4 (Phase 6)**: depends on US3 (closing freezes payout rows).
- **US5 (Phase 7)**: depends on US1 only — independent of US2–US4.
- **Polish (Phase 8)**: depends on all targeted user stories.

### Within Each User Story

- Unit tests (T008, T019, T036) are written and confirmed FAILING before their implementation.
- Pure logic (`aggregate.ts`) → queries (`queries.ts`) → page (`page.tsx`).
- Components can be built in parallel with the logic; the page task integrates them.
- The e2e describe block is the last task of each story.

### Parallel Opportunities

- **Phase 2**: T005 and T006 run in parallel; T007 follows T006.
- **US1**: after T009 → T010, then T011/T012/T013/T014/T015/T016 all run in parallel; T017 integrates them; T018 last.
- **US2**: T022/T023/T024 in parallel after T021; T025 integrates.
- **US3**: T028 in parallel with T027; T029 integrates.
- **US4**: T033 in parallel with T031/T032; T034 integrates.
- **US5**: T039 in parallel with T037/T038 (after T036).
- **Polish**: T041 and T042 in parallel.

---

## Parallel Example: User Story 1

```bash
# After T009 (aggregate.ts) is done, launch these together:
Task: "T011 Implement lib/payroll/csv.ts buildPayrollCsv"
Task: "T012 Implement lib/payroll/format.ts period-label helpers"
Task: "T013 Add the Payroll nav item to components/lacquer/sidebar/nav-items.ts"
Task: "T014 Build payroll-header.tsx and payroll-kpis.tsx"
Task: "T015 Build payroll-ledger.tsx and payroll-empty-state.tsx"
Task: "T016 Build payroll-filters / period-switcher / export client components"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 — Setup (T001).
2. Phase 2 — Foundational (T002–T007). **Blocks everything.**
3. Phase 3 — User Story 1 (T008–T018).
4. **STOP and VALIDATE**: run the US1 independent test; the Payroll ledger replaces the spreadsheet calculation.

### Incremental Delivery

- Foundational → **US1** (MVP: accurate ledger) → **US2** (detail screen) → **US3** (record payouts) → **US4** (close + history) → **US5** (owner-editable rates) → Polish.
- Each story is a shippable increment; US5 can also be slotted in any time after US1.

### Final Gate

Phase 8's T044 is the contract before "feature done": all five gates green, plus the design audit (T041) confirming fidelity to the Pulse prototype.

---

## Notes

- **[P]** = different files, no dependency on an incomplete task.
- The migration (T002) is a single file covering every story's schema — there is no per-story migration; the constitution forbids schema drift, so the one file ships with the PR.
- `tests/e2e/payroll.spec.ts` is created in US1 and extended per story; if stories are worked in parallel by different people, the e2e tasks (T018/T026/T030/T035/T040) touch the same file and must be serialized.
- The e2e spec stays in the parallel `main` Playwright project — it asserts only worker-fixture-scoped per-tech data, never salon-wide period totals (research R11). If a period-total assertion is ever added, that test must move to a baseline project per CLAUDE.md.
- Run intermediate phase gates scoped (`npm run test:changed`, `npm run test:e2e:changed`, scoped prettier/eslint); run everything full at T044 (CLAUDE.md → "Scoping intermediate phase gates").
- Commit after each task or logical group; never commit to `main` — work stays on `047-payroll-page`.
