# Feature Specification: Staff management (Settings → Staff)

**Feature Branch**: `006-staff-management`

**Created**: 2026-05-15

**Status**: Draft

**Input**: User description: "Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/Hc2Bwf33784amWRUYguDPQ?open_file=prototypes%2Fuser-management%2FUser+Management.html — Implement: prototypes/user-management/User Management.html."

The fetched design is the Lacquer "User Management" prototype: the **Settings → Staff** surface for Tang Nails Studio. It lets the owner (or a manager) view the salon's roster, add new staff, change a member's role and display details, set or change a member's 4-digit login PIN, deactivate or remove members, and see who currently has PIN access. Other Settings tabs (General, Notifications, Billing) are intentionally out of scope for this feature.

## Clarifications

### Session 2026-05-15

- Q: Which privileged actions on Settings → Staff require an owner PIN versus owner-or-manager PIN? → A: None — no inline PIN override is required for any staff-management action. The route gate (operator must be `owner` or `manager`) is the sole authorization check.
- Q: How should the deactivation dialog handle "{N} upcoming appointments will need reassignment" given the `appointments` table doesn't exist yet? → A: Omit the warning entirely from v1; it rolls into the appointments feature that ships later.
- Q: When a manager edits a staff member's role, which target roles should the role-select offer? → A: `manager`, `technician`, or `front_desk` — managers can promote within the non-owner tier but only owners can grant ownership.
- Q: With the inline PIN override removed, what should a manager be allowed to do to an owner staff member? → A: Managers see owner rows as read-only — every field is disabled and no mutation (rename, color, role, active, PIN, deactivate, remove) is permitted. Owner rows remain visible in the roster.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See the roster at a glance (Priority: P1)

The owner opens Settings → Staff and immediately sees every staff member: name, role, whether their login PIN is set, whether they're active, and when they were added. The list is sorted with the most senior roles first (owner → manager → tech → front desk), then alphabetically by name. A search field filters by name. A "Show inactive" toggle controls whether deactivated members appear. A summary line above the table shows "X active · Y total."

**Why this priority**: Without a readable roster, none of the other actions can be performed safely — an admin needs to find the right person before they can edit, deactivate, or reset a PIN. This is also the entry point that every other story branches from.

**Independent Test**: Seed the database with at least one member per role plus one inactive member. Open the Staff settings page, confirm the table renders all of them in the right order, the active/inactive count is correct, the PIN column shows "Set" or "—" correctly, the search filter narrows the rows by name, and the "Show inactive" toggle hides/shows deactivated rows.

**Acceptance Scenarios**:

1. **Given** the salon has 5 staff (1 owner, 1 manager, 2 technicians, 1 front desk; one technician inactive), **When** the owner opens Settings → Staff with "Show inactive" on, **Then** all 5 rows appear, ordered owner → manager → techs (alphabetical) → front desk, the inactive row is visibly muted, and the summary reads "4 active · 5 total".
2. **Given** the same roster, **When** the owner toggles "Show inactive" off, **Then** the inactive row is hidden, the table still shows 4 rows, and the summary still reads "4 active · 5 total".
3. **Given** the same roster, **When** the owner types "ma" into the search field, **Then** only rows whose names contain "ma" (case-insensitive) remain visible.
4. **Given** a staff member has no PIN set, **When** the row renders, **Then** their PIN column shows an em-dash; for any member whose PIN is set, it shows "Set" with a check icon.
5. **Given** the search returns no rows, **When** the table renders, **Then** the table shows the empty message "No staff match your search."

---

### User Story 2 — Add a new staff member with a login PIN (Priority: P1)

The owner clicks "Add staff" and steps through a guided sheet: (1) enter display name, role, and avatar color (preview updates live); (2) optionally set a 4-digit login PIN by entering it twice on a small keypad; (3) see a success summary confirming the member is added and whether they have PIN access. After saving, the new row appears in the table and the new member is selected for further edits. The owner can choose to skip the PIN step — but the success screen states clearly that the member can't log in until a PIN is set.

