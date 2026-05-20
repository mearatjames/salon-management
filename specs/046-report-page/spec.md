# Feature Specification: Report Page

**Feature Branch**: `046-report-page`

**Created**: 2026-05-20

**Status**: Draft

**Input**: User description: "Fetch this design file, read its readme, and implement the relevant aspects of the design. Implement: prototypes/transaction/Day Report.html — This new page is mainly used to seeing the details about how each staff earn and what deductions are. Note that we just call Report now instead of Day Report. Make sure you copy this prototype over into our design system prototypes folder."

## Overview

The **Report** page (formerly named "Day Report" in the prototype) is a new owner/manager surface that answers one question for every shift: **how much did each technician earn, and what was deducted from those earnings?** It shows, per technician and per transaction, the gross amount worked, the card-processing-fee and supply deductions applied, the commissionable (net) amount that remains, and the card tips received. It complements the existing Transactions page — the same period chrome and visual family — but reframes the day around people and payouts rather than individual sales.

The design source of truth is `design-system/prototypes/transaction/Day Report.html` (and `DayReport.jsx`, `day-report-page.css`), copied into the repository as part of this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See all-staff earnings and deductions for the day (Priority: P1)

The salon owner opens the Report page at the end of a shift. Without any further interaction, they see every technician who worked that day in a single overview table: how many services each performed, their gross earnings, how much was taken in card fees, how much in supply costs, what remains commissionable, and their card tips. A totals row reconciles the whole salon, and a summary strip shows period gross revenue, total deductions, and total card tips.

**Why this priority**: This is the core purpose of the page — "see the details about how each staff earn and what deductions are." It delivers a complete, viable surface on its own: an owner can run payroll-prep decisions from the overview alone, even before any drill-down exists.

**Independent Test**: Open the Report page as an owner on a day with seeded transactions. Confirm the all-staff table lists every technician with services, gross, card-fee deduction, supply deduction, commissionable, and card tips; confirm the totals row equals the sum of the rows; confirm the summary strip matches.

**Acceptance Scenarios**:

1. **Given** a day with paid transactions across several technicians, **When** an owner opens the Report page, **Then** the all-staff overview lists each of those technicians with their services count, gross, card-fee deduction, supply deduction, commissionable amount, and card tips.
2. **Given** the all-staff overview is shown, **When** the owner reads the totals row, **Then** each total exactly equals the sum of the corresponding column across all technician rows.
3. **Given** a technician who is fully exempt from deductions, **When** the overview renders, **Then** that technician's deduction cells show a no-deduction indicator and their commissionable amount equals their gross.
4. **Given** a manager (not an owner) opens the page, **When** it loads, **Then** they see the same report; **Given** a technician or front-desk user attempts to open it, **Then** they are not granted access.

---

### User Story 2 - Drill into one technician's transactions (Priority: P2)

The owner notices one technician's deductions look high and wants to understand why. They select that technician from the left-hand list and the right panel switches to a transaction-by-transaction view: each sale that technician worked, with its time, client, services, gross, card-fee deduction, supply deduction, net, and payment method, plus a per-technician totals row and header summary.

**Why this priority**: Turns the aggregate into something investigable. Without it, the owner can see *that* deductions happened but not *which sales* drove them. Builds directly on the P1 left-hand navigation.

**Independent Test**: With the page open, click a technician in the left list and confirm the right panel shows only that technician's transactions for the period, with correct per-transaction gross, deductions, and net, and a totals row that matches the technician's row in the all-staff overview.

**Acceptance Scenarios**:

1. **Given** the all-staff overview is shown, **When** the owner selects a technician from the left list, **Then** the right panel shows that technician's transactions for the period.
2. **Given** a technician's detail view is shown, **When** the owner reads the per-transaction rows, **Then** each row shows time, client, services, gross, card-fee deduction, supply deduction, net, and payment method.
3. **Given** an exempt technician is selected, **When** the detail view renders, **Then** the deduction columns are omitted and every transaction's net equals its gross.
4. **Given** a technician's detail view is shown, **When** the owner selects "All Staff" again, **Then** the overview returns.

---

### User Story 3 - Expand a transaction to see its deduction breakdown (Priority: P3)

Inside a technician's detail view, the owner clicks a transaction row and it expands to reveal exactly which deductions were applied: each card fee tied to a named service, each supply cost tied to a named service, the total deducted, and any card tip received with its tip percentage.

