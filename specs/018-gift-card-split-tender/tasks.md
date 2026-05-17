---

description: "Tasks for feature 018-gift-card-split-tender — implementation order with per-story phasing, test-first for money paths, scoped intermediate gates."
---

# Tasks: Gift Card Redemption & Split-Tender Checkout

**Input**: Design documents in `/Users/mearathou/Dev/salon-management/specs/018-gift-card-split-tender/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. This feature is a money-critical path per Constitution v1.0.3 § Principle IV; every action listed in [contracts/server-actions.md](./contracts/server-actions.md) ships with the test files named in [plan.md § Constitution Check Principle IV](./plan.md). Tests are written and shown to fail before the implementation that satisfies them is written.

**Organization**: Tasks are grouped by user story so each can be implemented, tested, and validated independently. Setup + Foundational must complete before any story phase begins; the three story phases land in priority order P1 → P2 → P3 because Story 3 depends on Stories 1 and 2 being in place.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable (different files, no dependencies on incomplete tasks)
- **[Story]**: Story label (US1, US2, US3) — required for story-phase tasks only
- File paths are absolute or relative to the repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch + spec-tree exist; this phase confirms the working tree is ready.

- [X] T001 Confirm working tree is on branch `018-gift-card-split-tender` and clean (run `git status` from repo root; should show only the spec dir from prior phases of /ship)
- [X] T002 Confirm dependencies are current: `npm install` is a no-op (no new packages this feature; square@^44.0.1 already present)

**Checkpoint**: Setup ready — Foundational phase can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, audit verbs, error classes, Square wrapper, webhook dispatch, polling endpoint, e2e stub extension, draft-legs helper, and PaymentTiles enable. Every user story below depends on these landing first.

**⚠️ CRITICAL**: No user-story phase can start until this phase is complete.

### Schema (must commit before any RPC test can pass)

- [X] T003 Write `supabase/migrations/0010_gift_card_split_tender.sql` per [data-model.md](./data-model.md) — enum extensions (`payment_method += 'gift'`, `payment_status += 'draft'`), `gift_cards` table + RLS, `payments` column additions (`gift_card_id`, `square_gift_card_payment_id`), constraint relaxation (`payments_cash_status_succeeded_chk`), the two new partial indexes (`payments_one_in_flight_per_ticket_idx`, `payments_unique_succeeded_gift_card_payment_idx`), and the four new RPCs (`pos_compose_payment_draft`, `pos_remove_payment_draft`, `pos_activate_cash_draft`, `pos_record_gift_payment`). The migration must split the enum-add into its own `commit;` block before the constraint relaxation uses the new values (matches the pattern in `0008_square_terminal_payment.sql`).
- [X] T004 Apply the migration to the local Supabase: `supabase db reset` then verify with the four `psql ... \d+ / \df / enum_range` queries documented in [quickstart.md § 2](./quickstart.md).
- [X] T005 Regenerate `lib/db/types.ts` via `npm run db:gen-types` (or the project's equivalent supabase typegen command); commit the regenerated file.

### Application scaffolds (parallel after schema lands)

- [X] T006 [P] Extend `lib/auth/audit.ts` per [contracts/audit.contract.md](./contracts/audit.contract.md) — add the four new `AuditAction` verbs (`payment.draft_created`, `payment.draft_removed`, `gift_card.balance_looked_up`, `gift_card.redeemed`); extend `deriveEntityType` to map `gift_card.*` → `"gift_card"`; extend the `EntityType` return-type union to include `"gift_card"`.
- [X] T007 [P] Add new typed error classes to `app/(studio)/checkout/_errors.ts` per [contracts/server-actions.md § 9](./contracts/server-actions.md) — `GiftCardNotFoundError`, `GiftCardNotRedeemableError`, `GiftCardZeroBalanceError`, `GiftCardInsufficientBalanceError`, `InvalidGanError`, `SquareGiftCardLookupFailedError`, `SquareGiftCardPaymentFailedError`, `TicketAlreadyBeingChargedError`, `LegSumMismatchError`, `LegAmountInvalidError`, `DraftLegNotFoundError`.
- [X] T008 [P] Create `app/(studio)/checkout/_drafts.ts` exporting `discardDraftLegs(ticketId, operatorStaffId, supabase) → {discardedCount}` per [research.md § R5](./research.md#r5--cart-edit-invalidation-policy) and [data-model.md § 8](./data-model.md#8-discarddraftlegs-helper-application-layer-not-sql). Refuses on any `'pending'` row (throws `TicketAlreadyBeingChargedError`); otherwise audits + deletes drafts.

### Square wrapper (depends on T005 for typegen)

- [X] T009 Create `lib/square/gift-cards.ts` per [plan.md § Source Code](./plan.md) — exports `retrieveGiftCardFromGAN(gan)` (returns the discriminated-union `LookupResult` from [research.md § R3](./research.md#r3--square-gift-card-error-mapping)), `createGiftCardPayment({ticketId, paymentId, amountCents, giftCardId, referenceId})` reusing `buildIdempotencyKey` from `lib/square/terminal.ts:47`, and `getPayment(squarePaymentId)` for the polling fallback. Last-4 mask derivation lives here. Maps Square statuses to the discriminated-union per R3's table.

### Webhook + polling (depends on T009)

- [X] T010 Modify `lib/square/webhooks.ts` per [contracts/webhooks.contract.md](./contracts/webhooks.contract.md) — add `SquarePaymentUpdatedEvent` type, extend the `SquareWebhookEvent` discriminated union, and add `handlePaymentUpdated(event)` with the source-type guard (skip non-GIFT_CARD), the lookup by `square_gift_card_payment_id`, and the `pos_record_gift_payment` RPC dispatch. Leave `handleTerminalCheckoutUpdated` unchanged.
- [X] T011 Modify `app/api/webhooks/square/route.ts` to add the event-type switch per [contracts/api-routes.contract.md § 2](./contracts/api-routes.contract.md). The route's signature-verification and response-code handling are unchanged.
- [X] T012 Create `app/api/square/payment/[paymentId]/route.ts` per [contracts/api-routes.contract.md § 1](./contracts/api-routes.contract.md) — GET handler, studio-session-gated, returns `GiftPaymentStateResponse` (joins `payments` + `gift_cards.last4_mask`).

### Cart-edit invalidation wiring (depends on T008)

- [X] T013 Modify `app/(studio)/checkout/actions.ts` — add a `discardDraftLegs(...)` call as the first post-prelude step of each of the five line-mutation actions: `addServiceLine`, `removeLine`, `setLinePrice`, `addDiscountLine`, `removeDiscountLine`. Add `draftsDiscarded?: number` to each action's success-result shape per [contracts/server-actions.md § 8](./contracts/server-actions.md).

### E2E stub extension

- [X] T014 Extend `tests/e2e/_square-stub.ts` per [research.md § R10](./research.md#r10--extending-the-local-square-stub) and [quickstart.md § 3](./quickstart.md) — add the `/v2/gift-cards/from-gan` and gift-card `/v2/payments` endpoints with the deterministic GAN-suffix fixture matrix (`0001` → ACTIVE $60; `0002` → ACTIVE $15; `0003` → ACTIVE $5; `0000` → ACTIVE $0; `BLKD` → BLOCKED; `PEND` → PENDING; `DEAC` → DEACTIVATED; everything else → NOT_FOUND). Simulate `payment.updated` webhook delivery 100ms after gift-card `payments.create` (suppressible via `withSuppressedGiftWebhook()`).

### PaymentTiles enable

- [X] T015 Modify `components/lacquer/checkout/payment-tiles.tsx — enable the Gift tile (currently disabled with "Coming soon" tooltip; new logic: enabled when `squareConnected && devicesAvailable >= 1`, since gift redemption uses the same OAuth as the terminal). Enable the Split tile (always enabled when `chargeEligible`). Add `onPickGift`, `onPickSplit` callbacks. Preserve the existing tile shape/spacing/icons; no visual redesign.

