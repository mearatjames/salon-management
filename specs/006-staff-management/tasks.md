---
description: "Task list for 006-staff-management"
---

# Tasks: Staff management (Settings → Staff)

**Input**: Design documents from `/specs/006-staff-management/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Constitution IV requires test-first for four critical paths: the last-owner DB trigger, the permission matrix function, the `AuditAction` widen, and the sort comparator. Vitest/Playwright tasks for those specifically appear before their implementation tasks. Other unit tests are inline with implementation.

**Organization**: Phases follow plan.md § Phase outputs. User stories run in priority order (P1 → P2 → P3) and are independently testable per spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1–US7); omitted in Setup, Foundational, and Polish phases

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Vendor missing primitives and add the `--avatar-*` palette tokens so every later phase can compose without further setup.

- [ ] T001 [P] Add the 8 `--avatar-{rose,blue,green,amber,purple,teal,orange,slate}` tokens to `styles/tokens.css` (light + dark mode if dark needs distinct values; copy OKLCH values verbatim from research.md § R4).
- [ ] T002 Vendor shadcn primitives needed by this feature: run `npx shadcn@latest add sheet dialog switch` — produces `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `components/ui/switch.tsx`. Do NOT edit the generated files yet.
- [ ] T003 [P] Create `styles/settings.css` with the settings-shell layout rules (sidebar+content grid, tab bar, edit-panel column); every value MUST resolve to a `var(--*)` token from `styles/tokens.css`.
- [ ] T004 [P] Import `styles/settings.css` from `styles/globals.css` (one-line `@import`) so the settings shell picks it up automatically when its layout mounts.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, audit-enum widening, permission matrix, settings shell, and reusable components that every user story depends on. **No user story work can begin until this phase is complete.**

### Database & types

- [ ] T005 Write `tests/unit/staff/last_owner_trigger.test.ts` (Vitest + Supabase fixture) covering the happy path (demote a non-last owner) and rejection path (demote the last active non-removed owner). Tests MUST FAIL initially (file does not exist yet, trigger not installed).
- [ ] T006 Write `supabase/migrations/0002_staff_management.sql` per data-model.md § 4: add `removed_at timestamptz`, create `staff_roster_idx`, run the `--accent-*` → `--avatar-*` UPDATE, define `staff_assert_owner_present()` function + `staff_assert_owner_present_trg` BEFORE UPDATE OR DELETE trigger.
- [ ] T007 Update `supabase/seed.sql`: change the three staff inserts' `color_token` strings to `--avatar-rose`, `--avatar-amber`, `--avatar-purple` respectively (replaces the legacy `--accent-*` strings).
- [ ] T008 Run `supabase db reset` locally, then regenerate types via `npx supabase gen types typescript --local > lib/db/types.ts`. Verify the new `removed_at: string | null` column appears on the `staff` row type.
- [ ] T009 Re-run T005 — Vitest tests for the last-owner trigger MUST now pass.

### Audit enum widening

- [ ] T010 Write `tests/unit/staff/audit.test.ts` per audit.contract.md: asserts the `AuditAction` union accepts the 6 new verbs (`staff.added`, `staff.updated`, `staff.pin_set`, `staff.deactivated`, `staff.reactivated`, `staff.removed`) AND `recordAudit` writes one `audit_log` row per call with the documented payload shape (no `authorizing_staff_id` in any payload). Tests MUST FAIL initially.
- [ ] T011 Update `lib/auth/audit.ts`: rename `AuthAction` → `AuditAction`, widen to 11 verbs, rename `recordAuth` → `recordAudit`, add `export const recordAuth = recordAudit;` and `export type AuthAction = AuditAction;` aliases (back-compat for feature 003). Verify T010 now passes.

### Permission matrix (the trust boundary)