**Why this priority**: Adding staff is what unlocks PIN-based device login (`/select-staff`) for new technicians and front-desk hires; without it the salon can't onboard anyone after the seed data. Pairs with Story 1 to make the page useful in isolation.

**Independent Test**: From an empty or pre-populated roster, click "Add staff", complete each step (Details, Set PIN, Done), confirm a toast announces the addition, the new row is present and selected in the table, and the PIN column reflects the chosen path (set or em-dash).

**Acceptance Scenarios**:

1. **Given** the Add staff sheet is open on step 1, **When** the owner enters "Maya Chen", picks the "Tech" role and a green avatar color, leaves the "Set a login PIN" toggle on, and clicks "Next: set PIN", **Then** step 2 opens with a 4-digit dot display and on-screen keypad, the PIN sub-step bar shows "Enter" active.
2. **Given** the PIN step shows "Enter", **When** the owner taps `1 9 8 4`, **Then** the dots fill in order, the sub-step advances to "Confirm" automatically, and the dots reset to empty.
3. **Given** the PIN step shows "Confirm", **When** the owner taps `1 9 8 4`, **Then** the success step appears with a green check, the message "Maya Chen can now log in with their 4-digit PIN.", and a row preview showing avatar + role + "PIN set" badge.
4. **Given** the success step is visible, **When** the owner clicks "Done", **Then** the sheet closes, a toast reads "Maya Chen added to the roster", the new row appears in the table, the table selects that row, and the right-hand edit panel populates with their details.
5. **Given** the owner enters two different 4-digit PINs across the Enter and Confirm phases, **When** the second confirmation completes, **Then** the dots flash an error state, an inline error reads "PINs didn't match. Try again.", both phases reset to empty, and the sub-step bar returns to "Enter".
6. **Given** the owner turns the "Set a login PIN" toggle off on step 1, **When** they click the primary action, **Then** the button label changes to "Add staff member" and the wizard skips PIN setup, lands on the success screen with the message "Maya has been added. Set a PIN before they can log in.", and the new row's PIN column shows an em-dash.
7. **Given** the display name is empty or shorter than 2 characters, **When** the owner views step 1, **Then** the "Next" / "Add staff member" button is disabled.

---

### User Story 3 — Edit a staff member's details, role, color, and active status (Priority: P1)

The owner clicks a row in the table; an edit panel opens to the right showing the member's avatar, name, role, color, PIN status, and active toggle. The owner can rename them, change role, pick a new color, or flip them between active and inactive. Changes are draft-only until "Save changes" is pressed; the button is enabled only when something has actually changed. After save, a toast confirms "Changes saved" and the table updates.

**Why this priority**: Roles drive what each staff member can see and do; display name and color are how techs are identified everywhere else (calendar, checkout, walk-in waitlist). Editing must work before deactivation/removal stories can be exercised meaningfully.

**Independent Test**: Click a row, change one or more of name/role/color/active, confirm the Save button enables, click Save, confirm the table row reflects the change and a toast appears.

**Acceptance Scenarios**:

1. **Given** no row is selected, **When** the page first renders, **Then** the right column shows an empty state ("Select a staff member") with a Users icon and copy explaining what the panel does.
2. **Given** a row is selected, **When** the owner edits the display name to "Mei Chen", **Then** the avatar/name preview at the top of the panel updates immediately, but the table row still shows the saved value until "Save changes" is pressed.
3. **Given** the panel has unchanged drafts, **When** the panel renders, **Then** the "Save changes" button is disabled.
4. **Given** the panel has at least one changed draft and a non-empty name, **When** the panel renders, **Then** "Save changes" is enabled.
5. **Given** the owner presses "Save changes", **When** the save completes, **Then** the table row reflects every change, the panel's "saved" baseline matches the new values (Save disables again), and a toast reads "Changes saved".
6. **Given** the owner clicks a different row before saving, **When** the panel re-keys, **Then** the in-flight draft is discarded with no save and the new row's values populate the panel.
7. **Given** the owner toggles "Active" off in the panel and saves, **When** the table re-renders with "Show inactive" on, **Then** the row appears muted with an "Inactive" badge; with "Show inactive" off, the row disappears.

