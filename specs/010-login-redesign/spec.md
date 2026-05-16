# Feature Specification: Login UI/UX Redesign (Brand-Panel Shell)

**Feature Branch**: `010-login-redesign`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Update the current login UI/UX. Fetch the
Lacquer design handoff (Login Screen.html), read its README, and implement
the relevant aspects of the design. Make a copy of the prototype and store
it in our design system / prototypes folder."

## Overview

This feature re-skins the existing login surface (`/login` from
`003-login-flow`) to match the new Lacquer prototype shipped in the design
handoff (`design-system/prototypes/auth/Login Screen.html`). The behavioural
contract from `003-login-flow` is unchanged — every functional requirement
in that spec (FR-001 through FR-023) still holds. What changes is the
visual presentation: a **two-panel layout** with a Lacquer-branded left
panel and a focused form panel on the right, a **view-based flow** that
swaps the form pane between sign-in, magic-link request, and magic-link
confirmation (replacing the inline `<details>` expand pattern), a
**password reveal toggle**, and **dark-mode honouring** at the shell
level. The Google button, magic-link recovery, error alerts, redirect
semantics, audit-log events, and the pre-redirect logic at `/login` all
remain identical.

The new prototype also includes a separate "Reset password" / "Check your
email" flow that would send a password-reset link. That flow is **not**
adopted because `003-login-flow` FR-022 explicitly keeps the traditional
password-reset email path out of scope; the magic-link variant is the
supported recovery (FR-001(c) of `003-login-flow`). The prototype's
"Forgot password?" link is therefore re-bound to the magic-link request
view in this implementation. The prototype's tweaks panel
(`tweaks-panel.jsx`) is a design-canvas artefact and is not implemented.

This is a **visual / UX redesign**, not a behavioural change. No new
Supabase configuration, migrations, or environment variables are
introduced. Existing E2E flows and unit tests continue to pass — only
selectors/DOM structure may shift to accommodate the new layout, and any
visual snapshot expectations are refreshed against the new prototype.

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

### User Story 3 - Request a magic sign-in link from a dedicated view (Priority: P1)

When an owner forgets their password, the existing "Email me a sign-in
link instead" subordinate link now leads to a dedicated view — not an
inline-expanding `<details>`. The form panel swaps with a 200ms fade-in
to a focused "Sign in with a link" surface that shows a back button, a
single email field, and a "Send link" primary button. On submit, the
same surface swaps to a "Check your email" confirmation card. The
underlying Supabase magic-link request (`signInWithOtp`) and the
`?magic_sent=` URL contract are unchanged.

**Why this priority**: The magic-link recovery path is the only password
recovery in v1 (per `003-login-flow` FR-022). The redesign elevates it
from a small text link into a full view, which makes it more discoverable
and easier to use on an iPad. Same priority as the sign-in view because
the redesign isn't complete without it.

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
   transitions (200ms fade + 8px translate-up, per the
   `viewIn` keyframe in the prototype) to the "Sign in with a link"
   view.
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
   back to the sign-in view and the URL drops the `magic_sent` query
   parameter if present.

---

### User Story 4 - "Forgot password?" routes to the magic-link view (Priority: P2)

When the owner sees the password field, a small "Forgot password?" link
sits inline with the field's label. Clicking it opens the same magic-link
request view from Story 3 (not a separate password-reset email flow). The
copy on that view stays "Sign in with a link" so the owner understands
they're getting a one-time sign-in link, not a reset link.

**Why this priority**: Improves discoverability of recovery for owners
who are blocked on a forgotten password. P2 because the same recovery
path is already reachable from the "Email me a sign-in link instead"
link below Google — the inline link is a second on-ramp, not a new
capability.

**Independent Test**: On `/login`, locate the password field. Confirm a
small "Forgot password?" text link sits on the right end of the password
label row (the label "Password" is left-aligned, the link is
right-aligned in the same row). Click it. Confirm the same magic-link
request view from Story 3 appears.