- [ ] T012 Write `tests/unit/staff/permissions.test.ts` per permissions.contract.md: covers every operator × target × action × modifier cell of the matrix. Includes: owner-can-do-anything, manager × owner read-only across all 9 actions, manager × non-owner allowed (with role-set scope), self-edit blocks role/active/deactivate/remove, last-owner blocks demote/deactivate/remove, role-set scope rejects out-of-range `newRole`. Tests MUST FAIL initially.
- [ ] T013 Create `app/(studio)/settings/staff/permissions.ts` with the full public API from permissions.contract.md § Public API: `StaffAction` type, `PermissionContext`, `PermissionError` (with stable `code`), `assertMutationAllowed`, `isMutationAllowed`, `roleOptionsFor`, `computeTargetPermissions`. Implementation MUST evaluate gates in the decision-tree order specified in permissions.contract.md § Decision tree. Verify T012 now passes.

### Settings shell

- [ ] T014 Create `app/(studio)/settings/layout.tsx` (Server Component) per routes.contract.md § Auth gate: call `requireStudioSession()`; if `viewer.staff.role` is not `owner` or `manager`, `redirect("/dashboard")`. Render the tab bar + `{children}` inside the studio shell.
- [ ] T015 [P] Create `components/lacquer/settings/tab-bar.tsx` (Server Component) — renders the 4 Settings tabs from data-model.md § 1.4. Uses `usePathname` is NOT allowed (Server Component); accept `activeTab` prop computed in the layout from `headers().get("x-pathname")` or via a child client wrapper.
- [ ] T016 [P] Create `app/(studio)/settings/page.tsx` — a one-line `redirect("/settings/staff")`.
- [ ] T017 [P] Create the three placeholder pages: `app/(studio)/settings/general/page.tsx`, `app/(studio)/settings/notifications/page.tsx`, `app/(studio)/settings/billing/page.tsx`. Each renders an empty-state card with copy "Not part of this prototype" centered in the settings content column.

### Shared lacquer primitives

- [ ] T018 [P] Create `components/lacquer/badge.tsx` (Server Component) per ui.contract.md — supports `variant` prop (`default | success | warning | destructive | muted`); a single rounded pill with `--radius-full`, tabular numerals, sized via `text-xs`. Every visual value resolves to a token.
- [ ] T019 [P] Create `components/lacquer/numeric-keypad.client.tsx` per research.md § R7 with the documented API: `length=4`, `step: "enter" | "confirm"`, `errorMessage?`, `onSubmit(digits)`, `onCancel?`. Owns digit buffer + on-screen 3×4 keypad + keyboard listener (digits, Backspace, Enter when full, Escape). No form, no Server Action import. Dot row has `role="img" aria-label="PIN entry, {filled}/4"`.

### Story-shared helpers (validation, toasts)

- [ ] T020 [P] Create `app/(studio)/settings/staff/_validation.ts` per data-model.md § 1.1: exports `validateDisplayName(s) → string`, `validateRole(r) → StudioRole`, `validateColor(t) → string`, `validatePinShape(p) → string`. Each throws a typed `ValidationError` carrying the `error_code` strings from server-actions.contract.md § Error codes.
- [ ] T021 [P] Create `app/(studio)/settings/staff/toasts.ts` per ui.contract.md § Toast strings — exports the full `TOAST` constants object so tests and the client toaster import the same strings.
- [ ] T022 [P] Modify `tests/e2e/_db.ts` to add a `resetStaffToSeed()` helper that re-runs the staff INSERT block from `supabase/seed.sql` (idempotent via `ON CONFLICT DO NOTHING` — same shape as the seed file). Used by every staff e2e `beforeEach`.

**Checkpoint**: Foundation ready — user story implementation can begin in parallel.

---

## Phase 3: User Story 1 — See the roster at a glance (Priority: P1) 🎯 MVP

**Goal**: Owner opens `/settings/staff` and sees every staff member rendered with name, role, PIN status, active status, "Added" month, sorted by role priority then name. Search filters by name; "Show inactive" toggles muted rows; summary reads "X active · Y total".

**Independent Test**: Seed 3 active + 1 inactive staff. Sign in as owner Maya, open `/settings/staff`. Table renders 3 rows by default with correct order (owner → manager → tech). Flip "Show inactive" on → inactive row appears muted; off → hides. Type "ma" → only Maya. Summary updates to match.

