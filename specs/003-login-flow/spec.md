# Feature Specification: Login Flow (Device Sign-In + Staff PIN)

**Feature Branch**: `003-login-flow`

**Created**: 2026-05-14

**Status**: Draft

**Input**: User description: "I want to start setting up the authentication as per our system design doc. Design and build a login flow for our application."

## Overview

This feature builds the **two-layer login gate** that fronts the entire Tang Nails studio app: a long-lived **device sign-in** (Supabase Auth — email/password or Google) plus a short-lived **staff PIN selection** (the *operator* at the device). It implements the auth model defined in `docs/system-design.md` § "Auth: device login + acting-as PIN" and replaces the placeholder `requireStudioSession()` stub introduced by the dashboard feature (specs/002-dashboard-page).

The two layers are intentionally separate. The **device user** is a Supabase identity bound to a browser/iPad; it is long-lived and only changes on explicit sign-out. The **operator** is the staff member physically at the device right now; it is established by tapping a name and entering a PIN, persisted as a signed httpOnly cookie with a hard 12-hour TTL (no sliding extension), and easily switched at shift change. Together they answer two distinct questions on every write: *what device did this come from?* and *who pressed the button?* — both are recorded in `audit_log`.

This feature ships only the login gate. **Kiosk pairing** (the separate JWT-based path at `/kiosk/[token]`) and the **manager-PIN inline override** used to authorize refunds, voids, and settings edits are explicit out-of-scope deferrals — they share helpers from `lib/auth/*` but are not part of the login flow itself.

## Clarifications

### Session 2026-05-15

- Q: When Supabase Auth or the database is briefly unreachable mid-shift for an already-pinned-in operator, what is the failure mode? → A: Soft-degrade — render the existing "Reconnecting…" banner; refuse mutations (Server Actions short-circuit with a retryable error toast); reads using the cached RSC payload remain visible.
- Q: After a wrong PIN, should the keypad add a cosmetic cooldown? → A: None — rely solely on bcrypt's intrinsic latency (~100–300 ms per attempt). No UI delay, no escalating throttle.
- Q: What is the password complexity floor for owner/manager Supabase accounts? → A: NIST 800-63B style — 8+ characters, no character-class rules, allow passphrases and spaces.
- Q: Should Supabase magic-link / OTP-email sign-in be allowed? → A: Allowed as a fallback — leave Supabase's magic-link enabled so an owner who forgets their password can still get in via email. (Replaces an explicit password-reset link on `/login`.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner signs in with email and password (Priority: P1)

The salon owner opens the studio app on a counter laptop, signs in with their email and password, and proceeds to the staff selector. Without this path, no one can reach the app at all — it is the first half of the gate.

**Why this priority**: Email/password is the baseline mechanism every owner/manager has; Google OAuth is an enhancement layered on top. If only this works, an owner can fully bootstrap the salon.

**Independent Test**: Navigate to any studio URL while signed-out. Confirm a redirect to `/login`. Enter a valid email + password registered in Supabase. Confirm a redirect to `/select-staff`. Enter an invalid password. Confirm a calm error message appears and the page does not reveal whether the email exists.

**Acceptance Scenarios**:

1. **Given** a signed-out browser, **When** the user requests any `(studio)` route, **Then** the app redirects to `/login` and preserves the originally requested URL as a return-to target.
2. **Given** the user is on `/login` with valid credentials, **When** they submit the form, **Then** Supabase establishes a long-lived auth session and the app redirects to `/select-staff` (or to the original return-to URL once the operator is also resolved).
3. **Given** the user is on `/login` with an incorrect password, **When** they submit, **Then** a single calm error message appears ("Email or password is incorrect.") with no indication of whether the email exists in the system.
4. **Given** an already-signed-in device user navigates to `/login`, **When** the page loads, **Then** the app skips the form and redirects forward to `/select-staff` (or directly into the studio if an operator cookie is also valid).