**Acceptance Scenarios**:

1. **Given** the user is on the sign-in view, **When** the password
   field renders, **Then** an inline "Forgot password?" text link
   appears at the right end of the password label row, styled as a
   Lacquer subordinate link (`--muted-foreground`, underlined on
   hover only, 12px text).
2. **Given** the user clicks "Forgot password?", **When** the
   transition fires, **Then** the form panel swaps to the same
   "Sign in with a link" view used by the link below Google
   (identical heading, copy, fields, and submit behaviour).

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
  primary button, Google button, magic-link link) MUST render and be
  submittable without JavaScript — the eye toggle, view swaps, and
  reduced-motion gating may be no-ops, but the password form posts
  to its existing Server Action and the magic-link link navigates to
  a `?magic_sent_intent=1` query state that the page reads server-
  side to render the magic-link view as the initial pane. (This
  preserves the no-JS path that `003-login-flow` already supports.)

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

- **FR-006**: System MUST render the form panel as one of three
  in-page views: `signin` (default), `magic` (request a sign-in
  link), and `magic-sent` (confirmation). The legacy two-view
  `<details>`-based magic-link control from `003-login-flow` MUST
  be removed.
- **FR-007**: System MUST animate each view swap with a 200ms
  fade + 8px translate-up (`viewIn` keyframe, ease-out-expo), and
  MUST omit the animation when `prefers-reduced-motion: reduce` is
  set.
- **FR-008**: System MUST seed the initial view from the URL: the
  page MUST render the `magic-sent` view when `?magic_sent=` is
  present (with the email shown in the confirmation card), and
  the `magic` view when a separate `?magic_intent=1` query is
  present (the JS-no-JS bridge path); otherwise it MUST render
  `signin`.
- **FR-009**: System MUST provide a "Back to sign in" control on
  every non-`signin` view (a chevron-left + text button styled as
  `.back-btn`) that swaps back to `signin` and clears `magic_sent`
  / `magic_intent` from the URL.

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

#### Magic-link recovery

- **FR-014**: System MUST route both the "Forgot password?" inline
  link and the "Email me a sign-in link instead" subordinate link
  to the same `magic` view. The view's heading MUST be "Sign in
  with a link" (not "Reset password") and the subtitle MUST be
  "We'll email you a one-time sign-in link — no password needed."
- **FR-015**: System MUST submit the magic-link request through
  the existing `sendMagicLink` Server Action from
  `app/(auth)/login/actions.ts` (or its successor of identical
  signature). The action contract — including `?next=`
  preservation, the `?magic_sent=<email>` redirect on success,
  and inline error rendering on failure — is unchanged.
- **FR-016**: System MUST render the `magic-sent` confirmation as
  a card styled with the prototype's `.confirm-card` rules
  (`--muted` background, 1px border, 12px radius, 20px padding),
  containing: a heading "Check your email", a subtitle "A sign-in
  link is on its way.", a paragraph naming the email address in
  `<strong>`, and a secondary line "Didn't get it? Check your
  spam folder, or [send another link]." where the send-another
  link rebinds to the `magic` view with the email pre-filled.

#### Out of scope (explicit)

- **FR-017**: A separate password-reset email flow (Supabase
  `resetPasswordForEmail` + a `/reset-password/[token]` route) is
  explicitly **out of scope**. This preserves `003-login-flow`
  FR-022. The prototype's `forgot` / `forgot-sent` views are
  **not** implemented; their inline copy (`"Reset password"`,
  `"Send reset link"`) is replaced by the magic-link copy.
- **FR-018**: The prototype's tweaks panel (`tweaks-panel.jsx`)
  is a design-canvas artefact and is **not** implemented. It is
  kept alongside `Login Screen.html` in `design-system/prototypes/auth/`
  so the prototype HTML still renders untouched in a browser.
- **FR-019**: No user-controlled theme toggle is added on
  `/login`. Dark mode is honoured only via
  `prefers-color-scheme: dark`. A future Settings → Appearance
  feature MAY add a manual toggle; this feature does not.