### Tests for User Story 1

- [ ] T023 [P] [US1] Write `tests/unit/staff/sort.test.ts` (Vitest) per data-model.md § 6 invariant 8: covers `role_priority` ordering (owner=0, manager=1, technician=2, front_desk=3) and case-insensitive alphabetical within each role. Test MUST FAIL initially.
- [ ] T024 [P] [US1] Write `tests/unit/staff/filter.test.ts` (Vitest) covering the case-insensitive substring search and the show-inactive toggle filter on an in-memory 50-row array. Test MUST FAIL initially.

### Implementation for User Story 1

- [ ] T025 [P] [US1] Create `components/lacquer/staff/staff-avatar.tsx` (Server Component) — initials avatar with `oklch(from var(--avatar-<color>) l c h / 0.15)` background + `var(--avatar-<color>)` text. Size prop (default 40px). Pure adaptation of `staff-tile.tsx:48-75`.
- [ ] T026 [US1] Implement the page Server Component at `app/(studio)/settings/staff/page.tsx`: call `requireStudioSession()`, fetch the roster via `supabase.from("staff").select("id, display_name, role, color_token, active, created_at, pin_hash").is("removed_at", null).order(<role_priority>).order("display_name")`; map to a `RosterStaff[]` shape (with `pin_set: pin_hash != null`, omit `pin_hash` from the projection). Compute `isLastOwner` for the panel. Render `<PageHeader>`, `<StaffTable client>`, and the edit-panel slot (empty state or selected-row panel).
- [ ] T027 [P] [US1] Create `components/lacquer/staff/staff-row.tsx` (Server Component) — single row with avatar + name + role badge + PIN status (`ShieldCheck` 16 + "Set" OR em-dash) + active badge + "Added Mon YYYY". Tabular numerals on the date column. `aria-pressed={isSelected}`.
- [ ] T028 [US1] Create `components/lacquer/staff/staff-table.client.tsx` (Client Component) — owns `searchQuery` state and `showInactive` state (initialized from `sessionStorage["tn:settings:staff:show-inactive"]`); renders the search input (`Search` icon, no border-collapse), the table grid, the empty-state row ("No staff match your search."), and "X active · Y total" summary. Uses the sort comparator from T023 implementation if you factored it into a shared module (`_sort.ts`); otherwise inline the function from sort.test.ts's tests.
- [ ] T029 [P] [US1] Create `components/lacquer/staff/page-header.tsx` (Server Component) — title "Staff" + the live count slot (the count itself is computed in the client table; the header just provides layout) + the "Show inactive" toggle (shadcn `Switch`) wrapper that the client table binds to + the "Add staff" button (stub for US1; opens the wizard in US2). Includes `Plus` 16 icon.
- [ ] T030 [US1] Add the empty-state placeholder for the unselected panel in the page: `components/lacquer/staff/empty-state.tsx` (Server Component) with the `Users` icon and copy from ui.contract.md § Empty-states.
- [ ] T031 [US1] Write the US1 e2e scenario in `tests/e2e/staff.spec.ts` (new file) per quickstart.md § US1. Use `truncateAuditLog()` + `resetStaffToSeed()` in `beforeEach`. Verify: route gate passes for owner; roster renders with seeded data; search "ma" filters; show-inactive toggle works; summary text matches.
- [ ] T032 [US1] Run `npm test` — verify T023 and T024 now pass.

**Checkpoint**: US1 is fully functional. The page loads, the table sorts/filters correctly. Stop here for an MVP demo if needed.

---

## Phase 4: User Story 2 — Add a new staff member with a PIN (Priority: P1)

**Goal**: Owner clicks **Add staff**, steps through Details → Set PIN → Done; a new row appears in the table; toast confirms.

**Independent Test**: Click Add staff. Fill name "Maya Chen", role "Tech", color Green. Toggle PIN on, set `1984` / `1984`. See success screen. Close → new row visible, selected, "Maya Chen added to the roster" toast.

