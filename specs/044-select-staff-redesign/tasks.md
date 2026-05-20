---

description: "Task list for Select staff redesign — avatar grid + modal keypad"
---

# Tasks: Select staff redesign — avatar grid + modal keypad

**Input**: Design documents from `/specs/044-select-staff-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/submit-pin.contract.md, quickstart.md

**Tests**: Included — auth is a critical path (Constitution IV: "Each v1 feature MUST ship with a Playwright end-to-end test"; auth logic is test-first). E2E tests are written first in each user-story phase and fail until that story's implementation lands.

**Organization**: Tasks are grouped by user story so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 — Setup / Foundational / Polish tasks carry no story label
- Exact file paths are in each description

## Path Conventions

Single Next.js project at the repository root — `app/`, `components/`, `styles/`, `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prototype reference, route-group scaffold, and the screen stylesheet.

- [X] T001 [P] Verify the Option D prototype bundle is fully vendored under `design-system/prototypes/select-staff/` (`select-staff-variants.jsx` with `VariantAvatarGrid`, `Select Staff Redesign.html`, `colors_and_type.css`, `design-canvas.jsx`) per FR-028; add the prototype→surface mapping line to `docs/system-design.md` § "Reuse from the design system handoff": `prototypes/select-staff/select-staff-variants.jsx (VariantAvatarGrid / Option D) → app/(device)/select-staff/page.tsx`.
- [X] T002 [P] Create the `(device)` route-group layout `app/(device)/layout.tsx` — a full-bleed wrapper (no brand panel) with the side-effect `import "@/styles/select-staff.css"`; file-header comment explaining why `/select-staff` leaves the `(auth)` shell (spec Assumptions, FR-003).
- [X] T003 [P] Create `styles/select-staff.css` — token-only rules for the full-viewport screen shell, the header row, the `ScreenHeader`, the avatar grid (`repeat(auto-fill, minmax(120px, 1fr))`), the avatar tile, the modal body, the 4-position PIN indicator, and the 12-key keypad. Every color/spacing/radius/shadow/type value resolves to a `styles/tokens.css` variable (Constitution I, FR-026). Search and error-state styles are added in later phases.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The Server Action, the RSC page, and the client-screen skeleton that every user story builds on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [X] T004 Create `app/(device)/select-staff/actions.ts` — port `submitPin` from `app/(auth)/select-staff/actions.ts`; change the two failure branches (`invalid_target`, `mismatch`) to `return { ok: false }` instead of `redirect(...)`; keep the success path (cookie issuance, `sanitizeNext` redirect, `pin_reset_admin_at` clear) and both `recordAuth` writes unchanged; export `type SubmitPinResult = { ok: false }`. Implements `contracts/submit-pin.contract.md` (FR-015–FR-017, FR-020, FR-024).
- [X] T005 Create `components/lacquer/select-staff/select-staff-screen.client.tsx` — `"use client"`, props `{ roster, next }`; renders the screen header (Tang Nails brand wordmark + a "Sign out" control wired to `signOut` from `@/app/(studio)/actions` — FR-007) and the `ScreenHeader` ("Who's using this device?" / "Tap your avatar to sign in"); the grid/search/modal regions are filled in by US1–US3. This is the typecheck anchor for `page.tsx`.
- [X] T006 Create `app/(device)/select-staff/page.tsx` as an RSC — resolve the Supabase device user (redirect to `/login?next=` when absent — FR-023); query the roster `select id, display_name, role, color_token, pin_reset_admin_at from staff where active = true and pin_hash is not null order by role, display_name` (FR-004, FR-005); render the existing "No staff configured" guidance + sign-out when the roster is empty (FR-022); otherwise render `<SelectStaffScreen roster next />`; read only `?next=` (drop `error` / `selectedTileId`). In the same task, delete the old `app/(auth)/select-staff/` folder and the now-orphaned components `components/lacquer/staff-roster.tsx`, `components/lacquer/staff-tile.tsx`, `components/lacquer/pin-keypad.tsx` (avoids a duplicate `/select-staff` route and broken imports — verified select-staff-only by grep, see research R10).

**Checkpoint**: Cheap gates green (format/lint/typecheck/unit). `/select-staff` renders the full-bleed header + sign out. E2E begins at US1 (the old `auth.spec.ts` select-staff block is rewritten in T007).

---

## Phase 3: User Story 1 - Pick your avatar and sign in (Priority: P1) 🎯 MVP

