# Feature Specification: Login UI/UX Redesign (Brand-Panel Shell)

**Feature Branch**: `010-login-redesign`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Update the current login UI/UX. Fetch the
Lacquer design handoff (Login Screen.html), read its README, and implement
the relevant aspects of the design. Make a copy of the prototype and store
it in our design system / prototypes folder."

## Overview

This feature does two things to the existing login surface (`/login` from
`003-login-flow`):

1. **Re-skins it to the new Lacquer prototype** at
   `design-system/prototypes/auth/Login Screen.html` — a **two-panel layout**
   (Lacquer-branded left panel + focused form panel on the right), a
   **view-based flow** that swaps the form pane between sign-in,
   forgot-password, magic-link, and the two "Check your email"
   confirmations (replacing the inline `<details>` expand pattern), a
   **password reveal toggle**, and **dark-mode honouring** at the shell
   level.
2. **Adds a real password-reset flow** — separately from magic-link.
   Clicking the inline "Forgot password?" link opens a "Reset password"
   view that calls Supabase's `resetPasswordForEmail` and shows a "Check
   your email" confirmation. The emailed link lands on a new
   `/reset-password` page where the user sets a new password and is
   signed in to `/select-staff`. This **explicitly overrides
   `003-login-flow` FR-022**, which had deferred the traditional
   password-reset path in favour of magic-link only.

Magic-link recovery survives as a **second on-ramp** — both because the
prototype shows them as peer first-class views and because an owner who
no longer has access to their email password manager benefits from a
no-password alternative. The pre-redirect logic, error alerts,
audit-log events, redirect semantics, and the Google sign-in button at
`/login` all remain identical.

The prototype's tweaks panel (`tweaks-panel.jsx`) is a design-canvas
artefact and is not implemented.

This is a **visual / UX redesign plus one new recovery flow**. The new
flow introduces (a) Supabase Auth's `resetPasswordForEmail` configuration
(redirect target, email template), and (b) a new `/reset-password` page
that exchanges the PKCE code and updates the password. No new
environment variables or DB migrations are required. Existing E2E flows
and unit tests continue to pass against the redesigned `/login` with
selectors-only updates; new tests cover the reset flow end-to-end.

## Clarifications

### Session 2026-05-16

- Q: Should the spec adopt the prototype's "Reset password" /
  "Check your email" views and override `003-login-flow` FR-022? →
  A: Yes — adopt both views and ship a real Supabase
  `resetPasswordForEmail` flow. The override is recorded in this
  spec (FR-018) and a "Superseded by 010" note is added to
  `003-login-flow` § FR-022 so the audit trail stays visible.
- Q: After forgot-password is added, what is the magic-link's role
  on `/login`? → A: **Keep both** as peer recovery paths.
  Forgot-password sits as the inline "Forgot password?" link beside
  the password field; magic-link stays as the "Email me a sign-in
  link instead" subordinate link below Google. The prototype shows
  both as separate first-class views; this matches.
- Q: Can a Gmail-based owner created via email/password be merged
  with their Google sign-in into a single user, and is Google OAuth
  on the Supabase free tier? → A: Yes to both. Supabase Auth's
  default **automatic identity linking by verified email** attaches
  the new Google identity to the existing user record when the
  emails match and the existing user has `email_confirmed_at` set —
  no second user is created. Social OAuth providers (Google
  included) are part of the free tier alongside the 50,000-MAU
  allowance; no upcharge. Practical consequence: the seeded
  bootstrap owner row must have `email_confirmed_at` populated so
  the link fires safely (recorded as an assumption + a seed-file
  requirement in this spec).
- Q: Where does the user land after a successful password reset? →
  A: `/select-staff`. The `updateUser({ password })` call signs the
  user in (PKCE flow), so they pick up at the operator step instead
  of being bounced back to `/login`.
- Q: Reset link TTL? → A: Supabase default (1 hour). No deviation
  needed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner sees the rebranded sign-in shell (Priority: P1)

The salon owner opens `/login` on a counter laptop and immediately
recognises a more polished, Tang Nails-branded experience. A left brand
panel anchors the page with the Lacquer wordmark, the tagline "Studio
tools built for focused work.", and a calm sub-line about what the
product does. A right form panel holds the same fields they already know
(email, password, sign in, Google, magic-link link), but the field group
is now visually centred in its own 480px-wide column with the wordmark
removed from the form area itself (the brand panel carries it).

**Why this priority**: The point of the redesign is the new brand-panel
layout. Without this story, nothing else in this feature is observable
to the user. Every other story is a refinement on top of the new shell.