### Implementation for User Story 2

- [ ] T033 [P] [US2] Create `components/lacquer/staff/color-picker.tsx` (Server Component) — 8 swatches as `<input type="radio" name="color_token">` styled into circular tap-targets with the `--avatar-*` tokens. The 8-token order is fixed per research.md § R4. Default-checked = `--avatar-green` (matches FR-010).
- [ ] T034 [US2] Create the `addStaff` Server Action in `app/(studio)/settings/staff/actions.ts` per server-actions.contract.md § 1: prelude (requireStudioSession → assertCanEnterSettings → assertMutationAllowed with `action="add"` and `newRole`), parse + validate via `_validation.ts`, hash PIN with `lib/auth/pin.ts:hashPin` if present, INSERT row, await `recordAudit("staff.added", …)`, `revalidatePath("/settings/staff")`, redirect with `?selected=<new_id>&toast=staff_added&name=<encoded_name>`. The function must include the `"use server"` pragma at the top of the file.
- [ ] T035 [US2] Create `components/lacquer/staff/add-staff-wizard.client.tsx` (Client Component) — Sheet on right side, 3-step state machine, step bar (3 dots), live avatar+name preview on step 1, embeds `<NumericKeypad>` on step 2 (two phases: enter then confirm — track in local state, show error "PINs didn't match. Try again." on mismatch and reset to enter), success card on step 3. The wizard reads `roleOptionsFor(viewer.staff.role)` from `permissions.ts` to render the role select options (manager-operator never sees "owner"). Final submit POSTs the FormData to `addStaff` (the action redirects with `?toast=staff_added` so the toaster fires on next render). Disable "Next" / primary action when display name has < 2 non-whitespace characters.
- [ ] T036 [US2] Wire the "Add staff" button in `page-header.tsx` to open the wizard. This requires either (a) lifting the wizard's open-state into a `<AddStaffButton client>` wrapper, or (b) making the button itself a small client island that toggles a shared state. Pick (b): `components/lacquer/staff/add-staff-button.client.tsx` that owns the open state and renders both the button and the wizard.
- [ ] T037 [US2] Append the US2 e2e scenario to `tests/e2e/staff.spec.ts` per quickstart.md § US2. Verify: wizard opens; step 1 disables Next until name length ≥ 2; PIN-keypad auto-advances on 4th digit; mismatch resets the buffer; success screen renders; toast appears; new row visible in table; `audit_log` has one `staff.added` row with `pin_set: true`.

**Checkpoint**: An empty roster can be populated. Combined with US1, the page is half-useful (read + create).

---

## Phase 5: User Story 3 — Edit a staff member's details, role, color, and active status (Priority: P1)

**Goal**: Owner clicks a row → panel opens with drafts → changes name/role/color/active → "Save changes" enabled only when dirty → save → table updates, toast.

**Independent Test**: Click row, rename to "Mei Chen", change role to manager, save. Table row updates; toast "Changes saved". Click another row before saving — drafts discarded silently.

### Implementation for User Story 3

