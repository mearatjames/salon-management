---

description: "Task list for feature 051-square-itemized-order"
---

# Tasks: Itemized Square Terminal Checkout

**Input**: Design documents in `/specs/051-square-itemized-order/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` (all present).

**Tests**: REQUIRED. Constitution Principle IV (Test-First for Critical Paths) — `lib/square/terminal.ts` and the new `lib/square/orders.ts` are Square SDK wrappers for the card-payment path. Vitest tests are written and shown to fail before the implementation that satisfies them lands.

**Organization**: Tasks are grouped by user story so each story can be implemented and demoed independently. Within each user story phase, failing tests come first, then implementation, then e2e. Phase verification at the end of each story uses **scoped** gates (per CLAUDE.md "Scoping intermediate phase gates"); the **final gate** in Phase 6 runs everything full.

## Format: `[TaskID] [P?] [Story?] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete tasks.
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — maps to the user-story phases in `spec.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema change applied before any code can write the new columns.

- [X] T001 Create migration file `supabase/migrations/0024_square_order_id.sql` per Research R8 — adds `payments.square_order_id text null` and `square_oauth.location_id text null` (both nullable, no defaults, no constraints, no backfill). Include the header comment block following the convention in adjacent migrations (feature ref `051-square-itemized-order`, reason: audit + lazy-resolved Square primary location).
- [X] T002 Apply the migration to the local Supabase stack: `supabase db reset` and verify `select column_name from information_schema.columns where table_name in ('payments','square_oauth') and column_name in ('square_order_id','location_id');` returns both rows.

**Checkpoint**: Setup complete — schema is ready for foundational + user-story tasks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Helpers and test infrastructure that every user-story phase depends on.

**⚠️ CRITICAL**: No user-story phase may begin until Phase 2 is complete.

- [X] T003 [P] Add `getSquareLocationId()` helper to `lib/square/oauth.ts` per Research R1 and `data-model.md → square_oauth.location_id`. Behavior: read the singleton `square_oauth` row; if `location_id` is non-null return it; otherwise call `client.locations.get({ locationId: 'main' })`, take the returned `location.id`, persist to the row, return it. Throw `Error('getSquareLocationId: Square not connected')` if no row exists.
- [X] T004 [P] Extend `tests/e2e/_square-stub.ts` per Research R4: intercept `POST /v2/orders` (return `200` with `{ order: { id: 'ord_test_<uuid>', version: 1, ... } }`); intercept `PUT /v2/orders/:id` (return `200` with the updated order body); record the captured request bodies for each path on a list that specs can assert against (mirror the existing `terminal.checkouts.create` recorder pattern).

**Checkpoint**: Foundational layer ready — every user story can begin in parallel from this point.

---

## Phase 3: User Story 1 — Owner reconciles Square dashboard with itemized charges (Priority: P1) 🎯 MVP

**Goal**: Single-tender card sales send a Square Order whose line items + discounts mirror `ticket_items`, so the Square dashboard shows each service and discount instead of "Custom amount".

**Independent Test**: Run a single-tender card sale through the Square Terminal sandbox for a ticket with two services and a discount. The Square dashboard MUST show two service line items with names + unit prices, the discount with its label + amount, and a total matching Tang Nails.

### Tests for User Story 1 (FAIL first — Constitution IV)

- [X] T005 [P] [US1] Extend `tests/unit/square/terminal-checkout.test.ts` with the following failing cases (mock `client.orders.create` + `client.terminal.checkouts.create`):
  - (a) Single-tender ticket with two services → `orders.create` request has `lineItems` with two entries, each with `name`, `basePriceMoney.amount`, `quantity` matching the rows.
  - (b) Single-tender with one targeted discount (`discount_target_line_ids: [serviceUid]`) → top-level `discounts[]` has one entry with `scope: 'LINE_ITEM'`; the targeted `lineItem.appliedDiscounts: [{ discountUid }]` is populated.
  - (c) Single-tender with one untargeted discount → top-level `discounts[]` has one entry with `scope: 'ORDER'`; no `lineItem.appliedDiscounts` set.
  - (d) Service line with `qty: 3` → exactly one `lineItem` entry with `quantity: '3'` (string per Square SDK type).
  - (e) Service line with `unit_price_cents: 0` → `lineItem.basePriceMoney.amount === 0n`, NOT omitted.
  - (f) Service whose `name_snapshot` is `Owner's special` → `lineItem.name === "Owner's special"` (no escaping drift).
  - (g) Split-tender card leg (`existingDraftId` argument set on `sendCardToTerminal`) → `orders.create` is NOT called; `terminal.checkouts.create` is called with `checkout.amountMoney` and no `checkout.orderId`.
