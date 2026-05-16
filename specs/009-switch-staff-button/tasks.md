---

description: "Task list for Switch Staff — Standalone Top‑Nav Button (009-switch-staff-button)"
---

# Tasks: Switch Staff — Standalone Top‑Nav Button

**Input**: Design documents from `/specs/009-switch-staff-button/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [quickstart.md](./quickstart.md). No data-model.md or contracts/ — feature is a UI relocation with no entities or external interfaces (see plan.md "Phase 1 — Design & Contracts").

**Tests**: REQUIRED for this feature. Switch‑staff is part of the auth critical path; Constitution Principle IV (Test‑First for Critical Paths, NON‑NEGOTIABLE) mandates Vitest unit coverage and a Playwright e2e flow. Tests are written and shown to fail before the implementation tasks that satisfy them.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently. US1 (P1) delivers the standalone top‑nav button and is the MVP. US2 (P2) is a verification‑only phase — discoverability is delivered by the same component built for US1, so US2 adds no new code, only verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2). Setup/Foundational/Polish phases have no story label.
- File paths are absolute repo‑relative; every task is immediately executable.

## Path Conventions

- **Project type**: single Next.js 16 web app (App Router, RSC + Server Actions).
- **Source roots**: `app/(studio)/`, `components/lacquer/`, `styles/`, `tests/unit/`, `tests/e2e/`.
- No new top‑level directories created by this feature.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: confirm the baseline is green before any edit so a later failure is unambiguously caused by this feature's changes.

- [ ] T001 Confirm baseline gates pass on `main`'s tip (no edits yet): run, in order, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e -- --workers=1`. All five MUST be green before starting Phase 2. If any fails, fix on `main` first — do not start this feature on a red baseline.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: add the Lacquer‑token CSS the new button and topbar divider depend on. This blocks both the unit render contract (which checks for `data-slot="switch-staff-button"` and the rendered classes) and the visual verification in US1 / US2.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Add `.studio-topbar-sep` and `.studio-switch-staff` classes (plus the `[disabled]` and `:hover` variants) to `styles/studio.css` per [quickstart.md §3](./quickstart.md). Every value MUST resolve to an existing token in `styles/tokens.css` (Constitution Principle I) — no raw hex, no off‑scale spacing. Place the additions adjacent to the existing topbar block (after `.studio-topbar-right`).

**Checkpoint**: Foundation ready — US1 implementation can now begin.

---

## Phase 3: User Story 1 — One‑click switch staff from the top nav (Priority: P1) 🎯 MVP

**Goal**: replace the chip‑dropdown "Switch staff" path with a standalone, labeled, always‑visible button in the studio topbar — to the left of the operator chip, separated by a 1px divider. Activating the button invokes the existing `switchStaff()` Server Action; the chip's dropdown is reduced to "Sign out" only.

**Independent Test**: with the dev server running and a signed‑in operator, the studio topbar shows a button labeled "Switch staff" with a swap icon. Clicking it once lands on `/select-staff` (same outcome as the current dropdown path, but in one click). Opening the operator chip's dropdown shows only "Sign out."

### Tests for User Story 1 (REQUIRED — Constitution Principle IV)

> **NOTE**: Write these tests FIRST and confirm they FAIL against the unchanged code before starting implementation (T006–T008). Red → Green is the contract for the auth critical path.

- [ ] T003 [P] [US1] Create unit spec `tests/unit/auth/operator-menu.test.tsx` with three Testing Library cases (Vitest + jsdom, matching the existing `tests/unit/auth/*.test.ts` setup):
  1. Render `<OperatorMenu><OperatorChip staff={fixture} /></OperatorMenu>`, open the dropdown by clicking the chip, then assert `screen.queryByRole("menuitem", { name: /switch staff/i })` is `null` AND `screen.getByRole("menuitem", { name: /sign out/i })` is in the document.
  2. Render `<SwitchStaffButton />` from `@/components/lacquer/switch-staff-button`. Assert a submit button named "Switch staff" exists, has `data-slot="switch-staff-button"`, and contains an `<svg>` (the Lucide `Repeat` icon).
  3. Assert the submit button's closest `<form>` has its `action` prop set to the `switchStaff` server‑action reference (use a module mock — `vi.mock("@/app/(studio)/actions", () => ({ switchStaff: vi.fn(), signOut: vi.fn() }))` — and assert via the rendered DOM that the form's action attribute is the mocked function reference).
- [ ] T004 [US1] In `tests/e2e/auth.spec.ts`, replace each of the five existing "open chip dropdown → click Switch staff menuitem" call sequences with a single `await page.locator("[data-slot='switch-staff-button']").click();`. Affected callsites at branch start: lines around 288–292, 309–310, 323–324, 343–344, and 883–884 (US5 degraded‑shell `test.fixme` block — update the assertion target there too). After the edit, no `getByRole("menuitem", { name: /Switch staff/ })` references remain in the file.
- [ ] T005 [US1] In `tests/e2e/auth.spec.ts`, add one new test inside the existing `test.describe("US3: Switch staff at shift change", …)` block, named `"(e) operator chip dropdown contains only Sign out"`. The test signs in + pins in as Maya (reuse helpers already in the file), clicks `[data-slot='operator-chip']`, asserts `page.getByRole("menuitem", { name: /Switch staff/ })` has count 0, and asserts `page.getByRole("menuitem", { name: /Sign out/ })` is visible. (Same file as T004 — sequential, not parallel.)

