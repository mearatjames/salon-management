# Feature Specification: Ephemeral Checkout Draft

**Feature Branch**: `043-checkout-ephemeral-draft`

**Created**: 2026-05-19

**Status**: Draft

**Input**: User description: "We need to make an update to the checkout page. Currently, when we go into the checkout page, an empty ticket gets created. When we add a service to the ticket, it creates a ticket item. I want to change it so the checkout is an ephemeral document — when the user goes to checkout, everything stays as an ephemeral record, and we only create a ticket and ticket items when we submit the sale or service transaction. The component, UI, and flow should stay exactly the same — there is no change there. This is strictly a change to the back-end / business-logic setup, nothing to do with the UI flow."

## Overview

Today the checkout page commits to the database the moment it is opened: an empty
ticket row is created on page entry, and a ticket-item row is written every time a
service is added, a price is changed, or a discount is applied. As a result the
database fills with "ghost" tickets — opened, half-built, or abandoned carts that
never became a sale.

This feature makes the checkout an **ephemeral working document**. While an
operator is building a cart, nothing is written to the sales records. The ticket
and its items are persisted only when the operator submits the sale (takes
payment). Every screen, button, step, and timing the operator sees stays exactly
the same — this is strictly a change to when and how data is persisted behind the
scenes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete a sale with deferred persistence (Priority: P1)

An operator opens the checkout page, builds a cart (adds services, assigns techs,
adjusts prices, applies a discount), and takes payment. The sale completes and
produces exactly the same finished ticket, ticket items, and payment records as it
does today — but those records come into existence only at the moment payment is
taken, not before.

**Why this priority**: This is the core of the feature. Without it the checkout
either still creates ghost rows (no change delivered) or cannot complete a sale at
all (regression). It is the smallest slice that delivers the whole value.

**Independent Test**: Open checkout, add one or more services, take a cash
payment, and confirm the resulting ticket, ticket items, payment, and totals are
identical to today's behavior — while confirming no ticket or ticket-item rows
existed at any point before payment was taken.

**Acceptance Scenarios**:

1. **Given** an operator opens the checkout page, **When** the page finishes
   loading, **Then** no ticket row, no ticket-item rows, and no audit entries
   have been created.
2. **Given** an operator is on the checkout page, **When** they add a service to
   the cart, **Then** the service appears in the cart exactly as today, and no
   ticket-item row has been written to the database.
3. **Given** a cart with one or more services, **When** the operator takes
   payment, **Then** the ticket, all ticket items, and the payment record are
   created together as a single atomic submission, with the same column values,
   snapshots, totals, and statuses produced today.
4. **Given** a sale has just been submitted, **When** the operator views the
   completion ("done") screen, **Then** it shows the same information as today
   and is backed by a real, persisted paid ticket.
5. **Given** a cart with a variable-price service whose price has not been
   confirmed, **When** the operator attempts to take payment, **Then** submission
   is blocked with the same guidance shown today, and no ticket is persisted.

---

### User Story 2 - Abandon an unsubmitted checkout with no residue (Priority: P2)

An operator opens checkout, optionally adds and removes some services, then leaves
without taking payment — by discarding the cart or simply navigating elsewhere.
Nothing about that abandoned cart is left in the database.

**Why this priority**: This is the primary problem the feature solves —
eliminating ghost rows. It is separable from US1: a sale could complete correctly
yet still leave residue from abandoned carts, so this needs its own verification.

**Independent Test**: Open checkout, add and remove services, then discard the
cart (or navigate away), and confirm zero ticket, ticket-item, payment, or audit
rows exist for that session.

**Acceptance Scenarios**:

1. **Given** an operator has opened checkout and added several services, **When**
   they discard the cart, **Then** they are returned to the dashboard exactly as
   today, and no ticket, ticket-item, or audit rows exist for that cart.
2. **Given** an operator has opened checkout, **When** they navigate away without
   taking payment, **Then** no ticket or ticket-item rows are left behind.
3. **Given** an operator opens checkout and adds nothing at all, **When** they
   leave the page, **Then** the database is unchanged.