- [X] T006 [P] [US1] Extend `tests/unit/square/terminal-checkout.test.ts` with case (k) asserting that `orders.create` and `terminal.checkouts.create` for the same `(ticketId, paymentId)` receive the identical 32-char hex `idempotencyKey` derived via `buildIdempotencyKey(ticketId, paymentId)` (Research R6 / FR-006).

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `lib/square/orders.ts` per `contracts/lib-square-orders.md`. Implement the `EmptyOrderError` class and the pure `mapTicketItemsToOrderLineItems(rows: TicketItemRow[]): OrderPayload` function per `data-model.md` validation rules 1–6 — discount sign normalization, zero-amount discount skip, qty < 1 defensive throw, empty-lineItems throw, uid uniqueness check, targeted-discount sanity check.
- [X] T008 [US1] Add `createOrder({ ticketId, paymentId, locationId, ticketItems })` to `lib/square/orders.ts` per `contracts/lib-square-orders.md`. Reads tokens via `readDecryptedTokens()`, builds the idempotency key via the exported `buildIdempotencyKey` from `lib/square/terminal.ts`, sends `client.orders.create` with `taxes: []` + `pricingOptions: { autoApplyTaxes: false, autoApplyDiscounts: false }` per Research R2, returns `{ orderId, orderVersion }`. Throws if the response is missing `order.id`. (Depends on T007.)
- [X] T009 [US1] Extend `createCheckout` in `lib/square/terminal.ts`: add an optional `orderId?: string` to `CreateCheckoutInput`. When set, the SDK request sends `checkout.orderId` and omits `checkout.amountMoney`; when absent, fall back to today's `checkout.amountMoney` payload. `referenceId: ticketId` set on both branches. Keep the existing idempotency-key derivation.
- [X] T010 [US1] Extend `sendCardToTerminal` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md`:
  - Detect single-tender vs split-tender: `const isSingleTender = !existingDraftId && paymentAmountCents === ticket.total_cents`.
  - On the single-tender branch only: `select id, kind, name_snapshot, unit_price_cents, qty, discount_target_line_ids from ticket_items where ticket_id = :ticketId order by created_at`; call `locationId = await getSquareLocationId()`; call `createOrder({ ticketId, paymentId, locationId, ticketItems })`; persist `payments.square_order_id = orderId` via a single-column `update`; then call `squareCreateCheckout({ ticketId, paymentId, deviceId, referenceId: ticketId, orderId })` with NO `amountCents`.
  - On the split-tender branch: continue with today's path verbatim (pass `amountCents: paymentAmountCents`, no `orderId`).
  - Catch `EmptyOrderError` (and any other internal error from `createOrder`) and translate to `SquareCheckoutCreateFailedError` so the operator-facing error vocabulary stays stable.
- [X] T011 [US1] Update the `recordAudit('payment.created', ...)` call inside `sendCardToTerminal` to include `square_order_id` in the `payload` JSON whenever the single-tender branch ran (FR-013 + Constitution Principle III audit-payload extension). Controlled-vocabulary `action` value is unchanged.
- [X] T012 [US1] Extend `tests/unit/square/client-import-graph.test.ts`: add `lib/square/orders.ts` to the set of modules asserted server-only (mirror the existing `lib/square/terminal.ts` assertion).

### E2E for User Story 1

- [X] T013 [US1] Extend `tests/e2e/card-payment-happy.spec.ts` with two assertions against the stub recorder from T004:
  - (l) Single-tender card sale: after the happy-path completes, the recorder shows exactly one `POST /v2/orders` with a body whose `order.lineItems[].name + basePriceMoney.amount + quantity` matches the seeded ticket's service rows.
  - (m) Split-tender card leg (run a cart with a partial cash payment then a card leg): the recorder shows ZERO `POST /v2/orders` for the card leg.

### Phase 3 verification gate (scoped)

- [X] T014 [US1] Scoped gate set per CLAUDE.md "Scoping intermediate phase gates":
  - `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`
  - `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`
  - `npm run typecheck`
  - `npm run test:changed`
  - `npm run test:e2e:changed`

**Checkpoint**: US1 fully functional. Single-tender card sales send itemized Orders to Square; the dashboard renders services + discounts. Demo-ready.

---

## Phase 4: User Story 2 — Customer's printed receipt itemizes the sale (Priority: P2)

**Goal**: The Square Terminal-printed (and emailed) receipt shows each service line and discount, not "Custom amount".

**Independent Test**: After US1 ships, run a card sale on a paired Square sandbox terminal, request both a printed and an emailed receipt, and confirm both list each service and the discount.

**Implementation note**: Square renders the printed/emailed receipt from the same Order created in US1 — there is no separate code path. US2's value is *verifying* that Square's rendering matches the dashboard.

### Verification for User Story 2

- [ ] T015 [US2] Manual sandbox verification per `quickstart.md → Smoke test (manual)` step 4: trigger a card sale for a ticket with at least two services and one discount on a real Square sandbox account paired to a terminal; request a printed receipt and an emailed receipt; confirm both list each service name + price and the discount with its label. Record the outcome (with screenshots if available) in the PR description.

**Checkpoint**: US1 + US2 demonstrably deliver value end-to-end (dashboard + receipt).

---

## Phase 5: User Story 3 — Square totals match Tang Nails exactly (Priority: P3)

**Goal**: For every itemized card sale, Square-recorded subtotal, discount total, tax, tip, and grand total match Tang Nails to the cent. No orphan Orders accumulate on the failure path.

**Independent Test**: For a ticket with services + discount + tip + zero tax, compare the Square dashboard's recorded totals against the Tang Nails ticket — every line matches to the cent. For a forced failure on the terminal-create call, Square shows the Order in `CANCELED` state (or a logged warning explains why the cancel failed).

### Tests for User Story 3 (FAIL first — Constitution IV)

- [X] T016 [P] [US3] Extend `tests/unit/square/terminal-checkout.test.ts` with failing case (h): for a fixture ticket of two services ($45 + $60) and a targeted -$10.50 discount, the `mapTicketItemsToOrderLineItems` output, when totaled (sum of `lineItems[i].basePriceMoney.amount * quantity` minus `discounts[i].amountMoney.amount`), equals the seeded `ticket.total_cents` ($94.50 → 9450 cents).
- [X] T017 [P] [US3] Extend `tests/unit/square/terminal-checkout.test.ts` with a failing case asserting every `client.orders.create` call body includes `order.taxes: []`, `order.pricingOptions.autoApplyTaxes: false`, and `order.pricingOptions.autoApplyDiscounts: false` (Research R2 / FR-005 / US3 AS2).
- [X] T018 [P] [US3] Create `tests/unit/square/order-cancel-orphan.test.ts` with two failing cases:
  - (i) `client.terminal.checkouts.create` is mocked to throw AFTER `client.orders.create` succeeds → `client.orders.update` is called exactly once with `orderId`, `version` matching the `orders.create` response, and `order.state === 'CANCELED'`.
  - (j) The `client.orders.update` call itself is mocked to throw → `console.warn` is invoked with a message containing both the original error and the cancel error; the function still throws the original `SquareCheckoutCreateFailedError`; the row is still marked `failed` with `failure_reason: 'square_unreachable'`.

### Implementation for User Story 3

- [X] T019 [US3] Add `cancelOrder({ orderId, orderVersion, locationId })` to `lib/square/orders.ts` per `contracts/lib-square-orders.md` and Research R7: calls `client.orders.update({ orderId, order: { locationId, version: orderVersion, state: 'CANCELED' } })`. Throws on Square error (caller catches).
- [X] T020 [US3] Update the catch branch in `sendCardToTerminal` (the one that runs when `squareCreateCheckout` throws AFTER the new `orders.create` succeeded): wrap a call to `cancelOrder({ orderId, orderVersion, locationId })` in `try/catch`; on cancel failure call `console.warn('orphan order cancel failed; orphan remains in Square dashboard', { orderId, checkoutError, cancelError })`. Do not surface the cancel error to the operator; continue with the existing `payments` failed-mark + audit + `throw SquareCheckoutCreateFailedError` flow.
- [X] T021 [US3] Thread `orderVersion` from `createOrder`'s return value through to the `cancelOrder` call. Capture it into a function-scoped `let orderVersion: number | null = null` declared alongside `let orderId: string | null = null` near the top of the single-tender branch.

### E2E for User Story 3

- [X] T022 [US3] Extend `tests/e2e/card-payment-cancel.spec.ts` with assertion (n): configure the Square stub from T004 to return a `500` on `POST /v2/terminals/checkouts` while still returning `200` on `POST /v2/orders`. Trigger a single-tender card sale; assert the stub recorder shows exactly one `PUT /v2/orders/:id` whose request body's `order.state === 'CANCELED'`. Assert the operator-facing error is the same `SquareCheckoutCreateFailedError` text as today.

### Phase 5 verification gate (scoped)

- [X] T023 [US3] Scoped gate set per CLAUDE.md "Scoping intermediate phase gates":
  - `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`
  - `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`
  - `npm run typecheck`
  - `npm run test:changed`
  - `npm run test:e2e:changed`

**Checkpoint**: US1 + US2 + US3 all independently functional. Totals match to the cent and orphan Orders self-clean on the failure path.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final-gate verification + manual orphan-cancel smoke + PR readiness.

- [ ] T024 [P] Manual orphan-cancel verification per `quickstart.md → Negative test (manual orphan-cancel)`: temporarily block egress to `connect.squareupsandbox.com/v2/terminals/checkouts` while allowing `/v2/orders`; trigger a single-tender card sale; confirm the Order in the Square sandbox dashboard transitions to `CANCELED`; confirm the application logs do NOT contain a `console.warn` (because the cancel succeeded). Record the outcome in the PR description.
- [X] T025 Run the FULL local gate set per CLAUDE.md "Pre-push quality gates", in order:
  1. `npm run format:check` — PASS (all files normalized; one new test file needed `npm run format`)
  2. `npm run lint` — PASS (2 unrelated warnings on `supply-type-picker.client.tsx:196` + `actions-invite-thorough.test.ts:73`; 0 errors)
  3. `npm run typecheck` — PASS (`tsc --noEmit` exit 0)
  4. `npm test` — PASS (1135 passed | 1 skipped — 118 test files)
  5. `npm run test:e2e` — PASS (315 passed, 12 skipped, 0 flaky; ~7.9 min full 4-project chain)

  All five gates green on 2026-05-24.
- [ ] T026 Update the PR body to:
  - Reference `Closes #149`.
  - Summarize the three resolved clarifications (Q1 single-tender-only itemization, Q2 line-level for targeted discounts, Q3 best-effort orphan-cancel).
  - Paste verification outcomes from T015 (US2 receipt smoke) and T024 (orphan-cancel smoke).
  - Confirm SC-001 through SC-008 are satisfied (cite test ids or screenshots for each).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no prerequisites; start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1 (the migration must apply before the Vercel preview deploy exercises any new code paths).
