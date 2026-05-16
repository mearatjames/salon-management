---

description: "Task list for 008-services-catalog"
---

# Tasks: Services catalog (top-level /services)

**Input**: Design documents from `/specs/008-services-catalog/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md (all present)

## Scope amendment — 2026-05-16

Per-tech staff assignment UI is deferred to a later phase. Every task
below was completed in code as originally written; the amendment below
records which tasks delivered UI/server output that has since been
**partially or fully hidden**. Re-enabling those tasks for the next phase
is mechanical (un-skip e2e blocks, re-import `<StaffAssignmentList>`,
re-add `&secondary=no_techs_assigned` suffix — see
`spec.md § Scope amendment` for the full checklist).

| Task  | Status                 | Note                                                                                                |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| T003  | [X] partially deferred | `.service-tech-pill` CSS rules retained but the pill is no longer rendered (`catalog-row.tsx`).     |
| T023  | [X] partially deferred | `page.tsx` no longer maps `AssignableStaff[]` or passes `assignableStaff` to `<Drawer>`.            |
| T026  | [X] partially deferred | `catalog-row.tsx` no longer renders the tech-count pill.                                            |
| T028  | [X] partially deferred | US1 e2e (a) — tech-pill assertions removed.                                                         |
| T029  | [X] partially deferred | `addService` no longer appends `&secondary=no_techs_assigned`.                                      |
| T031  | [X] fully deferred     | `staff-assignment-list.client.tsx` file kept intact but no longer imported or rendered.             |
| T033  | [X] partially deferred | `drawer.client.tsx` — `<StaffAssignmentList>`, `assignableStaff` prop, and tick/override handlers removed. |
| T035  | [X] partially deferred | US2 e2e (a) — Jordan-tick + tech-pill assertion removed. US2 (b) `test.skip`'d.                     |
| T036  | [X] partially deferred | `updateService` no longer appends `&secondary=no_techs_assigned`.                                   |
| T038  | [X] fully deferred     | US3 e2e — entire `test.describe` skipped (per-tech assignment editing).                             |
| T046  | [X] partially deferred | Read-only plumbing through `staff-assignment-list.client.tsx` is dormant alongside the component.   |
| T048  | [X] partially deferred | US6 e2e (b) — `staff-assignment-checkbox` + override read-only assertions removed.                  |
| T051  | [X] partially deferred | US7 e2e (a) — Jordan-tick step removed. US7 (c) `test.skip`'d (zero-techs secondary toast).         |

Tasks not listed are unaffected. Pure-helper tasks T009–T013 and T015–T021
(including `_diff.ts` and its tests) remain valid and tested; the
`_diff` helper is dormant code until the assignment UI returns.

**Tests**: Constitution IV requires Vitest unit tests for the pure helpers (`_validation`, `_sort`, `_format`, `_diff`, `permissions`) and the audit-vocabulary widen, plus one Playwright spec covering the seven user stories end-to-end. These appear before their corresponding implementation tasks (test-first for the pure helpers; story-by-story for the Playwright spec). This feature does not touch money/auth/refund critical paths, so the "test MUST FAIL first" discipline is not constitutionally mandated — but pure-helper tests are still written first so the helper implementations get an explicit contract to satisfy.

**Organization**: Phases follow plan.md § Phase outputs. User stories run in priority order (P1 → P2 → P3) and are independently testable per spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US7); omitted in Setup, Foundational, and Polish phases

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Vendor any missing shadcn primitives, add layout rules, and extend seed data so every later phase can compose without further setup.

- [X] T001 [P] Create the empty test directory `tests/unit/services/` so the Vitest globs pick it up before any test file lands.
- [X] T002 [P] Confirm the four shadcn primitives this feature uses are present: `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `components/ui/switch.tsx`, `components/ui/popover.tsx`. Vendor any missing ones via `npx shadcn@latest add <name>` (the staff feature already added sheet, dialog, switch; popover is new). Do NOT edit generated files.
- [X] T003 [P] Append the Services-specific layout rules to `styles/settings.css` per `contracts/ui.contract.md`: `.settings-services-grid`, `.services-drawer`, `.service-list-row`, `.service-color-swatch`, `.service-price-pill`, `.service-tech-pill`, `.service-archived-badge`, the empty-state composition, and the variable-price field row. Every value MUST resolve to a `var(--*)` token in `styles/tokens.css`. No raw hex, no off-scale spacing, no weight outside 400/500/600.
- [X] T004 [P] Extend `scripts/seed-dev.ts` (or equivalent seeder) with the five sample services from `quickstart.md § 2`: Classic manicure, Gel polish, Classic pedicure, Spa pedicure, Nail art (variable-price). Also insert the corresponding `staff_services` rows: assign both technicians to two services, give one technician a `duration_min_override = 75` for Spa pedicure, leave Nail art with no assignments (so the e2e suite exercises the "No techs" pill and the `no_techs_assigned` secondary toast).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, audit-vocabulary widen, pure helpers (with tests), permissions, types, and the sidebar nav-item wiring. **No user story work can begin until this phase is complete.**

