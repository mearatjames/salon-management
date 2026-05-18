# Tasks: Per-staff payout exemptions + Settings → Staff redesign

**Input**: Design documents from `/specs/023-staff-payout-exemptions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: TDD-with-failing-tests is mandatory for audit logic (Constitution IV). Vitest specs for the audit-diff helper and Playwright audit assertions land BEFORE the implementation that satisfies them. Vitest unit tests for the other new pure helpers (validators, summary) also land first per SC-007 traceability.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. US1/US2/US3 (P1) compose into the same `<PayDeductionsSection>` component — they ship in priority order on top of the same file, each still independently testable at its checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps task to user story for traceability (US1–US8)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify worktree is correctly stacked on 022 and the existing settings shell is intact (no scaffolding work — the repo is already set up; this phase is a 30-second sanity check before touching code).

- [X] T001 Confirm `supabase/migrations/0017_supply_types.sql` exists locally (this worktree is stacked on `022-supply-types-catalog`; the trigger function in 0018 will reference `public.supply_types` so 0017 must land first per research § R12).
- [X] T002 [P] Confirm `app/(studio)/settings/layout.tsx` mounts `<TabBar />` and `app/(studio)/settings/page.tsx` redirects to `/settings/staff` (per research § R9 these are already shipped — FR-025 and FR-026 satisfied with zero edits).

**Checkpoint**: Prerequisites verified. Proceed to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, types, validators, permissions, audit-diff helper, supply-catalog helper, `updateStaff` action extension, and `page.tsx` SELECT extension — every P1 user story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Constitution IV ordering**: T011 (audit-diff Vitest) MUST be written and failing before T012 (audit-diff implementation). T007/T009/T014 (validator + summary Vitests) MUST also be written and failing before T008/T010/T015.

### Database schema

- [X] T003 Create `supabase/migrations/0018_staff_pay_deductions.sql` with: 3 new columns on `public.staff` (`card_fee_exempt boolean not null default false`, `supply_mode text not null default 'apply' check in ('apply','partial','exempt')`, `supply_except uuid[] not null default '{}'`); CHECK constraint `staff_supply_except_empty_unless_partial_chk`; trigger function `public.staff_assert_supply_except_valid()` + trigger `staff_assert_supply_except_valid_trg` (BEFORE INSERT/UPDATE on staff); trigger function `public.supply_types_prune_from_staff()` + trigger `supply_types_prune_from_staff_trg` (AFTER DELETE on supply_types). Match the migration outline in `data-model.md` § 5 byte-for-byte. Idempotent (`if not exists`, `or replace`, `drop trigger if exists`).

### App-layer types

- [X] T004 [P] Extend `app/(studio)/settings/staff/_types.ts` — add `export type StaffSupplyMode = "apply" | "partial" | "exempt"`; extend `RosterStaff` with `card_fee_exempt: boolean`, `supply_mode: StaffSupplyMode`, `supply_except: readonly string[]` per data-model.md § 2.1.

### Permissions

- [X] T005 [P] [TEST FIRST] Extend `tests/unit/staff/permissions.test.ts` — add cases asserting `assertMutationAllowed(ctx, 'update_pay_deductions')` is allowed for self (operator editing own row), allowed for owner editing any tech, allowed for manager editing non-owner, BLOCKED for manager editing owner. Run; confirm fails (`update_pay_deductions` is not yet a member of `StaffAction`).
- [X] T006 Extend `app/(studio)/settings/staff/permissions.ts` — add `"update_pay_deductions"` to the `StaffAction` union; NOT in `SELF_BLOCKED_ACTIONS` (per Clarify Q1 + research § R11); gated by existing `canEditAnyField` matrix. Re-run T005; confirm green.

### Validators

- [X] T007 [P] [TEST FIRST] Create `tests/unit/staff/validation-supply-mode.test.ts` covering: `validateSupplyMode("apply")` → `"apply"`; `"partial"` → `"partial"`; `"exempt"` → `"exempt"`; anything else throws `ValidationError("invalid_supply_mode")`. Run; confirm fails (function does not exist).
- [X] T008 Extend `app/(studio)/settings/staff/_validation.ts` — add `validateSupplyMode(input: string): StaffSupplyMode`; add `"invalid_supply_mode"` to `ValidationErrorCode`. Re-run T007; confirm green.
- [X] T009 [P] [TEST FIRST] Create `tests/unit/staff/validation-supply-except.test.ts` covering: dedupe duplicates via Set; drop non-strings silently; trim whitespace; drop unknown ids silently (allowedIds gate); empty array returns `[]`; non-array input throws `ValidationError("invalid_supply_except_shape")`; 64-entry cap truncates silently. Run; confirm fails.
- [X] T010 Extend `app/(studio)/settings/staff/_validation.ts` — add `validateSupplyExcept(raw: readonly string[], allowedIds: ReadonlySet<string>): string[]` per data-model.md § 3.2; add `"invalid_supply_except_shape"` to `ValidationErrorCode`. Re-run T009; confirm green.

### Audit-diff helper (Constitution IV: test-first MANDATORY)

- [X] T011 [P] [TEST FIRST] Create `tests/unit/staff/audit-diff.test.ts` covering: `STAFF_DIFF_KEYS` length is exactly 7 and in this order (`display_name`, `role`, `color_token`, `active`, `card_fee_exempt`, `supply_mode`, `supply_except`); `buildChanges(same, same)` returns `{ before: {}, after: {}, changes: [] }`; `buildChanges` with only `card_fee_exempt` changed returns scoped projection over that one key; `buildChanges` with only `supply_except` rearranged (same elements, different order) returns `{ changes: [] }` (Set-equality per research § R3); `buildChanges` with `supply_except` truly different (one element added) returns scoped diff with raw uuids preserved; multi-key change returns `changes` in `STAFF_DIFF_KEYS` order. Run; confirm fails (`_audit-diff.ts` does not exist).
- [X] T012 Create `app/(studio)/settings/staff/_audit-diff.ts` — export `STAFF_DIFF_KEYS` readonly array, `StaffSnapshotKey`, `StaffSnapshot`, `StaffChanges` types, and `buildChanges(before, after): StaffChanges` per data-model.md § 2.3 + research § R3. Mirror `app/(studio)/services/_audit-diff.ts` structure byte-for-byte. Array-equality for `supply_except` via `[...a].sort().join(',') === [...b].sort().join(',')`. Re-run T011; confirm green.

### Summary helper (for US3, but pure — built in foundational so US3 phase is UI-only)

- [X] T013 [P] [TEST FIRST] Create `tests/unit/staff/summary.test.ts` covering all 5 posture variants from spec US3 + front-desk hint variant:
  1. `{ cardExempt: false, supplyMode: 'apply', exemptedTypeNames: [] }` → `null` (no summary)
  2. `{ cardExempt: true, supplyMode: 'apply', exemptedTypeNames: [] }` → `"{FirstName} keeps the full payout on card-paid services — no card fee deducted."`
  3. `{ cardExempt: false, supplyMode: 'exempt', exemptedTypeNames: [] }` → `"{FirstName} keeps the full payout on every service — no supply costs deducted."`
  4. `{ cardExempt: true, supplyMode: 'exempt', exemptedTypeNames: [] }` → `"{FirstName} keeps the full payout on every service — no card fee or supply costs deducted."`
  5. `{ cardExempt: false, supplyMode: 'partial', exemptedTypeNames: ['Chrome powder'] }` → `"{FirstName} keeps the full payout on every service and is exempted from chrome-powder supply costs."`
  6. `{ cardExempt: true, supplyMode: 'partial', exemptedTypeNames: ['Chrome powder', 'GelX tips & gel'] }` → `"{FirstName} keeps the full payout on card-paid services and is exempted from chrome-powder and gelx-tips-gel supply costs."`
  7. Front-desk hint variant (separate `formatFrontDeskHint()` export or `formatSummary` returns the hint when role is `front_desk` + no exemptions). Run; confirm fails.
- [X] T014 Create `app/(studio)/settings/staff/_summary.ts` — pure helper `formatSummary({ firstName, cardExempt, supplyMode, exemptedTypeNames }) → string | null` covering all 5 posture variants; also export `formatFrontDeskHint(firstName)` for the muted hint. Re-run T013; confirm green.

### Supply-catalog helper

- [X] T015 Create `app/(studio)/settings/staff/_supply-catalog.ts` — server-only `loadSupplyCatalogForStaff(staffId): Promise<SupplyCatalogForStaff>` implementing the single SQL aggregate from research § R2 (`count(*) filter (where s.active)` + `mode() within group (order by s.supply_amount_cents) filter (where s.active)`; WHERE clause keeps archived types that are currently in this staff's `supply_except`; ORDER BY `t.name`). Return type matches data-model.md § 2.2.

### Server Action extension

- [X] T016 Extend `app/(studio)/settings/staff/actions.ts` `updateStaff` to: accept `card_fee_exempt` (`formData.get('card_fee_exempt') === 'on'`), `supply_mode` (via `validateSupplyMode`), `supply_except` (via `formData.getAll('supply_except')` → `validateSupplyExcept(raw, allowedIds)` where `allowedIds` comes from a fresh `supply_types` SELECT scoped to non-archived + currently-exempted ids); wipe `supply_except` to `[]` when saved mode is `'apply'` or `'exempt'`; call `assertMutationAllowed(ctx, 'update_pay_deductions')` only when any of the three new fields differ from the persisted target (per research § R11); build the extended audit payload via `buildChanges(before, after)` from `_audit-diff.ts`; persist the audit row via `recordAudit('staff.updated', { actorId, targetStaffId, payload: { before, after, changes } })` BEFORE `revalidatePath + redirect` (per SC-004 same-request rule).

### Page Server Component extension

- [X] T017 Extend `app/(studio)/settings/staff/page.tsx` — extend the `staff` SELECT to project the 3 new columns (`card_fee_exempt`, `supply_mode`, `supply_except`); compute per-status counts for the chip bar (`all`, `active`, `inactive`) from the in-memory roster; when a target is selected via search param, call `loadSupplyCatalogForStaff(target.id)` and pass the result through to `<EditPanel>` as a new `supplyCatalog` prop.

**Checkpoint**: Foundational ready. P1/P2/P3 user stories can now begin. The schema + audit pipeline + types + permissions + validators + helpers + page extension are all in place; what remains in each user story phase is the UI work plus the Playwright spec scaffolds + assertions.

---

## Phase 3: User Story 1 — Card-fee exemption (Priority: P1) 🎯 MVP

**Goal**: Owner can mark a tech as card-fee exempt via a single toggle in a new Pay & deductions section; subtitle resolves from `formatDefaultCardFeeLabel()`; save persists + writes audit row + the panel-profile header gains a "Card-fee exempt" badge.

**Independent Test**: Seed two active staff. Open Tech A's edit panel, turn Card processing fee off, save; confirm the subtitle flips to the exempt copy and a "Card-fee exempt" badge appears in the panel header. Reload, re-open: state persists. Open Tech B: still on, no exempt badge.

### Tests for User Story 1 (Constitution IV — audit assertions first)

- [X] T018 [P] [US1] [TEST FIRST] Create `tests/e2e/staff-payout-exemptions.spec.ts` with a `describe('US1: Card-fee exemption', ...)` block containing:
  - A test that signs in as owner, navigates to `/settings/staff`, opens an active tech, toggles Card processing fee off, saves, asserts the toast appears + the subtitle reads "Exempt — card fee never deducted from payout." + the header shows a `Card-fee exempt` badge.
  - A test that reloads + re-opens the same tech and asserts the toggle is still off.
  - **Audit-row assertion** (test-first per Constitution IV): per the `newAuditCursor()` / `getAuditLogRowsSince()` pattern in `tests/e2e/_db.ts`, capture a cursor before the save, run the save, assert exactly one new `staff.updated` row exists whose `payload.changes` contains `card_fee_exempt`, `payload.before.card_fee_exempt === false`, `payload.after.card_fee_exempt === true`.
  Run the spec; confirm all three tests FAIL (the section doesn't exist yet + the action doesn't write the new diff key yet — wait, T016 already added the audit writing; so the audit test should already pass once the UI fires the save. That's fine — the UI tests will still fail, gating the implementation).

### Implementation for User Story 1

- [X] T019 [US1] Create `components/lacquer/staff/pay-deductions-section.client.tsx` — initial scaffold with ONLY the Card processing fee row (Switch from `components/ui/switch.tsx`, subtitle resolved by calling `formatDefaultCardFeeLabel()` from `lib/services/card-fee-default.ts` per Clarify Q5; flips to "Exempt — card fee never deducted from payout." when toggle is off). Props: `target: RosterStaff`, `supplyCatalog: SupplyCatalogForStaff` (unused yet — placeholder for US2), `draft` + `onDraftChange` callbacks for `card_fee_exempt`.
- [X] T020 [US1] Mount `<PayDeductionsSection>` inside `components/lacquer/staff/edit-panel.client.tsx` — add the new field to the draft reducer (`cardFeeExempt: target.card_fee_exempt`); render the section between the existing Access section and the Save button (provisional placement; US6 restructures into formal section cards); plumb the section's `onDraftChange` into the reducer so the save action submits the new value as `card_fee_exempt` FormData field.
- [X] T021 [US1] Add a minimal `<CardFeeExemptBadge>` (or inline render) in the existing panel header to render when `draft.cardFeeExempt === true` (US3 builds the full `<StatusBadges>` component — this is the US1-only minimal version so the badge assertion in T018 passes). Visual values trace to `--warning` / `--warning-foreground` tokens per Constitution I.
- [X] T022 [US1] Append `.pay-deductions-section*` + `.pay-deductions-toggle-row*` + `.staff-status-badge--card-fee-exempt*` selectors to `styles/settings.css` — every value resolves to a token from `styles/tokens.css` (radius 12 for the section card, padding/spacing on the 4px scale, color tokens for the toggle and badge tint). Run the US1 spec from T018; confirm green.

### Scoped verification gate (US1 checkpoint)

- [X] T023 [US1] Run scoped gates per CLAUDE.md "Scoping intermediate phase gates": `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` + `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)` + `npm run typecheck` + `npm test` + `npx playwright test tests/e2e/staff-payout-exemptions.spec.ts -g "US1"`. All green before continuing to US2.

**Checkpoint**: US1 fully functional and testable independently. MVP-ready (toggle + persist + audit + badge).

---

## Phase 4: User Story 2 — Supply deductions mode + per-type picker (Priority: P1)

**Goal**: Owner can set supply deductions to Apply all / Some / Exempt; in Some mode, a per-type picker lists every active supply type plus any archived type currently in the tech's exemption set (Clarify Q3); ticks persist; switching mode without saving preserves draft ticks (Clarify Q4); saving with Apply all/Exempt wipes the persisted set.

**Independent Test**: Per spec US2 — seed two active staff and 3 supply types ("Chrome powder", "GelX tips & gel", "Cat-eye gel"). Open Tech A, set Supply to Some, tick Chrome powder, save; re-open: still Some, still ticked. Rename Chrome powder → Chrome powders elsewhere; re-open: ticked row reflects new name. Set Tech A to Exempt, save; re-open: picker hidden, set is empty.

### Tests for User Story 2

- [X] T024 [P] [US2] [TEST FIRST] Extend `tests/e2e/staff-payout-exemptions.spec.ts` with a `describe('US2: Supply deductions mode + per-type picker', ...)` block:
  - Test: default is `Apply all` with "All supply costs deducted from payout." subtitle.
  - Test: selecting `Some` reveals the per-type picker listing all active supply types alphabetized; each row shows a usage hint of the form `${N} services · typically $${X} per ticket`.
  - Test: ticking a type + saving persists; reload + re-open confirms tick survives.
  - Test: selecting `Exempt` + saving persists; reload confirms picker is hidden + `supply_except` is empty.
  - Test (Clarify Q4 draft preservation): in Some mode with ticks, switch to Apply all, switch back to Some — ticks restored without save round-trip.
  - Test (Clarify Q3 archived UX): seed a staff with `supply_mode='partial'` + `supply_except=[<chrome-id>]`, archive Chrome powder via the 022 Edit Policy sheet (or direct UPDATE for test speed), reload the panel, assert Chrome powder still appears in the picker with a `Archived` muted pill + remains tickable.
  - **Audit-row assertion**: save with `supply_mode` and `supply_except` changes; assert one `staff.updated` row whose `payload.changes` contains both keys; `payload.after.supply_except` is the raw uuid array (not name snapshots) per FR-014.
  - Test: empty catalog empty-state — with zero active supply types and no prior exemptions, selecting Some shows "No supply types defined yet. Add some on the Services page first." with a link to `/services`.
  - Test (FR-012 stale-tab defensive): submit a `supply_except` FormData value containing an unknown uuid; assert the save succeeds + the persisted set contains only valid ids (unknown silently dropped).
  Run; confirm all FAIL.

### Implementation for User Story 2

- [X] T025 [US2] Extend `components/lacquer/staff/pay-deductions-section.client.tsx` — add the Supply deductions row with a ToggleGroup (shadcn `ToggleGroup` from `components/ui/toggle-group.tsx`, `type="single"`) bound to draft `supplyMode`. Three options labelled `Apply all` / `Some` / `Exempt`. Subtitle resolves: `'apply'` → "All supply costs deducted from payout."; `'exempt'` → "Exempt — no supply costs deducted."; `'partial'` → (no subtitle; the picker speaks for itself).
- [X] T026 [US2] Extend the section with the per-type picker — renders only when `draft.supplyMode === 'partial'`. Iterates `supplyCatalog.types`; for each row renders a shadcn `Checkbox` bound to `draft.supplyExcept.includes(type.id)`, the type name, a `Archived` muted pill when `type.archived === true`, and the usage hint computed inline: `${type.service_count} services · typically $${(type.sample_amount_cents/100).toFixed(2)} per ticket` (or `"Unused — no services reference this type yet."` when `service_count === 0`).
- [X] T027 [US2] Add the empty-state row inside the picker — when `supplyCatalog.types.length === 0`, render "No supply types defined yet. Add some on the Services page first." with a Next.js `<Link href="/services">` styled per existing prototype.
- [X] T028 [US2] Add the "no types ticked" warning hint inside the picker — when `draft.supplyMode === 'partial'` + `draft.supplyExcept.length === 0`, render the muted line "No supply types selected — all costs will be deducted normally until you tick at least one." per spec US2 #7.
- [X] T029 [US2] Wire the draft-preservation rule (Clarify Q4) — the reducer's `setSupplyMode(next)` MUST NOT clear `draft.supplyExcept`. Only the save action's submitted FormData clears it (T016 already wipes server-side when saved mode ≠ partial). The picker visibility depends on the current mode in draft state; the ticks live in `draft.supplyExcept` independently.
- [X] T030 [US2] Extend `<StatusBadges>` (or the US1-era minimal inline render) to add `Supply-exempt` (when `draft.supplyMode === 'exempt'`) and `Partial supply exemption` (when `draft.supplyMode === 'partial'`) — US3 builds the formal component but US2's e2e expects these to appear. Token-mapped colors per Constitution I.
- [X] T031 [US2] Append `.pay-deductions-segmented*` + `.pay-deductions-picker*` + `.pay-deductions-picker-row*` + `.pay-deductions-picker-empty*` + `.pay-deductions-picker-hint*` + `.staff-archived-pill*` + `.staff-status-badge--supply-exempt*` + `.staff-status-badge--partial-supply*` selectors to `styles/settings.css`. Token-traceable. Run T024 spec; confirm green.

### Scoped verification gate (US2 checkpoint)

- [X] T032 [US2] Run scoped gates: prettier-check on changed files + eslint on changed files + `npm run typecheck` + `npm test` + `npx playwright test tests/e2e/staff-payout-exemptions.spec.ts -g "US2"`. All green before US3.

**Checkpoint**: US1 + US2 both work. Owner can configure card-fee exemption AND supply-mode + per-type exemptions.

---

## Phase 5: User Story 3 — Summary sentence + status badges (Priority: P1)

**Goal**: Pay & deductions section renders a plain-language summary sentence when ≥1 exemption is in effect (5 posture variants); no summary when none; front-desk muted hint when role is `front_desk` + no exemptions; panel header status badges update live from draft state (FR-016).

**Independent Test**: Open a tech with no exemptions; no summary, only Active/Inactive badge. Toggle card off + save; summary appears + Card-fee exempt badge. Switch Supply to Exempt + save; summary updates + Supply-exempt badge added. Switch to Some + tick one type + save; summary names the type.

### Tests for User Story 3

- [X] T033 [P] [US3] [TEST FIRST] Extend `tests/e2e/staff-payout-exemptions.spec.ts` with `describe('US3: Summary sentence + live status badges', ...)`:
  - 6 tests, one per posture combination from quickstart § 4 table — sets the tech to the named posture, saves, asserts the rendered summary text matches the documented copy verbatim.
  - Test: no exemption + non-front-desk role → no summary.
  - Test: front-desk role + no exemption → muted hint "Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets." renders instead of the summary.
  - Test: live badge update — toggle Card off WITHOUT saving, assert the Card-fee exempt badge appears immediately in the panel header (FR-016); reload; the badge disappears because the toggle wasn't saved. (Confirms badges derive from draft state per research § R10.)
  Run; confirm all FAIL.

### Implementation for User Story 3

- [X] T034 [US3] Create `components/lacquer/staff/status-badges.tsx` — pure render component. Props: `{ active, cardFeeExempt, supplyMode }`. Renders: always-on `Active`/`Inactive` chip (tinted via `--success`/`--muted-foreground`); conditional `Card-fee exempt` chip when `cardFeeExempt`; conditional `Supply-exempt` chip when `supplyMode === 'exempt'`; conditional `Partial supply exemption` chip when `supplyMode === 'partial'`. Lucide icons sized 14 / 1.5px stroke. Remove the US1+US2-era minimal inline renders from T021 + T030 — `<StatusBadges>` is now the single source.
- [X] T035 [US3] Mount `<StatusBadges active={draft.active} cardFeeExempt={draft.cardFeeExempt} supplyMode={draft.supplyMode} />` in the panel-profile header area inside `components/lacquer/staff/edit-panel.client.tsx`. Passes draft (not target) state — badges update live before save per FR-016.
- [X] T036 [US3] Extend `components/lacquer/staff/pay-deductions-section.client.tsx` — at the bottom of the section render the summary via `formatSummary({ firstName: target.display_name.split(' ')[0], cardExempt: draft.cardFeeExempt, supplyMode: draft.supplyMode, exemptedTypeNames: draft.supplyExcept.map(id => supplyCatalog.types.find(t => t.id === id)?.name).filter(Boolean) })`. When the return is `null`, render nothing.
- [X] T037 [US3] Extend the section with the front-desk muted hint — when `target.role === 'front_desk'` AND no exemptions are in effect (no card-fee exempt AND `supply_mode === 'apply'` AND empty `supply_except`), render the hint copy from `formatFrontDeskHint(firstName)` in lieu of the summary.
- [X] T038 [US3] Append `.pay-deductions-summary*` + `.pay-deductions-front-desk-hint*` + `.staff-status-badges*` selectors to `styles/settings.css`. Run T033 spec; confirm green.

### Scoped verification gate (US3 checkpoint — MVP complete)

- [X] T039 [US3] Run scoped gates: prettier-check + eslint on changed files + `npm run typecheck` + `npm test` + `npx playwright test tests/e2e/staff-payout-exemptions.spec.ts -g "US1|US2|US3"`. All P1 stories green. **MVP shippable here** — the feature's headline capability (US1+US2+US3 in the existing flat panel) works end-to-end with audit + badges + summary.

---

## Phase 6: User Story 4 — Filter chips (Priority: P2)

**Goal**: Replace show-inactive switch with three filter chips (All · Active · Inactive) with tabular per-status counts; persist selection in `localStorage` under `tn:settings:staff:filter`; default to Active for first-time visitors; ignore legacy key.

**Independent Test**: Seed 4 active + 2 inactive. Load `/settings/staff`; chips render `All 6 · Active 4 · Inactive 2`, Active selected by default, only 4 active rows visible. Click Inactive: only 2 rows. Reload: last chip persists. Inspect `localStorage`: only `tn:settings:staff:filter` is read/written.

### Tests for User Story 4

- [X] T040 [P] [US4] [TEST FIRST] Create `tests/e2e/staff-roster-chrome.spec.ts` (new spec covering US4/US5 — these are roster-side concerns separate from the panel-side `staff-payout-exemptions.spec.ts`). Add `describe('US4: Filter chips', ...)`:
  - Test: chip bar renders with three chips + tabular counts that match the seed.
  - Test: first-time visitor (cleared localStorage) sees Active selected by default.
  - Test: clicking Inactive filters to inactive rows; clicking All shows all rows; clicking Active filters to active.
  - Test: reload preserves selection.
  - Test: `localStorage.getItem('tn:settings:staff:filter')` returns the last selected value; `tn:settings:staff:show-inactive` is never written (assert `=== null` after navigation).
  - Test (FR-020 empty state): with Inactive selected on a salon with zero inactive staff, the empty row reads "No inactive staff." with a `Switch to Active` inline link.
  Run; confirm all FAIL.

### Implementation for User Story 4

- [X] T041 [US4] Create `components/lacquer/staff/roster-filter-chips.client.tsx` — client island per research § R4 sketch. Props: `{ counts: { all: number; active: number; inactive: number }; onFilterChange: (filter: 'all'|'active'|'inactive') => void }`. State: `filter` initialized to `'active'`; `useEffect` reads `tn:settings:staff:filter` after mount and updates state. Each chip is a token-mapped pill (radius 999, padding on 4px scale, tabular numerals). Selecting writes to localStorage + calls `onFilterChange`.
- [X] T042 [US4] Edit `components/lacquer/staff/staff-table.client.tsx` — remove the existing show-inactive `<Switch>` + remove all references to `tn:settings:staff:show-inactive` storage key; mount `<RosterFilterChips counts={counts} onFilterChange={setFilter} />`; the existing search input is preserved unchanged; filter rows by `filter` + search term in the existing render path.
- [X] T043 [US4] Edit `components/lacquer/staff/empty-state.tsx` — accept a `filter` prop; render context-aware copy: `filter==='active'` → "No active staff."; `filter==='inactive'` → "No inactive staff." with a button calling `onFilterChange('active')`; `filter==='all'` → "No staff in this salon yet."
- [X] T044 [US4] Edit `components/lacquer/staff/page-header.tsx` — minimal layout adjustment to accommodate the chip bar visually above the roster (may be unchanged depending on final layout — if the chip bar is mounted by `StaffTable` and not the page header, no edit needed here; otherwise add a slot for the chip bar above the search input).
- [X] T045 [US4] Append `.staff-filter-chips*` selectors to `styles/settings.css` — token-mapped (chips use `--primary` tint for selected, `--muted-foreground` for unselected; tabular-nums for counts). Run T040 spec; confirm green.

### Scoped verification gate (US4 checkpoint)

- [X] T046 [US4] Run scoped gates + `npx playwright test tests/e2e/staff-roster-chrome.spec.ts -g "US4"`. Green before US5.

---

## Phase 7: User Story 5 — Staff row redesign (Priority: P2)

**Goal**: Each row gets a leading status dot, tinted PIN pill, tabular added-date, reduced opacity for inactive, left accent bar when selected, mobile chevron under 900px.

**Independent Test**: Seed 1 active+PIN, 1 active+no-PIN, 1 inactive+no-PIN. Confirm dot+pill+date per spec US5 acceptance scenarios.

### Tests for User Story 5

- [X] T047 [P] [US5] [TEST FIRST] Extend `tests/e2e/staff-roster-chrome.spec.ts` with `describe('US5: Staff row redesign', ...)`:
  - Test: active row with PIN shows success-tinted status dot + success "Set" pill + tabular "Added MMM YYYY" date.
  - Test: active row without PIN shows the same dot + warning "No PIN" pill.
  - Test: inactive row shows muted dot + ~60% opacity (assert via computed style `opacity`).
  - Test: clicking an inactive row restores its opacity to 1.0 + a left accent bar appears (assert via a `[data-selected="true"]` attribute or `::before` pseudo via computed style sufficient).
  - Test: at viewport `<900px` (Playwright `page.setViewportSize({width:800,height:600})`) the trailing date is hidden + a chevron icon renders at the right edge.
  Run; confirm all FAIL.

### Implementation for User Story 5

- [X] T048 [P] [US5] Create `components/lacquer/staff/status-dot.tsx` — pure render. Props: `{ active: boolean }`. 8px dot, `--success` background when active, `--muted-foreground` when inactive. Radius 999.
- [X] T049 [US5] Edit `components/lacquer/staff/staff-row.tsx` — restructure to: leading `<StatusDot active={staff.active} />`; existing avatar + name; role on a second line (name `font-medium`, role `font-normal text-muted-foreground`); right side: tinted PIN pill (`<span className="staff-pin-pill staff-pin-pill--set">Set</span>` when `pin_set`, `--no-pin` when not); tabular "Added MMM YYYY" date (`Intl.DateTimeFormat(undefined, {year:'numeric', month:'short'}).format(new Date(staff.created_at))`); inactive opacity reduced via `data-active="false"` attribute (CSS-driven); left accent bar via `data-selected="true"` attribute + CSS `::before` pseudo; mobile chevron via `.staff-row-chevron` rendered always but `display:none` on desktop per research § R5.
- [X] T050 [US5] Append/replace `.staff-row*` selectors in `styles/settings.css` — `.staff-row[data-active="false"] { opacity: 0.6; }` + `.staff-row[data-selected="true"] { opacity: 1; }` + `.staff-row[data-selected="true"]::before { background: var(--primary); width: 3px; }` for the accent bar; `.staff-pin-pill--set` with `--success` tint; `.staff-pin-pill--no-pin` with `--warning` tint; `.staff-row-added-date { font-variant-numeric: tabular-nums; color: var(--muted-foreground); }`; `.staff-row-chevron { display: none; }` at base; mobile reveals via the `@media (max-width: 899px)` block from research § R5. Run T047 spec; confirm green.

### Scoped verification gate (US5 checkpoint)

- [X] T051 [US5] Run scoped gates + `npx playwright test tests/e2e/staff-roster-chrome.spec.ts -g "US4|US5"`. Green before US6.

---

## Phase 8: User Story 6 — Panel sectioning + danger zone (Priority: P2)

**Goal**: Edit panel restructured into Identity → Access → Pay & deductions → Save → Danger zone. Panel-profile header at top (avatar + name + role + "Added MMM YYYY" + status badges). Danger zone is a red-tinted block containing Deactivate/Reactivate + Remove from roster; no destructive control anywhere else in the panel (FR-028).

**Independent Test**: Open any tech's panel. Confirm sections render top-to-bottom in the documented order. Confirm danger zone has a red-tinted background distinct from neutral cards above. Confirm Deactivate (or Reactivate) + Remove from roster live only inside the danger zone.

### Tests for User Story 6

- [X] T052 [P] [US6] [TEST FIRST] Create `tests/e2e/staff-panel-structure.spec.ts` (new spec — panel-structure assertions are reused by other tests via shared fixtures). Add `describe('US6: Panel sectioning + danger zone', ...)`:
  - Test: opening a tech's panel shows the panel-profile header at the top with avatar + name + role + "Added MMM YYYY" + status badges row.
  - Test: panel sections render in this exact DOM order — `[data-section="identity"]` → `[data-section="access"]` → `[data-section="pay-deductions"]` → `[data-section="save"]` → `[data-section="danger-zone"]`.
  - Test: danger zone background distinct from neutral cards (assert via computed `background-color` differs from siblings).
  - Test: active staff → Deactivate button in danger zone; inactive staff → Reactivate; both followed by "Remove from roster" button.
  - Test: NO destructive action appears outside the danger zone (assert no `[data-destructive="true"]` button exists outside `[data-section="danger-zone"]`).
  Run; confirm all FAIL.

### Implementation for User Story 6

- [X] T053 [P] [US6] Create `components/lacquer/staff/danger-zone.client.tsx` — composes Deactivate (or Reactivate, depending on `target.active`) + Remove from roster, consuming the existing `<ConfirmDialog>` for both. Red-tinted background container (`--destructive` family tokens). Both buttons carry `data-destructive="true"` for the FR-028 enforcement test.
- [X] T054 [US6] Edit `components/lacquer/staff/edit-panel.client.tsx` — restructure into 4 section cards + save button + danger zone, each carrying a `data-section` attribute matching the T052 selectors. Move all existing fields into the correct section (display name + role select + avatar color picker → Identity; Active toggle + PIN row → Access; PayDeductionsSection → Pay & deductions; full-width primary Save changes button → Save; `<DangerZone />` at the bottom). Move the existing Deactivate/Reactivate/Remove handlers from the previous panel location into `<DangerZone />` props.
- [X] T055 [US6] Edit `components/lacquer/staff/edit-panel.client.tsx` panel-profile header — add a header card above the Identity section containing: large avatar; display name; "{Role} · Added MMM YYYY" subtitle; `<StatusBadges />` row.
- [X] T056 [US6] Append `.staff-panel-section*` + `.staff-panel-profile-header*` + `.danger-zone*` + `.danger-zone-button*` selectors to `styles/settings.css` — every card uses radius 12, padding on 4px scale, `--card` background; danger zone uses `--destructive` family tints (background tint + border tint distinct from neutral cards). Run T052 spec; confirm green.

### Scoped verification gate (US6 checkpoint)

- [X] T057 [US6] Run scoped gates + `npx playwright test tests/e2e/staff-panel-structure.spec.ts -g "US6"`. Green before US7.

---

## Phase 9: User Story 7 — Add-staff wizard sheet (Priority: P3)

**Goal**: "Add staff" opens a 420px right-side sheet with three step pills (Details · Set PIN · Done), live preview card, sticky footer. Two existing Server Actions (`addStaff` + `setStaffPin`) unchanged — visual chrome only.

**Independent Test**: From the roster, click Add staff. Confirm sheet slides in at 420px, three pills with Details highlighted, live preview mirrors draft. Complete steps; new tech appears in roster.

### Tests for User Story 7

- [X] T058 [P] [US7] [TEST FIRST] Create `tests/e2e/staff-add-wizard.spec.ts`. Add `describe('US7: Add-staff wizard sheet', ...)`:
  - Test: clicking Add staff opens a right-side sheet ~420px wide (assert `[data-state="open"]` on the wizard root).
  - Test: header shows three step pills with Details highlighted (`[data-step="details"][data-active="true"]`).
  - Test: live preview card on the right mirrors the in-progress draft (typing into the name field updates the preview).
  - Test: footer shows Cancel + "Next: set PIN" disabled until display_name is non-empty.
  - Test: completing step 1 → step 2 pill highlights + PIN input renders + footer updates.
  - Test: completing step 2 → step 3 pill highlights + success state renders.
  - Test (FR-030 preserved Cancel behavior): cancel mid-wizard after step 1 leaves the partially-created staff in the roster with a `No PIN` pill.
  Run; confirm all FAIL.

### Implementation for User Story 7

- [X] T059 [US7] Edit `components/lacquer/staff/add-staff-wizard.client.tsx` per research § R8 — **modify in place, do not replace**. Wrap the existing two-step state machine in a 420px right-side sheet shell (`<Sheet side="right">` from `components/ui/sheet.tsx`). Add header pills with the three step labels + active-state highlighting bound to the current step. Add a live preview card on the right side of the sheet body that mirrors `{display_name, role, color_token}` in real time. Add a sticky footer with Cancel + a primary button whose label reflects the next step ("Next: set PIN" → "Set PIN" → "Done"). Existing `addStaff` and `setStaffPin` action calls are unchanged.
- [X] T060 [US7] Append `.add-staff-wizard-sheet*` + `.add-staff-wizard-pills*` + `.add-staff-wizard-preview*` + `.add-staff-wizard-footer*` selectors to `styles/settings.css` — token-mapped, 300ms slide-in (CSS transition), respects `prefers-reduced-motion` per the shared block in T070. Run T058 spec; confirm green.

### Scoped verification gate (US7 checkpoint)

- [X] T061 [US7] Run scoped gates + `npx playwright test tests/e2e/staff-add-wizard.spec.ts -g "US7"`. Green before US8.

---

## Phase 10: User Story 8 — Mobile bottom sheet (Priority: P3)

**Goal**: On viewports <900px the two-pane layout collapses to a full-width roster; tapping a row opens the edit panel as a bottom sheet (slide up from bottom, ≤92vh, body scroll locked). FAB in lower-right opens the add-staff wizard sheet.

**Independent Test**: Resize browser to <900px. Confirm roster takes full width, no inline panel. Tap a row: bottom sheet slides up. Tap dismiss: sheet slides down. Tap FAB: wizard sheet opens.

### Tests for User Story 8

- [X] T062 [P] [US8] [TEST FIRST] Create `tests/e2e/staff-mobile.spec.ts`. Set viewport to `{ width: 800, height: 1000 }` for the whole describe. Add `describe('US8: Mobile bottom sheet + FAB', ...)`:
  - Test: roster renders full-width, no inline panel visible (`[data-section="identity"]` not in DOM until a row is tapped).
  - Test: FAB renders in the lower-right (`[data-component="staff-fab"]` exists + has the correct position).
  - Test: tapping a row opens a bottom sheet (`<StaffMobileSheet>` is `[data-state="open"]`); sheet height ≤ 92vh.
  - Test: body scroll is locked while the sheet is open (assert `document.body.style.overflow === 'hidden'` or via the Radix scroll-lock attribute).
  - Test: dismissing the sheet (via tap-close or programmatic) restores body scroll + closes the sheet; the underlying roster scroll position is preserved.
  - Test: tapping the FAB opens the Add-staff wizard sheet from US7.
  Run; confirm all FAIL.

### Implementation for User Story 8

- [X] T063 [P] [US8] Create `components/lacquer/staff/staff-mobile-sheet.client.tsx` — wraps `<EditPanel>` in a `<Sheet side="bottom">` from `components/ui/sheet.tsx`. Body scroll lock comes free from Radix per research § R6. Drag handle rendered at the top via the existing Sheet primitive's slot. Mounted in the page tree unconditionally; CSS shows it only at `<900px` per research § R5.
- [X] T064 [US8] Edit `components/lacquer/staff/add-staff-button.client.tsx` (or create `components/lacquer/staff/staff-fab.client.tsx` if cleaner) — add a FAB variant rendered in the page tree, carrying `data-component="staff-fab"`. Position: `position: fixed; bottom: 24; right: 24`. Width 56, height 56, radius 999, `--primary` background, Lucide `Plus` icon. CSS shows it only at `<900px`. Clicking opens the same add-staff wizard sheet from US7.
- [X] T065 [US8] Edit `app/(studio)/settings/staff/page.tsx` — when target is selected, the bottom sheet receives the same `<EditPanel>` props as the desktop aside. The desktop aside is `display: none`-hidden under 900px (the panel content is rendered once but the bottom sheet's Radix portal hosts a fresh tree — verify there's no double-mount; if Radix `Sheet` rehydrates the child server-side that's fine, but the panel's draft reducer must not double-fire — if so, conditionally render the desktop aside vs the mobile sheet based on a SSR-safe wrapper).
- [X] T066 [US8] Append `.staff-mobile-sheet*` + `.staff-fab*` selectors + the `@media (max-width: 899px)` rules (per research § R5) to `styles/settings.css`. Sheet height `max-height: 92vh`. FAB shadow + hover state per Lacquer tokens. Run T062 spec; confirm green.

### Scoped verification gate (US8 checkpoint)

- [X] T067 [US8] Run scoped gates + `npx playwright test tests/e2e/staff-mobile.spec.ts -g "US8"`. Green before Polish.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Side-by-side prototype compare, prefers-reduced-motion shared block, update the legacy `tests/e2e/staff.spec.ts` for the redesigned chrome, CLAUDE.md handoff to next feature, and the final full-suite gate.

- [X] T068 [P] Update `tests/e2e/staff.spec.ts` — replace assertions for the legacy show-inactive switch with assertions for the filter chips; update row-text assertions to match the redesigned row (status dot + PIN pill + tabular date); update edit-panel-structure assertions where US3/US4/US5/US6/US7 tests depend on the new shell (panel-profile header + section order + danger zone). Ensure existing US3–US7 specs in `staff.spec.ts` from 006 still pass with the new structure.
- [X] T069 [P] Append the shared `@media (prefers-reduced-motion: reduce)` block per research § R7 to `styles/settings.css` — scope `transition-duration: 0ms !important` + `animation-duration: 0ms !important` to `.staff-mobile-sheet[data-state]`, `.add-staff-wizard-sheet[data-state]`, and any other animated surface from US7/US8. WCAG 2.3.3 compliance check.
- [X] T070 [P] Side-by-side design-system compare per quickstart § 10. Open `design-system/Staff Settings.html` in one tab and `http://localhost:3000/settings/staff` in another (signed in as owner). Walk every surface (roster row, filter chips, sectioned panel, danger zone, Pay & deductions, add-staff wizard, mobile bottom sheet); confirm every visible value resolves to a token from `styles/tokens.css`. Run the design-auditor agent on the touched components (`speckit-design-auditor` per CLAUDE.md).
- [X] T071 Edit `CLAUDE.md` "Active feature plan" pointer — switch from `specs/023-staff-payout-exemptions/plan.md` to the next feature's plan (or remove if 023 is the latest). Minor housekeeping; does not block the gate.
- [X] T072 Update `tests/e2e/staff-payout-exemptions.spec.ts` audit cursor pattern — confirm every audit-row assertion uses `newAuditCursor()` + `getAuditLogRowsSince()` scoped per-test per the parallel-workers rule in CLAUDE.md (prevents the shared-table race that bounces parallel test runs).
- [X] T073 [P] Run the FULL pre-push gate set per CLAUDE.md "Pre-push quality gates": `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five green. PR is ready to push.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — verifies preconditions only.
- **Foundational (Phase 2)**: Depends on Setup; **BLOCKS all user stories**. Internal ordering: T003 (migration) is independent; T004 (types) is independent and unblocks T005–T017; T005/T006 are sequential (test then implement); same for T007/T008, T009/T010, T011/T012, T013/T014; T015 (supply catalog) is independent; T016 (updateStaff) depends on T004/T008/T010/T012; T017 (page.tsx) depends on T004 + T015.
- **User Stories (Phase 3+)**: All depend on Foundational completion. US1 → US2 → US3 are tightly sequenced (they layer on the same `<PayDeductionsSection>` file); US4, US5, US6, US7, US8 are independent of US1–US3 and of each other and can run in parallel after Foundational. US6 reorganizes the panel; US3 mounts `<StatusBadges>` in the panel header — those edits coexist (US3 adds the badges to the existing header; US6 moves the header up into a panel-profile card without changing the badges' presence).
- **Polish (Phase 11)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Foundational only. Independent of US2–US8.
- **US2 (P1)**: Foundational only. Builds on US1's `<PayDeductionsSection>` shell but the e2e tests pass without US1 having been merged (US2 can stand alone in a fresh worktree if US1 work is reverted). For sequential build-out, US1 → US2 makes pragmatic sense.
- **US3 (P1)**: Foundational only. The `<StatusBadges>` it ships replace the minimal inline render added in US1/US2 (T021 + T030). For sequential build-out, US1 + US2 → US3.
- **US4 (P2)**: Foundational only (needs `page.tsx` to compute counts — done in T017). Fully independent of US1/US2/US3 and US5–US8.
- **US5 (P2)**: Foundational only. Independent of US1/US2/US3/US4/US6/US7/US8.
- **US6 (P2)**: Foundational only. Restructures the edit panel; coexists with the US3-mounted `<StatusBadges>` (US6 moves them into the panel-profile header card). For sequential build-out, US1+US2+US3 should land before US6 so the panel-profile header has the badges to display from day one.
- **US7 (P3)**: Foundational only. Independent.
- **US8 (P3)**: Foundational only. Independent of all others; depends on US7 only because the FAB opens the US7 wizard sheet (so US7 must ship before US8's FAB test passes).

### Within Each User Story

- Tests land first per Constitution IV (audit assertions) + SC-007 traceability (other helpers).
- Models / types / validators / helpers were already built in Foundational — user-story phases are purely UI work + e2e tests + CSS.
- Run scoped Playwright tests (`-g "USn"`) at the end of each phase per CLAUDE.md.
- The final full-suite gate (T073) runs everything once at the end.

### Parallel Opportunities

- T002 can run in parallel with T001 (independent shell checks).
- T004 (types) is parallel-safe with the migration T003.
- T005/T007/T009/T011/T013 (test-first specs across permissions/validators/audit-diff/summary) can all be authored in parallel — different files, no dependencies.
- T015 (supply catalog) is independent of every other foundational task except needing the schema (T003) for `supply_types`.
- US1/US2/US3 are SEQUENTIAL within the priority block (same file `pay-deductions-section.client.tsx`) but US4/US5/US6/US7/US8 can run in parallel after Foundational.
- US6's `<DangerZone>` creation (T053) is parallel with the panel restructure (T054).
- US8's mobile sheet component (T063) is parallel with the FAB component (T064).
- Polish tasks T068/T069/T070/T073 can run in parallel (different files).

---

## Parallel Example: After Foundational completes

```bash
# Owner kicks off P1 sequentially (same file):
Task: "US1 Card-fee toggle in pay-deductions-section.client.tsx"
Task: "US2 Supply mode + per-type picker in pay-deductions-section.client.tsx"
Task: "US3 Summary + status badges in pay-deductions-section.client.tsx + status-badges.tsx"

