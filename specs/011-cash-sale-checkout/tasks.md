---

description: "Task list for Checkout — Cash-Only Sale"
---

# Tasks: Checkout — Cash-Only Sale

**Input**: Design documents from `/specs/011-cash-sale-checkout/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/server-actions.md](./contracts/server-actions.md), [contracts/audit.contract.md](./contracts/audit.contract.md), [quickstart.md](./quickstart.md).

**Tests**: REQUIRED. Constitution Principle IV (Test-First for Critical Paths) mandates Vitest + Playwright coverage for the cash payment money path; this task list sequences tests before implementation in every phase. All `test:e2e` invocations use `--workers=1` per `CLAUDE.md` § Pre-push quality gates.

**Organization**: Tasks are grouped by user story so each story can ship independently. MVP scope is Phase 1 + Phase 2 + Phase 3 (US1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories — [US1], [US2], [US3], [US4]
- Setup and Foundational tasks have no story label; same for Polish.

## Path Conventions

Repo root: `/Users/mearathou/Dev/salon-management/.worktrees/011-cash-sale-wip/` (this is the worktree). Paths below are repo-relative (e.g., `app/(studio)/checkout/page.tsx`). Single Next.js project — Option 1 from the template, as recorded in `plan.md` § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new directories the feature owns. The repo is already scaffolded; this phase is intentionally tiny.

- [ ] T001 [P] Create `components/lacquer/checkout/` and `tests/unit/checkout/` directories so subsequent file-creation tasks have a target. No code change.
- [ ] T002 [P] Create `lib/pos/` directory (new) for cart math utilities introduced by this feature.

**Checkpoint**: Directories exist; feature work can proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, types, audit vocabulary, server-action scaffolding, and the cart utility — every user story depends on these.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Schema (data-model.md)

- [ ] T003 Create `supabase/migrations/0004_checkout_cash_sale.sql` per `data-model.md` §§ 1–6: types (`ticket_status`, `ticket_item_kind`, `payment_method`, `payment_kind`, `payment_status`), tables (`appointments`, `tickets`, `ticket_items`, `payments`), CHECK constraints, RLS (select-to-authenticated only), indexes (`tickets_open_by_operator_recent_idx`, `tickets_status_created_at_idx`, `ticket_items_by_ticket_idx`, `payments_by_ticket_idx`), `updated_at` trigger on `tickets`, and the `pos_take_cash(p_ticket_id uuid, p_operator uuid)` SQL function from `data-model.md` § 5.
- [ ] T004 Run `supabase db reset` locally to apply the new migration; confirm `\dt public.tickets` lists the table and `\df public.pos_take_cash` lists the function. Document any apply-time error in a follow-up task before moving on.
- [ ] T005 Regenerate `lib/db/types.ts` from the updated schema (`supabase gen types typescript --local > lib/db/types.ts` or whatever the existing repo helper script is — match the convention used by 008's migration).

### Audit vocabulary (contracts/audit.contract.md)

- [ ] T006 Extend `AuditAction` in `lib/auth/audit.ts` with the six new verbs (`ticket.created`, `ticket.line_added`, `ticket.line_removed`, `ticket.line_tech_assigned`, `ticket.discarded`, `payment.captured`) and extend `deriveEntityType` to dispatch the `ticket.*` and `payment.*` prefixes. Widen its return type to include `"ticket" | "payment"`. No call sites yet — additions only.

### Cart utility + unit test (red → green)

- [ ] T007 [P] Write `tests/unit/checkout/cart-totals.test.ts` covering: empty cart returns `{subtotalCents:0, totalCents:0, chargeEligible:false}`; one fixed-price line; two fixed-price lines; one fixed + one unconfirmed (subtotal excludes unconfirmed, `chargeEligible=false`). This file is the red baseline before T008 lands.
- [ ] T008 Implement `lib/pos/cart.ts` exporting `computeTotals(items: CartItem[]): { subtotalCents: number; taxCents: 0; totalCents: number; chargeEligible: boolean }`. Sum fixed-price lines only; `taxCents` is the literal `0`; `chargeEligible = totalCents > 0 && items.every(i => !i.priceUnconfirmed)`. Make T007's tests pass.

### Server-actions module scaffold + currentOperator helper

- [ ] T009 Create `app/(studio)/checkout/actions.ts` with the file-level `"use server"` directive, the `CheckoutActionError` type union from `contracts/server-actions.md`, and the error subclasses (`TicketNotOpenError`, `TicketAlreadyTerminalError`, `TicketHasUnpricedItemsError`, `TicketEmptyError`, `StaffNotActiveError`, `ServiceArchivedError`, `CashPaymentFailedError`). No actions implemented yet — scaffolding only.
- [ ] T010 Add a `currentOperator(): Promise<{ staffId: string; userId: string }>` helper in `lib/auth/session.ts` if it does not already exist (it pairs with `requireStudioSession()` / `requireActingAsStaff()`; reuse those if they already return what we need — only add if missing).

### Stylesheet scaffold

- [ ] T011 Create `app/(studio)/checkout/checkout.css` with the base layout rules for the checkout screen using existing tokens from `styles/tokens.css`. Leave the `@media print` block as a TODO comment — it lands in US4 (T040).

### createEmptyTicket action (used by US1's dashboard CTA path)

- [ ] T012 Implement `createEmptyTicket()` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md` § 1: validate session, insert a `tickets` row (`status='open'`, `appointment_id=null`, `opened_by_staff_id`), emit `ticket.created` audit row, return `{ ticketId }`.

