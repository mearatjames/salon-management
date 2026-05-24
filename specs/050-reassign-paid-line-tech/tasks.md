---
description: "Task list for feature 050-reassign-paid-line-tech"
---

# Tasks: Correct staff attribution on a paid ticket (within open pay period)

**Input**: Design documents from `/specs/050-reassign-paid-line-tech/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/server-actions.md ✅, quickstart.md ✅

**Tests**: Required. Constitution Principle IV (test-first for critical paths) applies — the action mutates payroll-bearing data and gates on role + period state. Every unit + e2e test named in `quickstart.md` § 6 (spec coverage matrix) is a gate before merge.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2, US3)
- File paths are exact (repo root: `/Users/mearathou/Dev/salon-management/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Brownfield feature on the existing Tang Nails Next.js app — no new dependencies, no build/lint config changes, no new infra. The only setup is verifying the design-system rules so the new chrome stays token-bound.

- [X] T001 Read `design-system/README.md`, `design-system/SKILL.md`, and the matching prototype `design-system/prototypes/transaction/TransactionsPage.jsx` so the per-line chip + Change trigger + Lock indicator are adapted (not redrawn) and every value resolves to a token in `styles/tokens.css`. No code change in this task — gate for all UI tasks below.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, helpers, and data-shape extensions that every user story below imports. Nothing here is user-visible on its own.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add `"ticket.line_tech_reassigned"` literal to the `AuditAction` union in `lib/auth/audit.ts` (alphabetical placement next to `"ticket.line_tech_assigned"`). Confirms research.md §3 and data-model.md §"Audit log row written by this feature".
- [X] T003 [P] Write Vitest unit suite for `isPayPeriodFinalized` in `tests/unit/payroll/finalized.test.ts` covering the four branches: (a) no `pay_periods` row → `false`; (b) row with `status='closed'` → `true`; (c) row + ≥1 `payroll_payouts` referencing its id → `true`; (d) row with `status='open'` AND no payouts → `false`. TDD — write before T004; tests must fail with "module not found" first.
- [X] T004 Create `lib/payroll/finalized.ts` exporting `payPeriodForClosedAt(closedAt)` (pure — wraps `resolvePayPeriod` from `lib/payroll/window.ts` with `offset = 0`) and `isPayPeriodFinalized(supabase, ref)` implementing the four branches from T003. Depends on T003 (tests must exist first).
- [X] T005 [P] Extend `lib/transactions/queries.ts` so the page query selects `ticket_items.id` (it already selects `tickets.closed_at`; verify and add `id` to the select list and to the per-item mapping). No new query; one select-list addition.
- [X] T006 Extend `lib/transactions/aggregate.ts` `TransactionDetail` type with two new fields: `items[].lineId: string` (sourced from T005's added select) and `payPeriodFinalized: boolean` (populated by the page in T014, default `false` in any direct construction site). Depends on T005.
- [X] T007 [P] Extend the AuditAction snapshot/list in `tests/unit/auth/audit-actions.test.ts` to include the new `"ticket.line_tech_reassigned"` literal so the union enumeration test stays green.

**Checkpoint**: Foundation ready — `isPayPeriodFinalized` is unit-green, the audit vocabulary knows the new action, and `TransactionDetail` carries `lineId` + `payPeriodFinalized`. User stories can begin.

---

## Phase 3: User Story 1 — Owner or manager corrects the assigned tech on a paid service line (Priority: P1) 🎯 MVP

**Goal**: An owner or manager can change the assigned technician on a single service line of a paid ticket from inside the existing receipt drawer. The correction takes effect immediately on the dashboard, transactions list, current-period report, and current-period payroll, and writes exactly one `ticket.line_tech_reassigned` audit row.

**Independent Test**: Sign in as a seeded owner; open today's paid ticket; click "Change" next to a tech chip; pick a different active tech; save; reopen the drawer (chip = new tech); open dashboard (per-tech count moved); open report (line under new tech); open payroll (commissionable income moved). Repeat as manager. Spec coverage: FR-001, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013, SC-001, SC-002, SC-003, SC-006.

### Tests for User Story 1 (write FIRST — must fail before implementation)

- [X] T008 [P] [US1] Create `tests/unit/transactions/reassign-paid-line-tech.test.ts` with the success-path + audit-shape + no-op cases: (a) `writes exactly one audit row with action='ticket.line_tech_reassigned'` (FR-010); (b) `audit payload matches FR-011 shape` (ticket_id, previous_staff_id, new_staff_id, closed_at, pay_period_start; `acting_as_staff_id` on the row itself) (FR-011); (c) `writes audit with previous_staff_id null when the line was unassigned` (FR-006); (d) `no-op when input equals current — no UPDATE, no audit row, no revalidatePath` (FR-013); (e) `leaves all monetary and identity fields untouched` — snapshot `ticket_items` row before/after, assert only `assigned_staff_id` differs (FR-007, SC-006). Mock Supabase per the existing pattern in `tests/unit/transactions/aggregate.test.ts`.
- [X] T009 [P] [US1] Create `tests/e2e/transactions-paid-line-reassign.spec.ts` with the `US1: owner reassigns` describe block. Steps mirror `quickstart.md` §1: sign in as seeded owner → open today's paid ticket → click "Change" on a line → pick a different active tech → assert chip updates → reload drawer → assert persists → navigate to `/dashboard` and assert per-tech count moved → navigate to `/report` (current period) and assert line under new tech → navigate to `/payroll` and assert commissionable income moved. Use the per-worker staff fixture from `tests/e2e/_fixtures.ts` and the audit-log cursor from `tests/e2e/_db.ts` (assert exactly one new `ticket.line_tech_reassigned` row since cursor). Add to the `main` Playwright project (no shared-aggregate impact).

### Implementation for User Story 1

- [X] T010 [US1] Create `app/(studio)/transactions/actions.ts` exporting the `'use server'` action `reassignPaidLineTech({ ticketId, lineId, newAssignedStaffId })`. Steps in this exact order per `contracts/server-actions.md` §"Order of checks": (1) zod-parse input; (2) `requireStudioSession()`; (3) role check → `PermissionDeniedError` (US2 covers this gate's test, but the gate itself ships here); (4) service-role Supabase client; (5) load `tickets` row → `TicketOrLineNotFoundError` if missing; (6) paid-state check → `TicketNotPaidError`; (7) `payPeriodForClosedAt(ticket.closed_at)`; (8) `isPayPeriodFinalized` → `PayPeriodFinalizedError` (US3 covers this gate's test, but the gate ships here); (9) load `staff` row → `StaffNotActiveError` if missing or `active !== true` (reuse the existing class from `app/(studio)/checkout/actions.ts`); (10) load `ticket_items` row → `TicketOrLineNotFoundError` if missing or `ticket_id !== input.ticketId`; (11) no-op short-circuit returning `{ ok: true }` if `assigned_staff_id === newAssignedStaffId`; (12) `UPDATE ticket_items SET assigned_staff_id = $1 WHERE id = $2`; (13) `recordAudit("ticket.line_tech_reassigned", …)` with the payload shape from data-model.md; (14) `revalidatePath('/transactions')`, `revalidatePath('/dashboard')`, `revalidatePath('/report')`, `revalidatePath('/payroll')`; (15) return `{ ok: true }`. Define the four new typed-error classes (`PermissionDeniedError`, `TicketNotPaidError`, `PayPeriodFinalizedError`, `TicketOrLineNotFoundError`) in this file; the `StaffNotActiveError` class is imported from `app/(studio)/checkout/actions.ts` per contracts §"Errors (typed)".
- [X] T011 [P] [US1] Add the two new CSS classes to `styles/transactions.css`: `.tp-d-tech-chip-change` (ghost text trigger, 12–13px, composes existing button tokens — `--space-*` for padding, `--radius-*` for radius, `--color-text-secondary` for the resting state) and `.tp-d-tech-chip-lock` (icon slot inside the chip, 14px height, `--color-icon-muted`). Reference the surrounding `.tp-d-tech-chip` rules for the chip-modifier `[data-locked]` rule (background → `--color-neutral-50`, `cursor: default`).
- [X] T012 [P] [US1] Create `components/lacquer/transactions/receipt-line-tech-chip.tsx` exporting `<ReceiptLineTechChip>` with props `{ techId: string | null, techDisplayName: string | null, lineId: string, ticketId: string, canEdit: boolean, payPeriodFinalized: boolean, activeStaff: ReadonlyArray<{ id: string; displayName: string }> }`. Three render modes branch off `canEdit` and `payPeriodFinalized`: (mode 1) `canEdit = false` AND `payPeriodFinalized = false` → plain chip (today's render exactly); (mode 2) `canEdit = true` → chip + "Change" trigger that opens a `<Popover>` (from `components/ui/popover.tsx`) listing `activeStaff` rows (avatar + display name) each calling the server action on click, then dismissing the Popover; (mode 3) `payPeriodFinalized = true` → chip with leading 14px Lucide `Lock` icon wrapped in `<TooltipTrigger>` (from `components/ui/tooltip.tsx`) with `<TooltipContent>` text exactly `"Payouts for this pay period have been finalized."` (FR-004). On Popover success, call `router.refresh()` (the action's `revalidatePath` invalidates the page cache; the refresh re-fetches the drawer's server parent). Wrap the action call in `try/catch` and surface the typed-error messages from contracts §"Caller contract — UI" via the existing toast pattern.
- [X] T013 [US1] Modify `components/lacquer/transactions/receipt-drawer.tsx`: replace the inline per-line tech-chip JSX (lines ~170–179 per plan.md) with `<ReceiptLineTechChip>`, threading `lineId` (from T006), `ticketId`, `canEdit = (viewerRole === 'owner' || viewerRole === 'manager') && !payPeriodFinalized`, `payPeriodFinalized`, and the page's active-staff roster. Add `viewerRole` and `payPeriodFinalized` to the component's props; depends on T012.
- [X] T014 [US1] Modify `components/lacquer/transactions/transactions-view.client.tsx`: accept `viewerRole` as a top-level prop and pass it plus the current transaction's `payPeriodFinalized` (read from the selected `TransactionDetail`) down to `<ReceiptDrawer>`. No additional `router.refresh()` call here — the action handles revalidation and T012's chip triggers the refresh on save. Depends on T013.
- [X] T015 [US1] Modify `app/(studio)/transactions/page.tsx`: read `viewer = await requireStudioSession()` and pass `viewerRole = viewer.staff.role` to `<TransactionsView>`. Compute the per-period finalized map as a `Map<string /* startsOn */, boolean>` by walking the loaded transactions, deduping by `payPeriodForClosedAt(tx.closedAt).startsOn`, calling `isPayPeriodFinalized` once per distinct period start, then stamping each `TransactionDetail.payPeriodFinalized` from the map (≤ 2·M queries for M distinct periods, not N·2). Depends on T004, T006, T014.
- [X] T016 [US1] Run the scoped Phase-3 gate (per CLAUDE.md "Scoping intermediate phase gates"): `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` · `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx)$' || echo .)` · `npm run typecheck` · `npm run test:changed` · `npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US1"`. All five must be green before Phase 4.

**Checkpoint**: User Story 1 ships in isolation. The MVP — owner + manager can correct paid-line attribution; downstream views reflect on next render; audit log records one row per save.

---

## Phase 4: User Story 2 — Non-privileged staff cannot see or trigger the correction (Priority: P2)

**Goal**: Technicians and front-desk users see the receipt drawer exactly as it renders today — no "Change" trigger, no entry point. Direct calls to the action from a non-privileged session are rejected server-side with `PermissionDeniedError` and write nothing.

**Independent Test**: Sign in as seeded technician; open the US1 paid ticket; assert no "Change" trigger on any line (chips render plain). Same as seeded front-desk. Then from devtools, invoke the action against the line — promise rejects with `PermissionDeniedError`, `audit_log` cursor shows zero `ticket.line_tech_reassigned` rows. Spec coverage: FR-003, FR-012 (a), FR-014, SC-005, SC-007.

### Tests for User Story 2 (write FIRST — must fail before implementation)

- [X] T017 [P] [US2] Extend `tests/unit/transactions/reassign-paid-line-tech.test.ts` with the `PermissionDeniedError` cases — one assertion per non-privileged role (`tech`, `frontdesk`, plus any other non-owner/non-manager `StudioViewer.staff.role` value, e.g. `kiosk`). Each: the action throws `PermissionDeniedError`, no `UPDATE` is issued, no audit row is inserted (FR-012 (a), FR-014).
- [X] T018 [P] [US2] Add a `US2: technician and front-desk see no affordance and are rejected on direct call` describe block to `tests/e2e/transactions-paid-line-reassign.spec.ts`. Two render-time assertions (technician session → no "Change" trigger DOM nodes on any line; front-desk session → same) plus one direct-call assertion (from inside a technician session, invoke the action via the test harness; assert promise rejects and `audit_log` cursor shows zero new rows since the cursor was taken).

### Implementation for User Story 2

- [X] T019 [US2] Verify and tighten the role gate inside `<ReceiptLineTechChip>` (from T012): confirm `canEdit` resolves to `false` for any `viewerRole` outside `{'owner', 'manager'}`, so mode 1 (plain chip) is rendered. If T012 already implements this correctly (it should — `canEdit` is computed in T013), this task is a no-op review against T017/T018; if any leakage is found, fix it here. The server-side gate ships in T010 and is the authority (FR-014); this task only confirms the UI gate matches.
- [X] T020 [US2] Run the scoped Phase-4 gate: `npm run typecheck` · `npm run test:changed` · `npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US2"`. All three must be green before Phase 5.

**Checkpoint**: User Stories 1 AND 2 both work independently. The drawer is byte-identical to pre-feature for tech + front-desk on every paid ticket (SC-007).

---

## Phase 5: User Story 3 — Once the pay period is finalized, the correction surface locks (Priority: P3)

**Goal**: Once a payout has been recorded for a pay period (or the period's `status='closed'`), every paid ticket inside that period renders a Lock icon + tooltip on every staff chip for every role, and no "Change" trigger appears for any role. Direct calls to the action against a finalized-period ticket are rejected server-side with `PayPeriodFinalizedError`.

**Independent Test**: Seed a paid ticket whose pay period has been finalized (record a payout via Payroll → Record payout for the current period). Sign in as owner; open the receipt drawer; assert no "Change" trigger; assert every chip has a Lock icon at its leading edge; hover the Lock and assert tooltip reads `"Payouts for this pay period have been finalized."`. Repeat as manager. From devtools, invoke the action against a finalized-period line — promise rejects with `PayPeriodFinalizedError`, no audit row. Spec coverage: FR-002, FR-004, FR-012 (b–e), SC-004.

### Tests for User Story 3 (write FIRST — must fail before implementation)

- [X] T021 [P] [US3] Extend `tests/unit/transactions/reassign-paid-line-tech.test.ts` with the remaining five gate cases: `PayPeriodFinalizedError` (FR-012 (c)), `TicketNotPaidError` (FR-012 (b)), `StaffNotActiveError` (FR-012 (d)), `TicketOrLineNotFoundError` for a missing ticket (FR-012 (e)), `TicketOrLineNotFoundError` for a line whose `ticket_id` does not match input (FR-012 (e)). Each: action throws the typed error, no `UPDATE`, no audit row.
- [X] T022 [P] [US3] Add a `US3: finalized period locks the surface` describe block to `tests/e2e/transactions-paid-line-reassign.spec.ts`. Seed/record a payout for the target period inside the test (use the helpers in `tests/e2e/_db.ts`); then: (a) owner session opens the drawer → assert zero "Change" triggers, assert N Lock icons (one per line), hover the first Lock → assert tooltip text exactly matches FR-004 copy; (b) manager session → same; (c) direct-call invocation from owner session → promise rejects with `PayPeriodFinalizedError` and `audit_log` cursor shows zero new `ticket.line_tech_reassigned` rows. End with cleanup that removes the seeded payout so the test is rerunnable.

### Implementation for User Story 3

- [X] T023 [US3] Extend `<ReceiptLineTechChip>` (from T012) mode 3 if not already complete: ensure the Lock icon is a Lucide `Lock`, 14px, 1.5px stroke, at the leading edge of the chip; ensure the `data-locked` attribute is set on the chip container so the `[data-locked]` CSS rule from T011 applies; ensure the `<TooltipContent>` text is the exact FR-004 copy. If T012 already implements all of this (it should), this task is verification + any necessary refinement to make T022 pass.
- [X] T024 [US3] Run the scoped Phase-5 gate: `npm run typecheck` · `npm run test:changed` · `npx playwright test tests/e2e/transactions-paid-line-reassign.spec.ts -g "US3"`. All three must be green before Phase 6.

**Checkpoint**: All three user stories pass independently. The feature is functionally complete; Phase 6 is verification + the final full-suite gate.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: One round of design-system parity verification and the final full-suite gate. No new behaviour.

- [X] T025 Dispatch the `speckit-design-auditor` subagent (per CLAUDE.md "Skill-level optimizations") against the changes in `components/lacquer/transactions/receipt-line-tech-chip.tsx`, `components/lacquer/transactions/receipt-drawer.tsx`, and `styles/transactions.css`. Resolve any reported token / prototype-fidelity violations. [Already satisfied: Phase 3 audit returned PASS with two documented exceptions (Lock icon at 14px per research.md §5; inline `var(--*)` style props mirror existing `cart-row-with-tech.tsx` precedent). `git log` confirms zero edits to all three files since the Phase 3 commit `5393762`. Re-dispatch skipped.]
- [X] T026 [P] Sanity-check the `quickstart.md` smoke tests against the running app — §1 (US1 happy path), §2 (US2 non-privileged), §3 (US3 finalized lock), §4 (edge cases: same tech selected, previously-unassigned line). Confirm SC-001 (< 30 s end-to-end). [Adapted to test-mapping matrix per dispatch note; all four sections map to passing automated coverage — see Phase 6 report.]
- [X] T027 Run the FINAL full gate set per CLAUDE.md "Pre-push quality gates", in order: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five must be green. The `test:e2e` step runs the full suite (including the new `transactions-paid-line-reassign.spec.ts`) against a freshly-reset local Supabase, serialized via `flock` per CLAUDE.md "Parallel sessions".

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — read-only design-system gate.
- **Phase 2 (Foundational)**: Depends on Phase 1. Blocks every user story.
- **Phase 3 (US1, P1)**: Depends on Phase 2. The MVP.
- **Phase 4 (US2, P2)**: Depends on Phase 2 — runs alongside Phase 3 in principle, but in practice T019 verifies a component built in T012, so easiest to schedule after Phase 3.
- **Phase 5 (US3, P3)**: Depends on Phase 2 — same scheduling note: T023 verifies the mode-3 path of `<ReceiptLineTechChip>` built in T012, so easiest after Phase 3.
- **Phase 6 (Polish)**: Depends on all of Phases 3–5.

### User Story Dependencies

- **US1**: Depends only on Phase 2. The action, drawer plumbing, and chip component all land here; US2/US3 reuse them.
- **US2**: Depends on Phase 2 AND the chip component from US1 (T012). The role gate in the action ships in T010 (US1); the UI gate ships in T012 (US1) and is verified in T019 (US2).
- **US3**: Depends on Phase 2 AND the chip component from US1 (T012). The finalized gate in the action ships in T010 (US1); the lock-mode rendering ships in T012 (US1) and is verified in T023 (US3).

> Although US2 and US3 inherit some implementation from US1's tasks, each remains *independently testable*: passing US1's tests does not require US2 or US3's tests; and US2/US3's tests can pass without US1's e2e being green (because they assert different surfaces and different audit-log states).

### Within Each User Story

- Tests are written BEFORE implementation and MUST fail first (Constitution Principle IV).
- Helpers + types before action; action before UI; component before drawer; drawer before page.
- Each phase ends with a scoped gate run (T016, T020, T024).

### Parallel Opportunities

**Phase 2** — three parallel streams once T002 is started:
- T002, T003, T005, T007 can all run in parallel (different files, no cross-deps).
- T004 depends on T003 (TDD); T006 depends on T005.

**Phase 3 (US1)** — tests in parallel, then implementation has two parallel streams:
- T008 + T009 in parallel (different test files).
- T010 (action), T011 (CSS), T012 (chip component) in parallel (different files).
- T013, T014, T015 are sequential (each depends on the previous file's prop shape).

**Phase 4 (US2)** — T017 + T018 in parallel; T019 is a tiny verification.

**Phase 5 (US3)** — T021 + T022 in parallel; T023 is a tiny verification.

**Phase 6** — T026 in parallel with T025.

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (write-first):
Task: "Create tests/unit/transactions/reassign-paid-line-tech.test.ts with success-path + audit-shape + no-op cases"
Task: "Create tests/e2e/transactions-paid-line-reassign.spec.ts with US1 describe block"

# Once Phase 2 + the two test files exist, launch the three parallel implementation streams:
Task: "Create app/(studio)/transactions/actions.ts with reassignPaidLineTech action"
Task: "Add .tp-d-tech-chip-change and .tp-d-tech-chip-lock to styles/transactions.css"
Task: "Create components/lacquer/transactions/receipt-line-tech-chip.tsx with three render modes"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 — read the design-system docs once (T001).
2. Phase 2 — land the foundational helpers + types (T002–T007).
3. Phase 3 — US1 ships the action + UI end-to-end; the receipt drawer can correct a paid line's tech for owner/manager in an open period (T008–T016).
4. **STOP and VALIDATE**: walk `quickstart.md` §1 manually. If green, the MVP is demonstrable.

### Incremental delivery

- After MVP: add US2 (T017–T020) → guardrails the affordance for non-privileged users.
- After US2: add US3 (T021–T024) → lock surface for finalized periods.
- After US3: Polish + final gate (T025–T027) → merge-ready.

### Parallel team strategy

The three user stories share one component file (`receipt-line-tech-chip.tsx`) and one action file, so the natural carve-up is Phase-based, not Story-based. One developer can finish Phase 3 in a session, then hand US2 + US3 off to two parallel agents whose work is mostly tests + small render branches.

---

## Notes

- **No new dependencies, no schema changes, no migrations.** Every code path adapts existing helpers/components.
- **The audit row is the authority.** Every successful reassignment writes exactly one `ticket.line_tech_reassigned` row; every rejection and every no-op writes zero (FR-010, FR-012, FR-013, SC-002).
- **Final gate runs full e2e**, not scoped — the cross-route revalidation (transactions, dashboard, report, payroll) is impossible to scope safely.
- **Worktree note**: this feature is being developed on the `050-reassign-paid-line-tech` branch. If you are running gates in a worktree, follow CLAUDE.md "Worktree setup" (copy `.env.*`, `npm ci`) before T016, T020, T024, T027.
