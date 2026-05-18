# Feature Specification: Per-staff payout exemptions + Settings → Staff redesign

**Feature Branch**: `023-staff-payout-exemptions`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Per-staff payout exemptions + Settings → Staff UI redesign. Phase 2b of the deductions roadmap. Builds on 021-services-deductions (card fee + supply amount on services) and 022-supply-types-catalog (supply types as first-class catalog rows with stable uuids). Adds per-staff overrides for both card fee and supply deductions, and redesigns Settings → Staff to match the latest Lacquer prototype (sectioned edit panel, danger zone, filter chips, mobile sheet, add-staff wizard pills). Same capture-and-display posture as 021 — values persist but checkout-time application is still Phase 3 (out of scope). Design source of truth: design-system/Staff Settings.html, design-system/staff-components.jsx (PayDeductionsSection lines 467–691), design-system/prototypes/services/services-data.jsx (useSupplyTypes contract). Migration adds card_fee_exempt boolean, supply_mode text ('apply'/'partial'/'exempt'), supply_except uuid[] to staff. Authorization reuses canEditAnyField with self-edit of these three fields permitted as non-destructive. Audit log gains diff entries for the three new fields. Out of scope: checkout/receipt/payout wiring for the new exemptions (Phase 3), studio-level default-card-fee editor, other settings tabs' content, and remaining design-handoff resyncs."

This feature ships **per-staff payout exemptions** — a tech's card-fee deduction and supply-deduction can be turned off or scoped to a subset of supply types — and **redesigns the Settings → Staff surface** to match the latest Lacquer prototype. It is **Phase 2b of three** in the deductions roadmap. Phase 1 (021) captured the per-service amounts; Phase 2a (022) gave supply types stable identity; this phase captures the per-staff overrides; Phase 3 will apply all three at checkout, receipt, and payout time.

The redesign reshapes the Settings shell with a shared tab bar, replaces the show-inactive switch with status filter chips, restructures the staff row (status dot, selection bar, tinted PIN pill, tabular date), reorganizes the edit panel into Identity / Access / Pay & deductions / Danger-zone sections, and turns the add-staff flow into a right-side wizard sheet. On mobile the panel becomes a bottom sheet. The new functionality and the redesign ship together because the new **Pay & deductions** section is the panel's primary new affordance and the prototype is the only complete reference for how it integrates.

## Clarifications

### Session 2026-05-17

- Q: Can an operator self-edit their own `card_fee_exempt` / `supply_mode` / `supply_except` fields under the existing role gate? → A: Yes — allow self-edit. The three fields are payout-economics, not access/identity; they already require the same role gate as any staff edit, and blocking self-edit would create an awkward "you can edit everyone but yourself" gap with no security upside. Self-edit of role and active state remains restricted per 006.
- Q: How should the mobile bottom sheet and desktop wizard sheet behave for operators with `prefers-reduced-motion: reduce`? → A: Honor the OS signal with an instant transition (no slide animation). Full 300ms slide remains the default for everyone else. WCAG 2.3.3 / 2.2.2 expect user-triggered motion at this duration to be disablable; the OS-level signal is the standard switch.
- Q: How should the per-type picker render a supply type that is in the tech's exempted set but has been archived in the catalog? → A: Row stays visible, ticked, with an "Archived" muted pill, and the checkbox remains tickable so the operator can untick to clean up inline. Save persists the change normally and produces an audit row. The picker does not auto-prune archived ids on save.
- Q: When the operator switches the Supply deductions segmented control between modes without saving, what happens to the per-type ticks in the panel's draft state? → A: Preserve ticks. Switching the segmented control hides/shows the picker but never wipes ticks until save. Save with mode Apply all or Exempt wipes the persisted set regardless of the draft. The DB CHECK and save-time wipe are the safety backstops, so the panel can stay permissive.
- Q: Where does the "Standard $X deducted on card-paid services." subtitle resolve the amount from? → A: Resolve at render time from `formatDefaultCardFeeLabel()` in `lib/services/card-fee-default.ts` — the single source of truth for what the salon actually deducts at checkout. When Phase 2 ships the studio-level editor, the panel copy picks up the new value automatically with zero code churn here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Exempt a tech from the card-processing fee (Priority: P1)

The owner opens Settings → Staff, selects a tech in the roster, and finds a new **Pay & deductions** section in the edit panel. The first row is **Card processing fee** with a single toggle. While on, the row's subtitle reads "Standard $3 deducted on card-paid services." (the displayed amount tracks the studio's current standard). When the owner turns it off, the subtitle changes to "Exempt — card fee never deducted from payout." and the panel's header gains a small "Card-fee exempt" badge. Saving persists the choice. Re-opening the panel shows the toggle reflecting the saved state and the badge persists in the header.

**Why this priority**: This is the simplest of the new exemption capabilities (one boolean, no dependencies on supply-type identity) and the operator has been asking for it the longest — some senior techs negotiate fee-free payouts as part of their hire terms. Without it, every tech silently inherits the salon's standard card fee with no override path.