### Foundational gate

- [X] T016 Scoped Phase-2 gate: run `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` then `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\\.(ts|tsx|js|jsx)$' || echo .)` then `npm run typecheck` then `npm test` (Vitest). All four must pass. Note: e2e is NOT scoped here because the foundational layer doesn't yet have its own e2e narrative; e2e scoping starts at Phase 3.

**Checkpoint**: Foundation ready — user-story phases can begin.

---

## Phase 3: User Story 1 — Redeem a full-balance gift card (Priority: P1) 🎯 MVP

**Goal**: Front desk picks the Gift tile, enters a GAN whose balance ≥ ticket total, and the ticket flips to paid with one recorded gift-card payment.

**Independent Test**: With a $40 ticket and GAN `6000 1234 5678 0001` (stub fixture: ACTIVE, $60), the operator completes checkout via Gift only; receipt shows one payment of $40 attributed to the gift card with the `••••0001` mask.

### Tests for User Story 1 (red-first per Constitution IV) ⚠️

- [X] T017 [P] [US1] Write `tests/unit/square/gift-card-lookup.test.ts` — asserts `retrieveGiftCardFromGAN` maps the five Square states to the discriminated-union per [research.md § R3](./research.md#r3--square-gift-card-error-mapping); balance bigint→number extraction; last-4 mask derivation; thrown `SquareGiftCardLookupFailedError` on 5xx.
- [X] T018 [P] [US1] Write `tests/unit/square/gift-card-payment.test.ts` — asserts `createGiftCardPayment` calls Square with `idempotencyKey = buildIdempotencyKey(ticketId, paymentId)`, `sourceId = giftCardId`, `amountMoney`, `tipMoney: {amount: 0n}`, `referenceId = ticketId`.
- [X] T019 [P] [US1] Write `tests/unit/square/webhook-payment-updated.test.ts` — asserts `handlePaymentUpdated` dispatches a `payment.updated` event with `source_type='GIFT_CARD'` and status `COMPLETED` to `pos_record_gift_payment(status='succeeded')`; idempotent on replay (second call returns ignored noop); merchant-id mismatch throws.
- [X] T020 [P] [US1] Write `tests/unit/checkout/activate-gift-draft.test.ts` — asserts `activateGiftDraft` transitions a `(status='draft', method='gift')` row to `'pending'`, calls Square `payments.create`, persists `square_gift_card_payment_id` + `gift_card_id`, and surfaces `GiftCardNotRedeemableError` when the cached state is non-ACTIVE on re-lookup.
- [X] T021 [P] [US1] Write `tests/unit/checkout/redeem-gift-whole-ticket.test.ts` — covers the full-balance branch only at this phase (partial branch lives in US3): asserts `redeemGiftCardWholeTicket` on a $40 ticket + ACTIVE $60 card → returns `{kind: 'fully_paid', paymentId, ticketFlippedToPaid: true}` after the simulated webhook arrives; the `lookup_*` not-found/zero/non-redeemable shapes return without any payment row created. No second draft is synthesized at this phase (the partial branch lands in US3 and returns `{kind: 'partial_split', nextLegAmountCents}` without creating a second row — see T049).

### Implementation for User Story 1

- [X] T022 [US1] Implement `lookupGiftCard(gan)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 1](./contracts/server-actions.md). Calls `lib/square/gift-cards.retrieveGiftCardFromGAN`, upserts `gift_cards`, emits `gift_card.balance_looked_up` audit row.
- [X] T023 [US1] Implement `activateGiftDraft(paymentId, gan)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 5](./contracts/server-actions.md). Transitions draft→pending atomically (gated by `payments_one_in_flight_per_ticket_idx`), calls `lib/square/gift-cards.createGiftCardPayment`, persists Square ids; reverts to `'failed'` with `failure_reason` on Square errors.
- [X] T024 [US1] Implement `redeemGiftCardWholeTicket(ticketId, gan)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 6](./contracts/server-actions.md). For this phase, implement only the full-balance branch (`kind = 'fully_paid'`) and the four `lookup_*` exit shapes. The partial-coverage branch lands in US3.
- [X] T025 [P] [US1] Build `components/lacquer/checkout/gan-numpad-sheet.tsx` — modal sheet adapted from `components/lacquer/numeric-keypad.client.tsx` per [quickstart.md § 7](./quickstart.md). Accepts 4–19 digit numeric input; "Cancel" + "Look up balance" CTAs; on submit calls `lookupGiftCard` (via prop) and forwards the result.
- [X] T026 [P] [US1] Build `components/lacquer/checkout/gift-card-balance-sheet.tsx` — adapted from the muted-rose accent strip in `design-system/prototypes/transaction/FlowSingle.jsx:230–235`. Three states: `found` ("$X available on this card — Redeem"), `zero_balance` ("$0 available — pick a different method"), `not_redeemable` ("This gift card is {state} and can't be redeemed"). Last4 mask shown.
- [X] T027 [US1] Modify `app/(studio)/checkout/[ticketId]/page.tsx` to pass the current ticket totals + the operator's session to the client island in the shape the new Gift flow needs (no new RSC reads beyond what's already loaded).
- [X] T028 [US1] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` to wire the Gift tile: tap Gift → opens `<GanNumpadSheet/>` → on submit calls `lookupGiftCard` → renders `<GiftCardBalanceSheet/>` with the result → on "Redeem" calls `redeemGiftCardWholeTicket` → renders a waiting micro-state (reuses subscribe-payment-status from `lib/realtime/payments.ts` against the new payment id, with the polling endpoint at `/api/square/payment/[paymentId]` as fallback) → advances to the existing `<DoneScreen/>` when the ticket flips paid.

