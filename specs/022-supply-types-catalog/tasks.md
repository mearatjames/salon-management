---

description: "Task list for 022-supply-types-catalog"
---

# Tasks: Supply types catalog + Services refactor

**Input**: Design documents from `/specs/022-supply-types-catalog/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Constitution IV mandates test-first for money/auth/refund/cash-drawer/tip-allocation/**audit** logic. This feature touches **audit logic** (four new `supply_type.*` verbs + the migration's seeded audit rows), so audit assertions in the Playwright spec are scaffolded with failing-first expectations before their implementing tasks land. Pure helpers (`canonicalizeName`, `validateSupplyTypeName`, `validateSupplyTypeId`, and the diff-key swap) follow the same test-first discipline 008/021 established for validators. The Playwright spec is sliced per-story and added incrementally so each user-story phase ends with a green e2e for that story.

**Organization**: Phases follow plan.md § Project Structure. User stories run in priority order (US1 P1 → US5 P1 → US2 P1 → US3 P2 → US4 P2) and are independently testable per spec.md. US5 (post-migration display invariant) is sequenced after US1 because the picker's behavior is the surface that proves SC-001 (services display the right name post-migration); the migration itself ships in Phase 2 Foundational so US5 verifies it through both DB queries and the picker's render.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1–US5); omitted in Setup, Foundational, and Polish phases
- Every task lists exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm primitives, test directories, and CSS scaffold exist so every later phase composes without re-checking the basics.

- [ ] T001 [P] Confirm `tests/unit/policy/` does not yet exist; create it as an empty directory so the new Vitest specs in Phase 2 (T010–T012) land where the Vitest glob expects them. Confirm `tests/unit/services/` already exists from 008/021.
- [ ] T002 [P] Confirm the shadcn primitives this feature uses are present in `components/ui/`: `popover.tsx`, `command.tsx`, `sheet.tsx`, `switch.tsx`, `tooltip.tsx`, `button.tsx`, `input.tsx`. Any missing primitive: vendor via `npx shadcn@latest add <name>`. Do NOT edit generated files; they're managed by the shadcn CLI.
- [ ] T003 [P] Append a labelled comment block to `styles/settings.css` reserving the section names this feature appends to: `/* === 022-supply-types-catalog === */` followed by section header comments for `.supply-type-picker*`, `.edit-policy-sheet*`, `.supply-types-section*`, `.supply-types-row*`. Empty headers only — actual rules land in their respective story phases.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Audit-log helper extensions, the migration + regenerated types, pure helpers (tests-first), validator + type extensions, catalog read helper, the Server Action FormData/validator swap, and toast key additions. **No user-story work can begin until this phase is complete.**

### Audit log helper

- [ ] T004 Extend `AuditAction` union in `lib/auth/audit.ts` with four new verbs: `"supply_type.created"`, `"supply_type.renamed"`, `"supply_type.archived"`, `"supply_type.reactivated"`. Add the prefix branch `if (action.startsWith("supply_type.")) return "supply_type";` to `deriveEntityType`, placed before the `service.` branch. Widen the return type of `deriveEntityType` to include `"supply_type"`. No schema change to `audit_log` (per research § R3).

### Database & generated types

- [ ] T005 Write `tests/unit/services/audit-diff-keys.test.ts` extension per `contracts/audit-payload.contract.md § 5`. Asserts (a) `SERVICE_DIFF_KEYS` no longer contains `"supply_label"`, (b) it contains `"supply_type_id"`, (c) `buildChanges({…, supply_type_id: 'A'}, {…, supply_type_id: 'B'})` emits a `supply_type_id` entry with `before: 'A'` and `after: 'B'`. Test will fail until T015 swaps the constant.
- [ ] T006 Write `supabase/migrations/0017_supply_types_catalog.sql` per `contracts/db-migration.contract.md` (canonical step order in § 6). The file MUST include: table create + constraints + indexes + trigger + RLS (steps 1–6), `alter table services add column supply_type_id …` (step 7), backfill INSERT + UPDATE (steps 8–9), audit-log INSERT (`contracts/db-migration.contract.md § 4` — MUST run before step 12), CHECK swap (steps 10–11), `drop column services.supply_label` (step 12). Idempotent throughout (`if exists` / `if not exists` / `on conflict do nothing` / `not exists` guards).
- [ ] T007 Run `supabase db reset` locally to apply 0017, then regenerate types: `npx supabase gen types typescript --local > lib/db/types.ts`. Confirm `services.Row` no longer has `supply_label`, gains `supply_type_id: string | null`, and the new `supply_types` table appears (Row / Insert / Update with `id, name, name_canonical, archived, created_at, updated_at`).

### Pure helpers (tests-first)

- [ ] T008 [P] Create `lib/policy/canonicalize-name.ts` per `data-model.md § 3.3`: exports `canonicalizeName(s: string): string` returning `s.trim().toLowerCase().replace(/\s+/g, ' ')`. Module is plain TS — no `"use server"` / `"use client"` directive — so it can be imported from both the migration backfill's TS-side reference (in the Playwright spec's seed assertions) AND the picker's client island AND the server actions.
- [ ] T009 [P] Write `tests/unit/policy/canonicalize-name.test.ts` covering the helper from T008: `canonicalizeName('GelX tips & gel') === 'gelx tips & gel'`; `canonicalizeName('  GelX  tips  &  gel  ') === 'gelx tips & gel'` (trim + internal collapse); `canonicalizeName('CAFÉ') === 'café'` (free Unicode); `canonicalizeName('A') === 'a'` (single char, edge); `canonicalizeName('') === ''` (empty, edge). Tests will fail if T008 deviates from the spec.
- [ ] T010 [P] Write `tests/unit/policy/validation.test.ts` covering the new validators per `contracts/server-actions.contract.md § 1, 2`:
  - `validateSupplyTypeName`: accepts `'GelX'`, `'GelX tips'`, `'AB'`, `'a'.repeat(64)`; trims + collapses internal whitespace (input `'  GelX  tips  '` → returns `'GelX tips'`); rejects `''`, `' '`, `'A'` (post-trim < 2) with `name_too_short`; rejects `'a'.repeat(65)` with `name_too_long`.
  - `validateSupplyTypeId`: accepts loose UUID shapes `'10000000-0000-0000-0000-000000000001'` and any valid `8-4-4-4-12` hex; rejects `''`, `'abc'`, `'10000000-0000-0000-0000'` with `invalid_supply_type`.
  Tests will fail until T011 + T013 ship the implementations.

### Validators

- [ ] T011 Create `app/(studio)/settings/policy/_validation.ts` per `data-model.md § 3.2`: defines `SupplyTypeValidationErrorCode` union (`name_too_short`, `name_too_long`, `name_taken`, `type_not_found`, `type_in_use`, `type_already_active`, `type_already_archived`, `type_archived`); exports `ValidationError` class (or re-exports the existing one from `app/(studio)/services/_validation.ts`); exports `validateSupplyTypeName(input: string): string` (trim, collapse, [2, 64]). The `name_taken` code is NOT thrown by this validator — it surfaces from PG `23505` mapping inside the actions (per `contracts/server-actions.contract.md § 1`).
- [ ] T012 Create `app/(studio)/settings/policy/permissions.ts`: re-export `assertCanWriteCatalog` and `PermissionError` from `app/(studio)/services/permissions.ts` (no duplication of policy). Used by the four new catalog actions in T020–T023.
- [ ] T013 Edit `app/(studio)/services/_validation.ts`: REMOVE `validateSupplyLabel`, the `invalid_supply_label` and `supply_label_too_long` codes from the union, and the `SUPPLY_LABEL_MAX_LEN` constant. ADD `validateSupplyTypeId(input: string): string` (UUID-loose shape, mirroring the existing `UUID_SHAPE_LOOSE` in `actions.ts`) and the `invalid_supply_type` code. Update the existing unit-test file `tests/unit/services/validation.test.ts` to drop the deleted-validator cases (the new cases live in T010's policy/validation.test.ts since the validator's home is in services).
- [ ] T014 Edit `app/(studio)/services/_types.ts`: replace the `supply_label: string | null` field on `CatalogService` with `supply_type_id: string | null` AND `supply_type_name: string | null` (the latter is the LEFT-JOIN-resolved name from R5; read-only — never serialized back to the server). Add `SupplyTypeLite` exported type `{ id: string; name: string; archived: boolean }` for use by the picker prop and the section loader.

### Audit diff key swap

- [ ] T015 Edit `app/(studio)/services/_audit-diff.ts`: swap `"supply_label"` → `"supply_type_id"` in `SERVICE_DIFF_KEYS`; swap the corresponding field on `ServiceDiffSnapshot`. T005's test now passes.

### Catalog read helper

- [ ] T016 Create `app/(studio)/settings/policy/_load.ts` per `data-model.md § 2.2` and `research.md § R5`: exports `loadSupplyTypesCatalog(): Promise<SupplyTypesCatalog>` returning `{ active: SupplyTypeRow[], archived: SupplyTypeRow[] }`. Implementation: two parallel queries — `select id, name, archived from supply_types order by archived, name` and `select supply_type_id, services.id, services.name, services.color_token, services.supply_amount_cents from services where active = true and supply_type_id is not null order by services.name`. Fan-out at the JS layer to assemble each row's `usage_count` + `services` array. Active types and archived types are split into separate arrays; both sorted by `name` ascending.

### Services load helper

- [ ] T017 Edit `app/(studio)/services/_load.ts`: extend the catalog query and `loadServiceWithAssignments` to add `LEFT JOIN public.supply_types st ON st.id = services.supply_type_id` and project `st.name AS supply_type_name`. Update the projection's type assertion to match `CatalogService` from T014.

### Server actions — FormData / validator swap

- [ ] T018 Edit `app/(studio)/services/actions.ts` `addService`: REMOVE `supplyLabel` declaration + the `validateSupplyLabel` call. ADD `supplyTypeId: string | null` declaration + a `validateSupplyTypeId` call inside the `if (supplyOn)` branch. Replace the INSERT payload's `supply_label: supplyLabel!` with `supply_type_id: supplyTypeId!`. Replace the audit payload's `supply_label` key with `supply_type_id`. Add the defensive existence check per `contracts/server-actions.contract.md § 5`: between validation and INSERT, `select id from supply_types where id = $1`; if zero rows, `redirect(SERVICES_PATH + '?error=invalid_supply_type' + selectedSuffix)`.
- [ ] T019 Edit `app/(studio)/services/actions.ts` `updateService`: same swaps as T018 (validation, baseline-row projection, after-snapshot, UPDATE patch, audit payload, defensive existence check). The `baselineRow.supply_label` reference becomes `baselineRow.supply_type_id`. Same defensive-check pattern.

### Catalog mutation server actions

- [ ] T020 Create `app/(studio)/settings/policy/actions.ts` with two callable shapes per `contracts/server-actions.contract.md § 1`: (a) `createSupplyType(formData)` — form-based, redirects to `/services?policy=open&toast=supply_type_created&name=…` (used by the EditPolicySheet's "+ Add supply type" row); (b) `createSupplyTypeForPicker(prevState, formData)` — programmatic, returns `CreateResult` JSON (used by `<SupplyTypePicker>` via `useActionState`). Both go through a shared private helper `_createSupplyTypeImpl(name, viewer)` that does validation → service-role INSERT → `recordAudit('supply_type.created', …, { name })` → `revalidateSupplyTypeConsumers()`. Imports `requireStudioSession`, `createSupabaseServiceRoleClient`, `recordAudit`, `assertCanWriteCatalog`, `validateSupplyTypeName`, plus the `revalidateSupplyTypeConsumers` helper from T024. On PG `23505` from the partial unique index, both shapes map to `name_taken` (form path → `?error=name_taken`; programmatic path → `{ kind: 'error', code: 'name_taken' }`). No `return_to` switch and no `selected_service_id` param exist anymore — the picker handles selection locally via the programmatic return value.
- [ ] T021 Add `renameSupplyType` to `app/(studio)/settings/policy/actions.ts` per `contracts/server-actions.contract.md § 2`. Parses `supply_type_id`, `name`. Loads the baseline row (capturing `existingRow.name` + `archived`); rejects `type_not_found` / `type_archived` early. Computes `canonicalizeName(name) === canonicalizeName(existingRow.name)` → `no_changes` (redirect with `?error=no_changes` — no audit row written, per `contracts/audit-payload.contract.md § 2`). Updates `supply_types.name = name` via service-role; maps PG `23505` to `name_taken`. Awaits `recordAudit('supply_type.renamed', …, { before: { name: existingRow.name }, after: { name } })`. Redirects to `/services?policy=open&toast=supply_type_renamed`.
- [ ] T022 Add `archiveSupplyType` to `app/(studio)/settings/policy/actions.ts` per `contracts/server-actions.contract.md § 3`. Parses `supply_type_id`. Loads baseline (capture `name`, `archived`); rejects `type_not_found` / `type_already_archived` early. Pre-checks `select count(*) from services where supply_type_id = $1 and active = true` → if > 0, redirect `?error=type_in_use&blocked_count=<n>`. UPDATE `supply_types.archived = true`. Awaits `recordAudit('supply_type.archived', …, { name })`. Redirects to `/services?policy=open&toast=supply_type_archived&name=…`.
- [ ] T023 Add `reactivateSupplyType` to `app/(studio)/settings/policy/actions.ts` per `contracts/server-actions.contract.md § 4`. Parses `supply_type_id`. Loads baseline (capture `name`, `archived`); rejects `type_not_found` / `type_already_active` early. UPDATE `supply_types.archived = false`; maps PG `23505` (would trigger if the partial unique index would now collide with an active sibling) to `name_taken`. Awaits `recordAudit('supply_type.reactivated', …, { name })`. Redirects to `/services?policy=open&toast=supply_type_reactivated&name=…`.

### Revalidation helper

- [ ] T024 Add `revalidateSupplyTypeConsumers()` to `app/(studio)/settings/policy/actions.ts` (a private helper, NOT exported as a Server Action — so it's just a regular function inside the `"use server"` file; per Next 16 Server Actions rules every exported function in a `"use server"` file is a Server Action, so this helper is module-internal). Calls `revalidatePath('/services')` then `revalidatePath('/settings/staff')` per research § R6. Called from each of T020–T023 immediately before its `redirect`.

### Toast keys

- [ ] T025 Edit `app/(studio)/services/toasts.ts` per `contracts/server-actions.contract.md § 9`: add the four success keys (`supply_type_created`, `supply_type_renamed`, `supply_type_archived`, `supply_type_reactivated`) and the new error-code copy mappings (`name_too_short`, `name_too_long`, `name_taken`, `type_not_found`, `type_in_use`, `type_already_archived`, `type_already_active`, `type_archived`, `invalid_supply_type`). Mirror the existing `success` / `error` toast variants and the `${name}` interpolation pattern.

### Final foundational gate

- [ ] T026 Verification — run scoped gates per CLAUDE.md "Scoping intermediate phase gates": `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`, `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`, `npm run typecheck`, `npm test`. The Vitest run MUST be green (T005, T009, T010 pass; T013's edits remove deleted-validator cases). No e2e in this gate — Phase 3 ships the first US1 spec.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: US1 — Pick a supply type from a managed list (Priority: P1) 🎯 MVP

**Goal**: The operator picks supply types from a dropdown instead of typing free text; inline-create works in one click-to-confirm interaction.

**Independent Test**: Open `/services`, pick a service whose existing `supply_label` was backfilled. Confirm the Supply section shows the picker pre-populated with the migrated type. Open a different service, turn Supply on, pick the same type from the dropdown, set an amount, save. Inspect the catalog row: both services reference the same `supply_type_id`. Reload the page; both rows render the same supply name from the catalog.

### Playwright spec scaffold (tests first for audit assertions per Constitution IV)

- [ ] T027 [P] [US1] Create `tests/e2e/supply-types-catalog.spec.ts` with a top-level `test.describe('022 supply types catalog', () => { … })`. Inside, add `test.describe('US1: picker + inline create', () => { … })` with three failing tests: (a) picker is pre-populated with the migrated type for a backfilled service (depends on the seed fixture having at least one `supply_label`); (b) inline-create commits a new type and pre-selects it without a second save round-trip; (c) typing a colliding name shows the "select existing" soft hint. Each test uses `newAuditCursor()` and `getAuditLogRowsSince()` (per CLAUDE.md `tests/e2e/_db.ts`) to assert exactly one new `supply_type.created` audit row with the expected payload. Tests will fail until T028–T030 ship.

### Implementation

- [ ] T028 [P] [US1] Create `components/lacquer/services/supply-type-picker.client.tsx` per `contracts/ui.contract.md § 4`. Composition: shadcn `Popover` + `Command`. Renders trigger button (selected type name OR "Pick a supply type" placeholder + `ChevronDown`). Dropdown: `CommandInput` placeholder "Search supply types…", `CommandList` of active types with `Check` icon on the selected, plus pinned `CommandItem` at the bottom for inline-create. Inline-create state: single `<Input>` + Save / Cancel buttons rendered as a plain `<div>` (NOT a nested `<form>` — the picker is inside the outer service form). The Save button calls `formAction(fd)` from `useActionState(createSupplyTypeForPicker, { kind: 'idle' })` per `ui.contract.md § 4` flow steps 1–7; an effect on `state.kind === 'ok'` calls `onSelect(state.id)` then `router.refresh()` then collapses the inline mode. Soft-hint mode swaps Save for "Select existing" when `canonicalizeName(typed)` matches an active type's `name_canonical` — that path calls `onSelect(existingId)` directly without a server round-trip. Emits hidden `<input type="hidden" name="supply_type_id" value={selectedId ?? ''}>` so the outer service form's submit includes the picker's selection. Props match the contract: `{ types, selectedId, onSelect, disabled, serviceId }`. The `serviceId` prop is retained for future deep-link purposes but is NOT used by the inline-create flow (which is fully local).
- [ ] T029 [US1] Edit `components/lacquer/services/deductions-section.client.tsx`: replace the supply sub-row's free-text `<input name="supply_label">` (and its label/counter/validation hints) with `<SupplyTypePicker types={…} selectedId={draft.supply_type_id} onSelect={…} disabled={…} serviceId={service.id} />`. Pull the `types` prop from a new `supplyTypes` prop on `<DeductionsSection>` (added at the same time). The picker rides through `<ServiceForm>` from `<EditPanel>` from `<ServicesPage>`. Update the dirty-detector + buffer-preservation logic to compare `draft.supply_type_id` instead of `draft.supply_label`.
- [ ] T030 [US1] Edit `app/(studio)/services/page.tsx`: load the supply-types catalog via `loadSupplyTypesCatalog()` (from T016) and pass `catalog.active` down to `<EditPanel>` → `<ServiceForm>` → `<DeductionsSection>` → `<SupplyTypePicker>` as the `supplyTypes` prop. **No URL bridge for `supply_type_id`** — the picker's inline-create flow is fully local (returns the new id programmatically via `useActionState` and calls `router.refresh()` to refetch the catalog), so the post-create selection happens in client state without a navigation round-trip.
- [ ] T031 [US1] Append `.supply-type-picker*` rules to `styles/settings.css` under the section comment from T003. Trigger button: `--input` border, `--card` background, 6px radius; dropdown: shadcn `Popover` defaults; selected `Check` icon uses `--primary`; inline-create form: muted background per `--muted`, inputs match the existing edit-panel input styles.

### Story gate

- [ ] T032 [US1] Scoped verification per CLAUDE.md "Scoping intermediate phase gates": `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`, `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`, `npm run typecheck`, `npm test`, `npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US1"`. All five must pass before US5 begins.