**Goal**: A full-viewport avatar grid; tapping a tile opens a centered modal keypad; the correct PIN auto-verifies on the 4th digit and signs the staff member in to their destination.

**Independent Test**: Load `/select-staff` with a multi-person roster, tap any tile, confirm a modal opens with that person's avatar/name/role + keypad, enter the correct PIN, confirm sign-in and navigation to the destination.

### Tests for User Story 1

- [X] T007 [P] [US1] In `tests/e2e/auth.spec.ts`, rewrite the select-staff e2e coverage as a `044-US1` describe block — assert the full-width avatar grid renders one tile per eligible staff with no `.auth-form-panel`; tapping a tile opens a `[role="dialog"]` showing the staff avatar/name/role + keypad; entering the correct PIN auto-verifies on the 4th digit and lands on the destination with the operator chip; the 4-position indicator fills one position per digit and never shows the typed numbers. Update the keypad/tile interactions in the existing `US3` (c)/(d) and `US5` (f) blocks to drive the new modal. (Fails until US1 ships.)

### Implementation for User Story 1

- [X] T008 [P] [US1] Create `components/lacquer/select-staff/staff-avatar-tile.tsx` — a presentational `<button>` tile: token-tinted initials avatar (~56px), display name (single-line truncate for the long-name edge case), role label; `data-staff-id` attribute; calls an `onSelect(staffId)` callback prop (FR-001, FR-002, FR-026).
- [X] T009 [US1] Extend `components/lacquer/select-staff/select-staff-screen.client.tsx` — render the avatar grid (`StaffAvatarTile` per roster row in role-then-name order — FR-004); own `selectedStaffId` client state; open the modal on tile tap; make the grid the single `flex: 1; overflow-y: auto` region so the header stays pinned when the grid overflows (FR-006).
- [X] T010 [P] [US1] Create `components/lacquer/select-staff/pin-pad.tsx` — a 12-key (3×4) callback keypad: digits 1–9 then `Clear` / `0` / `Backspace` (FR-013); `onDigit` / `onClear` / `onBackspace` props; a `window` `keydown` listener (mounted while the modal is open) for digit keys and `Backspace` only — `Escape` is left to the `Dialog` (FR-014). Tokens only.
- [X] T011 [US1] Create `components/lacquer/select-staff/pin-entry-modal.client.tsx` — a shadcn `Dialog` modal (`components/ui/dialog.tsx`): staff avatar (~80px), display name, role, a 4-position PIN indicator that fills per digit and never reveals the digits (FR-012), and `<PinPad>`; on the 4th digit call `submitPin` (FormData: `staffId`, `pin`, `next`) inside a transition; a correct PIN throws the success redirect and the modal unmounts with the navigation (FR-015, FR-016, FR-025). Props `{ staff, next, onClose }`.
- [X] T012 [US1] Wire `<PinEntryModal>` into `select-staff-screen.client.tsx` — render it for the `selectedStaffId` row, pass `next`; thread `?next=` from `page.tsx` → screen → modal → the `submitPin` FormData (FR-025).

**Checkpoint**: US1 fully functional — `npx playwright test tests/e2e/auth.spec.ts -g "044-US1"` green. Tap a tile, enter the correct PIN, signed in.

---

## Phase 4: User Story 2 - Find yourself fast in a large roster (Priority: P2)

**Goal**: A search field that narrows the avatar grid to display-name matches as the user types.

**Independent Test**: Load `/select-staff` with a large roster, type part of a name, confirm the grid narrows per character; a no-match query shows an empty-result message naming the text.

### Tests for User Story 2

- [X] T013 [P] [US2] In `tests/e2e/auth.spec.ts`, add a `044-US2` describe block — typing into the search field narrows the grid as each character is typed (no submit step); a no-match query shows an empty-result message that names the typed text; tapping a filtered tile opens the modal as from the unfiltered grid; clearing the field restores the full roster. (Fails until US2 ships.)

### Implementation for User Story 2

- [X] T014 [P] [US2] Create `components/lacquer/select-staff/staff-search-field.tsx` — a controlled search `<input>` with a Lucide search icon (1.5px stroke); `value` / `onChange` props; placeholder "Search staff"; token-only styling.
- [X] T015 [US2] Extend `components/lacquer/select-staff/select-staff-screen.client.tsx` — own `query` client state; render `<StaffSearchField>` pinned below the `ScreenHeader` (stays visible while the grid scrolls — FR-006); filter the grid with a synchronous `useMemo` (case-insensitive partial match on `display_name` only — FR-008, FR-009); render an empty-result message naming the query when nothing matches (FR-010).
- [X] T016 [US2] Add the search-field and empty-result styles to `styles/select-staff.css` — token-only.