- **FR-020**: `/select-staff`, the PIN keypad, the studio
  topbar's "Switch staff" / "Sign out" controls, and the
  middleware redirect contract are explicitly **out of scope**.
  This feature touches only the `/login` surface and its
  supporting components / styles.

#### Visual & content

- **FR-021**: All visual values on the new `/login` MUST trace to
  Lacquer design tokens (`styles/tokens.css`). No raw hex codes,
  off-scale spacing, custom font weights, or one-off shadows are
  permitted. The `speckit-design-auditor` MUST pass with zero
  violations.
- **FR-022**: System MUST adapt the prototype at
  `design-system/prototypes/auth/Login Screen.html` as the visual
  source of truth. No new component library is introduced;
  layout primitives (panels, buttons, inputs, alerts, dividers)
  are composed from `components/ui/*` shadcn primitives and
  Lacquer-scoped components in `components/lacquer/*`.
- **FR-023**: All copy on the new views MUST be the prototype's
  copy verbatim where Lacquer content fundamentals apply (calm,
  specific, second-person, sentence case). Error copy from
  `003-login-flow` is preserved unchanged (it already follows
  the same rules).

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

## Assumptions

- The Lacquer design handoff fetched on 2026-05-16 from
  `https://api.anthropic.com/v1/design/h/0Y0sT4aT7el9l_9KsXD6Eg`
  is the canonical source for this redesign. Its `Login Screen.html`
  has been vendored at
  `design-system/prototypes/auth/Login Screen.html`; future updates
  re-export and replace that file (matching the existing
  `design-system/` vendoring pattern in `CLAUDE.md`).
- The prototype's `forgot` / `forgot-sent` views are **not** adopted
  because `003-login-flow` FR-022 keeps a traditional password-reset
  email flow out of v1 scope. Magic-link is the only recovery path,
  so the prototype's "Forgot password?" link is re-bound to the
  magic-link request view and the prototype's "Reset password" copy
  is replaced with the magic-link copy.
- The prototype's tweaks panel (`tweaks-panel.jsx`) is a
  design-canvas artefact (dark-mode toggle, force-error toggle,
  view picker) and is not part of the implementation surface.
- The breakpoint at which the brand panel hides matches the
  prototype's 720px. No additional breakpoint is introduced.
- Dark mode is honoured at the OS level only via
  `prefers-color-scheme: dark`. No manual toggle is added on
  `/login`; a future Settings → Appearance feature may add one.
- The existing `LoginForm`, `GoogleSignInButton`, and
  `MagicLinkControl` components in `components/lacquer/` are
  refactored (not re-built) to fit the new layout. The Server
  Actions and `next-url` sanitiser they call are unchanged.
- The `?magic_sent=<email>` URL contract from `003-login-flow` is
  preserved as the initial-view seed for the `magic-sent` view. A
  new `?magic_intent=1` query (read server-side) seeds the `magic`
  view on first paint for the no-JS path; it has no other effect.
- The redesigned page continues to render without JavaScript: the
  password form posts to its existing Server Action, the
  "Continue with Google" button is a regular form submit, and the
  magic-link link is a regular anchor to `/login?magic_intent=1`.
  The eye toggle and view-swap animation degrade to no-ops without
  JS.
- The `styles/auth.css` rules introduced by `003-login-flow` are
  extended and partly superseded — specifically, the centred
  `.auth-shell` + `.auth-card` block becomes a two-panel shell,
  and the `.auth-magic-link-details` / `.auth-magic-link-form`
  rules are removed in favour of the view-swap pattern. The
  keypad-related rules (`.auth-keypad*`, `.auth-staff-tile`,
  `.auth-roster`) belong to `/select-staff` and are left
  untouched.
- No new environment variables, Supabase config, or migrations
  are introduced. The only build-time signal that changes
  behaviour remains `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`,
  unchanged in semantics.