4. **Given** an unsubmitted cart is discarded, **When** the dashboard's daily
   counts and feed are viewed, **Then** they are unaffected — the abandoned cart
   never existed as far as reporting is concerned.

---

### User Story 3 - Resume an in-progress checkout (Priority: P2)

An operator builds a partial cart, navigates away from checkout (or refreshes the
page), and returns. The in-progress cart is still there, exactly as the resume
behavior works today. Starting a fresh checkout from the dashboard's checkout
call-to-action still begins an empty cart.

**Why this priority**: Resume is an existing part of the operator's flow, and the
feature must not change the flow. It is separable from US1/US2 because it concerns
continuity of an unsubmitted cart rather than completion or abandonment.

**Independent Test**: Build a partial cart, navigate to the dashboard, return to
checkout via the sidebar, and confirm the same cart is restored; then use the
dashboard's "new sale" call-to-action and confirm a fresh empty cart starts.

**Acceptance Scenarios**:

1. **Given** an operator has a partially built, unsubmitted cart, **When** they
   navigate away and return to checkout via the sidebar, **Then** the same cart
   contents (services, techs, prices, discounts) are restored.
2. **Given** an operator has a partially built, unsubmitted cart, **When** they
   refresh the checkout page, **Then** the cart contents are restored.
3. **Given** an operator has a partially built cart, **When** they start a
   checkout from the dashboard's "new sale" call-to-action, **Then** a fresh
   empty cart opens instead of resuming the prior one, exactly as today.
4. **Given** two different operators use the same device in turn, **When** the
   second operator opens checkout, **Then** they do not see the first operator's
   in-progress cart.

---

### User Story 4 - Card, gift-card, and split-tender sales still settle correctly (Priority: P3)

An operator completes a sale paid by Square Terminal card, by gift card, or by a
split of multiple payment methods. The ticket is persisted at the moment payment
is initiated, and every existing in-flight payment safeguard — webhook
settlement, single-in-flight-charge protection, late-capture recovery, cart-edit
draft invalidation — continues to behave exactly as today.

**Why this priority**: These are the more complex submission paths. They depend on
US1's persistence behavior but exercise additional machinery (external payment
processor, asynchronous settlement) that must be verified separately. They are
lower priority only because a cash sale (US1) already proves the core change.

**Independent Test**: Run a card-terminal sale, a gift-card redemption, and a
split-tender sale; confirm each persists its ticket at payment initiation and
settles to a paid ticket with the same records as today.

**Acceptance Scenarios**:

1. **Given** a built cart, **When** the operator sends the charge to the card
   terminal, **Then** the ticket and its items are persisted at that moment, the
   payment is recorded as in-flight, and settlement via the payment processor
   completes the sale exactly as today.
2. **Given** a card charge that fails or is declined, **When** the failure is
   recorded, **Then** the persisted ticket remains open with a failed payment
   leg, and the operator can retry or discard it exactly as today.
3. **Given** a split-tender sale, **When** the operator composes the first
   payment leg, **Then** the ticket and items are persisted, and subsequent legs,
   activation, and the cart-edit draft-invalidation rule behave exactly as today.
4. **Given** a charge is already in flight for a submitted ticket, **When** a
   second charge is attempted, **Then** it is blocked by the same protection that
   exists today.

---

### Edge Cases

- **Empty submission**: If an operator tries to take payment on a cart with no
  services (or a zero total), submission is refused with the same messaging as
  today and no ticket is persisted.
- **Payment attempted, then abandoned**: Once payment has been initiated the
  ticket is already persisted. If that payment then fails or is cancelled and the
  operator discards the cart, the discard behaves exactly as today for a real
  ticket (the ticket is marked discarded and the discard is audited). Only carts
  that never reached payment leave no trace.
- **Refresh or crash mid-cart**: An in-progress cart survives a page refresh. If
  the working draft is lost (e.g., browser data cleared, different device), the
  operator simply starts a new cart — no partial ticket is stranded in the
  database.
- **Concurrent carts for one operator**: If the same operator has checkout open
  in two places at once, each is an independent ephemeral draft; whichever one
  takes payment first persists its own ticket. No shared half-built database
  ticket is contended over.