---

### User Story 2 - Staff selects their identity with a PIN (Priority: P1)

After the device is signed in, every shift starts with a staff member tapping their name on the roster and entering their 4-digit PIN. The PIN selection is what makes the *operator* known so that every write the studio app does is correctly attributed.

**Why this priority**: The studio app refuses to load without a resolved operator — even with a device session, no staff identity means no Server Action can run. Without this story the gate is half-built and the studio is unreachable.

**Independent Test**: From a signed-in but operator-less state, request a studio URL. Confirm a redirect to `/select-staff` showing a roster of active, PIN-equipped staff as tiles (avatar/initial, display name, role chip). Tap a tile, enter the staff member's PIN. Confirm the studio app shell renders with the operator's name in the topbar. Tap the same tile and enter a wrong PIN. Confirm a calm error appears, the tile does not lock, and a row is added to `audit_log` for the failed attempt.

**Acceptance Scenarios**:

1. **Given** the user has a valid Supabase session but no operator cookie, **When** they request a studio route, **Then** the app redirects to `/select-staff` and the roster shows every staff row where `active = true` and `pin_hash IS NOT NULL`.
2. **Given** the roster is visible, **When** the user taps a staff tile, **Then** a numeric keypad appears prompting for the staff member's PIN.
3. **Given** the keypad is showing the correct staff, **When** the user enters the correct 4-digit PIN, **Then** the app sets a signed httpOnly `acting_as_staff_id` cookie with a 12-hour `Max-Age`, writes a `staff.signed_in` row to `audit_log`, and redirects to the originally requested URL (defaulting to `/dashboard`).
4. **Given** the keypad is showing, **When** the user enters an incorrect PIN, **Then** the app surfaces a calm inline error ("PIN didn't match. Try again."), records a `staff.pin_failed` row to `audit_log` (device user + targeted `staff_id` + timestamp), clears the keypad, and the staff tile remains tappable (no lockout in v1).
5. **Given** the device user has no linked staff record AND the salon has at least one PIN-only staff configured, **When** they reach `/select-staff`, **Then** they still see the full roster — staff entries do not require a `user_id` to be selectable, only an active `pin_hash`.

---

### User Story 3 - Switch staff at shift change (Priority: P2)

When a technician finishes their shift and another tech takes over the front desk, the outgoing operator taps "Switch staff" in the studio app shell. The cookie is cleared, the screen returns to `/select-staff`, and the new operator pins in. The device session itself does not need to be re-entered — only the operator changes.

**Why this priority**: A salon counter is a shared device. Without a quick switch path, staff would either share an identity (poisoning the audit log) or sign the device out and back in for every handoff. Useful but not blocking — the app could ship without it as long as the cookie's 12h TTL is short enough.

**Independent Test**: Sign in and pin in as Staff A. Tap "Switch staff" in the topbar. Confirm a redirect to `/select-staff`, the device session still intact (no `/login` redirect). Pin in as Staff B. Confirm the studio shell now shows Staff B's name and role chip in the topbar.

**Acceptance Scenarios**:

1. **Given** the operator is at any studio route, **When** they activate the "Switch staff" control in the shell, **Then** the app clears only the `acting_as_staff_id` cookie (Supabase session untouched), writes a `staff.switched` row to `audit_log`, and redirects to `/select-staff`.
2. **Given** the new operator pins in, **When** the studio shell renders, **Then** the topbar reflects the new operator's `display_name`, `role`, and `color_token` within one render.

---

### User Story 4 - Sign in with Google (Priority: P2)

The owner has the option to use "Continue with Google" on `/login` instead of email/password. Same long-lived device session, same downstream `/select-staff` step.

**Why this priority**: Convenience for owners who already use Google for everything else; not blocking because email/password covers the same need. Listed as a P2 so the page surface is built but the OAuth provider can ship behind a feature flag if Google credentials aren't configured at first.