---

### User Story 4 — Set or change a staff member's login PIN (Priority: P1)

From the edit panel, the owner can press "Set PIN" (when none is set) or "Change" (when one already exists). A modal opens with a 2-step keypad (Enter → Confirm). On success, the modal closes, the panel's PIN row updates to show "4-digit PIN set", and a toast confirms "PIN updated". The PIN keypad accepts both on-screen taps and the physical keyboard (digits, Backspace, Escape).

**Why this priority**: Lost or forgotten PINs are routine; without an in-product reset path the owner has to fall back on database access. This is also the only way to enable login for staff added without a PIN in Story 2.

**Independent Test**: Pick a staff member with no PIN set, click "Set PIN", complete the two-step keypad with matching values, confirm the panel's PIN row flips to "set" and a toast appears. Repeat with a member who already has a PIN; the button reads "Change".

**Acceptance Scenarios**:

1. **Given** the selected member has no PIN, **When** the panel renders, **Then** the PIN row shows the unset state ("No PIN set" + "Required to log in") and the action button reads "Set PIN".
2. **Given** the selected member has a PIN, **When** the panel renders, **Then** the PIN row shows the set state ("4-digit PIN set") and the action button reads "Change".
3. **Given** the PIN modal is open on the Enter step, **When** the owner uses the physical keyboard to type 4 digits, **Then** the dots fill, the modal advances to the Confirm step, and Backspace/Escape clear digits as expected.
4. **Given** the Confirm step matches the Enter step, **When** the fourth digit is entered, **Then** the modal closes, the PIN row updates to the set state, and a toast reads "PIN updated".
5. **Given** the Confirm step does not match, **When** the fourth digit is entered, **Then** the dots show an error state, the inline message reads "PINs didn't match. Try again.", and both phases reset for another attempt.
6. **Given** the PIN modal is open, **When** the owner clicks the backdrop or "Cancel", **Then** the modal closes with no change to the member's PIN status.

---

### User Story 5 — Deactivate, reactivate, or remove a staff member (Priority: P2)

The edit panel has a deactivate action (when the member is currently active) and a "Remove from salon" action. Both require a confirmation dialog that names the member and explains the consequence — deactivation hides them from login but preserves their data; removal takes them off the roster entirely while retaining historical appointment records. When a member is inactive, the panel surfaces a "Reactivate" action in place of deactivate. After confirming, the table updates and a toast confirms the action.

**Why this priority**: Hiring churn means roster cleanup happens regularly. Lower priority than create/edit only because in a fresh salon the first 30 days have plenty of adds and few removes; the team can ship Stories 1–4 first and add 5 a sprint later.

**Independent Test**: Select an active member, click "Deactivate", confirm the dialog copy mentions their name and the historical-data preservation, confirm; the row gains the Inactive badge. Select an inactive member, click "Reactivate"; the badge clears. Select any member, click "Remove from salon", confirm; the row disappears and any selection clears.

**Acceptance Scenarios**:

1. **Given** an active member is selected, **When** the owner clicks "Deactivate", **Then** a confirmation dialog appears with a destructive icon, the title "Deactivate {name}?", body copy explaining they "won't be able to log in until you reactivate them" but their "appointments and history are unaffected", and Cancel + Deactivate buttons.
2. **Given** the deactivation dialog is open, **When** the owner clicks "Cancel" or the backdrop, **Then** the dialog closes with no change.
3. **Given** the deactivation dialog is open, **When** the owner clicks "Deactivate", **Then** the member's row flips to inactive (badge changes, row visually muted when shown), the panel's Active toggle is off, the Deactivate button is replaced with a Reactivate button, and a toast reads "{name} deactivated".
4. **Given** an inactive member is selected, **When** the owner clicks "Reactivate", **Then** the member becomes active immediately, the panel updates, and a toast reads "Changes saved".
5. **Given** any member is selected, **When** the owner clicks "Remove from salon", **Then** a confirmation dialog appears with the title "Remove {name}?" and body copy that the member "will be removed from the staff roster and won't appear on the login screen" but "their appointment history stays on record".
6. **Given** the removal dialog is open, **When** the owner confirms, **Then** the member is removed from the roster, the table no longer lists them, the right panel returns to the empty state, and a toast reads "{name} removed".

