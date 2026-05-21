# Feature Specification: Payroll Page

**Feature Branch**: `047-payroll-page`

**Created**: 2026-05-20

**Status**: Draft

**Input**: User description: "Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/1x0tvSl2wSD8a6U1UnkbCw?open_file=prototypes%2Fpayroll%2FPayroll.html — Implement: prototypes/payroll/Payroll.html. Make sure you copy the design prototype into a design system / prototypes folder in a repo as well. And there should be a dedicated menu item called payroll in the side menu as well for this."

## Overview

Tang Nails runs payroll **twice a month** — once for the 1st–15th and once for the 16th–end of month. Today the owner does this in a spreadsheet: total each tech's service income and card tips for the period, apply that tech's commission and tip-split percentages, subtract the portion paid by physical check, hand over the remainder in cash, and tick each tech off as paid. This feature replaces that spreadsheet with a dedicated **Payroll** page inside the app.

The page presents every tech for the open pay period as a single full-width ledger. Selecting any tech opens a dedicated detail screen with a large daily-activity chart, a plain-language earnings breakdown, and the pay action. The owner records each payout (cash, Zelle, or check), then closes the period — locking the numbers and adding it to payroll history.

The design source is the **Lacquer "Payroll" handoff** from Claude Design; the implemented layout follows **Variation 3 — "Pulse"** (full-width ledger + dedicated per-tech detail screen), which is where the design conversation landed.

## Clarifications

### Session 2026-05-20

- Q: What income should a tech's service commission % be applied to? → A: Commissionable service income — gross service revenue net of supply and card-processing-fee deductions, honoring staff payout exemptions (spec 023), reusing the Report page's per-tech deduction math.
- Q: Which payroll actions should managers (not just owners) be allowed to perform? → A: Managers can view periods, record payouts (mark paid / undo), and export; editing per-tech pay rates and closing a pay period are restricted to owners.
- Q: After a tech is marked paid in an open period, what happens to their payout figure if a rate changes or a ticket is edited/refunded? → A: The payout freezes a snapshot of its computed figures at the moment of payment; later rate or ticket changes never alter a paid payout's recorded amount. Only techs still pending recompute live.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review the open pay period's payroll ledger (Priority: P1)

The owner opens **Payroll** from the side navigation. The page loads the most recent open pay period and shows a full-width ledger with one row per active tech: the tech's name, role, and rates; ticket count; gross service income; income after commission split; card tips; tips after split; the check portion; and the cash payment owed. A summary header states the period dates, pay date, total cash still to hand out, and how many techs have been paid. KPI cards above the ledger total the period's gross service income, card tips collected, amount owed to techs, and payment progress. A footer row totals every column.

**Why this priority**: This is the cornerstone. Seeing every tech's earnings for the period in one accurate, scannable view is the whole reason the spreadsheet exists. With only this story shipped, the owner already has a viable replacement for the manual calculation.

**Independent Test**: Open Payroll from the menu as an owner, confirm the ledger lists every active tech with computed income, after-split, tips, after-split, check, and cash values that match a hand calculation, and that the KPI cards and footer totals reconcile to the sum of the rows.

**Acceptance Scenarios**:

1. **Given** an open pay period with completed tickets attributed to techs, **When** the owner opens the Payroll page, **Then** the ledger shows one row per active tech with that tech's service income, income after split, card tips, tips after split, check portion, and cash payment.
2. **Given** the loaded ledger, **When** the owner reads the KPI cards and footer, **Then** the period totals for gross service income, card tips, amount owed, and progress equal the sums of the individual tech rows.
3. **Given** a tech who booked no tickets in the period (or is on leave), **When** the ledger renders, **Then** that tech's row shows a "No work" state and is excluded from the count of techs still to pay.
4. **Given** the ledger, **When** the owner switches the All techs / To pay / Paid filter, **Then** the visible rows update to match the selected filter.
5. **Given** the ledger, **When** the owner exports the period to CSV, **Then** a file is produced containing every tech row and the period totals.

---

### User Story 2 - Open a tech's detail screen (Priority: P2)

From the ledger, the owner clicks any tech's row. The whole view switches to a dedicated full-screen detail for that tech: a back control returning to the ledger, previous/next controls to move between techs, a header with the tech's state and a prominent "cash to hand over" figure, a large daily-activity chart (one column per day showing service income and card tips, with the best day highlighted and closed days marked), quick stats (best day, average per working day, cash tips), and a plain-language earnings breakdown.