- **Switching operators on a shared device**: The in-progress draft is scoped to
  the operator; switching the acting staff member does not surface another
  operator's cart.
- **Unconfirmed variable price at submission**: Submission is blocked until every
  variable price is confirmed, identical to today's guard — the only difference
  is the guard now runs against the draft before persistence rather than against
  a persisted ticket.
- **Pre-existing open tickets**: Tickets already sitting in the database with an
  open status from before this change are left untouched; they are simply no
  longer produced going forward.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Opening the checkout page MUST NOT create any ticket, ticket-item,
  payment, or audit-log records.
- **FR-002**: While an operator builds a cart — adding or removing services,
  assigning techs to lines, setting or overriding prices, and adding or removing
  discounts — the system MUST keep all of that state in an ephemeral working
  draft and MUST NOT write any ticket or ticket-item records.
- **FR-003**: The checkout user interface, screens, controls, steps, ordering,
  and perceived timing MUST remain exactly as they are today. This feature
  changes only when and how data is persisted; it introduces no visible change.
- **FR-004**: The ephemeral draft MUST track everything the persisted ticket
  tracks today — selected services with name and price snapshots, per-line
  assigned tech, confirmed/unconfirmed variable prices, price overrides,
  discounts (flat and percentage), and the running subtotal and total — so that
  the cart the operator sees is computed identically to today.
- **FR-005**: The system MUST persist the ticket and all of its ticket items
  only when the operator submits the sale, defined as the first payment-initiating
  action: taking a cash payment, sending a charge to the card terminal,
  redeeming a gift card, or composing the first split-tender payment leg.
- **FR-006**: When a sale is submitted, the ticket and all of its ticket items
  MUST be created together as a single atomic operation — either the complete
  set is persisted or none of it is.
- **FR-007**: A submitted sale MUST produce ticket, ticket-item, and payment
  records — including all column values, price/name snapshots, statuses, totals,
  and tax handling — that are identical to what the current flow produces for the
  same cart.
- **FR-008**: After submission, all existing payment processing — cash capture,
  card-terminal charges and webhook settlement, gift-card redemption,
  split-tender leg composition and activation — MUST continue to behave exactly
  as today, operating on the now-persisted ticket.
- **FR-009**: All existing in-flight payment safeguards MUST continue to hold for
  a submitted ticket: at most one charge in flight at a time, webhook
  idempotency, late-capture recovery, and invalidation of draft payment legs when
  the cart is edited after a leg exists.
- **FR-010**: Abandoning an unsubmitted checkout — by discarding the cart or
  navigating away before any payment is initiated — MUST leave no ticket,
  ticket-item, payment, or audit-log records.
- **FR-011**: Discarding a checkout that has already been submitted (a payment
  was initiated, then it failed or was cancelled) MUST behave exactly as today
  for a persisted ticket, including marking it discarded and recording the
  discard in the audit log.
- **FR-012**: An in-progress, unsubmitted cart MUST remain resumable by the same
  operator after navigating away from checkout and returning, and after a page
  refresh — preserving the resume behavior operators rely on today.
- **FR-013**: Starting a checkout from the dashboard's "new sale" call-to-action
  MUST begin a fresh empty cart, while reaching checkout from the sidebar MUST
  resume an existing in-progress cart if one exists — the same dispatch behavior
  as today.
- **FR-014**: The ephemeral draft MUST be scoped to the operator who is building
  it; switching the acting staff member or a different operator using the same
  device MUST NOT surface another operator's in-progress cart.
- **FR-015**: Submission MUST be refused, with the same messaging shown today,
  for a cart that has no services, a zero total, or any unconfirmed variable
  price; in every refused case no ticket MUST be persisted.
- **FR-016**: The finalized sale MUST be auditable to the same standard as today
  — the payment capture and, where applicable, the ticket discard MUST be
  recorded in the audit log. Ephemeral cart edits made before submission are not
  audited, because no persisted record is mutated and no money moves.
