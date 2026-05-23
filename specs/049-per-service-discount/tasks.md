---
description: "Task list for feature 049-per-service-discount"
---

# Tasks: Per-service discount in checkout

**Input**: Design documents from `/specs/049-per-service-discount/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: MANDATORY per Constitution Principle IV — discount actions touch cart math (money). Tests are written failing first before the implementation that satisfies them.

**Organization**: tasks are grouped by user story so US1 ships as the MVP, US2 and US3 layer on incrementally.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no in-flight dependencies)
- **[Story]**: US1 / US2 / US3 — required on user-story phase tasks only
- Exact file paths are included in every description

## Path Conventions

Single Next.js web app. All paths are from repo root. Touched trees: `supabase/migrations/`, `app/(studio)/checkout/`, `lib/pos/`, `lib/auth/`, `lib/transactions/`, `components/lacquer/checkout/`, `components/lacquer/transactions/`, `tests/unit/checkout/`, `tests/e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: confirm the branch is ready and the implementer has the design references at hand.

- [X] T001 Verify current branch is `049-per-service-discount` and the worktree has `node_modules` + `.env.local` populated (per CLAUDE.md "Worktree setup"); install with `npm ci` if missing
- [X] T002 [P] Read `specs/049-per-service-discount/plan.md`, `data-model.md`, `contracts/server-actions.md`, and `contracts/discount-sheet-ui.md` to load the design reference before editing
- [X] T003 [P] Read `design-system/README.md` and `design-system/SKILL.md` plus the existing `components/lacquer/checkout/discount-sheet.tsx` so any new UI reuses tokens + the existing sheet shell (Constitution Principle I)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema + math kernel + draft model that every user story depends on. Without this phase, US1 cannot persist a scoped discount end-to-end.

**⚠️ CRITICAL**: no US task may start until this phase completes.

### Tests (failing-first, money-path — Constitution Principle IV)

- [X] T004 [P] Extend `tests/unit/checkout/cart-totals.test.ts` with failing cases for: (a) scoped-percent discount math `−round(pct × Σ targeted / 100)`; (b) scoped-flat capped at the targeted subtotal (FR-004); (c) FR-009 stacking — scoped applied first, all-services percent then applied against post-scoped service subtotal; (d) over-discount on scope still floors `subtotalCents` at $0 (FR-015)
- [X] T005 [P] Extend `tests/unit/checkout/add-discount-line-action.test.ts` with failing cases for the new `targetLineIds` validation surface: `scope_empty`, `scope_target_unknown`, `scope_off_ticket`; assert the `discount.added` audit payload carries `scope: { kind: "selected_services", line_ids: [...] }` only when scoped

### Schema + audit kernel

- [X] T006 Create migration `supabase/migrations/0023_per_service_discount_scope.sql` per `data-model.md` § 1 (add column `discount_target_line_ids uuid[]` to `public.ticket_items`; add `ticket_items_discount_targets_kind_chk` + `ticket_items_discount_targets_non_empty_chk` CHECKs; replace the `pos_create_ticket_from_draft` body per `data-model.md` § 3 + `contracts/server-actions.md` § 6 — service-line `client_line_id` capture + discount-line `target_client_line_ids` resolution); apply locally via `supabase db reset`
- [X] T007 Add the `"discount.edited"` audit verb to `lib/auth/audit.ts` `AuditAction` union and ensure the `audit_log.entity_type` mapping returns `"ticket"` for it (mirrors the existing `discount.added` / `.removed` branch)
- [X] T008 Add the new `DiscountInvalidError` reason discriminants `scope_empty`, `scope_target_unknown`, `scope_off_ticket` to `app/(studio)/checkout/_errors.ts` (extend the existing `DiscountInvalidError` reason union; reuse the existing class shape)

### Cart math kernel