- [ ] T038 [US3] Create the `updateStaff` Server Action in `app/(studio)/settings/staff/actions.ts` per server-actions.contract.md § 2: load target row by `staff_id`, compute `isLastOwner`, evaluate `assertMutationAllowed` once per changed field (action = `update_name`/`update_role`/`update_color`/`update_active`) passing `newRole` for role changes, validate field shapes via `_validation.ts`, atomically UPDATE all changed fields, build the `changes`/`before`/`after` payload, `recordAudit("staff.updated", …)`, redirect with `?selected=<id>&toast=changes_saved` (or `toast=staff_deactivated&name=` if `active: true → false`).
- [ ] T039 [US3] Create `components/lacquer/staff/edit-panel.client.tsx` (Client Component) — owns `draft: StaffRow` state seeded from the selected target prop, re-keys on `?selected=` change (drafts discarded per FR-022). Calls `computeTargetPermissions(viewer, target, isLastOwner)` from `permissions.ts` and uses the returned booleans to set `disabled` on every control with a `title` tooltip explaining why (mapping in ui.contract.md § Permission-driven disabled state). Renders the header live preview, the 4 form fields, the read-only PIN row (with "Set PIN" or "Change" button — wires in US4), and the footer (Save changes + Deactivate/Reactivate link + Remove link — wires in US5). Save button disabled when `!isDirty(draft, saved) || !hasNonEmptyName`. Submit POSTs FormData to `updateStaff` with the full draft.
- [ ] T040 [US3] In `page.tsx`, when `?selected=<id>` resolves to a staff row, pass it (plus `viewer`, plus `isLastOwner`) to `<EditPanel client>`. When not selected, render `<EmptyState>` instead.
- [ ] T041 [US3] Implement row click → `?selected=` toggle. Add a small `<StaffRowLink client>` wrapper or use `next/link` with the `selected=` query param; clicking the currently-selected row navigates to `/settings/staff` (no `selected=`), per FR-018.
- [ ] T042 [US3] Append the US3 e2e scenario to `tests/e2e/staff.spec.ts` per quickstart.md § US3. Verify: row click selects + URL has `?selected=`; header preview live-updates as draft changes; table row keeps old values until Save; Save enables only when diff non-empty + name ≥ 2; click another row discards drafts; toast appears on save; `audit_log` has one `staff.updated` row with diff-aware payload.

**Checkpoint**: Edit flow works end-to-end. Combined with US1 + US2, the page covers C(R)UD for non-PIN fields.

---

## Phase 6: User Story 4 — Set or change a staff member's login PIN (Priority: P1)

**Goal**: From the edit panel, "Set PIN" (when unset) or "Change" (when set) opens a 2-step PIN modal; success updates the panel PIN row and toasts "PIN updated".

**Independent Test**: Pick a staff with no PIN, click "Set PIN", enter+confirm `1111`, modal closes, PIN row shows "4-digit PIN set", toast "PIN updated".

### Implementation for User Story 4

- [ ] T043 [US4] Create the `setStaffPin` Server Action in `app/(studio)/settings/staff/actions.ts` per server-actions.contract.md § 3: load target, assertMutationAllowed (`action="set_pin"`), validate PIN shape via `_validation.ts`, hash via `lib/auth/pin.ts:hashPin`, UPDATE `pin_hash`, audit with `{ previous_pin_set: <bool> }` (raw PIN never in payload), redirect with `?selected=<id>&toast=pin_updated`.
- [ ] T044 [US4] Create `components/lacquer/staff/change-pin-modal.client.tsx` (Client Component) — shadcn `Dialog` wrapping a 2-step Enter→Confirm flow that embeds `<NumericKeypad>`. Owns `enterBuf` and `confirmBuf` state. Auto-advances to confirm step on 4th digit of step 1 (no submit button). On 4th digit of step 2: if buffers match, submit FormData to `setStaffPin`; if mismatch, dot row flashes error, `errorMessage="PINs didn't match. Try again."` passed to keypad, both buffers reset to empty, return to enter step. Backdrop click / Cancel button closes with no state change (FR-036 + ui.contract.md § Dialog strings).
- [ ] T045 [US4] Wire the "Set PIN"/"Change" button in `edit-panel.client.tsx` to open the modal. The modal needs the selected `staff_id` and `display_name` (for the dialog title "Set PIN — {name}").
- [ ] T046 [US4] Append the US4 e2e scenario to `tests/e2e/staff.spec.ts` per quickstart.md § US4. Test both Set (target has null `pin_hash`) and Change (target has existing `pin_hash`). Verify the modal label flips ("Set" vs "Change"), the toast fires, and one `audit_log` row with `staff.pin_set` and the correct `previous_pin_set` boolean — and that the row's `payload` does NOT contain the raw PIN string.

**Checkpoint**: PIN management is in place. The seeded staff can have their PINs reset without DB access.

---

## Phase 7: User Story 5 — Deactivate, reactivate, or remove a staff member (Priority: P2)