### Implementation for User Story 1

- [ ] T006 [P] [US1] Create `components/lacquer/switch-staff-button.tsx` exactly per [quickstart.md §4](./quickstart.md): `"use client"` module exporting `SwitchStaffButton`, wrapping a `<form action={switchStaff}>` around an inner `SubmitButton` that uses `useFormStatus()` from `react-dom` to set `disabled` and `aria-busy` while pending. The submit `<button>` carries `className="studio-switch-staff"`, `data-slot="switch-staff-button"`, and renders `<Repeat size={16} strokeWidth={1.5} aria-hidden="true" />` followed by the literal text "Switch staff". Import `switchStaff` from `@/app/(studio)/actions`.
- [ ] T007 [P] [US1] Edit `components/lacquer/operator-menu.tsx`: remove the first `<DropdownMenuItem>` (the one wrapping `<form action={switchStaff}>`). Remove now‑unused imports — `Repeat` from `lucide-react` and `switchStaff` from `@/app/(studio)/actions` — keeping `LogOut` and `signOut`. The dropdown content now contains only the Sign out item; everything else (trigger asChild, alignment, sideOffset) stays as is.
- [ ] T008 [US1] Edit `app/(studio)/layout.tsx`: add `import { SwitchStaffButton } from "@/components/lacquer/switch-staff-button";` alongside the existing `components/lacquer/*` imports. Inside the existing `<div className="studio-topbar-right">`, insert two siblings *before* `<OperatorMenu>` — `<SwitchStaffButton />` and `<span className="studio-topbar-sep" aria-hidden="true" />`. The button must render in both the healthy and `degraded` branches (it already will — there is no conditional around `.studio-topbar-right`). Depends on T006 (the import target must exist) and T002 (the CSS classes must exist).

### Verification for User Story 1

- [ ] T009 [US1] Run `npm test` and `npm run test:e2e -- --workers=1`; confirm the three unit cases from T003 and the five updated + one new e2e cases from T004/T005 all now PASS. If any test still fails, do not proceed to US2 — debug against the spec's FR list, not the test.

**Checkpoint**: US1 is fully functional and independently testable. The MVP could ship from this checkpoint. SC‑001 (one click), SC‑003 (dropdown has only Sign out), and SC‑005 (no regression on the switch outcome) are now provable.

---

## Phase 4: User Story 2 — Discoverability for new staff (Priority: P2)

**Goal**: confirm that the labeled, always‑visible button delivered in US1 is discoverable and keyboard‑accessible without any further code. US2 is verification‑only — no new components or styles.

**Independent Test**: a user who has not been told where "Switch staff" lives can locate and use it from the studio topbar in under 10 seconds (SC‑004), without opening any menu.

### Verification for User Story 2

- [ ] T010 [US2] Manual visual side‑by‑side: run `npm run dev`, sign in as a seeded staff member, and load any studio page. Compare against the `Switch Staff Nav.html` mockup (extracted from the Lacquer design archive; described in [research.md R1](./research.md)). Confirm Option B's geometry: button is to the **left** of the operator chip, 1px vertical divider between them, swap icon at 16px / 1.5 stroke, text label "Switch staff" in Inter at `var(--text-sm)`. Hover transitions match `var(--accent)` background, `var(--foreground)` text, `var(--ring)` border (FR‑002, FR‑009; Constitution Principle I).
- [ ] T011 [US2] Keyboard + a11y verification, also against `npm run dev`: from the topbar brand, press Tab — the next focus stop MUST be the Switch staff button (which appears before the chip in DOM order per T008), then the chip. With focus on the button, Enter MUST submit; reset focus, Space MUST submit. Confirm the focus ring is visible against `var(--card)` background. Open the chip dropdown with Enter/Space — confirm only "Sign out" is listed (visual confirmation of FR‑004). Covers FR‑005 and the keyboard‑only edge case from the spec.

**Checkpoint**: US2 verified. SC‑002 (always visible) and SC‑004 (discoverable in <10s) are now provable.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: pre‑push gate confirmation, final design‑system trace, and a sweep for leftover references.