**Why this priority**: This is the finest grain of "what deductions are" — it makes every dollar traceable to a service and a rule. Valuable, but the page is already useful without it.

**Independent Test**: In a technician's detail view, click a transaction that has deductions and confirm it expands to itemized deduction lines whose amounts sum to the transaction's total deduction, plus a card-tip line when a card tip applies.

**Acceptance Scenarios**:

1. **Given** a transaction row with at least one deduction, **When** the owner clicks it, **Then** the row expands to show one line per deduction (type, service name, amount) and a "total deducted" line.
2. **Given** an expanded transaction whose payment included a card tip, **When** the breakdown renders, **Then** it shows the card-tip amount and the tip percentage.
3. **Given** a transaction with no deductions and no card tip, **When** the owner views the row, **Then** it is not expandable.
4. **Given** an expanded row, **When** the owner clicks it again, **Then** it collapses.

---

### User Story 4 - Change the reporting period (Priority: P4)

The owner wants last week's numbers, or the current pay period. They switch the period control between Day, Week, and Semi-monthly, and step backward or forward through periods with the range arrows. The report and all totals update to the chosen range, which is always shown as a readable label.

**Why this priority**: Extends the page beyond "today." Important for payroll runs, but the P1–P3 slices are fully functional for the current day without it.

**Independent Test**: With the page open on the current day, switch to Week and to Semi-monthly, step to the previous period, and confirm the report contents and the range label update consistently for each selection.

**Acceptance Scenarios**:

1. **Given** the page is open, **When** the owner selects Day, Week, or Semi-monthly, **Then** the report recalculates for that period granularity and the range label updates.
2. **Given** any period granularity, **When** the owner steps to the previous or next period, **Then** the report shows that period's data and label.
3. **Given** Semi-monthly is selected, **When** a period is shown, **Then** it covers either the 1st–15th or the 16th–end of the month.
4. **Given** a period with no transactions, **When** it is selected, **Then** an empty state is shown rather than an error.

---

### User Story 5 - Print and export the report (Priority: P5)

The owner needs the report on paper for their files, or as a spreadsheet for their accountant. They use the Print action to produce a clean printout with no application chrome, or the Export action to download the per-technician summary as a CSV.

**Why this priority**: A convenience for record-keeping and handoff to a bookkeeper. Entirely additive — the page delivers its value on-screen without it.

**Independent Test**: Use the Print action and confirm the printed output excludes the sidebar, top bar, and action buttons. Use the Export action and confirm a CSV downloads containing every technician row plus the totals row, matching on-screen values.

**Acceptance Scenarios**:

1. **Given** the report is shown, **When** the owner prints, **Then** the printed output contains the report content without the sidebar, top bar, or action buttons.
2. **Given** the report is shown, **When** the owner exports, **Then** a CSV file downloads containing one row per technician plus a totals row, with services, gross, card fee, supply, total deductions, commissionable, and card tips.
3. **Given** an exported CSV, **When** its values are compared to the on-screen overview, **Then** they match exactly.

---

### Edge Cases

- **Empty period**: A day, week, or semi-monthly period with no paid transactions shows an empty state, not a blank table or an error.
- **Technician with only non-service items**: A technician who appears on a transaction only via a discount or product line (no service) does not appear in the report.
- **Future period**: Stepping forward past today shows an empty state.
- **Split payment**: A transaction settled partly by card or gift card and partly by cash still incurs card-processing-fee deductions on its services.
- **Partially exempt technician**: A technician exempt from some supply types but not others shows deductions only for the non-exempt supply types and for card fees (unless also card-fee-exempt).
- **Multi-technician transaction**: Services and deductions are attributed to the technician who performed each service; the transaction's card tip is split across its technicians proportionally to each one's service subtotal.
- **Inactive or removed technician with past activity**: A technician who has since left still appears in any past period where they had transactions.
- **Zero and negative display**: A zero deduction is shown as a neutral dash; an applied deduction is shown as a negative amount.
- **Long service lists**: A transaction with many services truncates the service list within its row without breaking layout.
- **Rounding**: Proportionally split tips and any per-line rounding never cause a technician's parts to drift from the transaction or period totals.

## Requirements *(mandatory)*

### Functional Requirements

**Navigation & access**

