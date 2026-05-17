# Feature Specification: End of Day Cash Count

**Feature Branch**: `019-end-of-day-cash`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Implement design prototype `prototypes/transaction/End of Day Cash.html` — staff count the cash drawer at close; the screen shows today's cash transactions and flags any over/short."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Count and close a day where cash matches expected (Priority: P1)

A salon owner or manager opens the End of Day screen near closing. They see every cash transaction taken today on the left, with the **expected cash total** at the bottom. They count the cash in the drawer, type that number on the numpad on the right, see "Exact match" in green, and tap **Close Out Day**. The day is recorded as closed with no variance.

**Why this priority**: This is the happy-path closing flow that runs at the end of every business day. Without it, cash sales can't be reconciled and the operator can't know whether the drawer is correct. It is the minimum to declare the feature shipped.

**Independent Test**: Sign in as an owner or manager on a day that has at least one completed cash payment. Open `/end-of-day`. The expected total equals the sum of today's cash payments minus any cash refunds. Enter that exact amount on the numpad. The comparison shows "Exact match" and **Close Out Day** is enabled. Tapping it persists a closed cash drawer session with `variance = 0` and shows the confirmation screen.

**Acceptance Scenarios**:

1. **Given** today has three completed cash transactions totalling $164.50 and no cash refunds, **When** the operator opens `/end-of-day`, **Then** the left panel lists those three rows with time, client, services, tech, total and tip, and the footer shows "Expected cash total $164.50 · 3 cash transactions."
2. **Given** the expected cash total is $164.50, **When** the operator types `164.50` on the numpad, **Then** the amount display border turns green, the comparison shows "Exact match" with a check icon, and **Close Out Day** becomes enabled.
3. **Given** the comparison reads "Exact match," **When** the operator taps **Close Out Day**, **Then** the day is closed, the status pill changes from "Open · Closing at 8 PM" to "Closed," and a confirmation screen shows the expected, counted, and difference values along with the close timestamp.

---

### User Story 2 — Close a day with a variance, explain it, then close (Priority: P1)

The counted cash doesn't match the expected total. The operator sees the difference highlighted (amber for over, red for short). A note field appears asking them to explain the variance — **Close Out Day** stays disabled until they type something. They write a short explanation ("Gave change for $100 bill, register came up $2 short"), the button becomes enabled, and they close the day. The variance and note are recorded with the session.

**Why this priority**: P1 because variances are common in real cash handling, and forcing an explanation is the only reason a salon owner trusts the number after the fact. Shipping happy-path-only would leave the most important audit signal unwritten.

**Independent Test**: On a day with expected $164.50, enter $162.50. Verify the comparison shows "Short −$2.00" in red, the explanation field is required, **Close Out Day** is disabled with empty note, and becomes enabled after typing any non-whitespace note. Submitting persists the counted amount, variance, and note text on the cash drawer session row.

**Acceptance Scenarios**:

1. **Given** expected total is $164.50, **When** the operator types `162.50`, **Then** the comparison shows "Short" with "−$2.00" in red, the numpad amount display border turns red, a discrepancy note field appears with "Required to close out" hint, and **Close Out Day** is disabled.
2. **Given** expected total is $164.50, **When** the operator types `168.00`, **Then** the comparison shows "Over" with "+$3.50" in amber, the amount display border turns amber, a discrepancy note field appears, and **Close Out Day** is disabled.
3. **Given** a variance is showing and the discrepancy field is empty, **When** the operator types a note with at least one non-whitespace character, **Then** **Close Out Day** becomes enabled.
4. **Given** a variance and a non-empty note, **When** the operator taps **Close Out Day**, **Then** the cash drawer session row is closed with `counted_cents`, `variance_cents`, and `notes` populated, and the confirmation screen displays the note in italics under the breakdown.

---

### User Story 3 — Correct a mistyped amount before closing (Priority: P2)

The operator pressed the wrong digit. They need to remove a digit, clear the whole entry, or just start typing a new amount, without leaving and re-opening the page.

