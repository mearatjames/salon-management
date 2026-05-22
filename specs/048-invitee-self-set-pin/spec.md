# Feature Specification: Invitee self-sets their PIN during invite acceptance

**Feature Branch**: `048-invitee-self-set-pin`

**Created**: 2026-05-22

**Status**: Draft

**Input**: GitHub issue #122 — "Let an invited staff member set their own PIN during invite acceptance"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Invitee without a PIN sets their own (Priority: P1)

A new staff member is invited through Settings → Onboarding without the owner
choosing a PIN for them. The invitee opens their invite link and sets a
password. Because no PIN exists for their account, the flow then shows them a
"Set your PIN" step where they pick a PIN of their own. Once the PIN is saved,
the flow continues to the device's staff picker, where the invitee now appears
and can pin in to start working.

**Why this priority**: This is the core fix. Today a no-PIN invitee finishes
invite acceptance "active" but invisible on the device staff picker and unable
to pin in — onboarding silently fails to complete. Without this story the
feature delivers nothing. It is also the most common case: the quick invite
mode never sets a PIN, so most invitees land here.

**Independent Test**: Invite a staff member in quick mode (no PIN). Accept the
invite, set a password, and confirm a PIN-creation step appears. Set a PIN,
then confirm the invitee appears on the device staff picker and can pin in
with the PIN they just chose.

**Acceptance Scenarios**:

1. **Given** an invitee whose staff account has no PIN, **When** they finish
   setting their password during invite acceptance, **Then** they are taken to
   a "Set your PIN" step instead of straight to the staff picker.
2. **Given** the invitee is on the "Set your PIN" step, **When** they choose
   and confirm a valid PIN, **Then** the PIN is saved to their own staff
   account and they are taken to the device staff picker.
3. **Given** the invitee has just saved their PIN, **When** the staff picker
   loads, **Then** the invitee appears in the roster and can pin in using the
   PIN they chose.
4. **Given** the invitee is on the "Set your PIN" step, **When** they enter a
   PIN that does not match the required shape, **Then** the PIN is rejected
   with a clear message and they are prompted to try again without leaving the
   step.

---

### User Story 2 - Invitee whose PIN was set by the owner skips the step (Priority: P2)

A staff member is invited in thorough mode and the owner chooses a PIN for
them at invite time. When that invitee accepts the invite and sets their
password, the flow recognizes a PIN already exists and takes them straight to
the device staff picker — no extra PIN step — exactly as it works today.

**Why this priority**: Preserves the existing thorough-mode experience. If the
PIN step were shown unconditionally, owner-set PINs would be pointless and
invitees would face an extra step the owner already handled. Needed for
correctness, but lower priority than P1 because it protects an existing path
rather than fixing a broken one.

**Independent Test**: Invite a staff member in thorough mode with a PIN.
Accept the invite, set a password, and confirm no PIN step appears — the flow
lands directly on the device staff picker.

**Acceptance Scenarios**:

1. **Given** an invitee whose staff account already has an owner-set PIN,
   **When** they finish setting their password during invite acceptance,
   **Then** they are taken directly to the device staff picker with no PIN
   step.
2. **Given** the invitee was taken straight to the staff picker, **When** the
   roster loads, **Then** the invitee appears and can pin in using the PIN the
   owner set.

---

### User Story 3 - Forgot-password resets are unaffected (Priority: P3)

A staff member who already has a salon account uses the "forgot password" /
recovery flow to reset their password. After they set the new password they
go straight to the device staff picker, with no PIN step — the PIN step
belongs only to invite acceptance.

**Why this priority**: A scoping guarantee. The new-password screen is shared
between invite acceptance and password recovery; the PIN step must not leak
into recovery, where the user already has a PIN. Lowest priority because it
guards a boundary rather than delivering new value.

**Independent Test**: Trigger a password recovery for an existing staff
member, complete the new-password screen, and confirm the flow lands directly
on the device staff picker with no PIN step.

**Acceptance Scenarios**:

1. **Given** a user completing a password recovery (not an invite), **When**
   they finish setting their new password, **Then** they are taken directly to
   the device staff picker with no PIN step, regardless of whether their staff
   account has a PIN.

---

### Edge Cases

- **Invitee abandons the flow before completing the PIN step**: their staff
  account keeps no PIN and they stay absent from the device staff picker. The
  owner can still set a PIN manually (Settings → Staff "Set PIN", or the
  Settings → Onboarding reset-PIN modal) as the fallback path — this path is
  unchanged by this feature.
- **Invitee's authenticated session expires while on the PIN step**: the PIN
  cannot be saved; the invitee is shown the expired-state surface and must
  obtain a fresh invite or have the owner set a PIN. The PIN step only
  functions while the invitee's just-authenticated session is valid.
- **Invitee enters a PIN that fails shape validation**: the PIN is rejected
  with a clear message and the invitee stays on the step to retry.
