---

description: "Tasks for feature 010: Login UI/UX Redesign (Brand-Panel Shell)"
---

# Tasks: Login UI/UX Redesign (Brand-Panel Shell)

**Input**: Design documents from `/specs/010-login-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/{server-actions,routes,audit,ui-views}.contract.md,
quickstart.md

**Tests**: INCLUDED. Auth is a Constitution-IV "critical path" — the new
password-reset flow (US3) is auth-critical and ships with Vitest unit
tests **written first and shown to fail** before the implementation that
satisfies them lands. Visual / UX-only stories (US1, US2, US4)
get Playwright e2e coverage but tests can be written alongside
implementation since they only verify already-tested-by-003 server-side
behaviour with a new DOM. US5 is regression-only — it has no
implementation tasks, only test updates.

**Organization**: Tasks are grouped by the five user stories in
`spec.md` (US1–US5). Phase 1 is operator/config setup; Phase 2 is
foundational shell + audit-union extension that every story depends on;
Phases 3–7 deliver one user story each; Phase 8 is cross-cutting polish.
Foundational is **small** by 003's standards because this feature reuses
nearly all of 003's infrastructure (auth helpers, middleware, DB
clients, the auth layout, the audit-log writer).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to a `spec.md` user story (`[US1]` … `[US5]`)
- Every task lists exact file paths

## Path Conventions

This feature continues the Next.js App Router monorepo at the repo
root — no `src/`. All paths below are relative to
`/Users/mearathou/Dev/salon-management/`.

---

## Phase 1: Setup (Operator config & doc hygiene)

**Purpose**: One-time operator actions (no code) needed before the
preview deploy of this branch can exercise the reset flow, plus a
vendored-prototype confirmation. Nothing user-facing.

- [ ] T001 Confirm `design-system/prototypes/auth/Login Screen.html` and `tweaks-panel.jsx` are vendored (already done by `/speckit-specify`). Confirm `design-system/prototypes/auth/README.md` reflects the post-clarify mapping (all 5 views adopted, password-reset in scope, magic-link kept as peer). No diff expected; this is a verification task. (Plan § Project Structure, quickstart.md.)
- [ ] T002 [P] **Operator action — both Supabase projects.** In Supabase Dashboard → Authentication → URL Configuration, add `<origin>/reset-password` to the **Additional Redirect URLs** allowlist for both preview and production projects. Preview pattern: `https://salon-management-git-*-mearatjames.vercel.app/reset-password`. Production: `https://salon-management.vercel.app/reset-password` (or the custom domain). Without this, `resetPasswordForEmail` succeeds but the email link is rejected on click. (research.md R3, quickstart.md § 1.) **Acceptance**: paste both URLs into the allowlist and click Save; no redeploy needed.
- [ ] T003 [P] **Operator action — production Supabase only.** Verify the production owner row has `email_confirmed_at` populated. Run in Supabase Dashboard → Production project → SQL Editor: `select id, email, email_confirmed_at from auth.users where email = '<owner email>';`. If NULL, fix with `update auth.users set email_confirmed_at = now() where email = '<owner email>';`. Without this, Google identity auto-linking refuses to fire and the owner ends up with two separate user rows. (data-model.md Invariant A, FR-022, quickstart.md § 2.) **Acceptance**: the SELECT returns a non-null timestamp.

**Checkpoint**: Prototype vendored + verified. Supabase URL allowlists updated in both projects. Production owner has confirmed email. No code changes yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Heavy `styles/auth.css` refactor, new shell components,
audit-union extension. Every user story below depends on this phase
landing. **No user-story work begins until this phase is green.**

**⚠️ CRITICAL**: This phase is the foundation for every story below. All
quality gates (`typecheck`, `lint`, `test`) must pass at the checkpoint
before Phase 3 begins. The shell renders the existing sign-in form
end-to-end (no regressions) before any new view ships.

### Phase 2A — Audit-log union extension

- [ ] T004 [P] Extend the `AuditAction` union in `lib/auth/audit.ts` (line 29-47) with `"device.password_reset"` as a new member. The `deriveEntityType` switch already routes non-`service.*`-non-`staff.*` actions to `"auth"`, so no dispatch edit is required. Confirm `npm run typecheck` is green. (data-model.md § audit_log, audit.contract.md, research.md R8.)
- [ ] T005 [P] Extend `tests/unit/auth/audit.test.ts` (existing) parameterised list to include `"device.password_reset"`. Confirm the existing test "recordAuth accepts every action in the union" passes for the new member. (audit.contract.md § Test coverage.)

### Phase 2B — Stylesheet refactor

- [ ] T006 **Refactor** `styles/auth.css`: (a) **REMOVE** the old centred-card meaning of `.auth-shell`, `.auth-card`, `.auth-magic-link-details`, `.auth-magic-link-form`, `.auth-magic-link`, `.auth-magic-sent`. (b) **ADD** the two-panel shell rules verbatim from `design-system/prototypes/auth/Login Screen.html` lines 97–348 (`.shell`, `.shell.centered`, `.brand-panel`, `.brand-deco`, `.brand-deco-2`, `.brand-wordmark`, `.brand-name`, `.brand-content`, `.brand-tagline`, `.brand-sub`, `.form-panel`, `.form-well`, `.view-pane`, `.form-header`, `.form-title`, `.form-subtitle`, `.form-body`, `.field`, `.field-row`, `.text-input`, `.text-input.suffixed`, `.input-wrap`, `.suffix-btn`, `.btn`, `.btn-primary`, `.btn-outline`, `.divider`, `.link-btn`, `.link-btn.xs`, `.link-btn.sm`, `.back-btn`, `.alert`, `.alert-error`, `.confirm-card`, `.solo-mark`, `.solo-mark-name`, and the `@media (max-width: 720px)` block). Rename CSS classes to `.auth-*` prefixed equivalents to match the existing project convention (e.g. `.shell` → `.auth-shell`, `.brand-panel` → `.auth-brand-panel`, `.view-pane` → `.auth-view-pane`). (c) Wrap the `viewIn` keyframe + its application in `@media (prefers-reduced-motion: no-preference) { ... }` per research.md R6 + FR-007 + SC-007. (d) **KEEP UNTOUCHED** every `.auth-keypad*`, `.auth-staff-tile`, `.auth-roster` rule — they belong to `/select-staff` per FR-026. Confirm every property resolves to a `var(--*)` from `styles/tokens.css`. Constitution Principle I. (research.md R10, ui-views.contract.md.)