**Why this priority**: P2 — it's pure ergonomics; the day still closes correctly without it, but with it the operator never feels stuck. The numpad already exists in the prototype, so cost is low.

**Independent Test**: On the count screen, type `1`, `2`, `3` → display shows `123`. Press the backspace key → `12`. Press **Clear** → display shows `0` and the comparison resets to the empty state. Type `1`, `6`, `4`, `.`, `5`, `0` → display reads `164.50` and the comparison recomputes.

**Acceptance Scenarios**:

1. **Given** the display shows `123`, **When** the operator presses the backspace key, **Then** the display shows `12` and the comparison recomputes.
2. **Given** the display shows `164.50`, **When** the operator taps **Clear**, **Then** the display returns to the empty state (`0` placeholder), the comparison row shows "—" for both Counted and Difference, and the discrepancy note field disappears if it was visible.
3. **Given** the display shows `164.50`, **When** the operator taps the `.` key again, **Then** nothing changes (only one decimal point is allowed).
4. **Given** the display shows `164.50`, **When** the operator taps a digit, **Then** nothing changes (no more than two decimal places are allowed).

---

### Edge Cases

- **No cash transactions today.** The left list is empty, the footer reads "Expected cash total $0.00 · 0 cash transactions," and the operator can still close out with counted `$0.00` (no variance).
- **Cash refunds today.** Refunds reduce the expected total (a $20 refund taken from the drawer means $20 less should be in the drawer). Refunds appear as their own rows in the left list with a `−$X.XX` total in destructive color and a `Refund` label in the meta line, so the on-screen list always reconciles to the expected total without hidden adjustments.
- **Day already closed.** If the day has already been closed once today, the page shows the closed-state confirmation screen instead of the count UI; the operator cannot reopen and re-close from the UI in v1.
- **Stale data while counting.** A new cash transaction could complete on another device while the operator is counting. The expected total shown at the top is the value at page load; on close, the server recomputes from current data. If the recomputed expected total differs from the snapshot the operator saw, the close is **rejected**, the page reloads with the new expected total, and a one-time banner appears: "A new cash payment was recorded. Please recount the drawer."
- **Concurrent close attempts.** Two operators on two devices both press **Close Out Day** at the same moment. Exactly one succeeds; the second sees the day-already-closed confirmation.
- **Network failure on submit.** The submit fails; the screen stays on the count view with the typed amount preserved so the operator can retry without recounting.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST surface `/end-of-day` as the End of Day Cash Count page for authenticated owner/manager-role staff. Technician-role staff MUST NOT be able to access or close out a cash drawer session.
- **FR-002**: System MUST list every cash payment for the current business day in the left panel, in time order, showing time, client name, service summary (single name, two joined by `+`, or `first +N`), tech pill(s), total amount, and tip amount when greater than zero.
- **FR-003**: System MUST compute and display an **expected cash total** equal to (sum of today's completed cash payments) − (sum of today's completed cash refunds). Cash refunds MUST appear as their own rows in the left list, in time order interleaved with sales, with the total formatted as `−$X.XX` in destructive color and a `Refund` label in the meta line; the on-screen list rows MUST sum to the expected total displayed in the footer.
- **FR-004**: System MUST provide a numpad supporting digits 0–9, a single decimal point, backspace, and a Clear action. The numpad MUST enforce at most one decimal point and at most two decimal places.
- **FR-005**: System MUST show a live comparison block of Expected, Counted, and Difference. The Difference label MUST read "Exact match" (within $0.005), "Over +$X.XX", or "Short −$X.XX". Border and text colors MUST match the Lacquer system tokens: success for exact, warning for over, destructive for short.
- **FR-006**: System MUST disable the **Close Out Day** button until a counted amount has been entered. When a non-zero variance is present (over or short), the button MUST stay disabled until a non-empty discrepancy note has been provided.
- **FR-007**: System MUST persist the close action as a closed cash drawer session row, recording: who closed it, the close timestamp, the expected total, the counted total, the variance, and the note text. The audit log MUST record the close action with the same actor/operator attribution used elsewhere in the app.
- **FR-008**: System MUST be idempotent across concurrent close attempts: only one cash drawer session per business day can transition to closed. A second attempt MUST receive a clear "already closed" response and the UI MUST show the closed-state confirmation.
- **FR-009**: After a successful close, the system MUST show a confirmation screen displaying expected, counted, difference (with sign + color matching the state), the close timestamp, and the operator-entered note (if any). The header status pill MUST switch from "Open" to "Closed."
- **FR-010**: The current open cash drawer session is opened automatically with `opening_cents = 0` on first need (either the first completed cash payment of the business day, or first open of `/end-of-day`, whichever comes first). v1 does not surface any opening-cash-count UI; the column is recorded explicitly as `0` so a future "Open the day with $X" feature is purely additive.
- **FR-011**: System MUST format every dollar amount with two decimals and tabular numerals on the count screen, matching the Lacquer design system tokens for typography and spacing.
- **FR-012**: On submit, the system MUST recompute the expected cash total server-side from current data and compare it to the snapshot the operator was looking at. If the values differ, the close MUST be rejected, the page MUST reload with the new expected total, and a one-time banner MUST inform the operator that a new cash payment was recorded and they need to recount.