- **FR-001**: The system MUST provide a "Report" page reachable from the studio sidebar's Operations group, replacing the current disabled "Day Report" placeholder, and MUST mark that nav item active when the page is open.
- **FR-002**: The system MUST restrict the Report page to owner and manager roles; technician and front-desk users MUST NOT be able to view it.
- **FR-003**: The Report page MUST present a header with the title "Report", a one-line description of the page's purpose, and Print and Export actions.

**Reporting period**

- **FR-004**: The system MUST let the user view the report by Day, Week, or Semi-monthly period, defaulting to the current day on first load.
- **FR-005**: The system MUST let the user step to the previous or next period and MUST display a human-readable label for the selected range.
- **FR-006**: A Semi-monthly period MUST cover either the 1st through the 15th, or the 16th through the last day, of the selected month.

**Data scope**

- **FR-007**: The report MUST include only completed (paid) transactions whose closing time falls within the selected period.
- **FR-008**: The system MUST attribute each service in a transaction to the technician who performed it; a transaction worked by multiple technicians MUST be split across them by the services each performed.
- **FR-009**: Non-service line items (discounts, products) MUST be excluded from technician gross earnings and from deductions.
- **FR-010**: A technician with no services in the selected period MUST be omitted from the report.

**Per-technician aggregation**

- **FR-011**: For each technician with at least one service in the period, the report MUST compute: count of transactions, count of services, gross earnings (sum of service prices performed), total card-fee deductions, total supply deductions, total deductions, commissionable earnings, and card tips.
- **FR-012**: Commissionable earnings MUST equal gross earnings minus total deductions and MUST never be presented as a final payout amount (the technician/salon commission split is out of scope).

**Deduction rules**

- **FR-013**: For a service in a transaction settled wholly or partly by card or gift card, the report MUST deduct that service's card-processing fee — the salon default fee, a per-service custom amount, or zero when the service is configured as card-fee-exempt — from the performing technician's earnings.
- **FR-014**: A transaction settled entirely in cash MUST NOT incur any card-processing-fee deduction.
- **FR-015**: For a service that has an associated supply cost, the report MUST deduct that supply cost from the performing technician's earnings.
- **FR-016**: When a technician is exempt from card-processing fees, the report MUST NOT deduct any card fee for that technician.
- **FR-017**: When a technician is fully exempt from supply deductions, the report MUST NOT deduct any supply cost; when a technician is partially exempt, the report MUST skip only the supply types on that technician's exemption list and still apply all others.
- **FR-018**: A technician with no deductions applied MUST be shown with a clear exempt / "no deductions" indicator, and their commissionable earnings MUST equal their gross.

**Tips**

- **FR-019**: The report MUST report only tips paid by card or gift card; cash tips MUST NOT appear in the report (they are kept directly by the technician).
- **FR-020**: A transaction's card tip MUST be attributed across its technicians in proportion to each technician's share of the transaction's service subtotal.

**All-staff overview**

- **FR-021**: The report MUST present an "All Staff" overview that lists every reported technician with services count, gross, card-fee deduction, supply deduction, commissionable amount, and card tips, plus a totals row whose every value equals the sum of the technician rows.
- **FR-022**: The all-staff overview MUST show a period summary of gross revenue, total deductions (itemized into card and supply), and total card tips.
- **FR-023**: The all-staff overview MUST include a legend that explains the card-fee and supply deduction rules and what "exempt" means.

**Per-technician detail**

- **FR-024**: Selecting a technician MUST show that technician's transactions for the period, each row showing time, client, services, gross, card-fee deduction, supply deduction, net, and payment method, plus a per-technician totals row and a header summary of gross, deductions, commissionable, and card tips.
- **FR-025**: For an exempt technician, the per-transaction table MUST omit the deduction columns and every transaction's net MUST equal its gross.

**Transaction breakdown**

- **FR-026**: A transaction row that has at least one deduction or a card tip MUST be expandable to reveal each deduction line (type, related service, amount), a "total deducted" line, and any card tip with its tip percentage; a row with neither MUST NOT be expandable.

**Print & export**

- **FR-027**: The user MUST be able to print the report, and the printed output MUST exclude the sidebar, top bar, and action buttons.
- **FR-028**: The user MUST be able to export the per-technician summary — every technician row plus the totals row — as a downloadable CSV file whose values match the on-screen overview.

**Presentation & consistency**