### E2E for User Story 1

- [X] T029 [US1] Write `tests/e2e/gift-card-full-balance.spec.ts` — US1 happy path per [quickstart.md § 4 Story 1](./quickstart.md). Describes "US1: redeem full-balance gift card". Uses GAN suffix `0001`; asserts the ticket flips paid; uses the audit-cursor convention to assert exactly: `gift_card.balance_looked_up`, `payment.draft_created`, `gift_card.redeemed`.
- [X] T030 [US1] Write `tests/e2e/gift-card-errors.spec.ts` — covers the edge cases inside Story 1's scope per [spec.md § Edge Cases](./spec.md): NOT_FOUND (GAN suffix `9999`), BLOCKED (`BLKD`), PENDING (`PEND`), DEACTIVATED (`DEAC`), ZERO_BALANCE (`0000`). Each asserts the distinct UI copy and that no payment row is created. Describes "US1: gift card errors".

### US1 gate

- [X] T031 [US1] Scoped Phase-3 gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`; `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\\.(ts|tsx|js|jsx)$' || echo .)`; `npm run typecheck`; `npm test`; `npx playwright test tests/e2e/gift-card-full-balance.spec.ts tests/e2e/gift-card-errors.spec.ts -g "US1"`. All must pass.

**Checkpoint**: US1 is fully functional and testable independently. MVP shippable.