**Goal**: Edit panel surfaces Deactivate/Reactivate + Remove links → confirm dialog → on confirm, table updates + toast.

**Independent Test**: Select an active member, click Deactivate, confirm — row turns Inactive, toast "{name} deactivated". Reactivate brings them back. Remove makes them disappear from the roster permanently.

### Implementation for User Story 5

- [ ] T047 [P] [US5] Create `components/lacquer/staff/confirm-dialog.tsx` (Server-Component wrapper around shadcn `Dialog`) — accepts `variant: "deactivate" | "remove"`, `name`, plus `<form action={action}>` slot for the destructive submit button. Renders the title, body, and CTA strings from ui.contract.md § Dialog strings. The destructive CTA uses `var(--destructive)` token. **No appointment-count warning** (Clarifications Q2 — deferred to appointments feature).
- [ ] T048 [US5] Create the `deactivateStaff` Server Action per server-actions.contract.md § 4: load target, assertMutationAllowed (`action="deactivate"`), UPDATE `active=false`, audit with `{}`, redirect with `?selected=<id>&toast=staff_deactivated&name=<encoded>`.
- [ ] T049 [US5] Create the `reactivateStaff` Server Action per server-actions.contract.md § 5: load target, assertMutationAllowed (`action="reactivate"`), UPDATE `active=true`, audit with `{}`, redirect with `?selected=<id>&toast=changes_saved`.
- [ ] T050 [US5] Create the `removeStaff` Server Action per server-actions.contract.md § 6: load target, assertMutationAllowed (`action="remove"`), UPDATE `removed_at=now(), active=false`, audit with `{ display_name_at_removal, role_at_removal }`, redirect with `?toast=staff_removed&name=<encoded>` (no `?selected=`).
- [ ] T051 [US5] In `edit-panel.client.tsx` footer, render the Deactivate / Reactivate / Remove links (Lucide `PowerOff` 16 + `Trash2` 16) wrapped in their respective confirm dialogs. Buttons disabled per `computeTargetPermissions`. The deactivate/reactivate label flips on `target.active`.
- [ ] T052 [US5] Append the US5 e2e scenario to `tests/e2e/staff.spec.ts` per quickstart.md § US5. Verify: confirm dialogs appear with correct copy (no appointment-count line); cancel/backdrop click does nothing; deactivate flips badge + label; reactivate flips back; remove disappears row and panel returns to empty state; three `audit_log` rows with the three new verbs.

**Checkpoint**: Full CRUD lifecycle covered.

---

## Phase 8: User Story 6 — Restrict who can manage staff (Priority: P2)

**Goal**: Technicians and front-desk users can't reach the page. Managers can edit non-owner rows; owner rows are read-only for managers; the role select for managers never offers "owner".

**Independent Test**: Sign in as Sam (technician) → `/settings/staff` redirects to `/dashboard`. Sign in as Jordan (manager) → page loads; click Maya (owner) → every panel control disabled with the "Only owners can edit owner accounts." tooltip; DevTools POST to `updateStaff` with Maya's id returns `?error=forbidden_target` and writes no audit row.

### Implementation for User Story 6

> Most of the authorization work was finished in Phase 2 (T013, T014). This phase wires the remaining UX details and writes the negative-path e2e tests.

- [ ] T053 [US6] Verify the route gate in `app/(studio)/settings/layout.tsx` (T014) handles the technician/front-desk redirect with no flash. Add a quick render-side guard if missing: a redirect call before any data fetch.
- [ ] T054 [US6] Verify `add-staff-wizard.client.tsx` (T035) and `edit-panel.client.tsx` (T039) use `roleOptionsFor(viewer.staff.role)` for their role-select options — managers MUST not see "Owner" anywhere. If still hardcoded, switch them to the helper.
- [ ] T055 [US6] In `edit-panel.client.tsx`, when `computeTargetPermissions` returns `canEditAnyField: false` (i.e., the manager × owner case), render a small inline banner above the form: "Only owners can edit owner accounts." (the same tooltip text, surfaced once for clarity). Use the Lacquer Alert primitive (`components/ui/alert.tsx`) with `--muted` background.
- [ ] T056 [US6] Append three US6 e2e scenarios to `tests/e2e/staff.spec.ts` per quickstart.md § US6:
   1. Technician PIN session → `/settings/staff` redirects to `/dashboard` with no flash of staff data.
   2. Manager PIN session opens Maya's row → every interactive control's `disabled` attribute is true; the "Only owners can edit owner accounts." banner is visible.
   3. Manager PIN session, raw `page.request.post()` against `updateStaff` with Maya's id and a new `display_name` → redirect contains `?error=forbidden_target`; zero new `audit_log` rows.