### Phase 2C — Shell wrapper components (server-rendered, no client JS)

- [ ] T007 [P] Create `components/lacquer/auth-shell.tsx` — server component that renders the two-panel grid: `<div className="auth-shell"><AuthBrandPanel /><AuthFormPanel>{children}</AuthFormPanel></div>`. Accepts `children` (the active view) and a `showBrandPanel: boolean = true` prop (used by `/reset-password` if it wants a slightly different shell — but for v1 always `true`). No state. (ui-views.contract.md § Two-panel responsive shell.)
- [ ] T008 [P] Create `components/lacquer/auth-brand-panel.tsx` — server component that renders the left brand panel: top-left wordmark (LacquerMark SVG + "Tang Nails Studio" text), two `aria-hidden="true"` decorative LacquerMark SVGs (380px @ 7.5% opacity top-right, 160px @ 4.5% opacity rotated 18° bottom-right), bottom-left tagline "Studio tools built for focused work." and sub "Bookings, clients, payments, and staff scheduling — all in one quiet place." Inline the LacquerMark SVG path data verbatim from `design-system/prototypes/auth/Login Screen.html` lines 367-372. All copy is from FR-003 verbatim. No client JS. No focusable elements. (FR-003, ui-views.contract.md § Brand panel content.)
- [ ] T009 [P] Create `components/lacquer/auth-form-panel.tsx` — server component that renders the right form panel: a `.auth-form-panel` div containing a `.auth-form-well` div (max-width 360px, vertically centred). Renders a `.auth-solo-mark` (Lacquer mark + "Tang Nails Studio") above the form well, but ONLY at viewports < 720px (CSS-controlled, no JS check). Accepts `children` (the active view). (FR-004, ui-views.contract.md.)

### Phase 2D — Layout refactor

- [ ] T010 **Refactor** `app/(auth)/layout.tsx` to use `<AuthShell>{children}</AuthShell>` from T007. Remove the existing inline-styled centred `<section>` and the "Tang Nails Studio" wordmark+Sparkles icon block (lines 9-33) — that styling moves into `AuthBrandPanel` (brand) and `AuthFormPanel` (solo wordmark). The `import "@/styles/auth.css"` stays. Confirm the layout still passes `children` through unchanged for `/login`, `/reset-password`, **and** `/select-staff`. The `/select-staff` chrome change (inheriting the two-panel brand-panel shell around the existing keypad UI) is a deliberate styling consequence explicitly permitted by FR-026 — design cohesion across the `(auth)` route group. The keypad CSS (`.auth-keypad*`, `.auth-staff-tile`, `.auth-roster`) is untouched per T006; the keypad's DOM, selectors, copy, and logic are all unchanged. (FR-001, FR-002, FR-026.)

### Phase 2E — View-router scaffold + sign-in view

- [ ] T011 Create `components/lacquer/auth-views.tsx` — **client island** (top-of-file `"use client";`) that exports the five view components: `<SignInView>`, `<ForgotView>`, `<ForgotSentView>`, `<MagicView>`, `<MagicSentView>` — but in this task ONLY `<SignInView>` is fully implemented. The other four are stubs that render an empty `<div className="auth-view-pane">` (they're filled in by US3 / US4 tasks). `<SignInView>` renders the prototype's signin form verbatim per FR-010 (heading "Sign in", subtitle "Welcome back to Tang Nails Studio", email + password fields, primary "Sign in" button, "OR" divider, Google button slot, magic-link link slot). For now the password field is a plain `<input type="password">` (the reveal toggle from US2 is added later). The email/password form's `action` is `signInWithPassword` from `app/(auth)/login/actions.ts` — wire the existing Server Action. Hidden `next` input. (FR-010, ui-views.contract.md § Views.)
- [ ] T012 **Refactor** `app/(auth)/login/page.tsx`: keep the pre-redirect block (lines 71-114) verbatim — that guards FR-005 of 003-login-flow and US5 of this spec. Replace the inline JSX (the headline + Alert + LoginForm + Google + MagicLinkControl block, lines 117-145) with a view-selection block that reads search params per routes.contract.md § View selection precedence and renders one of: `<ForgotSentView>`, `<ForgotView>`, `<MagicSentView>`, `<MagicView>`, or `<SignInView>` (default). In this task, only the `<SignInView>` branch is functionally complete; the others render the stubs from T011. Pass `next` and `error` to the active view. (FR-006, FR-008, routes.contract.md.)
- [ ] T013 **Refactor** `components/lacquer/login-form.tsx` to render only the email + password + submit + hidden `next` — the surrounding chrome (heading, subtitle, OR divider, Google, magic-link link) moves into `<SignInView>`. The form keeps its `action={signInWithPassword}` wire, its `autoComplete` attrs, and the hidden `next` input. (US1 supersedes the current standalone `LoginForm` shape; the action contract is unchanged per server-actions.contract.md § signInWithPassword.)
- [ ] T014 **Refactor** `components/lacquer/google-sign-in-button.tsx` to adopt the prototype's `.btn.btn-outline` styling with the Lucide GoogleIcon SVG inline (the prototype's lines 401-408 — keep the actual `GoogleIcon` SVG path data verbatim since brand). The `isGoogleSignInEnabled` flag-gating from line 134 of the existing page.tsx now moves into the consumer (`<SignInView>` checks the flag); the button itself is the unconditionally-rendered version. Its action is `signInWithGoogle` (unchanged from 003).
- [ ] T015 **Update** `<SignInView>` in `components/lacquer/auth-views.tsx` (extends T011): wire `<LoginForm>` (T013), `<GoogleSignInButton>` (T014) — show the "OR" divider + button block only when `isGoogleSignInEnabled` is true (the flag is module-level in `google-sign-in-button.tsx`; import it). Add the centred "Email me a sign-in link instead" link below as a plain `<a href="/login?magic_intent=1&next=<encoded>">` (no client JS needed for the no-JS path per research.md R1).

### Phase 2F — Quality gate

- [ ] T016 Run `npm run format:check && npm run lint && npm run typecheck && npm test` from the repo root. Confirm all four are green. (Run e2e separately in US5 since the existing spec needs selector updates first.) Per `feedback_run_full_gate_set_before_push` and Constitution v1.0.3 § Quality Gates.