### Key Entities

- **Cash drawer session**: One row per (salon, business day). Holds the open-time actor, the close-time actor, the opening float, the expected close amount, the counted amount, the variance, and the optional explanation note. At most one session per business day can be in the open state at a time.
- **Cash payment**: A `payments` row with method `cash` and status `succeeded`, taken on the current business day. The screen reads these to compute the expected total and to populate the transaction list.
- **Cash refund**: A `payments` row with `kind = refund`, method `cash`, and status `succeeded`, taken on the current business day. These reduce the expected total.
- **Audit log entry**: One row recording the `cash_drawer.closed` action, the operator (acting_as_staff_id), the device user (auth.uid()), and a payload snapshot of `{expected_cents, counted_cents, variance_cents, notes}`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can open the page, enter the counted amount, and close the day in **under 90 seconds** when there is no variance.
- **SC-002**: When the counted amount differs from the expected total, the comparison block updates within **150 milliseconds** of each numpad keystroke (no perceptible lag).
- **SC-003**: Every cash-drawer close in production is accompanied by a non-empty note **whenever the variance is non-zero**, with no exceptions traceable to UI bypass — verified by a database audit at end of first month showing zero non-zero-variance rows with empty `notes`.
- **SC-004**: When an owner audits a closed day a week later, they can reconstruct from the cash drawer session row and the day's cash payment list exactly how the expected total was computed — i.e. the on-screen list and the persisted total agree to the cent.

## Assumptions

- Out of scope for this feature: the salon-wide **day report** (totals by payment method and by staff) and the **tip-allocation review** tab, both of which the system design lists under "End of Day" but the user prompt scoped to just the cash count screen. Those will be separate features.
- Out of scope: opening-shift cash count UI. The opening cash float for v1 is whatever the data model records; the design prototype does not include an opening-count flow, so this spec inherits that omission.
- Out of scope: PIN-gating the close action. The page is access-controlled by role (owner/manager only); the close itself does not require a re-PIN, consistent with how other manager-only studio screens behave.
- The "business day" is defined by the salon's configured timezone (the same `salon.timezone` setting the dashboard uses). All "today" boundaries on this screen agree with that setting.
- The prototype's status pill copy ("Open · Closing at 8 PM") is illustrative — actual closing time can be derived from settings; for v1, showing "Open" or "Closed" is sufficient and the closing time string can be omitted if no closing-time setting exists.
- Reuses the Lacquer design tokens, the existing tech-pill component used on the dashboard recent-transactions feed, and the existing currency/time formatters from `lib/time/format.ts` and the dashboard's currency helpers.
- The Square integration's separation of "succeeded" vs "pending" payments is already in place; this screen reads only `status = succeeded` rows.
- This feature does **not** modify how cash payments are created or refunded; it only reads existing `payments` rows and writes one `cash_drawer_sessions` row plus an audit entry on close.
