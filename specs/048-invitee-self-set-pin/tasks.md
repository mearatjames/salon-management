---
description: "Task list for invitee-self-set-pin implementation"
---

# Tasks: Invitee self-sets their PIN during invite acceptance

**Input**: Design documents from `/specs/048-invitee-self-set-pin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/server-actions.md, quickstart.md

**Tests**: INCLUDED. `setOwnPin` is auth logic — Constitution IV mandates Vitest
unit coverage written test-first (failing before implementation), plus a
Playwright e2e per the spec's acceptance criteria.

**Organization**: Tasks are grouped by user story. US1 delivers the full new
flow (the MVP). US2 and US3 verify the other two branches of the same shared
code paths.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 — maps to a user story in spec.md
- Every task names exact file path(s)

## Path Conventions

Single Next.js app at repository root. New route in the `(auth)` group:
`app/(auth)/set-pin/`. Shared helper relocated to `lib/auth/`. Tests in
`tests/unit/` and `tests/e2e/`.

---

## Phase 1: Setup

**Purpose**: Confirm the working baseline before any change.

- [ ] T001 Confirm work is on branch `048-invitee-self-set-pin` (`git rev-parse --abbrev-ref HEAD`). No new dependencies are required — the feature reuses `bcryptjs` (`hashPin`) and existing primitives. Verify the untouched baseline is green with `npm run typecheck`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Small shared changes every user story builds on — a relocated pure
helper and a new audit-action value. No user-facing behavior yet.

**⚠️ CRITICAL**: Complete before starting Phase 3.

- [ ] T002 [P] Relocate the pure keypad reducer: create `lib/auth/pin-keypad.ts` containing `pinKeypadInit`, `pinKeypadSubmit`, and the `PinKeypadState` / `PinKeypadResult` types copied verbatim from `app/(studio)/settings/staff/_pin-keypad-state.ts`; delete `app/(studio)/settings/staff/_pin-keypad-state.ts`; update the import in `components/lacquer/staff/change-pin-modal.client.tsx` to `@/lib/auth/pin-keypad`. Verify `npm run typecheck` stays green (pure mechanical move).
- [ ] T003 [P] Add `"user.pin_set"` to the `AuditAction` union in `lib/auth/audit.ts` (place it near `"user.pin_reset"`). Confirm `deriveEntityType` already maps `user.*` → `"user"` — no change needed there.

**Checkpoint**: Shared helper and audit vocabulary ready — user story work can begin.

---

## Phase 3: User Story 1 - Invitee without a PIN sets their own (Priority: P1) 🎯 MVP

**Goal**: A quick-mode (no-PIN) invitee, after setting their password, is taken
to a `/set-pin` step, chooses a PIN, and lands on `/select-staff` visible on the
roster and able to pin in.

**Independent Test**: Invite a staff member in quick mode (no PIN, password
method). Accept the invite, set a password, confirm the `/set-pin` keypad
appears, set a PIN, then confirm the invitee appears on `/select-staff` and can
pin in with that PIN.

### Tests for User Story 1 (write FIRST — must FAIL before implementation) ⚠️

- [ ] T004 [P] [US1] Write failing unit tests in `tests/unit/auth/set-pin.test.ts` for `setOwnPin`, following the mock pattern in `tests/unit/settings/onboarding/actions-reset-pin.test.ts` (mock `next/navigation` redirect-throw, `@/lib/db/server`, `@/lib/db/admin`, `@/lib/auth/audit`, `@/lib/auth/pin`). Cover all four branches from `contracts/server-actions.md`: (a) valid 4-digit PIN → `hashPin` result written + `recordAudit("user.pin_set", …)` called + redirect `/select-staff`, and assert `JSON.stringify(auditPayload)` does NOT contain the raw PIN digits; (b) bad shape → redirect `/set-pin?error=invalid_pin_shape`, no write, no audit; (c) no session → redirect `/set-pin?error=expired`, no write, no audit; (d) staff row `pin_hash` already non-null → no write, no audit, redirect `/select-staff`.
- [ ] T005 [P] [US1] Update `tests/unit/auth/reset-password.test.ts` so the `method === "invite"` case asserts `updatePassword` redirects to `/set-pin` (currently expects `/select-staff`); keep/add an explicit `method === "recovery"` case asserting redirect to `/select-staff`. These fail until T009.

### Implementation for User Story 1

- [ ] T006 [US1] Implement `setOwnPin(formData)` in `app/(auth)/set-pin/actions.ts` per `contracts/server-actions.md`: read `pin`; `validatePinShape` (from `app/(studio)/settings/onboarding/_validation.ts`) → on `ValidationError` redirect `/set-pin?error=invalid_pin_shape`; probe `supabase.auth.getUser()` → no session redirect `/set-pin?error=expired`; resolve own staff row `SELECT id, pin_hash FROM staff WHERE user_id = <uid>` → no row redirect `/select-staff`; `pin_hash` already set → redirect `/select-staff` (no overwrite); else `hashPin` + service-role `UPDATE staff SET pin_hash WHERE id = <staffId> AND user_id = <uid>` + `recordAudit("user.pin_set", uid, staffId, { pin_set: true, actor: "self" }, staffId)` + redirect `/select-staff`. Re-throw `NEXT_REDIRECT` errors (use the `isNextRedirectError` pattern from `reset-password/actions.ts`). Make T004 pass.
- [ ] T007 [US1] Implement `SetPinForm` client component in `components/lacquer/set-pin-form.client.tsx`: wrap `components/lacquer/numeric-keypad.client.tsx`, drive it with `pinKeypadInit` / `pinKeypadSubmit` from `@/lib/auth/pin-keypad` (two-phase enter → confirm); on confirm match `requestSubmit()` a hidden `<form action={setOwnPin}>` carrying `pin`; on confirm mismatch flash an inline error and reset to the enter phase (client-only). All spacing/radius/type/color via design-system tokens; no new component library.
- [ ] T008 [US1] Implement the `/set-pin` page in `app/(auth)/set-pin/page.tsx` (React Server Component, renders inside `app/(auth)/layout.tsx` `AuthShell`): probe `supabase.auth.getUser()` → no session render an invite-expired card (mirror `app/(auth)/reset-password/page.tsx`'s expired state); read own staff row `pin_hash` → non-null redirect `/select-staff`, no row redirect `/select-staff`, `NULL` render `<SetPinForm />`; surface `?error=invalid_pin_shape` and `?error=expired` query params as inline messages.
- [ ] T009 [US1] Modify `updatePassword` in `app/(auth)/reset-password/actions.ts`: change the final `redirect("/select-staff")` (line ~110) to `redirect(method === "invite" ? "/set-pin" : "/select-staff")`. Leave all earlier logic (validation, session probe, `updateUser`, `recordAuth("device.password_reset", …)`) unchanged. Makes T005 pass.

### Verification for User Story 1

- [ ] T010 [US1] Create `tests/e2e/set-pin.spec.ts` importing `test` / `expect` from `tests/e2e/_fixtures.ts` (the spec mutates `staff`). US1 scenario: provision an `invited`-state staff row with `pin_hash = null` and a linked auth user; drive accept-invite → set password → assert landing on `/set-pin` → enter + confirm a PIN → assert landing on `/select-staff` → assert the invitee tile is present on the roster → pin in with the chosen PIN. Assert a `user.pin_set` audit row via `newAuditCursor()` / `getAuditLogRowsSince()` from `tests/e2e/_db.ts`, and that the raw PIN does not appear in the row.
- [ ] T011 [US1] Add an entry to `tests/e2e/_affected-map.mjs` mapping `app/(auth)/set-pin/actions.ts` and `app/(auth)/reset-password/actions.ts` to `tests/e2e/set-pin.spec.ts`, so scoped `test:e2e:changed` runs pick up the spec.
- [ ] T012 [US1] Design-system check (Constitution I): compare the rendered `/set-pin` page side by side with the matching `design-system/` prototypes / `design-system/preview/*.html`; confirm every color, spacing, radius, shadow, and type value traces to a token in `styles/tokens.css`, icons are Lucide (1.5px stroke, 16/20/24), and there is no emoji in chrome.

**Checkpoint**: User Story 1 is fully functional — a no-PIN invitee can complete onboarding end to end. This is a shippable MVP.

---

## Phase 4: User Story 2 - Invitee whose PIN was set by the owner skips the step (Priority: P2)

**Goal**: A thorough-mode invitee whose PIN was set by the owner at invite time
goes straight from the password step to `/select-staff` — no PIN step.

**Independent Test**: Invite a staff member in thorough mode with a PIN. Accept
the invite, set a password, and confirm no PIN step appears — the flow lands
directly on `/select-staff`.

**Note**: The skip behavior is the `pin_hash`-non-null branch of the `/set-pin`
page gate built in T008. This phase verifies it; no new production code.

- [ ] T013 [US2] Add the US2 scenario to `tests/e2e/set-pin.spec.ts`: provision an `invited`-state staff row with `pin_hash` already set (owner-set, thorough mode) and a linked auth user; drive accept-invite → set password → assert the flow lands **directly** on `/select-staff` and the `/set-pin` keypad is never shown; assert the invitee can pin in with the owner-set PIN. Also assert the direct-navigation idempotency guard: visiting `/set-pin` while authenticated as a staff member who already has a PIN redirects to `/select-staff`.

**Checkpoint**: US1 and US2 both verified — both branches of the gate behave correctly.

---

## Phase 5: User Story 3 - Forgot-password resets are unaffected (Priority: P3)

**Goal**: A recovery (forgot-password) reset continues straight to
`/select-staff` with no PIN step.

**Independent Test**: Trigger a password recovery for an existing staff member,
complete the new-password screen, and confirm the flow lands directly on
`/select-staff` with no PIN step.

**Note**: The recovery branch is the `method === "recovery"` arm of the T009
change (unchanged behavior). T005 already asserts it at the unit level; this
phase confirms no e2e regression.

- [ ] T014 [US3] Confirm recovery is unaffected: verify `tests/unit/auth/reset-password.test.ts` has an explicit `method === "recovery"` → `/select-staff` assertion (added in T005), and run the existing recovery flow in `tests/e2e/auth.spec.ts` to confirm it still lands on `/select-staff` and never reaches `/set-pin`. If `auth.spec.ts` has no recovery-redirect assertion, add one.

**Checkpoint**: All three user stories verified — the PIN step is invite-only.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Manual validation and the full pre-push gate.

- [ ] T015 Run the `specs/048-invitee-self-set-pin/quickstart.md` walkthrough (Scenarios A, B, C + edge checks) against a local Supabase stack; confirm each scenario passes and the `user.pin_set` audit row carries no raw PIN.
- [ ] T016 Run the full pre-push gate set in order — `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e` — all five green (CLAUDE.md "Pre-push quality gates"; fix and re-run on any failure).
- [ ] T017 Commit, push the `048-invitee-self-set-pin` branch, and open a PR with `Closes #122` in the body (summary + test plan per CLAUDE.md "Working on a GitHub issue").

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: after Setup. Blocks all user stories.
- **User Story 1 (Phase 3)**: after Foundational. Delivers the full new flow.
- **User Story 2 (Phase 4)**: after US1 — it verifies a branch of the
  `/set-pin` page gate built in T008 and extends the spec file created in T010.
- **User Story 3 (Phase 5)**: after US1 — it verifies the `method` branch of
  the T009 `updatePassword` change.
- **Polish (Phase 6)**: after US1–US3.

### User Story Dependencies

- **US1 (P1)**: the MVP. Depends only on Foundational. Independently shippable.
- **US2 (P2)**: depends on US1's shared plumbing (the `/set-pin` page gate and
  the `updatePassword` redirect). Independently *testable* once US1 is in.
- **US3 (P3)**: depends on US1's `updatePassword` change. Independently
  *testable* once US1 is in.

This feature is one tightly-coupled invite-acceptance flow; US2 and US3 are the
"other two branches" of code US1 introduces, so they are verification phases
rather than separate code drops.

### Within User Story 1

- T004, T005 (tests) written first and FAIL → then T006–T009 (implementation).
- T006 (action) → T007 (form imports the action) → T008 (page renders the form)
  → T009 (redirect change; route should exist first).
- T010–T012 (e2e + affected-map + design check) after T008/T009.

### Parallel Opportunities

- **Phase 2**: T002 and T003 are different files → run in parallel.
- **Phase 3 tests**: T004 and T005 are different test files → run in parallel.
- Implementation T006→T007→T008→T009 is a sequential chain (each imports/relies
  on the previous) — not parallelizable.

---

## Parallel Example: Phase 2 Foundational

```bash
# Different files, no ordering between them:
Task: "T002 Relocate keypad reducer to lib/auth/pin-keypad.ts"
Task: "T003 Add user.pin_set to the AuditAction union in lib/auth/audit.ts"
```

## Parallel Example: User Story 1 tests

```bash
# Write both failing test files together, before implementation:
Task: "T004 Failing unit tests for setOwnPin in tests/unit/auth/set-pin.test.ts"
Task: "T005 Update reset-password.test.ts invite redirect assertion"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001).
2. Phase 2: Foundational (T002, T003) — relocated reducer + audit action.
3. Phase 3: User Story 1 (T004–T012) — the full no-PIN invite-acceptance flow.
4. **STOP and VALIDATE**: a quick-mode invitee completes onboarding end to end.
5. This is shippable on its own.

### Incremental Delivery

1. Setup + Foundational → ready.
2. US1 → the MVP: no-PIN invitee self-sets a PIN.
3. US2 → verify thorough-mode invitees skip the step.
4. US3 → verify recovery resets are untouched.
5. Polish → quickstart + full gate + PR.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` labels (US1–US3) trace each task to a spec user story.
- Unit tests (T004, T005) are strictly test-first — confirm they FAIL before
  writing T006/T009 (Constitution IV, auth path).
- No schema migration is created — `audit_log.action` is plain `text` and
  `staff.pin_hash` already exists (see research.md D1).
- Out of scope (research.md D6): magic-link passwordless invites — a follow-up.
- Commit after each task or logical group; the final gate (T016) is the
  authority before the PR.