- **Phase 3 (US1) → Phase 4 (US2)**: US2's manual verification depends on US1's wrapper being shipped, so Phase 4 strictly follows Phase 3.
- **Phase 5 (US3)**: can begin in parallel with Phase 4 once Phase 3 completes; the orphan-cancel work depends on `createOrder` existing (T008), which is part of Phase 3.
- **Phase 6 (Polish)**: requires Phases 1–5 complete.

### Task dependencies inside a phase

- **Phase 3**: T005 + T006 (failing tests) must be authored first; T007 (mapping helper) makes T005's first case pass; T008 (createOrder) makes T006 pass; T009 (terminal wrapper extension) is independent; T010 (action wiring) depends on T007 + T008 + T009; T011 + T012 depend on T010.
- **Phase 5**: T016 + T017 + T018 (failing tests) first; T019 (cancelOrder) makes T018 pass; T020 (action wiring) depends on T019; T021 (orderVersion threading) depends on T020.

### Parallel opportunities

- **Phase 2**: T003 + T004 fully parallel.
- **Phase 3 tests**: T005 + T006 parallel.
- **Phase 3 impl seed**: T007 can run alongside T009 (different files); T010 is the integration point and waits for both.
- **Phase 5 tests**: T016 + T017 + T018 fully parallel.
- **Phase 6**: T024 (manual) parallel with T025 (full gate set).

