# Feature Specification: Select staff redesign — avatar grid + modal keypad

**Feature Branch**: `044-select-staff-redesign`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "We are redesigning the select staff screen to be more user friendly. Fetch this design file, read its readme, and implement the relevant aspects of the design. I want to go with option D · Avatar grid + modal keypad in that prototype. Make sure to copy this option D design prototype over into our design system prototypes folder as well."

## Overview

After a device signs in with an email and password, staff identify themselves on the `/select-staff` screen and unlock the app with a personal 4-digit PIN. Today that screen renders a grid of large tiles inside a narrow form panel, with the keypad stacked below. It works for 3 staff. At a realistic salon roster of 18–20 it breaks down: staff scroll to find their tile, and once they do, the keypad is off-screen.

This feature rebuilds `/select-staff` to **Option D — Avatar grid + modal keypad** from the "Select Staff Redesign" design exploration: a full-viewport grid of compact avatar tiles, a search field to narrow a long roster, and a focused modal keypad that opens centered when a staff member taps their avatar. The Option D prototype is also vendored into the design system so future UI work can reference the canonical layout.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick your avatar and sign in (Priority: P1)

A staff member walks up to the salon's device, sees the whole roster laid out as a grid of avatar tiles, taps their own tile, enters their 4-digit PIN on the keypad that opens in a centered modal, and lands in the app.

**Why this priority**: This is the core sign-in journey. Without it, no one can get past the PIN gate. It is the minimum viable redesign — it replaces the scrolling tile-grid-plus-stacked-keypad with a layout that fits a full roster and keeps the keypad one tap away.

**Independent Test**: Load `/select-staff` with a multi-person roster, tap any staff tile, confirm a modal opens with that person's avatar and a keypad, enter the correct PIN, and confirm the staff member is signed in and taken to their destination.

**Acceptance Scenarios**:

1. **Given** a device session is active and the roster has 18 staff, **When** the screen loads, **Then** every staff member appears as a compact avatar tile in a grid that uses the full width of the screen, with no narrow form panel.
2. **Given** the roster is displayed, **When** a staff member taps their avatar tile, **Then** a modal opens centered over a dimmed backdrop showing that person's avatar, name, role, and a numeric keypad.
3. **Given** the keypad modal is open, **When** the staff member enters the four digits of their correct PIN, **Then** verification runs automatically on the fourth digit and the staff member is signed in and taken to their destination.
4. **Given** the keypad modal is open, **When** each digit is entered, **Then** a 4-position indicator fills one position per digit without ever displaying the typed numbers.

---

### User Story 2 - Find yourself fast in a large roster (Priority: P2)

A staff member at a busy salon with 20 colleagues types the first few letters of their name to shrink the grid down to themselves (or a small set), instead of scanning every tile.

**Why this priority**: Search is what makes the redesign scale. The grid alone is better than today, but at 20+ staff a returning user still benefits from typing two or three letters rather than scanning. It builds on US1 but the sign-in flow works without it.

**Independent Test**: Load `/select-staff` with a large roster, type part of a staff member's name into the search field, and confirm the grid narrows to matching tiles as each character is typed.

**Acceptance Scenarios**:

1. **Given** the full roster is displayed, **When** the staff member types text into the search field, **Then** the grid updates as they type to show only staff whose name matches the typed text, with no separate submit action.
2. **Given** a search has narrowed the grid, **When** the staff member taps a matching tile, **Then** the sign-in modal opens exactly as it does from the unfiltered grid.
3. **Given** the staff member has typed text that matches no one, **When** the grid updates, **Then** the screen shows a clear empty-result message that names the search text.
4. **Given** a search is in progress, **When** the staff member clears the search field, **Then** the full roster reappears.

---

### User Story 3 - Recover from a mistake without losing your place (Priority: P3)

A staff member fat-fingers their PIN, sees the entry clear with an error cue, and tries again in the same modal — or realizes they tapped the wrong tile and dismisses the modal to pick again.

**Why this priority**: Error and cancel paths make the redesign trustworthy day to day. The happy path (US1) is usable without polished recovery, but mistyped PINs and wrong taps are routine and must not force a restart.

