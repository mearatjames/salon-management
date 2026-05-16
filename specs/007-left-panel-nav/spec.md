# Feature Specification: Studio Left Navigation Panel

**Feature Branch**: `007-left-panel-nav`

**Created**: 2026-05-15

**Status**: Draft

**Input**: User description: "I want to build out the left panel menu item like we have in the one we have in our prototype https://claude.ai/design/p/019e0124-88cc-7ec5-b59a-055dd1301a03?file=prototypes%2Fuser-management%2FUser+Management.html. I believe we already brought this prototype over into our repo."

## Overview

Tang Nails Studio currently has only a top bar. Every studio surface (Dashboard, Calendar, Clients, Checkout, Walk-in, End of Day, Settings) has to be reached by URL or by drilling out of the page that opened it. The Lacquer prototype at `design-system/prototypes/user-management/` defines the canonical app shell: a persistent **left navigation panel** with grouped destinations, a collapse/expand control, and an operator chip pinned to the bottom. This feature brings that panel into the live app so the staff at the device always knows where they are and can move between studio surfaces in one click.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate between studio surfaces from any page (Priority: P1)

A salon technician finishes booking an appointment on the Calendar and wants to start a checkout. Today she has to know the URL or backtrack through the dashboard. With the left panel, every studio page renders a sidebar that lists Schedule, Clients, Services, Checkout, Walk-in, Dashboard, End of Day Cash, Day Report, and Settings — each one clickable.

**Why this priority**: This is the primary value of the panel. Without persistent navigation the studio is unusable for day-to-day workflow. Every other behaviour (collapse, active state, operator chip) is polish on top of this.

**Independent Test**: Sign in as any staff role, land on any studio page (e.g., Dashboard). Confirm the left panel is visible. Click each Workspace item that targets an existing route (Schedule, Clients, Checkout, Walk-in) and each Operations item (End of Day Cash, Settings, Dashboard); confirm the URL changes and the matching page renders. Confirm items whose routes do not yet exist (Services, Day Report) are shown but communicate that they are not yet available (disabled or "coming soon" tooltip), so the panel is consistent with the prototype's information architecture.

**Acceptance Scenarios**:

1. **Given** a signed-in operator on `/dashboard`, **When** the page renders, **Then** the left panel is visible with the Workspace group (Schedule, Clients, Services, Checkout, Walk-in) and the Operations group (End of Day Cash, Day Report, Settings), plus a Dashboard item above the groups, in the order shown in the prototype.
2. **Given** the left panel is visible, **When** the operator clicks "Schedule", **Then** the browser navigates to `/calendar` and that page renders.
3. **Given** the left panel is visible, **When** the operator clicks "Checkout", **Then** the browser navigates to `/checkout` and that page renders.
4. **Given** the left panel is visible, **When** the operator clicks "Settings", **Then** the browser navigates to `/settings` and that page renders.
5. **Given** the left panel is visible, **When** the operator clicks an item whose route does not yet exist ("Services" or "Day Report"), **Then** the click is a no-op and the item is visually indicated as not yet available.
6. **Given** the operator is on any studio page that previously rendered the auth-degraded fallback in the top bar, **When** the page renders, **Then** the left panel is still rendered (the panel must not depend on a successful operator session — it degrades gracefully like the top bar).

---

### User Story 2 - Show where I am right now (Priority: P2)

The operator switches between Calendar and Checkout many times in a shift. She wants to glance at the panel and immediately know which surface she's on without reading the URL or scanning the page heading.

**Why this priority**: Active-state highlighting prevents misclicks and orients new staff quickly. It is small but high-leverage. It cannot ship before P1 (there is nothing to highlight without nav) but should ship in the same release.

**Independent Test**: Visit each studio route in turn and confirm exactly one panel item is rendered with the active visual treatment, and that the item rendered active matches the current URL.

**Acceptance Scenarios**:

1. **Given** the operator is on `/calendar`, **When** the page renders, **Then** the "Schedule" item shows the active visual treatment and no other item does.
2. **Given** the operator is on `/settings/staff` (a nested settings page), **When** the page renders, **Then** the "Settings" item is shown as active (active matching is by top-level section, not exact path).
3. **Given** the active item, **When** an operator hovers a non-active item, **Then** the hover treatment is distinct from the active treatment so the two states are never confused.

---