**Checkpoint**: Schema + types + audit + cart math + actions scaffold + the one action shared across stories are ready. User-story phases can now begin.

---

## Phase 3: User Story 1 — Process a cash-only walk-in sale from start to finish (Priority: P1) 🎯 MVP

**Goal**: Front desk taps "New transaction" on the dashboard, lands in the single-screen cart, picks a tech, taps fixed-price service tiles, takes cash, sees a "Charged $X" confirmation with a "New sale" button. Covers FR-001 (dashboard entry only — sidebar resume comes in US2), FR-002, FR-004, FR-005 (cancel + discard), FR-006 – FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-027, FR-028.

**Independent Test**: Sign in, click "New transaction" on the dashboard, pick a tech, tap a fixed-price service tile, tap "Take cash · $X", verify the DoneScreen shows "Charged $X" and the underlying ticket is in `paid` status with a matching `payments` row. SC-001, SC-002, SC-004.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [ ] T013 [P] [US1] Write `tests/unit/checkout/take-cash-action.test.ts`: mock the service-role supabase client; on a forced `pos_take_cash` failure, assert `takeCash` throws `CashPaymentFailedError` and that no `payments` row insert was attempted at the Node layer. (The transactional rollback inside SQL is verified by the e2e in T030.)
- [ ] T014 [P] [US1] Write `tests/e2e/checkout-cash-sale.spec.ts` walking the full US1 acceptance scenarios 1–5: dashboard → tech pick collapses row → tile add updates cart → Take cash → DoneScreen present → "New sale" reaches a fresh empty ticket. Asserts at DB level: a `payments` row exists with `method='cash'`, `status='succeeded'`, and `tickets.status='paid'` after Take cash.
- [ ] T015 [P] [US1] Write `tests/e2e/checkout-discard.spec.ts` for the Discard control on TxHeader: with a non-empty cart, click Discard → operator returns to dashboard → the discarded ticket's status is `discarded` in the DB and is excluded from any subsequent sidebar resume. Covers FR-005 (the Discard half), SC-008.

> Run `npm test && npm run test:e2e -- --workers=1`. T013 should fail (no `takeCash` yet). T014/T015 should fail at the dashboard CTA or earlier. Move on once you've confirmed they're red.