# Then parallel team work on P2:
Task: "US4 Filter chips in roster-filter-chips.client.tsx + staff-table.client.tsx"
Task: "US5 Staff row redesign in staff-row.tsx + status-dot.tsx"
Task: "US6 Panel sectioning + danger zone in edit-panel.client.tsx + danger-zone.client.tsx"

# Then P3 (US8 after US7 for FAB linkage):
Task: "US7 Add-staff wizard sheet redesign in add-staff-wizard.client.tsx"
Task: "US8 Mobile bottom sheet + FAB in staff-mobile-sheet.client.tsx + staff-fab"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 — all P1)

The MVP is the per-staff exemption capability end-to-end. US1 alone (card-fee only) is technically shippable but misses the headline supply-mode capability the spec calls "the operator has been asking for" — the practical MVP is US1+US2+US3 in the existing flat panel layout.

1. Complete Phase 1: Setup (5 min — sanity checks).
2. Complete Phase 2: Foundational (CRITICAL — blocks every story).
3. Complete Phase 3: US1 (card-fee toggle).
4. Complete Phase 4: US2 (supply mode + picker).
5. Complete Phase 5: US3 (summary + badges).
6. **STOP and VALIDATE**: The feature is shippable here. Per-staff exemptions work; audit log is correct; the panel still uses the legacy flat layout (US6 hasn't landed yet) but operators can configure exemptions today.
7. Optionally deploy MVP, then continue with the redesign.

### Incremental Delivery (post-MVP)

1. Setup + Foundational → infrastructure ready.
2. US1 + US2 + US3 → MVP shippable (per-staff exemptions live).
3. US4 → filter chips live (roster usability improvement).
4. US5 → staff row redesign (visual language anchor for the panel).
5. US6 → panel sectioning + danger zone (the panel reads as a cohesive surface).
6. US7 → add-staff wizard sheet (polish).
7. US8 → mobile bottom sheet (operator-on-phone unlocked).
8. Polish (Phase 11) → side-by-side compare + full gate set + push.

### Parallel Team Strategy

With multiple developers post-Foundational:

- **Developer A**: P1 sequence (US1 → US2 → US3) — owns the panel-section feature.
- **Developer B**: US4 + US5 in parallel — owns the roster chrome.
- **Developer C**: US6 — owns the panel restructure (coordinates with A on header-badge placement).
- **Developer D**: US7 then US8 — owns the wizard + mobile surfaces.

---

## Notes

- `[P]` = parallelizable (different files, no incomplete-task deps).
- `[USn]` label maps each task to its user story for traceability + scoped Playwright runs (`-g "USn"`).
- Every user story phase ends with a scoped gate (prettier + eslint on diff + typecheck + test + scoped e2e) per CLAUDE.md "Scoping intermediate phase gates".
- The FINAL gate (T073) is full-suite per CLAUDE.md "Final gate" rule — `format:check && lint && typecheck && test && test:e2e`.
- TDD-with-failing-tests is MANDATORY for audit-diff (T011 → T012) and for the audit assertions in the US1/US2 e2e specs (T018, T024) per Constitution IV. Other Vitest specs (T005/T007/T009/T013) also land first per SC-007 traceability but are not strictly mandated by Constitution IV.
- Audit cursor pattern (`newAuditCursor()` / `getAuditLogRowsSince()` from `tests/e2e/_db.ts`) is required for any audit-row assertion under parallel Playwright workers — T072 is the explicit reminder.
- Migration 0018 ships in a single transaction; rollback is dropping the 3 columns + 2 triggers (manually if needed; the migration framework wraps each file in `BEGIN/COMMIT`).
- Settings tab bar + `/settings → /settings/staff` redirect are **already shipped** (research § R9) — no tasks for FR-025/FR-026.
- Avoid: rewriting `add-staff-wizard.client.tsx` from scratch (research § R8 — modify in place); JS-driven viewport detection (R5 — pure CSS); manual scroll lock (R6 — reuse Radix); separate per-field permission labels (R11 — one `update_pay_deductions` label).