---

### User Story 6 — Restrict who can manage staff (Priority: P2)

Only owners and managers can reach the Staff settings page; technicians and front-desk staff are blocked at the route. Authorization is enforced entirely by the operator's role on the existing PIN session — there is no additional inline PIN re-prompt for any staff-management action. Owners and managers who reach the page can perform every mutation directly; the audit log records the operating staff on every write.

**Why this priority**: This is a security floor more than a user value, but it must be enforced before the page is reachable in production. Lower priority than P1 only because the page can be developed against an owner-only seed before the role gate is wired in; it must ship in the same release.

**Independent Test**: Log in as a technician → navigate to `/settings/staff` → confirm a 403 / redirect. Log in as a manager → navigate to the page → confirm read/edit access works for every mutation the manager is permitted to perform.

**Acceptance Scenarios**:

1. **Given** a technician's PIN session, **When** they navigate to the Staff settings route, **Then** they're redirected away (back to their landing surface) with no flash of staff data.
2. **Given** a manager's PIN session, **When** they open the Staff settings route, **Then** the table renders all non-removed staff (owners visible alongside the rest); for non-owner targets the manager can edit display name, role (within manager / technician / front desk — the role select does not offer "owner"), color, active status, and PINs; for **owner** targets the entire panel is read-only and every control is disabled with a tooltip explaining "Only owners can edit owner accounts."
3. **Given** an owner or manager performs any mutation (add, edit, set/change PIN, deactivate, reactivate, remove), **When** they press the committing action, **Then** the change commits immediately — no additional PIN dialog is shown.
4. **Given** any mutation is committed, **When** the audit log is inspected, **Then** the row records the device user and the operating staff.

---

### User Story 7 — Get clear feedback after every action (Priority: P3)

Every mutation (add, edit, PIN change, deactivate/reactivate, remove) shows a single-line confirmation toast at the bottom of the screen for ~3 seconds. The toast wording matches the action and uses the staff member's name where it adds clarity. The page never shows a stale list — after a successful save the table reflects the new state immediately.

**Why this priority**: Polish that nudges trust ("did that go through?") without blocking core use. Easy to add after Stories 1–6.

**Independent Test**: Perform each mutation in sequence and confirm a toast appears for each with the correct copy.

**Acceptance Scenarios**:

1. After a successful add: toast reads "{name} added to the roster".
2. After a successful edit: toast reads "Changes saved".
3. After a successful PIN set/change: toast reads "PIN updated".
4. After a deactivate confirm: toast reads "{name} deactivated".
5. After a remove confirm: toast reads "{name} removed".
6. **Given** two toasts fire in quick succession, **When** the second fires, **Then** the first dismisses (no stacking) and the second shows for its full duration.

---

### Edge Cases