- **A PIN somehow already exists when the invitee reaches the step** (e.g. the
  owner set one between password-set and PIN-set): saving does not silently
  overwrite an existing PIN with a different value, and the invitee proceeds
  to the staff picker.
- **Attempt to set a PIN for a different staff account**: rejected. The step
  can only write the PIN for the staff account belonging to the currently
  authenticated invitee.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After an invited user finishes setting their password during
  invite acceptance, the system MUST check whether that user's staff account
  already has a PIN.
- **FR-002**: When the invitee's staff account has no PIN, the system MUST
  show a "Set your PIN" step before the device staff picker.
- **FR-003**: When the invitee's staff account already has a PIN, the system
  MUST skip the PIN step and continue directly to the device staff picker.
- **FR-004**: The PIN step MUST let the invitee choose their own PIN and MUST
  validate it against the salon's standard PIN shape (a 4-digit numeric PIN),
  reusing the existing PIN-shape validation rather than introducing a new one.
- **FR-005**: When the invitee submits a PIN that fails validation, the system
  MUST reject it with a clear message and keep the invitee on the PIN step to
  retry.
- **FR-006**: When the invitee submits a valid PIN, the system MUST save it to
  the staff account belonging to the currently authenticated invitee, and to
  no other account.
- **FR-007**: The PIN step MUST only be reachable by the authenticated
  invitee; it MUST NOT be usable to set or change a PIN for any other staff
  member.
- **FR-008**: After the PIN is saved, the system MUST continue the invitee to
  the device staff picker.
- **FR-009**: Once the invitee has saved a PIN, they MUST appear in the device
  staff picker roster and be able to pin in with that PIN.
- **FR-010**: The system MUST store the PIN only in a non-recoverable hashed
  form, reusing the existing PIN-hashing primitive; the raw PIN MUST NOT be
  persisted in plain text.
- **FR-011**: The system MUST NOT log or audit the raw PIN value. Only a
  boolean witness that a PIN was set MUST be recorded, consistent with the
  existing onboarding and staff PIN actions.
- **FR-012**: The system MUST record an audit-log entry when an invitee
  self-sets their PIN.
- **FR-013**: The PIN step MUST apply only to the invite-acceptance flow. A
  forgot-password / recovery password reset MUST continue directly to the
  device staff picker with no PIN step.
- **FR-014**: The owner's existing ability to set or reset an invitee's PIN
  manually (Settings → Staff, Settings → Onboarding) MUST remain available as
  a fallback for invitees who do not complete the PIN step.

### Key Entities *(include if data involved)*

- **Staff account**: the salon record for an invited person. Has a name,
  role, active/state status, and an optional PIN (stored hashed). A staff
  account with no PIN cannot appear on the device staff picker.
- **Invite**: a pending invitation to join the salon. Created either with no
  PIN (quick mode) or with an owner-chosen PIN (thorough mode); this is what
  determines whether the invitee is shown the PIN step.
- **Audit-log entry**: a record of a security-relevant event. A new entry is
  written when an invitee self-sets their PIN, carrying only a boolean witness
  that a PIN was set — never the PIN value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of quick-mode (no-PIN) invitees who complete invite
  acceptance end the flow with a usable PIN and appear in the device staff
  picker, with no owner intervention required.
- **SC-002**: Thorough-mode (owner-set-PIN) invitees reach the device staff
  picker in the same number of steps as today — the PIN step adds zero extra
  steps for them.
- **SC-003**: A first-time invitee can complete the PIN step in under 30
  seconds.
- **SC-004**: The number of new invitees who finish invite acceptance "active"
  but absent from the device staff picker drops to zero for invitees who
  complete the flow.
- **SC-005**: The raw PIN value never appears in any application log or
  audit-log entry; audit entries for a self-set PIN carry only a boolean
  witness.
- **SC-006**: Forgot-password recovery resets continue to land directly on the
  device staff picker in 100% of cases, with no PIN step shown.

## Assumptions

- The PIN shape is a 4-digit numeric PIN, matching the salon's existing
  PIN-shape rule used when an owner sets a PIN today; this feature does not
  change the PIN shape.
- The PIN step asks the invitee to enter the PIN twice (entry plus
  confirmation) to guard against typos, consistent with the existing
  change-PIN keypad pattern.
- The PIN step is mandatory for a no-PIN invitee to complete onboarding —
  there is no "skip" affordance — but an invitee can still abandon the flow by
  closing the browser, in which case the owner-set-PIN fallback applies.
- PINs are not required to be unique across staff members; the device verifies
  an entered PIN against the staff member already selected on the picker, so
  collisions do not need to be prevented.
- The PIN step runs while the invitee's just-authenticated session (created
  when they set their password) is still valid; it does not introduce a new
  authentication step.
- The exact surface for the PIN step (a dedicated route versus a second step
  inside the invite flow) is an implementation decision and is intentionally
  not specified here.
- Out of scope: revisiting the green "Active" status indicator in Settings →
  Staff, which currently over-promises for a no-PIN invitee. This is noted in
  issue #122 as a possible follow-up.
