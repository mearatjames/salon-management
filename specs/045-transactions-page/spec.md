# Feature Specification: Transactions Page

**Feature Branch**: `feat/045-transactions-page`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "currently we only have the dashboard page where we list the recent transactions but I believe we also need a dedicated transactions page where you can like see all the transaction filter by day by week by month and can see more details about that transaction then just what we display in the dashboard and also in the dashboard page there's a button to click view all so I guess that you all button should also take the user to that new transactions page and the transaction itself should have its own menu item in the sidebar menu. Implement the `prototypes/transaction/Transactions.html` design from the Lacquer handoff."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the full transaction history by period (Priority: P1)

An owner or manager wants to look beyond today's sales. They open the new
**Transactions** page from the sidebar (or by clicking **View all** on the
dashboard's recent-transactions feed) and see every completed sale the salon
has rung up. They switch between **Today**, **This week**, and **This month**,
and step backward through earlier periods to review past days. Transactions are
grouped by day with per-day totals, and a summary strip shows the period's
headline numbers.

**Why this priority**: This is the core of the feature — a place to see *all*
transactions, not just today's. Without it, the dashboard's "View all" leads
nowhere and there is no way to review history. It is a complete, shippable MVP
on its own.

**Independent Test**: Navigate to the Transactions page from the sidebar and
from the dashboard's "View all" control; confirm completed sales appear grouped
by day, switch the period to Today/This week/This month, step to a prior
period, and confirm the listed transactions and per-day/period totals change to
match the selected range.

**Acceptance Scenarios**:

1. **Given** an owner is signed in, **When** they open the studio sidebar,
   **Then** a "Transactions" menu item is visible and navigates to the
   Transactions page.
2. **Given** a user is on the dashboard, **When** they click "View all" on the
   recent-transactions feed, **Then** they land on the Transactions page.
3. **Given** the Transactions page is open, **When** the period is "This week",
   **Then** every completed sale from the start of the current week through
   today is listed, grouped by calendar day, newest day first.
4. **Given** the period is "This month", **When** the user steps back one
   period, **Then** the list and the range label update to the previous month
   and show that month's transactions.
5. **Given** the current period is selected, **When** the user tries to step
   forward past it, **Then** the forward control is disabled.
6. **Given** a day group is shown, **When** the user reads its header, **Then**
   it shows the date, a relative label (e.g. "Today", "Yesterday", "3 days
   ago"), and that day's transaction count, revenue, and tips.
7. **Given** a period is selected, **When** the page renders, **Then** a KPI
   strip shows the period's transaction count (with a comparison vs. the
   previous equivalent period), gross revenue, services rendered, tips
   collected, and average ticket.

---

### User Story 2 - Inspect a transaction's full receipt (Priority: P2)

A manager spots a transaction they want to understand in detail. They click the
row and a receipt drawer slides in showing the complete picture: who the client
was, which techs worked the line items, every service and its price, the
subtotal/tip/tax/total breakdown, how it was paid, and who closed the sale.

**Why this priority**: "See more details about that transaction than what we
display in the dashboard" is an explicit goal. The list answers *what happened*;
the drawer answers *exactly what was in the sale*. It builds on US1 but the list
is still useful without it.

**Independent Test**: With the transaction list showing, click any row and
confirm a detail drawer opens with line items, per-line tech, the
subtotal/tip/tax/total breakdown, payment method and amount, the closing staff
member, and a basic activity record; confirm it closes via the close control,
the backdrop, and the Escape key.

**Acceptance Scenarios**:

1. **Given** the transaction list is shown, **When** the user clicks a row,
   **Then** a receipt detail drawer opens for that transaction and the row is
   marked as selected.
2. **Given** the drawer is open, **When** the user reads it, **Then** it shows
   the client, transaction ID, date and time, the assigned techs, and the staff
   member who closed the sale.
3. **Given** the drawer is open, **When** the user reads the items section,
   **Then** each line item shows its service name, category, assigned tech, and
   price, followed by the subtotal, tip, tax, and total.
4. **Given** the drawer is open, **When** the user reads the payment section,
   **Then** it shows the payment method and the amount paid.
5. **Given** the drawer is open, **When** the user presses Escape, clicks the
   backdrop, or clicks the close control, **Then** the drawer closes and the
   list returns to focus.

---

### User Story 3 - Narrow the list with search and filters (Priority: P3)

Within a busy period, a manager needs to find specific transactions — a named
client, a payment method, or a particular tech's work. They type into the
search box, toggle method chips, and pick techs from a filter; the list and the
KPI strip update to match.

**Why this priority**: Search and filtering make a large history usable, but the
period-grouped list (US1) and the detail drawer (US2) already deliver the
feature's value. This is a refinement layer.

**Independent Test**: With a period that has many transactions, type a client
name into search, toggle a payment-method chip, and select a tech filter;
confirm the list, the per-method counts, and the KPI strip all reflect the
narrowed set, and confirm filters can be cleared.

**Acceptance Scenarios**:

1. **Given** a period with transactions, **When** the user types a client name,
   service name, or transaction ID into search, **Then** only matching
   transactions remain and the KPI strip recalculates for that subset.
2. **Given** the method chips are shown, **When** the user selects "Card",
   **Then** only card transactions remain, and each chip shows a live count of
   matching transactions.
3. **Given** the tech filter is open, **When** the user selects one or more
   techs, **Then** only transactions involving those techs remain, and each
   selected tech appears as a removable pill.
4. **Given** one or more filters are active, **When** the user clears them,
   **Then** the full period list returns.
5. **Given** a search or filter combination matches nothing, **When** the list
   renders, **Then** an empty state explains no transactions match and offers a
   one-click "Clear filters" action.

---

### Edge Cases

- **Empty period** — a period (or a stepped-back period) with no transactions
  at all (e.g. a closed day, or a range before the salon's first recorded sale)
  shows a calm empty state rather than a broken layout.
- **Partially-future period** — "This week" or "This month" includes days that
  have not happened yet; only days with completed sales appear, and totals
  reflect only what has occurred.
- **No filter matches** — search/method/tech filters that exclude everything
  show a filtered-empty state with a "Clear filters" action (distinct from a
  genuinely empty period).
- **Walk-in clients** — transactions with no named client display as "Walk-in"
  and remain searchable.
- **Multi-tech / multi-service transactions** — a sale split across several
  techs or containing several services renders cleanly in both the row summary
  and the receipt drawer.
- **Unauthorized access** — a technician or front-desk user who reaches the
  Transactions URL directly is blocked and does not see salon-wide revenue.
- **High-volume month** — a month with several hundred transactions remains
  responsive to scroll, period changes, and filtering.
- **Zero-value lines** — transactions with a $0 tip and $0 tax render their
  totals correctly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated Transactions page on its own
  route that lists every completed sale the salon has recorded.
- **FR-002**: System MUST add a "Transactions" item to the studio sidebar
  navigation (in the everyday "Workspace" group, per the prototype) that links
  to the Transactions page.
- **FR-003**: The "View all" control on the dashboard's recent-transactions
  feed MUST navigate to the Transactions page.
- **FR-004**: Access to the Transactions page MUST be restricted to **owner**
  and **manager** roles. The sidebar item MUST be hidden from technicians and
  front-desk staff, and direct navigation to the route by those roles MUST be
  blocked.
- **FR-005**: System MUST let users filter the transaction list by period:
  **Today**, **This week**, and **This month**.
- **FR-006**: System MUST let users step backward through earlier periods of
  the selected granularity and forward again, with a visible label for the
  active date range; stepping forward beyond the current period MUST be
  disabled.
- **FR-007**: System MUST group the listed transactions by calendar day, newest
  day first, with a per-day header showing the date, a relative label
  (Today / Yesterday / N days ago / weekday), and that day's transaction count,
  revenue, and tips.
- **FR-008**: Each transaction row MUST show the time, a transaction
  identifier, the client, a services summary, the assigned techs, the payment
  method, the subtotal, the tip, and the total.
- **FR-009**: System MUST display a KPI summary for the active period:
  transaction count (with a comparison against the previous equivalent period),
  gross revenue, services rendered, tips collected, and average ticket.
- **FR-010**: System MUST let users search transactions by client name, service
  name, or transaction identifier, updating both the list and the KPI summary.
- **FR-011**: System MUST let users filter by payment method (card, cash, gift)
  — with a live per-method count — and by one or more techs.
- **FR-012**: Active tech filters MUST display as individually removable pills,
  and the user MUST be able to clear all active filters at once.
- **FR-013**: Clicking a transaction row MUST open a receipt detail drawer for
  that transaction and visibly mark the row as selected.
- **FR-014**: The receipt detail drawer MUST show: the client, transaction
  identifier, date and time; the assigned techs and the staff member who closed
  the sale; an itemized list where each line shows the service name, category,
  assigned tech, and price; the subtotal, tip, tax, and total; the payment
  method and amount; and a basic activity record of when and by whom the sale
  was completed.
- **FR-015**: The receipt detail drawer MUST be dismissable via a close
  control, a click on the backdrop, and the Escape key.
- **FR-016**: The Transactions page MUST provide a "New transaction" action
  that takes the user into the checkout flow.
- **FR-017**: When the selected period and filter combination yields no
  transactions, the system MUST show an empty state; when the emptiness is
  caused by active filters, the empty state MUST offer a one-click way to clear
  filters.
- **FR-018**: All monetary values, counts, times, and dates on the page MUST
  use the salon's established formatting conventions (currency, tabular
  numerals on numeric columns, salon-timezone dates and times).
- **FR-019**: The Transactions page MUST be built entirely from the Lacquer
  design system tokens and components, and MUST match the
  `prototypes/transaction/Transactions.html` design.
- **FR-020**: The `Transactions.html` prototype and its supporting design files
  MUST be copied into the repository's `design-system/prototypes/transaction/`
  folder so the design system stays the source of truth.

### Out of Scope

- **Refund and void** — transaction status, the status filter, status pills,
  and the Refund action shown in the prototype. Every transaction is treated as
  "Completed"; refund/void capability is a separate future feature.
- **CSV export** — the prototype's "Export CSV" header action is deferred to a
  later iteration.
- **Print / Email** drawer actions — receipt printing remains available through
  the existing printable-receipt route; the drawer's Print/Email buttons are
  not built in this release.
- **Editing transactions** — the page is read-only browsing and inspection.

### Key Entities

- **Transaction**: a completed sale. Has a date and time it was completed, a
  client, one or more assigned techs, a set of line items, a payment method, a
  subtotal, tip, tax, total, and the staff member who closed it.
- **Line item**: an entry on a transaction — typically a service. Has a name, a
  category, a quantity, a unit price, and an assigned tech.
- **Payment**: how a transaction was settled — a method (card, cash, or gift),
  an amount, and a tip.
- **Staff member**: a person who either worked a line item (tech) or closed the
  sale (cashier).
- **Period window**: the active date range, derived from the selected period
  granularity (today / week / month) and how many periods back the user has
  stepped.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the dashboard, a user reaches the full transaction history in
  a single click via "View all".
- **SC-002**: An owner or manager can locate any specific past transaction by
  switching period and/or searching in under 30 seconds.
- **SC-003**: For any selected period, 100% of the salon's completed sales in
  that range appear on the page — no transaction is missing compared to the
  underlying records.
- **SC-004**: Opening a transaction's full receipt takes one click and the
  drawer shows every line item, the payment, and the totals.
- **SC-005**: Technicians and front-desk staff cannot access the page — the
  sidebar item is absent and direct navigation is blocked — verified 100% of
  the time.
- **SC-006**: The page is loaded and interactive for a typical month of
  transactions within 2 seconds on a standard salon device.
- **SC-007**: Switching period, searching, or applying a filter updates the
  list and KPI summary within 1 second, without a full page reload.

## Assumptions

- The spec/feature directory is numbered `045` to match the existing worktree
  and branch (`feat/045-transactions-page`); work is done in that worktree.
- The "Transactions" sidebar item is placed in the "Workspace" group between
  "Checkout" and "Walk-in", per the prototype's shell, but is shown only to
  owner/manager roles per the access decision above.
- Period semantics: a week starts on Monday and "This week" runs Monday through
  today; "This month" is the calendar month. The page opens on "This week" by
  default, matching the prototype.
- The receipt drawer shows only payment details the system actually records
  (method, amount, tip). It does NOT fabricate card last-four digits,
  authorization codes, cash tendered/change amounts, or gift-card codes shown in
  the prototype, because the current data model does not store them.
- Tax is currently recorded as $0 on all transactions; the receipt breakdown
  and KPI strip reflect the stored tax value rather than inventing a tax rate.
- The transaction "ID" presented to users is a short, human-readable identifier
  derived from the underlying sale record.
- The page renders all transactions within the selected period in one scrolling
  view without pagination; a single salon's monthly volume is small enough for
  this to remain responsive.
- The feature reuses the existing completed-sale records (tickets, line items,
  payments) and the salon's existing currency/date/timezone formatting
  conventions; no new transaction data is created by this page.
- The dashboard's existing recent-transactions feed and its summary continue to
  work unchanged; only the "View all" control gains a destination.