**Why this priority**: The detail screen is the defining move of the chosen "Pulse" design — it gives the daily-activity chart and the earnings breakdown room to breathe instead of competing with the ledger. It turns the ledger from a summary into a reviewable, defensible record before money changes hands.

**Independent Test**: Click a tech row in the ledger, confirm a dedicated detail screen opens with that tech's daily-activity chart, quick stats, and earnings breakdown; use previous/next to move between techs and back to return to the ledger.

**Acceptance Scenarios**:

1. **Given** the payroll ledger, **When** the owner clicks a tech's row, **Then** a dedicated detail screen for that tech opens showing the daily-activity chart, quick stats, and earnings breakdown.
2. **Given** a tech detail screen, **When** the owner uses the previous/next controls, **Then** the screen moves to the adjacent tech in the ledger order, and the controls are disabled at the first/last tech.
3. **Given** a tech detail screen, **When** the owner selects "back", **Then** the ledger reappears with its prior scroll and filter state intact.
4. **Given** a tech with no tickets this period, **When** their detail screen opens, **Then** it states that no tickets were booked (and notes "on leave" where applicable) instead of an empty chart.
5. **Given** any tech detail screen, **When** the breakdown renders, **Then** it shows service income (with the % applied), card tips (with the % applied), total earned, check portion subtracted, and the resulting cash payment.

---

### User Story 3 - Mark a tech paid and record the payment method (Priority: P3)

On a tech's detail screen, an owner or manager chooses a payment method — cash, Zelle, or check — and marks the tech paid. The payout is recorded durably: method, pay date, and who recorded it. The tech's state becomes "Paid" everywhere it appears, a confirmation/receipt is shown, and the period's progress and cash-remaining figures update. An owner or manager can undo a payout, returning the tech to "Pending".

**Why this priority**: Recording who has been paid, how, and when is what makes this a system of record rather than a calculator. It is the action the twice-monthly routine is built around, and it must survive reloads and be visible to anyone who opens the period later.

**Independent Test**: On a pending tech's detail screen, pick a payment method, mark the tech paid, reload the page, and confirm the tech still shows "Paid" with the recorded method and date; then undo and confirm the tech returns to "Pending".

**Acceptance Scenarios**:

1. **Given** a pending tech, **When** the owner selects a payment method and marks them paid, **Then** the tech's state becomes "Paid", the method and pay date are recorded, and a confirmation is shown.
2. **Given** a tech marked paid, **When** the owner reloads the Payroll page or another manager opens it, **Then** the tech still shows "Paid" with the same method and date.
3. **Given** a tech marked paid, **When** the owner selects "undo", **Then** the tech returns to "Pending" and the period progress and cash-remaining figures update accordingly.
4. **Given** any payout action (mark paid or undo), **When** it completes, **Then** it is recorded in the activity/audit history with the acting user.
5. **Given** a tech with a "No work" state, **When** the owner views their row or detail, **Then** no pay action is offered.

---

### User Story 4 - Close a pay period and browse payroll history (Priority: P4)

When every tech for the open period has been paid (or accounted for), the owner closes the period. Closing locks the period — its figures and payout records become read-only. The closed period joins payroll history. A period switcher and a History view let the owner move between the open period and any past period to review what was paid, the pay date, and who closed it.

**Why this priority**: Closing turns a period into a permanent record and prevents accidental edits to settled pay. History gives the owner the "what did we pay last cycle" lookup the spreadsheet's old tabs provided. It depends on the ledger and payouts existing first.

**Independent Test**: With all techs paid in the open period, close the period, confirm it becomes read-only, then use the period switcher / History to reopen it and confirm the figures are unchanged.

**Acceptance Scenarios**:

1. **Given** an open period, **When** the owner closes it, **Then** the period's status becomes "closed", its payout records become read-only, and the close is attributed to the acting user with a timestamp.
2. **Given** an open period with techs still unpaid, **When** the owner attempts to close it, **Then** the system warns about the unpaid techs and requires explicit confirmation before closing.
3. **Given** a closed period, **When** the owner views it, **Then** every figure and payout matches what it was at close and no pay/undo actions are available.
4. **Given** several past periods, **When** the owner opens the period switcher or History view, **Then** each period is listed with its dates, pay date, total paid, and who closed it, and can be opened for review.
5. **Given** the open period, **When** the owner opens Payroll, **Then** the open period is selected by default rather than a closed one.