**Checkpoint**: Authorization model fully verified.

---

## Phase 9: User Story 7 — Get clear feedback after every action (Priority: P3)

**Goal**: A single Sonner toast appears at the bottom after each successful mutation, using the strings in `toasts.ts`.

**Independent Test**: Perform Add → Edit → Set PIN → Deactivate → Reactivate → Remove in sequence; each shows its expected toast. Two rapid mutations: second toast replaces the first (no stacking).

### Implementation for User Story 7

- [ ] T057 [US7] Verify Sonner is already mounted in the studio shell (feature 003 added `<Toaster />` via `components/ui/sonner.tsx`); if not present in `app/(studio)/layout.tsx`, add it there.
- [ ] T058 [US7] Create `components/lacquer/staff/staff-toaster.client.tsx` (Client Component) — on mount, reads `searchParams.get("toast")` + `searchParams.get("name")`, calls the matching `TOAST.*` function with the name, fires `toast.success(message)` (or `toast.error(message)` for destructive variants `forbidden_target` / `last_owner` / `self_edit_blocked` / `not_found` / `forbidden`), then calls `router.replace(pathname + cleanedSearchParams)` to strip the params. Uses `useEffect` with empty deps + a ref guard so it only fires once per navigation.
- [ ] T059 [US7] Mount `<StaffToaster client>` once at the bottom of `app/(studio)/settings/staff/page.tsx`. It needs no props (reads from `useSearchParams`).
- [ ] T060 [US7] Append the US7 e2e scenario to `tests/e2e/staff.spec.ts` per quickstart.md § US7. Verify each of the 6 mutation toasts (5 success + 1 destructive variant via `?error=forbidden_target`). For the stacking test: perform two saves in < 200 ms apart, assert only one toast is visible at any time (Sonner default behavior).

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Bring the surface to ship-quality — design audit, performance verification, and the quickstart walkthrough.

- [ ] T061 [P] Run the design-system audit: spawn the `speckit-design-auditor` agent against `app/(studio)/settings/staff/` and `components/lacquer/{settings,staff}/`. Fix any reported token violations. Confirm side-by-side against `design-system/prototypes/user-management/*.jsx`.
- [ ] T062 Verify Constitution-IV performance budgets from research.md § R14: time the initial RSC render of a 50-row roster (target < 200 ms p95) and the search keystroke re-render (target < 16 ms) using Next.js's instrumentation hooks or a manual `performance.now()` probe.
- [ ] T063 Run the full quickstart.md walkthrough end-to-end as a manual smoke test: migrate, seed, sign in as Maya, exercise US1–US7 in order, then sign in as Jordan to exercise US6 negatives. Inspect the audit log query at the end and confirm row count + payload shapes match audit.contract.md.
- [ ] T064 [P] Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:e2e`. All must pass before merge.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion. **Blocks all user stories.** Internal ordering: T005 → T006/T007 → T008 → T009 (migration must apply before types regenerate); T010 → T011; T012 → T013; T014 → T015–T017 (layout before pages); T018–T022 can run in parallel.
- **User Stories (Phase 3+)**: All depend on Foundational completion. After that:
  - US1 (P1) is the MVP.
  - US2, US3, US4 (all P1) build on US1's table; US3 depends on US1's panel slot; US4 depends on US3's panel.
  - US5 (P2) extends US3's panel.
  - US6 (P2) is mostly verification + e2e of work done in Phase 2 — can run in parallel with US2–US5.
  - US7 (P3) depends on at least one mutation existing (i.e., US2).
- **Polish (Phase 10)**: Depends on all user stories being complete.

### User-story dependency graph

```
                         ┌── US2 (Add) ────┐