**Independent Test**: Open the keypad modal, enter an incorrect PIN, confirm the modal stays open with an error cue and cleared entry, then enter the correct PIN and confirm sign-in. Separately, open the modal and dismiss it without signing in.

**Acceptance Scenarios**:

1. **Given** the keypad modal is open, **When** the staff member enters an incorrect 4-digit PIN, **Then** the modal stays open, the PIN indicator shows an error state, the entered digits clear, and the staff member can retry immediately without reopening the modal.
2. **Given** the keypad modal is open, **When** the staff member taps the dimmed backdrop, the close control, or presses escape, **Then** the modal closes and the roster grid is shown again with no one signed in.
3. **Given** the staff member dismisses the modal and taps a different tile, **When** the new modal opens, **Then** PIN entry starts fresh with no digits carried over from the previous tile.
4. **Given** a staff member whose PIN was reset by an owner, **When** the roster is displayed, **Then** that staff member's tile shows the admin-PIN-reset notice with its explanatory message, as it does today.

---

### Edge Cases

- **Empty roster**: When no staff are configured with a PIN, the screen shows the existing "no staff configured" guidance and a sign-out action — not an empty grid.
- **Very large roster**: When the roster has more tiles than fit on screen, the grid scrolls within the screen while the header and search field stay visible; the modal still opens centered.
- **Long names**: A staff member with a long display name has their name truncated on the tile rather than breaking the grid layout.
- **Dismiss mid-entry**: Closing the modal after entering one to three digits records no attempt — only a completed 4-digit submission counts as a sign-in attempt.
- **Wrong tile**: Tapping the wrong avatar is recoverable in one action (dismiss) and costs no failed attempt.
- **Expired device session**: If the device session is missing or expired when the screen loads or a PIN is submitted, the user is sent back to the login screen.
- **Page refresh during entry**: Refreshing the page while the modal is open returns the user to the roster grid with the modal closed.
- **Physical keyboard**: A device with an attached keyboard can drive PIN entry with number keys, backspace, and a cancel/clear key, not only by tapping.

## Requirements *(mandatory)*

### Functional Requirements

#### Layout and roster display

- **FR-001**: The `/select-staff` screen MUST present every eligible staff member as a compact avatar tile arranged in a grid.
- **FR-002**: Each avatar tile MUST show the staff member's initials avatar in their assigned color, their display name, and their role label.
- **FR-003**: The screen MUST use the full device viewport for the roster instead of the narrow sign-in form panel, so the roster and keypad never compete for the same space.
- **FR-004**: Staff tiles MUST be ordered by role (owner, then manager, then technician, then front desk) and alphabetically by display name within each role.
- **FR-005**: The roster MUST include only staff who are active and have a PIN set; staff who are inactive or have no PIN MUST NOT appear.
- **FR-006**: When the roster has more tiles than fit on screen, the grid MUST scroll within the screen while the screen header and search field remain visible.
- **FR-007**: The screen MUST keep a sign-out control that ends the device session.

#### Search

- **FR-008**: The screen MUST provide a search field that filters the avatar grid to staff whose display name matches the typed text, case-insensitively and on partial matches.
- **FR-009**: Search results MUST update as the user types, with no separate submit action.
- **FR-010**: When no staff match the typed text, the screen MUST show a clear empty-result message that names the search text.

#### Sign-in via modal keypad

- **FR-011**: Tapping a staff avatar tile MUST open a focused modal, centered over a dimmed backdrop, showing that staff member's avatar, display name, role, and a numeric keypad.
- **FR-012**: The modal MUST display a 4-position PIN indicator that fills one position per entered digit and MUST never reveal the typed digits.
- **FR-013**: The keypad MUST provide digits 0–9, a clear control, and a backspace control.
- **FR-014**: PIN entry MUST also accept a physical keyboard — number keys to enter digits, backspace to delete, and a key to clear or cancel — for devices with an attached keyboard.
- **FR-015**: When the fourth digit is entered, the system MUST verify the PIN automatically, without a separate submit action.
- **FR-016**: On a correct PIN, the system MUST sign the staff member in and take them to their intended destination.
- **FR-017**: On an incorrect PIN, the modal MUST stay open, show an error state on the PIN indicator, clear the entered digits, and allow an immediate retry without reopening the modal.
- **FR-018**: The user MUST be able to dismiss the modal — by tapping the dimmed backdrop, a close control, or pressing escape — which returns them to the roster grid with no one signed in.
- **FR-019**: Selecting a different staff member after dismissing the modal MUST start PIN entry fresh, with no digits carried over from a previous selection.