- [ ] T012 Run the full Tang Nails pre‑push gate set, in order, against the feature branch: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e -- --workers=1`. All five MUST be green. This is the same set CI runs (Constitution v1.0.3 §"CI gates" / `CLAUDE.md` §"Pre‑push quality gates"); a green local run is the contract that the PR will not bounce on a formatting or lint nit.
- [ ] T013 [P] Final design‑system trace: re‑read the two CSS additions in `styles/studio.css` (`.studio-topbar-sep`, `.studio-switch-staff`) and `components/lacquer/switch-staff-button.tsx`. Confirm every visual value resolves to a `var(--*)` in `styles/tokens.css` (no raw hex, no `px` outside the explicitly allowed 1px border, no off‑scale spacing). Confirm the icon is Lucide at `size={16} strokeWidth={1.5}` (Constitution Principle I, NON‑NEGOTIABLE).
- [ ] T014 [P] Reference sweep: `git grep -nE "menuitem.*Switch staff|Switch staff.*menuitem" tests app components docs` MUST return zero lines. `git grep -nE "data-slot=.switch-staff-button." tests app components` MUST find exactly three lines — the component (T006), one e2e test update group (T004 — note: the count is the number of distinct *occurrences*, not the number of test cases; verify against your final edits), and the new test in T005. Adjust the assertion if your final selector layout differs, but document any deviation in the PR description.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no dependencies — start immediately.
- **Foundational (Phase 2)** depends on Setup. Blocks both user stories because the CSS classes are referenced from the new component and from the topbar markup.
- **US1 (Phase 3)** depends on Foundational. Test tasks (T003–T005) must complete and FAIL before implementation tasks (T006–T008) begin.
- **US2 (Phase 4)** depends on US1 — US2 is verification of what US1 ships, with no new code, so it cannot start until T009 is green.
- **Polish (Phase 5)** depends on US1 and US2 being complete.

### User-story dependencies

- US1 (P1) is independent — once Foundational is done, it can ship as MVP without US2.
- US2 (P2) depends on US1 *delivery*, not just code: there is nothing to verify until the button is rendered.

### Within US1 (the only story that has both tests and implementation)

- Test tasks T003, T004, T005 run before implementation tasks T006, T007, T008. Inside the test group, T003 (`tests/unit/auth/operator-menu.test.tsx` — new file) is parallel‑safe with T004 and T005; T004 and T005 both edit `tests/e2e/auth.spec.ts`, so they are sequential with each other.
- Inside the implementation group, T006 (new file) and T007 (`operator-menu.tsx`) are parallel‑safe. T008 (`app/(studio)/layout.tsx`) depends on T006 because it imports the new component, and on T002 because it references the new CSS class.
- T009 (verify tests pass) is the last task in US1.

### Parallel opportunities

- T002 (Phase 2) is a single task — no parallel slot.
- In Phase 3, T003 || T004 (different files, both writing failing tests). T005 must follow T004 (same file).
- In Phase 3 implementation, T006 || T007 (different files); T008 must follow T006.
- In Phase 5, T013 and T014 are read‑only review/scan tasks and can run in parallel; both must follow T012's green gate run.

---

## Parallel Example: User Story 1

```bash
# Write the failing tests first — different files, run together:
Task: "T003 [P] [US1] Create unit spec tests/unit/auth/operator-menu.test.tsx"
Task: "T004 [US1] Flip 5 e2e callsites in tests/e2e/auth.spec.ts to [data-slot='switch-staff-button']"
# Then in the same file, append the new e2e case (sequential after T004):
Task: "T005 [US1] Add '(e) operator chip dropdown contains only Sign out' to tests/e2e/auth.spec.ts"

# After tests are red, implementation — different files, run together:
Task: "T006 [P] [US1] Create components/lacquer/switch-staff-button.tsx (client component, useFormStatus)"
Task: "T007 [P] [US1] Trim components/lacquer/operator-menu.tsx — remove Switch staff DropdownMenuItem"
# Then (sequential because it imports T006's module):
Task: "T008 [US1] Slot <SwitchStaffButton /> + divider into app/(studio)/layout.tsx"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. **Phase 1** — confirm baseline gates green (T001).
2. **Phase 2** — add CSS (T002).
3. **Phase 3** — write failing tests (T003 → T004 → T005), implement (T006 + T007 in parallel, then T008), verify (T009).
4. **Validate**: the spec's three US1 acceptance scenarios pass and SC‑001 / SC‑003 / SC‑005 are demonstrably true.
5. **Ship**: this is the MVP. The feature is shippable here even if US2 verification is deferred.

### Incremental delivery

US1 ships on its own. US2 is a verification phase that can be performed against the same PR or in a follow‑up review session — either way it adds no risk to US1's release.

### Parallel team strategy

With two developers, one can pick up T003 (new unit file) while the other handles T004 + T005 (sequential e2e edits). At the implementation phase, one takes T006 (new component) and the other takes T007 (trim dropdown); T008 picks whichever finishes first.

---

## Notes

- This is a small, scoped UI relocation. The whole feature is ~70–110 LOC of source plus one new test file and edits to one existing test file (see plan.md "Scale/Scope").
- The `data-slot="switch-staff-button"` attribute is the contract between the new component and the e2e suite — do not rename it without updating T004/T005's selector.
- Constitution Principle IV requires the test tasks (T003–T005) to be RED before T006–T008 are written. Resist the temptation to write the component first.
- Constitution Principle I (Design System Fidelity) is checked twice — once at T002 (CSS additions) and once at T013 (final trace). The mockup is the visual contract; the tokens are the implementation contract.
- After the implementation is committed, the after_implement git hook will auto‑commit. The PR description should reference the spec, plan, and this tasks file by path.