---

### User Story 5 - Configure per-tech payroll rates in Staff settings (Priority: P5)

In Staff settings, each staff member gains editable payroll fields: the **service commission %** (share of service income the tech keeps), the **tip split %** (share of their card tips the tech keeps), and the **check portion** (the dollar amount paid each period by physical check as W-2 wage). The owner sets these per tech; the Payroll page uses them to compute earnings. Changing a rate updates the open period's figures; closed periods keep the rates that were in effect when they were closed.

**Why this priority**: Correct rates are what make payroll figures trustworthy, but the page is demonstrable with seeded defaults, so making the rates owner-editable is the final hardening step rather than a blocker for the earlier stories.

**Independent Test**: In Staff settings, change a tech's service commission %, return to the open period's Payroll page, and confirm that tech's "income after split" and cash payment recompute to match the new rate.

**Acceptance Scenarios**:

1. **Given** a staff member in Staff settings, **When** the owner views their record, **Then** editable fields for service commission %, tip split %, and check portion are shown.
2. **Given** a staff member's payroll fields, **When** the owner saves a new service commission % or tip split %, **Then** the open period's Payroll ledger recomputes that tech's after-split and cash figures using the new rate.
3. **Given** an invalid entry (a percentage outside 0–100% or a negative check portion), **When** the owner attempts to save, **Then** the change is rejected with a clear validation message.
4. **Given** a closed period, **When** a tech's rate is later changed, **Then** the closed period's figures do not change.
5. **Given** a rate change, **When** it is saved, **Then** it is recorded in the activity/audit history with the acting user.

---

### Edge Cases

- **No completed tickets in the period**: the ledger shows every active tech with zero figures and a "No work" state; KPI cards and totals show zero.
- **Check portion exceeds earnings**: the cash payment is clamped to zero (never negative); the breakdown still shows the full check portion.
- **Tech added mid-period**: they appear in the open period's ledger with figures for the days they worked.
- **A counted ticket is later refunded or voided**: the open period's figures reflect the current state of tickets; once a period is closed its figures are frozen regardless of later ticket changes.
- **Rate or ticket change after a tech is already paid**: a paid payout's figures are snapshotted at the moment of payment and never change; only techs still pending recompute live. Closing the period then freezes the pending techs' figures as well.
- **Closing a period with unpaid techs**: allowed only after an explicit confirmation that names the unpaid techs.
- **Two managers acting on the same tech at once**: the first mark-paid wins; a concurrent second attempt is rejected with an "already paid" message, and both users see a consistent state on reload.
- **Viewing a closed/historical period**: all pay, undo, and close actions are disabled; the view is read-only.
- **Cash tips**: never recorded by the system — they pass directly from client to tech — and never appear in payroll figures.
- **A non-owner/non-manager opening the Payroll URL directly**: access is denied and the user is redirected, consistent with the Report and Transactions pages.

## Requirements *(mandatory)*

### Functional Requirements

**Navigation & access**

- **FR-001**: The side navigation MUST include a dedicated **Payroll** item (in the Operations group, alongside End of Day Cash and Report) that opens the Payroll page.
- **FR-002**: The Payroll page MUST be restricted to owner and manager roles; other roles attempting to reach it MUST be denied access and redirected, consistent with the Report and Transactions pages. Within the page, managers MAY view periods, record payouts (mark paid / undo), and export; **editing per-tech pay rates and closing a pay period MUST be restricted to owners**.

**Pay periods**

- **FR-003**: The system MUST organize payroll into twice-monthly pay periods: the 1st through the 15th, and the 16th through the last day of each month.
- **FR-004**: Each pay period MUST have a label, a start date, an end date, a pay date, and a status of either "open" or "closed".
- **FR-005**: When the Payroll page is opened without a specific period selected, it MUST default to the most recent open period.
- **FR-006**: The owner MUST be able to switch between the open period and past periods, and to browse a History view listing past periods with their dates, pay date, total paid, and the user who closed them.

**Earnings calculation**

- **FR-007**: For each tech and pay period, the system MUST derive the tech's **commissionable service income** and card tips from completed (paid) tickets in that period attributed to the tech. Commissionable service income is gross service revenue less supply and card-processing-fee deductions, honoring that tech's payout exemptions (per spec 023), reusing the Report page's per-tech deduction math.
- **FR-008**: The system MUST compute a tech's earnings as `(commissionable service income × service commission %) + (card tips × tip split %)`.
- **FR-009**: The system MUST compute the cash payment as `total earnings − check portion`, clamped so it is never negative.
- **FR-010**: The system MUST NOT include cash tips in any payroll figure (cash tips are handed directly from client to tech and are not recorded).
- **FR-011**: A tech whose computed earnings for the period are zero (no tickets, or on leave) MUST be shown with a "No work" state and excluded from the count of techs still to pay.