**Checkpoint**: US1 + US2 — `npx playwright test tests/e2e/auth.spec.ts -g "044-US2"` green. The grid filters live.

---

## Phase 5: User Story 3 - Recover from a mistake without losing your place (Priority: P3)

**Goal**: A wrong PIN keeps the modal open for an immediate retry; the modal is dismissible without a failed attempt; the admin-PIN-reset notice is shown.

**Independent Test**: Open the modal, enter a wrong PIN, confirm the modal stays open with an error cue and cleared entry, then enter the correct PIN and sign in; separately, open the modal and dismiss it without signing in.

### Tests for User Story 3

- [X] T017 [P] [US3] In `tests/e2e/auth.spec.ts`, add a `044-US3` describe block — a wrong 4-digit PIN keeps the modal open with an error indicator and a cleared entry, then a correct retry succeeds in the same modal; dismissing via backdrop click, the close control, and `Escape` each return to the grid with no one signed in; selecting a different tile starts PIN entry fresh; a staff member with `pin_reset_admin_at` set shows the admin-PIN-reset notice. Update the existing `US3` (b) block to drop the removed `.selected` tile-modifier assertion. (Fails until US3 ships.)

### Implementation for User Story 3

- [X] T018 [US3] Extend `components/lacquer/select-staff/pin-entry-modal.client.tsx` — on a resolved `{ ok: false }` from `submitPin`, paint the error state on the PIN indicator, clear the buffer, keep the modal open for an immediate retry; reset the keypad buffer deterministically between attempts (attempt-keyed `<PinPad>` remount) so two identical wrong PINs both clear (FR-017, research R3/R4).
- [X] T019 [US3] Extend `components/lacquer/select-staff/pin-entry-modal.client.tsx` — route backdrop click, the close control, and `Escape` through `Dialog` `onOpenChange` → `onClose` clears `selectedStaffId` with no audit attempt (FR-018); confirm selecting a different tile mounts a fresh modal with an empty buffer (FR-019).
- [X] T020 [P] [US3] Extend `components/lacquer/select-staff/staff-avatar-tile.tsx` — when `pin_reset_admin_at` is non-null, show a Lucide `Info` badge with a tooltip "Your PIN was reset by an owner. Try your new PIN." (FR-021).
- [X] T021 [P] [US3] Add the PIN-indicator error-state and the admin-PIN-reset-notice styles to `styles/select-staff.css` — destructive token for the error state; token-only.

**Checkpoint**: All three stories functional — `npx playwright test tests/e2e/auth.spec.ts -g "044-US3"` green.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Remove the dead surface, audit the design, run the full gate set.