**Independent Test**: From a signed-out browser ≥ 720px wide, navigate
to `/login`. Confirm two side-by-side regions render: a left brand panel
showing the Lacquer mark + "Tang Nails Studio" wordmark + tagline +
sub-line, and a right form panel with the existing sign-in fields. Confirm
all colours, spacing, and radii resolve to Lacquer tokens. Resize the
viewport to < 720px and confirm the brand panel hides, the form panel
fills the full width, and a solo wordmark appears above the form so the
user still sees brand context.

**Acceptance Scenarios**:

1. **Given** a signed-out user opens `/login` on a desktop-width
   viewport (≥ 720px), **When** the page renders, **Then** the layout
   shows a left brand panel (1fr) and a right form panel (480px fixed)
   filling the viewport height, with a 1px Lacquer border separating
   them.
2. **Given** the same user on a viewport < 720px, **When** the page
   renders, **Then** the brand panel is hidden, the form panel fills
   the full width with no left border, and a small wordmark
   (Lacquer mark + "Tang Nails Studio") appears above the form.
3. **Given** the page rendered, **When** every visible colour, spacing,
   radius, shadow, and font value is inspected, **Then** each one
   resolves to a `var(--*)` token from `styles/tokens.css` (no raw hex,
   no off-scale spacing, no ad-hoc weights).
4. **Given** the page rendered in either dark or light system mode,
   **When** the user views the brand panel and form panel, **Then**
   both panels honour the active mode (light-mode rose-tinted panel
   over off-white form; dark-mode near-black panel + form) using the
   existing `.dark` token overrides from `styles/tokens.css`.

---

### User Story 2 - Show / hide password during sign-in (Priority: P1)

While typing a password, the owner taps an eye icon at the right edge of
the password field to reveal what they typed. Tapping again hides it. The
field type toggles between `password` and `text` accordingly. This is a
small but real ergonomic improvement over the current field which only
ever shows masked dots.

**Why this priority**: Password reveal is one of the headline UX deltas
from the prototype and is the kind of small affordance owners notice
immediately when they first see the redesign. It's small to build but
high-signal as proof the redesign landed.

**Independent Test**: On `/login`, type any string into the password
field. Confirm the input is masked. Click the eye icon at the right
edge of the field. Confirm the input becomes legible plaintext and the
icon switches to "eye-off". Click again. Confirm the input is masked
again and the icon switches back. Tab to the icon with the keyboard,
press Enter, and confirm the same toggle works.

**Acceptance Scenarios**:

1. **Given** the user is on `/login`, **When** the password field is
   rendered, **Then** a button sits at the right edge of the field
   with a Lucide eye icon (16px, 1.5px stroke, `--muted-foreground`)
   and an `aria-label` of "Show password".
2. **Given** the user clicks the eye button, **When** the toggle fires,
   **Then** the input's `type` becomes `text`, the icon becomes the
   Lucide eye-off variant, and the `aria-label` becomes "Hide
   password".
3. **Given** the user has revealed the password, **When** they submit
   the form, **Then** the submission proceeds normally (the toggle
   state has no effect on what is sent to Supabase).
4. **Given** the user navigates to the password field with the
   keyboard, **When** they Tab into the eye button and press Enter,
   **Then** the toggle behaves identically to a click.

---

### User Story 3 - Reset a forgotten password from a dedicated view (Priority: P1)

When an owner forgets their password, an inline **"Forgot password?"**
link sits beside the password field. Clicking it swaps the form panel
to a "Reset password" view: back button, single email field,
"Send reset link" primary button. On submit, the panel swaps to a
"Check your email" confirmation card. The email contains a one-time
link that opens a new `/reset-password` page where the owner enters and
confirms a new password, and is signed in to `/select-staff` on success.

**Why this priority**: Adds a first-class recovery path for the most
common failure mode ("I forgot my password"). Magic-link still exists
as a second on-ramp (US4), but a dedicated reset flow is what most
users reach for first and the prototype elevates it accordingly. This
story **overrides `003-login-flow` FR-022**, which had deferred this
flow in v1.

**Independent Test**: On `/login`, click the "Forgot password?" link
inline with the password field. Confirm the form panel swaps to a view
titled "Reset password" with a back button ("Back to sign in"), a
single email input, and a "Send reset link" button. Type the seeded
owner's email and press "Send reset link". Confirm the panel swaps to
a "Check your email" confirmation showing the email and a
"send another link" link. Open the link in the test email inbox.
Confirm it lands on `/reset-password` with a new-password + confirm
form. Set a new password, submit. Confirm redirect to `/select-staff`
and the new password works on the next sign-in.

**Acceptance Scenarios**:

1. **Given** the user is on the sign-in view, **When** they click
   "Forgot password?", **Then** the form panel transitions (200ms
   fade + 8px translate-up, `viewIn` keyframe) to the "Reset
   password" view with the prototype's `forgot` copy verbatim
   ("Reset password" heading, "Enter your email and we'll send a
   reset link." subtitle).
2. **Given** the user is on the "Reset password" view, **When**
   they enter an email and submit, **Then** a Server Action calls
   `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/reset-password' })`
   and on success the panel swaps to the "Check your email"
   confirmation showing the entered email.
3. **Given** the email has been sent, **When** the user opens the
   reset link in their inbox, **Then** they land on `/reset-password`
   with the PKCE code already exchanged for a session, and see two
   inputs ("New password" + "Confirm password") and a "Set new
   password" primary button.
4. **Given** the user submits two matching passwords meeting the
   8-character floor (per `003-login-flow` FR-023), **When**
   the Server Action calls `supabase.auth.updateUser({ password })`,
   **Then** the user is signed in by that update and is redirected
   to `/select-staff`.
5. **Given** the user submits mismatched passwords or a password
   under 8 characters, **When** validation fires, **Then** a calm
   inline error appears in the form panel ("Passwords don't match."
   / "Password must be at least 8 characters.") without revealing
   any account state.
6. **Given** the reset link is expired (older than the Supabase
   default 1-hour TTL) or has already been used, **When** the user
   opens it, **Then** `/reset-password` renders a calm
   "This link has expired or has already been used." message with a
   button to request a new one (links back to `/login?reset_intent=1`).

---

### User Story 4 - Request a magic sign-in link from a dedicated view (Priority: P2)

When an owner prefers passwordless access — or when they can't
remember their password and want a quick one-time entry instead of
choosing a new one — the "Email me a sign-in link instead"
subordinate link below the Google button leads to a dedicated view.
The form panel swaps with a 200ms fade-in to a focused "Sign in with
a link" surface: back button, single email field, "Send link" primary
button. On submit, the same surface swaps to a "Check your email"
confirmation card. The underlying Supabase magic-link request
(`signInWithOtp`) and the `?magic_sent=` URL contract are unchanged.

**Why this priority**: Magic-link is now a **second** recovery
on-ramp alongside forgot-password (US3). P2 because forgot-password
covers the same blocked-on-password scenario; magic-link is the
fallback for owners who don't want to choose a new password mid-shift.
The redesign elevates the existing inline `<details>` control into a
full view to match the prototype.

**Independent Test**: On `/login`, click the "Email me a sign-in link
instead" text link below the Google button. Confirm the form panel
swaps to a view with a back button ("Back to sign in"), a heading
"Sign in with a link", a single email input, and a "Send link" button.
Type an email and press "Send link". Confirm the panel swaps to a
"Check your email" confirmation showing the email address and a
"send another link" link. Click the back button. Confirm the panel
swaps back to the sign-in view.

**Acceptance Scenarios**:

1. **Given** the user is on the sign-in view, **When** they click
   "Email me a sign-in link instead", **Then** the form panel
   transitions to the "Sign in with a link" view (heading "Sign in
   with a link", subtitle "We'll email you a one-time sign-in link
   — no password needed.").
2. **Given** the user is on the "Sign in with a link" view, **When**
   they enter an email and submit, **Then** the existing magic-link
   Server Action (`sendMagicLink` from `app/(auth)/login/actions.ts`)
   fires unchanged and on success the form panel swaps to the
   "Check your email" confirmation, which surfaces the entered email
   in the body copy.
3. **Given** the user is on the "Check your email" confirmation,
   **When** they click "send another link", **Then** the panel swaps
   back to the "Sign in with a link" view with the email field
   pre-populated so they can adjust and resubmit.
4. **Given** the user is on either the request or confirmation view,
   **When** they click "Back to sign in", **Then** the panel swaps
   back to the sign-in view and the URL drops the `magic_sent` /
   `magic_intent` query parameter if present.

---

### User Story 5 - Existing pre-redirect & error paths are unchanged (Priority: P1)

The new shell does not regress any of the behavioural guarantees from
`003-login-flow`. An already-signed-in user still skips the form. Wrong
passwords still show a calm inline error in the form panel. The Google
button still hides cleanly when `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` is
not `true`. The `next` redirect target still survives every transition.

**Why this priority**: The redesign is worthless if it silently breaks
production auth. P1 because every existing acceptance scenario in
`003-login-flow` US1-US6 must continue to pass against the new shell.

**Independent Test**: Re-run the existing `tests/e2e/login.spec.ts`
suite against the redesigned page. Confirm every test passes with at
most selector-only updates (no logic changes). Spot-check: signed-in
visit to `/login` still redirects forward to `/select-staff`; wrong
password still shows the calm inline alert without revealing whether
the email exists; the Google button hides when its flag is off; the
`?next=` param still threads through magic-link and sign-in.

**Acceptance Scenarios**:

1. **Given** a user already has a valid Supabase session and operator
   cookie, **When** they navigate to `/login`, **Then** the page
   short-circuits to `sanitizeNext(next)` without rendering the new
   shell (FR-005 from `003-login-flow` continues to hold).
2. **Given** the user submits the sign-in form with an incorrect
   password, **When** the action returns the error, **Then** the
   alert renders inside the form panel above the form body with the
   prototype's `.alert-error` styling (rose-tinted background, 1px
   border, `AlertCircle` icon), and the copy still reads "Email or
   password is incorrect." — the wording does not change.
3. **Given** `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED !== 'true'`, **When**
   the page renders, **Then** the Google button and the "or" divider
   above it are both omitted; the "Email me a sign-in link instead"
   link still renders directly below the primary Sign-in button.
4. **Given** any view is showing (sign-in, magic, magic-sent),
   **When** the user follows any control, **Then** the `?next=`
   value is preserved across the transition and ultimately carried
   into the magic-link Server Action and the post-login redirect.

---

### Edge Cases

- **Reduced motion.** Users with `prefers-reduced-motion: reduce` MUST
  see view swaps and panel renders complete in ≤ 1 frame (no fade, no
  translate). The `viewIn` animation MUST be wrapped in a
  `@media (prefers-reduced-motion: no-preference)` block.
- **Long email in the "Check your email" confirmation.** The email
  is rendered inside a `<strong>` and MUST wrap with `overflow-wrap:
  anywhere` (or equivalent) so a 60-character work email does not
  push the confirmation card past the 360px form well.
- **Dark mode at OS level only.** v1 honours `prefers-color-scheme:
  dark` via the existing `.dark` class wiring in `styles/tokens.css`;
  there is **no** user-controlled theme toggle on `/login` (the
  prototype's dark-mode tweak is a design-canvas artefact). The
  brand panel's rose tint switches to the `--panel-bg` / `--panel-border`
  near-black tokens automatically.
- **Brand panel hidden at narrow widths.** Below 720px, the brand
  panel hides outright; the form panel renders a solo wordmark above
  the form so the user still sees brand context. The breakpoint
  matches the prototype (720px).
- **Password reveal across view swaps.** The reveal toggle state
  resets to "hidden" whenever the user swaps to a different view
  and back — no leaking of a previously revealed password across
  view transitions.
- **Keyboard-only sign-in.** Tab order across the new layout MUST
  be: email → password → eye toggle → "Forgot password?" → "Sign in"
  → "Continue with Google" (when present) → "Email me a sign-in link
  instead". No element in the brand panel is keyboard-focusable.
- **Autofill on first paint.** When the browser autofills email +
  password before React has hydrated the toggle state, the field
  type MUST remain `password` so the autofilled credential is not
  exposed as plaintext on first paint.
- **Multiple tabs of `/login`.** The view state (sign-in, magic,
  magic-sent) lives in-page and is not URL-encoded except for the
  existing `?magic_sent=` query param. A second tab opening `/login`
  with `?magic_sent=...` renders the confirmation view directly,
  matching the existing behaviour.
- **JS-disabled / hydration failure.** The sign-in view (form fields,
  primary button, Google button, magic-link link, forgot-password
  link) MUST render and be submittable without JavaScript — the eye
  toggle, view swaps, and reduced-motion gating may be no-ops, but
  the password form posts to its existing Server Action and the
  recovery links navigate to `?magic_intent=1` / `?reset_intent=1`
  query states that the page reads server-side to render the
  corresponding view as the initial pane.
- **Password reset for a non-existent email.** Supabase's
  `resetPasswordForEmail` resolves successfully whether or not the
  email is registered (it's silent on miss to defeat enumeration).
  The page MUST therefore always show the `forgot-sent` confirmation
  on a successful action, never a "no such email" error. The only
  error path on `forgot` is a network/Supabase outage.
- **Reset link expired or already used.** When the user opens an
  expired or already-redeemed reset link, `/reset-password` MUST
  render a calm "This link has expired or has already been used."
  state with a "Request a new link" button that returns to
  `/login?reset_intent=1`. The user is not signed in by an expired
  link; no partial session is created.
- **PKCE code already exchanged in a different tab.** A reset link
  is single-use; the second tab to open it lands on the expired
  state above. No data is mutated by the second tab.
- **Reset submitted with mismatched passwords.** The `/reset-password`
  Server Action MUST refuse to call `updateUser` until both fields
  match and the new password is ≥ 8 characters. Validation errors
  render inline in the form panel; the PKCE session remains valid
  for retry within its 1-hour window.
- **Google sign-in for an existing email/password user.** Supabase
  auto-links the new Google identity to the existing user record
  when the emails match and the existing email is confirmed (see
  FR-022). On subsequent sign-ins the user can use either
  password OR Google interchangeably; `auth.uid()` is stable
  across both. No duplicate user row, no duplicate audit-log
  attribution.
- **Google sign-in for an email that has an unconfirmed
  email/password user.** Supabase refuses to auto-link to defeat
  takeover. The Google sign-in succeeds but creates a separate
  user. This is an operational concern: the seeded bootstrap owner
  MUST be created with `email_confirmed_at` populated (FR-022) so
  this case cannot arise for production owners.

## Requirements *(mandatory)*

### Functional Requirements

#### Layout & shell

- **FR-001**: System MUST present `/login` as a two-panel shell at
  viewports ≥ 720px wide: a left brand panel (flex: 1) and a right
  form panel (fixed 480px width), each filling the full viewport
  height, separated by a 1px border in `--border`.
- **FR-002**: System MUST collapse the shell to a single form panel
  at viewports < 720px: brand panel hidden, form panel full-width
  with no left border, with a small "solo wordmark" (Lacquer mark
  + "Tang Nails Studio") rendered above the form.
- **FR-003**: System MUST render the brand panel with: the Lacquer
  mark + "Tang Nails Studio" wordmark in the top-left, a tagline
  ("Studio tools built for focused work.") and a sub-line
  ("Bookings, clients, payments, and staff scheduling — all in one
  quiet place.") anchored to the bottom-left above a 64px bottom
  inset, plus two decorative Lacquer-mark SVGs sized 380px and
  160px in the upper-right and lower-right at 7.5% / 4.5% opacity
  respectively. All copy and decoration MUST trace to Lacquer
  tokens (text sizes, spacing, opacity, colour fills as in the
  prototype).
- **FR-004**: System MUST render the form panel with a 360px
  max-width form well, vertically and horizontally centred in the
  panel, with 48px top/bottom padding and 40px left/right padding.
- **FR-005**: System MUST honour `prefers-color-scheme: dark` via
  the existing `.dark` class on the root, using the prototype's
  `--panel-bg` / `--panel-border` near-black tokens for the brand
  panel and the existing dark-mode token cascade for the form.

#### View flow & transitions

- **FR-006**: System MUST render the form panel as one of five
  in-page views on `/login`: `signin` (default), `forgot` (request
  a password-reset link), `forgot-sent` (reset-link confirmation),
  `magic` (request a sign-in link), and `magic-sent` (magic-link
  confirmation). The legacy `<details>`-based magic-link control
  from `003-login-flow` MUST be removed.
- **FR-007**: System MUST animate each view swap with a 200ms
  fade + 8px translate-up (`viewIn` keyframe, ease-out-expo), and
  MUST omit the animation when `prefers-reduced-motion: reduce` is
  set.
- **FR-008**: System MUST seed the initial view from the URL:
  `?magic_sent=<email>` → `magic-sent`;
  `?magic_intent=1` → `magic`;
  `?reset_sent=<email>` → `forgot-sent`;
  `?reset_intent=1` → `forgot`; otherwise → `signin`.
- **FR-009**: System MUST provide a "Back to sign in" control on
  every non-`signin` view (a chevron-left + text button styled as
  `.back-btn`) that swaps back to `signin` and clears
  `magic_sent` / `magic_intent` / `reset_sent` / `reset_intent`
  from the URL.

#### Sign-in view

- **FR-010**: System MUST render the sign-in form with: a
  "Sign in" heading (24px / 600 / `--tracking-snug`), a "Welcome
  back to Tang Nails Studio" subtitle, an email field labelled
  "Email" with placeholder "you@tangstudio.com", a password field
  labelled "Password" with the "Forgot password?" inline link, a
  primary "Sign in" button, an "OR" divider, an outline-style
  "Continue with Google" button (when its flag is on), and a
  centred "Email me a sign-in link instead" subordinate link
  below.
- **FR-011**: System MUST render the password field with a right-
  edge button containing a Lucide `Eye` (when hidden) or `EyeOff`
  (when revealed) icon at 16px, 1.5px stroke,
  `--muted-foreground` colour, with `aria-label` "Show password" /
  "Hide password". The button toggles the input `type` between
  `password` and `text` and is keyboard-operable via Enter.
- **FR-012**: System MUST reset the password reveal toggle to
  "hidden" on any view swap (including when navigating to and
  returning from the magic-link view).
- **FR-013**: System MUST render any sign-in error inside the
  form panel above the form body using the prototype's
  `.alert-error` styling (rose-tinted background, 1px border in
  the destructive tint, an `AlertCircle` icon at 14px). The
  existing error copy from `003-login-flow` (and `?error=invalid`
  / `?error=network` / `?error=oauth_failed` mappings) is
  unchanged.

#### Password reset (overrides `003-login-flow` FR-022)

- **FR-014**: System MUST route the inline "Forgot password?" link
  beside the password field to the `forgot` view. The view MUST
  show heading "Reset password" and subtitle "Enter your email and
  we'll send a reset link." — the prototype's copy verbatim.
- **FR-015**: System MUST submit the password-reset request through
  a new Server Action `sendPasswordReset(email)` in
  `app/(auth)/login/actions.ts` that calls
  `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<origin>/reset-password' })`.
  On success the action MUST redirect to
  `/login?reset_sent=<encoded-email>` (the page seeds the
  `forgot-sent` view from that query). On failure (network /
  Supabase outage) the action MUST surface a calm inline error on
  the `forgot` view; it MUST NOT reveal whether the email is
  registered.
- **FR-016**: System MUST render the `forgot-sent` confirmation
  as a card styled with the prototype's `.confirm-card` rules
  (`--muted` background, 1px border, 12px radius, 20px padding),
  containing: a heading "Check your email", a subtitle "A reset
  link is on its way.", a paragraph naming the email address in
  `<strong>` and "Click it to set a new password.", and a
  secondary line "Didn't get it? Check your spam folder, or
  [send another link]." where the send-another link swaps back
  to the `forgot` view with the email pre-filled.
- **FR-017**: System MUST expose a new page at `/reset-password`
  (in `app/(auth)/reset-password/page.tsx`) that the emailed link
  lands on. The page MUST:
  (a) Exchange the PKCE code on first paint via
  `supabase.auth.exchangeCodeForSession(code)` to establish a
  session.
  (b) Render two password fields ("New password", "Confirm
  password") and a "Set new password" primary button — same
  Lacquer field/button styling as the sign-in view, with the
  password reveal toggle on both fields.
  (c) Validate (1) both fields match, (2) the new password is at
  least 8 characters (per `003-login-flow` FR-023 — no
  character-class rules). Show calm inline errors on failure.
  (d) On submit, call `supabase.auth.updateUser({ password })`
  inside a Server Action, write a `device.password_reset` row to
  `audit_log` (new controlled-vocabulary value extending the union
  defined in `003-login-flow` FR-016), and redirect to
  `/select-staff`.
  (e) Render a calm "This link has expired or has already been
  used." state with a "Request a new link" button (linking to
  `/login?reset_intent=1`) when the PKCE exchange fails or the
  session is absent.
- **FR-018**: This feature **explicitly overrides `003-login-flow`
  FR-022**. The traditional password-reset email flow is now in
  scope. The override is recorded in this spec's Clarifications
  block and a "Superseded by 010-login-redesign FR-017/FR-018"
  note MUST be added to `specs/003-login-flow/spec.md` § FR-022
  in the same change set so the audit trail stays visible.

#### Magic-link recovery (preserved as second on-ramp)

- **FR-019**: System MUST route the "Email me a sign-in link
  instead" subordinate link below Google to the `magic` view.
  The view MUST show heading "Sign in with a link" and subtitle
  "We'll email you a one-time sign-in link — no password needed."
- **FR-020**: System MUST submit the magic-link request through
  the existing `sendMagicLink` Server Action from
  `app/(auth)/login/actions.ts` (or its successor of identical
  signature). The action contract — including `?next=`
  preservation, the `?magic_sent=<email>` redirect on success,
  and inline error rendering on failure — is unchanged.
- **FR-021**: System MUST render the `magic-sent` confirmation
  as a card styled with the prototype's `.confirm-card` rules,
  containing: a heading "Check your email", a subtitle "A sign-in
  link is on its way.", a paragraph naming the email address in
  `<strong>` and "Click it from your inbox — you can close this
  tab.", and a "send another link" link that swaps back to the
  `magic` view with the email pre-filled.

#### Google identity linking (research outcome)

- **FR-022**: System MUST rely on Supabase Auth's **default
  automatic identity linking by verified email** to merge a
  Google OAuth identity with an existing email/password user
  that shares the same email address. No additional Supabase
  Auth config change is required — auto-linking is on by
  default. The seeded owner row in `supabase/seed.sql` (and the
  production bootstrap one-off SQL) MUST set `email_confirmed_at`
  to a non-NULL timestamp so the link fires safely (Supabase
  refuses to auto-link to an unconfirmed identity to defeat
  takeover via OAuth). This requirement amends — and is the
  single deviation from — the seed-data assumption in
  `003-login-flow`.

#### Out of scope (explicit)

- **FR-023**: The prototype's tweaks panel (`tweaks-panel.jsx`)
  is a design-canvas artefact and is **not** implemented. It is
  kept alongside `Login Screen.html` in
  `design-system/prototypes/auth/` so the prototype HTML still
  renders untouched in a browser.
- **FR-024**: No user-controlled theme toggle is added on
  `/login` or `/reset-password`. Dark mode is honoured only via
  `prefers-color-scheme: dark`. A future Settings → Appearance
  feature MAY add a manual toggle; this feature does not.
- **FR-025**: Self-service account creation, email-change
  flows, and MFA remain **out of scope**. The owner is still
  seeded via SQL (`supabase/seed.sql` for dev, Supabase Studio
  for production bootstrap) per `003-login-flow`. This feature
  only adds the password-reset recovery on top of the existing
  seeded-owner model.
- **FR-026**: `/select-staff`, the PIN keypad, the studio
  topbar's "Switch staff" / "Sign out" controls, and the
  middleware redirect contract are explicitly **out of scope**.
  This feature touches only `/login`, the new `/reset-password`
  page, and their supporting components / styles.

#### Visual & content

- **FR-027**: All visual values on the new `/login` and
  `/reset-password` MUST trace to Lacquer design tokens
  (`styles/tokens.css`). No raw hex codes, off-scale spacing,
  custom font weights, or one-off shadows are permitted. The
  `speckit-design-auditor` MUST pass with zero violations.
- **FR-028**: System MUST adapt the prototype at
  `design-system/prototypes/auth/Login Screen.html` as the visual
  source of truth. No new component library is introduced;
  layout primitives (panels, buttons, inputs, alerts, dividers)
  are composed from `components/ui/*` shadcn primitives and
  Lacquer-scoped components in `components/lacquer/*`.
- **FR-029**: All copy on the new views MUST be the prototype's
  copy verbatim where Lacquer content fundamentals apply (calm,
  specific, second-person, sentence case). The `/reset-password`
  page MUST follow the same content rules; suggested copy: page
  heading "Set a new password", subtitle "Pick something you'll
  remember — 8 characters or more.", primary button "Set new
  password", success state inherits the `/select-staff` shell
  on redirect. Error copy from `003-login-flow` is preserved
  unchanged.

### Key Entities *(include if feature involves data)*

No new data entities are introduced. The feature reuses:

- **Supabase Auth identity** (email/password, Google OAuth,
  magic-link OTP) — unchanged from `003-login-flow`.
- **`?next=` redirect target** — unchanged sanitiser
  (`sanitizeNext` from `lib/auth/next-url`).
- **`?magic_sent=<email>` query state** — unchanged URL contract
  between the magic-link Server Action and the page; the new
  `magic` / `magic-sent` views read it on first paint to seed
  the initial view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of computed style values on `/login`
  (background, foreground, border, ring, primary, muted,
  card, all font sizes, all spacings, all radii, all
  shadows) resolve to a `var(--*)` token from
  `styles/tokens.css`. Zero raw hex codes, zero off-scale
  spacing, zero custom font weights appear in the
  inspector. `speckit-design-auditor` passes with zero
  violations.
- **SC-002**: At viewports ≥ 720px wide, the rendered
  layout matches the prototype within ± 4px on every named
  element (panel widths, form well width, headline size,
  field height, button height, decorative SVG sizing and
  positioning, vertical rhythm).
- **SC-003**: At viewports < 720px, the brand panel is
  hidden, the form panel fills the full width, and the
  solo wordmark appears above the form in 100% of test
  renders across the breakpoint band (320px, 480px, 719px).
- **SC-004**: The password reveal toggle correctly flips
  the input type between `password` and `text` in 100% of
  toggle invocations, restores to `password` on any view
  swap, and is fully operable by keyboard (Tab + Enter).
- **SC-005**: All existing E2E tests for `/login` in
  `tests/e2e/login.spec.ts` continue to pass against the
  redesigned page, with only selector-only updates if any.
  No behavioural assertion changes are required.
- **SC-006**: Every pre-redirect, error, and Google-flag
  scenario from `003-login-flow` US1, US4, and the edge
  cases continues to behave identically. A targeted
  regression sweep (signed-in visit → forward redirect;
  wrong password → calm alert; Google flag off →
  Google + divider hidden) shows 100% parity with
  pre-change behaviour.
- **SC-007**: Users with `prefers-reduced-motion: reduce`
  see view swaps complete within 16ms (one frame) with no
  fade or translate. Verified by running an automated
  Playwright check with `emulateMedia({ reducedMotion:
  'reduce' })`.
- **SC-008**: The full local gate set
  (`format:check`, `lint`, `typecheck`, `test`, `test:e2e`)
  is green on the redesign branch before any push. CI
  reproduces the same green pass on the PR.
- **SC-009**: An owner who has forgotten their password can
  request a reset, open the emailed link, set a new password,
  and reach `/select-staff` in **under 60 seconds** of wall-clock
  time (excluding email-delivery latency). 100% of successful
  resets write a `device.password_reset` row to `audit_log`.
- **SC-010**: A Google sign-in by an owner whose email already
  has a confirmed email/password user produces **a single
  Supabase user row** with two entries in `user.identities`
  (`email` + `google`). Verified by running the flow against a
  preview Supabase project and inspecting `auth.users` +
  `auth.identities` directly.

## Assumptions

- The Lacquer design handoff fetched on 2026-05-16 from
  `https://api.anthropic.com/v1/design/h/0Y0sT4aT7el9l_9KsXD6Eg`
  is the canonical source for this redesign. Its `Login Screen.html`
  has been vendored at
  `design-system/prototypes/auth/Login Screen.html`; future updates
  re-export and replace that file (matching the existing
  `design-system/` vendoring pattern in `CLAUDE.md`).
- The prototype's tweaks panel (`tweaks-panel.jsx`) is a
  design-canvas artefact (dark-mode toggle, force-error toggle,
  view picker) and is not part of the implementation surface.
- The breakpoint at which the brand panel hides matches the
  prototype's 720px. No additional breakpoint is introduced.
- Dark mode is honoured at the OS level only via
  `prefers-color-scheme: dark`. No manual toggle is added; a
  future Settings → Appearance feature may add one.
- The existing `LoginForm`, `GoogleSignInButton`, and
  `MagicLinkControl` components in `components/lacquer/` are
  refactored (not re-built) to fit the new layout. The
  existing Server Actions and the `next-url` sanitiser they
  call are unchanged; a new `sendPasswordReset` action and a
  new `/reset-password` Server Action are added alongside.
- The `?magic_sent=<email>` URL contract from `003-login-flow` is
  preserved. Three new query params are introduced for view
  seeding only: `?magic_intent=1`, `?reset_sent=<email>`,
  `?reset_intent=1`. None of them changes authentication
  semantics — they only select which view paints first.
- The redesigned page continues to render without JavaScript: the
  sign-in form posts to its existing Server Action, the
  "Continue with Google" button is a regular form submit, the
  magic-link link is a regular anchor to `/login?magic_intent=1`,
  and the "Forgot password?" link is a regular anchor to
  `/login?reset_intent=1`. The eye toggle and view-swap
  animation degrade to no-ops without JS.
- The `styles/auth.css` rules introduced by `003-login-flow` are
  extended and partly superseded — specifically, the centred
  `.auth-shell` + `.auth-card` block becomes a two-panel shell,
  and the `.auth-magic-link-details` / `.auth-magic-link-form`
  rules are removed in favour of the view-swap pattern. The
  keypad-related rules (`.auth-keypad*`, `.auth-staff-tile`,
  `.auth-roster`) belong to `/select-staff` and are left
  untouched.
- **Supabase configuration**: One Supabase Auth setting must be
  confirmed at deploy time — the **Site URL** and the
  `redirectTo` allowlist must include `<origin>/reset-password`
  so the reset email's deep link is accepted. The Google OAuth
  provider must be enabled in Supabase Dashboard → Auth →
  Providers (Google client ID + secret pasted from Google
  Cloud Console). Both are operator actions, not code changes.
- **Free tier confirmed**: Google OAuth, magic-link OTP, and
  `resetPasswordForEmail` are all included in the Supabase free
  tier. The 50,000 MAU allowance vastly exceeds the single-salon
  workload. The only relevant gotcha is the 7-day inactivity
  project pause; the dual-project setup
  (`project_supabase_dual_project` memory) already keeps preview
  + prod warm via CI-driven migration runs.
- **Account linking**: Supabase's default automatic identity
  linking by verified email is **left ON**. The seeded owner row
  (in `supabase/seed.sql` for dev, and the production bootstrap
  SQL) MUST set `email_confirmed_at` so Google sign-in by the
  same email merges into the existing user record instead of
  creating a second one. No call to `linkIdentity()` is needed
  for this case; it remains available for future cross-email
  linking but is out of scope for this feature.
- **No new env vars** are introduced. The build-time
  `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` flag is unchanged. The new
  `/reset-password` page derives its origin from
  `request.url` and does not need a separate env var.
- **No new DB migrations** are required for the reset flow.
  `device.password_reset` is added to the controlled-vocabulary
  union in `lib/auth/audit.ts` and inserted via the same
  `audit_log` table introduced by `003-login-flow`. The seed-file
  amendment (`email_confirmed_at`) is a one-line `UPDATE` in
  `supabase/seed.sql`.