### Database & generated types

- [X] T005 [P] Write `tests/unit/services/audit-service-entity.test.ts` per `contracts/audit.contract.md § 5`: asserts the `AuditAction` union accepts the four new verbs (`service.added`, `service.updated`, `service.archived`, `service.restored`) AND `recordAudit('service.<verb>', ...)` writes an `audit_log` row with `entity_type = 'service'` and the documented payload shape. Tests will fail on the first run because the helper has not been updated yet.
- [X] T006 Write `supabase/migrations/0003_services_catalog.sql` per `data-model.md § 7` and `contracts/db-rls.contract.md`: creates `public.services` (with both cross-column CHECKs and both indexes), creates `public.staff_services` (composite PK, FK cascades, override CHECK, service-id index), installs the two `set_updated_at` triggers, and enables RLS with the two read-only-for-`authenticated` policies. The migration does NOT touch `audit_log` (no DB-side action CHECK — see `research.md § R9`).
- [X] T007 Run `supabase db reset` locally, then regenerate types via `npx supabase gen types typescript --local > lib/db/types.ts`. Verify the new `services` and `staff_services` row types appear with the documented columns and nullability.
- [X] T008 Update `lib/auth/audit.ts`: extend the `AuditAction` union with the four new `service.*` verbs and replace the hard-coded `STAFF_ENTITY_ACTIONS` set with the prefix-based `deriveEntityType` function from `contracts/audit.contract.md § 5`. Verify T005 now passes.

### Pure helpers (tests-first)

- [X] T009 [P] Write `tests/unit/services/validation.test.ts` covering every validator and edge case from `data-model.md § 4`: `validateName` (empty, whitespace-only, 1-char, accents), `validateCategory` (empty, whitespace-only, mixed case), `validateDurationMin` (0, negative, NaN, float, integer overflow), `validateFixedPriceDollars` (negative, NaN, three-decimal, integer, valid cents conversion), `validateBoundDollars` (empty → null, invalid, valid), `validateBoundsConsistency` (only-from, only-to, both with to ≥ from, both with to < from), `validateColor` (every valid swatch + an unknown), `validateOverrideMin` (empty → null, 0, negative, valid), `validateUuid` (valid v4, malformed).
- [X] T010 [P] Write `tests/unit/services/sort.test.ts` covering the catalog grouping/sort: groups by `category` ascending (alpha; case-insensitive), within each group sorts by `name` ascending, mixed-case categories collapse to the same bucket, identical names under different categories stay in their respective groups, and an empty input returns an empty array.
- [X] T011 [P] Write `tests/unit/services/format.test.ts` covering `formatPriceLabel(service)` per `contracts/ui.contract.md § 3` and `research.md § R1`: fixed-price `$45` / `$45.50`; variable with neither bound → `Variable`; variable with only `from` → `From $20`; variable with both → `$20 – $60`; variable with both equal → `$30 – $30`. Confirms zero-cents fixed price renders as `$0` and `Variable` is used (not "From $0") when bounds are null even though `price_cents = 0`.
- [X] T012 [P] Write `tests/unit/services/diff.test.ts` covering `staffAssignmentDiff(baseline, draft)` per `data-model.md § 5.2`: no-op (identical baseline + draft), pure add, pure remove, pure override change (null → 60, 60 → null, 30 → 60), mixed bag (add + remove + change in the same diff), and an empty baseline + empty draft.
- [X] T013 [P] Write `tests/unit/services/permissions.test.ts` covering `canWriteCatalog(role)`: returns true for `owner` and `manager`; returns false for `technician` and `front_desk`. Also confirms the `assertCanWriteCatalog` helper throws `PermissionError` with `code = "forbidden"` for the false cases.
- [X] T014 [P] Create `app/(studio)/services/_types.ts` exactly per `data-model.md § 3` (the four exported types: `AvatarColorToken`, `CatalogService`, `ServiceAssignment`, `ServiceDraftBaseline`, plus `AssignableStaff`).
- [X] T015 [P] Create `app/(studio)/services/_validation.ts` implementing the 9 validators from `data-model.md § 4` and exporting `ValidationError` with the documented error codes. Verify T009 now passes.
- [X] T016 [P] Create `app/(studio)/services/_sort.ts` implementing `sortCatalogGroups(services: CatalogService[])` per `contracts/ui.contract.md § 3` (sort SQL applies the same comparator). Verify T010 now passes.
- [X] T017 [P] Create `app/(studio)/services/_filter.ts` implementing `filterServicesByName(services, query)` — case-insensitive substring match on `name`, empty groups stripped after filter.
- [X] T018 [P] Create `app/(studio)/services/_format.ts` implementing `formatPriceLabel(service)` per `contracts/ui.contract.md § 3`. Verify T011 now passes.
- [X] T019 [P] Create `app/(studio)/services/_diff.ts` implementing `staffAssignmentDiff(baseline, draft)` returning the four-arm operation list per `data-model.md § 5.2`. Verify T012 now passes.
- [X] T020 [P] Create `app/(studio)/services/permissions.ts` exporting `canWriteCatalog`, `assertCanWriteCatalog`, and `PermissionError` per `contracts/server-actions.contract.md § Shared prelude`. Verify T013 now passes.
- [X] T021 [P] Create `app/(studio)/services/toasts.ts` with the toast vocabulary from `contracts/ui.contract.md § 4` (one exported `TOASTS` object keyed by URL toast/error key; values include both the human text and the Sonner variant).