US1 (Roster, MVP) ───────┤                 │
                         ├── US3 (Edit) ───┼── US4 (PIN) ─┐
                         │                 │              ├── US5 (Deactivate/Remove)
                         │                 │              │
                         └── US6 (Authz, parallel) ───────┘
                                                          │
                                                          └── US7 (Toasts)
```

### Within each user story

- Tests for trigger / permissions / audit / sort are landed RED before implementation (Constitution IV).
- Models / shared modules before client components.
- Server Actions before the client component that POSTs to them.
- Each user story phase ends with its e2e scenario appended to `tests/e2e/staff.spec.ts`.

### Parallel opportunities

- T001, T003, T004 can run in parallel after T002 (the shadcn vendoring).
- T015, T016, T017, T018, T019, T020, T021, T022 in Phase 2 can all run in parallel once their foundational predecessors (T005–T013) are done.
- T023, T024, T025 in Phase 3 can run in parallel.
- T033 can run in parallel with T034 in Phase 4.
- T047 can run in parallel with T048–T050 in Phase 7 (different files).
- T061 and T064 in Phase 10 can run in parallel.

---

## Parallel Example: Phase 2 closing tasks

```bash
# After T013 (permissions.ts) and T014 (settings layout) are complete,
# fire these in parallel:
Task: "T015 — components/lacquer/settings/tab-bar.tsx"
Task: "T016 — app/(studio)/settings/page.tsx redirect"
Task: "T017 — placeholder pages for general/notifications/billing"
Task: "T018 — components/lacquer/badge.tsx"
Task: "T019 — components/lacquer/numeric-keypad.client.tsx"
Task: "T020 — _validation.ts"
Task: "T021 — toasts.ts"
Task: "T022 — tests/e2e/_db.ts resetStaffToSeed()"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (DB + audit + permissions + shell + shared primitives).
3. Complete Phase 3: US1 — page loads, roster renders, search + show-inactive work.
4. **STOP and VALIDATE**: Open `/settings/staff` as Maya; confirm the table is correct.
5. Demo. The page is read-only but usable as a "who's on staff" reference.

### Incremental delivery

1. Setup + Foundational → Foundation ready (no UI yet).
2. + US1 → MVP (read-only roster).
3. + US2 → Salon can onboard new staff without DB access.
4. + US3 → Edits work (rename / role / color / active toggle).
5. + US4 → PIN reset path eliminates "I forgot my PIN" tickets.
6. + US5 → Departed staff can be deactivated or removed.
7. + US6 → Manager permissions verified.
8. + US7 → Toasts add the trust polish.
9. + Polish → Design audit, perf budgets, full quickstart smoke.

### Parallel team strategy

After Phase 2 completes:

- Dev A: US2 (Add wizard + addStaff action)
- Dev B: US3 (Edit panel + updateStaff action) then US4 (Change PIN)
- Dev C: US5 (Deactivate/Reactivate/Remove dialogs and actions) and US6 (e2e negatives) in parallel
- Whoever finishes first: US7 (Toaster) and Phase 10 (Polish).

---

## Notes

- Every Server Action's prelude is identical (per server-actions.contract.md § Shared prelude). Consider extracting the prelude steps 1–5 into a `_prelude.ts` helper if duplication grows past 3 actions.
- The permission matrix in `permissions.ts` is the **trust boundary**. Don't add per-action ad-hoc role checks elsewhere; route everything through `assertMutationAllowed`.
- No audit payload should ever contain a raw PIN or an `authorizing_staff_id` (the override is gone — Clarifications Q1). Tests in T010 assert both.
- Verify Vitest tests fail BEFORE writing their implementation (T005/T010/T012/T023 are all gated RED-first).
- Commit after each task or each phase checkpoint.
