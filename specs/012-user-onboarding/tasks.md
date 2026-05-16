---

description: "Implementation tasks for 012-user-onboarding"
---

# Tasks: User Onboarding & Offboarding

**Input**: Design documents from `/specs/012-user-onboarding/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: MANDATORY for this feature. Onboarding gates email-login access to the entire app — auth-critical path per Constitution Principle IV ("For money and auth logic, tests are written and shown to fail before the implementation that satisfies them is written"). Every implementation task is preceded by the test that proves it.

**Organization**: Tasks are grouped by user story (US1–US7 from spec.md). Each story can be implemented and verified independently. Phases run sequentially; tasks marked `[P]` within a phase can run in parallel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in the same phase).
- **[Story]**: `[US1]` … `[US7]` — only on user-story phase tasks. Setup, Foundational, and Polish have no story label.
- Every task names exact file paths.

## Path Conventions

Tang Nails is a single Next.js App Router project rooted at the repository (worktree) root. Paths below are relative to:
`/Users/mearathou/Dev/salon-management/.worktrees/012-user-onboarding`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the three new shadcn primitives and create the schema migration file.

- [ ] T001 Install three shadcn primitives (`sheet`, `dialog`, `dropdown-menu`) via `npx shadcn@latest add sheet dialog dropdown-menu`; verify the new files land under `components/ui/` and that no existing primitives are clobbered. Commit the install diff separately.
- [ ] T002 Create `supabase/migrations/0004_user_onboarding.sql` with: `staff.state` (text, CHECK in 'active'/'invited'/'offboarded', default 'active'), `staff.email` (text, nullable), `staff.invited_at`/`staff.invited_by`/`staff.invite_method`, `staff.offboarded_at`/`staff.offboarded_by`/`staff.offboard_reason`, `staff.last_sign_in_at`, `staff.pin_reset_admin_at`, coherence CHECKs (`staff_invite_meta_coherent`, `staff_offboard_meta_coherent`, `staff_invite_method_check`, `staff_state_check`), three partial indexes (`staff_pending_idx`, `staff_offboarded_idx`, `staff_email_lower_unique`), the `staff_anon_counter` sequence, plus the backfill `UPDATE public.staff SET state = 'active' WHERE state IS NULL;`. Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS`). Per data-model.md § 1.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema applied, shared modules in place, /auth/callback + /reset-password extended for `type=invite`, page skeleton renders. No user story work can begin until this phase passes.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Apply migration 0004 to the local Supabase via `supabase migration up`. Verify with `psql` (or Studio): `\d public.staff` shows the new columns + indexes; `SELECT nextval('staff_anon_counter')` returns 1; existing seeded rows have `state='active'`.
- [ ] T004 [P] Write unit test `tests/unit/auth/audit-actions.test.ts` asserting the new `user.*` values are members of the `AuditAction` union AND that `deriveEntityType` returns `"user"` for each. **Must fail before T005**.
- [ ] T005 Extend `lib/auth/audit.ts`: add the seven new `user.*` union members (per data-model.md § 2); extend `deriveEntityType` with `if (action.startsWith("user.")) return "user";` (before the staff dispatch). Update the return-type union to `"service" | "staff" | "auth" | "user"`. Confirm T004 now passes.
- [ ] T006 [P] Write unit test `tests/unit/auth/role-permissions.test.ts` covering: exact-snapshot of `ROLE_PERMISSIONS`, every `StudioRole` is a key, every `grants` array has length ≥ 1, no HTML/markup in any string. **Must fail before T007**.
- [ ] T007 [P] Create `lib/auth/role-permissions.ts` exporting `RolePermissionDef`, the `ROLE_PERMISSIONS` constant, and `getRolePermissions(role)`. Strings lifted verbatim from `design-system/prototypes/onboarding/data.jsx`. Per contracts/permissions.contract.md.
- [ ] T008 [P] Write unit test `tests/unit/settings/onboarding/anon-counter.test.ts` that calls `nextval('staff_anon_counter')` twice via a service-role query and asserts the second return is exactly `first + 1`. Wrap in a beforeEach that resets the sequence (`ALTER SEQUENCE staff_anon_counter RESTART WITH 1`). **Must fail before T009**.
- [ ] T009 [P] Create `lib/onboarding/anon-counter.ts` exporting `getNextAnonPlaceholder()` → returns `Former staff #${nextval('staff_anon_counter')}` via the service-role client. Single, ~15-line helper.
- [ ] T010 [P] Write unit test `tests/unit/settings/onboarding/email-conflict.test.ts` covering the four conflict matrix branches (active → `already_active`, invited → `already_invited`, offboarded → `was_offboarded`, removed → falls through). Uses a seeded test DB. **Must fail before T011**.
- [ ] T011 [P] Create `lib/onboarding/email-conflict.ts` exporting `checkEmailConflict(email)` → returns `null` or one of three conflict codes. Uses `createSupabaseServiceRoleClient()` to query `staff WHERE lower(email) = lower(:email) AND removed_at IS NULL`.
- [ ] T012 [P] Write unit test `tests/unit/onboarding/invite.test.ts` covering: `generateMagicLinkInvite(email, metadata)` returns `{ user_id, link }`; `sendPasswordInvite(email, metadata)` returns `{ user_id }`; `deleteInviteUser(user_id)` calls admin.deleteUser; both create-user calls handle the `User already registered` Supabase error by returning a typed sentinel. Mock `@supabase/supabase-js` admin client. **Must fail before T013**.
- [ ] T013 [P] Create `lib/onboarding/invite.ts` exporting the three thin wrappers in T012. Each function takes `(email, metadata?)`, returns the typed result, and never throws on a duplicate (caller decides; conflict check in T011 is the gate).
- [ ] T014 Extend `app/auth/callback/route.ts`: add `if (type === "invite") return "invite"` to `methodFromCallback`; add the redirect branch `if (type === "invite") redirect("/reset-password?type=invite")`; add the error branch `if (type === "invite") redirect("/reset-password?type=invite&error=expired")` for missing code / exchange failure. After every successful `recordAuth("device.signed_in", …)` UPDATE the matching staff row's `last_sign_in_at = now()`, `state='active'`, `active=true` (idempotent) via `createSupabaseServiceRoleClient()`. Per research R8 + R10.
- [ ] T015 [P] Write unit test `tests/unit/auth/callback.test.ts` adding cases: `?type=invite` with valid code → redirects to `/reset-password?type=invite`, audit row has `payload.method='invite'`; `?type=invite` without code → redirects to `/reset-password?type=invite&error=expired`; UPDATE flips `state='invited'` to `'active'` on first sign-in (idempotent — second call does nothing). **Should fail before T014; passes after**.
- [ ] T016 Extend `app/(auth)/reset-password/page.tsx` to read `?type` (default `"recovery"`). Switch the heading, form button label, and expired-card copy per contracts/routes.contract.md. Pass the `type` value into the form so it can render the hidden `<input name="method">`. The `type=invite` expired card has no "Request a new link" CTA — only the explanatory copy.
- [ ] T017 Extend `app/(auth)/reset-password/actions.ts` (`updatePassword`) to read the `method` field from FormData (default `"recovery"` if absent) and pass it into the `recordAuth("device.password_reset", …, { method })` payload. Audit row now carries `method: 'recovery' | 'invite'`.
- [ ] T018 [P] Write unit test `tests/unit/auth/reset-password.test.ts` extension: `updatePassword` with `formData.method='invite'` writes audit `payload.method='invite'`; default (`method` absent) writes `payload.method='recovery'`. **Should fail before T017; passes after**.
- [ ] T019 [P] Extend `tests/e2e/auth.spec.ts` with a new describe block "invite-method password setup leg": invite a fictional user with `type=invite`, open Inbucket, click link, land on `/reset-password?type=invite` with the "Set your password" heading, submit a valid password, land on `/select-staff`; assert audit rows `device.signed_in.method='invite'` then `device.password_reset.method='invite'`. **Must fail before T014–T017 are wired; passes after T019 alone**. (The full invite UI lands in US2 — this E2E uses a direct `admin.inviteUserByEmail` call from the test setup.)
- [ ] T020 [P] Create `app/(studio)/settings/onboarding/_types.ts` with `OnboardingUser` (the row shape: id, user_id, display_name, email, role, color_token, state, invite_method, invited_at, offboarded_at, offboard_reason, last_sign_in_at, pin_set, is_you), `OnboardingSection = 'pending'|'active'|'offboarded'`, `InviteMethod`, `OffboardReason`.
- [ ] T021 [P] Create `app/(studio)/settings/onboarding/_validation.ts` with `validateDisplayName`, `validateEmail` (RFC 5322 lite), `validateRole`, `validateColor`, `validatePinShape` (re-export from staff `_validation.ts` if shape matches), `validateReason`, `validateInviteMethod`, `validateMode`. Each throws a typed `ValidationError` with stable `code` (matches the contract's `?error=invalid_*` codes).
- [ ] T022 [P] Create `app/(studio)/settings/onboarding/_sort.ts` exporting `binAndSortRoster(rows, viewerUserId)` → `{ pending, active, offboarded }`. Pending sorted DESC by `invited_at`; active sorted by role priority then alphabetical (reuse `sortStaff` if compatible); offboarded sorted DESC by `offboarded_at`. Sets `is_you` per row.
- [ ] T023 [P] Create `styles/onboarding.css` with the page hero, three-section list, row, and sheet/dialog shell rules. Every property resolves to a token defined in `styles/tokens.css` (no raw hex, no off-scale spacing). Lift the structural CSS from `design-system/prototypes/onboarding/onboarding.css` and rewrite OKLCH literals to token references.
- [ ] T024 [P] Create `components/lacquer/onboarding/section.tsx` (server component) — head (icon + title + count + sub), list container, empty-row slot. Per contracts/ui-views.contract.md "Section visibility".
- [ ] T025 [P] Create `components/lacquer/onboarding/user-row.tsx` (server component) — avatar + person column, role chip, status badge, metadata column. Receives a `menu?: ReactNode` slot prop so the per-bucket menu is composed externally. No client behavior here.
- [ ] T026 [P] Create `components/lacquer/onboarding/onboarding-toaster.client.tsx` — URL → Sonner bridge matching the `StaffToaster` pattern. Reads `?toast` + `?name` + `?error`, fires the matching Sonner toast, then calls `router.replace` to strip the params. Wrapped in `<Suspense fallback={null}>` by the caller.
- [ ] T027 Insert the Onboarding entry into `components/lacquer/settings/tab-bar.tsx`'s `TABS` array, positioned between `staff` and `notifications`: `{ id: "onboarding", label: "Onboarding", href: "/settings/onboarding" }`. Per FR-001.
- [ ] T028 Create `app/(studio)/settings/onboarding/page.tsx` (Server Component, `export const dynamic = "force-dynamic"`). Calls `requireStudioSession()`; redirects to `/settings/staff` if `viewer.staff.role !== "owner"` (per routes.contract.md). Fetches roster via the R13 single query, bins via `_sort.ts`, renders hero (with empty CTA for now — wiring lands in US1) + owners-only notice + three `<Section>` blocks containing `<UserRow>`s (no menus yet). Includes `<OnboardingToaster />` wrapped in Suspense.
- [ ] T029 Foundational smoke E2E: extend `tests/e2e/onboarding.spec.ts` (new file) with a `describe('foundation')` block — owner GETs `/settings/onboarding` and sees the hero + 3 empty sections + owners-only notice; manager GETs `/settings/onboarding` and is redirected to `/settings/staff` with the proper status. No user stories yet — this is the foundation checkpoint.

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 — Owner invites with magic-link (Quick) (Priority: P1) 🎯 MVP

**Goal**: An owner can send a Quick-mode magic-link invite end-to-end, see the new row appear under Pending invites, and the invitee can accept and reach `/select-staff`.

**Independent Test**: Owner signs in, opens Settings → Onboarding, opens the Onboard sheet in Quick mode, fills name + email + role, sends. Sees success toast and a new row in Pending invites. Invitee opens the email, follows the magic link, reaches `/select-staff` signed in.

### Tests for User Story 1

- [ ] T030 [P] [US1] Write unit test `tests/unit/settings/onboarding/actions-invite-quick.test.ts` covering `inviteUser` with `mode='quick'`: happy path (creates auth user + staff row + audit row `user.invited`), email-conflict matrix (`already_active`, `already_invited`, `was_offboarded`), validation failures (`invalid_email`, `invalid_name`, `invalid_role`), and Supabase `admin.createUser` failure → `?error=invite_failed`. **Must fail before T032**.
- [ ] T031 [P] [US1] Extend `tests/e2e/onboarding.spec.ts` with `describe('US1: Quick magic-link onboard')`: owner opens hero CTA → Quick mode opens by default → fills valid name+email+role → submits → success toast → new row appears in Pending; assert audit row `user.invited` with `payload.method='magic_link'`. Then poll Inbucket for the magic-link email, follow it, assert landing on `/select-staff` signed in as the invitee + audit row `device.signed_in.method='magic_link'`. Reuse the Inbucket helper from `tests/e2e/auth.spec.ts`. **Must fail before T032–T035**.

### Implementation for User Story 1

- [ ] T032 [US1] Implement `inviteUser` action in `app/(studio)/settings/onboarding/actions.ts` covering ONLY the `mode='quick'` branch: shared prelude (session + owner gate) → validate → conflict check → `generateMagicLinkInvite` from `lib/onboarding/invite.ts` → INSERT staff row → audit → `revalidatePath` + `redirect(?toast=invited&name=…)`. Rolls back via `deleteInviteUser` on staff-INSERT failure. Per contracts/server-actions.contract.md § 1. Confirm T030 now passes.
- [ ] T033 [P] [US1] Create `components/lacquer/onboarding/role-tile-picker.tsx` (server component when `value` is rendered, client component when `onChange` is bound — split into `role-tile-picker.tsx` (presentational) + a tiny client wrapper used inside the sheet). Reads labels + subs from `lib/auth/role-permissions.ts` (`label` + `summary` shortened). Per FR-021 + contracts/ui-views.contract.md.
- [ ] T034 [P] [US1] Create `components/lacquer/onboarding/onboard-sheet.client.tsx` — Quick mode ONLY (single screen: name + email + role + Send invite + Cancel). Built on shadcn `Sheet`. ModePill in the header is rendered with both options but the Thorough button is `disabled` for now (US2 enables it). Submit binds to the `inviteUser` server action with `mode='quick'`. Disabled submit until name ≥ 2 + valid email. Success state replaces body with the SuccessState splash (icon + copy + "Copy invite link" + "Done").
- [ ] T035 [US1] Wire the hero `Onboard user` CTA in `app/(studio)/settings/onboarding/page.tsx` to open `OnboardSheet` (state-lifted into a small client wrapper component). Confirm T031 now passes end-to-end.
- [ ] T036 [US1] Extend `styles/onboarding.css` with the hero CTA, sheet shell, Quick form, ModePill, and SuccessState rules. All values trace to tokens.
- [ ] T037 [US1] Verification — scoped phase gate per CLAUDE.md "Scoping intermediate phase gates":
  - `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)`
  - `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US1"`
  All five must be green; dispatch `speckit-design-auditor` after this phase (UI surfaces changed).

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently — an owner can send a magic-link invite and the invitee can accept.

---

## Phase 4: User Story 2 — Owner invites via Thorough wizard (Priority: P1)

**Goal**: Owner uses Thorough mode to walk through Identity → Invite → PIN → Review, including the live email preview, two-pass PIN keypad with the mismatch loop, and the role permissions card.

**Independent Test**: Owner opens the Onboard sheet, switches to Thorough, walks all four steps (Identity → Invite → PIN → Review), sends. Pending row appears with `pin_set=true`; when the invitee accepts via the password-setup link, they land on `/reset-password?type=invite`, set a password, and can sign in immediately.

### Tests for User Story 2

- [ ] T038 [P] [US2] Extend `tests/unit/settings/onboarding/actions-invite-thorough.test.ts` covering `inviteUser` with `mode='thorough'`: password method takes the `sendPasswordInvite` path; magic-link method through Thorough still uses `generateMagicLinkInvite`; pin field is hashed before INSERT (raw never persists); audit `payload.pin_set` reflects whether pin was provided; validation rejects `invalid_pin_shape` for non-4-digit, `invalid_color` for off-palette swatch. **Must fail before T040**.
- [ ] T039 [P] [US2] Extend `tests/e2e/onboarding.spec.ts` with `describe('US2: Thorough onboard')` covering BOTH method paths: (a) magic-link path identical to US1 but reached via Thorough; (b) password-setup path → Inbucket receives invite template (7-day validity copy) → clicking lands on `/reset-password?type=invite` with "Set your password" heading → submit password → land on `/select-staff` → pre-set PIN works on first PIN-prompt → audit chain `user.invited.method='password'` then `device.signed_in.method='invite'` then `device.password_reset.method='invite'`. Cover the PIN-mismatch loop in a separate sub-describe (UI assertion only). **Must fail before T040–T044**.

### Implementation for User Story 2

- [ ] T040 [US2] Extend `inviteUser` action in `app/(studio)/settings/onboarding/actions.ts` for `mode='thorough'`: validates the additional `color_token`, `pin` (optional), `method` fields; routes `method='password'` through `sendPasswordInvite`; hashes the optional pin before INSERT; sets `pin_hash` + `invite_method` accordingly. Confirm T038 now passes.
- [ ] T041 [P] [US2] Create `components/lacquer/onboarding/email-preview.tsx` (server component if name+email+method are passed, else a small client component that re-renders on Thorough step 2 field changes — implement as client component since it lives inside the sheet). Renders subject, From/To, intro, CTA, and validity-window footer per contracts/ui-views.contract.md.
- [ ] T042 [P] [US2] Create `components/lacquer/onboarding/permission-card.tsx` (server-renderable; consumed inside the client sheet for step 4). Imports `getRolePermissions` from `lib/auth/role-permissions.ts` and renders the role label + summary + grants + blocks card.
- [ ] T043 [US2] Extend `components/lacquer/onboarding/onboard-sheet.client.tsx` with the Thorough mode 4-step wizard: step bar, ModePill enables Thorough (un-disabling the button from T034), per-step body (Identity → Invite → PIN → Review), Back/Continue footer gated per step, and the two-pass inline PIN keypad (`InlinePin`) with mismatch-loop behavior. ModePill must preserve already-entered Identity fields when switching modes (per FR-011). Submit on Review fires `inviteUser` with `mode='thorough'`.
- [ ] T044 [US2] Extend `styles/onboarding.css` with the Thorough step bar, wiz-heading, role-tile, color-picker, invite-method-tile, inline-pin keypad + dots, email-preview, review-list, perm-card rules. All values trace to tokens.
- [ ] T045 [US2] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US2"`
  Dispatch `speckit-design-auditor` after this phase.

**Checkpoint**: User Story 2 is independently functional. Both invite methods (magic-link and password-setup) work end-to-end.

---

## Phase 5: User Story 3 — Soft offboard + Active row menu (Priority: P1)

**Goal**: Active row menu surfaces Reset PIN, Send password reset, and Offboard. Soft offboard revokes session within 5 seconds (SC-003), is reversible, and self-offboard is blocked at both UI and server layers.

**Independent Test**: Owner offboards a non-owner active user. Row leaves Active, appears in Offboarded with metadata. Offboarded user can't sign in. Owner's own row menu shows the explanatory line instead of Offboard. Reset PIN on any active row writes the new PIN; `/select-staff` shows a one-shot banner on the next sign-in. Send password reset writes an audit row with `actor=admin` and a reset email arrives.

### Tests for User Story 3

- [ ] T046 [P] [US3] Write `tests/unit/settings/onboarding/actions-offboard.test.ts` covering `offboardUser`: happy path (updates state + active + signOut + audit), self-offboard rejection → `?error=cannot_offboard_self`, last-owner trigger error → `?error=last_owner`, non-`active` target → `?error=not_found`, optional reason validation. **Must fail before T051**.
- [ ] T047 [P] [US3] Write `tests/unit/settings/onboarding/actions-reset-pin.test.ts` covering `resetUserPin`: hashes pin, UPDATE includes `pin_reset_admin_at=now()`, audit `payload.actor='admin'`, accepts own-row reset (FR-035), invalid pin shape → `?error=invalid_pin_shape`. **Must fail before T052**.
- [ ] T048 [P] [US3] Write `tests/unit/settings/onboarding/actions-send-password-reset.test.ts` covering `sendUserPasswordReset`: calls `resetPasswordForEmail`, writes audit `payload.actor='admin'` with `payload.by=<owner.user_id>`, `AuthRetryableFetchError` → `?error=network`, target not active → `?error=not_found`. **Must fail before T053**.
- [ ] T049 [P] [US3] Extend `tests/e2e/onboarding.spec.ts` with `describe('US3: Soft offboard')` covering: open Offboard sheet on non-owner active row → confirm with reason "Performance" → row moves to Offboarded with "Just now · Performance" metadata → audit `user.offboarded.payload.reason='Performance'` → offboarded user attempt to sign in fails with the standard invalid-credentials surface within 5 seconds (SC-003). Last-owner sub-case: try to offboard the only owner → button disabled + inline alert "Promote another owner first." Self-row sub-case: open menu on own row → see the "You can't offboard yourself" line in place of the destructive item. **Must fail before T051, T054, T057**.
- [ ] T050 [P] [US3] Extend `tests/e2e/onboarding.spec.ts` with `describe('US3: Active row Reset PIN + notice')`: open the active row menu → Reset PIN → enter two matching PINs → save → toast confirms. Sign out, sign in as that user, open `/select-staff` → assert the "Your PIN was reset by an owner" banner appears. Submit the new PIN → banner clears AND `staff.pin_reset_admin_at` is NULL. **Must fail before T052, T055, T058**.
- [ ] T051 [P] [US3] Extend `tests/e2e/onboarding.spec.ts` with `describe('US3: Send password reset')`: open active row menu → Send password reset → toast confirms; assert audit `device.password_reset.payload.actor='admin'`, `payload.by=<owner.user_id>`; assert Inbucket receives a reset email; clicking it lands on `/reset-password?type=recovery`. **Must fail before T053**.

### Implementation for User Story 3

- [ ] T052 [US3] Implement `offboardUser` action in `app/(studio)/settings/onboarding/actions.ts` per contracts/server-actions.contract.md § 4. Includes self-guard, last-owner pre-flight, `admin.auth.admin.signOut(user_id, 'global')`, UPDATE state/active/pin_hash/offboarded_*, audit row. Maps trigger error → `?error=last_owner`. Confirm T046 + T049 (offboard happy path + last-owner case) now pass.
- [ ] T053 [US3] Implement `resetUserPin` action per contracts/server-actions.contract.md § 7. Hashes pin via `hashPin`, UPDATEs `pin_hash` AND `pin_reset_admin_at = now()`, writes audit with `payload.actor='admin'`. Confirm T047 passes.
- [ ] T054 [US3] Implement `sendUserPasswordReset` action per contracts/server-actions.contract.md § 8. Uses `createSupabaseServerClient` (not service-role — `resetPasswordForEmail` is on the regular client). Writes audit `device.password_reset` with `actor='admin'` + `by`. Confirm T048 + T051 pass.
- [ ] T055 [P] [US3] Create `components/lacquer/onboarding/offboard-sheet.client.tsx` per contracts/ui-views.contract.md "Offboard sheet (soft)". Built on shadcn `Sheet`. Reason chip group, "What happens" checklist, destructive button (always enabled — confirmation is the act of opening the sheet). Submit fires `offboardUser` action.
- [ ] T056 [P] [US3] Create `components/lacquer/onboarding/reset-pin-modal.client.tsx` — centered shadcn `Dialog`, two-pass keypad reusing the `InlinePin` from T043 (extract to its own module if not already shared). Submit fires `resetUserPin` action.
- [ ] T057 [P] [US3] Create `components/lacquer/onboarding/user-row-menu.client.tsx` covering ALL THREE bucket variants in one component (`kind: 'pending' | 'active' | 'offboarded'`). For US3, implement the `active` variant: Edit in Staff link (`/settings/staff?selected=<id>`), Reset PIN (opens T056 modal), Send password reset (fires action directly), self-line `"You can't offboard yourself. Another owner has to do it."` OR Offboard {first}… (opens T055 sheet). Pending and offboarded variants stub for US5/US6 — return `null` for now (just to avoid menu rendering for those rows).
- [ ] T058 [US3] Wire `user-row.tsx` to pass the menu slot through; wire `page.tsx` to render the menu inside each active row; wire `offboard-sheet` + `reset-pin-modal` open-state into the page-level client wrapper. Confirm T049 + T050 + T051 e2e tests pass.
- [ ] T059 [US3] Extend `/select-staff` page (or its rendered staff tiles) to read `staff.pin_reset_admin_at`; when non-null, show a small `Info` badge + tooltip "Your PIN was reset by an owner. Try your new PIN." on the matching tile. Extend the successful-PIN-auth action (existing in `app/(auth)/select-staff/actions.ts`) to clear `pin_reset_admin_at = NULL` after a successful PIN match. Confirm T050's banner-clear assertion passes.
- [ ] T060 [US3] Extend `styles/onboarding.css` with offboard sheet (person card, what-happens checklist, reason chips, destructive button) and reset-pin modal styles. All values trace to tokens.
- [ ] T061 [US3] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US3"`
  Dispatch `speckit-design-auditor` after this phase.

**Checkpoint**: User Stories 1, 2, AND 3 all work independently.

---

## Phase 6: User Story 4 — Hard remove (Priority: P2)

**Goal**: From an offboarded row, owner removes a user permanently — Supabase Auth user deleted, staff record anonymized as `Former staff #N`, email freed for re-invite. Three gates (two acks + typed name) all required.

**Independent Test**: With an offboarded user, open row menu → Remove permanently → check both acks → type the user's full name → Permanently remove. Row disappears entirely; subsequent invite to the same email succeeds.

### Tests for User Story 4

- [ ] T062 [P] [US4] Write `tests/unit/settings/onboarding/actions-remove.test.ts` covering `removeUser`: three-gate validation (`confirm_name_mismatch`, `ack_required` for each ack), case-insensitive typed-name comparison, anonymization (`display_name = 'Former staff #N'`, `email = NULL`, `color_token = '--avatar-slate'`), `admin.deleteUser` called, `removed_at = now()`, last-owner trigger → `?error=last_owner`, audit row carries `display_name_at_removal` + `email_at_removal` + `role_at_removal`. **Must fail before T064**.
- [ ] T063 [P] [US4] Extend `tests/e2e/onboarding.spec.ts` with `describe('US4: Hard remove')`: setup an offboarded user → open row menu → Remove permanently sheet opens with disabled button → check first ack → still disabled → check second ack → still disabled → type wrong name → still disabled → type correct name (different casing) → button enabled → click → row disappears → toast confirms with destructive tone. Re-invite the same email → succeeds, new pending row appears (proves the email was freed). **Must fail before T064–T067**.

### Implementation for User Story 4

- [ ] T064 [US4] Implement `removeUser` action per contracts/server-actions.contract.md § 6. Validates three gates → `admin.auth.admin.deleteUser` → `getNextAnonPlaceholder()` from T009 → UPDATE staff with anonymization fields + `removed_at = now()` → audit snapshot. Confirm T062 passes.
- [ ] T065 [P] [US4] Create `components/lacquer/onboarding/remove-sheet.client.tsx` per contracts/ui-views.contract.md "Remove sheet (hard)": tinted destructive header band, person card, what-happens list, two acknowledgement checkboxes, typed-name input, destructive submit gated on all three.
- [ ] T066 [US4] Extend `user-row-menu.client.tsx` (T057) with the `offboarded` bucket variant: Reactivate item (stub for US6 — `onClick` no-op) + Remove permanently item (opens T065 sheet). Reactivate stays a no-op until US6 wires its action.
- [ ] T067 [US4] Wire the offboarded row menu + remove sheet into `page.tsx` (extend the existing client wrapper). Confirm T063 passes.
- [ ] T068 [US4] Extend `styles/onboarding.css` with remove sheet (tinted destructive header, ack list, typed-name input) styles. All values trace to tokens.
- [ ] T069 [US4] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US4"`
  Dispatch `speckit-design-auditor` after this phase.

**Checkpoint**: User Stories 1, 2, 3, AND 4 all work independently.

---

## Phase 7: User Story 5 — Pending invite actions (Priority: P2)

**Goal**: Pending rows expose Resend, Copy link, and Cancel. Resend rotates the token, Copy writes the current link to clipboard, Cancel removes the pending row and invalidates the link.

**Independent Test**: For a pending invite, click Resend → toast confirms; click Copy link → link in clipboard works in another browser session; click Cancel → row disappears, audit recorded, original magic link no longer signs in.

### Tests for User Story 5

- [ ] T070 [P] [US5] Write `tests/unit/settings/onboarding/actions-resend.test.ts` covering `resendInvite`: routes per `invite_method`, UPDATEs `invited_at`, audit row, non-`invited` target → `?error=not_found`, Supabase failure → `?error=invite_failed`. **Must fail before T073**.
- [ ] T071 [P] [US5] Write `tests/unit/settings/onboarding/actions-cancel.test.ts` covering `cancelInvite`: snapshots email for audit BEFORE delete, `admin.deleteUser` succeeds, DELETE staff row succeeds, audit row written, second submit → `?error=not_found` (no double-cancel). **Must fail before T074**.
- [ ] T072 [P] [US5] Extend `tests/e2e/onboarding.spec.ts` with `describe('US5: Pending invite actions')`: setup a pending row → click row icon Resend → toast "Invite resent" + new email in Inbucket; original link is now invalidated (clicking it surfaces the standard expired-link page). Open row menu → Copy invite link → clipboard contains a URL (use Playwright's `navigator.clipboard.readText` via `browserContext.grantPermissions(['clipboard-read'])`). Cancel invite → row disappears + audit row + original link still invalidated. **Must fail before T073–T076**.

### Implementation for User Story 5

- [ ] T073 [US5] Implement `resendInvite` action per contracts/server-actions.contract.md § 2. Confirm T070 passes.
- [ ] T074 [US5] Implement `cancelInvite` action per contracts/server-actions.contract.md § 3. Confirm T071 passes.
- [ ] T075 [US5] Add a thin `getInviteLink(formData)` server action that calls `admin.generateLink({ type: ..., email, options: { shouldCreateUser: false } })` and returns the link via a redirect-style `?copy=<link>` query param OR via `useTransition`-bound state lifted into the row component. Simpler implementation: a server-side helper called from the row menu's "Copy link" button that the client island awaits and writes to `navigator.clipboard`. Document the chosen wire-up.
- [ ] T076 [US5] Extend `user-row-menu.client.tsx` (T057) with the `pending` bucket variant: inline Resend icon button + inline Copy link icon button + ⋯ menu (Resend / Copy link / Cancel destructive). Wire submit handlers for resendInvite, cancelInvite, getInviteLink. Confirm T072 passes.
- [ ] T077 [US5] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US5"`
  Dispatch `speckit-design-auditor` after this phase.

**Checkpoint**: User Stories 1–5 all work independently.

---

## Phase 8: User Story 6 — Reactivate offboarded user (Priority: P2)

**Goal**: Offboarded row's Reactivate item issues a fresh magic-link invite, moves the row back to Pending, preserves the staff record (no history loss).

**Independent Test**: From Offboarded, click Reactivate. Row moves to Pending; user receives fresh email; following the link signs them in. The staff `id` is unchanged (verify by querying the audit log for the original `user.invited.entity_id` vs. the new `user.reactivated.entity_id` — must match).

### Tests for User Story 6

- [ ] T078 [P] [US6] Write `tests/unit/settings/onboarding/actions-reactivate.test.ts` covering `reactivateUser`: target must be `state='offboarded' AND removed_at IS NULL`, calls `generateMagicLinkInvite`, UPDATEs state/active/invited_*/cleared offboard fields/cleared pin_hash, audit row written, hard-removed target → `?error=not_found`. **Must fail before T080**.
- [ ] T079 [P] [US6] Extend `tests/e2e/onboarding.spec.ts` with `describe('US6: Reactivate')`: open offboarded row menu → Reactivate → row moves to Pending → audit `user.reactivated.method='magic_link'` → fresh email in Inbucket → clicking signs in → staff record retains its original `id` (verify via SQL query against `staff WHERE user_id = <invitee.user_id>`). **Must fail before T080–T081**.

### Implementation for User Story 6

- [ ] T080 [US6] Implement `reactivateUser` action per contracts/server-actions.contract.md § 5. Confirm T078 passes.
- [ ] T081 [US6] Replace the Reactivate stub in `user-row-menu.client.tsx` (offboarded variant from T066) with a real submit handler that fires `reactivateUser`. Confirm T079 passes.
- [ ] T082 [US6] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US6"`

**Checkpoint**: User Stories 1–6 all work independently.

---

## Phase 9: User Story 7 — Search (Priority: P3)

**Goal**: Search input filters all three sections live by name or email (case-insensitive substring). Empty sections are hidden when a query is active and matches are zero.

**Independent Test**: With ≥ 5 users across all three states, type a substring of one name. All three sections collapse to the matching row(s); clearing restores the full view. With a query active and no offboarded matches, the Offboarded header is hidden entirely (whereas without a query, it shows the empty-row).

### Tests for User Story 7

- [ ] T083 [P] [US7] Extend `tests/e2e/onboarding.spec.ts` with `describe('US7: Search')`: seed 5+ users across the three states → type a substring → assert only matching rows render → assert sections with zero matches are hidden → clear search → full view restored → without a query, empty Offboarded section shows the "No offboarded users" empty row when the salon has none. **Must fail before T084**.

### Implementation for User Story 7

- [ ] T084 [US7] Add the search input to the hero in `app/(studio)/settings/onboarding/page.tsx` (URL-synced via `?q=`). Apply server-side ILIKE filter on `display_name` OR `email` in the roster fetch. Implement section visibility rule per contracts/ui-views.contract.md "Section visibility": when `?q=` is active AND a section's filtered count is 0, hide the section entirely (header + empty row); when `?q=` is absent, show the Offboarded section's header + empty row even when count is 0 for Pending/Active.
- [ ] T085 [US7] Verification — scoped phase gate:
  - prettier-check + eslint on changed files
  - `npm run typecheck`
  - `npm test`
  - `npx playwright test tests/e2e/onboarding.spec.ts -g "US7"`

**Checkpoint**: All seven user stories are independently functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final polish, docs sync, and the full pre-push gate set.

- [ ] T086 [P] Run `speckit-design-auditor` against the final UI surfaces (`/settings/onboarding`, all three sheets, the Reset PIN modal). Zero token violations required per Constitution Principle I (NON-NEGOTIABLE).
- [ ] T087 [P] Sync `docs/system-design.md` if the feature changed any user-visible architecture statements (e.g. the Settings tab structure). Likely a 1–2 line addition under the Settings section.
- [ ] T088 Run the 8-step manual smoke test from `quickstart.md § Manual smoke test`. Capture any UX rough edges as follow-up issues.
- [ ] T089 Run the full pre-push quality gate set in order (CLAUDE.md "Pre-push quality gates"):
  - `npm run format:check`
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
  - `npm run test:e2e`
  All five MUST be green locally per Constitution v1.0.3 § Development Workflow & Quality Gates. PR is bounce-able on any failure.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies — start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1 — BLOCKS all user stories. Within Phase 2 the dependency chain is:
  - T003 (apply migration) blocks T008 (sequence test) and T028 (page roster query).
  - T004 → T005 (test before implementation; TDD pattern repeats throughout).
  - T006 → T007.
  - T008 → T009.
  - T010 → T011.
  - T012 → T013.
  - T005 + T013 block T014 (callback extension uses both).
  - T014 → T016, T017 (reset-password reads from callback's redirect).
  - T020, T021, T022 are independent — `[P]`.
  - T023, T024, T025, T026 are independent of each other — `[P]`.
  - T027 (tab-bar) is `[P]` with everything except T029 (which expects the tab to be navigable).
  - T028 (page.tsx) depends on T020–T026.
  - T029 (smoke E2E) depends on T027 + T028.
- **Phases 3–9 (US1–US7)**: each depends on Phase 2 completion. Within a story, TDD: test tasks before implementation tasks; implementation tasks before verification.
- **Phase 10 (Polish)**: depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1, MVP)**: depends on Phase 2 only. NO dependencies on other US.
- **US2 (P1)**: extends US1's `inviteUser` action and `OnboardSheet` component. Implementable in parallel with US1 if the team splits — but reads cleaner as sequential since US2 directly modifies US1 code.
- **US3 (P1)**: depends on Phase 2 only. Independent of US1/US2 at the data layer. The active row menu it introduces is independent of the Onboard sheet US1/US2 builds.
- **US4 (P2)**: depends on US3 ONLY for the offboarded-row menu (T066 extends T057). Otherwise independent.
- **US5 (P2)**: depends on US3 ONLY for the menu wiring pattern (T076 extends T057). Otherwise independent of US1–US4.
- **US6 (P2)**: depends on US4 (the offboarded row's menu, T066). Otherwise independent.
- **US7 (P3)**: depends on Phase 2 only — purely additive UI feature on the existing page.

### Within Each User Story

- Tests MUST be written and FAIL before the implementation that satisfies them is committed (Constitution IV).
- Server actions before client components that bind to them.
- Sheet/modal components before the row menu wires them in.
- Phase-end verification (the scoped gate task) before moving to the next priority.

### Parallel Opportunities

- All `[P]`-marked tasks within a phase can run in parallel by different developers.
- Phase 2's `[P]` set is large: T004, T006, T008, T010, T012 (five concurrent unit-test authoring tasks), and the implementation pairs that follow them (T005, T007, T009, T011, T013) — totalling 10 tasks that can split across 2–3 developers.
- Phase 5 (US3) has the most parallel headroom: T046, T047, T048 (three independent action tests) + T049, T050, T051 (three independent e2e tests), totalling six tasks that can be written in parallel before any implementation begins.
- Within US1, T030 and T031 (the unit and e2e tests) can be authored in parallel; once T032 lands, T033, T034, and T036 are also parallelizable.

---

## Parallel Example: Phase 2 Foundational

```bash
# Round 1 — write the five foundational unit tests in parallel:
Task: "Unit test for AuditAction extension in tests/unit/auth/audit-actions.test.ts"
Task: "Unit test for role-permissions in tests/unit/auth/role-permissions.test.ts"
Task: "Unit test for anon-counter in tests/unit/settings/onboarding/anon-counter.test.ts"
Task: "Unit test for email-conflict in tests/unit/settings/onboarding/email-conflict.test.ts"
Task: "Unit test for invite.ts admin wrappers in tests/unit/onboarding/invite.test.ts"

# Round 2 — implement the modules in parallel (each unblocks its matching test):
Task: "Extend lib/auth/audit.ts AuditAction + deriveEntityType"
Task: "Create lib/auth/role-permissions.ts"
Task: "Create lib/onboarding/anon-counter.ts"
Task: "Create lib/onboarding/email-conflict.ts"
Task: "Create lib/onboarding/invite.ts"

# Round 3 — wire the cross-cutting auth changes:
Task: "Extend app/auth/callback/route.ts for type=invite + last_sign_in_at"
Task: "Unit test for callback extension"
Task: "Extend app/(auth)/reset-password/page.tsx for type=invite"
Task: "Extend app/(auth)/reset-password/actions.ts for method=invite"
Task: "Unit + E2E for reset-password type=invite leg"

# Round 4 — page skeleton in parallel:
Task: "Create _types.ts, _validation.ts, _sort.ts in app/(studio)/settings/onboarding/"
Task: "Create styles/onboarding.css skeleton"
Task: "Create components/lacquer/onboarding/{section,user-row,onboarding-toaster}.tsx"
Task: "Insert Onboarding tab in tab-bar.tsx"

# Final foundational task — depends on round 4:
Task: "Create app/(studio)/settings/onboarding/page.tsx + smoke E2E"
```

---

## Parallel Example: User Story 3

```bash
# Tests in parallel:
Task: "Unit test for offboardUser action"
Task: "Unit test for resetUserPin action"
Task: "Unit test for sendUserPasswordReset action"
Task: "E2E describe block for Soft offboard"
Task: "E2E describe block for Reset PIN + /select-staff notice"
Task: "E2E describe block for Send password reset"

# Implementations in parallel (each unblocks one or more tests):
Task: "Implement offboardUser action"
Task: "Implement resetUserPin action"
Task: "Implement sendUserPasswordReset action"
Task: "Create offboard-sheet.client.tsx"
Task: "Create reset-pin-modal.client.tsx"
Task: "Create user-row-menu.client.tsx (active variant)"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 (Setup) — 2 tasks.
2. Complete Phase 2 (Foundational) — 27 tasks; blocks everything.
3. Complete Phase 3 (US1 Quick magic-link onboard) — 8 tasks.
4. **STOP and VALIDATE**: an owner can send a Quick invite end-to-end. Demo to maintainer.

### Incremental Delivery

Each `[P1]` user story is independently shippable; ship in priority order:

1. Setup + Foundational → foundation ready.
2. Add US1 → Quick onboard works. (MVP)
3. Add US2 → Thorough onboard works (both methods).
4. Add US3 → Active row menu + soft offboard works.
5. Add US4 → Hard remove works.
6. Add US5 → Pending invite actions work.
7. Add US6 → Reactivate works.
8. Add US7 → Search works.
9. Polish → final gates pass; merge.

Each step is verified via its scoped phase gate; the final gate (Phase 10) runs the full pre-push set before the PR opens.

### Parallel Team Strategy

With 2–3 developers:

1. Team completes Phase 1 + Phase 2 together (the foundational round 1/2/3 parallelization is described above).
2. Once Phase 2 passes:
   - Developer A: US1 → US2 (sequential since US2 builds on US1).
   - Developer B: US3 (independent; introduces the row menu pattern that US4–US6 reuse).
   - Developer C: US7 (independent; purely additive).
3. Developer A picks up US5 after US2; Developer B picks up US4 after US3; Developer C picks up US6 after US4 lands.
4. Polish runs as a final shared step.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase.
- `[Story]` label maps each user-story task to its US for traceability.
- Each user story is independently completable + testable + shippable.
- TDD: every implementation task has a paired test task with a lower ID (Constitution IV — auth-critical paths). The test MUST fail before the implementation lands; the verification gate at the end of each phase asserts both the failing-then-passing transition and the broader gate set.
- Commit after each task or logical group; the `auto_commit.after_implement` hook can be left as the default (`speckit.git.commit`, optional) and invoked manually per logical group.
- After every phase that touches `components/` / `app/` / `styles/` (i.e. Phases 3, 4, 5, 6, 7, and possibly 10), dispatch `speckit-design-auditor` per CLAUDE.md "Skill-level optimizations".
- Avoid: vague tasks, same-file conflicts within a phase, cross-story dependencies that break independence beyond the menu-pattern reuse already documented above.