**Independent Test**: From `/login`, click "Continue with Google" and complete the standard Google OAuth flow in a sandbox/dev account. Confirm the redirect lands on `/select-staff`. With the Google provider disabled in Supabase config, confirm the button either hides or surfaces a calm "Google sign-in isn't available right now" message rather than throwing.

**Acceptance Scenarios**:

1. **Given** Google OAuth is configured for the Supabase project, **When** the user clicks "Continue with Google" on `/login`, **Then** they are redirected through Supabase's OAuth handoff and on success land on `/select-staff` with a valid device session.
2. **Given** Google OAuth is not configured, **When** `/login` renders, **Then** the Google button is either hidden or disabled with a brief inline note — the email/password form remains fully usable.

---

### User Story 5 - Operator session expiry (Priority: P2)

Twelve hours after a staff member pinned in, the cookie expires (no sliding extension). The next Server Action sees no operator and the user is calmly returned to `/select-staff` to pin in again — the device session is unaffected.

**Why this priority**: Keeps the salon honest about who's at the device when shifts span shop hours. Important for the audit guarantee, but degrades gracefully (the worst case is a cookie that lasts longer than ideal, which a P1 wouldn't catch).

**Independent Test**: Pin in, then either advance system time 12+ hours or set the cookie's `Max-Age` to a short value in dev. Take an action that triggers a Server Action. Confirm the response redirects to `/select-staff` and the form preserves the in-flight URL as the return-to target.

**Acceptance Scenarios**:

1. **Given** the `acting_as_staff_id` cookie has expired or is missing, **When** any Server Action runs in the studio, **Then** the action short-circuits and the response redirects the user to `/select-staff` with the originating URL as the return-to target.
2. **Given** the cookie is being issued, **When** it is set, **Then** the cookie has `HttpOnly`, `Secure`, `SameSite=Lax`, a signed value, and a hard `Max-Age` of 43,200 seconds — the value is **not** refreshed on subsequent activity.

---

### User Story 6 - Sign out the device (Priority: P3)

Less common but necessary: an owner needs to sign the device out entirely (e.g., before lending the laptop). "Sign out" ends the Supabase session, clears the operator cookie, and returns to `/login`.

**Why this priority**: Rare in the daily flow (most handoffs are "Switch staff", not full sign-out) but needed for completeness and security hygiene.

**Independent Test**: From the studio shell, activate "Sign out". Confirm the Supabase session is destroyed (a hard reload still lands on `/login`) and the `acting_as_staff_id` cookie is cleared.

**Acceptance Scenarios**:

1. **Given** the user is signed in and pinned in, **When** they activate the "Sign out" control in the shell menu, **Then** the app calls Supabase's sign-out, clears the `acting_as_staff_id` cookie, writes a `staff.signed_out` row to `audit_log`, and redirects to `/login`.

---

### Edge Cases

