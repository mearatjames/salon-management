# Feature Specification: Past Cash Counts — View and Edit

**Feature Branch**: `020-past-cash-counts`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Implement design prototype `prototypes/transaction/End of Day Cash.html` — add the ability to see past counts and the ability to edit counts."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Review past cash counts (Priority: P1)

A salon owner or manager wants to look back at the cash counts that have already been closed — to spot trends, to confirm a number a tech is asking about, or just to know the history is auditable. From the End of Day page, they open a history view that lists every closed cash drawer session, most recent first. Each row shows the business day, the expected total, the counted total, the variance with its over/short color, who closed it, and when. Tapping a row reveals the explanation note (if any) and the full breakdown.

**Why this priority**: This is the minimum slice that turns a one-shot close screen into something an owner can audit. Without a history view, every closed day is a black box the moment the confirmation screen scrolls past. It is also the foundation User Story 2 builds on — you can't edit what you can't open.

**Independent Test**: Sign in as an owner or manager. Open `/end-of-day/history`. The page lists every `cash_drawer_sessions` row with `closed_at is not null`, ordered by `business_day` descending. Each row shows business day, expected, counted, variance (with color), closer name, close timestamp. Tapping a row opens a read-only detail panel showing all four amounts and the note. Closed-day rows for a technician role are not reachable — the route redirects to `/dashboard`.

**Acceptance Scenarios**:

1. **Given** three days have been closed (two with `variance = 0`, one short by $2.00), **When** the operator opens `/end-of-day/history`, **Then** all three rows appear ordered by `business_day` descending, with the short day's variance shown as `−$2.00` in destructive color and the exact-match days showing `$0.00` in muted color.
2. **Given** the operator is on the history list, **When** they tap a row, **Then** a detail panel opens showing the business day, expected, counted, variance (with sign and color), the close timestamp, the closing operator's display name, and the note text (italicized; placeholder copy "No note recorded" when empty).
3. **Given** a technician opens `/end-of-day/history`, **When** the page renders, **Then** the route silently redirects to `/dashboard` (same role gate as the count screen).
4. **Given** the main `/end-of-day` page is open, **When** the operator scans the header, **Then** a "View past counts" link is visible and navigates to `/end-of-day/history`.

---

### User Story 2 — Correct a past count (Priority: P1)

An owner notices that a closed day's counted amount was wrong — the operator transposed digits, the original count missed a stack of twenties, or the explanation note was incomplete. From the history detail panel, the owner taps **Edit count**, adjusts the counted amount on a numpad, updates the note, and saves. The session row is updated in place, the variance is recomputed, and an audit log row records the change.

**Why this priority**: Real salons discover miscounts after the fact — usually the next morning when the deposit doesn't tie out. Without an edit path, the only recovery options are direct database surgery (unsafe) or shrugging (worse). Together with US1, this delivers the full "fix what's wrong" flow the user asked for.

**Independent Test**: Pick a closed day with counted = $164.50 / variance = $0.00. Open its detail panel and tap **Edit count**. Change the counted amount to $162.50 and add a note "Recount found $2 short — gave change for a $100 bill." Save. The history row now shows `−$2.00` variance in destructive color and the updated note. The `cash_drawer_sessions` row reflects `counted_cents = 16250`, `variance_cents = -200`, the new note text, and an `updated_at` timestamp. An `audit_log` row exists with `action = "cash_drawer.edited"`, the operator's `acting_as_staff_id`, and a payload that includes both the before and after values of counted/variance/notes.

**Acceptance Scenarios**:

1. **Given** an owner has opened the detail panel for a closed day with counted $164.50 and no variance, **When** they tap **Edit count**, **Then** an edit view appears with the existing counted amount prefilled on a numpad and the existing note text editable.
2. **Given** the edit view is open, **When** the operator changes the counted amount so a new non-zero variance appears and the note field is blank, **Then** **Save changes** is disabled and the discrepancy note field shows the same "Required to close out" hint as the close screen.
3. **Given** the edit view shows a non-zero variance and a non-empty note, **When** the operator taps **Save changes**, **Then** the row is updated, the variance is recomputed server-side from `counted_cents − (opening_cents + expected_cents)`, the detail panel re-renders with the new values, and a success toast appears.
4. **Given** the edit form has unsaved changes, **When** the operator taps **Cancel** or navigates away, **Then** the changes are discarded and the detail panel shows the unchanged values.
5. **Given** a technician somehow reaches the edit view via a direct URL, **When** they submit, **Then** the Server Action returns `FORBIDDEN` and no update occurs.
6. **Given** an owner edits a closed day, **When** the change is persisted, **Then** an `audit_log` row is written with `action = "cash_drawer.edited"`, `entity_type = "cash_drawer"`, `entity_id = <session_id>`, `acting_as_staff_id = <editor>`, and a JSON payload containing `{before: {counted_cents, variance_cents, notes}, after: {counted_cents, variance_cents, notes}}`.

---

### User Story 3 — See who changed a count and when (Priority: P2)

When a count has been edited after it was first closed, the detail panel surfaces that fact — a small "Edited" badge with a timestamp and the editor's name, and an expandable change list showing each edit's before/after values. This way an owner reviewing the books can tell at a glance which days were touched after the fact.

**Why this priority**: P2 because US1 + US2 already deliver the working "see + fix" capability, but without an edit indicator the corrected number visually looks identical to the original — defeating the audit story. This makes the audit trail readable in the UI rather than only in `audit_log`.

**Independent Test**: Take a row that has been edited at least once. Its history list row shows an "Edited" pill next to the close timestamp. Opening the detail panel shows "Last edited by [Name] at [Time]" under the breakdown and a collapsible "Change history" section that lists each prior version's counted, variance, and note text in reverse-chronological order. A row that has never been edited shows no pill and the section is hidden.

**Acceptance Scenarios**:

1. **Given** a session that has been edited twice, **When** the history list renders, **Then** its row shows an "Edited" pill in muted color.
2. **Given** the detail panel for an edited session is open, **When** it renders, **Then** "Last edited by [editor display name] at [HH:MM AM/PM date]" appears under the breakdown row.
3. **Given** the detail panel for an edited session is open, **When** the operator expands "Change history", **Then** each prior version is listed with timestamp, editor, counted, variance, and note text, ordered newest to oldest.
4. **Given** a session that has never been edited, **When** its detail panel is open, **Then** no "Edited" pill, no last-edited line, and no change-history section appear.

---

### Edge Cases

