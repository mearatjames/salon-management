---

description: "Task list for 042-ephemeral-cart"
---

# Tasks: Ephemeral Cart

**Input**: Design documents from `/specs/042-ephemeral-cart/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/server-actions.md](./contracts/server-actions.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. This feature changes money-handling Server Actions, which the Tang Nails Constitution Principle IV classifies as a critical path. Tests MUST be written first and MUST fail before each corresponding implementation task is started.

**Organization**: Tasks are grouped by user story (US1, US2, US3) so each story can be implemented, tested, and demoed independently. The MVP is US1 alone — cash + gift commits.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on incomplete tasks — safe to run in parallel
- **[Story]**: Maps the task to a user story (US1, US2, US3) for traceability
- Each task names exact file paths

## Path Conventions

- Single Next.js project (existing). All work under `app/(studio)/checkout/**`, `components/lacquer/**`, `tests/{unit,e2e}/**`
- No new top-level directories, no new packages, no schema migrations

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify prerequisites and pull a fresh base.

- [ ] T001 Verify that prerequisite issues #25, #26, #27 are merged to `main` (see [spec.md § Prerequisites](./spec.md#prerequisites)). If any are not merged, STOP and merge them first — the new commit Server Actions inherit assumptions from those fixes. Then `git -C /Users/mearathou/Dev/salon-management fetch origin main && git rebase origin/main` from the `042-ephemeral-cart` branch to pick them up.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared client-side cart shape, server-side validation schema, and the new route topology. Every user story depends on these.

**⚠️ CRITICAL**: No user-story phase can begin until Phase 2 is complete.

### Tests for Foundational (write first; MUST fail before implementation)

- [ ] T002 [P] Write Vitest unit tests for `EphemeralCart` types, item normalization, and preview-total helpers in `tests/unit/checkout/cart.test.ts`. Cover: empty-cart predicate, add/remove item immutability, percent-discount preview math, amount-discount preview math, line-total snapshotting. Confirm `npm test -- tests/unit/checkout/cart.test.ts` fails because `_cart.ts` does not exist yet.
- [ ] T003 [P] Write Vitest unit tests for `commitCartSchema` validation in `tests/unit/checkout/commit-from-cart-schema.test.ts`. Cover: rejects empty items array, rejects non-UUID `serviceId`/`techId`, accepts `customerId: null`, rejects `percent` outside [0,100], rejects negative `amountCents`. Confirm the test fails before implementation.

### Implementation for Foundational

- [ ] T004 [P] Implement the `EphemeralCart` shape, item-builder helper, preview-total helpers, and cart-hash function in `app/(studio)/checkout/_cart.ts`. Types per [data-model.md](./data-model.md). Pure functions only — no React, no fetch.
- [ ] T005 [P] Implement `commitCartSchema` (Zod), the `EphemeralCartInput` exported type, and the server-side `resolveCartForCommit(cart)` helper (re-resolves prices/staff/customer from the database, returns canonical totals) in `app/(studio)/checkout/_commit-from-cart.ts`. Per [contracts/server-actions.md § Common input](./contracts/server-actions.md).
- [ ] T006 Implement `CartProvider`, `useCart()` hook, and reducer actions (`addItem`, `removeItem`, `setItemTech`, `setItemNote`, `setCustomer`, `setTech`, `setDiscount`, `setNotes`, `reset`) in `app/(studio)/checkout/_cart-context.tsx`. Depends on T004.
- [ ] T007 Create the cart-building UI client component at `app/(studio)/checkout/checkout-screen.client.tsx` by extracting cart-edit logic from `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`. The new file consumes `useCart()` for state instead of calling `addServiceLine`/etc. Server Actions. Depends on T006. The four payment buttons are wired up later in their respective user-story phases — render them as disabled placeholders here.
- [ ] T008 Rewrite `app/(studio)/checkout/page.tsx` to render `<CartProvider><CartBuildingScreen /></CartProvider>`. Remove the eager-create dispatcher (lines 24–29 of the current file). The page no longer reads a `?fresh=1` query param. Depends on T007.
- [ ] T009 Add a defensive guard to `app/(studio)/checkout/[ticketId]/page.tsx`: if the loaded ticket has `status='open'` AND zero `ticket_items` rows, render Next.js `notFound()` (or redirect to `/checkout`). This catches any future regression that would re-introduce empty open tickets and protects SC-003.

**Checkpoint**: Foundation ready. The cart-building UI renders at `/checkout` with disabled Submit buttons; navigating to it writes nothing to the database. Visit `/checkout`, take 0 actions, verify zero rows in Supabase — SC-001, SC-002, SC-003 already provably hold.

---

## Phase 3: User Story 1 — Cash and gift commit promote ephemeral cart to ticket (Priority: P1) 🎯 MVP

**Goal**: Submitting cash or gift card creates the ticket, items, and first payment atomically. Until that submit, the database stays untouched. The cart survives a failed commit.

**Independent Test**: Open `/checkout` fresh, build a 2-service cart, submit cash. Verify exactly one new `tickets` row (`status='paid'`), 2 new `ticket_items` rows, 1 new `payments` row (`method='cash'`, `status='succeeded'`). Refresh `/checkout` after walking away from a different cart — verify zero residual rows.

### Tests for User Story 1 (write first; MUST fail before implementation)

- [ ] T010 [P] [US1] Write Vitest unit tests for `submitCashFromCart` in `tests/unit/checkout/submit-cash-from-cart.test.ts`. Cover: rejects invalid input via schema, rejects `cashTenderedCents < total`, happy-path returns `{ ok: true, ticketId }` with mocked DB. Confirm failing before implementation.
- [ ] T011 [P] [US1] Write Vitest unit tests for `submitGiftFromCart` in `tests/unit/checkout/submit-gift-from-cart.test.ts`. Cover: rejects invalid input, `GIFT_NOT_FOUND`, `GIFT_INSUFFICIENT_BALANCE`, happy path. Confirm failing.
- [ ] T012 [P] [US1] Write Playwright e2e specs in `tests/e2e/checkout-ephemeral-cart.spec.ts` for: (a) abandon-cart hygiene invariant (visit `/checkout`, walk away, assert zero new rows), (b) build cart + submit cash → assert tickets/ticket_items/payments and audit_log rows, (c) build cart + submit gift → same shape with `method='gift'`, (d) submit cash with stale (deactivated) service → assert error toast + cart preserved + zero new rows. Use the `_fixtures.ts` worker-scoped staff trio and `newAuditCursor()` per the CLAUDE.md parallel-tests pattern. Confirm failing before implementation.

### Implementation for User Story 1

- [ ] T013 [US1] Implement `submitCashFromCart(cart, cashTenderedCents)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § Action 1](./contracts/server-actions.md). Single Postgres transaction: insert ticket → bulk insert items → call `pos_take_cash` RPC. Returns `CommitResult`. Depends on T005, T010.
- [ ] T014 [US1] Implement `submitGiftFromCart(cart, giftCardNumber, gan)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § Action 2](./contracts/server-actions.md). Single transaction: insert ticket → bulk insert items → call `pos_record_gift_payment` RPC. Depends on T005, T011.
- [ ] T015 [US1] Wire the "Submit Cash" and "Submit Gift" controls in `app/(studio)/checkout/checkout-screen.client.tsx` to call the new actions. On `ok: true` call `cartReducer.reset()` then `router.push('/checkout/' + ticketId)`. On `ok: false` show an error toast via `_errors.ts` mapping and keep cart state intact. Depends on T007, T013, T014.

**Checkpoint**: Submit Cash and Submit Gift work end-to-end from `/checkout` with no eager ticket creation. Failed commits preserve the cart. MVP complete — could ship US1 alone if needed.

---

## Phase 4: User Story 2 — Square Terminal handoff promotes ephemeral cart to ticket (Priority: P2)

**Goal**: "Send to Square Terminal" creates the ticket + items + `pending` card payment row in one transaction, then asks Square to start the capture. Failure rolls back the rows and keeps the cart in memory.

**Independent Test**: Build a cart, click "Send to Square Terminal". Assert one new `tickets` row (`status='open'`), N items, one `payments` row (`method='card'`, `status='pending'`, `square_terminal_checkout_id` populated). Simulate a Square API failure and assert zero residual rows + cart preserved.

### Tests for User Story 2 (write first; MUST fail before implementation)

- [ ] T016 [P] [US2] Write Vitest unit tests for `sendCardToTerminalFromCart` in `tests/unit/checkout/send-card-to-terminal-from-cart.test.ts`. Mock the Square SDK. Cover: input validation, happy path returns `{ ok: true, ticketId }`, Square API failure path returns `TERMINAL_HANDOFF_FAILED` AND the rollback DELETEs ran (assert via mocked DB). Confirm failing.
- [ ] T017 [P] [US2] Extend `tests/e2e/checkout-ephemeral-cart.spec.ts` with: (a) happy-path Send to Square Terminal → assert ticket/items/payments rows + transition to waiting screen, (b) Square API failure → assert zero residual rows after handoff + cart preserved. Use the existing Square Sandbox harness from `tests/e2e/checkout-square-terminal.spec.ts` as reference. Confirm failing.

### Implementation for User Story 2

- [ ] T018 [US2] Implement `sendCardToTerminalFromCart(cart, deviceId)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § Action 3](./contracts/server-actions.md). Inside one transaction: insert ticket (`status='open'`) → bulk insert items → insert `payments` row (`status='pending'`). Commit. Then call Square `createTerminalCheckout` with idempotency key `${ticketId}:${paymentId}`. On Square success: update payment with `square_terminal_checkout_id`. On Square failure: DELETE payments → DELETE ticket_items → DELETE tickets, return `TERMINAL_HANDOFF_FAILED`. Depends on T005, T016.
- [ ] T019 [US2] Wire the "Send to Square Terminal" button in `app/(studio)/checkout/checkout-screen.client.tsx` to call the new action. On `ok: true` reset cart + `router.push('/checkout/' + ticketId)`; on `ok: false` show error toast and keep cart. Depends on T007, T018.

**Checkpoint**: All three single-tender commit paths (cash, gift, card) work from the ephemeral cart. Square Terminal handoff failure leaves no residue.

---

## Phase 5: User Story 3 — Split tender initiation promotes ephemeral cart to ticket (Priority: P3)

**Goal**: Initiating split tender creates the ticket + items in one transaction and hands off to the existing mid-split-tender screen. The existing leg-settlement, draft-invalidation, and discard mechanics keep working unchanged.

**Independent Test**: Build a cart, click "Split tender". Assert ticket + items rows exist; navigate to `/checkout/<new-id>` shows the existing mid-split UI. Capture legs through the existing UI; assert final state matches a today's split-tender sale.

### Tests for User Story 3 (write first; MUST fail before implementation)

- [ ] T020 [P] [US3] Write Vitest unit tests for `splitTenderFromCart` in `tests/unit/checkout/split-tender-from-cart.test.ts`. Cover: input validation, happy path inserts ticket + items + composes initial draft state via mocked `pos_compose_payment_draft`. Confirm failing.
- [ ] T021 [P] [US3] Extend `tests/e2e/checkout-ephemeral-cart.spec.ts` with a split-tender flow: build cart from `/checkout`, click "Split tender", assert ticket+items appear at split-init (NOT at page load), capture two legs via the existing mid-split UI, assert final `status='paid'` matches today's flow. Confirm failing.

### Implementation for User Story 3

- [ ] T022 [US3] Implement `splitTenderFromCart(cart)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § Action 4](./contracts/server-actions.md). Inside one transaction: insert ticket (`status='open'`) → bulk insert items → call `pos_compose_payment_draft(ticket_id)`. Returns `{ ok: true, ticketId }`. Depends on T005, T020.
- [ ] T023 [US3] Wire the "Split tender" entry point in `app/(studio)/checkout/checkout-screen.client.tsx` to call the new action. On `ok: true` reset cart + `router.push('/checkout/' + ticketId)` so the existing mid-split-tender UI takes over. Depends on T007, T022.

**Checkpoint**: All four commit paths work from the ephemeral cart. The existing mid-split-tender screen's Discard button continues to work on real tickets (FR-007).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Entry-point rewires, button visibility, test infrastructure, dead-code cleanup, and final gate run.

- [ ] T024 [P] Update `components/lacquer/new-transaction-cta.tsx` so the dashboard "New transaction" CTA links to `/checkout` (no `?fresh=1` query param).
- [ ] T025 [P] Update `components/lacquer/sidebar/nav-items.ts` line 87 so the sidebar Checkout link points to `/checkout` (semantics now: cart-building entry, no eager create).
- [ ] T026 [P] Update `components/lacquer/checkout/done-screen.tsx` line 70 so the "New sale" link points to `/checkout` (no eager create).
- [ ] T027 [P] Update `components/lacquer/checkout/tx-header.tsx` (lines 58–105) to hide the Cancel and Discard buttons when the component is rendered without a `ticketId` (i.e., on the cart-building phase). Keep them visible and functional when `ticketId` is provided (i.e., on the mid-split-tender screen). Per FR-006 and FR-007.
- [ ] T028 Update the three existing checkout e2e specs for the route topology change: `tests/e2e/checkout-cash-sale.spec.ts`, `tests/e2e/checkout-square-terminal.spec.ts`, `tests/e2e/checkout-gift-split-tender.spec.ts`. Replace navigation to `/checkout/<id>` for cart-building with `/checkout`; remove assertions on the Cancel button at cart-build time; keep mid-split-tender Discard assertions intact. (Single task because these three files share the same edit pattern and `actions.ts` reference; conflict risk if parallelized.)
- [ ] T029 [P] Update `tests/e2e/_affected-map.mjs` to map the new code paths (`app/(studio)/checkout/_cart.ts`, `_cart-context.tsx`, `_commit-from-cart.ts`, the new server actions in `actions.ts`) to the e2e specs that exercise them (`checkout-ephemeral-cart.spec.ts` plus the three updated specs). Per CLAUDE.md "Scoping intermediate phase gates" guidance.
- [ ] T030 [P] In `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`, remove the cart-edit handlers (`handleCancel` line 613, `handleDiscard` line 595 are reused but the cart-build code paths around them are dead) that are unreachable now that the cart-build phase no longer mounts this component. Be precise: only delete handlers that have no remaining caller. Per [research.md D7](./research.md). Leave `createEmptyTicket` and `resumeOrCreateTicket` in `actions.ts` (deferred cleanup, tracked as follow-up issue).
- [ ] T031 Run the full pre-push gate set in order, all must pass: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. Per CLAUDE.md "Pre-push quality gates" and Constitution § Development Workflow.
- [ ] T032 Walk through every step in [quickstart.md](./quickstart.md) (steps 1–7) against a local Supabase + Square Sandbox; document any deviations and open issues for them.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No code dependencies. Just confirms prereqs and rebases.
- **Phase 2 (Foundational)**: Depends on Phase 1. BLOCKS Phases 3, 4, 5.
- **Phase 3 (US1)**: Depends on Phase 2. Independent of Phases 4 and 5.
- **Phase 4 (US2)**: Depends on Phase 2. Independent of Phases 3 and 5 *for testing*, but T018 edits the same file (`actions.ts`) as T013 and T014 — sequence the action implementations even if you parallelize across stories.
- **Phase 5 (US3)**: Depends on Phase 2. Same `actions.ts` file constraint as US2.
- **Phase 6 (Polish)**: Depends on all user-story phases being functionally complete. T031 (gate run) MUST be last.

### File-conflict notes (overrides [P] markings)

- `app/(studio)/checkout/actions.ts` is edited by T013, T014, T018, T022. They are NOT parallelizable with each other even though they belong to different user-story phases.
- `app/(studio)/checkout/checkout-screen.client.tsx` is created in T007 and edited in T015, T019, T023. T007 must complete first; the three wiring tasks each touch different button handlers, but to keep diffs reviewable, sequence them.
- `tests/e2e/checkout-ephemeral-cart.spec.ts` is created in T012 and extended in T017 and T021. Sequence them (T012 → T017 → T021) so each `describe` block lands cleanly.

### Within Each User Story

- Tests FIRST (write the unit + e2e tests, run them, see them fail)
- Server Action implementation second
- UI wiring third
- Story-internal checkpoint: run the story's tests and confirm green

### Parallel Opportunities

- **Foundational tests in parallel**: T002 and T003 — different test files, no shared state.
- **Foundational implementation files in parallel**: T004 and T005 — different files.
- **US1 tests in parallel**: T010, T011, T012 — three different files.
- **US2 tests in parallel**: T016 and T017.
- **US3 tests in parallel**: T020 and T021.
- **Polish UI rewires in parallel**: T024, T025, T026, T027 — four different files.
- **Test-infrastructure tasks in parallel**: T029 (`_affected-map.mjs`) can run alongside T028 (e2e spec updates) and T030 (dead-code removal).
- **Cross-story Server Action implementations**: NOT parallelizable due to the shared `actions.ts` file.

---

## Parallel Example: User Story 1

```bash
# Run all three US1 test files together (each writes a fresh file, no conflict):
Task: "T010 [P] [US1] Write Vitest unit tests for submitCashFromCart in tests/unit/checkout/submit-cash-from-cart.test.ts"
Task: "T011 [P] [US1] Write Vitest unit tests for submitGiftFromCart in tests/unit/checkout/submit-gift-from-cart.test.ts"
Task: "T012 [P] [US1] Write Playwright e2e specs in tests/e2e/checkout-ephemeral-cart.spec.ts"

# Then implementation (sequential — same file):
Task: "T013 [US1] Implement submitCashFromCart in actions.ts"
Task: "T014 [US1] Implement submitGiftFromCart in actions.ts"  # after T013 lands

# Then UI wiring:
Task: "T015 [US1] Wire Submit Cash and Submit Gift buttons"
```

---

## Implementation Strategy

### MVP First (US1 only — cash + gift)

1. Phase 1: Setup (verify prereqs, rebase).
2. Phase 2: Foundational (cart shape, context, route topology — 8 tasks).
3. Phase 3: US1 (cash + gift commit — 6 tasks).
4. **STOP and validate**: run `npm run test:e2e -- tests/e2e/checkout-ephemeral-cart.spec.ts` and walk through quickstart steps 1–3.
5. If demo-worthy, this could ship behind a feature flag while US2 and US3 land.

### Incremental Delivery

After MVP, add stories one at a time:

- Add US2 (Square Terminal) → run T031 → demo handoff success + failure rollback.
- Add US3 (split tender) → run T031 → demo end-to-end with all four commit paths.
- Polish phase last (rewires + e2e updates + final gate).

### Parallel Team Strategy (not applicable here)

This feature is a single-developer refactor with strict file-conflict constraints in `actions.ts`. Sequence by user story.

---

## Constitution Principle IV reminders

Money-handling code MUST be test-driven:

- T002, T003, T010, T011, T012, T016, T017, T020, T021 all write tests BEFORE the corresponding implementation tasks. The tests MUST be observed to fail before the implementation starts.
- Any PR for this feature that merges an implementation task without its prior test landing in the same or earlier commit MUST be bounced in review.

## Notes

- `[P]` = different files, no dependency on incomplete tasks
- `[Story]` = US1 / US2 / US3 traceability label
- The 4 new Server Actions all live in the same `actions.ts` file — file conflicts force sequencing across stories' implementation tasks
- Quickstart (T032) is a manual gate; failures there mean re-open the relevant story phase, not "punt to follow-up"
- After all 32 tasks pass, the next step is to push the branch and open a PR with `Closes` on whichever GitHub issue tracks this refactor (or none, if no issue exists)