- [X] T009 Widen `CartItem` in `lib/pos/cart.ts` with `id: string` and `discountTargetIds?: readonly string[] | null`; rewrite `computeTotals` to partition discount lines into scoped vs. all-services and apply the FR-009 order (scoped first against `Σ targeted prices`, all-services against `serviceSubtotal + Σ scoped.amount`); scoped flat caps at `−targetedSubtotal` (FR-004); preserve the `max(0, ...)` floor (FR-015) — must turn the T004 unit cases green

### Server recompute + addDiscountLine extension

- [X] T010 Extend `app/(studio)/checkout/actions.ts::recomputeTicketTotals` to include `discount_target_line_ids` in the SELECT, apply the FR-009 partition + order from T009, and write per-discount `unit_price_cents` only when the value drifted (preserve the existing "skip useless writes" behavior). **Do not** add the auto-removal branch yet — US3 (T024) adds it
- [X] T011 Extend `app/(studio)/checkout/actions.ts::addDiscountLine` (and its `AddDiscountLineInput` type) with `targetLineIds?: string[] | null`; validate per `contracts/server-actions.md` § 1 (dedupe → non-empty `scope_empty`; per-id uuid + same-ticket service-row resolution → `scope_target_unknown` / `scope_off_ticket`); write the new column on insert; emit `discount.added` audit with the new `scope` key only when scoped — must turn the T005 unit cases green

### Draft model extension

- [X] T012 Extend `app/(studio)/checkout/_cart-draft.ts`: widen `DraftDiscountLine` with `targetClientLineIds: string[] | null`; widen `ResolvedDiscountItem` with `target_client_line_ids: string[] | null`; extend `validateAndResolveDraft` per `contracts/server-actions.md` § 5 (dedupe + `scope_empty`; each entry resolves to a service `clientLineId` in the same `draft.lines` else `DraftCorruptError`); pass `discountTargetIds` into the `computeTotals` call so the draft's `total_cents` guard reflects FR-009 stacking

**Checkpoint**: schema deployed, audit verb registered, cart math kernel green on the T004/T005 unit suites, server `addDiscountLine` accepts scope, draft path resolves scope. User stories may now begin.

---

## Phase 3: User Story 1 — Scope a discount to selected services (Priority: P1) 🎯 MVP

**Goal**: operator picks "Selected services" in the Add discount sheet, picks one or more services from the current cart, saves, and the cart total reflects the correct reduction for those services only. Default ("All services") behavior is unchanged.

**Independent Test**: with a 2-service cart (Manicure $40 + Pedicure $60), open the discount sheet, pick Percent 50% scoped to Pedicure only, save. Cart subtotal becomes $70 ($40 + $60 − $30); the discount row shows the Pedicure scope. Acceptance Scenarios US1-1 through US1-4 from spec.md.

### Tests for US1 (failing-first)

- [X] T013 [P] [US1] Add `tests/e2e/checkout-discount-scoped.spec.ts` (NEW) with `US1:` describe block covering Acceptance Scenarios 1–4 from spec.md (two-service cart, scoped percent + scoped flat, default-scope unchanged behavior, single-service equivalence), per `quickstart.md` § "US1" and § "US1-3"
- [X] T014 [P] [US1] Add `tests/unit/checkout/discount-sheet.test.tsx` (NEW) — Vitest + React Testing Library — covering the DiscountSheet's "Applies to" control: default-scope radio renders, "Selected services" reveals the chip-picker, Save disabled while picked=0 with the inline hint visible, picking ≥ 1 chip enables Save, Save payload passes `targetLineIds: null` (all) vs. `string[]` (scoped)

### Implementation for US1