---

## Phase 4: User Story 2 — Split a ticket across two payment methods (Priority: P2)

**Goal**: Operator taps Split, composes 2+ payment legs (cash + card combinations), activates each in turn, and the ticket flips paid only when succeeded legs sum to the total.

**Independent Test**: For a $60 ticket, compose a $20 cash leg + $40 card leg; activate cash → "Paid $20 of $60 · Owes $40"; activate card → simulated terminal webhook → ticket paid. Two payments recorded, totaling $60.

### Tests for User Story 2 (red-first per Constitution IV) ⚠️

- [X] T032 [P] [US2] Write `tests/unit/checkout/compose-draft-leg.test.ts` — asserts `composeDraftLeg` rejects `amount <= 0` (`LegAmountInvalidError`); rejects `amount > remaining_owed` (`LegAmountInvalidError`); inserts a row with `status='draft'`; emits `payment.draft_created` audit; refuses when a `'pending'` row already exists on the ticket (`TicketAlreadyBeingChargedError`).
- [X] T033 [P] [US2] Write `tests/unit/checkout/remove-draft-leg.test.ts` — asserts `removeDraftLeg` deletes the row + emits `payment.draft_removed`; rejects with `DraftLegNotFoundError` on a non-existent or non-draft row.
- [X] T034 [P] [US2] Write `tests/unit/checkout/activate-cash-draft.test.ts` — asserts `activateCashDraft` flips draft→succeeded atomically; runs the legs-sum-to-total guard (refuses with `LegSumMismatchError` when sum ≠ total); emits `payment.captured`; flips the ticket to paid when the activation closes it.
- [X] T035 [P] [US2] Write `tests/unit/checkout/cart-edit-invalidates-drafts.test.ts` — asserts that calling `addServiceLine` on a ticket with 2 drafts wipes both drafts and emits 2 `payment.draft_removed` rows; the action's success-result includes `{draftsDiscarded: 2}`; succeeded legs are preserved.
- [X] T036 [P] [US2] Write `tests/unit/checkout/one-in-flight-per-ticket.test.ts` — asserts that a second `activate*` call while one leg is `'pending'` fails on the unique partial index (`23505`); the action catches and surfaces `TicketAlreadyBeingChargedError`.
- [X] T037 [P] [US2] Write `tests/unit/checkout/leg-sum-equals-total.test.ts` — asserts the RPC-side guard inside `pos_activate_cash_draft` and `pos_record_gift_payment`: activation refused with `legs_must_sum_to_total` when sum of non-failed legs ≠ `tickets.total_cents`.

