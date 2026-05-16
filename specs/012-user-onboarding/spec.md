# Feature Specification: User Onboarding & Offboarding

**Feature Branch**: `012-user-onboarding`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/sgLd4id9ddU2t5y3cnS01A?open_file=prototypes%2Fonboarding%2FUser+Onboarding.html — Implement: prototypes/onboarding/User Onboarding.html. Also import that prototype and relevant aspects of the design of our design-system prototypes folder as well."

## Clarifications

### Session 2026-05-16

- Q: What should the "Reset PIN" row action (Active section) do? → A: Open an admin PIN-set sheet — owner enters a new 4-digit PIN inline, the user is informed on their next sign-in. (Owner accepts that they now know the user's PIN.)
- Q: What should the "Send password reset" row action (Active section) do? → A: Reuse the spec 010 password-reset flow — server triggers the same self-serve reset email against the user's email; user lands on the existing `/reset-password` view. One new audit-row flag (`actor=admin`) distinguishes owner-initiated from self-serve.
- Q: Where does a password-method invitee land to set their first password? → A: Reuse the existing `/reset-password` route from spec 010 with a `type` mode switch (`recovery` vs `invite`). View copy and post-submit redirect adapt to the mode; PKCE exchange and `updateUser({ password })` logic are identical to recovery.
- Q: Which mode should the Onboard sheet default to when opened? → A: **Quick**. Owners switch to Thorough via the mode pill when they want PIN + avatar set up front. The prototype's `startMode: "thorough"` tweak was a design-canvas review convenience, not a product decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Owner invites a new user with a magic-link (Quick onboard) (Priority: P1)

A salon owner needs to grant a new team member email login access to Tang Nails Studio. From Settings → Onboarding, they pick **Onboard user**, type the person's name and email, choose a role, and send a magic-link invite. The new person receives an email, clicks through, and lands on `/select-staff`.

**Why this priority**: This is the smallest viable slice that delivers value — a salon cannot grow its team in the product today without it. Every other story builds on top of an invite existing.

**Independent Test**: An owner signs in, opens Settings → Onboarding, opens the Onboard sheet in Quick mode, fills in name + email + role, sends. They see a success toast and a new row in **Pending invites**. The invited person can open their email, follow the magic link, and reach `/select-staff` signed in as themselves.

**Acceptance Scenarios**:

1. **Given** the owner is signed in and on Settings → Onboarding, **When** they click **Onboard user** and the sheet opens in Quick mode by default, **Then** the sheet shows three fields (name, email, role) on a single screen and the **Send invite** button is disabled until the email is valid and the name is at least 2 characters.
2. **Given** the owner has filled valid name + email + role and clicked **Send invite**, **When** the action completes, **Then** the sheet shows a success state ("Invite sent"), a toast confirms "Invite sent to {name}", and the page lists the new person under **Pending invites** with status badge "Invited" and metadata "Invited Just now".
3. **Given** the invited person opens their email and clicks the magic link, **When** the link is followed within its validity window, **Then** they are signed in, land on `/select-staff`, and an audit-log row `device.signed_in` with `method=invite` is written.

---

### User Story 2 — Owner invites a new user via the Thorough wizard (Priority: P1)

For a careful onboard — including PIN, avatar color, choice of invite method, and a role-permissions review — the owner uses the **Thorough** mode of the Onboard sheet. Four steps: Identity (name, role, avatar color) → Invite (email, magic-link vs. password-setup, with a live email preview) → PIN (optional inline keypad) → Review (full summary + role permissions card) → send.

**Why this priority**: The Quick path covers most invites but high-trust roles (Owner, Manager) and shared-iPad-first techs need the PIN set up front and the explicit permissions confirmation. Without the Thorough path, owners can't onboard those users without a follow-up trip through Staff and PIN reset.

**Independent Test**: An owner opens the Onboard sheet, switches the mode pill from Quick to Thorough, walks all four steps (filling Identity → Invite → PIN → Review), and sends. The pending row appears with `pin_set=true`, and when the invitee accepts, they can immediately use the pre-set PIN on a shared iPad.

**Acceptance Scenarios**:

1. **Given** the owner toggles the mode pill to **Thorough**, **When** they progress through the wizard, **Then** the step bar shows the four labelled steps (Identity, Invite, PIN, Review), the **Continue** button is gated on per-step validation (name ≥ 2 chars, valid email), and **Back** is always available except on step 1.
2. **Given** the owner is on step 2 (Invite) with a valid email entered, **When** they choose between **Magic link** and **Set up a password**, **Then** the live email preview below updates to match (subject line stays "Your invite to Tang Nails Studio"; the CTA changes between "Open Tang Nails Studio" and "Set up your password"; the footer's validity window changes between 24 hours and 7 days).
3. **Given** the owner is on step 3 (PIN), **When** they enter a 4-digit PIN twice and the second entry matches, **Then** the PIN is captured for the create call; **When** the second entry does not match, **Then** the dots flash an error state, both entries clear, and the wizard returns to the first PIN entry with the message "PINs didn't match. Try again."
4. **Given** step 3 with the **Skip** button, **When** the owner skips PIN, **Then** the Review step shows "Login PIN: Will set on first login" and the invite is sent with `pin_set=false`.
5. **Given** the owner is on step 4 (Review), **When** they look at the permissions card, **Then** the card shows the role label, summary, `Can do` grants, and `Can't do` blocks for the selected role.

---

### User Story 3 — Owner offboards an active user (soft, reversible) (Priority: P1)

When someone leaves the salon temporarily — or the owner wants to revoke email login while preserving history — the owner offboards them. The user's Supabase login is revoked immediately, their PIN is cleared, they disappear from the login picker, and their row moves to the **Offboarded** section. Reactivation is one click.

**Why this priority**: Revoking a departing employee's login on the same day they leave is a security baseline; doing it manually in Supabase isn't viable for non-technical owners. This is the most-asked-for action after invite.

**Independent Test**: With an active user on the page (not the current owner), open the row menu, choose **Offboard**, see the soft-offboard sheet, confirm. The user immediately loses email login (attempting to sign in returns the standard "Invalid credentials" experience), is hidden from `/select-staff`, and shows up in the **Offboarded** section.

**Acceptance Scenarios**:

1. **Given** an active user row that is not the current owner, **When** the owner opens the row menu, **Then** the menu shows **Edit in Staff**, **Reset PIN**, **Send password reset**, and **Offboard {first name}…**.
2. **Given** the owner picks **Offboard {first name}…**, **When** the sheet opens, **Then** it shows a "What happens" checklist (Email login revoked, Hidden from login picker, History stays, Reversible), an optional reason selector (Left the salon, On extended leave, Role change, Performance, Other), and a destructive-but-calm **Offboard {first name}** button.
3. **Given** the owner confirms the offboard, **When** the action completes, **Then** a success state shows in the sheet, a toast confirms "{name} offboarded", the row leaves Active and appears in Offboarded with metadata "Offboarded Just now · {reason}", and an audit row `user.offboarded` is written with `by={owner_id}`, `subject={user_id}`, and `reason`.
4. **Given** the offboarded user attempts to sign in, **When** they submit their previous credentials, **Then** the sign-in fails with the standard invalid-credentials message and no specific "you were offboarded" leak.
5. **Given** the current owner's own row in Active accounts, **When** they open its menu, **Then** the menu shows the standard items but the **Offboard** item is replaced with the explanatory line "You can't offboard yourself. Another owner has to do it."

---

### User Story 4 — Owner removes an offboarded user permanently (hard, irreversible) (Priority: P2)

For compliance, GDPR-style erasure requests, or freeing an email for reuse, the owner permanently removes an offboarded user. The Supabase Auth user is deleted, the staff record is anonymized ("Former staff #NNN", color reset to slate), and past tickets remain in the books but unattributed. This path requires two acknowledgement checkboxes and typing the user's full name.

**Why this priority**: Lower than offboard because soft offboard already revokes access and the destructive variant is rare. But it's required for legal-erasure scenarios and to free emails on small teams where reuse matters.

**Independent Test**: With a user already in the Offboarded section, open the row menu, choose **Remove permanently**, check both acknowledgement boxes, type the user's full name, click **Permanently remove**. The user disappears from the page entirely; subsequent attempts to invite the same email succeed.

**Acceptance Scenarios**:

1. **Given** an offboarded user row, **When** the owner opens the row menu and picks **Remove permanently…**, **Then** the sheet opens with a tinted destructive header, the warning "This can't be undone", and the **Permanently remove** button is disabled.
2. **Given** the Remove sheet, **When** the owner checks both acknowledgements but has not typed the name (or typed it incorrectly), **Then** the **Permanently remove** button remains disabled.
3. **Given** the owner checks both acknowledgements and types the user's name with any casing that matches (case-insensitive), **When** the typed text equals the display name (case-insensitive), **Then** the **Permanently remove** button becomes enabled.
4. **Given** the owner clicks **Permanently remove** and confirmation is sent to the server, **When** the action completes, **Then** the user row leaves the page, a success state shows in the sheet, a toast confirms "{name} permanently removed" with a destructive tone, and the audit log records `user.removed` with `by={owner_id}` and an anonymized snapshot of the prior `display_name` + `email`.
5. **Given** the user has been permanently removed, **When** the owner attempts to onboard a new user with the same email, **Then** the invite succeeds (no duplicate-email block from a deleted auth user).

---

### User Story 5 — Owner manages pending invites (resend, copy link, cancel) (Priority: P2)

A pending invitee may lose the email, sit on it for days, or the owner may decide not to onboard them after all. The Pending invites section offers three actions per row: **Resend invite**, **Copy invite link** (for direct hand-off, e.g. text), and **Cancel invite**.

**Why this priority**: Most invites resolve fine, but a non-trivial fraction get stuck. Without these controls, owners hit the support boundary.

**Independent Test**: For a pending invite, click **Resend** → toast confirms; click **Copy link** → link is in the clipboard and works in another browser session; click **Cancel** → row disappears, audit entry recorded, the magic link in the original email no longer signs the user in.

**Acceptance Scenarios**:

1. **Given** a pending invite row, **When** the owner clicks the row's resend icon, **Then** the system issues a fresh invite link to the same email, a toast confirms "Invite resent", and the previous link is invalidated.
2. **Given** a pending invite row, **When** the owner picks **Copy invite link** from the row menu, **Then** the current valid invite URL is written to the clipboard.
3. **Given** a pending invite row, **When** the owner picks **Cancel invite**, **Then** the row disappears, a toast confirms "Invite to {name} cancelled", any outstanding link for that email is invalidated, and `user.invite_cancelled` is written to the audit log.

---

### User Story 6 — Owner reactivates an offboarded user (Priority: P2)

When an offboarded user returns to the salon, the owner reactivates them. This is not a true "undo" — it issues a fresh invite, clears the prior offboard metadata, and the user must accept the new invite to regain login.

**Why this priority**: Reactivation is real but uncommon; an owner can also simply remove and re-invite. Keeping it as a one-click action preserves the staff record (avoiding duplicate ticket attribution) which is the actual value.

**Independent Test**: From the Offboarded section, click **Reactivate (resend invite)** in the row menu. The row leaves Offboarded and appears under Pending invites; the user receives a fresh invite email; following it signs them back in.

**Acceptance Scenarios**:

1. **Given** an offboarded user row, **When** the owner opens the row menu and picks **Reactivate (resend invite)**, **Then** the row moves from Offboarded to Pending invites, a toast confirms "Reactivation invite sent to {name}", and `user.reactivated` is logged.
2. **Given** the reactivated user clicks the new invite link, **When** they complete the sign-in, **Then** their staff record retains its original `id` and history; the `state` flips to `active` and prior offboard metadata is cleared.

---

### User Story 7 — Search across users (Priority: P3)

The owner can search the page by name or email; matches are filtered live across all three sections. Empty sections are hidden when a query is active and the offboarded section is empty.

**Why this priority**: Useful when the team grows past ~20 people but unnecessary for the MVP.

**Independent Test**: With at least 5 users across all three states, type a substring of one user's name into the search field. All three sections collapse to just the matching row(s); clearing the search restores the full view.

**Acceptance Scenarios**:

1. **Given** users in all three states, **When** the owner types text in the search field, **Then** matches against `display_name` (case-insensitive substring) and `email` (case-insensitive substring) are shown in their respective sections and non-matches are hidden.
2. **Given** an active search query, **When** the Offboarded section has zero matches, **Then** the section header is hidden entirely (whereas without a query, the header shows with a "No offboarded users" empty row).

---

### Edge Cases

- **Email already exists.** Owner submits an invite for an email tied to an existing account (whether active, offboarded, or pending). The system rejects with a calm inline error naming the existing state ("Already invited", "Already active", "Was offboarded — reactivate instead?") and does not create a duplicate account.
- **Invite link expired.** Invitee clicks a link past its validity (24 h for magic-link, 7 days for password-setup). The user lands on a friendly "Link expired — ask {inviter} to resend" page. No separate audit row is written — passive failures are surfaced via Supabase's standard expired-link redirect path, and tracking every expired-link click would add noise without forensic value.
- **Self-offboard via direct request.** A non-owner cannot reach the page or its server actions (RLS + role check). The owner row's offboard option is explicitly disabled (US3 AC5). If the owner attempts to call the offboard action against their own user_id via a crafted request, the server rejects with `cannot_offboard_self`.
- **Last owner protection.** If a salon has exactly one Owner, attempting to offboard or remove that owner (by anyone) must fail with a `last_owner` error and a UI message "Promote another owner first." (Implemented at the server layer; the UI need not disable the path proactively if the second owner exists.)
- **Concurrent edits.** Two owners are on the Onboarding page; Owner A offboards a user while Owner B is viewing the same row. Owner B's next action against that row returns a stale-state error and the page refetches.
- **PIN-mismatch loop.** In Thorough mode step 3, a user mis-types confirm three times in a row. The keypad doesn't lock out — the message stays calm — but a soft hint suggests skipping.
- **Anonymized record collision.** When removing, the placeholder name is `Former staff #NNN` where `NNN` is a monotonically increasing per-salon counter. Two simultaneous removals never collide (sequence is serialized server-side).
- **Network failure mid-action.** Any of the three sheets handles a server error by re-enabling its primary button, surfacing an inline message ("Couldn't reach the server. Try again."), and leaving local state intact so the owner doesn't have to refill.

## Requirements *(mandatory)*

### Functional Requirements

**Page & access**

- **FR-001**: System MUST add a new tab **Onboarding** to Settings, positioned between **Staff** and **Notifications** in the tab order.
- **FR-002**: System MUST restrict the Onboarding tab and all of its server actions to users with role `owner`. Non-owners hitting the page MUST be redirected to Settings → Staff with no information leak.
- **FR-003**: System MUST display a hero counting Active, Pending, and Offboarded users; the **Onboard user** primary CTA; a search field filtering by name or email; and an owners-only notice explaining the boundary with the Staff tab.
- **FR-004**: System MUST list users in three stacked sections — **Pending invites**, **Active accounts**, **Offboarded** — sorted within Active by role (owner → manager → technician → front_desk) then alphabetically. Each row shows avatar, name (with a "You" tag on the current user's row), email, role chip, status badge, contextual metadata (e.g. "Invited 2 days ago", "Last sign-in Today", "Offboarded Apr 2026 · Left the salon"), and an action area.

**Onboard sheet (Quick mode)**

- **FR-010**: System MUST open the Onboard sheet from the **Onboard user** CTA with **Quick** as the default mode. Owners can switch to Thorough via the mode pill in the sheet header at any time. The prototype's `startMode: "thorough"` tweak in `tweaks-panel.jsx` is design-canvas-only and MUST NOT be carried into the implementation.
- **FR-011**: System MUST provide a mode pill in the sheet header letting the owner switch between **Quick** and **Thorough** without losing already-entered Identity fields (name, role, color).
- **FR-012**: Quick mode MUST present a single screen with three fields — full name (min 2 chars), work email (valid RFC 5322 format), and role (one of `owner`, `manager`, `technician`, `front_desk`) — and a **Send invite** button gated on those validations.
- **FR-013**: Quick mode MUST always send a **magic-link** invite (no method picker shown). PIN and avatar color default to "set on first login" and a system-assigned color.

**Onboard sheet (Thorough mode)**

- **FR-020**: Thorough mode MUST show a 4-step bar (Identity, Invite, PIN, Review) and a Back/Continue footer; Continue MUST be gated by per-step validation (step 1: name ≥ 2; step 2: valid email).
- **FR-021**: Step 1 (Identity) MUST collect full name, role (4-tile picker with role label + one-line description), and avatar color from the 8-swatch Lacquer palette, with a live avatar preview.
- **FR-022**: Step 2 (Invite) MUST collect the work email and let the owner pick between **Magic link** and **Set up a password**. With a valid email entered, a live email preview MUST render below showing the recipient's view (subject, From line, intro paragraph, CTA, validity-window footer) that updates as the owner changes the method.
- **FR-023**: Step 3 (PIN) MUST present an inline 4-digit keypad with two-pass confirmation (enter → enter again), an inline mismatch error that clears both entries and returns to first-entry, and a **Skip — they can set it on first login** action.
- **FR-024**: Step 4 (Review) MUST summarize Person, Role, Email, Invite method, and Login PIN status, plus a Permissions card showing role label, summary, `Can do` items, and `Can't do` items derived from a per-role permissions definition shared with the rest of the app.

**Invite delivery**

- **FR-030**: System MUST send invite emails on the owner's confirm — `magic_link` invites use a one-time URL valid for 24 hours that signs the recipient in directly; `password` invites use a one-time URL valid for 7 days that requires the recipient to set a password before signing in.
- **FR-030a**: Password-method invitees MUST land on the existing `/reset-password` route (introduced in spec 010), invoked with `type=invite` instead of `type=recovery`. The route MUST render with first-time-setup copy ("Set your password") rather than recovery copy ("Reset your password") when `type=invite`, but share the same PKCE exchange, `updateUser({ password })` action, and post-submit redirect to `/select-staff`.
- **FR-031**: System MUST log every invite attempt to the audit trail: `user.invited` with `by`, `subject`, `email`, `role`, `method`, `pin_set`.
- **FR-032**: Pending invite rows MUST expose three actions — **Resend** (issue a new link, invalidate the prior), **Copy invite link** (write current valid URL to clipboard), and **Cancel invite** (delete the pending auth user and audit `user.invite_cancelled`).

**Active row admin actions**

- **FR-035**: Active row menu MUST expose **Reset PIN** for every user (including the current owner's own row, which lets an owner rotate their own PIN). On click, the system MUST open a centered PIN modal styled to match the prototype's two-pass keypad (enter → confirm). On confirmation, the new PIN MUST be hashed, written to the user's `pin_hash`, and a notice MUST surface on the user's next `/select-staff` sign-in informing them their PIN was reset by an owner.
- **FR-036**: Every Reset PIN MUST write `user.pin_reset` to the audit trail with `by` (acting owner), `subject` (target user), and `actor=admin` (distinguishing from a user's self-reset).
- **FR-037**: Active row menu MUST expose **Send password reset** for every user whose `state='active'` (regardless of whether they use magic-link or password sign-in). On click, the system MUST trigger the same password-reset flow used by `/login → Forgot password?` (introduced in spec 010): a reset email is sent to the user's email and the link lands on `/reset-password`.
- **FR-038**: Every owner-initiated Send password reset MUST reuse the existing `device.password_reset` audit event but write it with `actor=admin` and `by={owner_id}` (the self-serve path uses `actor=user` and omits `by`).

**Offboard (soft, reversible)**

- **FR-040**: System MUST expose **Offboard {first name}…** as a destructive item in each active row's menu, except on the current owner's own row where it MUST be replaced with the explanatory line "You can't offboard yourself. Another owner has to do it."
- **FR-041**: System MUST present the Offboard sheet with: a person card (avatar, name, role, email, Active badge); a "What happens" list (Email login revoked / Hidden from login picker / History stays / Reversible); an optional reason picker (Left the salon, On extended leave, Role change, Performance, Other); and a primary **Offboard {first name}** button.
- **FR-042**: On confirm, the system MUST revoke the user's authentication (no further sign-in), clear their PIN, flip their state to `offboarded`, persist `offboarded_at`, `offboarded_by`, and `reason`, and write `user.offboarded` to the audit trail.
- **FR-043**: System MUST hide offboarded users from `/select-staff` and from any Staff-tab views that show "active" users; they remain referenced by past appointments, tickets, and tip splits.
- **FR-044**: Offboard MUST refuse when the subject is the only remaining owner of the salon (`last_owner` error).

**Remove (hard, irreversible)**

- **FR-050**: System MUST expose **Remove permanently…** in each offboarded row's menu.
- **FR-051**: The Remove sheet MUST gate its destructive button on two acknowledgement checkboxes (history-stays-attributed-to-placeholder; irreversible) AND a typed-name confirmation that equals the user's `display_name` case-insensitively.
- **FR-052**: On confirm, the system MUST delete the user's authentication record, anonymize the staff record (display name → "Former staff #NNN", email cleared, avatar color reset to slate, PIN cleared), preserve all references on past tickets/appointments/payments to the anonymized staff record, and write `user.removed` to the audit trail capturing the prior display name and email.
- **FR-053**: Remove MUST refuse when the subject is the only remaining owner of the salon (`last_owner` error) — even via direct API call.

**Reactivate**

- **FR-060**: System MUST expose **Reactivate (resend invite)** in each offboarded row's menu.
- **FR-061**: On reactivate, the system MUST restore the user's authentication (only offboarded users — not removed ones — are eligible for this path), issue a fresh magic-link invite, clear offboard metadata, flip state to `invited`, and write `user.reactivated`.

**Audit trail**

- **FR-070**: System MUST extend the existing audit log (introduced in spec 010) with the new event types: `user.invited`, `user.invite_resent`, `user.invite_cancelled`, `user.offboarded`, `user.reactivated`, `user.removed`, `user.pin_reset`. Existing `device.password_reset` events MUST be reused without renaming.
- **FR-071**: Every audit row MUST capture `by` (the acting owner's user_id), `subject` (the target staff_id — stored as the `audit_log.entity_id` column — or, for removed users, the anonymized snapshot of display_name + email in the `payload`), and timestamp; offboard rows also capture `reason`.

**Permissions definition**

- **FR-080**: System MUST define a single source of truth for the per-role grants/blocks shown in the Thorough wizard's permissions card, the empty-state hints in Staff, and any future role-comparison views. The four supported roles are `owner`, `manager`, `technician`, `front_desk`.

### Key Entities

- **User** — an authentication account (email + auth identity). Paired 1:1 with a **Staff** record. Lifecycle states: `invited` (account exists, never signed in), `active` (account, has signed in at least once), `offboarded` (authentication revoked, staff record state=`offboarded`). Removed users do not exist as User entities (the auth record is deleted; only the anonymized Staff record remains for ticket continuity).
- **Staff** — the operational record (display name, role, avatar color, PIN, joined date, last sign-in, state). Already exists in the app for staff settings; this spec extends `state` to include `invited` and `offboarded`, adds `offboarded_at`, `offboarded_by`, `reason`, and the anonymization fields used by the hard-remove path.
- **Invite** — an outstanding invite link (issued and persisted by the authentication provider). The system stores no separate invite table; pending invites are derived from staff `state='invited'`.
- **Audit event** — append-only row in the audit log. Already introduced for the auth flow; extended here with the six new event types listed in FR-070.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can send a Quick-mode invite to a new technician in under 30 seconds from cold start (page open → invite sent), measured end-to-end on a typical broadband connection.
- **SC-002**: 95% of invited users who open the email and click the link within the validity window successfully reach `/select-staff` signed in on first attempt (no expired-link bounce, no "couldn't find session" error).
- **SC-003**: A soft offboard takes effect within 5 seconds — the offboarded user's existing browser session cannot complete any authenticated action after 5 seconds from the owner's confirm click.
- **SC-004**: 100% of permanent-remove attempts fail closed when any of the three gates (two acks + typed-name) is not satisfied; 0% of permanent removes happen without an audit row capturing the prior identity.
- **SC-005**: The page renders cleanly with no horizontal scroll at viewport widths from 360 px (mobile portrait) to 1920 px (desktop). The three-section list, the hero stats, and all three sheets remain usable at 360 px.
- **SC-006**: The owner-only access guard returns a redirect (not a 403, not a 500) for any non-owner that reaches `/settings/onboarding` or attempts a server action; verified by automated test covering all four roles.
- **SC-007**: Audit-log entries for every onboarding-page action (invite / resend / cancel / offboard / reactivate / remove) are visible to other owner sessions within 1 second of the action completing, with no missing rows under normal load.

## Assumptions

- The audit-log table and surrounding infrastructure introduced in spec `010-login-redesign` is reused without schema changes other than the new event-type enum values listed in FR-070.
- Supabase Auth `inviteUserByEmail` (for the password-setup path) and `generateLink({ type: 'magiclink' })` (for the magic-link path) are the canonical invite mechanisms; no custom mail flow is built.
- The Staff table already has the columns `id`, `auth_user_id`, `display_name`, `role`, `color_token`, `pin_hash`, `active`, `joined_at`, `last_sign_in_at` (verified in `lib/db/schema/staff.ts` during planning). This spec assumes those columns exist and only adds the offboard metadata + state-enum extension.
- "Last owner protection" is enforced server-side; the UI does not proactively disable the offboard/remove buttons for the lone-owner case (a rare condition rarely reached on a multi-owner salon).
- Removed users' Supabase Auth row is deleted via the admin API; service-role credentials are already present in the deployed environment for other admin operations.
- Email deliverability (DKIM, SPF, branded sender) is out of scope — the existing Supabase default sender is acceptable for v1, matching the 010-login-redesign baseline.
- The mobile layout reuses the Studio shell's existing responsive collapse pattern (sidebar → top nav) and adapts the three-section list to a single column with the same row content; bottom-sheet style is not required.
- "Copy invite link" relies on `navigator.clipboard.writeText`; HTTPS deployments are assumed (which the existing Vercel production already provides).
- Invitations for an email already attached to any state (`invited` / `active` / `offboarded`) are rejected at the server; the owner sees a contextual inline error and is directed to the appropriate next action (resend, edit in Staff, or reactivate).