#### Preserved behavior

- **FR-020**: Every completed PIN attempt MUST continue to be recorded for audit — both a successful sign-in and a failed attempt — exactly as it is today.
- **FR-021**: The screen MUST continue to show the admin-PIN-reset notice for any staff member whose PIN was reset by an owner, carrying the same explanatory message, and that notice MUST clear after a successful sign-in as it does today.
- **FR-022**: When no staff are configured with a PIN, the screen MUST show the existing "no staff configured" guidance instead of an empty grid.
- **FR-023**: If the device session is missing or expired, the screen MUST send the user back to the login screen, as it does today.
- **FR-024**: The redesign MUST NOT change the PIN length, PIN verification rules, the absence of throttling or lockout, or the operator session that a successful sign-in establishes.
- **FR-025**: After sign-in, the staff member MUST be taken to the same destination the current flow would send them to (their requested page, or the default landing surface).

#### Design system and prototype

- **FR-026**: Every visual value on the screen — color, spacing, radius, shadow, and type — MUST trace to a Lacquer design-system token; no hardcoded values.
- **FR-027**: The screen MUST adapt the Option D layout from the design exploration rather than redrawing it, matching its avatar grid, search placement, and modal keypad.
- **FR-028**: The Option D prototype bundle MUST be vendored into `design-system/prototypes/` so future UI work can reference the canonical layout.

### Key Entities *(include if feature involves data)*

- **Staff roster entry**: A staff member eligible to sign in on this device — has a display name, a role, an assigned avatar color, a 4-digit PIN, an active flag, and an optional admin-PIN-reset notice. This feature displays and filters existing staff records; it introduces no new data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A returning staff member can locate their own tile and open the keypad in under 5 seconds with 20 staff loaded on the device.
- **SC-002**: The keypad is always one tap away from any point in the roster — it is never pushed off-screen by the length of the roster.
- **SC-003**: 100% of the staff roster is reachable without horizontal scrolling on the salon's tablet in landscape orientation.
- **SC-004**: Searching narrows a 20-person roster to the matching subset immediately as each character is typed, with no perceptible delay and no submit step.
- **SC-005**: A returning staff member completes sign-in end to end — open tile, enter 4-digit PIN, land on destination — in under 10 seconds.
- **SC-006**: After a wrong PIN, the staff member can retry in the same modal without re-selecting their tile in 100% of cases.
- **SC-007**: Every completed sign-in attempt, successful or failed, produces exactly one audit record — matching pre-redesign behavior with zero regression.

## Assumptions

- The primary device is the salon's tablet used in landscape orientation; the layout is optimized for tablet landscape and degrades gracefully at other widths.
- The roster source, the 4-digit PIN length, PIN verification, audit logging, the operator session, and the "no throttling or lockout" policy are all reused unchanged from the current sign-in flow.
- The brand/marketing side panel currently shared across the `(auth)` screens is intentionally dropped for `/select-staff` only — this is an explicit recommendation in the design file, which identifies the narrow form panel as the root cause of the scrolling problem. `/login` and `/reset-password` keep the side panel.
- On a correct PIN the user is navigated to their destination immediately. The "Signed in as …" toast shown in the prototype is a prototype-only stand-in for a surface that cannot navigate; it is not required in production.
- The modal's open/closed state is transient: refreshing the page closes the modal and returns to the grid. This replaces the current behavior where the selected tile is held in a URL parameter.
- Search matches staff display names only, not role labels — matching the Option D prototype.
- The 18-staff figure in the prototype is illustrative; the design must hold for any realistic salon roster (roughly up to 25 staff).

## Dependencies

- Reuses the existing staff records, PIN verification, audit logging, and operator-session mechanism — no schema or backend policy changes.
- Depends on the Lacquer design system tokens and on the Option D prototype vendored under `design-system/prototypes/select-staff/`.