### Implementation for User Story 2

- [X] T038 [US2] Implement `composeDraftLeg(ticketId, method, amountCents)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 2](./contracts/server-actions.md). Calls `pos_compose_payment_draft` RPC; maps RPC-side `legs_must_fit_remaining` to `LegAmountInvalidError`; maps the in-flight refusal to `TicketAlreadyBeingChargedError`.
- [X] T039 [US2] Implement `removeDraftLeg(paymentId)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 3](./contracts/server-actions.md). Calls `pos_remove_payment_draft` RPC; maps `draft_leg_not_found` to `DraftLegNotFoundError`.
- [X] T040 [US2] Implement `activateCashDraft(paymentId)` Server Action in `app/(studio)/checkout/actions.ts` per [contracts/server-actions.md § 4](./contracts/server-actions.md). Calls `pos_activate_cash_draft` RPC; catches `23505` from the unique-in-flight index and surfaces `TicketAlreadyBeingChargedError`; maps RPC-side `legs_must_sum_to_total` to `LegSumMismatchError`.
- [X] T041 [US2] Extend `sendCardToTerminal` in `app/(studio)/checkout/actions.ts` to accept the optional `{existingDraftId?: string}` option per [contracts/server-actions.md § 7](./contracts/server-actions.md). When `existingDraftId` is provided, verify the draft row matches `(ticket_id = ticketId, status='draft', method='card')`, transition to `'pending'` atomically (catch `23505` → `TicketAlreadyBeingChargedError`), then proceed with the existing Square `terminals.createCheckout` flow. Single-tender callers continue to omit the option and get the existing one-shot behavior.
- [X] T042 [P] [US2] Build `components/lacquer/checkout/payment-leg-row.tsx` — one row per leg with method icon (Lucide), amount (tabular numerals), state badge (`Draft | Pending | Succeeded | Failed`), remove button (visible only for draft); on tap of a draft leg → opens the method-appropriate activation: cash → calls `activateCashDraft` directly; card → calls `sendCardToTerminal({existingDraftId})` and routes to `<CardWaiting/>`; gift → opens `<GanNumpadSheet/>` then on confirm calls `activateGiftDraft`.
- [X] T043 [P] [US2] Build `components/lacquer/checkout/split-cart-footer.tsx` — adapted from `design-system/prototypes/transaction/FlowSingle.jsx:220–266` per [plan.md](./plan.md). Renders the running totals ("Paid $X of $Y · Owes $Z"), the list of legs via `<PaymentLegRow/>`, the "Add leg" affordance (which opens a small inline composer: amount field + method tile picker), and an "Exit split" affordance that wipes all drafts (calls `removeDraftLeg` per draft) when no leg has succeeded yet.
- [X] T044 [US2] Modify `app/(studio)/checkout/[ticketId]/page.tsx` to load the ticket's draft + pending + succeeded legs alongside the existing data and pass them to the client island.
- [X] T045 [US2] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` — wire the Split tile (tap → switches the cart footer to `<SplitCartFooter/>`); render the split-mode footer when there are any non-failed legs (covers auto-entry from US3's partial-gift case); intercept the existing line-mutation actions' new `draftsDiscarded` field to toast when applicable; surface `TicketAlreadyBeingChargedError` with the spec's "Ticket is already being charged on another device" copy.

### E2E for User Story 2

- [X] T046 [US2] Write `tests/e2e/split-tender-cash-card.spec.ts` — US2 happy path per [quickstart.md § 4 Story 2](./quickstart.md). Describes "US2: split tender — cash + card". $60 ticket; compose $20 cash + $40 card; activate both; ticket paid. Audit cursor asserts: `payment.draft_created` × 2, `payment.captured` (cash), `payment.captured` (card on webhook).
- [X] T047 [US2] Write `tests/e2e/concurrent-charge-blocked.spec.ts` — FR-022 enforcement. Two browser contexts both open the same ticket and both try to activate a cash leg; the second sees `TicketAlreadyBeingChargedError` and the current state. Describes "US2: concurrent charge blocked".

### US2 gate

- [X] T048 [US2] Scoped Phase-4 gate: scoped prettier + scoped eslint (same `git diff` recipe as T031); full `npm run typecheck`; full `npm test`; `npx playwright test tests/e2e/split-tender-cash-card.spec.ts tests/e2e/concurrent-charge-blocked.spec.ts -g "US2"`. All must pass.

**Checkpoint**: US1 + US2 both work independently. Cart now supports gift-only checkouts AND split-tender across cash/card combinations.

---

## Phase 5: User Story 3 — Redeem a partial-balance gift card (Priority: P3)

**Goal**: Operator picks Gift, enters a GAN whose balance < amount due; the system charges the available balance, auto-flips into split mode with a pre-populated second leg for the remainder, and the operator one-taps a method to close.

**Independent Test**: $40 ticket + GAN `6000 1234 5678 0002` (ACTIVE $15). Operator taps Gift, enters GAN, taps Redeem. Cart shows the gift leg succeeded for $15; a second draft pre-populated at $25 with "Pick method". Operator taps that draft → picks Cash → activates → ticket flips paid.

### Tests for User Story 3 (red-first per Constitution IV) ⚠️

- [X] T049 [P] [US3] Extend `tests/unit/checkout/redeem-gift-whole-ticket.test.ts` with the partial-balance branch — asserts that `redeemGiftCardWholeTicket` on a $40 ticket + ACTIVE $15 card → activates the gift leg for $15 and returns `{kind: 'partial_split', paymentId, nextLegAmountCents: 2500}`. **No second draft row is created server-side** — the test asserts that only ONE new payment row exists for the ticket (the gift leg) and that the cart's "owes" amount is recoverable as `tickets.total_cents - sum(succeeded legs)` once the webhook settles.

### Implementation for User Story 3

- [X] T050 [US3] Extend `redeemGiftCardWholeTicket` in `app/(studio)/checkout/actions.ts` with the partial-coverage branch per [contracts/server-actions.md § 6](./contracts/server-actions.md) and [research.md § R6](./research.md#r6--partial-gift-auto-split-flow-story-3--fr-006). When `balanceCents < remainingOwed`: activate the gift leg for `balanceCents`, then return `{kind: 'partial_split', paymentId, nextLegAmountCents: remainingOwed - balanceCents}`. No second draft is synthesized; the client drives the method-pick flow.
- [X] T051 [US3] Extend `components/lacquer/checkout/gift-card-balance-sheet.tsx` to render the `partial` state — "$X available · ticket needs $Y · split needed" with a "Redeem available" CTA (single tap; matches SC-003).
- [X] T052 [US3] Build the second-leg method picker in `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` (or a small new `components/lacquer/checkout/method-picker-popover.tsx` if it warrants extraction) — opens automatically on receipt of `{kind: 'partial_split', nextLegAmountCents}` from `redeemGiftCardWholeTicket`. Renders a horizontal row of method tiles (Cash / Card / Gift); on tap of a method, the client calls `composeDraftLeg(ticketId, picked_method, nextLegAmountCents)` and then immediately `activate*Draft(...)` for that method — one round-trip per tap. Dismissal (tapping away) leaves the cart in the "Owes $Y" state with the regular Split flow available; no persisted "pending method pick" state.
- [ ] T053 [US3] *(intentionally left blank — the `setDraftLegMethod` action and the `payment.draft_method_picked` audit verb were removed during analysis remediation. The partial-gift second leg is composed via the standard `composeDraftLeg` action with the operator's picked method directly. No separate "set method on draft" code path exists.)*
- [ ] T054 [US3] *(Folded into T052 above — the client-side auto-open of the method picker is part of the T052 work. No separate task required.)*

### E2E for User Story 3

- [X] T055 [US3] Write `tests/e2e/gift-card-partial-balance.spec.ts` — US3 happy path per [quickstart.md § 4 Story 3](./quickstart.md). Describes "US3: gift card partial balance". $40 ticket + GAN suffix `0002` (ACTIVE $15); operator redeems → method picker auto-opens for $25 → operator taps Cash → cash leg composed + activated → ticket paid. Audit cursor asserts deterministically: `gift_card.balance_looked_up`, `payment.draft_created` (gift, $15), `gift_card.redeemed`, `payment.draft_created` (cash, $25), `payment.captured` (cash). No `payment.draft_method_picked` verb (it no longer exists).

### US3 gate

- [X] T056 [US3] Scoped Phase-5 gate: scoped prettier + scoped eslint; full `npm run typecheck`; full `npm test`; `npx playwright test tests/e2e/gift-card-partial-balance.spec.ts -g "US3"`. All must pass.

**Checkpoint**: All three user stories work independently. Gift card + split tender feature is functionally complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, design-system audit, and the full pre-push gate.

- [X] T057 Confirm `CLAUDE.md`'s SPECKIT marker points at `specs/018-gift-card-split-tender/plan.md` (set during Phase 1 of /ship; sanity-check it hasn't drifted).
- [X] T058 Run the design-system auditor against the feature branch — `speckit-design-auditor` invocation (or its agent equivalent) over the touched `components/lacquer/checkout/` and `app/(studio)/checkout/` surfaces. Must return PASS. **Result: PASS** with 2 minor non-blocking advisories: (a) `gan-numpad-sheet.tsx:256` uses literal `ease-out` keyword instead of `var(--ease-out, ease-out)` token (sibling `numeric-keypad.client.tsx:206` pattern); (b) `checkout-screen.client.tsx:1903` uses a literal `"..."` faux progress indicator inside the waiting overlay; recommend swapping for `<Loader2 size={24} strokeWidth={1.5} className="animate-spin" />` or the prototype's `<DotPulse />` for vocabulary parity.
- [ ] T059 [DEFERRED — manual operator validation by the maintainer; an automated agent can't drive an interactive browser session in this orchestrator context. The e2e suite (T060) is the canonical automated regression net.] Run the quickstart's manual exercise checklist ([quickstart.md § 4](./quickstart.md)) against `npm run dev` — Story 1 happy path, Story 2 cash+card, Story 3 partial gift, and the four error-edge GAN suffixes. Smoke-test only; the e2e suite is the canonical regression net.
- [X] T060 Final full gate (per CLAUDE.md § Pre-push quality gates): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five must be green before any push. The e2e step is the full suite, not scoped. **Result: ALL 5 GREEN** — format:check ✓; lint ✓ (6 pre-existing unused-var warnings in files unrelated to this feature, 0 errors); typecheck ✓; npm test ✓ (470 unit tests pass, 1 skipped); npm run test:e2e ✓ (139 passed, 21 skipped, 5.6min on default parallel workers).

**Checkpoint**: Feature ready for PR.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies; can start immediately.
- **Foundational (Phase 2)**: depends on Setup. Schema (T003–T005) blocks every other foundational task. T006/T007/T008 are parallel after schema. T009 depends on T005 (types). T010–T012 depend on T009. T013 depends on T008. T014 and T015 are independent of the rest of Phase 2.
- **User Story 1 (Phase 3)**: depends on Foundational. Tests T017–T021 are parallel and red-first. Implementation T022–T024 run sequentially in `actions.ts` (same file). UI T025–T026 are parallel. T027 + T028 finalize.
- **User Story 2 (Phase 4)**: depends on Foundational; does NOT depend on US1 (independent). Tests T032–T037 parallel. Implementations T038–T041 sequential in `actions.ts`. UI T042–T043 parallel. T044–T045 finalize.
- **User Story 3 (Phase 5)**: depends on US1 (`redeemGiftCardWholeTicket` exists) AND US2 (split-mode footer exists). Smaller than US1/US2.
- **Polish (Phase 6)**: depends on US1 + US2 + US3.

### Within each user-story phase

- Tests are written and shown to fail before the implementation makes them pass (Constitution IV).
- Models / migrations are foundational and land before story implementations.
- Same-file edits in `actions.ts` are sequential within a story phase.
- Cross-file edits with no shared state are parallelizable ([P]).

### Parallel opportunities

- Phase 2: T006, T007, T008 in parallel (different files, no dependencies).
- Phase 3 tests: T017, T018, T019, T020, T021 all in parallel (different files).
- Phase 3 UI: T025, T026 in parallel.
- Phase 4 tests: T032–T037 all in parallel.
- Phase 4 UI: T042, T043 in parallel.

---

## Parallel Example: User Story 1 tests

```bash
# Launch all US1 unit tests in parallel (they hit different files / unrelated modules):
npm test -- tests/unit/square/gift-card-lookup tests/unit/square/gift-card-payment tests/unit/square/webhook-payment-updated tests/unit/checkout/activate-gift-draft tests/unit/checkout/redeem-gift-whole-ticket
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: US1.
4. **STOP and VALIDATE**: gift-card-only checkout works end-to-end; e2e green.
5. Demo as MVP; ship behind a feature flag if needed (no flag required — Gift tile naturally lights up when Square is connected).

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. Add US1 → demo gift-card redemption.
3. Add US2 → demo split tender.
4. Add US3 → demo partial-gift auto-split.
5. Polish → ship.

Each story passes its scoped gate before the next phase begins; the final gate validates the full surface.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label = traceability to spec.md user stories.
- Same-file edits across tasks (notably `actions.ts`) are sequential — never marked [P].
- Per CLAUDE.md, intermediate gates use scoped commands (`git diff` for prettier/eslint; `-g "USn"` for e2e). The final gate (T060) is the only place the full suite runs.
- Per Constitution IV, all unit-test tasks are red-first — write the assertion against an unimplemented action, watch it fail, then implement.
- Commit after each task or logical group; the auto-commit hook in `.specify/extensions.yml` handles the post-phase commit during /speckit-implement.