### Sidebar nav wiring

- [X] T022 Wire the sidebar's existing `services` placeholder to the new top-level route. Two coordinated edits:
  - `components/lacquer/sidebar/nav-items.ts` — flip the existing entry from `{ id: "services", label: "Services", icon: Sparkles, href: null, disabled: true }` to `{ id: "services", label: "Services", icon: Sparkles, href: "/services" }`. Order/group untouched.
  - `specs/007-left-panel-nav/contracts/nav-items.contract.md` § 2 canonical-config table — update the `services` row's `href` column from `null` to `/services` and its `disabled` column from `true` to `–` so the contract matches the wired state.
  - `tests/e2e/sidebar.spec.ts` test `(4)` — replace the "services placeholder is aria-disabled" assertions with a navigation assertion (clicking the item routes to `/services` and marks itself active).
  - `components/lacquer/settings/tab-bar.tsx` — REMOVE the existing `{ id: "services", … }` entry from the `TABS` array. Services no longer lives under Settings; leaving the tab in would shadow the new top-level route in the Settings shell.

**Checkpoint**: Foundation ready. Schema applied, types regenerated, audit widened, pure helpers tested and shipped, tab inserted. User stories can begin.

---

## Phase 3: User Story 1 — See the service catalog at a glance (Priority: P1) 🎯 MVP

**Goal**: An owner opens `/services` and sees every service grouped by category, sorted alpha within each group, with search + Show-archived controls and the "{X} active · {Y} total" summary. Empty-catalog and no-match states render correctly.

**Independent Test**: Seed 6 services across two categories (one archived). Open the page, toggle Show-archived, type into search, confirm the row composition (color swatch + name + duration + price + tech-count pill) matches `contracts/ui.contract.md § 3` for both fixed-price and variable-price services.

### Implementation for User Story 1