**Checkpoint**: US1 (P1) is fully functional and testable independently. The picker works; inline-create works; FormData round-trips to the service row's `supply_type_id`.

---

## Phase 4: US5 — Existing services keep displaying the right supply name post-migration (Priority: P1)

**Goal**: After migration, every service that previously displayed a supply label shows the same name resolved from the catalog. No operator action required.

**Independent Test**: Before applying the migration, snapshot distinct active `supply_label` values. After migration, `supply_types` contains exactly one active row per distinct case-insensitive label; every service with a non-null prior `supply_label` has a non-null `supply_type_id` pointing at its matching type.

> Implementation is in Phase 2 (the migration T006 + the `_load.ts` JOIN T017 + the chip text helper T034 below). This phase is **tests only** — US5 is verified by behavioral assertions, not new application code, because the migration is one-shot and the read path already lands in Foundational. The chip-text helper update is the only implementation work attributable to this story; it ships here so the catalog row's chip resolves the supply name correctly.

- [ ] T033 [P] [US5] Edit `app/(studio)/services/_format.ts`: the supply chip text helper (e.g. `formatSupplyChipText(amountCents, name)` if it exists, or the catalog-row's inline chip rendering in `components/lacquer/services/deduction-chips.tsx`) now reads the resolved `supply_type_name` string instead of the dropped `supply_label`. The function signature changes from `(amount, label)` → `(amount, name)` — string in, string out, same render. Update all callers in `components/lacquer/services/deduction-chips.tsx` to pass `service.supply_type_name` instead of `service.supply_label`.
- [ ] T034 [P] [US5] Add a `test.describe('US5: post-migration display invariant', () => { … })` block to `tests/e2e/supply-types-catalog.spec.ts` (the file created in T027). Tests assert: (a) the seed fixture is set up to include at least 2 services sharing the same case-insensitive `supply_label` before the migration applies — so post-migration they share one `supply_type_id`; (b) `select count(*) from supply_types` equals the count of distinct canonicalized seed labels; (c) every previously-supplied service has a non-null `supply_type_id`; (d) the picker on each migrated service shows the canonicalized name from the catalog; (e) the `audit_log` contains N `supply_type.created` rows with `payload->>'source' = 'migration:022'` (verified at test setup, BEFORE any user interaction — captures the seeded state). SC-001 / SC-002 / SC-007 are verified by this block.

### Story gate

- [ ] T035 [US5] Scoped verification: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`, `npx eslint …`, `npm run typecheck`, `npm test`, `npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US5"`. All five must pass.

**Checkpoint**: US5 (P1) verifies the post-migration invariants. Combined with US1, the operator-visible side of the migration is provably intact.

---

## Phase 5: US2 — Rename a supply type once and see it update everywhere (Priority: P1)

**Goal**: The operator opens the Edit Policy sheet from the services page header, clicks a type's name to rename it inline, and every consuming surface picks up the new name on next render — without per-surface synchronization.

**Independent Test**: Seed a type "GelX tips & gel" referenced by two services. Open Edit Policy → Supply types, rename to "GelX materials" inline. Close the sheet. Open each of the two services in the catalog edit panel; both show the new name. DB: only one row in `supply_types` was updated, no `services` rows were rewritten.

### Playwright spec slice

- [ ] T036 [P] [US2] Add `test.describe('US2: rename propagates', () => { … })` to `tests/e2e/supply-types-catalog.spec.ts`. Failing tests: (a) renaming a type via inline edit propagates to both referencing services' pickers; (b) attempting to commit an empty rename surfaces a hint and restores the prior name; (c) attempting to rename to a colliding active name surfaces a `name_taken` hint; (d) post-rename, exactly one `supply_type.renamed` audit row is written with the correct before/after `name` payload.

### Implementation

- [ ] T037 [P] [US2] Create `components/lacquer/services/edit-policy-sheet.client.tsx` per `contracts/ui.contract.md § 2`. Composition: shadcn `Sheet` with `side="right"`, width `min(440px, 100vw - 16px)`. Header: title "Edit policy", subtitle (copy in contract), close X. Body: scrollable; mounts `<SupplyTypesSection catalog={…} />` as its only child this phase. Animation: 220ms enter / 180ms exit, `ease-out-expo`. Esc + scrim close (shadcn `Sheet` defaults).
- [ ] T038 [P] [US2] Create `components/lacquer/services/edit-policy-button.tsx` (server component) + `edit-policy-button.client.tsx` (client island) per `contracts/ui.contract.md § 1`. Server component wraps a secondary `<Button>` with `Sliders` icon (16px, Lucide, 1.5px stroke) and label "Edit policy"; passes through to client island that manages the `open` state and reads `?policy=open` from the URL on mount (auto-opens). On close, calls `router.replace` to strip the `?policy=open` param. Disabled state for non-privileged operators wrapped in `<OwnerOnlyTooltip>` (reused from 008).
- [ ] T039 [US2] Edit `components/lacquer/services/page-header.tsx`: mount `<EditPolicyButton role={viewer.staff.role} />` to the right of the existing "Add service" button. The role check is server-side; the disabled state for non-privileged operators uses the existing pattern.
- [ ] T040 [US2] Edit `app/(studio)/services/page.tsx`: load `loadSupplyTypesCatalog()` (already loaded in T030 for the picker) and pass it to `<EditPolicySheet catalog={…}>` (mounted at the page level, controlled by `<EditPolicyButton>`'s open state via URL bridge).
- [ ] T041 [US2] Create `components/lacquer/services/supply-types-section.client.tsx` per `contracts/ui.contract.md § 3` — this story ships ONLY the **rename** and **add** affordances (no usage count badge yet — US4; no archive button yet — US3; no expand sub-rows yet — US4). Layout: section header + active-types card. Each row: name (click to rename, inline `<Input>` swap, Enter to commit, Escape to cancel, blur on empty restores prior name); Add row at the bottom (rose text "+ Add supply type" → inline form on click → `<Input>` + primary "Add" + ghost "Cancel"). Wires `renameSupplyType` and `createSupplyType` actions via `<form action={…}>` patterns. Soft hint on collision via client-side `canonicalizeName` check before submit.
- [ ] T042 [US2] Append `.edit-policy-sheet*` and `.supply-types-section*` rules to `styles/settings.css` under the section comment from T003. Every value resolves to a token per `contracts/ui.contract.md § 5`.

### Story gate

- [ ] T043 [US2] Scoped verification: prettier-check, eslint, typecheck, vitest, `npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US2"`. All five must pass.

**Checkpoint**: US2 (P1) lets the operator rename types from the Edit Policy sheet; the rename flows through every consumer without per-surface sync. The MVP-P1 set (US1 + US5 + US2) is shippable here.

---

## Phase 6: US3 — Archive a supply type that's no longer in use (Priority: P2)

**Goal**: The operator archives a type with zero active references; archived types are hidden from the picker but remain visible on services that historically referenced them. The archive control is disabled with a count-aware tooltip while any active service references the type.

**Independent Test**: Create "Cat-eye gel" with one referencing service. From Edit Policy, click Archive → disabled with tooltip "Remove this type from the 1 service that uses it first." Open the service, switch Supply off, save. Return to Edit Policy → Archive succeeds. Open another service, turn Supply on — "Cat-eye gel" no longer appears in the picker.

### Playwright spec slice

- [ ] T044 [P] [US3] Add `test.describe('US3: archive blocker + reactivate', () => { … })` to `tests/e2e/supply-types-catalog.spec.ts`. Failing tests: (a) archive button is disabled with `aria-disabled` and the count-aware tooltip when usage > 0; (b) after the last reference is removed, archive succeeds and the row moves to the Archived sub-section; (c) archived types are excluded from the picker on new edits; (d) reactivate restores the type to active; (e) one `supply_type.archived` audit row written per archive; (f) one `supply_type.reactivated` audit row written per reactivate.

### Implementation

- [ ] T045 [US3] Edit `components/lacquer/services/supply-types-section.client.tsx`: ADD the archive button to each active row per `contracts/ui.contract.md § 3.2`. Disabled when `usage_count > 0` with tooltip copy `"Remove this type from the ${n} service${n === 1 ? '' : 's'} that use${n === 1 ? 's' : ''} it first."`. Wires `archiveSupplyType` via `<form action={…}>`. ADD the Archived types group at the bottom (rendered only when `catalog.archived.length > 0`): muted-background variant of the same card; each row shows name + "Reactivate" outline button. Wires `reactivateSupplyType` via `<form action={…}>`. On `?error=name_taken` redirect, surface as an inline hint under the row.
- [ ] T046 [US3] Append `.supply-types-row .archive-btn` + `.supply-types-section .archived-group` rules to `styles/settings.css`. Disabled state uses `opacity: 0.4` + `cursor: not-allowed` per prototype; tooltip styling reuses the existing `<OwnerOnlyTooltip>` pattern but with the dynamic count copy.

### Story gate

- [ ] T047 [US3] Scoped verification: prettier-check, eslint, typecheck, vitest, `npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US3"`. All five must pass.

**Checkpoint**: US3 (P2) lets the operator archive and reactivate types with the safety blocker in place. US1 + US2 + US3 + US5 are all functional.

---

## Phase 7: US4 — See which services use each supply type at a glance (Priority: P2)

**Goal**: The Edit Policy section's rows show usage counts and (on expand) an indented list of referencing services that the operator can click to jump to the service's edit panel.

**Independent Test**: Three services reference one type; zero reference another. One row shows "3 services"; another shows "Unused". Expand the populated row → three sub-rows render, each naming a service. Click any sub-row → sheet closes; the catalog navigates to that service's edit panel with the service selected.

### Playwright spec slice

- [ ] T048 [P] [US4] Add `test.describe('US4: usage count + expand + jump-to-service', () => { … })` to `tests/e2e/supply-types-catalog.spec.ts`. Failing tests: (a) row shows `"3 services"` badge for a 3-service type and `"Unused"` for a 0-service type; (b) expanding a populated row reveals one sub-row per referencing service with the correct color dot + name + amount; (c) clicking a sub-row closes the sheet AND navigates the catalog to `?selected=<id>` (the existing services URL bridge pre-selects the row); (d) usage_count updates after a service-edit elsewhere on reopening the sheet (server-side revalidation runs on every catalog AND service save — verify the count changes without manual refresh).

### Implementation

- [ ] T049 [US4] Edit `components/lacquer/services/supply-types-section.client.tsx`: ADD the usage_count badge to each active row (formats `"N services"` or `"Unused"` per `contracts/ui.contract.md § 3.2`). ADD the expansion state machine (`ExpansionState = Set<string>` of expanded type ids) and the chevron-right toggle. When expanded, render an indented sub-list with one row per `row.services[i]`: color dot (`background: var(${color_token})`), service name (12px, `--foreground`), supply amount as `−$X.XX` in the amber-700 token, ArrowRight icon. Each sub-row is a `<button>` that calls `router.push('/services?selected=' + s.id)` AND closes the sheet via the prop callback to `<EditPolicySheet onOpenChange={false}>`.
- [ ] T050 [US4] Append `.supply-types-row .usage-badge`, `.supply-types-row .expand-chevron`, and `.supply-types-section .expanded-sub-rows` rules to `styles/settings.css`. Tabular numerals on the usage count via the existing `.tnum` class; sub-row hover background `color-mix(in oklch, var(--muted) 50%, var(--background))` per prototype.

### Story gate

- [ ] T051 [US4] Scoped verification: prettier-check, eslint, typecheck, vitest, `npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US4"`. All five must pass.

**Checkpoint**: All five user stories functional and independently testable. The feature is ready for the final polish gate.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Update the 021 e2e spec to use the picker; visual-compare against the prototype; final full-suite gate.

- [ ] T052 [P] Edit `tests/e2e/services-deductions.spec.ts` (the 021 spec) to update the supply-related assertions: change from `await page.fill('[name=supply_label]', 'Gel polish')` patterns to the picker selection equivalent (open the picker, click the "+ Create new supply type…" affordance for new types, click an existing row otherwise). The four 021 user stories US1–US5 stay green; only the supply assertion mechanism changes.
- [ ] T053 [P] Visual fidelity check per CLAUDE.md "When you change UI" + `contracts/ui.contract.md § 6`: render `design-system/prototypes/services/EditPolicySheet.jsx` (or its `design-system/preview/EditPolicySheet.html` if available) and compare side-by-side with `/services` → Edit policy. Confirm every value (color, spacing, radius, shadow, font weight) traces to a token in `styles/tokens.css`. Document any deviations as a follow-up issue; do not ship deviations.
- [ ] T054 Run `quickstart.md` end-to-end manually (US1–US5 walkthroughs in `specs/022-supply-types-catalog/quickstart.md`). Confirm each story's manual checklist passes against the running dev server + a freshly-reset local Supabase. Capture any drift between the spec and the running implementation as an issue.
- [ ] T055 Final-gate verification per CLAUDE.md "Pre-push quality gates": run the FULL suite (not scoped). `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five MUST be green before push.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. **BLOCKS** every user story.
  - Within Phase 2: T004 (audit union) → can run parallel with T006 (migration). T007 (regenerate types) depends on T006. T008 → T009 (test depends on impl signature being decided, but both are tiny — write in either order). T011/T012/T013/T014/T015 depend on T007 (need regenerated types). T016/T017 depend on T007. T018/T019 depend on T013 + T014 + T015. T020–T024 depend on T011 + T012 + T015 + T016 + T004 (the audit verbs). T025 has no Phase-2 dependencies. T026 (gate) depends on every other Phase-2 task.
- **Phase 3 (US1)**: Depends on Phase 2 complete. Within: T027 (test scaffold) parallel with T028 (picker). T029 depends on T028. T030 depends on T029 + T016. T031 [P] with T029. T032 (gate) is last.
- **Phase 4 (US5)**: Can start after Phase 3 (US5 verifies what US1 enables — picker shows the migrated names). T033 [P] with T034 — different files. T035 (gate) is last.
- **Phase 5 (US2)**: Depends on Phase 4 (US5 first proves the migration; US2 then proves rename). Within: T036 [P] (test scaffold) parallel with T037, T038. T039 depends on T038. T040 depends on T037. T041 depends on T038 + T040 (mounts inside sheet). T042 [P] with T041. T043 (gate) is last.
- **Phase 6 (US3)**: Depends on Phase 5 (US3 extends the section US2 built). T044 [P] with T045. T046 [P] with T045. T047 (gate) is last.
- **Phase 7 (US4)**: Depends on Phase 6 (US4 extends the section US3 extended). T048 [P] with T049. T050 [P] with T049. T051 (gate) is last.
- **Phase 8 (Polish)**: Depends on all user stories. T052 + T053 + T054 [P]. T055 (final full-suite gate) is last.

### Within Each User Story

- The Playwright slice (test scaffold) is written first per Constitution IV — audit assertions are written and shown to FAIL before the catalog action that satisfies them is wired (when applicable).
- Component impl tasks marked [P] can run in parallel within a phase — they touch different files.
- The intermediate gate (the last task in each phase) is the contract that the phase is complete and the next phase may begin.

### Parallel Opportunities

- **Within Phase 1**: T001 [P], T002 [P], T003 [P] — three different files / actions, no dependencies.
- **Within Phase 2**: T008 [P] + T009 [P] + T010 [P] (test files vs impl files — write the tests parallel to the helpers); T013 [P] vs T014 [P] vs T015 [P] (different source files); T020–T023 can be written by different developers in parallel after T011/T012/T015/T016/T004 land.
- **Across user stories**: US3 and US4 both extend `supply-types-section.client.tsx`, so they SHOULD be done sequentially (US3 first per the priority order P2-then-P2-but-US3-is-archive-which-US4-implicitly-uses). If staffed with two developers, US3 must complete its T045 before US4 begins T049 to avoid the same-file edit conflict.
- **Within Phase 8**: T052 + T053 + T054 [P] — three different surfaces. T055 is the final blocker.

---

## Parallel Example: User Story 1 (Phase 3)

```bash
# After Phase 2 completes, launch in parallel:
Task: "T027 [US1] Create tests/e2e/supply-types-catalog.spec.ts with US1 failing tests"
Task: "T028 [US1] Create components/lacquer/services/supply-type-picker.client.tsx"
Task: "T031 [US1] Append .supply-type-picker* rules to styles/settings.css"

# Then sequentially:
Task: "T029 [US1] Edit deductions-section.client.tsx to mount <SupplyTypePicker>"
Task: "T030 [US1] Edit app/(studio)/services/page.tsx to load + pass supplyTypes prop"

# Finally:
Task: "T032 [US1] Scoped verification gate"
```

---

## Implementation Strategy

### MVP First (US1 + US5 + US2 = the three P1 stories)

1. Complete Phase 1 (Setup) — 3 tasks.
2. Complete Phase 2 (Foundational) — 23 tasks; this is the bulk of the migration + actions + helpers.
3. Complete Phase 3 (US1) — picker works on the service edit panel; inline-create works.
4. Complete Phase 4 (US5) — post-migration display verified.
5. Complete Phase 5 (US2) — Edit Policy sheet + rename flow live.
6. **STOP and VALIDATE**: the three P1 stories are independently testable. Deploy/demo if ready.

### Incremental Delivery (then P2 stories)

7. Add Phase 6 (US3) — archive + reactivate. Independently testable.
8. Add Phase 7 (US4) — usage count + expand + jump-to-service.
9. Phase 8 polish + final full-suite gate.

### Parallel Team Strategy

With multiple developers, after Phase 2 completes:

- Developer A: Phase 3 (US1 picker).
- Developer B: Phase 5 (US2 sheet + section + rename) — starts ahead of US5 so the sheet exists when the US5 test scaffolds run.
- Developer C: Phase 6 (US3 archive) — depends on B finishing T041 first (same file).
- Developer D: Phase 7 (US4 expand) — depends on C finishing T045 first (same file).

If only two developers: A on US1 + US5, B on US2; then both pair on US3 → US4 sequentially.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps each task to a user story for traceability.
- Each user story has its own independent test gate (T032 / T035 / T043 / T047 / T051).
- Audit-row assertions in the Playwright spec are scaffolded with failing-first expectations per Constitution IV (US1's T027, US2's T036, US3's T044 all assert exactly one new audit row of the expected verb).
- Commit after each task or logical group (Phase 1 → 1 commit; Phase 2 → 3–5 logical commits; each story phase → 1–2 commits).
- The final full-suite gate (T055) is the only place the slow Playwright pass runs in full; intermediate gates use `-g "USn"` filtering per CLAUDE.md.
- Avoid: vague tasks, same-file conflicts across stories (US3 and US4 both edit `supply-types-section.client.tsx` — sequenced by priority), cross-story dependencies that break independence (each user story's behaviors are still verifiable in isolation by the scoped e2e even though the section's file accumulates surface).