**Checkpoint**: `npm run dev` renders `/login` with the new two-panel
shell. The existing sign-in form works end-to-end (email/password +
Google flag-gating). Audit union accepts `device.password_reset`. No
regression in 003 server-side behaviour. Ready for per-story work.

---

## Phase 3: User Story 1 - Owner sees the rebranded sign-in shell (P1) 🎯 MVP

**Goal**: When the owner opens `/login` they see the new two-panel
Lacquer shell with the brand panel + form panel; on narrow viewports
the brand panel collapses cleanly to a solo wordmark.

**Independent Test** (per spec.md US1 Independent Test): from a
signed-out browser ≥ 720px wide, navigate to `/login`. Confirm two
side-by-side regions render. Resize to < 720px and confirm the brand
panel hides + the solo wordmark appears. Every visual value traces
to a Lacquer token.

Most of the implementation already landed in Phase 2 (the shell is
the foundational deliverable). This phase tightens visual fidelity
and adds the e2e verification.

### Implementation for US1

- [ ] T017 [US1] **Visual fidelity sweep** — open both `design-system/prototypes/auth/Login Screen.html` (in a browser via `python3 -m http.server 8000` from the design-system dir, then http://localhost:8000/prototypes/auth/Login%20Screen.html) and the local dev server's `/login` side-by-side at a 1440×900 desktop viewport. Compare panel widths, form-well width, headline size, field height, button height, decorative SVG sizing/positioning, vertical rhythm. Tolerance per SC-002 is ± 4px. Adjust `styles/auth.css` values if any differ — they should not, since T006 imported the prototype's exact CSS. Constitution Principle I requires this side-by-side per CLAUDE.md "When you change UI". (FR-021/028, SC-002.)
- [ ] T018 [P] [US1] Confirm dark-mode honouring: in Chrome DevTools, force `prefers-color-scheme: dark` and reload `/login`. Confirm both panels pick up the dark Lacquer tokens (brand panel near-black `--panel-bg`, form panel `oklch(0.10...)` background, all text `oklch(0.99 0.003 90)`). No raw colour values; everything traces to `styles/tokens.css` `.dark` cascade. (FR-005, FR-021.)

### Tests for US1 (e2e)

- [ ] T019 [US1] Add a new test block to `tests/e2e/auth.spec.ts`: "renders two-panel shell at ≥ 720px" — navigates to `/login`, asserts `await page.locator('.auth-brand-panel').isVisible()` is true and `await page.locator('.auth-form-panel').isVisible()` is true. Asserts the brand-panel `boundingBox().width` is at least 200px (i.e. it's not collapsed); the form-panel width is between 460 and 500px. (US1 acceptance scenario 1, SC-002.)
- [ ] T020 [US1] Add a new test block to `tests/e2e/auth.spec.ts`: "collapses to single panel at < 720px" — for each viewport in `[{width: 320, height: 800}, {width: 480, height: 800}, {width: 719, height: 800}]`: `await page.setViewportSize(...)`; assert `await page.locator('.auth-brand-panel').isVisible()` is **false**; assert `await page.locator('.auth-solo-mark').isVisible()` is **true**; assert the form-panel fills the viewport (`boundingBox().width >= viewport.width - 10`). (US1 acceptance scenario 2, SC-003.)

**Checkpoint**: US1 is fully testable. The MVP deliverable (the
rebranded shell) is shippable as-is at this point — every existing
auth behaviour from 003 still works; the only visible change is the
new layout.

---

## Phase 4: User Story 2 - Show / hide password during sign-in (P1)

**Goal**: An eye icon next to the password field toggles its
visibility. Resets on view swaps. Keyboard accessible.

**Independent Test** (per spec.md US2 Independent Test): on
`/login`, type into the password field, click the eye icon, confirm
plaintext rendering + icon flip; click again, confirm masked
rendering + icon flip; Tab to icon + Enter, confirm same toggle.

### Implementation for US2

- [ ] T021 [US2] **Extend** `<SignInView>` in `components/lacquer/auth-views.tsx` to render a password field with an embedded reveal toggle. Replace the existing `<LoginForm>` invocation's plain password input with the prototype's `<div className="input-wrap">` pattern (lines 445-459 of the prototype): the `<input>` (gets `.text-input.suffixed`), then a sibling `<button type="button" className="suffix-btn">` containing `<Eye size={16} strokeWidth={1.5} />` from `lucide-react`. The button's `aria-label` is "Show password" (or "Hide password" when revealed). Local `const [shown, setShown] = useState(false);`. Toggle on click: `setShown(s => !s);`. Input `type` becomes `shown ? "text" : "password"`. Icon swaps between `<Eye />` and `<EyeOff />`. (FR-011, ui-views.contract.md § Password-reveal toggle, research.md R7.)
- [ ] T022 [US2] **Refactor** `components/lacquer/login-form.tsx` to accept a `<PasswordInput>` slot prop (or factor out the email + submit + hidden-next into a smaller `<SignInFields>` component that `<SignInView>` composes alongside the inline password block with toggle). Cleanest factoring: move all sign-in form JSX into `<SignInView>` directly and delete `login-form.tsx` (the file's only job was the standalone form which now lives inside the view component). If deleted, search-and-update any other imports (none expected). (Code simplification — preserves the action wire from T013.)
- [ ] T023 [P] [US2] Reset-on-swap behaviour: the `useState<boolean>` for `shown` lives inside `<SignInView>`. When the parent (`auth-views.tsx` view-router) swaps to a different view, `<SignInView>` unmounts and remounts on return — React's natural lifecycle resets the state to `false`. No effect needed. Verify by adding a Playwright assertion (in T024) that after navigating to `/login?magic_intent=1` and back to `/login`, the password field is `type="password"`. (FR-012, ui-views.contract.md § Toggle rules item 2.)

### Tests for US2 (e2e)

- [ ] T024 [US2] Add to `tests/e2e/auth.spec.ts`: "password reveal toggle flips type" — fill the password field with "hunter2", assert input `type="password"`, click the eye button, assert `type="text"` and `aria-label="Hide password"`, click again, assert `type="password"` and `aria-label="Show password"`. (US2 acceptance scenarios 1+2.)
- [ ] T025 [P] [US2] Add to `tests/e2e/auth.spec.ts`: "password reveal toggle is keyboard operable" — fill password, then `await page.keyboard.press('Tab');` to land on the eye button, `await page.keyboard.press('Enter');`, assert `type="text"`. (US2 acceptance scenario 4.)
- [ ] T026 [P] [US2] Add to `tests/e2e/auth.spec.ts`: "password reveal resets on view swap" — fill password, click eye (type=text), navigate to `/login?magic_intent=1`, navigate back to `/login`, assert password input is back to `type="password"`. (FR-012, US2 edge case.)
- [ ] T027 [P] [US2] Add to `tests/e2e/auth.spec.ts`: "browser autofill stays masked on first paint" — navigate to `/login` (no interaction), assert password input `type="password"`. (This trivially passes because the initial state is `false`, but the assertion documents the invariant.)

**Checkpoint**: US2 is fully testable. The reveal toggle ships as a
polish layer on top of US1. The signin form is now feature-complete
for the redesign.

---

## Phase 5: User Story 3 - Reset a forgotten password from a dedicated view (P1)

**Goal**: Full real password-reset flow — request a reset link from
the `forgot` view, see the `forgot-sent` confirmation, open the
emailed link, land on `/reset-password`, set a new password, land
on `/select-staff` signed in.

**Independent Test** (per spec.md US3 Independent Test): click
"Forgot password?", type owner's email, click "Send reset link",
see the confirmation, open the link in the email inbox, set a new
password, confirm redirect to `/select-staff` and that the new
password works on the next sign-in.

### Tests-first for US3 (Constitution IV — auth-critical path)

- [ ] T028 [P] [US3] Write `tests/unit/auth/login-actions.test.ts` extension for `sendPasswordReset`: parameterised test asserting that for each of `{success, unknown-email, AuthRetryableFetchError, generic SDK throw}` the action redirects to `/login?reset_sent=<encoded-email>&next=<encoded-next>`. Mock `supabase.auth.resetPasswordForEmail` per-case. Confirm the test FAILS (the action doesn't exist yet). (server-actions.contract.md § sendPasswordReset, FR-015, research.md R5.)
- [ ] T029 [P] [US3] Write `tests/unit/auth/login-actions.test.ts` extension for `sendPasswordReset` empty-email branch: posting an empty `email` field redirects to `/login?error=invalid&reset_intent=1&next=<encoded>`. Confirm FAILS. (server-actions.contract.md § sendPasswordReset behaviour step 1.)
- [ ] T030 [P] [US3] Create `tests/unit/auth/reset-password.test.ts` — covering the new `updatePassword` Server Action: (a) valid input + happy path → redirects to `/select-staff` AND `recordAuth` was called with `"device.password_reset"`, `userId`, `null`, `{ method: "recovery" }`; (b) password < 8 chars → `/reset-password?error=too_short`; (c) `password !== confirm` → `/reset-password?error=mismatch`; (d) no session → `/reset-password?error=expired`; (e) `AuthRetryableFetchError` → `/reset-password?error=network`. Mock `supabase.auth.getUser` and `supabase.auth.updateUser`. Spy on `recordAuth`. Confirm FAILS. (server-actions.contract.md § updatePassword, FR-017.)
- [ ] T031 [P] [US3] Write `tests/unit/auth/login-actions.test.ts` assertion: `sendPasswordReset` and `signInWithMagicLink` produce indistinguishable redirect URL shapes for registered-vs-unknown emails (no-enumeration parity per research.md R5 + server-actions.contract.md Invariant 6). Confirm FAILS for `sendPasswordReset`, passes for the existing `signInWithMagicLink` (regression baseline).
- [ ] T032 [US3] Run `npm test` and confirm T028–T031 all FAIL with `sendPasswordReset is not a function` / `updatePassword is not a function`. Constitution IV: tests fail before implementation lands.

### Implementation for US3 — server actions

- [ ] T033 [US3] Implement `sendPasswordReset(formData)` in `app/(auth)/login/actions.ts` per server-actions.contract.md § sendPasswordReset. Reuses the existing `getOrigin()` helper, the `encodeNext()` helper, the `isNextRedirectError()` helper. The `redirectTo` is `<origin>/auth/callback?next=<encoded-next>` — same shape as `signInWithMagicLink`, the `?type=recovery` query param is appended automatically by Supabase. Wraps the SDK call in a swallow pattern identical to `signInWithMagicLink` (lines 142-161). Confirm T028, T029, T031 pass after this lands.
- [ ] T034 [US3] Create `app/(auth)/reset-password/actions.ts` — exports `updatePassword(formData)` per server-actions.contract.md § updatePassword. Imports `recordAuth` from `lib/auth/audit`, `createSupabaseServerClient` from `lib/db/server`. Reads `password` + `confirm` without trimming. Validates: length ≥ 8, equality. Calls `getUser` → if no user, redirect to `?error=expired`. Calls `updateUser({ password })` → on `AuthRetryableFetchError`, redirect to `?error=network`. On success, records `device.password_reset` audit row with `payload: { method: "recovery" }`, then redirects to `/select-staff`. Confirm T030 passes after this lands.

### Implementation for US3 — callback recovery branch

- [ ] T035 [US3] **Extend** `app/auth/callback/route.ts` to branch on `?type=recovery`. (a) Read `type` from `searchParams`. (b) Extend the `AuthMethod` type union with `"recovery"`. (c) Rename `methodFromProvider(provider)` → `methodFromCallback(provider, type)` (lines 30-34) returning `"recovery"` when `type === "recovery"`. (d) After a successful `exchangeCodeForSession`, when `type === "recovery"`, redirect to `/reset-password` (NOT `/select-staff`). The `next` param is dropped on the recovery path — the reset flow ultimately lands on `/select-staff` after `updatePassword` runs. (e) On `exchange` failure when `type === "recovery"`, redirect to `/reset-password?error=expired` (NOT `/login?error=oauth_failed`). The audit row's `payload.method` becomes `"recovery"`. (routes.contract.md § /auth/callback, audit.contract.md § Lifecycle, FR-017(a/e).)

### Implementation for US3 — `/reset-password` page

- [ ] T036 [P] [US3] Create `app/(auth)/reset-password/page.tsx` — a Server Component. Reads `searchParams.error`. Calls `supabase.auth.getUser()` to check for a session. If no user OR `error === "expired"`, render the expired-state view (a `.auth-confirm-card` with copy "This link has expired or has already been used. Reset links are good for 1 hour and can only be used once." and a primary "Request a new link" button that links to `/login?reset_intent=1`). Otherwise, render the `<ResetPasswordForm>` (T037) plus, conditionally above it, the matching `.alert.alert-error` for `error in {too_short, mismatch, network}` with copy: "Password must be at least 8 characters." / "Passwords don't match." / "Couldn't update your password. Check your connection and try again." (routes.contract.md § /reset-password, FR-017.)
- [ ] T037 [P] [US3] Create `components/lacquer/reset-password-form.tsx` — a client component with the new-password form. Two `<input>` fields (`password` and `confirm`) each wrapped in `.input-wrap` with its own Eye/EyeOff toggle (each maintains a separate `useState<boolean>` for visibility, defaulting to hidden — matches FR-011 + FR-012 patterns). Heading "Set a new password" (24px / 600 / `--tracking-snug`), subtitle "Pick something you'll remember — 8 characters or more." Primary button "Set new password" with `form action={updatePassword}`. (FR-017(b/c), FR-029, ui-views.contract.md § Password-reveal toggle.)

### Implementation for US3 — forgot views

- [ ] T038 [US3] **Replace the `<ForgotView>` stub** in `components/lacquer/auth-views.tsx` with the real implementation per FR-014 + ui-views.contract.md. Renders: a `.auth-back-btn` (chevron-left + "Back to sign in" text, links to `/login?next=<encoded>` and intercepted by view-swap on hydration), `<h1 className="auth-form-title">Reset password</h1>`, `<p className="auth-form-subtitle">Enter your email and we'll send a reset link.</p>`, a single email input labelled "Email" with placeholder `you@tangstudio.com`, a `<form action={sendPasswordReset}>` with hidden `next` input, primary "Send reset link" button. Accept `next` and `error` props from the page. When `error === "invalid"`, render `.alert.alert-error` above the form: "Enter your email." (FR-014, FR-015, ui-views.contract.md.)
- [ ] T039 [US3] **Replace the `<ForgotSentView>` stub** in `components/lacquer/auth-views.tsx` with the real implementation per FR-016. Renders: back-btn (links to `/login`), `<h1>Check your email</h1>`, `<p>A reset link is on its way.</p>`, then a `.auth-confirm-card` div containing: `<p>We sent a password reset link to <strong>{email}</strong>. Click it to set a new password.</p>`, a muted second line "Didn't get it? Check your spam folder, or [send another link]." where the inline send-another link is an `<a href="/login?reset_intent=1&next=<encoded>">` styled as `.link-btn.xs`. Accept `email` and `next` props from the page. Email rendering MUST use `overflow-wrap: anywhere` for long emails (spec.md edge case). (FR-016, ui-views.contract.md.)

### Implementation for US3 — wire view-router

- [ ] T040 [US3] **Extend** `app/(auth)/login/page.tsx` view-selection block (from T012) to wire `<ForgotView>` and `<ForgotSentView>` based on `reset_intent` / `reset_sent` query params per the precedence table in ui-views.contract.md § URL → view precedence. (FR-008.)
- [ ] T041 [US3] **Extend** `<SignInView>` in `components/lacquer/auth-views.tsx` to render the inline "Forgot password?" link on the password label row. Plain `<a href="/login?reset_intent=1&next=<encoded>">` styled as `.auth-inline-link` / `.link-btn.xs` per ui-views.contract.md § Tab order. The link sits at the right end of a flex row whose left end is the "Password" `<Label>`. Tab order: email → password → eye toggle → Forgot link → Sign in button. (FR-010, US4 acceptance, ui-views.contract.md § Tab order.)

### Tests for US3 (e2e)

- [ ] T042 [US3] Add to `tests/e2e/auth.spec.ts`: "full password reset round-trip" — (a) navigate to `/login`, click "Forgot password?" — assert URL is `/login?reset_intent=1` and the heading is "Reset password"; (b) fill `owner@tangnails.dev`, click "Send reset link" — assert URL is `/login?reset_sent=owner%40tangnails.dev` and the confirmation card contains the email; (c) query Inbucket (`http://localhost:54324/api/v1/mailbox/owner/messages`) for the latest message; extract the reset link from the HTML body via regex matching `href="(http[^"]*type=recovery[^"]*)"`; (d) `await page.goto(<link>)` — assert URL ends in `/reset-password` (the `/auth/callback` recovery branch redirected); (e) fill both password inputs with `tang-nails-dev-new`, click "Set new password" — assert URL is `/select-staff`; (f) sign out, navigate to `/login`, sign in with `owner@tangnails.dev` + `tang-nails-dev-new` — assert reach `/select-staff`. (SC-009, US3 full acceptance.)
- [ ] T043 [US3] Add to `tests/e2e/auth.spec.ts`: "reset writes audit_log row" — after a successful reset (reuse T042's flow or factor out), query Supabase: `select action, payload from audit_log where action = 'device.password_reset' order by created_at desc limit 1` — assert the row exists with `payload = { method: 'recovery' }`. (SC-009, audit.contract.md.)
- [ ] T044 [US3] Add to `tests/e2e/auth.spec.ts`: "callback recovery branch writes device.signed_in (method=recovery)" — after the PKCE exchange (intercept in the middle of T042's flow), query Supabase: `select payload from audit_log where action = 'device.signed_in' order by created_at desc limit 1` — assert `payload->>'method' = 'recovery'`. (audit.contract.md § Lifecycle.)
- [ ] T045 [US3] Add to `tests/e2e/auth.spec.ts`: "mismatched passwords render inline error" — exercise the reset link (reuse the flow up through landing on `/reset-password`), fill `password=abc12345` + `confirm=different1`, click submit — assert URL is `/reset-password?error=mismatch` and the rendered alert says "Passwords don't match." (FR-017(c), US3 acceptance scenario 5.)
- [ ] T046 [US3] Add to `tests/e2e/auth.spec.ts`: "password < 8 chars renders inline error" — exercise the reset link, fill both fields with `short`, submit — assert URL is `/reset-password?error=too_short` and the alert is "Password must be at least 8 characters." (US3 acceptance scenario 5, FR-023 carried from 003.)
- [ ] T047 [US3] Add to `tests/e2e/auth.spec.ts`: "expired link renders expired state" — request a reset, open the link, immediately use `page.goto(<same-link>)` a second time in a fresh context — assert the second visit lands on `/reset-password?error=expired` and renders the expired-state card with the "Request a new link" button. (FR-017(e), US3 acceptance scenario 6, data-model.md Invariant B.)

**Checkpoint**: US3 ships the real reset flow. T032 → all reset
tests pass. Audit log shows both rows per reset. Owners can now
recover from a forgotten password without operator intervention.
This is the biggest behavioural delta in the feature.

---

## Phase 6: User Story 4 - Request a magic sign-in link from a dedicated view (P2)

**Goal**: Replace the inline `<details>`-based magic-link control
with two dedicated views (`magic` / `magic-sent`), matching the
prototype.

**Independent Test** (per spec.md US4 Independent Test): click
"Email me a sign-in link instead", see a dedicated view, type an
email, see the confirmation, click back, return to sign-in.

### Implementation for US4

- [ ] T048 [US4] **Replace the `<MagicView>` stub** in `components/lacquer/auth-views.tsx` with the real implementation per FR-019. Renders: back-btn (links to `/login?next=<encoded>`), `<h1>Sign in with a link</h1>`, `<p>We'll email you a one-time sign-in link — no password needed.</p>`, single email input labelled "Email" with placeholder `you@tangstudio.com`, `<form action={signInWithMagicLink}>` (the existing action from 003 — unchanged), hidden `next` input, primary "Send link" button. Accepts `next` and `error` props from the page. (FR-019, FR-020.)
- [ ] T049 [US4] **Replace the `<MagicSentView>` stub** in `components/lacquer/auth-views.tsx` with the real implementation per FR-021. Renders: back-btn, `<h1>Check your email</h1>`, `<p>A sign-in link is on its way.</p>`, then a `.auth-confirm-card` containing: `<p>We sent a sign-in link to <strong>{email}</strong>. Click it from your inbox — you can close this tab.</p>`, secondary line "Didn't get it? Check your spam folder, or [send another link]." linking to `/login?magic_intent=1&next=<encoded>`. (FR-021, ui-views.contract.md.)
- [ ] T050 [US4] **Extend** `app/(auth)/login/page.tsx` view-selection block to wire `<MagicView>` and `<MagicSentView>` per the URL precedence table. The `magic_sent` query param value (the email) flows into `<MagicSentView email={...} />`. (FR-008, routes.contract.md.)
- [ ] T051 [US4] **Update** `<SignInView>` to render the "Email me a sign-in link instead" link below the Google button (when present) or directly below the primary Sign-in button (when Google is disabled) as a plain `<a href="/login?magic_intent=1&next=<encoded>">` styled as `.link-btn.sm`, centred. The existing `MagicLinkControl` component is no longer used here. (FR-019, US5 acceptance scenario 3.)
- [ ] T052 [US4] **Delete** `components/lacquer/magic-link-control.tsx` — its job (the inline `<details>` + the post-submit confirmation card) is now split across `<MagicView>` and `<MagicSentView>`. Search the codebase for any remaining imports of `MagicLinkControl`; there should be none after T051 removes the page.tsx import. (Scope cleanup per Principle V.)

### Tests for US4 (e2e)

- [ ] T053 [US4] Add to `tests/e2e/auth.spec.ts`: "magic-link request via dedicated view" — navigate to `/login`, click "Email me a sign-in link instead" — assert URL `/login?magic_intent=1` and heading "Sign in with a link"; fill email, click "Send link" — assert URL `/login?magic_sent=<encoded-email>` and the confirmation card. (US4 acceptance scenarios 1+2.)
- [ ] T054 [P] [US4] Add to `tests/e2e/auth.spec.ts`: "magic-sent send-another loops back" — from the magic-sent confirmation, click "send another link" — assert URL `/login?magic_intent=1` and the view is `<MagicView>` again. (US4 acceptance scenario 3, FR-021.)
- [ ] T055 [P] [US4] Add to `tests/e2e/auth.spec.ts`: "back-to-sign-in clears magic params" — from `<MagicView>`, click "Back to sign in" — assert URL `/login` (no `magic_intent` / `magic_sent`) and view is `<SignInView>`. (US4 acceptance scenario 4, FR-009.)
- [ ] T056 [P] [US4] **Update** the existing 003 magic-link e2e test in `tests/e2e/auth.spec.ts` (the one that exercises `MagicLinkControl`'s `<details>` element) to use the new view-driven selectors. The underlying action contract is unchanged — only the DOM selectors shift. (Regression preservation per US5.)

**Checkpoint**: US4 fully testable. Magic-link is a peer recovery
on-ramp alongside US3's password-reset. The legacy `<details>`
pattern is gone; the magic-link surfaces are now first-class views.

---

## Phase 7: User Story 5 - Existing pre-redirect & error paths are unchanged (P1)

**Goal**: Verify no regression. The new shell changes the DOM but
NOT the behaviour. Every assertion from 003's auth.spec.ts still
holds; selectors may shift to match the new view-router DOM.

**Independent Test** (per spec.md US5 Independent Test): re-run the
existing `tests/e2e/auth.spec.ts` suite. Confirm every test passes
with at most selector-only updates.

This phase is **test-only**. No implementation. If any assertion
fails on a behavioural ground (not selector ground), STOP and fix the
underlying regression before proceeding.

### Test regression sweep for US5

- [ ] T057 [US5] **Audit `tests/e2e/auth.spec.ts`** — read the full file and identify every test that targets `/login`. For each, classify the kind of selector it uses: (a) text content (likely still works — copy is mostly unchanged), (b) form-action selector (still works — actions unchanged), (c) class names like `.auth-card`, `.auth-headline`, `.auth-magic-link*` (BROKEN — these classes were removed in T006). List the broken selectors in this task's description for follow-up. (Reading-only task; produces the inventory used by T058–T060.)
- [ ] T058 [US5] Update selectors in `tests/e2e/auth.spec.ts` that reference removed CSS classes. Map them to the new structure: `.auth-card` → `.auth-form-well` (or remove if the assertion was just "the card exists" — that's now the whole `.auth-form-panel`); `.auth-headline` → `.auth-form-title`; `.auth-magic-link*` → the new view-based selectors per T056. Do NOT change any behavioural assertion (URL after action, response status, audit-log row presence, redirect target). Confirm `npm run test:e2e -- --workers=1` is green. (US5 acceptance.)
- [ ] T059 [P] [US5] Re-verify each US5 acceptance scenario individually with a focused Playwright command:
   - `npx playwright test tests/e2e/auth.spec.ts -g "already signed in"` — confirms pre-redirect short-circuit (US5 acceptance 1).
   - `npx playwright test tests/e2e/auth.spec.ts -g "wrong password"` — confirms calm `.alert.alert-error` in the form panel (US5 acceptance 2).
   - `npx playwright test tests/e2e/auth.spec.ts -g "google flag"` — confirms Google + divider hide cleanly when `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=false` (US5 acceptance 3). Run with the env var explicitly unset.
   - `npx playwright test tests/e2e/auth.spec.ts -g "next preserved"` — confirms `?next=` threads through every transition (US5 acceptance 4). 
- [ ] T060 [P] [US5] Add `tests/e2e/auth.spec.ts` assertion: when `?error=invalid` is in the URL, the `.alert.alert-error` renders **inside** the form panel (above the form body), NOT outside it. Assert `await page.locator('.auth-form-panel .alert.alert-error').isVisible()` is true. (FR-013, US5 acceptance scenario 2.)
- [ ] T061 [US5] Run the full local gate set in order: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --workers=1`. All five MUST be green. Constitution v1.0.3 § Quality Gates + `feedback_run_full_gate_set_before_push`.

**Checkpoint**: US5 ships zero behavioural regression. The full
gate set passes. The feature is shippable end-to-end.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final tightening — the hydrated view-swap interception
(an enhancement over the working no-JS path), the prefers-reduced-
motion verification, the design auditor, the Principle I
side-by-side review, the seed-file confirmation, and the final
gate-set + browser smoke.

### Hydrated view-swap (enhancement on top of no-JS path)

- [ ] T062 **Extend** the client island in `components/lacquer/auth-views.tsx` with a top-level wrapper that intercepts `<a href="/login?...">` clicks within itself. On click: `event.preventDefault();`, parse the target query params, call `history.pushState({}, '', newUrl);`, dispatch a custom `popstate` event so `auth-views.tsx`'s `useEffect` listener re-reads the URL and swaps the view component. The view component remounts (different React key) so the `viewIn` animation runs. The wrapper also intercepts the browser back button via the standard `popstate` listener to swap views without a full reload. **No new dependency.** Tested by: `npx playwright test tests/e2e/auth.spec.ts -g "view swap is in-place"` (new assertion: after a forgot-password link click, `page.url()` matches `/login?reset_intent=1` but the document has NOT navigated — `page.evaluate('document.querySelector("html").dataset.navigationCount')` would be the same before and after; alternative: assert no `framenavigated` event fires for the same-document case). (research.md R1, FR-007.)
- [ ] T063 [P] Verify reduced-motion gating: `npx playwright test tests/e2e/auth.spec.ts -g "reduced motion"` with `page.emulateMedia({ reducedMotion: 'reduce' })`. Assertion: after a view swap, the new view's `.auth-view-pane` has computed animation duration `"0s"` (or no animation property). (FR-007, SC-007, research.md R6.)

### Design auditor & visual fidelity

- [ ] T064 Invoke `speckit-design-auditor` against the changed surface (`/login`, `/reset-password`, all `components/lacquer/auth-*.tsx`, `styles/auth.css`). Confirm **zero violations**. If violations surface, fix in-place and re-run. (Constitution Principle I, SC-001.)
- [ ] T065 [P] **Browser verification per CLAUDE.md "When you change UI" + quickstart.md § 6.** Open `/login` in a real browser at 1440×900. Compare side-by-side with `design-system/prototypes/auth/Login Screen.html` rendered in another tab via `python3 -m http.server` from `design-system/`. Verify every value matches (colours, spacing, radii, typography, decorative SVG positions, animation timing). Repeat at 768×1024 (iPad portrait), 480×800, 360×640 — confirm the < 720px collapse and solo wordmark. Toggle OS dark mode — confirm both panels switch tokens. Tab through the signin view, confirm tab order matches ui-views.contract.md § Tab order. Tab through `/reset-password`, confirm same. (SC-002, SC-003.)

### Seed & operator confirmation

- [ ] T066 [P] **Confirm dev seed already satisfies data-model.md Invariant A.** Read `supabase/seed.sql` lines 14-62; confirm both seeded users have `email_confirmed_at` set to `now()` (they do — lines 21 and 43). No edit required. This task is a documented verification so future readers know it was checked. (data-model.md Invariant A.)
- [ ] T067 [P] **Self-verify SC-010 manually against the preview project (post-deploy).** From the preview Vercel URL: (a) sign out of any active session; (b) sign in with `owner@tangnails.dev` + `tang-nails-dev`; (c) sign out; (d) click "Continue with Google" and complete the Google handshake with the same email; (e) in Supabase Dashboard → preview project → SQL Editor, run `select count(*) from auth.users where email = 'owner@tangnails.dev'` — assert `1`. Then `select provider from auth.identities where user_id = (select id from auth.users where email = 'owner@tangnails.dev')` — assert two rows: one `email`, one `google`. Record the result in a one-line comment on the PR description. (SC-010, research.md R4.)

### Final gate & sign-off

- [ ] T068 Run the full local gate set in order one final time: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --workers=1`. All five MUST be green. (Constitution v1.0.3, `feedback_run_full_gate_set_before_push`.)
- [ ] T069 [P] Confirm `CLAUDE.md`'s SPECKIT pointer still references `specs/010-login-redesign/plan.md` (set by `/speckit-plan`; reverify nothing has reset it).
- [ ] T070 [P] Confirm `specs/003-login-flow/spec.md` § FR-022 still has the "Superseded by `010-login-redesign` FR-014..FR-018" back-pointer added during `/speckit-clarify`. (Documentation hygiene per Clarifications session.)

**Checkpoint**: Feature is shippable. PR can be opened.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No code dependencies. T002 + T003 are operator actions on Supabase Dashboards and can happen any time before T042 (the first e2e test that needs the reset email link to resolve). T001 is verification only.
- **Phase 2 (Foundational)**: Depends on Phase 1 verification (T001). T004–T015 are sequenced as: audit union (T004) → CSS refactor (T006) → shell components (T007–T009, parallel) → layout refactor (T010) → view router scaffold (T011–T015, sequenced). T016 is the foundational gate.
- **Phase 3 (US1)**: Depends on Phase 2 (the shell IS US1's deliverable; this phase is verification + e2e on top).
- **Phase 4 (US2)**: Depends on Phase 2 (`<SignInView>` exists) + T013 / T022 (the LoginForm refactor).
- **Phase 5 (US3)**: Depends on Phase 2 (audit union, view router, layout) + T035 (callback recovery branch must extend the existing 003 handler). Largest dependency cluster: T028–T031 (tests) → T032 (gate) → T033 (sendPasswordReset) → T034 (updatePassword) → T035 (callback extension) → T036+T037 (`/reset-password` page + form, parallel) → T038+T039 (forgot views) → T040 (router wire) → T041 (Forgot link on SignInView) → T042–T047 (e2e).
- **Phase 6 (US4)**: Depends on Phase 2 (view router) and Phase 4's `<SignInView>` baseline (T015). US4 can land in parallel with US3 since the two flows touch different view stubs.
- **Phase 7 (US5)**: Depends on US1, US2, US3, US4 all being functional. Test-only phase.
- **Phase 8 (Polish)**: Depends on all prior phases.

### User Story Dependencies (within Phases 3–7)

- **US1 (P1)**: No story dependencies — delivered as foundational + verification.
- **US2 (P1)**: Depends on US1's shell + SignInView.
- **US3 (P1)**: Depends on US1 + US2 (its `<SignInView>` integration needs the password field with toggle, and the Forgot link added in T041 sits on the password field row).
- **US4 (P2)**: Depends on US1 + US2 (its "Email me a sign-in link instead" link sits below the Google button in the SignInView).
- **US5 (P1)**: Depends on US1, US2, US3, US4 — verifies their combined non-regression.

### Within Each User Story

- Tests written first for US3 (auth-critical, Constitution IV); tests written alongside implementation for US1/US2/US4 (UX-only, no behavioural delta).
- Server Actions written before the views that submit to them (e.g. T033 before T038).
- View components written before the router wires them (e.g. T038–T039 before T040).

### Parallel Opportunities

- **Phase 1**: T002 + T003 are operator-only and run in parallel against the Supabase Dashboard.
- **Phase 2C**: T007 + T008 + T009 are three separate component files, no inter-dependency → parallel.
- **Phase 2A**: T004 + T005 are different files (production code + test) → parallel.
- **Phase 5 (US3) tests**: T028 + T029 + T030 + T031 are all separate test paths → parallel.
- **Phase 5 (US3) impl**: T036 (page) + T037 (form) can be parallel after T034 (action) lands.
- **Phase 6 (US4)**: T048 + T049 (the two view stubs) are parallel.
- **Phase 7 (US5)**: T059 + T060 + T056 are parallel after T058 fixes selectors.
- **Phase 8**: T063, T065, T066, T067, T069, T070 are all independent → parallel.

---

## Parallel Example: Phase 2C (foundational shell components)

```bash
# These three files don't import each other in T007/T008/T009; the only
# coupling is that auth-shell.tsx (T007) imports the other two — but
# that import is satisfied as long as the files exist, even if their
# internals are still being written. Three developers can claim one
# each:
Task: "T007 Create components/lacquer/auth-shell.tsx (two-panel grid wrapper)"
Task: "T008 Create components/lacquer/auth-brand-panel.tsx (left brand panel)"
Task: "T009 Create components/lacquer/auth-form-panel.tsx (right form panel + solo wordmark)"
```

## Parallel Example: Phase 5 (US3) tests-first

```bash
# Four independent test files / test paths; write them all in parallel
# before any implementation lands. Constitution IV: tests must FAIL
# (T032 confirms) before implementation in T033+ proceeds.
Task: "T028 Vitest test: sendPasswordReset redirects to ?reset_sent for {success, unknown, network, throw}"
Task: "T029 Vitest test: sendPasswordReset empty-email branch → ?error=invalid&reset_intent=1"
Task: "T030 Vitest test: updatePassword — full 5-path coverage (happy, too_short, mismatch, expired, network)"
Task: "T031 Vitest test: sendPasswordReset enumeration parity (registered vs unknown produce same redirect URL)"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 (operator setup — T002 + T003 in parallel, T001 verification).
2. Complete Phase 2 (foundational shell + audit union extension).
3. Complete Phase 3 (US1 — visual fidelity verification + responsive e2e).
4. **STOP and VALIDATE**: open `/login` in a browser; compare to prototype; run `tests/e2e/auth.spec.ts -g "renders two-panel shell"`. Deploy to preview if ready.

At this point you have a **shippable visual refresh** with zero new functionality (every 003 behaviour preserved). This is the safe "land the new shell" PR.

### Incremental Delivery (recommended for this branch)

1. **PR 1 (MVP)**: Phases 1 + 2 + 3 + 5 (US5 regression). Ships the new shell with zero behavioural delta. Reviewable in isolation.
2. **PR 2 (UX polish)**: Phase 4 (US2 password reveal). Tiny, ergonomic improvement.
3. **PR 3 (recovery flow)**: Phase 5 (US3 reset password). This is the biggest behavioural change — deserves its own review.
4. **PR 4 (magic-link refactor)**: Phase 6 (US4). Visual restructure, no new behaviour.
5. **PR 5 (polish)**: Phase 8.

For a single-PR approach (also acceptable given the cohesive scope), open one PR that bundles all phases and let the reviewer step through commits.

### Parallel Team Strategy

With multiple developers after Phase 2 lands:

1. Phase 2 is sequential — one developer drives it.
2. Once Phase 2 is green:
   - Developer A: Phase 3 (US1) — small, ~2 hours.
   - Developer B: Phase 4 (US2) — small, ~2 hours.
   - Developer C: Phase 5 (US3) — big, ~1 day.
   - Developer D: Phase 6 (US4) — small, ~3 hours.
3. Phase 7 (US5 regression) runs after all four merge; one developer drives.
4. Phase 8 (polish) is shared.

---

## Notes

- `[P]` = different files, no dependencies — safe to run in parallel.
- `[Story]` = traceability back to spec.md user stories.
- Tests for US3 are written FIRST (Constitution IV — auth-critical path); T032 is the explicit gate that confirms they fail before implementation.
- Tests for US1/US2/US4 are written alongside implementation because the underlying behaviour is already proven by 003's test suite; new tests only verify the new DOM, not new logic.
- US5 is intentionally test-only — it has no implementation tasks; its value is verifying nothing regressed.
- Commit after each task or logical group. Auto-commit hooks (`after_implement`) handle this for `/speckit-implement` runs.
- Stop at any checkpoint to validate independently — each phase is a coherent slice.
- `npm run test:e2e` MUST be invoked with `--workers=1` per CLAUDE.md to avoid `audit_log` truncate races across spec files.
- Avoid: cross-story dependencies that break independence; same-file edits across parallel tasks; behavioural assertions in US5 that aren't already in 003's spec.