### UI components (parallelizable — separate files)

- [ ] T016 [P] [US1] Create `components/lacquer/checkout/tx-header.tsx` adapted from `design-system/prototypes/transaction/FlowSingle.jsx` § header. Two distinct controls per FR-005: Cancel (back to dashboard, ticket stays open) and Discard (calls `discardTicket` action, then back to dashboard). Lucide icons at 1.5px / size 16.
- [ ] T017 [P] [US1] Create `components/lacquer/checkout/tech-avatar-row.tsx` adapted from the prototype's single-select variant. Pre-pick state: row of staff avatars. Post-pick state: collapses to a chip + "Change" link (FR-006/FR-007).
- [ ] T018 [P] [US1] Create `components/lacquer/checkout/service-tiles.tsx` from the prototype. Search input + category chips above the grid (FR-009). Disabled when no tech is picked per FR-006.
- [ ] T019 [P] [US1] Create `components/lacquer/checkout/cart-row-with-tech.tsx` — static chip variant (no popover yet; popover lands in US3). Per-line name, snapshotted price, qty, assigned-tech chip (read-only here), remove button (FR-011, FR-013 partial).
- [ ] T020 [P] [US1] Create `components/lacquer/checkout/payment-tiles.tsx` from the prototype: cash | card | gift | split. Cash enabled; the other three disabled with a Lacquer tooltip "Coming soon" (FR-017).
- [ ] T021 [P] [US1] Create `components/lacquer/checkout/totals.tsx` — subtotal / tax (always 0 this phase) / total block. Tabular numerals (Constitution Principle I).
- [ ] T022 [P] [US1] Create `components/lacquer/checkout/done-screen.tsx` — "Charged $X" + "New sale" button. The button is a `<form action={createEmptyTicket}>` so the redirect-to-new-ticket is server-side (FR-023).
- [ ] T023 [P] [US1] Create `components/lacquer/checkout/variable-price-placeholder-dialog.tsx` — modal opened by an unconfirmed-price line's price control (FR-016). Body explains variable pricing comes in the next phase; no price entry.

### Server Actions (US1-specific — order matters because checkout-screen depends on them)

- [ ] T024 [US1] Implement `addServiceLine` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md` § 3: validate session, validate `assignedStaffId` is active, refuse if ticket not open or service archived, insert `ticket_items` with snapshot, recompute and persist ticket totals, emit `ticket.line_added` audit.
- [ ] T025 [US1] Implement `removeLine` in `app/(studio)/checkout/actions.ts` per § 4: delete the named line, recompute totals, emit `ticket.line_removed` audit.
- [ ] T026 [US1] Implement `takeCash` in `app/(studio)/checkout/actions.ts` per § 6: call `supabase.rpc('pos_take_cash', { p_ticket_id, p_operator })`; map Postgres error codes to the typed error classes from T009; on success return `{ paymentId, chargedCents }`. Add the inline `// TODO(phase-9): … cash_drawer_sessions.expected_cents …` comment from research.md § R7.
- [ ] T027 [US1] Implement `discardTicket` in `app/(studio)/checkout/actions.ts` per § 7: refuse on terminal status (throws `TicketAlreadyTerminalError`), update to `status='discarded'` with `closed_by_staff_id` + `closed_at`, emit `ticket.discarded` audit.

### Pages and client island

