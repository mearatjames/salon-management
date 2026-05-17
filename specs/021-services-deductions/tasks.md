---

description: "Task list for 021-services-deductions"
---

# Tasks: Per-service deductions + two-pane services layout

**Input**: Design documents from `/specs/021-services-deductions/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Constitution IV mandates test-first for money/auth/refund/cash-drawer/tip-allocation/audit logic. This feature does not change any of those — deductions are catalog metadata in this phase, not a payment calculation. The audit diff is covered by an extension of an existing trusted payload shape, not a new verb. Still, this feature continues the test-first discipline 008 established for **pure helpers**: the four new validators (`validateCardFeeMode`, `validateCardFeeCustomDollars`, `validateSupplyAmountDollars`, `validateSupplyLabel`), the two new derivations (`effectiveCardFeeCents`, `computeNetToTechCents`), and the diff-key extension all get Vitest specs written before their implementations. The Playwright spec is sliced per-story and added incrementally so each user story phase ends with a green e2e for that story.

**Organization**: Phases follow plan.md § Project Structure. User stories run in priority order (US1 P1 → US2 P1 → US3 P1 → US4 P2 → US5 P2) and are independently testable per spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US5); omitted in Setup, Foundational, and Polish phases
- Every task lists exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm primitives, test directories, and CSS scaffold exist so every later phase composes without re-checking the basics.

- [ ] T001 [P] Confirm `tests/unit/services/` exists (created in 008 Phase 1) and is picked up by the Vitest glob. If absent, create the empty directory so the new test files in Phase 2 land where the runner expects them.
- [ ] T002 [P] Confirm the shadcn primitives this feature uses are present: `components/ui/switch.tsx`, `components/ui/dialog.tsx`, `components/ui/radio-group.tsx`, `components/ui/tooltip.tsx`. Switch + Dialog shipped in 008; vendor any missing ones via `npx shadcn@latest add <name>`. Do NOT edit generated files.
- [ ] T003 [P] Append a labelled comment block to `styles/settings.css` reserving the section names this feature appends to: `/* === 021-services-deductions === */` followed by section header comments for `.services-two-pane`, `.services-edit-panel`, `.deductions-section`, `.deduction-chip*`, `.segmented*`, `.net-to-tech`. Empty headers only — actual rules land in their respective story phases. Keeps the diff reviewable when each phase appends to the same file.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, regenerated types, the named-constant, pure helpers (tests-first), validator/type extensions, and the Server Action extension. **No user story work can begin until this phase is complete.**

### Database & generated types

- [ ] T004 Write `tests/unit/services/audit-diff-keys.test.ts` per `contracts/audit-payload.contract.md § 5`. Asserts (a) the `SERVICE_DIFF_KEYS` constant exported from `app/(studio)/services/actions.ts` contains exactly the 14 expected keys (10 from 008 + the 4 deduction keys), and (b) `buildChanges(before, after)` correctly emits deduction keys only when their before/after differ (no spurious entries for unchanged columns). Test will fail until T016 extends the constant. *(Note: `SERVICE_DIFF_KEYS` and `buildChanges` are not currently exported — T016 also adds the `export` keyword to both so this test can import them.)*
- [ ] T005 Write `supabase/migrations/0016_services_deductions.sql` per `contracts/db-migration.contract.md` and `data-model.md § 7`: idempotent `add column if not exists` for the four columns, then three `drop constraint if exists` + `add constraint` blocks for `services_card_fee_mode_chk`, `services_card_fee_custom_pair_chk`, `services_supply_pair_chk`. The `card_fee_mode` column carries `not null default 'default'` so existing rows backfill via the default — no separate `UPDATE` statement.
- [ ] T006 Run `supabase db reset` locally to apply 0016, then regenerate types: `npx supabase gen types typescript --local > lib/db/types.ts`. Confirm the four new fields appear with the documented nullability in `services.Row`, `services.Insert`, and `services.Update` (use the grep check in `quickstart.md § 2`).

### Named constant

- [ ] T007 [P] Create `lib/services/card-fee-default.ts` per `data-model.md § 2.4`: exports `DEFAULT_CARD_FEE_CENTS = 300` and `formatDefaultCardFeeLabel()` returning `"$3"` (Lacquer currency convention — whole dollars rendered without `.00`). Module must be importable from both client and server (no `"use server"` / `"use client"` directive).

### Pure helpers (tests-first)

- [ ] T008 [P] Extend `tests/unit/services/validation.test.ts` (the existing 008 file) with new `describe` blocks covering the four new validators per `data-model.md § 3`:
  - `validateCardFeeMode`: accepts `'default'` / `'custom'` / `'exempt'`; rejects `''`, `'DEFAULT'`, `'other'`, `'  custom  '` with `invalid_card_fee_mode`.
  - `validateCardFeeCustomDollars`: accepts `'0'`, `'0.00'`, `'4'`, `'4.5'`, `'4.50'`, `'50'`, `'50.00'` (returns correct cents); rejects `''`, `'-1'`, `'abc'`, `'4.501'` with `invalid_card_fee_custom`; rejects `'50.01'`, `'60'`, `'500'` with `card_fee_custom_too_large`.
  - `validateSupplyAmountDollars`: accepts `'0.01'`, `'5'`, `'5.00'`, `'50'`; rejects `''`, `'0'`, `'0.0'`, `'0.00'`, `'-1'`, `'abc'` with `invalid_supply_amount`; rejects `'50.01'`, `'60'`, `'500'` with `supply_amount_too_large`.
  - `validateSupplyLabel`: accepts `'A'`, `'GelX tips & gel'`, `'a' * 64`; rejects `''`, `'   '` with `invalid_supply_label`; rejects `'a' * 65` (and a 100-char value) with `supply_label_too_long`; returns the trimmed value on success. Tests will fail until T011 ships the implementations.
- [ ] T009 [P] Write `tests/unit/services/deductions.test.ts` covering `effectiveCardFeeCents` and `computeNetToTechCents` per `data-model.md § 2.3`:
  - `effectiveCardFeeCents`: returns `DEFAULT_CARD_FEE_CENTS` for `mode='default'`; returns the custom cents for `mode='custom'`; returns `0` for `mode='exempt'`; handles `mode='custom'` with `card_fee_custom_cents = null` by returning `0` (defensive).
  - `computeNetToTechCents`: classic case `{price: 5000, mode: 'default', custom: null, supply: 500}` → `{net: 4200, card_fee_cents: 300, supply_cents: 500}`; exempt case → `{net: price-supply, card_fee_cents: 0, supply_cents: ...}`; supply-off → `{net: price-card_fee, supply_cents: 0}`; custom case → uses custom cents; clamps to `0` when net would be negative (`price: 100, default, supply: 500` → `net: 0` with raw breakdown).
  - Tests will fail until T012 ships the implementations.

### Types, validators, derivations

- [ ] T010 [P] Extend `app/(studio)/services/_types.ts` per `data-model.md § 2.1`: add the `CardFeeMode` exported type and add the four new fields to `CatalogService` (`card_fee_mode: CardFeeMode`, `card_fee_custom_cents: number | null`, `supply_amount_cents: number | null`, `supply_label: string | null`). `ServiceDraftBaseline` picks the four fields up automatically since it extends `CatalogService`.
- [ ] T011 [P] Extend `app/(studio)/services/_validation.ts` per `data-model.md § 3`: append seven entries to `ValidationErrorCode` (`invalid_card_fee_mode`, `invalid_card_fee_custom`, `card_fee_custom_too_large`, `invalid_supply_amount`, `supply_amount_too_large`, `invalid_supply_label`, `supply_label_too_long`); implement the four new validators (`validateCardFeeMode`, `validateCardFeeCustomDollars`, `validateSupplyAmountDollars`, `validateSupplyLabel`) reusing the same string-padding cents conversion the existing `validateFixedPriceDollars` uses (no float math). Verify T008 now passes.
- [ ] T012 [P] Create `app/(studio)/services/_deductions.ts` implementing the two pure helpers per `data-model.md § 2.3`: `effectiveCardFeeCents` and `computeNetToTechCents`. Importable from both server (Server Action audit-payload builder) and client (panel preview). Verify T009 now passes.
- [ ] T013 [P] Extend `app/(studio)/services/_format.ts` with two new render helpers used by `deduction-chips.tsx` and the catalog row:
  - `formatCardFeeChipText(mode, customCents, defaultCents)` → `"$3 card fee"` for default, `"$X card fee"` for custom; throws or returns `null` for exempt (caller decides what to render).
  - `formatSupplyChipText(amountCents, label)` → `"${formatted} {label}"` (e.g. `"$5 GelX tips & gel"`). Both helpers use the existing dollar-formatting convention (whole dollars as `$5`, non-whole as `$4.50`).

### Page + load extensions

- [ ] T014 Extend `app/(studio)/services/_load.ts` so `loadServiceWithAssignments(roster, selectedAssignments, selectedId)` populates the four new fields on the returned `ServiceDraftBaseline`. (`_load` reads from the `roster` array, which after T015 includes the four new columns, so this is mostly a pass-through — make sure no field is dropped during projection.)
- [ ] T015 Extend `app/(studio)/services/page.tsx` so the catalog select string includes the four new columns and the `roster` mapping passes them through. Narrow `card_fee_mode` from raw `text` to `CardFeeMode` defensively (mirror the existing `narrowColorToken` pattern: known values pass through, unknown values fall back to `'default'`). Confirm the page still compiles after the type extension.

### Server Actions

- [ ] T016 Extend `app/(studio)/services/actions.ts` to support the four new fields end-to-end. Single coordinated edit:
  - Append the four new keys to `SERVICE_DIFF_KEYS` and the four new fields to `ServiceDiffSnapshot` per `data-model.md § 4` and `contracts/audit-payload.contract.md`. Add `export` to `SERVICE_DIFF_KEYS` and `buildChanges` (was previously file-private) so the test in T004 can import them.
  - In `addService`: parse `card_fee_mode`, `card_fee_custom` (conditional), `supply_on`, `supply_amount` and `supply_label` (conditional) per `contracts/server-actions.contract.md § 2`. Pass the four resolved values into the `INSERT` builder alongside the 008 fields. Echo the four fields in the audit payload.
  - In `updateService`: same parse logic in the try block; extend the `before` / `after` snapshots in the `service.updated` audit payload to include the four fields; the existing `buildChanges` loop naturally picks up the new keys via the extended constant. The patch builder (which currently narrows to only changed keys) requires no edit — the constant drives the loop.
  - Verify T004, T008, T009 all now pass.

### Toast vocabulary

- [ ] T017 [P] Extend `app/(studio)/services/toasts.ts` with the seven new error keys from `contracts/server-actions.contract.md § 3`: `invalid_card_fee_mode`, `invalid_card_fee_custom`, `card_fee_custom_too_large`, `invalid_supply_amount`, `supply_amount_too_large`, `invalid_supply_label`, `supply_label_too_long`. Each maps to a destructive Sonner with the documented copy. No new success-toast keys.

**Checkpoint**: Foundation ready. Schema applied, types regenerated, four validators + two derivations live, action extended, audit diff covers the new columns. User stories can begin in priority order.

---

## Phase 3: User Story 1 — Two-pane layout (Priority: P1) 🎯 MVP

**Goal**: Replace the drawer-overlay with an always-visible right-pane edit inspector. Every existing 008 add/edit/archive/restore flow continues to work; the operator can pick a service, edit fields, save, and switch between services without losing the list.

**Independent Test**: Without touching any deduction field, click each of five seeded rows; the right pane re-renders pre-filled for each; edit name + price + color, save, confirm the list row updates in place and a "Changes saved" toast appears; click "Add service" → fill out → save → confirm the panel flips to edit mode for the just-created service and the row appears in the right category.

### Implementation for User Story 1

- [ ] T018 [US1] Create `components/lacquer/services/edit-panel.client.tsx` per `contracts/ui.contract.md § 1–2`. Owns the panel state machine (mode = closed/add/edit), the discard-changes gate firing on row-switch and on Add-service click, and the empty-state render. Header: color swatch + name + secondary line `{category} · {duration} · {price}`; **no Close (X) affordance** (per Clarifications Q1). Footer: Save + Cancel + (edit-only) Archive button — wires into the existing `<ArchiveDialog>`. Renders `<ServiceForm>` (still authored as a client component) inside its scroll area. Imports `<DiscardChangesDialog>` unchanged from 008.
- [ ] T019 [US1] Edit `components/lacquer/services/service-form.client.tsx`: remove any drawer-specific layout assumptions (the form was authored to mount inside a sheet; now it mounts inside a card grid). Keep the existing field set and validation rules. Add an optional `inspectorChrome: boolean` prop (default `false` for backwards compat in case the file is still imported anywhere else) the panel can pass to toggle the form-internal padding; the panel itself owns the outer padding. Do NOT add the deductions section yet — that lands in Phase 4. Do NOT change the existing draft state shape yet — Phase 4 / 5 will extend it.
- [ ] T020 [US1] Edit `app/(studio)/services/page.tsx`: remove the `<Drawer>` import and JSX; import and mount `<EditPanel>` inside a `<div className="services-two-pane">` wrapper alongside `<CatalogList>`. The page's panel-mode resolver (`drawerMode` → `panelMode`) stays — same URL params (`?selected`, `?adding`), same baseline loading. Update the wrapper element's `className` and `data-slot` to reflect "two-pane" semantics. The page Server Component now owns the two-pane grid (CSS in T021).
- [ ] T021 [US1] Append the two-pane shell + empty-state CSS to `styles/settings.css` per `contracts/ui.contract.md § 1`: `.services-two-pane` (440px / 1fr grid, 18px gap, narrow-viewport fallback to single column at `<= 1023px`), `.services-edit-panel` (card surface + border + radius + shadow + padding tokens), `.services-edit-panel__header` (color swatch + name + secondary line layout), `.services-edit-panel__empty` (44px muted circle for the Info icon + centered copy), `.services-edit-panel__footer` (Save/Cancel right-aligned + Archive left-aligned). Every value resolves to a token.
- [ ] T022 [US1] Delete `components/lacquer/services/drawer.client.tsx`. After T020 removes the import, this file has no callers — delete completely per `research.md § R11`. (`git rm` the file; no archival copy.)
- [ ] T023 [US1] Create `tests/e2e/services-deductions.spec.ts` with the US1 describe block. Cases:
  - **two-pane shape**: opens `/services` → asserts left pane is visible with rows AND right pane shows the empty-state inspector. No `[role="dialog"]` is present; no `data-drawer-mode` attribute is in the DOM (the page now uses `data-panel-mode`).
  - **click row → panel pre-fills**: clicks each of two seeded rows in turn → asserts the right pane's name input takes the row's value within ~200ms and the Save button is disabled.
  - **edit + save**: types a new name into the panel → asserts Save enables → submits → asserts "Changes saved" toast + the list row text reflects the new name + the panel remains in edit mode.
  - **Add service**: clicks Add service → asserts panel switches to add mode with default values → submits → asserts the new row appears and the panel flips to edit mode for it.
  - **discard guard on row-switch**: makes a draft edit → clicks a different row → asserts the discard dialog appears, naming the current service. Clicks Cancel → asserts panel stays. Re-clicks the other row + Discard → asserts panel switches.
  - **discard guard on Add service**: makes a draft edit → clicks Add service → asserts discard dialog appears. Clicks Discard → asserts panel switches to add mode.
  - Wraps the spec in `test.describe("021-US1: two-pane layout", ...)` so the per-phase `-g "US1"` filter (CLAUDE.md § scoping) picks it up.

**Phase 3 verification**: Run scoped e2e for US1 only: `npx playwright test tests/e2e/services-deductions.spec.ts -g "US1"`. Also run scoped Prettier + ESLint per `CLAUDE.md § Scoping intermediate phase gates`: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` and `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`. Full typecheck + Vitest unit suite (`npm run typecheck && npm test`) — these stay full per scoping guidance.