- **Renaming yourself.** An owner can rename themselves and change their own avatar color, but cannot change their own role or deactivate/remove themselves. The relevant controls in the panel are disabled with a tooltip explaining why.
- **Last owner.** The system MUST prevent demoting or removing the last remaining owner; the affected control is disabled and shows an explanation.
- **Duplicate display names.** Two staff with the same display name are allowed but the user is warned at save time ("Another active staff member is named {name}. They'll appear identically on the login screen — continue?"); confirming proceeds.
- **Inactive member with appointments.** Deactivating a member with future appointments is allowed and does not block the action. The dialog does not surface an appointment count or warning in v1 — that affordance is rolled into the appointments feature that ships later (which will add the count to this dialog when it lands).
- **Removing a member with payment history.** Removal does not delete historical `appointments`, `payments`, or `tip_splits` rows; their `staff_id` foreign keys remain valid against the (now soft-removed) staff row, which is hidden from the roster but kept for referential integrity. The dialog copy makes this explicit.
- **Add staff without a PIN.** The new member exists but cannot log in until a PIN is set; the success screen states this and the row's PIN column shows the unset state.
- **PIN keypad input.** The keypad accepts on-screen taps, physical digits, Backspace (delete one), and Escape (clear all). Non-digit keys are ignored.
- **Concurrent edits.** Last-write-wins on the staff row; if two admins edit the same member in different tabs, the second save replaces the first. (Realtime invalidation is not required for the Settings surface in v1.)
- **PIN attempts.** No PIN lockout on this page. The only PIN entry surfaces are the Add wizard's "Set PIN" step and the edit panel's "Change PIN" modal; both are operator-driven (the operator is already authenticated), so brute-force is not a concern.
- **Color reuse.** Two staff are allowed to share an avatar color, but a soft warning toast appears once after save: "{Other name} also uses this color." No hard block.

## Requirements *(mandatory)*

### Functional Requirements

#### Roster view
- **FR-001**: System MUST display every staff member in a single table with columns for Name (with avatar), Role, PIN status, Active status, and date added.
- **FR-002**: System MUST sort the table by role priority (owner → manager → technician → front desk), then alphabetically by display name within each role.
- **FR-003**: System MUST show a summary above the table reading "{X} active · {Y} total".
- **FR-004**: System MUST provide a free-text search field that filters rows by case-insensitive substring match on display name.
- **FR-005**: System MUST provide a "Show inactive" toggle that hides or shows deactivated members; the toggle's state MUST persist for the session.
- **FR-006**: When the search returns no matches, the table MUST show the empty message "No staff match your search."
- **FR-007**: Inactive rows MUST be visually muted (reduced opacity) and labeled with an "Inactive" badge.

#### Add staff member
- **FR-008**: A primary "Add staff" button above the table MUST open a guided sheet for creating a new member.
- **FR-009**: The Add sheet MUST present three steps with a visible step bar: Details, Set PIN, Done.
- **FR-010**: Step 1 (Details) MUST collect display name (required, ≥2 characters), role (one of owner / manager / technician / front desk; default technician), avatar color (chosen from the fixed Lacquer palette of 8 swatches; default Green), and a toggle to opt out of setting a PIN now.
- **FR-011**: Step 1 MUST show a live preview of the avatar + display name + role label as the user types.
- **FR-012**: The "Next" / "Add" button on step 1 MUST be disabled until the display name has at least 2 non-whitespace characters.
- **FR-013**: When the PIN toggle is on, step 2 MUST present a 4-digit numeric keypad with Enter and Confirm sub-steps and an inline error display.
- **FR-014**: When the PIN toggle is off, the wizard MUST skip step 2 and go directly to the success screen with copy noting the member can't log in until a PIN is set.
- **FR-015**: Step 2 confirmation MUST require the second PIN to exactly match the first; on mismatch, the system MUST clear both phases, surface the inline error "PINs didn't match. Try again.", and return to the Enter sub-step.
- **FR-016**: Step 3 (Done) MUST show a success state with the new member's avatar, name, role label, and PIN status; closing it adds the member, selects the new row, and shows a confirmation toast.
- **FR-017**: System MUST persist the new staff member with their chosen role, color token, active = true, and (when a PIN was set) a securely hashed PIN.