- [ ] T028 [US1] Create `app/(studio)/checkout/page.tsx` — server page at `/checkout`. In this phase, always calls `createEmptyTicket()` and `redirect()`s to `/checkout/[ticketId]` (sidebar resume lands in US2 / T034).
- [ ] T029 [US1] Create `app/(studio)/checkout/[ticketId]/page.tsx` — Server Component. Reads the ticket + its `ticket_items` + active staff roster + service catalog (via existing `lib/db/server.ts` typed client). If `status === 'paid'`, renders `<DoneScreen chargedCents={totalCents}/>`. Otherwise renders `<CheckoutScreen/>` client island with initial state. Discarded tickets render a small "This ticket was discarded" placeholder and a link to dashboard (defensive — operators shouldn't normally see this URL after discard).
- [ ] T030 [US1] Create `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` — `"use client"` island. Holds: header-picked tech state; optimistic line append on `addServiceLine` (replace temp id with server-returned id; revert on failure); optimistic line removal; cart totals (re-derived from `computeTotals` for the local view); error banner state (FR-019); Take cash button enable rule (`chargeEligible === true`); placeholder dialog wiring for FR-016. Cancel calls `router.back()` or routes to `/dashboard`; Discard calls `discardTicket` and routes to `/dashboard`.

### Verification

- [ ] T031 [US1] Run `npm test && npm run test:e2e -- --workers=1 -g checkout-cash-sale`; assert green. Then run `-g checkout-discard`; assert green. The take-cash unit test (T013) should be green from T026; the e2e tests (T014, T015) should be green from T028–T030.

**Checkpoint**: US1 is fully functional — a cash sale can be completed end-to-end from the dashboard entry point. Tasks T014 and T015 e2e tests pass. The sidebar's "Checkout" link still works but always creates a fresh ticket (no resume yet — that lands in US2).

---

## Phase 4: User Story 2 — Resume an open ticket from the sidebar (Priority: P2)

**Goal**: The sidebar "Checkout" entry point returns the operator to their existing same-day open ticket (FR-003); if none exists or only stale/discarded ones, a fresh empty ticket is created. Dashboard entry still always creates fresh (FR-002).

**Independent Test**: With US1 complete, start a transaction, add lines, navigate away to `/dashboard` without paying, click "Checkout" in the sidebar — same ticket returns with the same cart. SC-003.

### Tests for User Story 2

- [ ] T032 [P] [US2] Write `tests/e2e/checkout-resume.spec.ts` covering US2 acceptance scenarios 1–3 and the cross-day no-resume edge case from `quickstart.md` § 5: (a) one same-day open ticket → resumed; (b) no same-day open ticket → fresh created; (c) multiple same-day open tickets → most recently updated wins; (d) prior-day open ticket exists but no same-day → fresh created (the prior-day stays open in DB but is not resumed); (e) a discarded ticket from earlier today → fresh created (Q5 + Q1 interaction). Mutates `tickets.created_at` directly when needed to simulate cross-day.

### Implementation

- [ ] T033 [US2] Implement `resumeOrCreateTicket()` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md` § 2 and research.md § R8. Uses the existing `lib/time/*` helper to compute "today in salon timezone" rather than hardcoding the timezone in SQL. If found, returns `{ ticketId, resumed: true }`; otherwise falls through to `createEmptyTicket()` and returns `{ ticketId, resumed: false }`.
- [ ] T034 [US2] Update `app/(studio)/checkout/page.tsx` to dispatch by entry-point hint: if `?fresh=1` is present in the URL `searchParams`, call `createEmptyTicket()` (dashboard CTA); otherwise call `resumeOrCreateTicket()` (sidebar). Preserves US1's "dashboard always creates fresh" invariant per FR-002.
- [ ] T035 [US2] Update `components/lacquer/new-transaction-cta.tsx` to set `href = "/checkout?fresh=1"` (single-line change in the default prop). No other call sites need updating.

### Verification

- [ ] T036 [US2] Run `npm run test:e2e -- --workers=1 -g checkout-resume`; assert green. Re-run the US1 specs to confirm no regression.

**Checkpoint**: US2 is fully functional. Sidebar entry resumes the operator's same-day open ticket; dashboard entry always creates fresh.

---

## Phase 5: User Story 3 — Assign a different tech to one line in the cart (Priority: P3)

**Goal**: Per-line tech override via the row's tech chip popover (FR-013). Header-picked tech remains the default for subsequently added lines.

**Independent Test**: With US1 complete, add a line, open the line's tech chip popover, pick a different tech, verify only that line's assigned tech changes (other lines and the header pick are unaffected).

### Tests for User Story 3

- [ ] T037 [P] [US3] Write `tests/e2e/checkout-tech-override.spec.ts` covering US3 acceptance scenarios 1–2: open the chip popover, pick a different active staff member, assert the chip visibly indicates the override AND the DB `assigned_staff_id` for only that row changed AND subsequently added lines still default to the header pick.

### Implementation

- [ ] T038 [US3] Refine `components/lacquer/checkout/cart-row-with-tech.tsx`: replace the static tech chip with a Radix Popover anchored on the chip; popover content is a vertical list of active staff with `TechAvatar`. Selecting a staff calls a callback prop (wired up in T040).
- [ ] T039 [US3] Implement `setLineTech` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md` § 5: validate session, validate `assignedStaffId` is active, refuse if ticket not open, update only the named row's `assigned_staff_id`, emit `ticket.line_tech_assigned` audit with `previous_staff_id` / `new_staff_id` in the payload.
- [ ] T040 [US3] Wire the popover's selection callback in `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`: optimistic chip update, call `setLineTech`, snap-back + toast on failure.

### Verification

- [ ] T041 [US3] Run `npm run test:e2e -- --workers=1 -g checkout-tech-override`; assert green. Re-run US1 + US2 specs.

**Checkpoint**: US3 is fully functional. Per-line tech assignment can be overridden without changing the header pick or other lines.

---

## Phase 6: User Story 4 — Print a paper receipt for a completed sale (Priority: P3)

**Goal**: A printable browser-rendered receipt at `/checkout/[ticketId]/receipt` showing line items, total, payment method. Gated on signed-in staff session (FR-026). Browser File → Print produces a clean page with no studio chrome (FR-024, FR-025).

**Independent Test**: After completing a US1 cash sale, navigate to `/checkout/<paidTicketId>/receipt`, see a printable layout. File → Print preview shows a single clean page. Anonymous (logged-out) GET of the same URL redirects to login.

### Tests for User Story 4

- [ ] T042 [P] [US4] Write `tests/e2e/checkout-receipt.spec.ts` covering US4 acceptance scenarios 1–2 plus FR-026: (a) authenticated GET of a paid ticket's receipt URL renders salon name + line items + subtotal + total + payment method "cash"; (b) printable layout omits the sidebar/topbar (assert the studio-chrome selectors are not present in the DOM); (c) anonymous GET (Playwright `request.newContext({ storageState: undefined })`) returns a redirect to `/login` and no receipt content in the body.

### Implementation

- [ ] T043 [US4] Create `components/lacquer/checkout/receipt-view.tsx` — a Server Component that takes `{ ticket, items, payment, salonName }` and renders the printable layout: salon header, item rows (name_snapshot + line price), subtotal, total, payment method label. Lacquer tokens only; tabular numerals on currency.
- [ ] T044 [US4] Create `app/(studio)/checkout/[ticketId]/receipt/page.tsx` — Server Component. Calls `requireStudioSession()` first (FR-026 — must throw / redirect for anonymous). Fetches the ticket + its single cash `payments` row + line items + salon name (from existing `settings` table; if absent, fall back to "Tang Nails" hardcoded literal — acceptable for v1). Renders `<ReceiptView/>` with no studio layout wrapping it (this route lives outside `app/(studio)/layout.tsx`'s shell — create an adjacent `app/(studio)/checkout/[ticketId]/receipt/layout.tsx` if needed to suppress the parent shell, OR use the `<html data-print="receipt">` trick from research.md § R4).
- [ ] T045 [US4] Add the `@media print { .studio-chrome { display: none !important; } body { background: white; } .receipt-page { padding: 12mm; max-width: 80mm; margin: 0 auto; } }` block to `app/(studio)/checkout/checkout.css` (replacing the TODO comment left by T011). Verify in Chromium print preview.

### Verification

- [ ] T046 [US4] Run `npm run test:e2e -- --workers=1 -g checkout-receipt`; assert green. Manually open `/checkout/<paid-id>/receipt` and File → Print preview to confirm a clean single-page render.

**Checkpoint**: US4 is fully functional. All four user stories are independently working.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Pre-push readiness — design review, full gate set, manual smoke tests, marker placement.

- [ ] T047 [P] Side-by-side design review against `design-system/prototypes/transaction/FlowSingle.jsx` (and `design-system/preview/Transaction Flows.html` if present) per `CLAUDE.md` § "When you change UI". Spot-check that every color/spacing/radius/shadow in the checkout screen traces to a token in `styles/tokens.css`. Document any drift as a fix-up task before proceeding.
- [ ] T048 [P] Manually walk the failure paths from `quickstart.md` § 5: drop `pos_take_cash` and confirm the FR-019 banner appears; add an unconfirmed line and confirm "Set price on highlighted items" hint + disabled Take cash + placeholder dialog.
- [ ] T049 Grep-verify the cash-drawer TODOs are present and findable for phase 9: `grep -rn 'TODO(phase-9)' supabase/migrations/0004_checkout_cash_sale.sql app/(studio)/checkout/actions.ts`. Two matches expected (R7).
- [ ] T050 Run the full local gate set in order, per `CLAUDE.md`: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --workers=1`. Fix any failures before moving on.
- [ ] T051 Open a PR; verify the preview migration GitHub Action (`db-migrate-preview.yml`) applies `0004_checkout_cash_sale.sql` to the preview Supabase project and the Vercel preview deploy comes up green against it. Coordinate with any concurrent feature work that also touches `supabase/migrations/`.
- [ ] T052 [P] Confirm `CLAUDE.md`'s `<!-- SPECKIT START -->` block still points at `specs/011-cash-sale-checkout/plan.md` (set during `/speckit-plan`). No action needed unless drift has occurred during implementation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — no dependencies.
- **Phase 2 (Foundational)** — depends on Phase 1. BLOCKS Phases 3–6.
- **Phase 3 (US1)** — depends on Phase 2. Independently testable.
- **Phase 4 (US2)** — depends on Phase 2. Does NOT depend on US1 *code*, but US2's e2e test (T032) uses the cash-sale UI from US1 to set up state. In practice US1 ships first; US2's resume rule is then added on top.
- **Phase 5 (US3)** — depends on Phase 2. The US3 e2e (T037) uses US1's add-service flow to seed cart lines; in practice US1 ships first.
- **Phase 6 (US4)** — depends on Phase 2. The US4 e2e (T042) uses US1 to produce a paid ticket; in practice US1 ships first.
- **Phase 7 (Polish)** — depends on every user story you intend to ship in this PR.

### Within Each User Story

- Tests are written first and asserted red before implementation begins (Constitution Principle IV, T013–T015 / T032 / T037 / T042).
- Server Actions before the components that call them (T024–T027 before T030; T033 before T034; T039 before T040; T044 before T046).
- Page-level Server Components before the client island that fetches/renders within them (T028, T029 before T030).
- Per-component UI tasks marked [P] within a story are file-independent and run in any order.

### Cross-story dependencies (real)

- **T035 (NewTransactionCTA `?fresh=1`)** is in US2 because it pairs with T034's dispatch logic. If you ship US1 alone, the dashboard CTA still works (the page always creates fresh in T028's US1 implementation); when US2 lands you update the page to dispatch and the CTA to opt in.
- **US3's popover (T038)** modifies the same file as US1's static chip (T019). US1's version compiles fine without the popover; US3 swaps it in cleanly.

---

## Parallel Opportunities

### Phase 2 Foundational

T007 (cart-totals test) is [P] with everything else in the phase; T008 implements against it.

### Phase 3 US1 — UI components

All eight component tasks T016–T023 are [P] (different files, no inter-component imports beyond shared shadcn primitives and tokens). One developer can fan them out; one developer can ship them in any order.

### Phase 3 US1 — Server actions

T024, T025, T026, T027 all live in the same file (`actions.ts`). They are NOT [P] — sequence them by dependency (T024 first because the others reuse its helpers like the totals-recompute).

### Across user stories

Once Phase 2 is complete, Phase 4 / Phase 5 / Phase 6 can theoretically run in parallel by different developers. Practically, the e2e specs for those phases depend on the US1 UI to drive the browser; if US1 is not yet green, the parallel work is limited to writing the actions and the components themselves without their e2e specs.

---

## Parallel Example: User Story 1 UI components

```bash
# Launch all eight component file creations in parallel:
Task: T016 [P] [US1] components/lacquer/checkout/tx-header.tsx
Task: T017 [P] [US1] components/lacquer/checkout/tech-avatar-row.tsx
Task: T018 [P] [US1] components/lacquer/checkout/service-tiles.tsx
Task: T019 [P] [US1] components/lacquer/checkout/cart-row-with-tech.tsx
Task: T020 [P] [US1] components/lacquer/checkout/payment-tiles.tsx
Task: T021 [P] [US1] components/lacquer/checkout/totals.tsx
Task: T022 [P] [US1] components/lacquer/checkout/done-screen.tsx
Task: T023 [P] [US1] components/lacquer/checkout/variable-price-placeholder-dialog.tsx
```

Once all eight are landed, sequence T024 → T027 (same file), then T028 → T029 → T030 (page chain).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup): T001–T002.
2. Complete Phase 2 (Foundational): T003–T012. Confirm `npm test` passes for the cart-totals unit.
3. Complete Phase 3 (US1): T013–T031. Confirm `checkout-cash-sale.spec.ts` and `checkout-discard.spec.ts` pass.
4. **STOP and VALIDATE**: Open a PR with just Phase 1 + 2 + 3. This is a shippable MVP — front desk can process cash sales from the dashboard.
5. The sidebar's "Checkout" link works but always creates a fresh ticket — call this out in the PR description as the deliberate US2 follow-up.

### Incremental Delivery (recommended)

1. PR #1: Phase 1 + 2 + 3 (US1) — shippable MVP, cash sales work from the dashboard.
2. PR #2: Phase 4 (US2) — sidebar resume.
3. PR #3: Phase 5 (US3) — per-line tech override.
4. PR #4: Phase 6 (US4) — printable receipt.
5. PR #5 (or rolled into PR #4): Phase 7 (Polish + final gate set).

Each PR touches a tight set of files and ships independently. The CI migration workflow (`db-migrate-preview.yml`) applies the single migration `0004_checkout_cash_sale.sql` in PR #1 and is a no-op thereafter.

### Bundled Delivery (alternative)

Ship Phases 1 → 7 in one PR if you prefer fewer review cycles. The task ordering still applies; do not let later phases land before their dependencies.

---

## Notes

- The `// TODO(phase-9)` markers from research.md § R7 are placed by T026 (action) and T003 (SQL function). T049 grep-verifies they are present and findable.
- The `appointments` table is schema-only this phase (data-model.md § 1). Do not add seed data, queries, or UI for it; it exists to satisfy the `tickets.appointment_id` FK target for the future appointments feature.
- The `discarded` status enum extension is the single tracked deviation from `docs/system-design.md` — see `plan.md` § Complexity Tracking. Mention this in the PR description so the next constitution amendment can pick it up.
- Every Server Action lives behind `requireStudioSession()` + `requireActingAsStaff()`. There is no role check beyond "is signed in" (FR-028 / clarification Q4).
- Cash payment is a money critical path. Reviewers must verify Principles II (server-authoritative), III (atomic, audited, snapshotted), and IV (test-first) in the PR per the constitution.