- **FR-017**: All reporting and downstream surfaces that read sales data — the
  dashboard daily counts and feed, receipt printing, and end-of-day cash
  reconciliation — MUST continue to work unchanged, since they already read only
  completed (paid) tickets.
- **FR-018**: Tickets already persisted in an open or discarded state from before
  this change MUST be left intact; the feature only stops producing new
  unsubmitted ticket rows and requires no migration of existing data.

### Key Entities *(include if feature involves data)*

- **Ephemeral Checkout Draft**: The in-progress, unsubmitted checkout. Holds the
  operator building it, the selected services with their name and price
  snapshots, per-line tech assignments, confirmed/unconfirmed price states,
  price overrides, discounts, and the computed subtotal and total. It is not a
  sales record, is never reported on, and can be discarded or lost with no
  consequence. It exists only until the sale is submitted, at which point its
  contents become a Ticket and Ticket Items.
- **Ticket**: The persisted record of a sale. Its structure and lifecycle are
  unchanged. The only change is timing: a Ticket now comes into existence at
  submission rather than at checkout page open.
- **Ticket Item**: A persisted line on a Ticket — a service or a discount with
  its snapshots. Its structure is unchanged; Ticket Items are now created as a
  batch together with their Ticket at submission rather than incrementally.
- **Payment**: The persisted record of money taken against a Ticket. Unchanged
  by this feature; it is created after the Ticket exists, as it is today.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening the checkout page and browsing the service catalog creates
  zero sales records — no ticket, no ticket items, no payments, no audit entries.
- **SC-002**: Building a cart of any size and then abandoning it (discard or
  navigate away, before any payment) creates zero sales records.
- **SC-003**: 100% of completed sales produce ticket, ticket-item, and payment
  records — including totals, snapshots, and statuses — that are identical to
  those produced before this change, verified by the existing checkout test
  suite passing.
- **SC-004**: The count of tickets that exist in an open-but-never-paid or
  discarded-but-never-paid state drops to zero for all checkout sessions started
  after this change ships.
- **SC-005**: Every checkout operator flow — opening, building a cart, taking
  cash, card, gift-card, and split-tender payments, resuming, and discarding —
  behaves identically from the operator's point of view, with no visible change
  to any screen, control, step, or perceived timing.
- **SC-006**: An in-progress, unsubmitted cart abandoned and returned to within
  the same business day restores its full contents for the same operator.

## Assumptions

- **Submission boundary**: "Submit the sale or service transaction" is taken to
  mean the first payment-initiating action — taking cash, sending a card charge
  to the terminal, redeeming a gift card, or composing the first split-tender
  leg. The ticket and items are persisted at that point because the existing
  payment records require a real ticket to reference. Cart edits before that
  point are ephemeral.
- **Resume continuity**: To honor "the flow stays exactly the same," an
  unsubmitted cart must survive navigation away and page refresh for the same
  operator. The mechanism for holding that ephemeral state is a design decision
  for the planning phase. Cross-device resume (continuing a cart started on a
  different device) is rare for a single salon and is not treated as a hard
  requirement; if the chosen mechanism does not carry a draft across devices, an
  operator simply starts a fresh cart on the second device.
- **Audit scope**: Per-edit cart actions (adding a line, changing a price,
  applying a discount) are no longer recorded in the audit log, because there is
  no persisted entity to reference and no money moves during cart editing. The
  audit trail for money movement and ticket finalization (payment capture,
  ticket discard for a persisted ticket) is preserved, satisfying the money-
  integrity auditing requirement.
- **No data migration**: Pre-existing open or discarded ticket rows are left as
  they are. This feature does not clean up historical ghost rows; it only stops
  creating new ones.
- **Scope boundary**: This change is strictly back-end / persistence-timing. No
  UI component, layout, copy, route-visible behavior, or interaction is altered.
  Any change visible to the operator would be a regression.
- **Test suite as the contract**: The existing checkout unit and end-to-end test
  suites define the expected persisted outcome of a completed sale. Tests that
  currently assert a ticket or ticket-item row exists *before* payment will be
  updated to assert the new timing; tests that assert the *finalized* sale state
  must continue to pass unchanged.
