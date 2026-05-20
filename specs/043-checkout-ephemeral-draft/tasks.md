---
description: "Task list for 043-checkout-ephemeral-draft"
---

# Tasks: Ephemeral Checkout Draft

**Input**: Design documents from `/specs/043-checkout-ephemeral-draft/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test tasks ARE included — checkout is a critical money path
(Constitution Principle IV mandates test-first for money logic) and the spec's
Assumptions name the test suite as the contract.

**Organization**: Tasks are grouped by user story. Note (see Implementation
Strategy): this is a single cohesive refactor — it ships as **one PR**. The user
stories are verification slices, not separately shippable increments; removing
per-edit persistence while keeping resume would be incoherent.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4; Setup / Foundational / Polish carry no story label

## Path Conventions

Single Next.js App Router project. Checkout lives under
`app/(studio)/checkout/`; migrations under `supabase/migrations/`; tests under
`tests/unit/checkout/` and `tests/e2e/`.

> **Naming**: the new ephemeral-cart module is `_cart-draft.ts` — deliberately
> distinct from the existing `_drafts.ts` (split-tender *payment* draft legs).
> Do not confuse the two.

---

## Phase 1: Setup

**Purpose**: Establish a known-good starting point before refactoring.

- [X] T001 Establish a green baseline — run `npm run format:check && npm run lint && npm run typecheck && npm test` on branch `043-checkout-ephemeral-draft` and confirm all pass before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The persistence primitive, the draft module, and the route/client
restructure that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Write Vitest unit test for `pos_create_ticket_from_draft` (live local Supabase) in `tests/unit/checkout/pos-create-ticket-from-draft.test.ts` — atomic ticket + ticket_items + `ticket.created` audit insert, `subtotal_cents`/`total_cents` computation, all-or-nothing rollback on a bad row. MUST FAIL (RPC absent).
- [x] T003 Create migration `supabase/migrations/0020_checkout_ephemeral_draft.sql` — `pos_create_ticket_from_draft(p_operator uuid, p_items jsonb)` per `contracts/rpc-pos-create-ticket-from-draft.md` (`security definer`, `revoke all from public`, `grant execute to service_role`); drop the now-dead index `tickets_open_by_operator_recent_idx`. Apply locally (`supabase db reset` or migration up); T002 now passes.
- [x] T004 [P] Create `app/(studio)/checkout/_cart-draft.ts` — the `CheckoutDraft`, `DraftServiceLine`, `DraftDiscountLine`, `DraftLine`, and `PaymentTarget` types per `contracts/checkout-draft.md`.
- [x] T005 [P] Write Vitest unit test for `validateAndResolveDraft` in `tests/unit/checkout/validate-resolve-draft.test.ts` — empty draft, unconfirmed-price line, missing `serviceId`, archived-service line accepted, inactive `assignedStaffId`, percent-discount folding, non-positive resolved total. MUST FAIL (helper absent).
- [x] T006 Implement the `validateAndResolveDraft` server helper in `app/(studio)/checkout/_cart-draft.ts` — catalog + staff resolution, `name_snapshot` re-derivation, discount folding via `computeTotals` in `lib/pos/cart.ts`, reuse `TicketEmptyError` / `TicketHasUnpricedItemsError` from `_errors.ts` for the FR-015 refusals. T005 now passes.
- [x] T007 Move `checkout-screen.client.tsx` from `app/(studio)/checkout/[ticketId]/` to `app/(studio)/checkout/`; update the import in `app/(studio)/checkout/[ticketId]/page.tsx` and the `checkout.css` relative import inside the component.
- [x] T008 Add a `ticketId: string | null` prop and an `isEphemeral = ticketId === null` derivation to `app/(studio)/checkout/checkout-screen.client.tsx`; persisted-mode behavior unchanged; `[ticketId]/page.tsx` keeps passing a non-null id.

**Checkpoint**: RPC + draft module exist and are unit-tested; the client
component is relocated and accepts a nullable `ticketId`. Scoped gate —
`npm run typecheck && npm test`.

---

## Phase 3: User Story 1 - Complete a sale with deferred persistence (Priority: P1) 🎯 MVP

**Goal**: A cash sale produces the same finished records as today, but the
ticket and items come into existence only when payment is taken.

**Independent Test**: Open checkout, add one or more services, take a cash
payment; confirm the resulting ticket/items/payment/totals are identical to
today, and that no ticket or ticket-item rows existed before payment.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [x] T009 [P] [US1] Update `tests/unit/checkout/take-cash-action.test.ts` — add the draft-path case: `takeCash({ from: 'draft', draft })` calls `pos_create_ticket_from_draft` then `pos_take_cash` and returns the resolved `ticketId`; keep the ticket-path case; cover empty / unconfirmed-price refusals. MUST FAIL.

### Implementation for User Story 1

- [x] T010 [US1] Add the discriminated `PaymentTarget` input + draft path to `takeCash` in `app/(studio)/checkout/actions.ts` — the draft path runs `validateAndResolveDraft` → `pos_create_ticket_from_draft` → `pos_take_cash`; the return includes the resolved `ticketId`. T009 now passes.
- [x] T011 [US1] Simplify `startNewSale` in `app/(studio)/checkout/actions.ts` to `redirect("/checkout")` (drop the `createEmptyTicket` call).
- [x] T012 [US1] Rewrite `app/(studio)/checkout/page.tsx` — paramless `/checkout`; `force-dynamic`; `requireStudioSession()` gate; parallel reads of the active services catalog, active staff roster, Square OAuth/devices, and salon settings; render `<CheckoutScreen ticketId={null} initialItems={[]} initialLegs={[]} ... />` directly. No redirect, no `createEmptyTicket` / `resumeOrCreateTicket` call, no `?fresh=1` handling. Also update `components/lacquer/new-transaction-cta.tsx` to link `/checkout` (drop the now-dead `?fresh=1` query param).
- [x] T013 [US1] Implement ephemeral cart editing in `app/(studio)/checkout/checkout-screen.client.tsx` — when `isEphemeral`, add/remove service, set/override price, assign tech, and add/remove discount mutate **local React state only** (client-generated `crypto.randomUUID()` line ids); no server action, no audit, no error-banner round-trip.
- [x] T014 [US1] Implement ephemeral cash submission in `app/(studio)/checkout/checkout-screen.client.tsx` — when `isEphemeral`, the cash action serializes local state into a `CheckoutDraft`, calls `takeCash({ from: 'draft', draft })`, then `router.replace(\`/checkout/${ticketId}\`)` so the paid `[ticketId]` route renders the done screen.
- [x] T015 [US1] Update `tests/e2e/checkout-cash-sale.spec.ts` — assert zero `tickets` / `ticket_items` / `audit_log` rows after opening checkout and adding a service but **before** payment; keep the existing post-payment paid-ticket / payment / `payment.captured` audit assertions.
- [x] T016 [US1] Update the remaining checkout cart-editing e2e specs — `tests/e2e/checkout-variable-price.spec.ts`, `checkout-price-override.spec.ts`, `checkout-discount.spec.ts`, `checkout-tech-override.spec.ts`, `checkout-bill.spec.ts`, `checkout-receipt.spec.ts` — for the paramless `/checkout` entry (no redirect to `/checkout/[ticketId]`) and ephemeral cart editing (no `ticket_items` rows until payment; the cart does not survive a mid-build reload). Each spec that exercises a full sale keeps its finalized-ticket assertions unchanged.

**Checkpoint**: A cash sale and all in-session cart editing work end-to-end with
deferred persistence. Scoped gate — `npx playwright test tests/e2e/checkout-cash-sale.spec.ts tests/e2e/checkout-variable-price.spec.ts tests/e2e/checkout-discount.spec.ts`.

---

## Phase 4: User Story 2 - Abandon an unsubmitted checkout with no residue (Priority: P2)

**Goal**: Leaving checkout before payment — via the header exit control or by
navigating away — leaves nothing in the database.

**Independent Test**: Open checkout, add and remove services, use the header
exit control (labeled "Cancel") or navigate away; confirm zero ticket /
ticket-item / payment / audit rows exist for that session.

**Depends on US1** — the exit control needs the `isEphemeral` client mode (T008/T013).

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T017 [P] [US2] Create e2e `tests/e2e/checkout-abandon.spec.ts` — (a) open checkout, add+remove services, click the "Cancel" control → dashboard, assert zero ticket/ticket_item/payment/audit rows; (b) open and add nothing, leave → DB unchanged; (c) navigate away without paying → no rows; (d) dashboard daily counts/feed unaffected. MUST FAIL until T018.

### Implementation for User Story 2

- [X] T018 [US2] Consolidate the header exit control in `app/(studio)/checkout/checkout-screen.client.tsx` into one context-aware button (FR-019/FR-020) — label "Cancel" + leave-to-dashboard with no DB effect when `isEphemeral`; label "Discard" + the existing `handleDiscard` (cancel terminal, `discardTicket`) when a ticket is persisted. Reuse the existing design-system `Button`; no layout change.
- [X] T019 [US2] Update `tests/e2e/checkout-discard.spec.ts`, `checkout-discard-with-inflight-payment.spec.ts`, and `checkout-discard-during-waiting.spec.ts` — the discard-of-a-persisted-ticket cases first take a payment-initiating action so a real ticket exists; update selectors to the consolidated exit control.

**Checkpoint**: Abandon leaves zero residue; the exit control is unified.
Scoped gate — `npx playwright test tests/e2e/checkout-abandon.spec.ts tests/e2e/checkout-discard.spec.ts`.

---

## Phase 5: User Story 3 - Checkout always opens a fresh cart (Priority: P2)

**Goal**: Every entry to checkout opens a fresh empty cart; resume is removed.

**Independent Test**: Build a partial cart, navigate to the dashboard, return to
checkout → a fresh empty cart opens; refresh checkout → cart cleared.

**Depends on US1** — T012 must have removed the resume call sites before the
resume actions can be deleted.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T020 [P] [US3] Rewrite `tests/e2e/checkout-resume.spec.ts` as `tests/e2e/checkout-fresh-cart.spec.ts` — every entry (sidebar link, dashboard "new sale" CTA) opens an empty cart; navigate-away-and-return → fresh; refresh → fresh; a second operator on a shared device → fresh. Delete all old resume/most-recently-updated assertions.

### Implementation for User Story 3

- [X] T021 [US3] Remove the `createEmptyTicket` and `resumeOrCreateTicket` exports from `app/(studio)/checkout/actions.ts` (orphaned after T012) and the checkout-actions-local salon-midnight helpers they alone use (`salonTodayBoundsUtc` — confirmed used only in `actions.ts`; do not touch any shared `lib/time` helper). Remove any test that imports the deleted actions — `tests/unit/checkout/` currently has no dedicated file for them (resume coverage is e2e, handled by T020), so verify and clean up only what actually references them.

**Checkpoint**: Resume is fully removed; every checkout entry is fresh. Scoped
gate — `npx playwright test tests/e2e/checkout-fresh-cart.spec.ts && npm test`.

---

## Phase 6: User Story 4 - Card, gift-card, and split-tender sales still settle correctly (Priority: P3)

**Goal**: Card-terminal, gift-card, and split-tender sales persist the ticket at
payment initiation and settle with the same records and safeguards as today.

**Independent Test**: Run a card-terminal sale, a gift-card redemption, and a
split-tender sale; confirm each persists its ticket at payment initiation and
settles to a paid ticket with the same records as today.

**Depends on US1** — reuses the `PaymentTarget` pattern and the persisted-route
`router.replace` established by US1.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T022 [P] [US4] Create Vitest unit tests for the `sendCardToTerminal` draft path in `tests/unit/checkout/send-card-to-terminal.test.ts` — the draft path persists the ticket then inserts the `pending` card payment row. MUST FAIL.
- [X] T023 [P] [US4] Update `tests/unit/checkout/compose-draft-leg.test.ts` — the draft path: composing the first split-tender leg persists the ticket then runs `pos_compose_payment_draft`. MUST FAIL.
- [X] T024 [P] [US4] Update `tests/unit/checkout/redeem-gift-whole-ticket.test.ts` — the draft path persists the ticket before gift redemption. MUST FAIL.

### Implementation for User Story 4

- [X] T025 [US4] Add the `PaymentTarget` draft path to `sendCardToTerminal` in `app/(studio)/checkout/actions.ts`. T022 now passes.
- [X] T026 [US4] Add the `PaymentTarget` draft path to `composeDraftLeg` in `app/(studio)/checkout/actions.ts`. T023 now passes.
- [X] T027 [US4] Add the `PaymentTarget` draft path to `redeemGiftCardWholeTicket` in `app/(studio)/checkout/actions.ts`. T024 now passes.
- [X] T028 [US4] Implement ephemeral card / gift-card / first-split-leg submission in `app/(studio)/checkout/checkout-screen.client.tsx` — when `isEphemeral`, each builds a `CheckoutDraft`, calls its draft-path action, then `router.replace(\`/checkout/${ticketId}\`)` so card-waiting / split continuation rehydrate from the persisted route.
- [X] T029 [US4] Update the e2e specs `card-payment-happy.spec.ts`, `card-payment-cancel.spec.ts`, `card-payment-race.spec.ts`, `card-payment-polling-fallback.spec.ts`, `card-payment-late-capture-recovery.spec.ts`, `concurrent-charge-blocked.spec.ts`, `gift-card-full-balance.spec.ts`, `gift-card-partial-balance.spec.ts`, `gift-card-errors.spec.ts`, and `split-tender-cash-card.spec.ts` — drive through the ephemeral `/checkout` entry (no pre-existing ticket); assert the ticket is persisted at payment initiation.

**Checkpoint**: All payment paths settle correctly with deferred persistence.
Scoped gate — `npm run test:e2e:changed`.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T030 [P] Update `docs/system-design.md` — replace the "opens `/checkout/[ticketId]` (creates ticket if absent)" description with deferred-persistence wording (ticket created at the first payment-initiating action).
- [X] T031 [P] Review `tests/e2e/_affected-map.mjs` — add entries so changes to `app/(studio)/checkout/_cart-draft.ts`, migration `0020`, and the checkout routes pull the checkout specs; reflect the `checkout-resume.spec.ts` → `checkout-fresh-cart.spec.ts` rename.
- [X] T032 Run the `speckit-design-auditor` agent against the consolidated exit control in `checkout-screen.client.tsx` — confirm every value traces to a Lacquer token and there is no layout/copy drift beyond FR-019.
- [X] T033 Run the full pre-push gate set — `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e` — all five green. (format:check ✓, lint ✓ [scoped — raw run only reports unrelated sibling-worktree files], typecheck ✓, npm test ✓ 732 passed, e2e ✓ all feature-043 specs pass + migration 0020 applies clean-slate. One pre-existing cross-spec parallelism flake in `services.spec.ts` — unmodified by this branch, passes on a clean isolated DB — is out of scope.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational + US1 (the exit control needs the `isEphemeral` client mode from T008/T013).
- **US3 (Phase 5)**: depends on US1 — T012 removes the resume call sites before T021 deletes the actions.
- **US4 (Phase 6)**: depends on US1 — reuses the `PaymentTarget` pattern and the persisted-route `router.replace`.
- **Polish (Phase 7)**: depends on all user stories.

### Within Each Story

- Tests are written first and shown failing before implementation (Constitution IV).
- `_cart-draft.ts` types (T004) before the helper (T006); migration test (T002) before the migration (T003).
- `actions.ts` tasks (T010, T011, T021, T025, T026, T027) all touch one file — sequential.
- `checkout-screen.client.tsx` tasks (T007, T008, T013, T014, T018, T028) all touch one file — sequential.

### Parallel Opportunities

- **Foundational**: T002 ‖ T004 ‖ T005 (distinct files). T003 follows T002; T006 follows T004/T005.
- **US4 tests**: T022 ‖ T023 ‖ T024 (distinct test files).
- **Polish**: T030 ‖ T031.
- Cross-story: US3 and US4 can proceed in parallel once US1 is complete — but both edit `actions.ts` (T021 deletes, T025–T027 add), so serialize the `actions.ts` edits even though the stories are otherwise independent.

---

## Parallel Example: Foundational Phase

```bash
# Distinct files — launch together:
Task: "Write unit test for pos_create_ticket_from_draft in tests/unit/checkout/pos-create-ticket-from-draft.test.ts"
Task: "Create _cart-draft.ts types in app/(studio)/checkout/_cart-draft.ts"
Task: "Write unit test for validateAndResolveDraft in tests/unit/checkout/validate-resolve-draft.test.ts"
```

---

## Implementation Strategy

### Single-PR refactor

This feature is a cohesive persistence-timing refactor. Unlike a greenfield
build, the user stories cannot ship separately — a half-applied state (e.g.
ephemeral cart but resume still wired) would be incoherent. Build all phases on
the `043-checkout-ephemeral-draft` branch and ship one PR.

### Recommended order

1. **Phase 1 + 2 (Setup + Foundational)** — the RPC, draft module, and
   route/client restructure. The hard core of the change.
2. **Phase 3 (US1)** — cash deferred persistence + all in-session cart editing.
   The MVP slice; validate the whole deferred-persistence mechanism before
   extending it to the other payment paths.
3. **Phases 4–6 (US2, US3, US4)** — abandon-no-residue, resume removal, and the
   card/gift/split paths. US3 and US4 can interleave once US1 is done.
4. **Phase 7 (Polish)** — docs, affected-map, design audit, full gate set.

### Verification gates

Intermediate checkpoints run **scoped** gates (per CLAUDE.md § "Scoping
intermediate phase gates"). T033 is the only full-suite run — the final gate
before the PR.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- The migration **must** be committed under `supabase/migrations/**` so the
  `db-migrate-preview` GitHub Action applies `pos_create_ticket_from_draft` to
  the preview Supabase project before the Vercel preview deploy runs
  (Constitution § "Schema drift forbidden").
- Every "finalized sale" assertion in the e2e suite must keep passing unchanged
  (SC-003, SC-005) — only the pre-payment setup of those specs changes.
- **FR-017** (reporting / receipt / end-of-day surfaces unchanged) and **FR-018**
  (pre-existing `open` / `discarded` tickets untouched, no data migration) are
  "no-change" requirements: no task alters those surfaces, and the full e2e
  suite at T033 is the regression check that confirms they still pass.