#### Edit staff member
- **FR-018**: Clicking a row MUST open the edit panel for that member; clicking the same row again deselects it and returns the panel to the empty state.
- **FR-019**: The edit panel MUST surface editable controls for display name, role, avatar color, and active status, plus a read-only PIN row with a "Set PIN" or "Change" action.
- **FR-020**: The edit panel MUST show a live header preview (avatar + name + role label) that reflects current draft values, while the table MUST continue showing the saved values until the user presses "Save changes".
- **FR-021**: The "Save changes" button MUST be disabled when the draft is identical to the saved values or when the display name is empty after trim.
- **FR-022**: Switching between rows MUST discard any unsaved drafts in the previously selected row's panel without a confirmation prompt.
- **FR-023**: Pressing "Save changes" MUST persist all edited fields atomically and update the table row in place; a toast MUST confirm "Changes saved".
- **FR-024**: System MUST prevent self-demotion or self-deactivation: the role select and active toggle MUST be disabled when the panel is showing the currently signed-in operator.
- **FR-025**: System MUST prevent demoting or removing the last remaining owner; the relevant controls MUST be disabled with an explanatory hint.

#### PIN management
- **FR-026**: The edit-panel PIN row MUST visually distinguish the "set" state (shield icon, "4-digit PIN set") from the "unset" state (key icon, "No PIN set").
- **FR-027**: The "Set PIN" / "Change" action MUST open a modal with the same Enter → Confirm two-step keypad behavior as the Add wizard's step 2.
- **FR-028**: The PIN modal MUST accept both on-screen taps and physical-keyboard input (digits 0–9, Backspace = delete one, Escape = clear all).
- **FR-029**: A successful PIN save MUST close the modal, update the panel's PIN row to the set state, and show a "PIN updated" toast.
- **FR-030**: System MUST hash and store PINs using a one-way KDF (the same `pin_hash` column used by `/select-staff`); raw PINs MUST NOT be stored or logged.

#### Deactivate, reactivate, remove
- **FR-031**: When a member is active, the panel MUST show a "Deactivate" link and a "Remove from salon" link; when inactive, "Deactivate" MUST be replaced by "Reactivate".
- **FR-032**: Both "Deactivate" and "Remove from salon" MUST require a confirmation dialog that names the member and explains the consequence in plain language (deactivation reversible; removal preserves history but hides the member).
- **FR-033**: Confirming deactivate MUST set `active = false` on the staff row; the member MUST stop appearing on the `/select-staff` PIN screen.
- **FR-034**: Reactivate MUST set `active = true` and the member MUST reappear on `/select-staff`.
- **FR-035**: Confirming "Remove from salon" MUST hide the member from the roster permanently while preserving referential integrity for historical `appointments`, `payments`, `tip_splits`, and `audit_log` records (soft delete).
- **FR-036**: Cancel actions and backdrop clicks MUST close any confirmation dialog with no state change.

#### Authorization
- **FR-037**: Only staff with role `owner` or `manager` MUST be able to reach `/settings/staff`; other roles MUST be redirected before any staff data is rendered. This role check is the sole authorization gate — no additional inline PIN re-prompt is required for any mutation.
- **FR-038**: Server Actions MUST re-verify the operator's role on every invocation (defense in depth against direct FormData posts that bypass the layout's gate). A request from a non-owner / non-manager operator MUST be rejected with no mutation and no audit row.
- **FR-038a**: The role select on Add staff and Edit panel MUST scope its options to what the operator is allowed to grant: owners see all four roles (owner, manager, technician, front desk); managers see only manager, technician, and front desk (the "owner" option is not rendered). Server Actions MUST reject any role mutation whose target role is outside the operator's allowed set.
- **FR-038b**: When the operator is a manager and the selected staff is an owner, the edit panel MUST render every control read-only: the display-name input, role select, color picker, active toggle, "Set PIN" / "Change" action, "Deactivate" link, and "Remove from salon" link are all disabled with a tooltip "Only owners can edit owner accounts." Server Actions MUST reject any mutation by a manager whose target is an owner with no audit row written.
- **FR-039**: Every mutation MUST write an entry to `audit_log` recording the device user and the operating staff (`acting_as_staff_id`).