**Checkpoint**: User Story 1 is fully functional. The two-pane layout is the structural prerequisite for US2/US3; subsequent phases land deductions *into* this panel.

---

## Phase 4: User Story 2 — Per-service card-fee mode (Priority: P1)

**Goal**: Every service can be set to Default · $3 / Custom · $X / Exempt for its card fee. The persisted choice surfaces as a blue chip on the catalog list row (or no chip for exempt) and as a Segmented control in the panel.

**Independent Test**: Open any active service → set Card fee to Custom + `$5` → save → confirm a blue `$5 card fee` chip on the list row and the saved value re-loads correctly. Switch the same service to Exempt → save → confirm the chip disappears. Switch back to Default → save → confirm `$3 card fee` chip returns. Try typing `60` into the custom amount → confirm inline cap hint and Save disabled.

### Implementation for User Story 2

- [ ] T024 [P] [US2] Create `components/lacquer/services/deduction-chips.tsx` (server component) per `contracts/ui.contract.md § 4`. Initial implementation covers card-fee chip rendering only — the supply branch is added in US3 (T032). Pure render component: takes the four deduction fields + `DEFAULT_CARD_FEE_CENTS`; uses `formatCardFeeChipText` for the chip text; emits a single `<span data-kind="card-default">` or `<span data-kind="card-custom">` chip for `default` / `custom` modes; emits nothing for `exempt`. Wrap in a `<div role="group" aria-label="Deductions">` with `gap: 6px`.
- [ ] T025 [P] [US2] Append `.deduction-chip` base rule + `.deduction-chip--card-default` + `.deduction-chip--card-custom` variant rules to `styles/settings.css` per `contracts/ui.contract.md § 4.2`. Token-only — if no existing token matches the prototype's `oklch(0.45 0.13 240)` text color, audit `styles/tokens.css` for an `--info-foreground` / `--info-700` analogue and add the missing token by copying the corresponding line from `design-system/colors_and_type.css` (NOT a raw hex). The blue chip background uses `color-mix(in oklch, var(--info) 12%, transparent)` — `color-mix` is permitted because the input colors are tokens.
- [ ] T026 [US2] Edit `components/lacquer/services/catalog-row.tsx` to render `<DeductionChips>` in the row's right-hand band, immediately before the duration + price tokens. Pass the four deduction fields + `DEFAULT_CARD_FEE_CENTS`. The duration / price tokens keep their existing positions; the chips appear with a 6px gap to their right. This is a server component edit only — no client island change.
- [ ] T027 [US2] Create `components/lacquer/services/deductions-section.client.tsx` with the card-fee row only (supply lands in US3, preview in US4). Renders:
  - The "Card fee" heading + "when paid by card or gift card" muted hint.
  - A `<Segmented>` (internally a shadcn `RadioGroup` styled into the prototype's pill shape) with three options: `Default · ${formatDefaultCardFeeLabel()}`, `Custom`, `Exempt`. Active value matches `draft.card_fee_mode`.
  - When mode = `'custom'`: a `$`-prefixed amount input wired to `draft.card_fee_custom_dollars`; format-on-blur to two decimals; inline hints for empty / >$50 per `contracts/ui.contract.md § 3.1`.
  - When mode = `'exempt'`: the muted one-line explainer "Card fee never applies, regardless of payment method."
  - Hidden FormData inputs for `card_fee_mode` and (conditionally) `card_fee_custom` so the form submits the right keys. Use the same `<input type="hidden">` pattern the staff-assignment list used in 008.
  - Accepts a `disabled` prop (defaults `false`) — US5 wires this to `!canWriteCatalog(operatorRole)`.
- [ ] T028 [US2] Append `.deductions-section` (the bordered card surface inside the form) + `.segmented` + `.segmented__option` + `.segmented__option--active` + `.deductions-card-fee-row` CSS rules to `styles/settings.css` per `contracts/ui.contract.md § 3`. Selected-pill shadow uses `var(--shadow-xs)`; segmented background uses `var(--muted)`; option background flips between `transparent` and `var(--card)` on active. Token-only.
- [ ] T029 [US2] Edit `components/lacquer/services/service-form.client.tsx` per `data-model.md § 2.2`:
  - Extend `ServiceDraft` with `card_fee_mode: CardFeeMode` and `card_fee_custom_dollars: string` (the on-save-only clearing rule from FR-014 means the draft buffer keeps the typed dollars across mode flips — the value is preserved client-side and ignored server-side when mode != custom).
  - Extend `makeDefaultDraft()` to seed `card_fee_mode: 'default'` and `card_fee_custom_dollars: ''`.
  - Extend `makeDraftFromBaseline(baseline)` to populate the two fields from the baseline (when mode = 'custom', stringify the cents back to dollars: `String((baseline.card_fee_custom_cents ?? 0) / 100)`).
  - Extend `hasFormErrors(draft)` to fail when mode = custom AND `card_fee_custom_dollars` is empty / non-numeric / > 50.
  - Update the dirty-detector in `<EditPanel>` to compare the two new draft fields against the baseline (a mode flip alone is dirty; a typed custom value with mode != custom is NOT dirty per the "ignore stored buffer when mode mismatches" rule — compare only `mode` and, when mode = custom, the parsed cents).
  - Mount `<DeductionsSection>` (from T027) inside the form's vertical stack, immediately after the Color field and before the (already-deferred) staff assignments section.
- [ ] T030 [US2] Add US2 cases to `tests/e2e/services-deductions.spec.ts`:
  - **Default chip on existing service**: asserts a seeded service that pre-dates 021 shows a `$3 card fee` blue chip on its row.
  - **Default → Custom round-trip**: opens a service → clicks Custom → types `4.50` → saves → asserts list row shows `$4.50 card fee` chip + re-opening the panel renders the saved value in the input.
  - **Custom → Exempt**: opens the same service → clicks Exempt → asserts the custom input disappears → saves → asserts no card-fee chip on the row (the muted "No fees" chip appears in US3; here we only assert "no blue chip").
  - **Exempt → Default**: clicks Default → saves → asserts `$3 card fee` chip returns + the persisted `card_fee_custom_cents` is null (queryable via the e2e DB helper).
  - **Cap rejection**: types `60` → asserts inline hint "Card fee can't exceed $50." appears and Save stays disabled.
  - **Empty rejection in custom mode**: clears the custom input → asserts Save stays disabled.
  - **Zero is allowed**: types `0` → asserts Save enables and persists `card_fee_custom_cents = 0`.
  - Wraps in `test.describe("021-US2: card-fee mode", ...)`.

**Phase 4 verification**: Scoped e2e: `npx playwright test tests/e2e/services-deductions.spec.ts -g "US2"`. Scoped Prettier + ESLint per `CLAUDE.md § Scoping`. Full `npm run typecheck && npm test`.

**Checkpoint**: User Stories 1 + 2 work independently.

---

## Phase 5: User Story 3 — Per-service supply deduction (Priority: P1)

**Goal**: Every service can optionally carry a supply deduction (cents + free-text label). The persisted choice surfaces as an amber chip on the list row and as a toggle + two inputs in the panel's Deductions section.

**Independent Test**: Open any service → flip Supply on → keep the seeded `$5.00` → type `GelX tips & gel` in the label → save → confirm amber `$5 GelX tips & gel` chip on the row and the saved values re-load correctly. Flip Supply off → save → confirm the chip disappears and re-opening shows toggle off with no amount / label.

### Implementation for User Story 3

- [ ] T031 [US3] Extend `components/lacquer/services/deductions-section.client.tsx` with the Supply row per `contracts/ui.contract.md § 3.2`. Renders:
  - "Supply deduction" heading + "any payment method" muted hint + a right-aligned `Switch` wired to `draft.supply_on`.
  - When toggle on: a two-column grid (`100px 1fr`) with `$`-prefixed amount input + label input. Placeholder for label: `"e.g. GelX tips & gel, Chrome powder, OPI bottle wear"`. On toggle-off → on, pre-fill `draft.supply_amount_dollars = '5.00'` only if currently empty (so re-toggling on after a typed value preserves it per FR-021) and move focus to the label input.
  - Inline validation hints per `contracts/ui.contract.md § 3.2`: amount empty/zero/negative → "Enter a positive amount up to $50, or turn Supply off."; amount > $50 → "Supply can't exceed $50."; label empty → "Add a short label so staff know what this covers, or turn Supply off."; label > 64 → "Label must be 64 characters or fewer."
  - Live character counter on the label when length is within 8 chars of the 64 limit.
  - Hidden FormData inputs for `supply_on`, `supply_amount`, `supply_label`. When toggle is off, render only `supply_on=""` (absent value); when on, render all three.
  - Honors the `disabled` prop (US5 wires it).
- [ ] T032 [US3] Extend `components/lacquer/services/deduction-chips.tsx` with the supply chip branch + combined / exempt-no-fees behavior per `contracts/ui.contract.md § 4.1`:
  - When `supply_amount_cents` is present → emit a `<span data-kind="supply">` chip after the card-fee chip (if any).
  - When `card_fee_mode = 'exempt'` AND no supply → emit a single `<span data-kind="exempt-no-fees">` muted chip reading "No fees".
  - When `card_fee_mode = 'exempt'` AND supply present → emit ONLY the supply chip (no card-fee chip, no "No fees" chip).
  - All chips remain inside the `<div role="group">` wrapper.
- [ ] T033 [US3] Extend `components/lacquer/services/service-form.client.tsx` per `data-model.md § 2.2`:
  - Extend `ServiceDraft` with `supply_on: boolean`, `supply_amount_dollars: string`, `supply_label: string`.
  - Extend `makeDefaultDraft()` to seed `{ supply_on: false, supply_amount_dollars: '', supply_label: '' }`.
  - Extend `makeDraftFromBaseline(baseline)` to populate from the baseline (supply_on derived from `baseline.supply_amount_cents !== null`; dollars/label populated when on).
  - Extend `hasFormErrors(draft)` to fail when `supply_on` is true AND (amount empty / non-numeric / 0 / > 50, OR label empty after trim / > 64 chars).
  - Update the dirty-detector to compare the three supply fields appropriately (a toggle flip is dirty; typed values when toggle is off are NOT dirty per the same buffer rule as card-fee).
- [ ] T034 [US3] Append the supply chip + exempt-no-fees chip CSS to `styles/settings.css`: `.deduction-chip--supply` (amber background via `color-mix(in oklch, var(--amber-500) 16%, transparent)`, amber-700 text color via a Lacquer token — add if missing per the T025 pattern), `.deduction-chip--exempt-no-fees` (background `var(--secondary)`, text `var(--muted-foreground)`). Append the supply-row CSS: `.deductions-supply-row` (`grid-template-columns: 100px 1fr` for the input pair) and `.deductions-supply-row__char-count` for the 64-char counter helper.
- [ ] T035 [US3] Add US3 cases to `tests/e2e/services-deductions.spec.ts`:
  - **Default state of pre-existing service**: asserts a seeded service shows no supply chip and the panel renders Supply toggle off with inputs hidden.
  - **Toggle on + first-on defaults**: flips toggle → asserts amount input is pre-filled `5.00`, label input is empty + focused.
  - **Save with valid values**: types label `GelX tips & gel` → saves → asserts amber chip on row reads `$5 GelX tips & gel` (or whatever the seeded amount is) + persisted columns match (verify via the e2e DB helper).
  - **Toggle off clears columns**: flips toggle off → saves → asserts `supply_amount_cents` and `supply_label` are both null in the DB and the chip disappears.
  - **Buffer preservation on toggle**: types label `Test` → toggles off → toggles on → asserts label input value is still `Test` (FR-021 buffer behavior). Does NOT save — this is a client-side-only assertion.
  - **Amount empty rejection**: clears amount → asserts inline hint + Save disabled.
  - **Amount zero rejection**: types `0` → asserts inline hint + Save disabled.
  - **Amount over cap rejection**: types `60` → asserts cap hint + Save disabled.
  - **Label empty rejection**: clears label → asserts label hint + Save disabled.
  - **Label over 64 chars**: types 70-char string → asserts label hint + Save disabled.
  - **Char counter appears within 8 of limit**: types 57-char label → asserts counter visible reading `7 left` (or similar) per `contracts/ui.contract.md § 3.2`.
  - **Combined chips**: opens a service with custom card-fee + supply → asserts row renders blue chip first (`${X} card fee`) then amber chip (`${Y} {label}`).
  - **Exempt + supply**: opens a service with exempt + supply → asserts ONLY the amber chip on the row (no card-fee chip, no "No fees" chip).
  - **Exempt without supply**: opens an exempt-only service → asserts the muted "No fees" chip on the row.
  - Wraps in `test.describe("021-US3: supply deduction", ...)`.

**Phase 5 verification**: Scoped e2e: `npx playwright test tests/e2e/services-deductions.spec.ts -g "US3"`. Scoped Prettier + ESLint. Full `npm run typecheck && npm test`.

**Checkpoint**: User Stories 1 + 2 + 3 work independently.

---

## Phase 6: User Story 4 — Net to tech (card) preview (Priority: P2)

**Goal**: A live preview at the bottom of the Deductions section shows the operator the net the tech takes home after card fee and supply, recomputed locally on every keystroke.

**Independent Test**: Open a service with price `$50`, card-fee Default, Supply on with `$5`. Confirm preview reads `$42` with breakdown `$50 service / −$3 card fee / −$5 {label}`. Change price input to `$60` (no save) → preview updates to `$52` within ~100ms. Switch to Exempt → preview becomes `$55` and the card-fee line drops from the breakdown.

### Implementation for User Story 4

- [ ] T036 [US4] Extend `components/lacquer/services/deductions-section.client.tsx` with the Net-to-tech preview block per `contracts/ui.contract.md § 3.3`:
  - Below the supply row, separated by a 1px top border.
  - Calls `computeNetToTechCents(input)` (from T012) wrapped in `useMemo` over the draft's relevant fields: `price` (or `price_from` when `variable_price = true`), `card_fee_mode`, `card_fee_custom_dollars` (parsed), `supply_on`, `supply_amount_dollars` (parsed).
  - Renders the headline `NET TO TECH (CARD)` (uppercase, tracked, muted, 11px font), the amount in 22px tabular numerals via `font-variant-numeric: tabular-nums`, and the right-aligned breakdown lines (`{price} service`, `−{fee} card fee`, `−{amount} {label or 'supply'}`).
  - The card-fee breakdown line is omitted when `card_fee_mode = 'exempt'` (FR-027); the supply breakdown line is omitted when Supply is off (FR-027); the "{price} service" line is always shown.
  - When the inputs produce a negative net, displays `$0` and still shows the raw breakdown lines.
  - Pure presentation — preview never writes to the DB and is never disabled by the role gate (read-only by nature; FR-029).
- [ ] T037 [US4] Append `.deductions-net-to-tech` (the bordered block) + `.deductions-net-to-tech__headline` + `.deductions-net-to-tech__amount` + `.deductions-net-to-tech__breakdown` + `.deductions-net-to-tech__breakdown-line` + `.deductions-net-to-tech__breakdown-line--card-fee` + `.deductions-net-to-tech__breakdown-line--supply` CSS rules to `styles/settings.css` per `contracts/ui.contract.md § 3.3`. The card-fee line color uses the existing `--info-foreground` / `--info-700` token added in T025; the supply line uses the amber token added in T034. Tabular numerals enforced on both the amount and the breakdown.
- [ ] T038 [US4] Add US4 cases to `tests/e2e/services-deductions.spec.ts`:
  - **Classic case**: opens service with `$50`, default, supply `$5 chrome` → asserts preview reads `$42` and breakdown lines render in order: `$50 service`, `−$3 card fee`, `−$5 chrome`.
  - **Live price keystroke**: types `60` into price → waits ≤200ms → asserts preview reads `$52` (no Save click required).
  - **Switch to exempt**: clicks Exempt → asserts preview becomes `$55` AND the card-fee breakdown line is no longer present in the DOM.
  - **Toggle supply off**: flips off → asserts preview becomes `$60` AND the supply breakdown line is no longer present.
  - **Variable-price service**: opens a variable-price service with `price_from = 30` → asserts preview uses 30 (not the empty `price` field) per FR-026.
  - **Negative clamp**: types price `0` with default + supply $5 → asserts preview displays `$0` and the raw breakdown lines remain visible.
  - Wraps in `test.describe("021-US4: net-to-tech preview", ...)`.

**Phase 6 verification**: Scoped e2e: `npx playwright test tests/e2e/services-deductions.spec.ts -g "US4"`. Scoped Prettier + ESLint. Full `npm run typecheck && npm test`.

**Checkpoint**: User Stories 1 + 2 + 3 + 4 work independently.

---

## Phase 7: User Story 5 — Role-gated edits + audit trail (Priority: P2)

**Goal**: Only owners + managers can mutate the deduction columns. Non-privileged operators see the chips on every row but the Segmented control, the Supply toggle, the amount + label inputs, and the Save button are disabled with the existing tooltip. Every successful deduction edit writes an `audit_log` row with the changed fields in the payload diff.

**Independent Test**: Log in as a technician → navigate to `/services` → confirm chips render on every list row. Open the panel for a service → confirm Segmented control, Supply toggle, both inputs, and Save button are all disabled with tooltip "Only owners and managers can edit the catalog." Net-to-tech preview still renders. Switch to a manager → confirm every control is interactive. Mutate a deduction → query `audit_log` → confirm a row exists with `action = 'service.updated'`, `entity_type = 'service'`, and a `payload.changes` map listing the changed deduction fields with before/after values.

### Implementation for User Story 5

- [ ] T039 [US5] Thread the `operatorRole` prop through the panel and form so the deductions controls disable consistently with the existing 008 fields:
  - `app/(studio)/services/page.tsx` already passes `viewer.staff.role` to `<EditPanel>` (formerly `<Drawer>`). Confirm the prop name + shape match.
  - `components/lacquer/services/edit-panel.client.tsx` passes `operatorRole` into `<ServiceForm>`.
  - `components/lacquer/services/service-form.client.tsx` computes `canWrite = canWriteCatalog(operatorRole)` and passes `disabled={!canWrite}` to `<DeductionsSection>`. The Save button and the Archive button also flip to `disabled={!canWrite}` (already the case for the 008 fields; confirm coverage for the new state).
  - `components/lacquer/services/deductions-section.client.tsx` respects the `disabled` prop on the Segmented control (`aria-disabled` + pointer-events none + tabIndex -1 on each option), the custom amount input, the Supply toggle (`aria-disabled` + click no-op), and the supply amount + label inputs (`disabled={true}`). Wrap each disabled control in the existing `<OwnerOnlyTooltip>` (from 008's `service-form.client.tsx`) so the same "Only owners and managers can edit the catalog." copy appears on hover / focus.
  - The Net-to-tech preview continues to render regardless of role (read-only by nature).
- [ ] T040 [US5] Add US5 cases to `tests/e2e/services-deductions.spec.ts` (uses the existing `loginAsTechnician` / `loginAsManager` helpers from prior specs; if those helpers don't exist, follow the staff-feature spec's PIN-session bootstrap pattern):
  - **Technician sees chips**: logs in as technician → navigates to `/services` → asserts every chip from US2/US3 renders on the rows (read works).
  - **Technician sees disabled controls**: opens the panel → asserts the Segmented control has `aria-disabled="true"`, the custom amount input is `disabled`, the Supply toggle is `aria-disabled="true"`, the supply inputs (if rendered) are `disabled`, and the Save button is `disabled`. Hovers each → asserts tooltip "Only owners and managers can edit the catalog." appears.
  - **Net preview still renders for technician**: asserts the preview amount + breakdown are present (read-only).
  - **Manager full interactivity**: logs in as manager → confirms every control is interactive (no `disabled` / `aria-disabled` attributes).
  - **Mutation writes audit row**: uses the existing `newAuditCursor()` + `getAuditLogRowsSince()` helpers from `tests/e2e/_db.ts` (per CLAUDE.md § "Audit-log assertions are cursor-scoped per-test"). Manager flips supply on with `$5 chrome` → saves → asserts an `audit_log` row exists with `action='service.updated'`, `entity_type='service'`, and `payload.changes` containing the four expected keys (`supply_amount_cents`, `supply_label`) with `[null, 500]` / `[null, 'chrome']` pairs and the before/after snapshots include the four deduction fields.
  - **Direct FormData POST as technician is rejected**: a technician session POSTs directly to the `updateService` Server Action with deduction values → asserts the response is the page redirect with `?error=forbidden` AND no audit row was written for that service in the test's audit cursor window. (Uses the same direct-POST helper the staff feature spec uses, or a fetch with manually-crafted form-encoded body.)
  - **Deduction-only edit produces minimal diff**: manager changes ONLY the supply amount (not the label, not the card-fee mode) → saves → asserts the `payload.changes` map contains exactly `supply_amount_cents: [before, after]` and no other key (verifying FR-030 "deduction fields appear in the payload only when they actually changed").
  - **Non-deduction-only edit produces no spurious deduction diff**: manager changes ONLY the price → saves → asserts `payload.changes` contains ONLY `price_cents: [before, after]` (no deduction keys at all). Verifies that the four new keys don't appear gratuitously.
  - Wraps in `test.describe("021-US5: role gating + audit", ...)`.

**Phase 7 verification**: Scoped e2e: `npx playwright test tests/e2e/services-deductions.spec.ts -g "US5"`. Scoped Prettier + ESLint. Full `npm run typecheck && npm test`.

**Checkpoint**: All five user stories work independently.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Visual fidelity + accessibility + the final full gate set. Per CLAUDE.md § "Skill-level optimizations", `/speckit-implement` will dispatch `speckit-design-auditor` automatically after phases that touched `components/` or `styles/`; this phase makes the dispatch explicit and runs the final pre-push gate.

- [ ] T041 [P] Run `speckit-design-auditor` against the updated `/services` surface (the agent auto-fires on any UI-touching phase per CLAUDE.md, but a final pass after all five stories is the canonical gate). Address any token violations the auditor flags (most likely candidate: the chip text colors `oklch(0.45 0.13 240)` and `oklch(0.45 0.14 75)` in the prototype — confirm they resolve to existing Lacquer tokens or add the closest analogue per the T025 / T034 pattern). Re-run until the auditor reports zero violations.
- [ ] T042 [P] Manually verify the accessibility expectations in `contracts/ui.contract.md § 8`:
  - Segmented control: `role="radiogroup"`, each option `role="radio"`, `aria-checked` reflects active.
  - Supply toggle: `role="switch"` with `aria-checked`.
  - Inline validation hints connected via `aria-describedby`.
  - Disabled controls: `aria-disabled="true"` + descriptive `aria-label` so screen readers announce the reason.
  - Empty-state inspector: `role="region"` with `aria-labelledby` on the headline.
  - Focus management: after clicking a row, focus does NOT jump to the panel (avoids disorienting keyboard users); after flipping Supply on, focus DOES move to the label input (FR-018).
- [ ] T043 Run `quickstart.md § 5` manually in the browser for US1–US5 against `npm run dev`. Capture any UI nits (spacing, alignment, focus, color drift) in a punch list and address before the final gate.
- [ ] T044 **Final gate** — full pre-push suite per CLAUDE.md § "Pre-push quality gates":
  ```bash
  npm run format:check && \
  npm run lint && \
  npm run typecheck && \
  npm test && \
  npm run test:e2e
  ```
  All five MUST be green locally before opening the PR. If `test:e2e` flakes under parallel workers, retry with `PLAYWRIGHT_PROD=1 npm run test:e2e` (the prebuilt server matches CI more closely).
- [ ] T045 Confirm `CLAUDE.md` § SPECKIT block points at `specs/021-services-deductions/plan.md` (already updated in `/speckit-plan` — this task is just the safety check). If the marker drifted, fix and re-stage.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS** all user stories. Inside Phase 2: the migration + regen-types (T005 → T006) gate everything else; the named constant (T007), the validator tests + impls (T008 + T011), the deductions-helper test + impl (T009 + T012), the format helpers (T013), and the type extensions (T010) can run in parallel; the page + load edits (T014 + T015) follow T010; the Server Action extension (T016) depends on T004, T008, T009, T010, T011, T012; toasts (T017) is parallel-safe.
- **User Stories (Phases 3–7)**: All depend on Foundational. Must run sequentially in priority order because they share `service-form.client.tsx`, `deductions-section.client.tsx`, `deduction-chips.tsx`, `styles/settings.css`, and `tests/e2e/services-deductions.spec.ts` — each story extends what the prior one shipped. The UI surface they share is what makes them order-dependent; the data layer was completed in Phase 2 so each story still demonstrates value end-to-end.
- **Polish (Phase 8)**: Depends on every preceding story phase being complete.

### Within Each User Story

- Tests (where they exist as separate tasks) MUST be written FIRST per Constitution IV (the Vitest specs for pure helpers in Phase 2 already follow this discipline; Playwright cases land alongside the implementation tasks in each story phase).
- Inside each story phase, smaller-blast-radius edits (CSS, server components) run before client-island edits (which trigger React re-mounts).
- Story complete before moving to the next priority.

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel.
- All Foundational tasks marked [P] can run in parallel WITHIN their dependency sub-graph (see above).
- Different user stories CANNOT run in parallel — they share files (see above).
- Polish T041, T042 marked [P] can run in parallel; T043 / T044 / T045 are sequential.

---

## Parallel Example: Phase 2 (Foundational)

After T005 (migration) + T006 (regen types) complete:

```bash
# Launch in parallel — independent files / no shared state:
Task: "Create lib/services/card-fee-default.ts (T007)"
Task: "Extend tests/unit/services/validation.test.ts with the 4 new validator cases (T008)"
Task: "Write tests/unit/services/deductions.test.ts (T009)"
Task: "Extend app/(studio)/services/_types.ts with CardFeeMode + 4 new fields (T010)"
Task: "Extend app/(studio)/services/_validation.ts with the 4 new validators (T011)"
Task: "Create app/(studio)/services/_deductions.ts pure helpers (T012)"
Task: "Extend app/(studio)/services/_format.ts with chip-text helpers (T013)"
Task: "Extend app/(studio)/services/toasts.ts with the 7 new error keys (T017)"
```

After T010 completes, T014 + T015 (page + load edits) follow. After T011 + T012 are green and T010 done, T016 (the Server Action extension) integrates them.

---

## Parallel Example: Phase 4 (US2)

Inside the US2 phase, two independent server-side concerns can land in parallel before the panel-side wiring:

```bash
# T024 (chips component) and T025 (chip CSS) are independent of T027 (deductions section) and T028 (section CSS).
Task: "Create components/lacquer/services/deduction-chips.tsx (T024)"
Task: "Append .deduction-chip CSS to styles/settings.css (T025)"
```

T026 (catalog-row edit) depends on T024. T029 (service-form extension) depends on T027 + T028. T030 (e2e cases) is last.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (the whole phase — the migration + Server Action extension are pre-conditions for any user-facing deduction work, but US1 itself is purely the layout swap and would technically run on top of just T001–T003 + T018–T023. Phase 2 is included in the MVP so the layout swap also brings the chips along — operators wouldn't accept a deductions-aware panel with no chip on the row.)
3. Complete Phase 3: User Story 1 (two-pane layout)
4. **STOP and VALIDATE**: e2e covers US1; manually walk through US1's Independent Test.
5. Deploy / demo if ready — the salon gets the new layout with stub chips ("$3 card fee" on every row from the column default) and a non-functional Deductions section in the panel (the deductions section file doesn't exist yet, so the panel shows just the 008 fields).

The honest MVP would also include US2 because without it the panel still has no deductions section at all — the chips on the row would imply functionality that's missing. Pragmatically, **deploy after US2 (P1)**, with US3 (P1) following close behind as the second P1 story.

### Incremental Delivery

1. Setup + Foundational + US1 → two-pane layout shipped (no functional deductions, stub chips).
2. + US2 → card-fee mode editable; blue chips reflect saved values.
3. + US3 → supply deduction editable; amber chips + combined chip behavior.
4. + US4 → live Net-to-tech preview (no data shape change; pure UI).
5. + US5 → role gating + audit assertions tightened.
6. Polish → design audit + final gate → PR.

### Parallel Team Strategy

This feature does NOT lend itself well to multi-developer parallel work because every user story phase shares the deductions section and the e2e spec. With multiple developers:

1. Team completes Setup + Foundational together (T007–T013 split [P]).
2. One developer owns the deductions UI thread sequentially (US1 → US2 → US3 → US4 → US5).
3. A second developer can do Polish T041 + T042 audits in parallel with the US5 work.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps task to specific user story for traceability.
- Each user story should be independently testable per spec.md, even though they share files and must be implemented sequentially.
- Verify pure-helper tests fail before implementing those helpers (Phase 2).
- Commit after each task or logical group; the `after_implement` hook auto-commits per `.specify/extensions.yml`.
- Stop at any phase checkpoint to validate story independently per CLAUDE.md § "Scoping intermediate phase gates".
- Per CLAUDE.md § "Pre-push quality gates", the final full gate set is run at T044 — intermediate gates are scoped per-story (`-g "USn"` for e2e; `git diff --name-only` for Prettier / ESLint; full Vitest + typecheck).
- Avoid: skipping the design-auditor pass, leaving raw hex / off-scale spacing in `styles/settings.css`, breaking 008's existing behaviors when extending `service-form.client.tsx` or `actions.ts`.