- **Authenticated user with no linked staff and no PIN-only staff configured.** `/select-staff` shows a calm empty state ("No staff configured. Ask the salon owner to add staff in Settings.") and offers a "Sign out" link rather than a dead end.
- **Authenticated user navigates to `/login`.** Skip the form; redirect forward to `/select-staff` (or straight into the studio if an operator cookie is also valid). Avoid the confusing flash of a sign-in screen.
- **Authenticated user with a valid operator cookie navigates to `/select-staff`.** Allow it (this is the same surface "Switch staff" lands on). The roster is visible and a fresh PIN entry replaces the existing operator after a successful entry.
- **Multiple browser tabs.** Cookies are shared, so signing in or switching staff in one tab is visible to the others on next request. No mid-session conflict resolution is required in v1.
- **Refresh during PIN entry.** The keypad is a transient UI state; on refresh the user returns to the roster view and re-taps their tile. No partial PIN state is persisted.
- **Server Action fired while operator cookie is present but the staff row was deactivated.** Server Action treats the operator as invalid, redirects to `/select-staff`, and the deactivated tile no longer appears.
- **Hash check timing.** PIN comparison uses bcrypt's constant-time compare. A wrong PIN takes the same observable time as a right PIN to defeat side-channel guesses.
- **Kiosk routes.** Requests to `/kiosk/[token]` MUST bypass this gate entirely — the kiosk pairing JWT is a different auth path and is not affected by either the device session or the operator cookie.
- **Manager-PIN inline override.** Refunds, voids, and settings edits prompt for a fresh manager PIN at the moment of submission. That dialog reuses bcrypt PIN-checking helpers from this feature but is **not** part of the login flow — it is invoked mid-action and does not change the operator cookie.
- **Network failure mid sign-in.** If Supabase Auth times out or Google OAuth fails, surface a single calm message ("Couldn't sign you in. Check your connection and try again.") and leave the form ready to retry.
- **Supabase unreachable mid-shift (already pinned in).** The studio shell renders the existing "Reconnecting…" banner (Lacquer `notice` token, per the dashboard feature's app-shell pattern). Server Actions short-circuit with a retryable error toast — no mutation is allowed against a stale connection. Reads served from the cached RSC payload remain visible so the operator keeps context until Supabase returns. The operator cookie is **not** invalidated; once the connection recovers, the next request resumes normally.
- **PIN provisioning before Settings exists.** Until Settings → Staff is built, PINs are seeded via `supabase/seed.sql` (bcrypt-hashed) for development and via direct SQL/Studio for production bootstrap. No temporary admin UI is introduced.

## Requirements *(mandatory)*

### Functional Requirements

#### Routes & redirects

- **FR-001**: System MUST expose a public `/login` route that authenticates a device user against Supabase Auth via three supported methods: (a) an email + password form, (b) a "Continue with Google" OAuth button (when Google is configured for the Supabase project), and (c) a "Email me a sign-in link" magic-link fallback for owners who have forgotten their password. The magic-link control MUST be visually subordinate to the password form (smaller text-link styling, not a primary button) so it remains a recovery path rather than the headline option.
- **FR-002**: System MUST expose a `/select-staff` route, behind device-auth, that lists every staff record where `active = true` and `pin_hash IS NOT NULL` as a roster of tappable tiles.
- **FR-003**: System MUST install Next.js middleware that intercepts every request to a `(studio)` route and: (a) redirects to `/login` when the request has no Supabase session, (b) redirects to `/select-staff` when the session exists but the `acting_as_staff_id` cookie is missing or expired, and (c) preserves the originally requested URL as a `?next=` parameter so the user lands on the intended page after the gate clears.
- **FR-004**: System MUST exempt `/kiosk/[token]`, `/login`, `/select-staff`, the Supabase auth callback route, and `/api/webhooks/*` from the studio middleware redirects.
- **FR-005**: System MUST short-circuit `/login` for already-authenticated device users by redirecting forward to `/select-staff` (or straight into the studio if a valid operator cookie is also present).

#### Staff PIN selection

- **FR-006**: When a staff tile is selected, system MUST present a numeric keypad (0–9, clear, submit) and accept a 4-digit PIN.
- **FR-007**: System MUST validate the entered PIN by comparing it to the staff member's `pin_hash` using bcrypt's constant-time comparison.
- **FR-008**: On a correct PIN, system MUST set a cookie named `acting_as_staff_id` containing the signed `staff.id`. The cookie MUST be `HttpOnly`, `Secure`, `SameSite=Lax`, signed with the server cookie secret, and carry a hard `Max-Age` of 43,200 seconds (12 hours) with **no** sliding extension.
- **FR-009**: On a correct PIN, system MUST redirect the user to the `?next=` URL supplied by middleware, defaulting to `/dashboard` when absent or when `next` points outside the `(studio)` route group.
- **FR-010**: On an incorrect PIN, system MUST surface a calm inline error, clear the keypad, leave the staff tile tappable (no lockout), and write a `staff.pin_failed` event to `audit_log` containing the device user id, the targeted `staff_id`, and the timestamp.
- **FR-011**: System MUST NOT lock or rate-limit staff tiles in v1. Repeated PIN failures continue to be logged but never deny further attempts (rationale: device-login is the security boundary; PIN is identity selection — see system design § Risks). System MUST NOT introduce any UI cooldown, escalating delay, or submit-disable after a wrong PIN — the only attempt-cost is bcrypt's intrinsic verify latency (~100–300 ms at cost 10–12).

#### Switch staff & sign out

- **FR-012**: System MUST present a "Switch staff" control in the studio app shell that, on activation, clears only the `acting_as_staff_id` cookie, writes a `staff.switched` row to `audit_log`, and redirects to `/select-staff`. The Supabase device session MUST remain intact.
- **FR-013**: System MUST present a "Sign out" control in the studio app shell that, on activation, ends the Supabase session, clears the `acting_as_staff_id` cookie, writes a `staff.signed_out` row to `audit_log`, and redirects to `/login`.

#### Session resolution helper

- **FR-014**: System MUST provide a server-side helper `requireStudioSession()` (in `lib/auth/*`) that, when called from a Server Component or Server Action, resolves the current device user and the operator from the `acting_as_staff_id` cookie, and returns a typed object containing at minimum: `{ deviceUserId, staff: { id, display_name, role, color_token } }`. When either layer is unresolved, the helper MUST throw a typed redirect that middleware/Server-Action plumbing translates into the appropriate `/login` or `/select-staff` redirect (preserving the originating URL).
- **FR-015**: System MUST replace the dashboard feature's stub `requireStudioSession()` (specs/002-dashboard-page) with the real implementation from FR-014 in the same change set, without altering the helper's call signature.
- **FR-015a**: When Supabase Auth or the database is unreachable, `requireStudioSession()` and Server Actions MUST soft-degrade rather than fail-closed: the studio shell continues to render the existing "Reconnecting…" banner, Server Actions short-circuit with a retryable error toast (no mutation against a stale connection), and reads served from the cached RSC payload remain visible. The `acting_as_staff_id` cookie MUST NOT be cleared by transient outages; the next successful request resumes normally.

#### Audit log

- **FR-016**: System MUST write an `audit_log` row for each of the following events using the listed controlled-vocabulary `action` values: `device.signed_in`, `device.signed_out`, `staff.signed_in`, `staff.pin_failed`, `staff.switched`. Each row MUST include the device user id (when known), the targeted/active `staff_id` (when known), the timestamp, and a small `payload` jsonb for any event-specific context (e.g., the targeted `staff_id` for a failed PIN, the previous operator on a switch).

#### Visual & content

- **FR-017**: All visual values on `/login` and `/select-staff` MUST trace to Lacquer design tokens (`styles/tokens.css`). No raw hex codes, off-scale spacing, or custom font weights are permitted. Icons are Lucide only at 1.5px stroke (sized 16/20/24); no emoji in chrome.
- **FR-018**: System MUST adapt existing Lacquer prototypes for `/login` and `/select-staff` if a matching prototype exists in `design-system/`. Where no prototype exists, system MUST compose the surface from `components/ui/*` shadcn primitives following Lacquer conventions (cards, inputs, buttons, focus rings) — no second component library may be introduced.
- **FR-019**: All copy MUST follow Lacquer content fundamentals (calm, specific, second-person, sentence case, numerals always). Sign-in errors MUST NOT reveal whether an email exists in the system.

#### Out of scope (explicit)

- **FR-020**: The kiosk pairing flow (`/kiosk/[token]`) and the long-lived kiosk JWT path are explicitly **out of scope** for this feature; the studio middleware MUST exempt `/kiosk/*` so kiosk auth can be built later without coupling.
- **FR-021**: The manager-PIN inline override (used to authorize refunds, voids, settings edits) is explicitly **out of scope** for this feature. The override MAY share bcrypt PIN-checking helpers from `lib/auth/*`, but its UI/Server-Action plumbing belongs to the features that invoke it.
- **FR-022**: ~~A traditional password-reset email flow~~, email verification on first sign-in, MFA, and self-service account creation are explicitly **out of scope** for v1. ~~The magic-link fallback (FR-001(c)) is the supported recovery path when an owner forgets their password~~ — they receive a one-time sign-in link by email and, once in, can update their password from the Supabase Auth dashboard or any password manager. Staff PINs are seeded via `supabase/seed.sql` for development and via SQL/Studio for production bootstrap until Settings → Staff is built. **Superseded (password-reset portion only) by `010-login-redesign` FR-014 through FR-018 (Clarifications session 2026-05-16)**: a real password-reset email flow IS now in scope. Supabase `resetPasswordForEmail` triggers from a "Reset password" view on `/login`; the emailed link lands on a new `/reset-password` page that exchanges the PKCE code and calls `updateUser({ password })`. Magic-link recovery (FR-001(c)) is retained as a second on-ramp. Email verification on first sign-in, MFA, and self-service account creation remain out of scope.
- **FR-023**: System MUST configure the Supabase Auth password policy to require a minimum of **8 characters** with **no character-class rules** (no required mixed case, digits, or symbols). Passphrases and spaces MUST be permitted. Rationale: NIST 800-63B guidance — length beats composition rules, and strict character-class requirements push users toward predictable patterns. The 8-character floor sits above Supabase's default of 6 and is the only knob protecting the device-login layer in the absence of MFA.

### Key Entities *(include if feature involves data)*

- **Device user** — A Supabase Auth identity (email/password or Google OAuth) bound to a browser/iPad. Long-lived (Supabase managed), one per device session, identified by `auth.uid()`.
- **Operator (acting-as staff)** — The staff member physically at the device right now. Resolved by tapping a staff tile and entering the matching PIN. Persisted in a signed httpOnly cookie `acting_as_staff_id` with a hard 12-hour TTL.
- **Staff PIN** — A short numeric secret (4 digits in v1) stored as `staff.pin_hash` (bcrypt). Compared with constant-time bcrypt verify; never logged in plaintext.
- **Login session record** — An `audit_log` row with one of `device.signed_in`, `device.signed_out`, `staff.signed_in`, `staff.pin_failed`, `staff.switched`, capturing the device user, the targeted/active staff id, and the timestamp.
- **Studio session resolution** — The composite `{ deviceUserId, staff }` returned by `requireStudioSession()`; the canonical input every studio Server Component and Server Action uses to know who is acting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A staff member with valid credentials can complete the full sign-in path (email + password + tap tile + 4-digit PIN) and land on the studio dashboard in **under 15 seconds** on a counter-class laptop with a typical broadband connection.
- **SC-002**: 100% of unauthenticated requests to `(studio)` routes are intercepted by middleware and redirected through the correct gate (`/login` for missing device session, `/select-staff` for missing operator), with the originally requested URL preserved as `?next=` and used after the gate clears.
- **SC-003**: The `acting_as_staff_id` cookie expires exactly 12 hours after issuance with no sliding extension. After expiry, the next Server Action redirects the user to `/select-staff` in 100% of cases.
- **SC-004**: 100% of failed PIN attempts are recorded in `audit_log` with the device user, the targeted `staff_id`, and the timestamp; no failure path silently drops the event. No staff tile is ever automatically locked or hidden as a result of failed attempts in v1.
- **SC-005**: After "Switch staff", the studio shell reflects the new operator's `display_name`, `role`, and `color_token` within **one render** of the next page load — no transitional state shows the previous operator.
- **SC-006**: Every write performed by any studio Server Action carries both `auth.uid()` (device user) and `acting_as_staff_id` (operator) in `audit_log`; a sample audit of 20 mutations from the Calendar, Walk-in, and Checkout flows shows 100% coverage.
- **SC-007**: 100% of visual values on `/login` and `/select-staff` trace to Lacquer design tokens; the design audit run by `speckit-design-auditor` passes with zero violations.
- **SC-008**: The dashboard feature's stub `requireStudioSession()` is fully replaced and no remaining caller of that helper depends on a hard-coded demo viewer.

## Assumptions

- Supabase Auth is the only identity provider for the device layer. Email/password is enabled in v1; Google OAuth is enabled when the salon owner has supplied OAuth credentials in the Supabase dashboard; magic-link / OTP-email is enabled as a recovery fallback (per the Q4 clarification). No additional OAuth providers (GitHub, Apple, etc.) are introduced in v1.
- PIN length is **4 digits** for v1, matching the iPad-style staff selector pattern referenced in the system design. The schema column `staff.pin_hash` is a bcrypt hash and stays length-agnostic so a future bump to 6 digits requires no migration.
- bcrypt cost factor follows the salon-realistic default (10–12 rounds) — high enough to defeat brute force at human PIN entry rates, low enough that a tile tap + PIN keystroke loop feels instantaneous on a counter-class device.
- The `acting_as_staff_id` cookie is signed with a server-only secret (already part of the Next.js environment) and carries the `staff.id`. No PII (name, role) is encoded in the cookie value — those are looked up server-side in `requireStudioSession()` from a fresh DB read so deactivation takes effect on the next request.
- Middleware lives in `middleware.ts` at the repo root and runs on the Edge runtime. It uses `@supabase/ssr` to read the Supabase session cookies. It does **not** open a database connection — operator-cookie validity is checked only for presence/signature/expiry; the staff row is verified later, in `requireStudioSession()` on the Node runtime.
- The `staff` and `audit_log` tables are introduced by this feature in `supabase/migrations/0001_auth_schema.sql` (see plan.md Complexity Tracking row 1 and research R4). The shapes match `docs/system-design.md` § Data model — this is the first feature to materialize them in Postgres, on the principle of "schema lands with the feature that needs it" rather than a speculative full-schema migration. Controlled-vocabulary `action` values are exported as a typed union from `lib/auth/audit.ts` and extended by future features as they introduce their own write paths.
- Staff seed data with known bcrypt PINs is added to `supabase/seed.sql` for local development. Production bootstrap (the very first owner creating the first staff records) is a one-time SQL operation in the Supabase dashboard until Settings → Staff is built. No temporary admin UI is introduced as part of this feature.
- The studio app shell built by the dashboard feature already has a topbar with affordance for an operator avatar/name and a menu trigger. This feature adds the "Switch staff" and "Sign out" actions to that menu; it does not redesign the shell.
- Visual references: the design system handoff currently includes Lacquer-styled login/keypad surfaces in the `(auth)` directory mapping (per `docs/system-design.md` § Repo layout). If a matching prototype exists in `design-system/ui_kits/` or `design-system/prototypes/`, it is adapted; otherwise the surface is composed from `components/ui/*` shadcn primitives using only Lacquer tokens. The planning phase (`/speckit-plan`) confirms which prototypes exist and updates the file mapping accordingly.
- This feature builds the auth gate and the session-resolution helper; it does **not** wire role-based authorization for individual Server Actions (e.g., "only owners can edit settings"). Each Server Action remains responsible for checking `staff.role` after calling `requireStudioSession()`. The gate ensures a known operator exists; the action enforces what that operator may do.
- Kiosk pairing (`/kiosk/[token]` + `kiosk_sessions`) and manager-PIN inline overrides are scheduled as their own features in the build order (per `docs/system-design.md`). They share `lib/auth/*` PIN helpers introduced here but are not built in this feature.
- The Sign-out control terminates the Supabase session for the current browser only. Other devices that share the same Supabase user remain signed in independently.