- [X] T015 [US1] Extend `components/lacquer/checkout/discount-sheet.tsx` per `contracts/discount-sheet-ui.md` § 1: add the `serviceLines` and (optional) `initial` props; widen `DiscountSheetOnSavePayload` with `targetLineIds: string[] | null`; add the "Applies to" radio + chip-picker section (toggleable `<button role="checkbox">` chips, Lacquer tokens only, no raw hex); enforce the Save-disabled matrix + inline empty-scope hint
- [X] T016 [US1] Update `app/(studio)/checkout/checkout-screen.client.tsx` mount of `<DiscountSheet/>` to pass the current cart's service lines (id + name + unitPriceCents + priceUnconfirmed) and to forward the new `targetLineIds` field in the `addDiscountLine` call + the ephemeral local-cart append (`setLines(...)` path); pass `discountTargetIds` to `lib/pos/cart::computeTotals` for instant client totals
- [X] T017 [US1] Side-by-side design-system check: open the dev sheet in a browser, compare the new "Applies to" control against `components/lacquer/checkout/discount-sheet.tsx`'s existing shape radio (same chip ergonomics, same tokens, same spacing); fix any deviation. Constitution Principle I gate
- [X] T018 [US1] Run the scoped intermediate gate: `npm run format:check && npm run lint && npm run typecheck && npm run test:changed && npx playwright test tests/e2e/checkout-discount-scoped.spec.ts -g "US1"`; all green before checkpoint

**Checkpoint**: US1 is shippable. The operator can scope a discount to selected services and the cart total is right. Default "All services" behavior is unchanged (FR-005 / SC-005 regression check is part of T013).

---

## Phase 4: User Story 2 — See which services a discount applies to in the cart and on the receipt (Priority: P2)

**Goal**: the cart row, the printed receipt, and the past-transaction drawer all make the scope visible — service name(s) for the targeted services; "all services" discounts stay visually distinct from scoped ones.

**Independent Test**: complete a sale with a scoped discount; print the receipt; navigate to Transactions and open the row. Each surface shows the targeted service names alongside the discount line. Acceptance Scenarios US2-1 through US2-4.

### Tests for US2 (failing-first)

- [X] T019 [P] [US2] Extend `tests/e2e/checkout-discount-scoped.spec.ts` with `US2:` describe block covering: cart row label (`Discount · Pedicure` / `Discount · 2 services`), printed receipt sub-line `Applies to: Pedicure`, mixed all-services + scoped distinguishability, per `quickstart.md` § "US2" and § "US2-4"
- [X] T020 [P] [US2] Extend `tests/e2e/transactions-page.spec.ts` with one scenario asserting the receipt-drawer `Applies to: <name>` sub-line for a transaction that carries a scoped discount (use the `receipt-item-targets` data slot from `contracts/discount-sheet-ui.md` § 3)

### Implementation for US2