- **Editing a same-day close.** An operator closes the day at 7 PM, then notices a miscount at 7:05 PM. They open the history view (which now lists today's session, since it is closed) and edit it. The main `/end-of-day` page still shows the closed-state confirmation; on next load it reflects the corrected numbers.
- **Edit that returns variance to zero.** The operator edits a previously-short close so the new counted matches expected. The note field is no longer required by the variance rule, but the existing non-empty note must remain (it explains what was discovered) — saving with an emptied note is allowed only if the new variance is zero AND the operator explicitly clears the note.
- **Concurrent edit and close.** A second operator presses **Close Out Day** for a brand-new business day while the first operator is editing yesterday's count. The two actions touch different rows; both succeed.
- **Concurrent edits to the same row.** Two managers open the same closed day on two devices and both submit edits. Last write wins, but both edits create audit_log rows so the trail is preserved.
- **Edit on a row with `expected_cents` from a stale recompute.** Edits MUST NOT recompute `expected_cents` from current `payments` — the historical expected is frozen at close time and editing only changes the counted/notes. (If a missing cash payment was later added, that is a data-correction issue handled outside this feature.)
- **History with zero closed days.** A fresh install or a salon that has never closed shows an empty-state in the history list with copy explaining what will appear here ("Closed cash counts will appear here. Close out today's drawer on the End of Day page to start your history.").
- **Pagination.** The history list shows the most recent 90 days inline; older days require an explicit "Show earlier" action. (90 days = roughly a quarter — a natural finance review window.)
- **Read-only role visibility.** The history list is owner- and manager-only, matching the existing role gate on `/end-of-day`. Technicians do not see the link or the route.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST surface `/end-of-day/history` as a list of closed cash drawer sessions for authenticated owner/manager-role staff. Technician-role staff MUST NOT be able to reach the route — the request MUST redirect silently to `/dashboard`, identical to the existing `/end-of-day` role gate.
- **FR-002**: The history list MUST show one row per closed `cash_drawer_sessions` record, ordered by `business_day` descending. Each row MUST display: business day (long-form date, e.g. "Mon, May 11"), expected total, counted total, variance (with sign), closing operator's `display_name`, and the `closed_at` time in the salon's timezone. Variance MUST render in success / warning / destructive color matching the existing comparison block tokens (zero / over / short).
- **FR-003**: The most recent 90 business days MUST render inline. Older days MUST be reachable via a "Show earlier" action that paginates 90 days at a time, with no implicit upper bound on history retention.
- **FR-004**: The main `/end-of-day` page MUST include a "View past counts" link in its header that navigates to `/end-of-day/history`. The link MUST be visible only to owner/manager roles.
- **FR-005**: Selecting a row in the history list MUST open a detail panel (or detail route, see Assumptions) showing: business day, expected, counted, variance (with sign and color), closing operator's display name, close timestamp, and the variance note (or "No note recorded" placeholder).
- **FR-006**: From the detail panel, owners and managers MUST be able to invoke an **Edit count** action that opens an edit view. The edit view MUST prefill the existing `counted_cents` on a numpad (same numpad rules as the close screen — digits, one decimal point, up to two decimal places, backspace, clear) and prefill the existing notes in a textarea.
- **FR-007**: On save, the edit Server Action MUST role-gate to owner/manager, validate non-negative integer `counted_cents`, enforce the same "non-empty note required when variance is non-zero" rule, recompute `variance_cents = counted_cents − (opening_cents + expected_cents)` server-side, and update the session row in place. `business_day`, `expected_cents`, `opening_cents`, `opened_at`, `opened_by_staff_id`, `closed_at`, and `closed_by_staff_id` MUST NOT change.
- **FR-008**: Every successful edit MUST write one `audit_log` row with `action = "cash_drawer.edited"`, `entity_type = "cash_drawer"`, `entity_id = <session_id>`, `acting_as_staff_id = <editor>`, `actor_user_id = <device auth.uid()>`, and a JSON payload that records both the before and after values of `counted_cents`, `variance_cents`, and `notes`. The audit row MUST be written in the same database transaction as the row update so the trail cannot diverge from the data.
- **FR-009**: The history list row and the detail panel MUST visually indicate when a session has been edited at least once (an "Edited" pill in muted color on the row; a "Last edited by [Name] at [time]" line in the detail panel). The indicator MUST be derived from the presence of one or more `cash_drawer.edited` audit_log rows for the session, not from a denormalized flag on the session row.
- **FR-010**: The detail panel MUST include an expandable "Change history" section listing each prior edit's timestamp, editor display name, and before/after values of counted / variance / notes, ordered newest to oldest. The section MUST be hidden when no edits exist.
- **FR-011**: All currency on the history list and detail panel MUST format with two decimals and tabular numerals, matching the existing Lacquer tokens. All timestamps MUST display in the salon timezone using the same formatters as the dashboard and the existing End-of-Day screen.
- **FR-012**: An edit that leaves `variance_cents = 0` MUST allow the operator to clear the notes field. An edit that produces a non-zero `variance_cents` MUST reject a submission with an empty or whitespace-only notes field, mirroring the existing `cash_drawer_notes_required_when_variance_chk` constraint behavior.
- **FR-013**: The edit Server Action MUST be safe to retry: re-submitting the same edit values MUST produce the same end state. No-op edits (where every after-value equals the corresponding before-value) MUST still write an audit row so the trail of "operator opened and saved this record" is preserved.

### Key Entities

- **Cash drawer session (existing — extended)**: One row per (salon, business day). For this feature, the row gains an `updated_at` column (set on edit; nullable so unedited rows are distinguishable from edited rows). All other fields keep their meaning from feature 019. The check constraint that ties `variance_cents` to `counted_cents − (opening_cents + expected_cents)` continues to hold after every edit because the Server Action recomputes the variance from the new counted.
- **Audit log entry (new vocabulary)**: A `cash_drawer.edited` action joins the existing `cash_drawer.closed` action. Same shape as other audit rows (actor, entity, JSON payload), with payload schema `{before: {counted_cents, variance_cents, notes}, after: {counted_cents, variance_cents, notes}}`.
- **Cash drawer history view (read model)**: The history list and detail panel read from `cash_drawer_sessions` joined to `staff` (for closer and editor display names) and `audit_log` (for the edited indicator and change-history section). No new persisted entity — just a query.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can open the history view, locate a specific past day, and read its variance and note in **under 15 seconds** for any day in the most recent 90.
- **SC-002**: An owner can correct a wrong count from "I noticed the miscount" to "row is updated and audit row written" in **under 60 seconds** when the change is a simple counted-amount adjustment.
- **SC-003**: Every persisted edit to a `cash_drawer_sessions` row is accompanied by a `cash_drawer.edited` audit_log row in the same database transaction — verified by a database audit at end of first month showing **zero** edited sessions without a matching audit trail.
- **SC-004**: When an owner views a previously edited count, the "Edited" indicator and the full change history are visible without leaving the detail panel — verified by usability check: 100% of test participants correctly identify which displayed counts had been edited after the fact.

## Assumptions

- The history list and detail panel live under `/end-of-day/history` (list) and `/end-of-day/history/[sessionId]` (detail). The detail can be implemented as a route or as a slide-in panel from the list — the choice is left to the planning phase based on what fits the existing studio layout patterns. Both surface the same data and the same edit affordance.
- "Past counts" means closed `cash_drawer_sessions` rows — the still-open current session is not in the history (it appears on the main `/end-of-day` page). Once today's session is closed, it immediately appears in the history list.
- The edit action is permitted indefinitely — there is no time window after which a closed day becomes immutable. (Audit trail is the safeguard; a future feature could add a "lock after deposit" workflow as a separate change.)
- No "reopen" transition is added — edits modify the closed row in place. The session never returns to the open state; the existing "one open session per day" unique index continues to mean "at most one open session at a time," not "at most one session ever."
- Editing does not recompute `expected_cents` from current `payments` data. The expected total is frozen at close time and remains the historical record. If a missing cash payment was later added, that is a separate data-correction concern handled outside this feature.
- Audit no-ops: re-saving the existing values still writes a `cash_drawer.edited` row so the trail of "operator opened and saved this record" is preserved. The DB-level row update with identical values is harmless.
- Role visibility matches the existing feature 019 gate: owner and manager roles only, technicians redirected to `/dashboard`. PIN re-prompt is not required for edits, consistent with how other manager-only studio screens behave.
- This feature does not change the close flow on the main `/end-of-day` page or the existing `pos_close_cash_drawer` RPC. It adds one new RPC (or one new Server Action against the service-role client — to be decided in planning) for the edit and one new audit vocabulary entry.
- The Lacquer prototype `prototypes/transaction/End of Day Cash.html` does not include a history view or an edit affordance — those are net-new UI surfaces. The new surfaces MUST reuse the existing tokens, type scale, status pill, comparison-block color rules, and numpad behavior; planning will identify which existing Lacquer components compose into the list and detail.
- "Business day" continues to follow `salon.timezone`; all dates and timestamps on these new surfaces use the same formatters as `lib/time/format.ts` and the existing dashboard.