- **FR-029**: When the selected period has no transactions, the report MUST show an empty state rather than an error or a blank table.
- **FR-030**: The report's gross revenue and transaction count for a given day MUST match the Transactions page for the same day.
- **FR-031**: All monetary and numeric values MUST use tabular numerals and consistent currency formatting, and the page MUST follow the Lacquer design system per the matching prototype.

### Key Entities *(include if feature involves data)*

- **Report period**: The Day, Week, or Semi-monthly window currently being viewed, with a start, an end, and a human-readable label.
- **Technician earnings summary**: A per-technician aggregate for the period — identity, transaction count, services count, gross, card-fee deduction, supply deduction, total deductions, commissionable amount, card tips, and exemption status.
- **Reported transaction**: A paid sale within the period as seen for one technician — time, client, services performed, payment method, gross, card-fee deduction, supply deduction, and net.
- **Deduction line**: A single deduction within a transaction — its type (card fee or supply), the service it relates to, and the amount.
- **Deduction policy inputs** *(existing entities the report reads, not created here)*: per-service card-fee setting and supply cost; per-technician card-fee and supply exemptions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can determine any single technician's commissionable earnings for a day within 10 seconds of opening the Report page.
- **SC-002**: The all-staff totals row reconciles to 100% — every total exactly equals the sum of the technician rows for gross, card fee, supply, commissionable, and card tips.
- **SC-003**: Any deducted amount can be traced to a specific service and deduction type by expanding at most one transaction row.
- **SC-004**: The Report's gross revenue and transaction count for a given day match the Transactions page for the same day, with no discrepancy.
- **SC-005**: A technician marked exempt shows zero deductions and commissionable earnings equal to gross, with no manual adjustment required.
- **SC-006**: The report for a typical day (30–60 transactions) renders within 2 seconds of opening the page or changing the period.
- **SC-007**: An exported CSV contains every technician row plus the totals row, and each value matches the on-screen overview exactly.
- **SC-008**: 100% of attempts by technician or front-desk users to reach the Report page are denied access.

## Assumptions

- **Period model**: The period control offers Day / Week / Semi-monthly, per the prototype, defaulting to the current day. This intentionally differs from the Transactions page's Today / Week / Month because the Report is payroll-adjacent and Semi-monthly mirrors the salon's pay period. If cross-page consistency is preferred over the prototype, this can be revisited in `/speckit-clarify`.
- **Cash tips excluded**: Only tips paid by card or gift card are reported. Cash tips are assumed to be handed directly to the technician and never reported through the report, consistent with the prototype and design conversations.
- **Tip attribution**: For multi-technician transactions, the card tip is split proportionally by each technician's share of the transaction's service subtotal.
- **Service-to-technician attribution**: Each service line item carries the technician who performed it; the report uses that assignment directly rather than distributing services by position.
- **Deduction model**: The report uses the salon's existing deduction model — per-service card-fee setting and supply cost, and per-technician card-fee and supply exemptions. The prototype's hardcoded "pedicure tier" amounts are treated as ordinary per-service supply costs; the report shows a single "Supply" deduction column.
- **Split-payment card fee**: A transaction settled wholly or partly by card or gift card incurs the card fee on its services; a cash-only transaction does not.
- **Commissionable, not payout**: The report stops at commissionable earnings (gross minus deductions). It does not compute or display the final technician/salon commission split.
- **Clients**: Transactions display "Walk-in" for the client, consistent with the current Transactions page (the application has no clients directory yet).
- **Access roles**: The page is owner- and manager-only, matching the access level of the Transactions page, because earnings and deduction data are payroll-sensitive.
- **CSV export**: The CSV reflects the all-staff per-technician summary for the currently selected period and is generated for download in the browser.
- **Reuse**: The page reuses the Transactions page's chrome (header, period controls, range navigation) so the two surfaces read as one product family, as directed in the design conversation.

## Out of Scope

- Computing the final technician/salon commission split or net payout amount.
- Editing deduction policy or exemptions from the Report page (those remain on the Services and Staff Settings surfaces).
- A clients directory or per-client reporting.
- Mutating any transaction, payment, or tip from the Report page — the page is read-only.
- Scheduled, emailed, or archived report runs.
- A mobile/tablet-optimized layout beyond the responsive behavior the design system provides; the prototype's standalone tablet-canvas variant is not surfaced.