**Independent Test**: Seed two active staff. Open Tech A in the edit panel, turn Card processing fee off, save; confirm the subtitle flips to the exempt copy and a "Card-fee exempt" badge appears in the panel header. Reload the page, re-open the same tech; both states persist. Open Tech B (still on); confirm the subtitle still shows the standard amount and no exempt badge.

**Acceptance Scenarios**:

1. **Given** a staff member with default deduction settings (never edited), **When** the owner opens their edit panel, **Then** the Pay & deductions section renders with Card processing fee toggle **on**, its subtitle showing the studio's current standard fee amount, and no exempt badge in the panel header.
2. **Given** the Card processing fee toggle is on, **When** the owner taps it off and clicks Save changes, **Then** the row's subtitle flips to "Exempt — card fee never deducted from payout.", the panel header gains a "Card-fee exempt" status badge alongside the existing Active/Inactive badge, and the row in the roster gains no visible change (status pill stays the same — exemptions are a panel-only concern at the row level).
3. **Given** Card processing fee is exempt and saved, **When** the owner re-opens the same tech (or any tech) in a fresh tab/session, **Then** the saved exempt state is reflected accurately in the toggle and badge.
4. **Given** Card processing fee was just toggled off but not saved, **When** the owner navigates to a different tech in the roster, **Then** the standard "Discard changes?" confirm dialog appears (matching existing edit-panel behavior) so the unsaved exemption is not lost silently.
5. **Given** the studio's standard card fee changes in the future (when Phase 2 ships the global editor), **When** the panel re-renders, **Then** the subtitle reflects the new standard amount without code change to this surface (the copy resolves from a single source of truth).

---

### User Story 2 — Scope a tech's supply deductions to specific types or exempt entirely (Priority: P1)

In the same Pay & deductions section, below Card processing fee, the owner finds a **Supply deductions** row with a three-way segmented control: **Apply all** / **Some** / **Exempt**. Apply-all is the default and the row subtitle reads "All supply costs deducted from payout." Choosing **Exempt** flips the subtitle to "Exempt — no supply costs deducted." and shows no further inputs. Choosing **Some** reveals an indented per-type picker listing every active supply type from the salon's catalog (sourced from 022). Each row in the picker shows the type name, a usage hint ("3 services · typically $2 per ticket"), and a checkbox. Ticked types are the types this tech is exempted from. Saving persists the mode and the set of exempted type ids; re-opening reflects them accurately even after a different operator renames a supply type elsewhere (names resolve live from the catalog).