### User Story 3 - Reclaim horizontal space when I need it (Priority: P2)

A technician on a 13" laptop is on the Checkout page, which is dense with line items. She wants more horizontal room. She clicks the collapse control at the top of the panel; the panel shrinks to an icons-only rail. Her choice is remembered for that device so she doesn't have to re-collapse it every time she opens the studio.

**Why this priority**: Collapse is the second-most requested behaviour after navigation itself (per the prototype's prominent toggle button and `localStorage` persistence). It directly affects whether the panel is acceptable on smaller screens.

**Independent Test**: On a studio page, click the collapse toggle. Confirm the panel shrinks to a narrow icon rail and the main content grows to fill the reclaimed space. Reload the page. Confirm the panel is still collapsed. Click the toggle again to expand; reload; confirm the panel is expanded.

**Acceptance Scenarios**:

1. **Given** the panel is expanded, **When** the operator clicks the collapse toggle, **Then** the panel shrinks to a narrow rail showing only icons, the main content area expands to fill the reclaimed space, and the change animates smoothly (no layout jump).
2. **Given** the panel is collapsed, **When** the operator hovers any nav item, **Then** the label appears as a tooltip on that item.
3. **Given** the operator has collapsed (or expanded) the panel, **When** she navigates to another studio page or reloads, **Then** the panel renders in the same state she left it in.
4. **Given** the operator has collapsed the panel, **When** she clicks the toggle again, **Then** the panel expands and the labels return.

---

### User Story 4 - See who's signed in as operator (Priority: P3)

The operator chip in the panel footer shows the staff member currently acting at the device (avatar, name, role). This mirrors what the top-bar operator chip shows but keeps the identity visible even when attention is on the bottom of a long page.

**Why this priority**: It is a polish item — the same information is already in the top-bar chip via `OperatorMenu`. Worth including because the prototype renders it and it costs almost nothing once the panel exists. Should not block P1/P2.

**Independent Test**: Sign in with a known staff PIN, open any studio page, confirm the panel footer shows that staff member's initials in their color token, their display name, and their role label ("Owner", "Manager", "Tech", "Front desk").

**Acceptance Scenarios**:

1. **Given** an operator is acting at the device, **When** any studio page renders, **Then** the panel footer shows the operator's avatar tile (initials in their color token), display name, and role label.
2. **Given** the panel is collapsed, **When** any studio page renders, **Then** the footer shows only the avatar tile, centered, and hovering it reveals the name and role as a tooltip.
3. **Given** the session is in the auth-degraded fallback state, **When** the page renders, **Then** the footer renders a neutral placeholder instead of crashing or showing stale data.

---

### Edge Cases

- The panel must render before authentication resolves (or in the degraded fallback) so the layout never flashes between "no sidebar → sidebar." It is part of the studio shell, not gated on session data.
- On very narrow viewports the panel should still be usable; for v1 it can remain at the same widths the prototype defines (224px expanded / 56px collapsed) and the main content scrolls if needed. A separate mobile breakpoint is out of scope.
- Items that route into nested paths (e.g., Settings has `/settings/general`, `/settings/staff`, `/settings/notifications`, `/settings/billing`) must show the parent ("Settings") as active for any path under that section.
- The collapse preference is per-device (localStorage). Clearing site data resets it. That matches the prototype.
- When two studio surfaces both deserve active state (theoretically impossible if matching is by top-level section, but worth noting), only one item must render active to avoid misleading the operator.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST render a persistent left navigation panel on every page inside the `(studio)` route group (Dashboard, Calendar, Clients, Checkout, Walk-in, End of Day, Settings and any nested children).
- **FR-002**: The panel MUST contain, in this order: a header row with a collapse/expand toggle; a "Dashboard" item; a "Workspace" section containing Schedule, Clients, Services, Checkout, Walk-in; an "Operations" section containing End of Day Cash, Day Report, Settings; a spacer; and an operator chip footer.
- **FR-003**: Each navigation item MUST display the Lucide icon and label from the prototype (Calendar, Users, Sparkles, Dollar, Footprints, Cash, FileBar, Settings, Home).
- **FR-004**: Items whose target route exists MUST navigate to that route on click. The current mapping is: Dashboard→`/dashboard`, Schedule→`/calendar`, Clients→`/clients`, Checkout→`/checkout`, Walk-in→`/walkin`, End of Day Cash→`/end-of-day`, Settings→`/settings`.
- **FR-005**: Items whose target route does not yet exist (Services, Day Report) MUST render in a visually de-emphasised state, MUST NOT navigate on click, and MUST communicate their unavailable state via a tooltip or equivalent affordance.
- **FR-006**: The panel MUST highlight exactly one item as active based on the current URL, matched by top-level section (so `/settings/anything` highlights Settings).
- **FR-007**: The panel MUST provide a collapse/expand toggle in its header that switches the panel between expanded (full labels visible) and collapsed (icon-only rail) layouts.
- **FR-008**: When collapsed, nav-item labels MUST be hidden and the full label MUST be available as a native tooltip on hover of each item.
- **FR-009**: The collapsed/expanded preference MUST persist across page navigations and full reloads on the same device.
- **FR-010**: The panel footer MUST show the current operator's avatar tile (initials rendered in their color token), display name, and role label, sourced from the same session data the existing top-bar operator chip uses.
- **FR-011**: When the studio session is in the degraded fallback state, the panel MUST still render; the operator chip MUST render a neutral placeholder instead of crashing.
- **FR-012**: All visual values (colors, spacing, radii, type, shadows, transitions) MUST come from the Lacquer design tokens defined in `styles/tokens.css`; no raw hex codes or off-scale spacing.
- **FR-013**: The panel layout, item structure, and visual treatment MUST match `design-system/prototypes/user-management/` (the `UMSidebar` component and its `user-management.css` rules). Side-by-side comparison with the prototype is the acceptance bar.
- **FR-014**: The collapse/expand transition MUST animate using the Lacquer motion language (≤220ms, ease-out); no spring or bounce.
- **FR-015**: Active, hover, and focus visual treatments MUST be visually distinct from each other so an operator can tell at a glance which item the cursor is over versus which is current.

### Key Entities

This feature has no new persistent data. It consumes existing entities:

- **Studio Session / Operator**: The acting staff record returned by `getStudioSessionOrDegraded()` (`display_name`, `role`, `color_token`). Used to render the footer operator chip.
- **Collapse Preference**: Per-device boolean stored in browser localStorage. Not persisted to the database.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any studio page, an operator can reach any other top-level studio surface that has an existing route in one click via the left panel.
- **SC-002**: On every studio page, the panel item corresponding to the current top-level section is the only item rendered with the active visual treatment.
- **SC-003**: After the operator collapses (or expands) the panel, the same state is shown on the next page they visit and after a full reload on the same device, on at least 100% of attempts.
- **SC-004**: Side-by-side comparison with `design-system/prototypes/user-management/User Management.html` (open in a browser) shows that the panel matches the prototype on icon set, label text, group order, expanded width (224px), collapsed width (56px), spacing scale, colors, and active/hover treatments.
- **SC-005**: The studio shell renders the panel on every `(studio)` page in 100% of sessions, including when the session is in the auth-degraded fallback state.
- **SC-006**: 100% of computed visual values in the panel resolve from Lacquer tokens (verified by inspection — no raw hex codes or off-scale spacing in panel source).

## Assumptions

- The route mapping above (Schedule→`/calendar`, Walk-in→`/walkin`, End of Day Cash→`/end-of-day`, etc.) reflects the routes that currently exist under `app/(studio)/`. Items in the prototype with no corresponding route in v1 (Services, Day Report) are rendered as visible-but-disabled placeholders so the IA matches the prototype.
- The dynamic "248" client count badge shown next to "Clients" in the prototype is **not** wired to live data in v1 (no data fetching required for this feature). It is treated as a prototype-only flourish and omitted, to keep this feature scoped to the navigation shell.
- The current top-bar operator chip (`OperatorMenu` + `OperatorChip` in `app/(studio)/layout.tsx`) stays in place; the panel footer's operator chip is additive and matches the prototype, not a replacement.
- "Active" matching is by top-level section (first URL segment under `(studio)`), not exact path. Nested settings pages all highlight "Settings."
- The panel renders inside the studio layout shell, alongside the existing top bar; this feature does not change the top bar.
- Mobile/small-viewport behaviour beyond what the prototype already provides (panel at fixed 224/56px widths) is out of scope for v1.
- The Lacquer prototype at `design-system/prototypes/user-management/` is authoritative for visual and structural detail. Where this spec and the prototype disagree, the prototype wins.
