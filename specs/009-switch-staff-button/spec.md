# Feature Specification: Switch Staff — Standalone Top‑Nav Button

**Feature Branch**: `009-switch-staff-button`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Move the switch staff button from the dropdown menu item to be its own button see the design mock up in https://api.anthropic.com/v1/design/h/LFbjq-EYCp7mAyhnCyRTyA?open_file=Switch+Staff+Nav.html refer to the B. labled button option one"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One‑click switch staff from the top nav (Priority: P1)

A technician working the front desk frequently hands the device to a coworker who needs to start their own shift. Today the technician has to click the operator chip (their own name pill in the top right of the studio), wait for a dropdown to open, then click "Switch staff." After this change, "Switch staff" appears as its own button in the top navigation bar, immediately to the left of the operator chip, so the same outcome takes one click instead of two.

**Why this priority**: Switching staff is a core, high‑frequency action during a working shift — moving it from a hidden menu item to a first‑class top‑nav button is the entire purpose of the feature. Without it, the rest of the change has no value.

**Independent Test**: Sign into the studio, observe a labeled "Switch staff" button in the top navigation bar (left of the operator chip), click it once, and confirm the same switch‑staff flow that previously launched from the dropdown is now reached in a single click.

**Acceptance Scenarios**:

1. **Given** the studio is loaded and a staff member is signed in, **When** the user looks at the top navigation bar, **Then** a button labeled "Switch staff" with a swap icon is visible to the left of the operator chip, separated from the chip by a thin vertical divider.
2. **Given** the "Switch staff" button is visible, **When** the user clicks it once, **Then** the same switch‑staff flow that was previously reachable from the operator chip's dropdown is triggered (no intermediate menu opens).
3. **Given** the operator chip's dropdown is opened after this change, **When** the user inspects its items, **Then** only "Sign out" is listed — the "Switch staff" entry has been removed.

---

### User Story 2 — Discoverability for new staff (Priority: P2)

A newly trained technician who has never used the studio before should be able to find how to hand the device to the next person without coaching. A persistent, labeled top‑nav button makes the action self‑evident, whereas a dropdown hides it behind the operator chip.

**Why this priority**: This is the design rationale captured under "Option B — labeled button" in the source mockup ("Most discoverable. Label is always visible."). It is a real benefit but secondary to the core one‑click improvement in US1.

**Independent Test**: Show the top navigation bar to a person who has not been told where "Switch staff" lives. Confirm they can identify and successfully invoke the action without opening any menu.

**Acceptance Scenarios**:

1. **Given** a user has never used the studio before, **When** they are asked to switch to a different staff member, **Then** they can locate and click the "Switch staff" button in the top nav without opening the operator chip dropdown.
2. **Given** the button is rendered on any studio page, **When** the user views it at default desktop width, **Then** the icon and the word "Switch staff" are both visible (not collapsed to an icon‑only state).

---

### Edge Cases

- **Degraded session** (the studio shell renders a placeholder operator chip because the staff session could not be loaded): the "Switch staff" button MUST still be rendered and clickable so the user can recover by switching to a working session.
- **Narrow viewport**: at narrow widths the top nav must continue to fit the brand, the "Switch staff" button, and the operator chip without overlap or text wrapping. If horizontal space is genuinely insufficient, the operator chip's secondary detail (role pill) is the first element that may compress — the "Switch staff" button's label and icon remain visible.
- **Rapid double‑click** on the button must not trigger the switch flow twice; the second click while a switch is already in progress is ignored.
- **Keyboard‑only navigation**: the button MUST be reachable in tab order, must show a visible focus state, and must activate on Enter or Space — equivalent to the previous dropdown item.
- **Switch flow failure** (e.g., the back‑end rejects the switch): the user remains on the current page with their current identity intact and is informed of the failure; the button is re‑enabled so a retry is possible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The studio top navigation bar MUST render a standalone, always‑visible "Switch staff" button to the left of the operator chip, separated from the chip by a thin vertical divider.
- **FR-002**: The button MUST display both a swap/repeat icon and the text label "Switch staff" (sentence case), matching the "Option B — labeled button" variant in the Switch Staff Nav mockup.
- **FR-003**: Activating the button (mouse click, Enter, or Space) MUST invoke the existing switch‑staff flow — the same outcome users previously reached by opening the operator chip and selecting "Switch staff."
- **FR-004**: The "Switch staff" entry MUST be removed from the operator chip's dropdown; after this change, the dropdown contains only "Sign out."
- **FR-005**: The button MUST be keyboard‑focusable, MUST appear in a sensible tab order relative to other top‑nav controls, and MUST present a visible focus indicator consistent with other interactive controls in the studio.
- **FR-006**: The button MUST be available on every studio page that shows the top navigation bar, including when the session is in its degraded placeholder state.
- **FR-007**: While a switch‑staff action is in progress, the button MUST be disabled (or otherwise prevent re‑entry) so a second activation does not start a duplicate switch.
- **FR-008**: If the switch‑staff action fails, the user MUST be informed and the button MUST become re‑activatable so they can retry.
- **FR-009**: The button's visual treatment (height, border, radius, spacing, hover and focus colors, icon style, label typography) MUST resolve to existing Lacquer design‑system tokens — no new colors, font weights, off‑scale spacing, or one‑off radii are introduced.

### Key Entities

*Not applicable.* This change is a navigation/UI refinement; it introduces no new persisted data, no new server contracts, and no new permissions. The underlying switch‑staff action and its data model are unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Switching staff from a logged‑in state takes exactly one click from any studio page (previously two: open chip dropdown, then select item).
- **SC-002**: The "Switch staff" affordance is visible in the top nav at all times when a staff session (or its degraded placeholder) is present — no hover, focus, or menu‑open is required to reveal it.
- **SC-003**: 100% of operator‑chip dropdowns after the change contain only "Sign out" (zero occurrences of a "Switch staff" item in the dropdown).
- **SC-004**: In an unmoderated usability check, a user who has never seen the studio can locate and use the switch‑staff action in under 10 seconds without opening any other menu.
- **SC-005**: No regression in the existing switch‑staff outcome: the post‑click result (which staff is signed in, what the user lands on) is identical to today's behavior.

## Assumptions

- The existing switch‑staff action (what happens after the button is clicked) is correct and out of scope for this change. This feature only relocates the entry point from a dropdown item to a standalone top‑nav button.
- The operator chip itself is retained; only the contents of its dropdown change ("Switch staff" removed, "Sign out" preserved).
- Desktop is the primary surface for the studio top nav; there is no separate mobile top‑nav variant to keep in sync.
- The icon for the new button is the same swap/repeat glyph already used for "Switch staff" inside the dropdown today, so visual recognition transfers from the prior treatment.
- "Sign out" remains the right home for the chip's dropdown because it is a low‑frequency, end‑of‑shift action, while "Switch staff" is high‑frequency throughout the day — the rationale recorded in the design mockup's "Option B" annotation.
- This change does not affect role‑based permissions: any user previously allowed to switch staff from the dropdown is allowed to switch staff from the new button, and vice versa.