**Why this priority**: This is the headline capability of this phase. The free-text supply label from 021 never let the operator say "this tech doesn't get charged for chrome powder" — only "all supply deductions on or all off." Phase 2b makes the per-supply granularity the operator has been asking for possible, and the prerequisite (022's stable supply-type ids) is what lets it survive renames without manual cleanup.

**Independent Test**: Seed two active staff and three supply types ("Chrome powder", "GelX tips & gel", "Cat-eye gel") in the catalog with two services each. Open Tech A's edit panel, switch Supply deductions to **Some**, tick "Chrome powder", save. Re-open — the mode is still Some and Chrome powder is still ticked. Rename "Chrome powder" to "Chrome powders" on the Services edit-policy sheet. Re-open Tech A's panel — the ticked row now reads "Chrome powders" (same id, new name). Switch Tech A to **Exempt**, save; re-open and confirm the picker collapses and no rows remain visible.

**Acceptance Scenarios**:

1. **Given** a staff member with default deduction settings, **When** the owner opens their panel, **Then** the Supply deductions row is set to "Apply all" with the subtitle "All supply costs deducted from payout." and no per-type picker is rendered.
2. **Given** the owner selects "Some" in the segmented control, **When** the section re-renders, **Then** the per-type picker appears listing every **active** supply type from the catalog, one row per type, alphabetized by name; each row shows the type name, a usage hint, and an unchecked checkbox.
3. **Given** the per-type picker is visible, **When** the owner ticks one or more types and clicks Save changes, **Then** the saved record persists `supply_mode = 'partial'` and the set of ticked supply-type ids; the panel header gains a "Partial supply exemption" badge.
4. **Given** the owner selects "Exempt" in the segmented control, **When** Save changes is clicked, **Then** the saved record persists `supply_mode = 'exempt'` and the set of exempted type ids is reset to empty regardless of any prior ticks; the panel header gains a "Supply-exempt" badge and the per-type picker disappears.
5. **Given** Supply deductions is "Some" with at least one type ticked, **When** the operator switches the segmented control to "Apply all" without saving, **Then** the per-type picker collapses out of view but the ticks stay in the draft state — switching back to "Some" within the same edit session restores the prior selection. Saving from "Apply all" or "Exempt" wipes the persisted set regardless of the draft state.
6. **Given** the catalog contains zero active supply types AND the tech has no previously-exempted ids, **When** the owner selects "Some", **Then** the picker shows an empty-state row "No supply types defined yet. Add some on the Services page first." with a link to `/services`.
7. **Given** "Some" is selected and no types are ticked, **When** the panel renders, **Then** a hint line below the picker reads "No supply types selected — all costs will be deducted normally until you tick at least one." (warns the operator that "Some + empty" behaves like "Apply all").
8. **Given** a supply type the tech is exempted from is later archived in the catalog (022's archive flow), **When** the owner re-opens this tech's panel, **Then** the archived type still appears in the picker, ticked, with a muted "Archived" pill next to its name (so the exemption is visible and auditable). The archived row stays ticked across saves until the operator unticks it.

---

### User Story 3 — Read the staff's exemption posture at a glance (Priority: P1)

When **any** deduction exemption is in effect on the selected tech, the Pay & deductions section ends with a plain-language **summary sentence** that uses the tech's first name. The summary covers five posture combinations: card-only exempt, supply-only exempt (full), supply-only exempt (partial — names the excluded types), card + full supply exempt, and card + partial supply exempt. When no exemption is in effect (the default state for new staff), no summary is rendered (the section stays clean). Status badges in the panel header echo the posture (Card-fee exempt / Supply-exempt / Partial supply exemption / No deductions when all are at the default).

**Why this priority**: The exemption combinations are easy to misread by toggle alone — a tech could be "card exempt + supply Some with 0 ticks" which behaves identically to "card exempt + supply Apply all." The summary sentence is the operator's one-glance answer to "what's the net effect of these settings for this person?" Without it, the section is a stack of toggles with no synthesis.

**Independent Test**: Open a tech with no exemptions; confirm no summary renders and the only header badge is Active/Inactive. Toggle Card off, save; confirm a summary reading "Maya keeps the full payout on card-paid services — no card fee deducted." appears, and the header gains "Card-fee exempt." Switch Supply to Exempt, save; confirm the summary updates to "Maya keeps the full payout on every service — no card fee or supply costs deducted." Switch Supply back to Some and tick one type, save; confirm the summary names the type ("Maya keeps the full payout on card-paid services and is exempted from chrome-powder supply costs.").

**Acceptance Scenarios**:

1. **Given** a tech with no exemptions, **When** the panel renders, **Then** no summary sentence is rendered and the only header badge is Active or Inactive.
2. **Given** a tech with Card processing fee exempt and Supply at Apply all, **When** the panel renders, **Then** the summary reads "{FirstName} keeps the full payout on card-paid services — no card fee deducted." and the header includes a "Card-fee exempt" badge.
3. **Given** a tech with Card processing fee on and Supply set to Exempt, **When** the panel renders, **Then** the summary reads "{FirstName} keeps the full payout on every service — no supply costs deducted." and the header includes a "Supply-exempt" badge.
4. **Given** a tech with both Card processing fee exempt AND Supply set to Exempt, **When** the panel renders, **Then** the summary reads "{FirstName} keeps the full payout on every service — no card fee or supply costs deducted." and the header includes "Card-fee exempt" + "Supply-exempt" badges (or a combined "No deductions" badge).
5. **Given** a tech with Supply set to "Some" and one or more types ticked, **When** the panel renders, **Then** the summary names the exempted types in prose form ("…is exempted from chrome-powder and cat-eye-gel supply costs.") using current names resolved from the catalog; the header includes a "Partial supply exemption" badge.
6. **Given** the tech's role is "Front desk" AND no exemptions are in effect, **When** the panel renders, **Then** the Pay & deductions section ends with a muted hint: "Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets." (in lieu of the summary, since there's nothing to summarize.)

---

### User Story 4 — Filter the roster by status from a chip group (Priority: P2)

The roster's controls bar shows three filter chips — **All · Active · Inactive** — each with a tabular count (e.g. "Active 12"). Tapping a chip filters the visible roster instantly; the previous "Show inactive" switch is removed. The current selection persists across page loads so an operator who lives in "Active" doesn't have to re-filter on every visit. Empty filter states show a context-appropriate message ("No inactive staff." rather than the generic "No staff found.").

**Why this priority**: The new staff row design (status dot, faded opacity for inactive rows) reads cleanly only when the operator can scope to one status. The legacy switch hid inactive rows by default but offered no way to look only at inactive rows; the chip group makes both directions equally one-click. Lower than the exemption stories because it improves an existing workflow rather than unlocking a missing one.

**Independent Test**: Seed 4 active + 2 inactive staff. Load Settings → Staff; confirm the chips render "All 6 · Active 4 · Inactive 2", the Active chip is selected by default (or persisted from a prior visit), and only the 4 active rows are visible. Click Inactive; only the 2 inactive rows render. Click All; all 6 render. Reload the page; the last-clicked chip is still selected and the visible rows match.

**Acceptance Scenarios**:

1. **Given** a salon with at least one active and one inactive staff member, **When** the roster page loads, **Then** the filter chip bar renders with three chips (All / Active / Inactive), each showing a tabular count, with "Active" selected by default for first-time visitors and the previously-selected chip persisted for returning visitors.
2. **Given** the chip bar is visible, **When** the owner clicks a chip, **Then** the roster updates instantly to show only matching staff and the chip's selected style highlights it.
3. **Given** the chip bar persisted a selection from a prior visit, **When** the owner returns to the page in a new tab/session, **Then** the same chip is preselected and the roster matches.
4. **Given** "Inactive" is selected AND no inactive staff exist, **When** the roster renders, **Then** an empty-state row reads "No inactive staff." (not the generic "No staff found.") and an inline link offers to switch back to "Active".
5. **Given** the page renders for the first time, **When** the operator inspects browser storage, **Then** the persisted key is `tn:settings:staff:filter` (the legacy `tn:settings:staff:show-inactive` key from the prior switch is no longer read or written; if present from a prior version, it is ignored).

---

### User Story 5 — Read the staff row at a glance (Priority: P2)

Each row in the roster is restructured. A small **status dot** (success-tinted for Active, muted for Inactive) leads the row. The avatar and name follow, with the role on a second line. The PIN status is a tinted pill — success-tinted "Set" when the tech has a PIN, warning-tinted "No PIN" when they don't. The right-hand side shows a tabular "Added MMM YYYY" date. Inactive rows render with faded opacity so they recede visually under the All filter. When a row is selected, a left-side accent bar appears alongside the existing selected-state background. On narrow screens (under ~900px) the trailing metadata collapses and a chevron replaces it.

**Why this priority**: The row redesign sets up the visual language the edit panel and the Pay & deductions badges echo (status dot ↔ status badge, tinted PIN pill ↔ tinted exemption badge). Without it, the panel's design language has no anchor in the roster.

**Independent Test**: Seed one active staff with PIN, one active without PIN, one inactive without PIN. Confirm the active-with-PIN row shows a success status dot + success "Set" pill + tabular date; the active-without-PIN row shows the same status dot + warning "No PIN" pill; the inactive row shows a muted status dot + reduced opacity + still shows the PIN pill in its own state. Click the inactive row — the selected accent bar appears on its left edge and the row's opacity returns to full to indicate focus.

**Acceptance Scenarios**:

1. **Given** an active staff member, **When** their roster row renders, **Then** a small success-tinted status dot precedes the avatar, the row's opacity is 100%, and the PIN pill is success-tinted "Set" or warning-tinted "No PIN" depending on whether a PIN exists.
2. **Given** an inactive staff member, **When** their roster row renders, **Then** the status dot is muted, the row opacity is reduced (target ≈ 60%, exact value per the design tokens), and selecting the row restores it to full opacity for focus.
3. **Given** any staff member, **When** their row renders on a desktop viewport, **Then** the right-hand side shows "Added MMM YYYY" in tabular numerals (e.g. "Added Jan 2025").
4. **Given** any staff member, **When** their row renders on a narrow viewport (<900px), **Then** the trailing "Added …" metadata is hidden, the PIN pill remains, and a chevron renders at the row's right edge to signal a sheet-open action.
5. **Given** a selected staff row, **When** the row renders, **Then** a left-side accent bar (using the primary accent token) appears flush against the row's left edge alongside the existing selected background.
6. **Given** the page renders on any supported viewport, **When** the layout settles, **Then** every visible value (background, border, radius, padding, font weight, dot color, pill color, opacity) traces to a Lacquer token; no raw hex, no off-scale spacing, no custom font weight.

---

### User Story 6 — Restructure the edit panel into sections with a danger zone (Priority: P2)

The edit panel now uses sectioned cards: a **panel-profile header** (avatar, name, role + "Added MMM YYYY", derived status badges), an **Identity** section (display name, role select, avatar color picker), an **Access** section (Active toggle row + PIN row), the new **Pay & deductions** section (US1–US3), a full-width **Save changes** primary button, and a **Danger zone** block at the bottom (red-tinted, stacking Deactivate/Reactivate and "Remove from roster"). Each section is its own card so the structure reads from top to bottom: who they are → how they get in → how they get paid → destructive actions, walled off.

**Why this priority**: Without sectioning, the new Pay & deductions controls live in a flat stream of fields and the danger actions sit next to harmless edits. The sectioning is what makes the new exemption controls feel safe to fiddle with (they're in a clearly delimited "Pay & deductions" card) and the danger actions feel weighty (they're in a tinted danger zone).

**Independent Test**: Open any tech's edit panel. Confirm the panel scrolls top-to-bottom in the order: profile header → Identity card → Access card → Pay & deductions card → Save changes button → Danger zone block. Confirm the Danger zone uses a red-tinted background that contrasts visibly with the neutral identity/access/pay cards. Confirm Deactivate (for active staff) and Reactivate (for inactive staff) appear in the danger zone — never elsewhere. Confirm "Remove from roster" appears under Deactivate/Reactivate.

**Acceptance Scenarios**:

1. **Given** any staff member's edit panel, **When** it renders, **Then** the panel-profile header at the top shows avatar + display name + "{Role} · Added MMM YYYY" + a row of status badges (Active/Inactive plus any exemption badges derived from US3).
2. **Given** the panel-profile header, **When** the operator has at least one exemption configured, **Then** the corresponding badge(s) render alongside the Active/Inactive badge; when no exemptions are configured, no extra badges render.
3. **Given** the panel renders, **When** the operator scrolls top-to-bottom, **Then** the sections appear in this fixed order: Identity → Access → Pay & deductions → Save changes (full-width primary) → Danger zone.
4. **Given** the Danger zone renders, **When** the staff member is active, **Then** a "Deactivate" button appears (followed by a destructive-red "Remove from roster" button); when the staff member is inactive, **Then** a "Reactivate" button appears (followed by the same "Remove from roster" button).
5. **Given** the edit panel renders, **When** the layout settles, **Then** every section is its own card with consistent token-based radii, padding, and dividers; the Danger zone uses a tinted background distinct from the neutral cards above it; no raw hex, no off-scale spacing.

---

### User Story 7 — Add a new staff member through a wizard sheet (Priority: P3)

"Add staff" no longer opens an inline dialog. Instead, a right-side **wizard sheet** (~420px) slides in, header showing **step pills** — `Details · Set PIN · Done`. Step 1 captures display name, role, and avatar color, with a live preview card on the right that mirrors the in-progress draft. The sticky footer shows Cancel + "Next: set PIN" (disabled until required fields are valid). The second step captures the PIN. The third step shows a success state with the just-created tech's preview and a "Done" button that returns to the roster (which now includes the new tech). The two server-side steps (create staff record, then set PIN) are unchanged in behavior — this is purely a visual chrome upgrade.

**Why this priority**: The wizard layout reads cleaner than the existing add dialog and matches the panel-style design language of the rest of the page. Lower than the panel and roster redesign because the existing flow technically works; this is a polish pass.

**Independent Test**: From the roster, click "Add staff". Confirm a 420px right-side sheet slides in, the header shows three pills with "Details" highlighted, the form fields are visible on the left, the live preview card mirrors the in-progress name + role + avatar color on the right, and the footer shows Cancel + "Next: set PIN" disabled until name is non-empty. Fill out name + role + color, click "Next: set PIN"; confirm the second-pill highlights, the form replaces with a PIN input, and the footer updates accordingly. Set PIN, complete; confirm the third pill highlights and the success state renders with a Done button. Click Done; the sheet closes and the new tech appears in the roster.

**Acceptance Scenarios**:

1. **Given** the roster is visible, **When** the owner clicks "Add staff", **Then** a right-side sheet slides in with width ~420px, the header showing three step pills (Details, Set PIN, Done) with Details highlighted, and the live-preview card on the right pre-populated with the default draft values.
2. **Given** the sheet is open at the Details step with required fields empty, **When** the operator views the footer, **Then** the "Next: set PIN" button is disabled and a Cancel button is enabled; entering a valid display name enables the Next button.
3. **Given** the operator types into Details fields, **When** any value changes, **Then** the live-preview card on the right updates in real time (name, role, avatar color all reflected).
4. **Given** the Details step is complete and Next is clicked, **When** the sheet transitions, **Then** the second pill highlights, the form area replaces with a PIN input, and the footer updates to a Back + Set PIN action.
5. **Given** the PIN is set successfully, **When** the sheet transitions, **Then** the third pill highlights, the form area replaces with a success message showing the new tech's preview, and the footer offers a Done button that closes the sheet and refreshes the roster to include the new tech.
6. **Given** the operator clicks Cancel at any step, **When** the sheet closes, **Then** no staff record is persisted if the operator cancels before completing step 1 (the create-staff action only fires on Next-from-Details); if the operator cancels after step 1, the partially-created record persists without a PIN and shows in the roster with a "No PIN" pill (matching existing behavior).

---

### User Story 8 — Use the edit panel as a bottom sheet on mobile (Priority: P3)

On narrow viewports (<900px), the two-pane layout collapses: the roster takes the full width, and tapping a row opens the **edit panel as a bottom sheet** that slides up from the bottom, occupying up to 92% of viewport height, with body scroll locked behind it. A floating action button (FAB) in the lower-right opens the same Add-staff wizard sheet from US7. A drag handle at the top of the bottom sheet hints at dismissal; tapping a dismiss button or swiping down closes it.

**Why this priority**: The two-pane desktop layout doesn't fit a phone screen, so without a mobile sheet the page is unusable on the salon's mobile devices. Lower than the desktop redesign because mobile traffic for Settings → Staff is rare in practice (this is an owner-only surface), but a missing mobile path means the operator can't even glance at the roster from their phone.

**Independent Test**: Open the page on a viewport narrower than 900px. Confirm the roster takes the full width and no panel renders alongside it. Tap a row; confirm a bottom sheet slides up with the full edit panel content (matching the desktop sections). Confirm body scroll is locked while the sheet is open. Tap the dismiss control; confirm the sheet slides down and the roster reappears. Tap the FAB; confirm the Add-staff wizard sheet opens (from US7).

**Acceptance Scenarios**:

1. **Given** a viewport narrower than 900px, **When** the page renders, **Then** the roster takes the full width, no side panel is visible, and a FAB renders in the lower-right with an Add-staff icon.
2. **Given** the mobile layout is showing the roster, **When** the operator taps a staff row, **Then** the edit panel slides up from the bottom of the viewport as a sheet, occupying up to 92% of viewport height, with body scroll locked while the sheet is open.
3. **Given** the bottom sheet is open, **When** the operator taps a dismiss control or swipes it down past a dismissal threshold, **Then** the sheet slides down and body scroll unlocks; the underlying roster scroll position is preserved.
4. **Given** the operator taps the FAB, **When** the action fires, **Then** the Add-staff wizard sheet from US7 opens (with the same content as desktop, adapted to the narrow width).
5. **Given** the page renders on any mobile viewport, **When** the layout settles, **Then** all values (sheet height, slide animation, FAB offset, opacity) trace to Lacquer tokens; no raw hex, no off-scale spacing, no custom timing.

---

### Edge Cases

- **Empty supply catalog after archival of every type**: If every supply type in the catalog has been archived and a tech has previously-exempted ids that are all archived, the picker still renders those rows with "Archived" pills (US2 #8). If the tech has no previously-exempted ids AND no active types exist, the picker shows the "No supply types defined yet" empty state (US2 #6).
- **Stale tab with deleted supply types**: If the operator has a stale browser tab open showing supply-type ids that have since been deleted at the database level (defensive — 022 archives rather than deletes), the save action drops the unknown ids silently from the submitted set; the saved record contains only valid ids.
- **Self-edit of own exemption fields**: An operator with permission to edit any staff can self-edit their own card_fee_exempt / supply_mode / supply_except (non-destructive, doesn't change their role or access). Self-edit of role or active state remains restricted per the existing 006 permission model.
- **Mode toggle without saving**: Switching the Supply deductions segmented control between Apply all / Some / Exempt does NOT immediately wipe the in-progress per-type ticks — those stay in the panel's draft state so the operator can flip between modes to compare without losing their work. On save, the action wipes the persisted ticked set if the saved mode is Apply all or Exempt.
- **Concurrent rename of a supply type**: If supply type "Chrome powder" is renamed to "Chrome powders" in another tab while this tech's panel is open with that type ticked, the ticked-state survives (the id is what's stored). On the next page load the picker label reflects the new name. The panel does not refresh names mid-session.
- **Reduced-motion preference**: Operators with prefers-reduced-motion set get an instant transition for the mobile bottom sheet open/close (no slide-up animation) and equivalent reductions for the desktop wizard sheet entry. Tab-bar and chip-bar interactions remain instant in both modes.
- **Settings tab bar fallback**: If a user lands on `/settings` without a sub-route, they are redirected to `/settings/staff` (the most-used sub-page); the tab bar highlights the active tab so it's obvious where they are.

## Requirements *(mandatory)*

### Functional Requirements

**Per-staff exemptions — data shape**

- **FR-001**: Each staff record MUST persist three new fields: a boolean for card-fee exempt status; a text mode for supply deductions with exactly three permitted values (apply, partial, exempt); and an ordered set of supply-type identifiers representing exempted types when the mode is partial. Defaults: card-fee exempt = false; supply mode = apply; exempted types = empty.
- **FR-002**: When the supply mode is anything other than partial, the persisted set of exempted supply-type identifiers MUST be empty (enforced both by the save action and as a database-level invariant).
- **FR-003**: Every identifier in the persisted exempted-types set MUST reference an existing supply-type catalog row (enforced as a referential-integrity invariant in the database). If a supply-type catalog row is ever physically deleted, all staff records referencing its identifier MUST have that identifier removed automatically.
- **FR-004**: Each individual staff record MUST not retain more than 64 exempted supply-type identifiers (defensive cap well above realistic catalog size).

**Per-staff exemptions — capture surface**

- **FR-005**: The Settings → Staff edit panel MUST expose a Pay & deductions section containing a Card processing fee toggle row and a Supply deductions segmented control (Apply all / Some / Exempt).
- **FR-006**: When Supply deductions is set to "Some", the section MUST render a per-type picker listing every active supply type from the catalog plus any archived supply type that is currently in the tech's persisted exempted set; each row MUST display the type name, a usage hint of the form "N services · typically $X per ticket" (or "Unused — no services reference this type yet."), and a checkbox.
- **FR-007**: The usage hint for each supply type MUST compute N as the count of active services referencing the type and $X as the most-common per-service supply amount across those services, with ties broken by the smallest amount; the computation MUST happen server-side in a single query and be passed to the panel as a prop.
- **FR-008**: The Card processing fee row's subtitle MUST display the studio's current standard fee amount when the toggle is on, sourced from the single standard-fee helper rather than hardcoded in the panel copy. When the toggle is off, the subtitle MUST read "Exempt — card fee never deducted from payout."
- **FR-009**: The Pay & deductions section MUST render a plain-language summary sentence when at least one exemption is in effect, using the tech's first name and naming any exempted supply types in prose. When no exemption is in effect, no summary MUST be rendered.
- **FR-010**: When the selected tech's role is Front desk AND no exemptions are in effect, the section MUST instead render a muted hint explaining that front-desk staff don't typically take services so these settings don't normally affect their payouts.

**Per-staff exemptions — persistence and audit**

- **FR-011**: The Save changes action MUST accept the three new fields, MUST wipe the exempted-types set whenever the saved supply mode is Apply all or Exempt, and MUST validate the supply mode against the three permitted values (rejecting any other value with a structured error).
- **FR-012**: The Save changes action MUST silently drop any submitted supply-type identifier that does not correspond to an existing supply-type catalog row (defensive against stale-tab submissions).
- **FR-013**: Self-edit of a staff member's own card_fee_exempt, supply_mode, and supply_except fields MUST be permitted under the same role check that today gates non-destructive self-edits; self-edit of role or active state remains restricted per the existing 006 permission model.
- **FR-014**: Every staff update that mutates any of the three new fields MUST extend the existing `staff.updated` audit-log payload with diff entries for `card_fee_exempt`, `supply_mode`, and `supply_except` showing the before and after values. The supply_except diff MUST store the raw identifier set (no name snapshot); the audit viewer resolves names at render time from the live catalog.
- **FR-015**: When the audit viewer renders a `supply_except` diff for a supply-type identifier that is currently archived in the catalog, the viewer MUST show the current name with an "Archived" muted pill so the historical row stays readable.

**Status badges**

- **FR-016**: The edit panel header MUST render a row of derived status badges: Active/Inactive (always); plus, when applicable, "Card-fee exempt", "Supply-exempt", "Partial supply exemption". The badges MUST update live as the operator toggles the controls in the Pay & deductions section (before save) so the operator can preview the posture.

**Roster — filter chips**

- **FR-017**: The roster controls bar MUST render three filter chips — All, Active, Inactive — each showing a tabular per-status count.
- **FR-018**: The currently-selected filter chip MUST persist across page loads using the storage key `tn:settings:staff:filter`; for first-time visitors with no persisted value, the default is Active.
- **FR-019**: The legacy "Show inactive" switch and its storage key `tn:settings:staff:show-inactive` MUST be removed; any persisted legacy value MUST be ignored (no migration is required — the default selection covers all cases).
- **FR-020**: When the selected filter has zero matching staff, the roster MUST render a context-specific empty-state row ("No active staff." / "No inactive staff." / "No staff in this salon yet.") rather than a generic message.

**Roster — row redesign**

- **FR-021**: Each staff row MUST show a leading status dot (success-tinted for active, muted for inactive), the existing avatar + display name + role, a PIN pill (success-tinted "Set" when a PIN exists, warning-tinted "No PIN" when absent), and (desktop only) a tabular "Added MMM YYYY" date on the right edge.
- **FR-022**: Inactive rows MUST render with reduced opacity to recede visually under the All filter; selected rows MUST regain full opacity for focus.
- **FR-023**: Selected rows MUST show a left-side accent bar flush against the row's left edge using the primary accent token, alongside the existing selected-state background.
- **FR-024**: On viewports narrower than 900px, the trailing "Added …" metadata MUST be hidden and a chevron MUST render at the row's right edge to signal the row opens a sheet on tap.

**Settings shell — tab bar**

- **FR-025**: The Settings layout MUST mount a tab bar at the top of every Settings sub-page (General · Staff · Notifications · Billing) so the four sub-pages share the same shell. The active tab MUST be highlighted based on the current route.
- **FR-026**: A visit to `/settings` without a sub-route MUST redirect to `/settings/staff` (the most-used sub-page).

**Edit panel — sectioning and danger zone**

- **FR-027**: The edit panel MUST render its content in this fixed top-to-bottom order: panel-profile header → Identity card → Access card → Pay & deductions card → full-width Save changes primary button → Danger zone block.
- **FR-028**: The Danger zone block MUST use a distinct tinted background and MUST contain exactly two actions: Deactivate (for active staff) or Reactivate (for inactive staff), followed by "Remove from roster". No destructive action MUST appear elsewhere in the panel.

**Add-staff wizard sheet**

- **FR-029**: The "Add staff" action MUST open a right-side sheet ~420px wide containing three step pills (Details, Set PIN, Done), a form area, a live preview card that mirrors the draft, and a sticky footer with Cancel + a primary action whose label reflects the next step.
- **FR-030**: The wizard's two server actions (create staff, set PIN) MUST be unchanged in behavior from the existing flow — the sheet is visual chrome only. A Cancel mid-wizard after staff creation MUST leave the partially-created staff record in the roster with a "No PIN" pill (matching existing behavior).

**Mobile**

- **FR-031**: On viewports narrower than 900px, the page layout MUST collapse to a full-width roster with the edit panel rendered as a bottom sheet (opening on row tap, sliding up from the bottom, occupying up to 92% of viewport height, body scroll locked while open). Dismissal MUST be available via tap-to-close and swipe-down.
- **FR-032**: A floating action button MUST render in the lower-right on mobile to open the Add-staff wizard sheet (same content as desktop, adapted to narrow width).
- **FR-033**: Operators with `prefers-reduced-motion: reduce` MUST receive instant transitions for the mobile bottom sheet and the desktop wizard sheet (no slide-up animation), preserving accessibility expectations.

**Design system**

- **FR-034**: Every visible value (color, spacing, radius, shadow, type weight, animation timing) across the redesigned roster, edit panel, danger zone, status badges, status dot, PIN pill, filter chips, settings tab bar, wizard sheet, and mobile bottom sheet MUST trace to a token from the project's design system (no raw hex, no off-scale spacing, no custom font weights).

### Key Entities *(include if feature involves data)*

- **Staff (extended)**: existing entity from 006-staff-management with three new attributes — a boolean for card-fee exemption (default false), a text supply-deduction mode with exactly three permitted values (apply / partial / exempt; default apply), and an ordered set of supply-type identifiers naming the types this tech is exempted from when the mode is partial (default empty, max 64). The set MUST stay empty unless the mode is partial. Identifiers in the set MUST reference a supply-type catalog row.
- **Supply type (existing, referenced)**: the catalog entity shipped in 022-supply-types-catalog. Each row has a stable identifier, a display name, and an archived flag. This feature references rows by identifier and resolves their names live for display.
- **Audit log entry (existing, extended)**: each `staff.updated` audit entry's diff payload gains optional `card_fee_exempt`, `supply_mode`, and `supply_except` keys when those values change. The supply_except diff stores raw identifiers, not name snapshots; the audit viewer resolves names at render time.
- **Per-staff filter preference (browser-only)**: a per-browser persisted value naming the currently-selected roster filter chip (All / Active / Inactive). Stored under `tn:settings:staff:filter`. Not persisted server-side and not shared across devices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can mark a tech as card-fee exempt in **under 10 seconds** from the moment they select the tech in the roster (open panel → toggle → save).
- **SC-002**: An operator can scope a tech's supply deductions to a chosen subset of types and save in **under 30 seconds** for a catalog with up to 20 supply types, with no scrolling required to reach Save changes on a standard laptop viewport.
- **SC-003**: When a supply type is renamed in the catalog (via 022's Edit Policy sheet), every staff edit panel that already exempts that type displays the new name on its **next render** with no manual refresh and no per-page label cache.
- **SC-004**: 100% of exemption transitions are reflected in the audit log within the same request as the save, with a structured diff naming every changed field (card_fee_exempt, supply_mode, supply_except) and exact before/after values. **No staff update that mutates any of the three new fields succeeds without an audit row.**
- **SC-005**: The roster's filter chips reflect accurate per-status counts in real time after any staff add / activate / deactivate / remove, with **zero stale counts** observable for more than one render cycle.
- **SC-006**: An operator visiting Settings → Staff sees their previously-selected filter chip preselected on every subsequent page load **within the same browser**, with no regression for first-time visitors who default to Active.
- **SC-007**: The Pay & deductions summary sentence is **legible to a non-technical operator without internal jargon**, naming the tech by first name and listing exempted types in prose (validated by 3-of-3 stakeholder review, no unresolved comments).
- **SC-008**: On a mobile viewport (<900px), every action available on desktop (filter, select row, edit any field including the Pay & deductions controls, save, add staff, deactivate) is **reachable in the equivalent number of taps** without the operator having to rotate their device or use a third-party zoom.
- **SC-009**: Every visible value across the seven redesigned surfaces (settings tab bar, roster row, filter chips, edit panel sections, danger zone, wizard sheet, mobile bottom sheet) **traces to a Lacquer design-system token**, verified by automated audit (zero raw hex, zero off-scale spacing, zero custom font weights).

## Assumptions

> Confirmed decisions from `/speckit-clarify` (self-edit permission, reduced-motion behavior, archived-type picker UX, mode-toggle draft preservation, card-fee subtitle source) live in the **Clarifications** section above and are no longer carried here as assumptions.

- **Phase 3 not in scope**: The exemption values persisted here are captured and displayed only. Checkout, receipt, and payout calculations continue to apply the per-service deductions universally regardless of these settings until Phase 3 ships. The audit row still flows from save, so a future Phase 3 backfill has clean provenance.
- **022 is the prerequisite for supply-type identity**: This phase assumes 022 has shipped — `supply_types` exists, `services.supply_type_id` (uuid, nullable) is in place, and the Edit Policy sheet exposes the catalog CRUD. If 022 ships after this work, the per-type picker degrades to an empty state until then.
- **Filter chip selection persists across sessions**: Default chip on first visit is Active; on subsequent visits the last-selected chip is preselected from `localStorage` under `tn:settings:staff:filter`. (sessionStorage would lose the preference on tab close, which is more friction than help.) Not raised in clarify — low impact, easy to revisit if operators push back.
- **No other Settings sub-pages are restyled**: The tab bar links to General / Notifications / Billing, but those sub-pages' content stays as-is. Their styling will follow in a later phase.
- **Existing add-staff server actions unchanged**: The wizard sheet is visual chrome over the existing two-step create-staff and set-PIN actions. No backend behavior changes for the add flow.
- **Other prototype redesigns deferred**: The latest Lacquer design handoff includes redesigned payroll and end-of-day surfaces. Those are explicitly out of scope here — this feature only resyncs Settings → Staff.