---

## Parallel Example: User Story 1

```bash
# Phase 3 — failing tests first, in parallel (different file regions):
Task: "T005 [P] [US1] Add failing Vitest cases (a)–(g) to tests/unit/square/terminal-checkout.test.ts"
Task: "T006 [P] [US1] Add failing Vitest case (k) idempotency-key reuse to tests/unit/square/terminal-checkout.test.ts"

# Then the seed implementation tasks (different files):
Task: "T007 [P] [US1] Create lib/square/orders.ts skeleton + EmptyOrderError + mapTicketItemsToOrderLineItems"
Task: "T009 [US1] Extend createCheckout in lib/square/terminal.ts to accept optional orderId"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 — apply migration.
2. Phase 2 — foundational helpers + stub.
3. Phase 3 — itemized-Order path with failing tests first, then wrapper, then action wiring, then e2e.
4. Run the Phase 3 scoped gate (T014).
5. **STOP AND VALIDATE** — demo on a Square sandbox: a single-tender card sale shows itemized services + discount on the dashboard.

### Incremental delivery

1. MVP (above) → Demo / collect feedback.
2. US2 — manual receipt smoke (T015) → confirms the same Order renders correctly on Square receipts. No code.
3. US3 — totals parity tests + orphan-cancel wrapper + action wiring + e2e → defensive completeness.
4. Polish — full gate set + manual orphan-cancel smoke + PR body update → ready to merge.

### Parallel-developer strategy

US1 lands all the production code. US2 is a verification task. US3 adds the failure-path code. A second developer could pick up T016–T022 (US3) in parallel with US1's T010–T013 wiring once T007 (`mapTicketItemsToOrderLineItems`) lands, since US3's tests for that helper are non-overlapping with US1's tests (different cases inside the same file — coordinate to avoid edit collisions).

---

## Notes

- `[P]` tasks live in different files OR clearly non-overlapping regions of the same file.
- Constitution Principle IV (Test-First) is enforced by writing T005, T006, T016, T017, T018 BEFORE the implementation task that satisfies each case.
- Per CLAUDE.md "Scoping intermediate phase gates," T014 and T023 use scoped commands (`test:changed`, `test:e2e:changed`); the full suite runs only at T025.
- Per the `feedback_run_full_gate_set_before_push` memory: T025 runs the five gates in the prescribed order — `format:check → lint → typecheck → test → test:e2e`.
- Per the `feedback_no_direct_commits_to_main` memory: every change goes onto the feature branch `051-square-itemized-order` and merges via PR.
- Per the `feedback_e2e_reuse_existing_server_trap` memory: kill any stale `npm run dev` before T025 to avoid Playwright reusing a server running the wrong code.
- The orphan-cancel verification (T024) requires temporarily blocking the terminal endpoint — easiest method is editing `/etc/hosts` or using a local proxy. Document the method used in the PR body for repeatability.