- [X] T023 [US1] Create `app/(studio)/services/page.tsx` (Server Component, `export const dynamic = "force-dynamic"`): call `requireStudioSession()` (re-verifies the studio session), run the three parallel reads from `contracts/db-rls.contract.md § 5` (catalog with assignment counts, assignable staff, and — when `?selected=` is set — the selected service's assignments), map rows to `CatalogService[]` + `AssignableStaff[]`, and render `<PageHeader />` + `<CatalogList>` + the empty-state when applicable. The page passes `operatorRole` into the list so the read-only path can render later.
- [X] T024 [P] [US1] Create `components/lacquer/services/page-header.tsx` (Server Component): renders the title "Services" and the summary line "{X} active · {Y} total" with tabular numerals. Takes `{ activeCount, totalCount }` props.
- [X] T025 [P] [US1] Create `components/lacquer/services/empty-state.tsx` (Server Component): renders the Sparkles icon + "Add your first service to start booking appointments." copy + the primary "Add service" CTA per `contracts/ui.contract.md § 3`. The CTA links to `/services?adding=1` (the drawer wiring happens in US2; for US1 this link is fine to render even though the drawer doesn't exist yet — clicking will just update the URL).
- [X] T026 [P] [US1] Create `components/lacquer/services/catalog-row.tsx` (Server Component): renders one row per `contracts/ui.contract.md § 3` — color swatch (from `_format` helper), name, duration pill, price pill (via `formatPriceLabel` from `_format.ts`), tech-count pill (with the amber "No techs" warning tone when `assignment_count === 0`), and the Archived badge when `active === false`. Takes a `CatalogService` plus an `isSelected` boolean for the active-row visual.
- [X] T027 [US1] Create `components/lacquer/services/catalog-list.client.tsx` (Client Component, `"use client"`): consumes `roster: CatalogService[]`, `selectedId: string | null`, `operatorRole: StudioRole` props. Holds search query + `showArchived` state (persisted to `sessionStorage` per `contracts/ui.contract.md § 3`). Applies `filterServicesByName` then `sortCatalogGroups`. Renders the search input, the Show-archived toggle, the grouped list (category headers + `<CatalogRow>` per row — rows are server-rendered passes through), the no-match state when filter yields zero rows, and the empty state when the unfiltered catalog is empty. Clicking a row navigates to `/services?selected=<id>` via `next/link`. The "Add service" button at the top navigates to `?adding=1`.
- [X] T028 [US1] Add the US1 scenarios to `tests/e2e/services.spec.ts` (create the file if absent): seeded 6 services / 2 categories / 1 archived → assert the row count, group order, summary text, search filter, Show-archived toggle, and empty-state copy on a freshly-reset catalog. Run with `npm run test:e2e -- services.spec.ts`.

**Checkpoint**: User Story 1 is fully functional. Owners can read the catalog, search, and toggle archived visibility. The page renders identically for any authenticated operator (read access is universal per FR-029). The drawer is not yet wired (clicking a row updates the URL but no overlay appears yet — this lands in US2/US3).

---

## Phase 4: User Story 2 — Add a new service (Priority: P1)

**Goal**: An owner clicks "Add service", fills the form (incl. category auto-complete, color swatch, taxable/variable toggles, staff assignments with optional per-tech duration overrides), saves, and the drawer stays open + flips to Edit mode for the just-created service. A toast confirms. A secondary "no techs" toast fires when no staff are assigned.

**Independent Test**: From the running page, click "Add service" → fill name + category (default "Other"; auto-complete works) + duration + price + color + at least one tech → save → drawer's title becomes "Edit service", "Save changes" is disabled, "Archive service" appears, toast text matches `contracts/ui.contract.md § 4`, the new row appears in the list. Repeat with zero techs ticked → confirm both the success and `no_techs_assigned` toasts.

### Implementation for User Story 2

- [X] T029 [US2] Create `app/(studio)/services/actions.ts` with `"use server"` and the shared prelude helpers (`assertCanEnterServices` route-equivalent, `handleKnownError`, `mapDbError`). Add the `addService(formData)` action per `contracts/server-actions.contract.md § 1`: parse + validate every field, compute `price_cents` per `research.md § R1`, INSERT into `services`, INSERT each `staff_services` row (rolling back the service INSERT on assignment-INSERT failure), `await recordAudit('service.added', ...)` with the payload from `contracts/audit.contract.md § 1`, `revalidatePath('/services')`, redirect to `?selected=<newId>&toast=service_added&name=<encoded>` (appending `&secondary=no_techs_assigned` when zero staff were assigned).
- [X] T030 [P] [US2] Create `components/lacquer/services/discard-changes-dialog.client.tsx`: a small client island wrapping shadcn `<Dialog>` with the title "Discard changes?", body copy "You have unsaved changes. Discard them?", and Cancel + Discard buttons. Exposes `open: boolean` + `onCancel` + `onDiscard` props.
- [X] T031 [P] [US2] Create `components/lacquer/services/staff-assignment-list.client.tsx`: takes `assignableStaff: AssignableStaff[]` + `draftAssignments: ServiceAssignment[]` + `onToggle(staffId, ticked)` + `onOverrideChange(staffId, value)`. Renders one row per active staff with avatar, name, role label, a checkbox, and a `duration_min_override` input that is disabled until the checkbox is ticked. Honors the read-only mode prop (`disabled: boolean`) for US6.
- [X] T032 [P] [US2] Create `components/lacquer/services/service-form.client.tsx`: takes `baseline: ServiceDraftBaseline | null` (null = Add mode), `draft: ServiceDraft`, and `onChange(patch)`. Renders the form fields in the order documented in FR-011: name → category (with auto-complete from a `categories: string[]` prop) → duration → price (replaced by `From`/`To`/note when `variable_price` is on) → color swatches (8 `--avatar-*` radio inputs) → `taxable` toggle → `variable_price` toggle. Inline validation hints surface per-field error states. Honors `disabled: boolean` for US6.
- [X] T033 [US2] Create `components/lacquer/services/drawer.client.tsx` (the state machine from `contracts/ui.contract.md § 2`): takes `mode: "closed" | "add" | "edit"` (derived from URL params), `baseline: ServiceDraftBaseline | null`, `assignableStaff`, `categories`, and `operatorRole`. Holds the `draft` state, derives `isDirty` by comparing to `baseline`, and renders the header preview + `<ServiceForm>` + `<StaffAssignmentList>` + the bottom action area + the footer (Cancel + Save). Close gestures (backdrop / Escape / Cancel) call `attemptClose()` which routes to either a silent close (when clean) or the `<DiscardChangesDialog>` (when dirty). The Save submission posts the FormData to `addService` or `updateService` depending on `mode`. The drawer ALWAYS mounts; CSS controls its visibility off-canvas vs. on-canvas.
- [X] T034 [US2] Wire the drawer into `app/(studio)/services/page.tsx`: read `searchParams.adding === "1"` to determine Add mode and `searchParams.selected` for Edit mode (US3 will fully populate the baseline). For US2, when `adding=1`, render `<Drawer mode="add" baseline={null} ... />`. Also derive `categories: string[]` from the catalog read in T023 and pass it down.
- [X] T035 [US2] Add the US2 scenarios to `tests/e2e/services.spec.ts`: click Add → fill the form → save → assert the drawer flips to Edit (title text changes, primary becomes "Save changes" and is disabled, the Archive action is now visible), assert the toast text, assert the new row appears in the list. Repeat with zero techs ticked → assert the secondary `no_techs_assigned` toast also appears.

**Checkpoint**: User Story 2 is fully functional. Add → save → drawer stays open in Edit mode. The Edit-mode behavior (US3) hasn't been wired yet, but the post-add state is correct because Add and Edit share the same client island; once US3 lands, the just-created service is fully editable in the same drawer instance.

---

## Phase 5: User Story 3 — Edit a service's details and per-tech assignments (Priority: P1)

**Goal**: Clicking a row hydrates the drawer in Edit mode with the saved baseline (incl. staff assignments and per-tech overrides). Edits enable Save when the diff is non-empty; saving persists every field atomically and writes a diff-aware `service.updated` audit row.

**Independent Test**: Click a seeded service → drawer opens with all fields pre-filled and the right techs ticked → change the price + untick a tech + set a per-tech override for another → save → assert the list-row update, the toast, and the `staff_services` rows in the DB. Verify `audit_log` has a `service.updated` row with the expected `changes` / `assignment_changes` payload.

### Implementation for User Story 3

- [X] T036 [US3] Add `updateService(formData)` to `app/(studio)/services/actions.ts` per `contracts/server-actions.contract.md § 2`: parse `service_id`, load the target service + its current assignments, validate, compute the `services` patch + the `staff_services` diff (via `_diff.ts`), short-circuit with `?error=no_changes` when both diffs are empty, run the update + assignment writes inside a single transaction (via a Postgres function or by rolling back the service update on assignment failure), `await recordAudit('service.updated', ...)` with the payload from `contracts/audit.contract.md § 2`, redirect to `?selected=<id>&toast=changes_saved` (plus `&secondary=no_techs_assigned` when the final state has zero assignments).
- [X] T037 [US3] Also in `actions.ts`, add `loadServiceWithAssignments(catalog, assignments, id)` — the typed projection (NOT a Server Action) from `contracts/server-actions.contract.md § 5`. The page in T023/T034 already runs the per-service assignments query when `?selected=` is set; this helper just zips the catalog row with the assignment rows into a `ServiceDraftBaseline` and returns `null` when the id isn't found. Wire it into `page.tsx` so the drawer receives a full baseline prop when `?selected=` is set.
- [X] T038 [US3] Add the US3 scenarios to `tests/e2e/services.spec.ts`: click a seeded row → assert every form field is pre-filled (incl. the staff checkboxes and the per-tech override for the Spa-pedicure case from the seed) → change price + untick a tech + add an override → save → assert the list row updated, the toast text, and (via a small psql-or-supabase-js helper at the end of the spec) that the `staff_services` table reflects the diff and the audit row exists with the diff-aware payload.

**Checkpoint**: User Stories 1, 2, and 3 are all independently functional. The page is now a complete CRUD surface modulo Archive/Restore. End-to-end, a brand-new salon can populate its catalog from scratch.

---

## Phase 6: User Story 4 — Archive or restore a service (Priority: P2)

**Goal**: From the edit drawer, archive an active service (with a confirmation dialog) or restore an archived one (no dialog). Both operations write `audit_log` rows; `staff_services` is untouched.

**Independent Test**: Open any service in the drawer → click "Archive service" → confirm the dialog text → confirm → row disappears (or becomes muted if Show-archived is on), toast fires, drawer's action flips to "Restore service". Click Restore → row returns to the default view, toast fires.

### Implementation for User Story 4

- [X] T039 [US4] Add `archiveService(formData)` and `restoreService(formData)` to `app/(studio)/services/actions.ts` per `contracts/server-actions.contract.md §§ 3–4`: load target, pre-check the current `active` state (short-circuit to `?error=no_changes` if already in the target state), UPDATE `services` set `active = (false|true)`, `await recordAudit('service.(archived|restored)', ...)` with the `{ name }` payload from `contracts/audit.contract.md §§ 3–4`, redirect to `?selected=<id>&toast=service_(archived|restored)&name=<encoded>`.
- [X] T040 [P] [US4] Create `components/lacquer/services/archive-dialog.client.tsx`: shadcn `<Dialog>` with the destructive icon, title `Archive {name}?`, body copy per FR-025 ("{name} won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time."), and Cancel + Archive buttons. Exposes `open` + `serviceName` + `onCancel` + `onConfirm` props. The Confirm button submits an action FormData with `service_id` for `archiveService`.
- [X] T041 [US4] Wire the bottom action area in `drawer.client.tsx`: when the drawer is in Edit mode AND `operatorRole ∈ {owner, manager}`, render either "Archive service" (when `baseline.active === true`) or "Restore service" (when `baseline.active === false`). Archive opens `<ArchiveDialog>`; Restore submits `restoreService` directly with no dialog.
- [X] T042 [US4] Add the US4 scenarios to `tests/e2e/services.spec.ts`: archive a seeded service → assert the dialog text, the row removal (and re-appearance under Show-archived), the toast, and the bottom action flipping to Restore. Restore → assert the row returns, the toast, and the action flips back to Archive.

**Checkpoint**: User Stories 1–4 are complete. The catalog has full CRUD + lifecycle. The page is functionally finished modulo variable-price polish (US5), authorization (US6), and toast polish (US7) — all three of which are already partially implemented across the prior phases and just need their explicit acceptance criteria nailed down.

---

## Phase 7: User Story 5 — Variable-price services with bounds and a note (Priority: P2)

**Goal**: The "Variable price" toggle reveals optional `From`/`To` bounds + a note. The catalog row formats as `From $X`, `$X – $Y`, or `Variable` per the bounds present. Validation enforces `to >= from` when both are set.

**Independent Test**: Add a service with variable-price on and no bounds → list row reads "Variable". Edit → set `From $20` only → "From $20". Set `To $60` → "$20 – $60". Set `To $10` (less than From) → inline error, Save disabled. Toggle Variable off → fields clear, single price re-appears.

### Implementation for User Story 5

- [X] T043 [US5] In `components/lacquer/services/service-form.client.tsx`, ensure the variable-price branch is wired exactly per FR-023: toggling `variable_price` on swaps the Price field for `From`/`To`/note; toggling off swaps back and clears the (now-irrelevant) variable-only fields in local draft state. The `validateBoundsConsistency` validator runs client-side to keep the Save button accurately disabled when `to < from`.
- [X] T044 [US5] Confirm `_format.ts` already returns the four label variants per `contracts/ui.contract.md § 3` and `tests/unit/services/format.test.ts` (T011/T018) covers them. If the test coverage misses a case spotted during implementation (e.g. `to` is set without `from`), add the case here.
- [X] T045 [US5] Add the US5 scenarios to `tests/e2e/services.spec.ts`: add a Variable-price service with no bounds → assert "Variable" label and `price_cents = 0` in the DB. Edit to set `From $20` → "From $20" label. Set `To $60` → "$20 – $60". Toggle off → fields clear and single price re-appears. Inverted bounds → inline error + Save disabled.

**Checkpoint**: User Stories 1–5 are complete. The catalog supports the full price model.

---

## Phase 8: User Story 6 — Restrict who can manage the catalog (Priority: P2)

**Goal**: Technicians and front-desk can read the page (list + drawer) but every write control is disabled with a tooltip. Server Actions reject non-privileged operators with `?error=forbidden`.

**Independent Test**: Sign in as a technician → navigate to `/services` → list renders, "Add service" disabled with tooltip, clicking a row opens the drawer in read-only mode (all inputs disabled, primary becomes a "View only" chip). Submit `addService` directly via DevTools FormData → assert the `forbidden` toast.

### Implementation for User Story 6

- [X] T046 [US6] Plumb the read-only path through `drawer.client.tsx`, `service-form.client.tsx`, and `staff-assignment-list.client.tsx`: each accepts `disabled: boolean` (derived in `page.tsx` from `!canWriteCatalog(operatorRole)`) and applies it to every input, toggle, swatch radio, checkbox, override field, and bottom-action button. The footer's Save button is replaced with a "View only" chip when disabled. The discard-changes dialog and the archive dialog are unreachable in this mode because no draft can be dirty.
- [X] T047 [US6] In `components/lacquer/services/catalog-list.client.tsx`, render the "Add service" button as disabled with the tooltip "Only owners and managers can edit the catalog" when `!canWriteCatalog(operatorRole)`. Use a shadcn `<Tooltip>` so the affordance is keyboard-reachable.
- [X] T048 [US6] Add the US6 scenarios to `tests/e2e/services.spec.ts`: switch the Playwright fixture to log in as the seeded technician → assert the list still renders → assert the Add button is disabled with the tooltip → click a row → assert every drawer control is disabled and the primary chip reads "View only" → use `page.request.post()` to fire `addService` directly with a valid FormData → assert the redirect lands on `?error=forbidden` and the destructive toast fires.

**Checkpoint**: User Stories 1–6 are complete. The page is ready for non-privileged operators to use as a read-only reference.

---

## Phase 9: User Story 7 — Get clear feedback after every action (Priority: P3)

**Goal**: Every mutation surfaces a single Sonner toast with the right copy. The URL-toast bridge fires the toast then strips the params so a refresh doesn't re-fire.

**Independent Test**: Trigger each of the four mutations (add, edit, archive, restore) and confirm the toast text matches `contracts/ui.contract.md § 4`. Fire two mutations in quick succession → assert only the second toast is visible after the first dismisses (no stacking).

### Implementation for User Story 7

- [X] T049 [US7] Create `components/lacquer/services/services-toaster.client.tsx` mirroring `components/lacquer/staff/staff-toaster.client.tsx`: read `useSearchParams()` for `toast`, `secondary`, `name`, `error` → fire the matching Sonner toast(s) per the `TOASTS` map in `toasts.ts` → `router.replace(pathname + paramsWithoutToastParams)` to strip the keys. The Sonner instance is the existing one already mounted by the studio layout; no new provider needed.
- [X] T050 [US7] Mount `<ServicesToaster />` (wrapped in `<Suspense fallback={null}>` per Next 16's strict-streaming rule) in `app/(studio)/services/page.tsx`, parallel to where `<StaffToaster />` is mounted on the staff page.
- [X] T051 [US7] Add the US7 scenarios to `tests/e2e/services.spec.ts`: trigger each mutation in sequence (add → edit → archive → restore) and assert exactly one toast is visible at each step with the correct copy. Fire two mutations back-to-back and assert the first dismisses when the second fires.

**Checkpoint**: All seven user stories are complete. The feature is feature-complete; remaining work is polish + verification.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Visual fidelity, token compliance, gate validation, and the spec-status flip.

- [X] T052 [P] Side-by-side visual comparison: open the running page and `design-system/ui_kits/studio/Settings.jsx` (and any rendered HTML preview under `design-system/preview/*.html`) per `quickstart.md § 5`. Adjust any pixel-misaligned chip, swatch, or pill until the page matches the prototype. Document any intentional deviation in a one-line code comment.
- [X] T053 [P] Token-compliance sweep: grep `app/(studio)/services/`, `components/lacquer/services/`, and the new rules in `styles/settings.css` for raw hex codes (`grep -RIn '#[0-9a-fA-F]\{3,8\}'`), off-scale spacing (any `px` value not in {4,8,12,16,20,24,32,40,48,64}), and font-weight values outside 400/500/600. Replace every hit with the corresponding `var(--*)` token from `styles/tokens.css`. Constitution Principle I is the gate.
- [X] T054 [P] Audit-log spot check via psql / supabase studio per `quickstart.md § 7`: trigger one of each mutation and confirm `select action, entity_type, entity_id, payload from audit_log where action like 'service.%' order by ts desc limit 8;` returns the expected verbs, `entity_type = 'service'`, and payload shapes per `contracts/audit.contract.md`.
- [X] T055 Run the full pre-push gate set in order per `CLAUDE.md § "Pre-push quality gates"`: `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run test:e2e -- --workers=1`. All five MUST be green locally before the PR is opened. Constitution v1.0.3 § Development Workflow & Quality Gates is the authority.
- [ ] T056 After the PR merges to `main`: confirm `.github/workflows/db-migrate-prod.yml` ran and applied `0003_services_catalog.sql` to the production Supabase project, then update `specs/008-services-catalog/spec.md` front-matter `Status: Draft` → `Status: Done`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies; can start immediately.
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks every user story.**
- **Phases 3–9 (User stories)** — all depend on Phase 2. After Phase 2 completes, user stories can proceed in parallel by independent developers. The four pure helpers (`_validation`, `_sort`, `_format`, `_diff`) and `permissions.ts` are all foundational so stories never block on them.
- **Phase 10 (Polish)** — depends on the desired user stories being complete. The MVP is Phases 1–3 (Setup + Foundational + US1); a full ship is Phases 1–10.

### Within each user story

- The four pure helpers were tested+shipped in Phase 2, so story phases consume them directly with no test-first delay.
- Within US2: discard-changes-dialog, staff-assignment-list, and service-form can be built in parallel; the drawer (T033) integrates them.
- Within US3: T036 (action) and T037 (read helper) are sequential because T037 wires into `page.tsx` after T036's action is callable.
- Within US4: T039 (actions) and T040 (dialog) can be built in parallel; T041 wires both into the drawer.
- US5, US6, and US7 are mostly polish layers on top of US2/US3/US4 components; their tasks edit existing files so they cannot run in parallel with each other (file contention).

### Parallel opportunities

- All Phase 1 tasks marked [P] run in parallel.
- All Phase 2 helper test files (T009–T013) run in parallel; all Phase 2 helper implementations (T014–T021) run in parallel after their tests; the sidebar nav-item edit (T022) is independent.
- Within US1: T024–T026 (three small server components) run in parallel; T027 (the list client) depends on them; T028 (e2e) depends on T023 + T027.
- Within US2: T030–T032 (three client islands) run in parallel; T033 (drawer) depends on all three; T034 (page wiring) depends on T033; T035 (e2e) depends on T034.
- Within US4: T039 + T040 run in parallel; T041 depends on both.
- Phases 3 → 4 → 5 are best run sequentially in priority order because they all edit `tests/e2e/services.spec.ts` and `drawer.client.tsx` / `service-form.client.tsx` — running them in parallel risks merge conflicts. Phases 6 + 7 can be split across two developers if one takes US4 + US5 and the other takes US6 + US7.

---

## Parallel example: Phase 2 pure helpers

```bash
# Tests first (all independent files):
Task T009: write tests/unit/services/validation.test.ts
Task T010: write tests/unit/services/sort.test.ts
Task T011: write tests/unit/services/format.test.ts
Task T012: write tests/unit/services/diff.test.ts
Task T013: write tests/unit/services/permissions.test.ts

# Implementations (all independent files; assume tests above are committed):
Task T014: create app/(studio)/services/_types.ts
Task T015: create app/(studio)/services/_validation.ts
Task T016: create app/(studio)/services/_sort.ts
Task T017: create app/(studio)/services/_filter.ts
Task T018: create app/(studio)/services/_format.ts
Task T019: create app/(studio)/services/_diff.ts
Task T020: create app/(studio)/services/permissions.ts
Task T021: create app/(studio)/services/toasts.ts
```

---

## Implementation strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) — schema + types + helpers + tab insert.
3. Complete Phase 3 (US1) — list-only page.
4. **STOP and VALIDATE**: open `/services`, confirm the seeded catalog renders correctly across both fixed-price and variable-price rows, with the empty-state and no-match states reachable.
5. Demo or merge as MVP.

### Incremental delivery

1. Setup + Foundational → schema lives, tab visible. Internal preview ready.
2. + US1 → MVP. Read-only catalog. Demo to the owner.
3. + US2 → Add flow. The catalog can grow.
4. + US3 → Edit flow. Per-tech overrides land. The catalog is fully mutable.
5. + US4 → Archive/restore lifecycle.
6. + US5 → Variable-price polish (mostly already shipped; this just locks in the acceptance criteria).
7. + US6 → Non-privileged operators get read-only access.
8. + US7 → Toast polish.
9. + Polish (Phase 10) → token sweep + visual fidelity + full gate set + production migration applied + Status: Done.

### Parallel team strategy

With three developers post-foundation:

- Dev A: US1 (MVP) → US3 → US5 (the form-and-edit thread)
- Dev B: US2 (Add flow) → US4 (Archive/Restore) → US6 (Read-only)
- Dev C: US7 (Toasts) and Phase 10 polish

Phases 3–5 are sequential for Dev A because each builds on the prior's components. Phases 6/8/9 can run in parallel between Dev B and Dev C once US3 is in.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to a user story for traceability; setup, foundational, and polish phases have no story label
- Each user story is independently completable and testable after Phase 2; their checkpoints are real (stop and demo)
- Test-first applies to the four pure helpers in Phase 2; the Playwright spec grows story-by-story
- Commit after each task or logical group; the `[Spec Kit] commit` auto-hook handles this between speckit commands but implementation commits are manual
- Avoid cross-story dependencies that break independence — every story phase MUST keep the catalog page functional for at least all previously-completed stories
- Constitution v1.0.3 § Development Workflow & Quality Gates ("Pre-push quality gates" + "Schema drift forbidden") is the authority for T055 and T056