- [X] T022 [P] Remove the select-staff-only rule block from `styles/auth.css` (`.auth-roster`, `.auth-keypad*`, `.auth-staff-tile`, `.auth-keypad-display`, `.auth-headline`, `.auth-form-row`, `.auth-form-actions`) and its section comment — these were referenced only by the deleted old select-staff surface (research R10).
- [X] T023 [P] Update the file-header comment in `app/(auth)/layout.tsx` to drop the claim that `/select-staff` inherits the `(auth)` shell (no longer true — it now lives in `(device)`).
- [X] T026 [DISCOVERED] Migrate the remaining cross-suite e2e sign-in helpers off the removed `?selectedTileId=` tile-selection flow to the new `[role="dialog"]` modal flow — `tests/e2e/_auth-state.ts`, `services.spec.ts`, `services-deductions.spec.ts`, `past-cash-counts.spec.ts`, `onboarding.spec.ts` (8 occurrences). Blast radius the plan/tasks missed; required for the T025 full e2e gate. Canonical pattern: the already-migrated `signInAs` in `_fixtures.ts`.
- [X] T024 Design-system audit — compare `/select-staff` (grid, modal, keypad, indicator) side by side with `design-system/prototypes/select-staff/Select Staff Redesign.html` (Option D); confirm every color/spacing/radius/shadow/type value traces to a `styles/tokens.css` token, icons are Lucide, and the modal uses the shadcn `Dialog` primitive (Constitution I, FR-026, FR-027). — PASS, no violations.
- [X] T025 Run the full quality gate set from the repo root — `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. format:check / typecheck / unit (736 passed) / e2e (225 passed, 12 by-design skips, 0 failed — incl. all 17 `044-US*` tests and every migrated helper spec) all green. `npm run lint` exits 1 only because of a stale ignore glob in `eslint.config.mjs` (`.worktrees/**` vs the actual `.claude/worktrees/**`) letting ESLint scan sibling worktrees; `.claude/worktrees/` is gitignored so CI is unaffected. Feature source is lint-clean (0 errors).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. All three tasks are `[P]`.
- **Foundational (Phase 2)**: Depends on Setup. T004 → T005 → T006 are sequential (T006's `page.tsx` imports the T005 screen; T006 deletes the old route). **Blocks all user stories.**
- **User Stories (Phase 3–5)**: All depend on Foundational. They share `select-staff-screen.client.tsx` / `pin-entry-modal.client.tsx`, so run them **sequentially in priority order** (US1 → US2 → US3), not in parallel.
- **Polish (Phase 6)**: Depends on all user stories complete.

### User Story Dependencies

- **US1 (P1)**: Builds the grid + tile + modal + keypad on the Foundational screen skeleton — the MVP. No dependency on US2/US3.
- **US2 (P2)**: Extends the US1 screen with search. Independently testable; the sign-in flow works without it.
- **US3 (P3)**: Extends the US1 modal/tile with error + cancel recovery and the pin-reset notice. Independently testable; the happy path works without it.

### Within Each User Story

- The e2e test task is authored first and fails until the implementation lands.
- Component files (`[P]`) before the screen/modal wiring that consumes them.
- Story complete (its `-g "044-USn"` slice green) before moving to the next priority.

### Parallel Opportunities

- **Setup**: T001, T002, T003 all `[P]` — run together.
- **US1**: T007 (test), T008 (tile), T010 (keypad) are `[P]` — different files. T009 needs T008; T011 needs T010; T012 needs T009 + T011.
- **US2**: T013 (test) and T014 (search field) are `[P]`. T015 needs T014; T016 follows T015.
- **US3**: T017 (test), T020 (tile notice), T021 (styles) are `[P]`. T018 and T019 both edit the modal — sequential.
- **Polish**: T022, T023 are `[P]`. T024 then T025 last.

---

## Parallel Example: User Story 1

```bash
# Author the test and the leaf components together:
Task: "T007 e2e 044-US1 block in tests/e2e/auth.spec.ts"
Task: "T008 staff-avatar-tile.tsx in components/lacquer/select-staff/"
Task: "T010 pin-pad.tsx in components/lacquer/select-staff/"

# Then wire them in (sequential — shared screen/modal files):
Task: "T009 grid + selection state in select-staff-screen.client.tsx"
Task: "T011 pin-entry-modal.client.tsx"
Task: "T012 wire modal into the screen"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 US1.
2. **STOP and VALIDATE**: `-g "044-US1"` green; tap a tile, enter the correct PIN, sign in.
3. This is a shippable MVP — the avatar grid + modal keypad already replace the broken scrolling layout.

### Incremental Delivery

1. Setup + Foundational → screen scaffold ready.
2. US1 → modal sign-in works → MVP.
3. US2 → search narrows the roster.
4. US3 → error/cancel recovery + pin-reset notice.
5. Polish → dead code removed, design audited, full gates green.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task. `[Story]` maps a task to a spec user story.
- Intermediate phase checkpoints run **scoped** gates (`-g "044-USn"`, `npm run test:changed`, prettier/eslint over the diff). The full five-gate suite runs once, at T025. See CLAUDE.md § "Scoping intermediate phase gates".
- The Foundational checkpoint runs the cheap gates only (format/lint/typecheck/unit) — e2e starts at US1 once T007 has rewritten the `auth.spec.ts` select-staff block.
- No schema change — no `supabase/migrations/**` task (data-model.md).
- `submitPin`'s preserved audit writes (`staff.signed_in` / `staff.pin_failed`) are the SC-007 invariant — keep them `await`ed before the action returns/redirects (Constitution III; contract § Guarantees).
- `app/(studio)/actions.ts` `switchStaff` still appends `&selectedTileId=` to its `/select-staff` redirect — the redesigned page ignores it (inert no-op); removing it is out of scope (research R6).
- This is an auth-critical-path PR — the reviewer confirms Constitution Principles II, III, and IV.