#### Feedback & polish
- **FR-040**: Successful mutations MUST surface a single bottom-center toast with a check icon for ~3 seconds; only one toast may be visible at a time (a new one replaces the previous).
- **FR-041**: All page surfaces (table, panel, sheet, modals, dialogs, toast) MUST use Lacquer tokens, the Settings shell layout, and the Inter type / 4px spacing scale defined in `design-system/`.
- **FR-042**: All numeric values in the page (counts, dates) MUST render with tabular numerals.

### Key Entities

- **Staff** — a single person who works at the salon. Carries a display name, role (owner / manager / technician / front desk), avatar color token from the Lacquer palette, optional Supabase user link (for staff who also log in by email), an optional one-way-hashed login PIN, an active flag, and a creation timestamp. Already defined in the system design as the `staff` table.
- **PIN** — the 4-digit secret a staff member types on `/select-staff` to assume the operator role at the device. Stored as a one-way hash on the staff row; never displayed after entry.
- **Audit entry** — a record of every staff-management mutation, capturing the device user, the operating staff, the action verb, the entity, and a payload describing the change. Already defined in the system design as the `audit_log` table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can add a brand-new staff member end-to-end (open Add sheet → enter details → set PIN → land on the success screen → close → see the new row) in **under 60 seconds** with no documentation.
- **SC-002**: After ship, the salon administrator performs **zero database edits** to manage the roster — every CRUD operation is reachable from the page.
- **SC-003**: Resetting a forgotten 4-digit PIN — from clicking the row to seeing the "PIN updated" toast — completes in **under 30 seconds**.
- **SC-004**: 100% of staff-management mutations write a corresponding `audit_log` row with the device user and the operating staff.
- **SC-005**: All page surfaces pass the Lacquer design check (every visual value traces to a token; matches the source prototype side-by-side) before the feature is marked complete, per `CLAUDE.md` § "When you change UI".
- **SC-006**: Filtering and searching a roster of up to 50 members feels instant — the table updates within **100ms** of a keystroke or toggle change on a typical staff laptop.
- **SC-007**: A returning admin can find any staff member by name in **under 5 seconds** using the search field, regardless of roster size up to 50 members.

## Assumptions

- This feature implements only the **Staff** tab inside `/settings`. The General, Notifications, and Billing tabs visible in the prototype are placeholders rendered as "Not part of this prototype" in the source and remain out of scope here.
- The `staff` table, `pin_hash` storage, and `audit_log` already exist (per `docs/system-design.md` § "Auth: device login + acting-as PIN" and the `staff` schema). This feature consumes those primitives — it does not introduce new auth mechanisms and does not use the system design's manager-PIN inline override pattern for any of its mutations.
- The fixed avatar palette is the 8 OKLCH swatches enumerated in the source prototype (Rose / Blue / Green / Amber / Purple / Teal / Orange / Slate); these are stored as Lacquer color tokens, not raw hex.
- Email or other contact fields for staff are out of scope for v1 — Supabase Auth handles email login independently via `staff.user_id` and is not edited from this surface.
- "Remove from salon" is a soft delete (`removed_at` timestamp or equivalent), not a hard `DELETE`, because historical `appointments`, `payments`, `tip_splits`, and `audit_log` rows reference the staff row by foreign key and must remain consistent. The chosen mechanism is to be confirmed in the planning phase but the user-visible behavior is: removed members never appear in the roster or on `/select-staff` again, while their historical records remain intact.
- The prototype's "tweaks panel" (developer-mode overlay for toggling `showInactive` / `defaultTab` / `startSelected`) is a design-system authoring affordance and is **not** part of the production implementation.
- The "Added" date column displays a coarse "Mon YYYY" string sourced from `staff.created_at` — no time-of-day shown, consistent with the prototype.
- Realtime sync is not required for this surface in v1; the system design lists `staff` outside the realtime channels table. Last-write-wins is acceptable for concurrent admin edits.
- Toast styling, the on-screen keypad, the avatar component, the badge component, the sheet, the modal, and the confirmation dialog all already exist in `components/lacquer/*` (or are added here as part of the design-system mapping); no new component library is introduced.
