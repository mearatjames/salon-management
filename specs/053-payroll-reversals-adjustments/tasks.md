# Tasks: Payroll — Reversals & Adjustments

**Input**: Design documents from `specs/053-payroll-reversals-adjustments/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED — Constitution Principle IV makes the refund/adjustment money
math a test-first critical path (Vitest written-to-fail first), and each user
story ships a Playwright e2e.

**Organization**: Tasks are grouped by user story (US1–US3 from spec.md) so each
can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no incomplete dependency)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish carry no story label)
- Every task names exact file paths.

## Path Conventions

Next.js monolith at repo root: `app/(studio)/…`, `components/lacquer/…`,
`lib/…`, `styles/…`, `supabase/…`, `tests/…`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Seed the reversed-sale fixtures every story's e2e relies on.

- [ ] T001 Seed a partially-refunded sale and a voided sale into the **current open pay period** (but NOT today, to avoid perturbing the today-scoped EOD-cash / dashboard baselines) in `supabase/seed.sql` and mirror in `supabase/seed-preview.sql`: one single-tech $60 service at 50% commission with a $20 refund (status `partially_refunded`), and one $60 single-tech sale set to `void`. Note in a comment which tech they belong to so US1 e2e can assert against them.

**Checkpoint**: `supabase db reset` succeeds and the two reversed tickets exist in the open period.

---

## Phase 2: Foundational (Part 2 prerequisites)

**Purpose**: The `payout_adjustments` table, RPCs, and typing that **US2 and US3**
build on. **US1 (Part 1) does NOT depend on this phase** and may proceed in
parallel.

- [ ] T002 Create migration `supabase/migrations/0028_payout_adjustments.sql` — the `public.payout_adjustments` table (columns per data-model.md §1: `id`, `pay_period_id`→pay_periods, `staff_id`→staff, `amount_cents int CHECK (<>0)`, `reason text CHECK (btrim length 1..80)`, `created_by_staff_id`→staff, `created_by_user_id uuid`, `created_at timestamptz default now()`, `updated_at timestamptz`), the `(pay_period_id, staff_id)` index, `enable row level security`, and the select-only `payout_adjustments_select_all` policy for `authenticated`.
- [ ] T003 In the same migration `supabase/migrations/0028_payout_adjustments.sql`, add the SECURITY DEFINER functions per contracts/db-rpc.md: `payroll_assert_adjustable(p_pay_period_id, p_staff_id)` (raises `payroll_period_not_open` / `payroll_payout_exists`), `payroll_add_adjustment(...) returns uuid`, `payroll_edit_adjustment(...) returns uuid` (returns staff_id), `payroll_delete_adjustment(...) returns uuid` (audit-before-delete, returns staff_id) — each `set search_path = public, pg_temp`, validating amount/reason, and writing `audit_log` with the `payroll_record_payout` column convention.
- [ ] T004 [P] Extend the `AuditAction` union in `lib/auth/audit.ts` with `"payroll.adjustment_added" | "payroll.adjustment_edited" | "payroll.adjustment_removed"` (the `payroll.` prefix already routes to `entity_type "payroll"` in `deriveEntityType` — no dispatch edit).
- [ ] T005 Regenerate Supabase types into `lib/db/types.ts` so `payout_adjustments` and the three RPCs are typed (run the project's type-gen against the migrated local DB). Depends on T002–T003.

**Checkpoint**: migration applies on `supabase db reset`; `lib/db/types.ts` includes the new table + RPCs; typecheck passes.

---

## Phase 3: User Story 1 — Refunds keep commission; voids pay $0; revenue net (Priority: P1) 🎯 MVP

**Goal**: Payroll counts `refunded`/`partially_refunded` sales at **original**
amounts (tech keeps commission), pays $0 for `void`; the Report shows revenue
**net** of refunds. Revenue and payroll are decoupled.

**Independent test**: With the seeded partial-refund + void (T001), `/payroll`
shows the refunded tech's income at the original $60 (commission $30) and $0 for
the void; `/report` shows that sale net at $40; the two figures differ by exactly
the $20 refund. No refund note/flag is rendered.

**Depends on**: Phase 1 (seed) only. Independent of Phase 2.

- [ ] T006 [P] [US1] Write failing Vitest cases in `tests/unit/report/aggregate.test.ts` for refund-aware `projectReport`: single-tech full refund → commissionable unchanged (original) + `refundedCents` = full; single-tech partial → original + `refundedCents` = partial; multi-tech ticket refund → `refundedCents` split proportionally by service subtotal, Σ exact; `void` excluded entirely; over-refund clamps net ≥ 0; card tips unaffected by refunds.
- [ ] T007 [US1] Implement refund-awareness in `lib/report/aggregate.ts`: add `refundedCents` to `ReportTransaction`, `TechnicianReport`, and `ReportTotals` (data-model §2); split incoming payments by `kind` (only `kind='payment'` feeds gross/tip/method; `kind='refund'` succeeded rows feed the refund total); allocate each ticket's refund across its techs via `splitCardTip(ticketRefundCents, techServiceSubtotals)`. Keep `grossCents`/`commissionableCents`/`cardTipsCents` = ORIGINAL. Make T006 pass.
- [ ] T008 [US1] Widen the fetch in `lib/report/queries.ts::loadReportPage`: ticket filter `.in("status", ["paid","refunded","partially_refunded"])`; payments select adds `kind, amount_cents` (keep `status='succeeded'`, include refund rows). Update the `ReportTicketRow` / `ReportPaymentRow` input types accordingly.
- [ ] T009 [P] [US1] Write a failing Vitest case in `tests/unit/payroll/aggregate.test.ts`: a `TechnicianReport` for a refunded ticket (original `commissionableCents`) flows through `projectPayrollLedger` so the tech keeps full commission; a window with only a voided sale yields a `no_work`/$0 row.
- [ ] T010 [US1] Confirm `lib/payroll/queries.ts` + `lib/payroll/aggregate.ts::projectPayrollLedger` consume the original `commissionableCents`/`cardTipsCents` unchanged (expected: no math change beyond the widened fetch flowing through `loadReportPage`); make T009 pass and leave an inline comment recording that refund preservation is delivered by the widened fetch (R1).
- [ ] T011 [US1] Net-revenue display in the Report layer (read `commissionableCents − refundedCents`, never below 0): `lib/report/csv.ts`, `app/(studio)/report/page.tsx`, and the affected `components/lacquer/report/*` (`report-summary.tsx`, `report-staff-list.tsx`, `tech-detail.tsx`, `all-staff-overview.tsx`). Do **not** add any refund note/flag (FR-006).
- [ ] T012 [US1] Extend e2e: `tests/e2e/refund-ticket.spec.ts` (refunded sale → tech keeps commission on `/payroll`), `tests/e2e/void-sale.spec.ts` (voided sale → $0 in payroll), `tests/e2e/report.spec.ts` (partial refund reads net; update the report baseline aggregate expectations for the new seed). Confirm `report.spec.ts`/`payroll.spec.ts` baseline counts still reconcile.

**Checkpoint**: US1 independently shippable — the reversal money bug is fixed and proven by unit + e2e.

---

## Phase 4: User Story 2 — Add manual payout adjustments via Dialog (Priority: P1)

**Goal**: An owner/manager adds signed (+/−) adjustment lines (required reason)
to a tech **with work** on an **open** period through a centered Dialog; they
fold into a derived **net payout** shown on the ledger and detail; lines can be
edited/deleted while open.

**Independent test**: On an open period, open a working tech's detail → Add
(Dialog) a −$15 "Redo on the house" → net payout drops $15, line lists with
creator + timestamp, ledger Adj./Net payout + KPIs update; edit then delete and
the totals follow; confirm is disabled for zero amount or empty reason.

**Depends on**: Phase 2 (table/RPCs/types) + Phase 3 (US1's payroll read-model in `lib/payroll/aggregate.ts` / `queries.ts`).

- [ ] T013 [P] [US2] Write failing Vitest in `tests/unit/payroll/aggregate.test.ts` for adjustment fold-in: `projectPayrollLedger` given `adjustmentsByStaff` sets per-row `adjustments`, `adjustmentsCents` (signed Σ), `netPayoutCents = cashPaymentCents + adjustmentsCents`; a deduction exceeding earnings yields a negative `netPayoutCents`; totals gain `adjustmentsCents`/`netPayoutCents`; `cashRemainingCents` uses net.
- [ ] T014 [US2] Implement `AdjustmentLine` + net payout in `lib/payroll/aggregate.ts` (data-model §3): new type, `ProjectPayrollLedgerInput.adjustmentsByStaff`, the per-row + totals fields, and net `cashRemainingCents`. Make T013 pass.
- [ ] T015 [US2] In `lib/payroll/queries.ts::assemblePayrollLedger`, query `payout_adjustments` for `period.id`, group by `staff_id` into `AdjustmentLine[]` (resolve `createdByName` from the staff-name map; format `createdAtLabel` via the salon-time helper; `edited = updated_at !== null`), and pass `adjustmentsByStaff` into `projectPayrollLedger`.
- [ ] T016 [US2] Add `addAdjustment`, `editAdjustment`, and `deleteAdjustment` to `app/(studio)/payroll/actions.ts` per contracts/server-actions.md (owner+manager gate; validate amount integer ≠ 0 and reason trimmed 1–80; recompute the open ledger and refuse `no_work`/`paid`/closed; call the RPCs via service role; `revalidatePath('/payroll')` + the affected `/payroll/{staffId}`), and extend `mapRpcError` with the `payroll_adjustment_missing` → `INVALID` token.
- [ ] T017 [P] [US2] Create `components/lacquer/payroll/adjustments-card.client.tsx`: the lines list + an `AdjustmentForm` inside a centered shadcn `Dialog` (mirror `close-period-dialog.client.tsx`) — Add/Deduct toggle, `$` amount input, reason preset chips + free-text input, live before/after net-payout preview, Cancel / confirm (disabled until amount > 0 and reason non-empty). Wire add + edit to the T016 actions with optimistic-free refresh via `router.refresh()`/revalidate.
- [ ] T018 [P] [US2] Port the adjustment styles into `styles/payroll.css` from the design handoff `design-system` payroll `extra.css` (`.adj-form`, `.adj-dir`, `.adj-amount`, `.adj-chip`, `.adj-reason-input`, `.adj-preview`, `.adj-form-actions`, `.pp-adj-*`, `.pl-adj`, `.pl-bd-row.adj`, `.pl-bd-row.cash-sub`, `.adj-modal-*`), every value a `styles/tokens.css` token. **Omit** `.pl-refund-flag`, `.pr-reversal-note`, `.pl-bd-note` (FR-006).
- [ ] T019 [US2] Render `AdjustmentsCard` in `app/(studio)/payroll/[staffId]/page.tsx` — only when the row is not `no_work` (FR-007); pass `payPeriodId`, `staffId`, the `adjustments`, and `readOnly = detail.readOnly || row.state === 'paid'`.
- [ ] T020 [US2] Fold adjustments into the detail surfaces: `components/lacquer/payroll/tech-breakdown.tsx` (insert a Cash-payment sub-row + one row per adjustment line + a Net-payout total when adjustments exist), `tech-detail-header.tsx` (big number = net payout; sub = `{cash} cash · {±adj} adj`), and `tech-pay-action.client.tsx` ("Mark {netPayout} paid").
- [ ] T021 [US2] Add **Adj.** + **Net payout** columns (and tfoot totals) to `components/lacquer/payroll/payroll-ledger.tsx`, and an **Adjustments** KPI plus a net **Cash to pay** in `components/lacquer/payroll/payroll-kpis.tsx`. Show `—` for no-work / zero-adjustment rows.
- [ ] T022 [US2] In `lib/payroll/queries.ts::loadPayrollHistory`, add each closed period's `Σ payout_adjustments.amount_cents` to its paid total so History reflects cash + check + adjustments.
- [ ] T023 [US2] E2E in `tests/e2e/payroll.spec.ts`: open a working tech's detail on the open period, add a deduction via the Dialog → net drops and the line lists with creator/timestamp; edit the amount → net follows; delete → line gone and net restored; assert confirm is disabled for zero amount and for empty reason; assert the ledger Adj./Net-payout columns and the Adjustments/Cash-to-pay KPIs.

**Checkpoint**: US2 shippable on top of US1 — owners can add/edit/delete adjustments and net payout reconciles everywhere.

---

## Phase 5: User Story 3 — Adjustments lock once closed or paid out (Priority: P2)

**Goal**: A closed period or a paid-out tech presents a read-only "Period closed"
state with existing lines visible and no add/edit/delete; the lock is enforced
server-side, not only hidden.

**Independent test**: Add an adjustment on the open period, then close the period
(or record that tech's payout) → the adjustments card shows "Period closed" with
no controls, the existing line is still visible and folded into the frozen net,
and a stale add/edit/delete is refused.

**Depends on**: Phase 4 (adjustments exist to be locked). The RPC lock guard
(T003) already enforces the server side.

- [ ] T024 [US3] Add the read-only branch to `components/lacquer/payroll/adjustments-card.client.tsx`: when `readOnly`, render the "Period closed" lock badge, hide the Add affordance and the per-line edit/delete buttons, and keep the existing lines + net-adjustment subtotal visible.
- [ ] T025 [US3] Confirm the server lock end-to-end: the `payroll_assert_adjustable` guard (T003) + the action recompute (T016) refuse add/edit/delete on a closed period (`PERIOD_CLOSED`) and on a paid-out tech (`ALREADY_PAID`); add/adjust an action-layer unit-style assertion or inline note if any path is uncovered.
- [ ] T026 [US3] E2E in `tests/e2e/payroll.spec.ts`: with a closed period (and separately, a paid-out tech), assert the adjustments card is read-only (lock badge, no controls), the prior adjustment is still shown and folded into the net, and an attempted mutation via a stale action is refused.

**Checkpoint**: all three stories complete; the no-clawback rule holds in UI and DB.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T027 [P] Design-system audit (Constitution I): side-by-side the AdjustmentsCard + Dialog against `design-system` payroll `screens/03-09-dialog.png` and the ledger against `01-ledger.png`/`10-closed.png`; confirm every color/space/radius traces to a token and that NO refund note/flag is present (FR-006). Dispatch `speckit-design-auditor`.
- [ ] T028 [P] Update `tests/e2e/_affected-map.mjs` if any new production path (the adjustment actions / RPCs) isn't transitively imported by an existing spec, so scoped e2e pulls the right specs.
- [ ] T029 Final gate (run full): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five green before "done".

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → blocks the e2e in every story (T012, T023, T026).
- **Phase 2 (Foundational)** → blocks **US2** and **US3** only. **US1 does not depend on it.**
- **US1 (Phase 3)** → depends on Phase 1; otherwise independent → **the MVP, start here.**
- **US2 (Phase 4)** → depends on Phase 2 + US1's payroll read-model edits.
- **US3 (Phase 5)** → depends on US2.
- **Polish (Phase 6)** → after the stories it audits.

```
Phase 1 (seed) ─┬─────────────► US1 (T006–T012)  ── MVP
                │
Phase 2 (0028 + audit + types) ─► US2 (T013–T023) ─► US3 (T024–T026) ─► Polish
```

## Parallel Opportunities

- **Phase 2**: T004 (audit verbs) ∥ T002/T003 (migration); T005 after the migration.
- **US1**: T006 (report test) ∥ T009 (payroll test) — different files; implementations (T007, T010) follow.
- **US2**: T017 (component) ∥ T018 (CSS) — different files; both before T019/T020/T021 wire-up.
- **Polish**: T027 ∥ T028.

## Implementation Strategy

- **MVP = US1 alone** — it fixes the active money bug (refunds zeroing pay) and is
  shippable without the migration. Ship it first.
- **Increment 2 = US2** — the manual-adjustment lever (needs the table).
- **Increment 3 = US3** — the closed-period guardrail.
- Money math (`report`/`payroll` aggregates) is **test-first**: write the failing
  Vitest (T006, T009, T013) before the implementation (Constitution IV).
- Intermediate phase gates use the **scoped** commands (`test:changed`,
  `test:e2e:changed` / `-g "USn"`, scoped prettier/eslint); the full gate set is
  T029 only (CLAUDE.md "Scoping intermediate phase gates").

## Total: 29 tasks

- Setup: 1 · Foundational: 4 · US1: 7 · US2: 11 · US3: 3 · Polish: 3
