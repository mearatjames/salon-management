---
description: "Task list for Privileged-Action Overrides — Voids & Refunds"
---

# Tasks: Privileged-Action Overrides — Voids & Refunds

**Input**: Design documents from `/specs/052-privileged-action-overrides/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (server-actions, square-refund, audit), quickstart.md

**Tests**: INCLUDED. Money + auth paths are critical per Constitution Principle IV (test-first); the plan mandates Vitest unit (refund math, Square wrapper, status derivation) and Playwright e2e (void, full/partial refund, role-gate denial).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (same-day void, P1) or US2 (post-close refund, P2); Setup/Foundational/Polish carry no story label
- All paths are repository-root-relative

## Path Conventions

Single Next.js project (App Router). Source at repo root: `app/(studio)/`, `components/lacquer/`, `lib/`, `supabase/migrations/`, `tests/`.

---

## Phase 1: Setup

**Purpose**: Confirm the worktree baseline is ready for migration + Square sandbox work.

- [ ] T001 Confirm work is on branch `052-privileged-action-overrides`, the local Supabase stack is up (`supabase start`), and reset to the seed baseline with `supabase db reset` so `0025` will apply cleanly on top of seeded data.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, RPCs, shared lib helpers, error types, and the failing unit tests every story depends on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete. The migration RPCs and `lib/` helpers are consumed by both `voidSale` (US1) and `refundTicket` (US2).

### Schema migration `supabase/migrations/0025_void_refund.sql`

- [ ] T002 Create `supabase/migrations/0025_void_refund.sql` with the schema deltas from data-model.md: `ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'void' | 'refunded' | 'partially_refunded'`; `ALTER TYPE public.payment_kind ADD VALUE IF NOT EXISTS 'refund'`; `ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunds_payment_id uuid REFERENCES public.payments(id)` and `ADD COLUMN IF NOT EXISTS square_refund_id text`; the two partial indexes (`payments_refunds_of_idx` on `refunds_payment_id where kind='refund'`, and the unique `payments_unique_square_refund_idx` on `square_refund_id where square_refund_id is not null`); and the replaced `tickets_closed_consistency_chk` allowing `void`/`refunded`/`partially_refunded` as closed outcomes. NO static DML referencing the new enum values in this migration (enum-add-then-use rule — research D3).
- [ ] T003 In `supabase/migrations/0025_void_refund.sql`, add the `pos_void_ticket(p_ticket_id uuid, p_operator uuid)` and `pos_finalize_void(p_ticket_id uuid, p_refund_results jsonb)` SECURITY DEFINER RPCs per research D4 + data-model state machine: `pos_void_ticket` locks the ticket + its succeeded payments `FOR UPDATE`, refuses with `ticket_not_void_eligible` unless `status='paid'` AND `closed_at` is the current salon-local day AND not already reversed, inserts a `kind='refund'` mirror row per succeeded payment (cash→`succeeded`, card/gift→`pending`, `refunds_payment_id`=original, `taken_by_staff_id`=`p_operator`, `tip_cents=0`), and returns the created refund rows `[{refund_payment_id, method, square_payment_id, amount_cents}]`; `pos_finalize_void` flips card/gift legs→`succeeded` + `square_refund_id`, sets `tickets.status='void'` + `closed_*`, and inserts the `payment.void_issued` audit row (entity_type derived `payment`, payload per contracts/audit.contract.md). Depends on T002 (same file).
- [ ] T004 In `supabase/migrations/0025_void_refund.sql`, add the `pos_refund_payments(p_ticket_id uuid, p_operator uuid, p_lines jsonb)` and `pos_finalize_refund(p_ticket_id uuid, p_refund_results jsonb)` SECURITY DEFINER RPCs per research D4: `pos_refund_payments` locks the ticket + payments, for each line asserts the `originalPaymentId` belongs to the ticket and is `kind='payment' status='succeeded'`, asserts `amountCents ≤ remaining` (Σ original − Σ succeeded refunds, under lock) else raises `refund_exceeds_remaining`, asserts total > 0, inserts `kind='refund'` rows (cash→`succeeded`, card/gift→`pending`), and returns created rows; `pos_finalize_refund` flips legs→`succeeded` + `square_refund_id`, recomputes status (`refunded` iff Σ succeeded refunds = Σ succeeded payments else `partially_refunded`), sets `closed_*` on first reversal, and inserts the `payment.refund_issued` audit row. Depends on T002 (same file).
- [ ] T005 Apply the migration locally with `supabase db reset` and confirm it runs without error and the seed reloads (sanity-check the new enum values, columns, and constraint exist).

### Shared lib helpers + error types

- [ ] T006 [P] Add `"payment.void_issued"` and `"payment.refund_issued"` to the `AuditAction` union in `lib/auth/audit.ts` (entity_type resolves to `payment` via the existing `payment.` prefix dispatch in `deriveEntityType` — no dispatch edit, per research D7 / contracts/audit.contract.md).
- [ ] T007 [P] Add `buildRefundIdempotencyKey(originalPaymentId, refundPaymentId)` to `lib/square/terminal.ts` next to `buildIdempotencyKey`: `sha256(\`${originalPaymentId}:refund:${refundPaymentId}\`).slice(0,45)` (contracts/square-refund.contract.md — exactly Principle III's key form).
- [ ] T008 [P] Add the reversal error types to `app/(studio)/checkout/_errors.ts` following the existing `.name`-discriminated class convention: `VoidNotAllowedError`, `RefundExceedsRemainingError`, `PaymentNotOnTicketError`, `SquareRefundFailedError`. Reuse the existing `PermissionDeniedError` from `app/(studio)/transactions/actions.ts` (lift to a shared module if both checkout + transactions must import it).

### Test-first unit tests (write to FAIL before implementing T011–T012)

- [ ] T009 [P] Write failing unit test `tests/unit/square/refund-payment.test.ts` per contracts/square-refund.contract.md, mocking `@/lib/square/client` + oauth exactly like `tests/unit/square/gift-card-payment.test.ts`: assert `idempotencyKey` equals `buildRefundIdempotencyKey(original, refund)`, `amountMoney.amount` is `BigInt(amountCents)` / currency `"USD"`, missing `refund.id` throws, and a Square API rejection propagates.
- [ ] T010 [P] Write failing unit test `tests/unit/payments/refund-status.test.ts`: cover `remaining(payment)` per-payment math and resulting ticket status across full reversal (→`refunded`), partial (→`partially_refunded`), and over-refund (rejected), per data-model D9.

### Implement the foundational lib modules (make T009/T010 pass)

- [ ] T011 [P] Implement `lib/square/refunds.ts` `refundCardPayment({ squarePaymentId, amountCents, idempotencyKey, reason? })` over `client.payments.refundPayment(...)` per contracts/square-refund.contract.md (mirror `lib/square/gift-cards.ts:createGiftCardPayment`; same `readDecryptedTokens` + `getSquareClient`; returns `{ squareRefundId, status }`; throws on missing id). Makes T009 pass. Depends on T007.
- [ ] T012 [P] Implement pure `lib/payments/refund-status.ts`: `remaining` per payment and `deriveTicketStatus` (`refunded` iff fully reversed else `partially_refunded`) per data-model D9. Makes T010 pass.

### E2E affected-map wiring

- [ ] T013 Add the new production paths (`lib/square/refunds.ts`, `lib/payments/refund-status.ts`, `app/(studio)/checkout/actions.ts`, `app/(studio)/transactions/actions.ts`) → `void-sale.spec.ts` / `refund-ticket.spec.ts` mappings in `tests/e2e/_affected-map.mjs` so future scoped runs pull the right specs.

**Checkpoint**: Migration applies, unit tests green, error types + helpers available — both stories can now proceed.

---

## Phase 3: User Story 1 - Void a same-day sale (Priority: P1) 🎯 MVP

**Goal**: An owner/manager can fully reverse a same-day paid (or partially-paid) ticket from the checkout `DoneScreen` — a `kind='refund'` mirror row per payment, Square refund for card/gift, ticket→`void`, `payment.void_issued` audit. Hidden + server-refused for everyone else.

**Independent Test**: As owner/manager, on a same-day paid ticket choose "Void sale" → confirm ticket reads voided, a refund row exists per original payment, and the audit names the acting owner/manager. As a technician, confirm the action is absent and a direct call is refused. (Per spec US1 acceptance scenarios 1–6.)

### Tests for User Story 1 (write to FAIL first) ⚠️

- [ ] T014 [US1] Write failing e2e `tests/e2e/void-sale.spec.ts` using the worker-scoped staff trio (`_fixtures.ts`) + audit cursors (`_db.ts`): owner voids a same-day cash ticket → `tickets.status='void'`, mirrored `kind='refund'` row, exactly one `payment.void_issued` audit row (`getAuditLogRowsSince`) with `acting_as_staff_id`=owner; split cash+card ticket → a refund row per payment; technician sees no "Void sale" affordance AND a direct `voidSale` invocation is refused (`PermissionDeniedError`); already-voided ticket offers no re-void; prior-day ticket offers no void. Create dedicated tickets in-spec (no seeded-ticket reuse) to stay parallel-safe in the `main` project.

### Implementation for User Story 1

- [ ] T015 [US1] Implement the `voidSale({ ticketId })` server action in `app/(studio)/checkout/actions.ts` per contracts/server-actions.contract.md: `requireStudioSession()` → owner/manager gate (`PermissionDeniedError`) → `pos_void_ticket` (service-role) → for each card/gift row `refundCardPayment(...)` with `buildRefundIdempotencyKey`, on any throw mark legs `failed` + abort + `SquareRefundFailedError` (ticket stays `paid`) → `pos_finalize_void` → `revalidatePath('/checkout'|'/dashboard'|'/transactions')`. Maps RPC `ticket_not_void_eligible`→`VoidNotAllowedError`. Depends on T003, T008, T011.
- [ ] T016 [P] [US1] Create `components/lacquer/checkout/void-confirm-dialog.tsx` — a shadcn `AlertDialog` confirming the full reversal (tokens only, Lucide icon, sentence-case copy, tabular currency), calling `voidSale` and surfacing `error.name`→sonner toast (mirror feature 050's `receipt-line-tech-chip.tsx` error-mapping convention).
- [ ] T017 [US1] Edit `components/lacquer/checkout/done-screen.tsx` to render the owner/manager "Void sale" affordance only when the viewer role is owner/manager AND the ticket is same-day paid and not already reversed (salon-local day via `lib/time/*`), opening the `VoidConfirmDialog`. Depends on T015, T016.
- [ ] T018 [US1] Run `npx playwright test tests/e2e/void-sale.spec.ts` and the design-side checks; confirm all US1 acceptance scenarios pass (void completes, role-gate denial, no double-void, prior-day excluded, Square-fail leaves ticket recoverable).

**Checkpoint**: Same-day void is fully functional and independently testable — MVP shippable.

---

## Phase 4: User Story 2 - Refund a past sale, full or partial (Priority: P2)

**Goal**: An owner/manager opens the shared `ReceiptDrawer` from the dashboard recent-transactions feed or the EOD day report, composes per-payment refund amounts (each ≤ unrefunded remainder, total > 0), and submits — `kind='refund'` rows linked to originals, Square refund for card/gift, ticket→`refunded` or `partially_refunded`, `payment.refund_issued` audit.

**Independent Test**: As owner/manager from the dashboard feed, open "Refund", refund part of one payment → ticket reads "partially refunded", a refund row for exactly that amount exists, remaining balance correct; refund the rest → "refunded". Over-amount blocked in-sheet and server-refused. Technician sees no "Refund". (Per spec US2 acceptance scenarios 1–8.)

### Tests for User Story 2 (write to FAIL first) ⚠️

- [ ] T019 [US2] Write failing e2e `tests/e2e/refund-ticket.spec.ts` (worker-scoped fixture + audit cursors, dedicated in-spec tickets): partial refund from the feed/drawer → `partially_refunded` + refund row of exact amount + remaining = original − refunded; then full → `refunded`; an over-remainder amount is server-refused (`RefundExceedsRemainingError`); zero-total submission blocked; one `payment.refund_issued` audit row per action with matching `resulting_status`; technician sees no "Refund" affordance and a direct `refundTicket` call is refused (`PermissionDeniedError`); refund opened from the EOD day report behaves identically.

### Implementation for User Story 2

- [ ] T020 [US2] Implement the `refundTicket({ ticketId, lines })` server action in `app/(studio)/transactions/actions.ts` per contracts/server-actions.contract.md: `requireStudioSession()` → owner/manager gate → Zod-validate `lines` non-empty / each `amountCents>0` → `pos_refund_payments` → card/gift legs `refundCardPayment(...)`, on throw mark failed + abort + `SquareRefundFailedError` (no status change) → `pos_finalize_refund` → `revalidatePath('/dashboard'|'/transactions'|'/end-of-day')`. Maps `refund_exceeds_remaining`→`RefundExceedsRemainingError`, payment-not-on-ticket→`PaymentNotOnTicketError`. Depends on T004, T008, T011, T012.
- [ ] T021 [P] [US2] Create `components/lacquer/transactions/refund-composition-sheet.tsx` — a shadcn `Sheet` (16px radius) listing the ticket's payments with a per-payment refund-amount input, client-side validation (each ≤ displayed remaining, total > 0, disable submit otherwise with an explanatory message), tabular-numeral currency, calling `refundTicket` and mapping `error.name`→sonner toast.
- [ ] T022 [US2] Edit `components/lacquer/transactions/receipt-drawer.tsx` to add the owner/manager "Refund" entry (gated on the existing `canEdit = (owner||manager) && !payPeriodFinalized`) that reveals the `RefundCompositionSheet` for the drawer's ticket. Depends on T020, T021.
- [ ] T023 [P] [US2] Edit `components/lacquer/recent-transactions-feed.tsx` to add a per-row owner/manager "Refund" affordance that opens the shared `ReceiptDrawer` for that ticket (the feed currently has no per-row action — add one without disturbing non-privileged rendering).
- [ ] T024 [US2] Wire the same owner/manager "Refund" affordance into the End-of-Day day-report transaction list (the EOD report surface under `app/(studio)/end-of-day/` + its `components/lacquer/report/*` list) so it opens the shared `ReceiptDrawer`→`RefundCompositionSheet`, behaving identically to the dashboard feed (FR-012, US2 scenario 6). Depends on T022.
- [ ] T025 [US2] Run `npx playwright test tests/e2e/refund-ticket.spec.ts`; confirm all US2 acceptance scenarios pass (partial→full status transitions, over-amount & zero blocked, role-gate denial, EOD parity, Square-fail leaves status unchanged).

**Checkpoint**: Both stories work independently; voids and refunds fully delivered.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Design fidelity, manual validation, and the full pre-PR gate.

- [ ] T026 Dispatch `speckit-design-auditor` (UI touched `components/` + `app/`): side-by-side the void-confirm dialog, refund-composition sheet, and the feed/done-screen affordances against `design-system/` prototypes; confirm every color/spacing/radius/shadow/type value traces to a token (Principle I).
- [ ] T027 Run the `quickstart.md` walkthrough end-to-end against local Supabase + Square sandbox: same-day cash void, card/gift refund with `square_refund_id` set, simulated Square failure leaving the ticket unchanged (SC-007), and the audit-row assertions.
- [ ] T028 Final full gate before PR: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e` — all five green. Open the PR with `Closes #052`-equivalent reference.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS both user stories. Within it: T002 → T003, T004 (same migration file, sequential) → T005 (apply). T006/T007/T008 are independent `[P]`. T009/T010 (failing unit tests) precede T011/T012. T011 depends on T007. T013 independent.
- **User Story 1 (Phase 3)**: depends on Foundational (needs `pos_void_ticket`/`pos_finalize_void`, `refundCardPayment`, error types).
- **User Story 2 (Phase 4)**: depends on Foundational (needs the refund RPCs, `refund-status.ts`, `refundCardPayment`, error types). Independent of US1 — can run in parallel with Phase 3 if staffed.
- **Polish (Phase 5)**: depends on all desired stories being complete.

### Within Each User Story

- The e2e spec is written first and must FAIL before implementation (T014 before T015–T017; T019 before T020–T024).
- Action before the UI that calls it; the new component (`[P]`) can be built alongside the action, then the host surface edit integrates both.
- US1: T015 + T016 → T017 → T018. US2: T020 + T021 → T022 → (T023 ‖ T024) → T025.

### Parallel Opportunities

- Foundational: T006, T007, T008 together; then T009, T010 together; then T011, T012 together.
- Across stories: once Phase 2 is done, US1 and US2 can proceed concurrently (different files).
- Within US2: T021 and T023 are different files and can run alongside the action work; T024 follows T022 (shared drawer wiring).

---

## Parallel Example: Foundational helpers

```bash
# After the migration applies (T005), launch the independent helper tasks together:
Task: "Add audit actions to lib/auth/audit.ts"                       # T006
Task: "Add buildRefundIdempotencyKey to lib/square/terminal.ts"      # T007
Task: "Add reversal error types to app/(studio)/checkout/_errors.ts" # T008

# Then the failing unit tests together:
Task: "Failing unit test tests/unit/square/refund-payment.test.ts"   # T009
Task: "Failing unit test tests/unit/payments/refund-status.test.ts"  # T010
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (CRITICAL — blocks both stories).
2. Phase 3 User Story 1 (same-day void).
3. **STOP and VALIDATE**: void a same-day ticket, confirm role-gate denial + audit. Shippable MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add US1 → test independently → demo (MVP).
3. Add US2 (refund composition) → test independently → demo.
4. Polish → final gate → PR.

### Within scope discipline

- No `authorized_by_staff_id` column, no manager-PIN dialog (single-actor role gate — spec § Resolved Decisions).
- Cash-drawer reconciliation for cash refunds is deferred (out of scope).
- No re-open/un-void path; no goodwill refunds (FR-019/FR-020).

---

## Notes

- `[P]` = different files, no incomplete dependencies.
- `[Story]` labels (US1/US2) map tasks to spec user stories for traceability; Setup/Foundational/Polish carry none.
- Money + auth paths: tests written to FAIL first (Principle IV).
- The ticket-status flip lives only in the `*_finalize_*` RPC, after every card/gift Square refund confirms — guarantees no half-reversed ticket (SC-007).
- Both new e2e specs belong in the parallel `main` Playwright project (no global-aggregate assertions); they create their own tickets to stay parallel-safe.
- Commit after each task or logical group; never commit to `main`.