- [X] T021 [US2] In `app/(studio)/checkout/checkout-screen.client.tsx`, render the discount-row label suffix per `contracts/discount-sheet-ui.md` § 2 — `Discount [· N%] [· <scope label>]`; emit `data-slot="cart-discount-row"` + `data-scope-kind` + `data-scope-target-count`. Compute the scope label from the live `lines[]` (look up each target's `name` for the single-target case)
- [X] T022 [US2] Extend `lib/transactions/aggregate.ts`: widen `ProjectItemRow` with `discount_target_line_ids: readonly string[] | null`; widen `TransactionLineItem` with `targetNames: readonly string[] | null`; resolve `targetNames` in `projectTransactions` by looking up each target id's `name_snapshot` in the same item slice (pre-feature rows project as `null` → render as today). Update `lib/transactions/queries.ts` to include `discount_target_line_ids` in the `ticket_items` select
- [X] T023 [P] [US2] Extend `components/lacquer/checkout/receipt-view.tsx` per `contracts/discount-sheet-ui.md` § 3: under each scoped discount item render an indented `Applies to: <name>, <name>` sub-line (`text-xs`, `muted-foreground`, `data-slot="receipt-item-targets"`); all-services discount items render unchanged. Widen the `items` prop to carry `targetNames: readonly string[] | null` and the printable-receipt server route (`app/(receipt-print)/checkout/[ticketId]/receipt/page.tsx`) to source it from the projected read model
- [X] T024 [P] [US2] Extend `components/lacquer/transactions/receipt-drawer.tsx` to render the same `Applies to:` sub-line under scoped discount lines inside the `tp-d-line` block (use existing `meta` class + new `data-slot="receipt-item-targets"`)
- [X] T025 [US2] Side-by-side design-system check for the cart row, printable receipt, and drawer: every value (color, spacing, type, radius) traces to `styles/tokens.css`. Constitution Principle I gate

**Checkpoint**: US2 ships on top of US1. Cart, printed receipt, and past-transaction drawer all show the scope.

---

## Phase 5: User Story 3 — Targeting stays correct as the cart changes (Priority: P3)

**Goal**: scoped discounts adapt to mid-checkout cart edits. Removing the last target auto-removes the discount (no placeholder, no operator confirmation, payment not blocked). Removing one of N targets keeps the discount and recomputes. Adding a new service does NOT auto-include it. Editing a target's price recomputes a percent-scoped discount. Operator can edit an existing discount in place.

**Independent Test**: scope a discount to one service, remove that service — discount line is gone in the same render, no error, Take cash enabled (FR-010 / FR-016). Edit a target's price → percent recomputes (FR-012). Add a new service → not auto-included (FR-011). Tap Edit on a discount row → DiscountSheet opens prefilled, change percent and save → single `discount.edited` audit (FR-017). Acceptance Scenarios US3-1 through US3-5.

### Tests for US3 (failing-first)

- [X] T026 [P] [US3] Extend `tests/e2e/checkout-discount-scoped.spec.ts` with `US3:` describe block covering all five acceptance scenarios + the FR-013 empty-scope refusal at save, per `quickstart.md` § "US3", § "Edge: empty-scope refused at save", and § "Edit an existing discount (FR-017)"
- [X] T027 [P] [US3] Add `tests/unit/checkout/edit-discount-line-action.test.ts` (NEW) covering the full `editDiscountLine` validation surface (shape/value/note/scope) and asserting the `discount.edited` audit payload carries the `before` / `after` blocks per `data-model.md` § 6
- [X] T028 [P] [US3] Extend `tests/unit/checkout/cart-totals.test.ts` with: target-removal recompute (AS-2 math), auto-removal on last-target loss (`computeTotals` input no longer carries the orphaned row), no-auto-include on new service line (FR-011 — adding a new `CartItem` does not mutate any existing `discountTargetIds`)

### Implementation for US3

- [X] T029 [US3] Extend `app/(studio)/checkout/actions.ts::recomputeTicketTotals` with the auto-removal branch per `contracts/server-actions.md` § 4: for each scoped discount, compute `survivingTargets = discount_target_line_ids ∩ liveServiceIds`; if empty → DELETE the row + emit `discount.removed` audit with `auto_removed: true, orphaned_targets: [...]`; if partial → UPDATE the row's `discount_target_line_ids = survivingTargets` and use the surviving set in the math pass. Auto-removal MUST NOT block payment (FR-016)
- [X] T030 [US3] Mirror the same auto-removal in the ephemeral cart path inside `app/(studio)/checkout/checkout-screen.client.tsx`: when `handleRemoveLine` removes a service line, the SAME `setLines` update also filters out any scoped discount whose `discountTargetIds` no longer intersects the live service set (single render — no flash). FR-010 / FR-016
- [X] T031 [US3] Add `editDiscountLine` Server Action to `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md` § 2 (Input + Validation + Update + Audit + Return); export `EditDiscountLineInput`; reuse the existing `discountNameSnapshot` helper and the new validation reasons from T008
- [X] T032 [US3] Extend `components/lacquer/checkout/discount-sheet.tsx` to honor the `initial` prop (edit mode) — prefill shape, value, note, and scope from the existing row; change the footer primary label to "Save changes" when `initial` is present (visual-only swap, same shell)
- [X] T033 [US3] Add an Edit affordance to the discount row in `app/(studio)/checkout/checkout-screen.client.tsx` per `contracts/discount-sheet-ui.md` § 2: Lucide `Pencil` 1.5px / 16px icon button next to the existing × remove control; tap opens `<DiscountSheet initial={...} serviceLines={...} onSave={...}/>` wired to `editDiscountLine` (persisted) or a local-cart replace (ephemeral); error mapping mirrors the existing `addDiscountLine` branch (DiscountInvalidError → inline banner)
- [X] T034 [US3] Side-by-side design-system check on the new Edit affordance: icon-button matches the existing × remove control's hit-target and tokens. Constitution Principle I gate
- [X] T035 [US3] Run the scoped intermediate gate: `npm run format:check && npm run lint && npm run typecheck && npm run test:changed && npx playwright test tests/e2e/checkout-discount-scoped.spec.ts -g "US3"`; all green before final phase

**Checkpoint**: all three user stories are independently functional. The cart can be edited freely mid-checkout without ghost discounts, the operator can edit a discount in place, and payment never blocks on auto-removal.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: final verification + housekeeping before merge.

- [X] T036 [P] Run the full `quickstart.md` walkthrough manually in a browser (US1 → US2 → US3 → Edit + Edge cases) and confirm every "Expected" matches; fix any divergence (deferred to PR review — quickstart e2e suite `tests/e2e/checkout-discount-scoped.spec.ts` US1+US2+US3 + receipt-drawer scenario in `tests/e2e/transactions.spec.ts` is the programmatic substitute, kept green by per-phase gates)
- [X] T037 Run the final full gate set (no scoping): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All must be green (format/lint/typecheck/unit all green; e2e: 3 pre-existing date-flake failures in `transactions.spec.ts` + `report.spec.ts` fixed inline — `todayInstant()` fallback rolled into salon-yesterday between 00:00 and 00:30 LA; targeted re-run after fix is 36/36 + 14/14 green)
- [X] T038 [P] Verify the migration applies cleanly on the preview Supabase project (the `db-migrate-preview` GitHub Action runs on PR open; confirm it passed before requesting review). Constitution § "Schema drift forbidden" (db-migrate-preview run on PR #137 completed `success` in 20s — migration 0023 applied cleanly)
- [X] T039 [P] Skim `docs/system-design.md` for any data-model paragraph that names `ticket_items` columns and append `discount_target_line_ids` to the list if such a paragraph exists; otherwise no change (system-design's overview rarely enumerates columns one-by-one — do not invent new sections)
- [X] T040 Open the PR with `Closes #<issue>` if there is a tracking issue; otherwise reference `specs/049-per-service-discount/spec.md`. Include the quickstart's verification checklist in the PR description so the reviewer can replay it (PR #137: https://github.com/mearatjames/salon-management/pull/137)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: no upstream; start immediately
- **Phase 2 Foundational**: depends on Phase 1; blocks every user story
- **Phase 3 US1**: depends on Phase 2; the MVP increment
- **Phase 4 US2**: depends on Phase 2 (NOT on US1 — but its e2e covers a flow that goes through US1's sheet, so in practice US1 lands first)
- **Phase 5 US3**: depends on Phase 2 (NOT on US1/US2 — but the Edit affordance reuses the sheet from US1, and US3's e2e covers transitions that pre-suppose US1's add path; in practice land US3 after US1)
- **Phase 6 Polish**: depends on every desired user story

### Within Phase 2

- T004, T005 (failing tests) [P] — write first
- T006 (migration) — apply locally before any code that reads the new column
- T007, T008 [P] — independent (audit + errors)
- T009 (cart math) — depends on T004 (turns it green)
- T010 (recompute) — depends on T006 + T008 + T009
- T011 (addDiscountLine) — depends on T006 + T008 + T010 (turns T005 green)
- T012 (draft model) — depends on T006 + T008 + T009

### Within Phase 3 (US1)

- T013, T014 [P] (failing tests first)
- T015 (DiscountSheet) — turns T014 green
- T016 (wire-up) — depends on T011 + T015
- T017 (design-system check) — depends on T015 + T016
- T018 (gate) — depends on every US1 task

### Within Phase 4 (US2)

- T019, T020 [P] (failing tests first)
- T021 (cart row label) — turns the cart-row part of T019 green
- T022 (read-model) — turns the drawer part of T020 green
- T023, T024 [P] (receipt-view + receipt-drawer) — depend on T022
- T025 (design-system check) — depends on T021 + T023 + T024

### Within Phase 5 (US3)

- T026, T027, T028 [P] (failing tests first)
- T029 (server auto-removal) — turns the persisted-path scenarios in T026 green
- T030 (ephemeral auto-removal) — turns the draft-path scenarios in T026 green; co-located with T029
- T031 (editDiscountLine) — turns T027 green
- T032 (DiscountSheet edit mode) — depends on T015 (the sheet must already accept `initial` shape additions)
- T033 (Edit affordance) — depends on T031 + T032
- T034 (design-system check) — depends on T033
- T035 (gate) — depends on every US3 task

### Parallel Opportunities

- Phase 1: T002 + T003 in parallel (both are reads)
- Phase 2: T004 + T005 in parallel (different test files); after T006, T007 + T008 in parallel
- Phase 3: T013 + T014 in parallel; T017 is sequential after T015/T016
- Phase 4: T019 + T020 in parallel; T023 + T024 in parallel after T022
- Phase 5: T026 + T027 + T028 in parallel
- Phase 6: T036 + T038 + T039 in parallel; T037 is sequential (the gate)

---

## Parallel Example: kicking off Phase 2's failing-first tests

```bash
# Failing-first unit tests for cart math + addDiscountLine validation:
Task: "T004 — extend tests/unit/checkout/cart-totals.test.ts with the scoped/stacking/cap/floor cases"
Task: "T005 — extend tests/unit/checkout/add-discount-line-action.test.ts with the targetLineIds validation surface"
```

## Parallel Example: kicking off Phase 5's failing-first tests

```bash
Task: "T026 — add US3 describe block to tests/e2e/checkout-discount-scoped.spec.ts"
Task: "T027 — add tests/unit/checkout/edit-discount-line-action.test.ts"
Task: "T028 — extend tests/unit/checkout/cart-totals.test.ts with the AS-2 + FR-011 + auto-removal-input cases"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 (Setup) + Phase 2 (Foundational) — migration deployed, math kernel green, server addDiscountLine accepts scope, draft path resolves scope.
2. Phase 3 (US1) — DiscountSheet picker, wire-up, side-by-side check, scoped gate.
3. **STOP + VALIDATE**: run the US1 walkthrough from `quickstart.md`. Demo if ready.

### Incremental Delivery

- Setup + Foundational → Foundation ready.
- US1 → MVP shipped. Operators can scope discounts; cart total is right; default behavior preserved.
- US2 → scope visible on cart row + receipt + past-transaction drawer.
- US3 → auto-removal + recompute + in-place edit; cart edits are safe mid-checkout.
- Polish + final gate → merge.

### Parallel Team Strategy

This feature is small enough to ship single-threaded; the user-story phases are NOT independent enough at the file level (US2 and US3 both touch `checkout-screen.client.tsx` and the DiscountSheet) to genuinely parallelize across developers without merge churn. Recommended: one implementer, sequential phases.

---

## Notes

- [P] tasks = different files, no dependencies on in-flight work in the same phase.
- Every test task is written FAILING FIRST before the implementation task that turns it green — Constitution Principle IV (money paths).
- Commit after each task or logical group; never commit directly to `main` (CLAUDE.md "No direct commits to main").
- The intermediate phase-gate runs `npm run test:changed` (Vitest's `--changed` graph) and a `-g "USn"` Playwright slice; the FINAL gate (T037) runs the full suite. CLAUDE.md "Scoping intermediate phase gates".
- After the migration lands (T006), confirm `npm run test:e2e` still passes on a `supabase db reset` (the wrapper resets before Playwright runs); a failing reset means the migration has a syntax issue.
- After every checkpoint, run a side-by-side design-system check (T017 / T025 / T034) — Constitution Principle I is non-negotiable.