**Ledger view**

- **FR-012**: The Payroll page MUST present a full-width ledger with one row per active tech showing: name and avatar, role, service commission % and tip split %, ticket count, commissionable service income (net of supply and card-fee deductions), income after split, card tips, tips after split, check portion, cash payment, and a state badge (Pending, Paid, or No work).
- **FR-013**: The ledger MUST include a footer row totaling every numeric column for the period.
- **FR-014**: The page MUST display KPI summary cards for the period: gross service income (with ticket count), card tips collected, amount owed to techs (split into check and cash), and progress (techs paid out of techs eligible).
- **FR-015**: The page header MUST show the period label, pay date, total cash still to hand out, and the paid/eligible tech count.
- **FR-016**: The ledger MUST offer All techs / To pay / Paid filters that change which rows are shown.
- **FR-017**: The owner MUST be able to export the selected period's ledger to a CSV file.

**Tech detail screen**

- **FR-018**: Selecting a tech's ledger row MUST open a dedicated full-screen detail view for that tech.
- **FR-019**: The tech detail view MUST provide a "back" control returning to the ledger with its prior scroll and filter state, and previous/next controls to move between techs (disabled at the first/last tech).
- **FR-020**: The tech detail view MUST show the tech's header with state badge and a prominent "cash to hand over" figure.
- **FR-021**: The tech detail view MUST show a daily-activity chart with one column per day of the period, depicting service income and card tips, marking days with no activity for that tech (zero service income and zero card tips — a per-tech heuristic, not coupled to salon-hours data), and highlighting the tech's best day.
- **FR-022**: The tech detail view MUST show quick stats: best day, average per working day, and cash tips (noted as not recorded).
- **FR-023**: The tech detail view MUST show an earnings breakdown: service income with the commission % applied, card tips with the tip % applied, total earned, check portion subtracted, and the resulting cash payment.

**Recording payouts**

- **FR-024**: From a tech's detail view, an owner or manager MUST be able to mark that tech paid, selecting a payment method of cash, Zelle, or check.
- **FR-025**: A recorded payout MUST persist the payment method, the pay date, the user who recorded it, and a snapshot of the tech's computed payroll figures (commissionable income, after-split amounts, check portion, cash payment) taken at the moment of payment. These recorded figures MUST NOT change in response to later rate changes or ticket edits/refunds — only techs still pending recompute live. The payout MUST survive page reloads and be visible to other owners/managers.
- **FR-026**: Marking a tech paid MUST show a confirmation/receipt and update the tech's state to "Paid" everywhere it appears, along with the period's progress and cash-remaining figures.
- **FR-027**: An owner or manager MUST be able to undo a payout, returning the tech to "Pending" — discarding the payment snapshot so the tech recomputes live again — and updating the period figures.
- **FR-028**: No pay or undo action MUST be offered for a tech in the "No work" state, or for any tech in a closed period.

**Closing a period**

- **FR-029**: Closing the open pay period MUST be restricted to owners; closing MUST set its status to "closed", make its figures and payouts read-only, and record the closing user and timestamp.
- **FR-030**: If techs remain unpaid when the owner attempts to close a period, the system MUST warn — naming the unpaid techs — and require explicit confirmation before closing.
- **FR-031**: A closed period MUST display the same figures and payout records it had at the moment of close, regardless of later changes to tickets or rates.

**Per-tech rate configuration**

- **FR-032**: Each staff member MUST have configurable payroll fields: service commission %, tip split %, and check portion.
- **FR-033**: Editing a staff member's payroll fields in Staff settings MUST be restricted to owners, with validation that percentages fall within 0–100% and the check portion is not negative.
- **FR-034**: A change to a tech's rates MUST update the open period's computed figures, while closed periods retain the rates that were in effect when they were closed.

**Auditability**

- **FR-035**: Every payroll action — mark paid, undo, close period, and rate change — MUST be recorded in the application's activity/audit history with the acting user and a timestamp.

**Design source of truth**

- **FR-036**: The Lacquer "Payroll" design prototype that defines this page MUST be preserved in the repository's design-system reference library (under `design-system/prototypes/payroll/`), alongside the other vendored prototypes, so future UI work can be compared against it.

### Key Entities *(include if feature involves data)*

- **Pay period**: a twice-monthly payroll window (1st–15th or 16th–end of month). Attributes: label, start date, end date, pay date, status (open / closed), and — once closed — the closing user and timestamp.
- **Tech payout**: one tech's payroll outcome for one pay period. Attributes: the tech, the period, the computed figures (commissionable service income, income after split, card tips, tips after split, check portion, cash payment), state (Pending / Paid / No work), and — once paid — the payment method, pay date, recording user, and a frozen snapshot of the computed figures taken at payment. Pending payouts recompute live; closing the period freezes any still-pending figures as well.
- **Per-tech pay rates**: the compensation terms held against each staff member — service commission %, tip split %, and check portion — used to compute that tech's payouts.
- **Tech daily activity**: per-day service income, card tips, and ticket count for a tech within a period, derived from completed tickets and used to render the daily-activity chart and quick stats.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can open the Payroll page from the side navigation and see the open period's complete per-tech ledger in under 2 seconds.
- **SC-002**: For any given pay period, every per-tech figure and every period total shown on the page matches an independent hand calculation to the cent.
- **SC-003**: An owner can review and mark every tech paid for a pay period in under 5 minutes — a clear improvement over the spreadsheet routine.
- **SC-004**: 100% of recorded payouts (method, pay date, recording user) remain correct and visible after a page reload, after the period is closed, and on a later visit by a different owner/manager.
- **SC-005**: 100% of attempts to reach the Payroll page by a non-owner/non-manager are denied, and 100% of attempts by a manager to edit a pay rate or close a period are denied.
- **SC-006**: After a period is closed, reopening it for review shows figures identical to those at the moment of close, even after subsequent ticket or rate changes.
- **SC-007**: Changing a tech's service commission % or tip split % in Staff settings is reflected in the open period's computed figures with no further action beyond saving.

## Assumptions

- **Layout**: The implemented page follows **Variation 3 — "Pulse"** from the Lacquer "Payroll" handoff (full-width ledger plus a dedicated per-tech detail screen). Confirmed with the requester; Variations 1 (Ledger) and 2 (Drafts) are not built.
- **Persistence**: Payroll is a full system of record — pay periods, payouts, period closes, and history persist durably. Confirmed with the requester.
- **Rate home**: Per-tech rates live on each staff member and are edited in Staff settings. Confirmed with the requester.
- **Pay cycle**: Pay periods are semi-monthly (1st–15th and 16th–end of month), matching the salon's existing practice; the pay date is shortly after the period ends.
- **Income basis**: The "service income" feeding the commission calculation is **commissionable service income** — gross service revenue from completed tickets attributed to the tech, less supply and card-processing-fee deductions and honoring that tech's payout exemptions (spec 023) — reusing the Report page's per-tech deduction math. (Clarified 2026-05-20.) The salon-level "Gross service income" KPI remains a gross top-line figure.
- **Card tips per tech**: Card tips are attributed to techs from existing per-payment tip-split data; cash tips are never recorded.
- **Seeded rates before US5**: User Stories 1–4 are demonstrable with seeded per-tech rate values; User Story 5 makes those rates owner-editable. The page does not block on US5.
- **Pay stubs**: The prototype references pay stubs ("stub sent automatically", "resend pay stub"). Generating and emailing actual pay stubs is **out of scope for v1**; the in-app paid confirmation/receipt is in scope.
- **Cash drawer**: Paying a tech in cash does **not** automatically adjust the End-of-Day cash drawer balance in v1; cash-drawer reconciliation remains a separate feature.
- **Reopening periods**: Once closed, a period stays read-only; reopening a closed period is out of scope for v1.
- **Single salon, single currency**: All amounts are USD for one salon location.

## Dependencies

- Existing completed-ticket, payment, and per-payment tip-split data, which supply per-tech service income and card tips for any date range.
- The Report page's per-tech deduction logic (supply and card-processing-fee deductions, staff payout exemptions), reused to derive commissionable service income.
- Existing staff records and the owner/manager/tech role model.
- The existing Staff settings surface, extended with the per-tech payroll rate fields.
- The Lacquer design system and the existing side-navigation, Report, and Transactions page patterns, reused for layout and access control.
- The application's activity/audit history, where payroll actions are recorded.
