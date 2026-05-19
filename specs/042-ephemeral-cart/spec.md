# Feature Specification: Ephemeral Cart

**Feature Branch**: `042-ephemeral-cart`

**Created**: 2026-05-18

**Status**: Draft

**Input**: User description: "Convert the checkout/cart-building page from a database-backed flow to an in-memory ephemeral cart. The cart only writes to the database when the operator commits to a payment."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cash or gift commit promotes ephemeral cart to ticket (Priority: P1)

An operator opens the checkout page, adds services and any discounts, selects the assigned tech and (optionally) the customer, then chooses cash or gift card and taps Submit. The ticket, its line items, and the first payment row are all created in a single transaction at the moment of submit. Until that moment, the database has no record of this sale.

**Why this priority**: This is the most common payment flow at Tang Nails and the simplest exercise of the new "promote on commit" pattern. Without it the whole ephemeral-cart concept does not function; with just this story shipped, the salon already gets the core hygiene benefit (no empty open tickets accumulating) for the majority of transactions.

**Independent Test**: Open checkout fresh, build a cart of one or more services, submit cash, verify the resulting `tickets` row, `ticket_items` rows, and `payments` row all appear with consistent IDs and `status='paid'`. Separately verify that opening checkout and walking away leaves the database untouched.

**Acceptance Scenarios**:

1. **Given** an operator on the dashboard, **When** they click "New transaction" and land on `/checkout`, **Then** no `tickets` or `ticket_items` rows are written to the database.
2. **Given** an operator with two services and a discount in the ephemeral cart, **When** they submit cash, **Then** exactly one `tickets` row is created with status `paid`, its `ticket_items` rows are inserted, and one `payments` row with method `cash` and status `succeeded` is attached — all visible to the post-commit receipt screen.
3. **Given** an operator with a built cart, **When** they refresh the browser before submitting, **Then** the cart is empty on reload and the database has zero new rows from the abandoned session.
4. **Given** an operator submitting a gift card payment from an ephemeral cart, **When** the gift card transaction is recorded, **Then** the same atomic create-and-pay outcome occurs as for cash.

---

### User Story 2 - Square Terminal handoff promotes ephemeral cart to ticket (Priority: P2)

An operator builds the cart and chooses to charge a card. When they click "Send to Square Terminal," the ticket, its line items, and a `pending` card payment row are atomically created at the same instant Square is asked to start the in-person card capture. The post-handoff webhook/polling lifecycle is unchanged from today.

**Why this priority**: Card payments are common but the flow is more complex than cash because it involves an external Square call after the local DB write. Shipping this after US1 keeps risk contained and lets the simpler cash path bake first.

**Independent Test**: Open checkout fresh, build a cart, click "Send to Square Terminal," and verify that exactly one `tickets` row (status `open`), its `ticket_items` rows, and one `payments` row (method `card`, status `pending`, with the Square checkout ID populated) are created in a single transaction. Then complete or fail the Square capture and verify the post-handoff lifecycle behaves identically to today.

**Acceptance Scenarios**:

1. **Given** an operator with a built ephemeral cart, **When** they click "Send to Square Terminal" and the Square API call succeeds, **Then** a ticket, its items, and a pending card payment row are created together and the screen transitions to the existing "waiting for terminal" UI.
2. **Given** a successful Square Terminal capture after handoff, **When** the webhook or polling RPC updates the payment row, **Then** the ticket transitions to `paid` and the receipt screen renders — identical to today's post-handoff behavior.
3. **Given** a Square API call that fails immediately after the local rows are created, **When** the server action handles the error, **Then** the just-created ticket, items, and pending payment rows are removed so the database state matches the pre-attempt state.

---

### User Story 3 - Split tender initiation promotes ephemeral cart to ticket (Priority: P3)

An operator builds the cart and chooses to split payment across methods. At the moment of split-tender initiation, the ticket and items are created and the existing split-tender screen takes over (which assumes a real ticket row to anchor each leg). No new behavior is introduced for the mid-split-tender phase itself.

**Why this priority**: Split tender is the least common flow but the most coupled to existing payment-draft and leg-settlement mechanics. Handling it last lets the simpler commit paths stabilize first and avoids re-touching the carefully-tuned split-tender internals.

**Independent Test**: Open checkout fresh, build a cart, initiate split tender, verify a ticket + items are created at that moment and the existing split-tender UI (with its mid-split Discard control) loads against the new ticket ID. Settle the legs and confirm the ticket reaches `paid` with the same final state shape as today.

**Acceptance Scenarios**:

1. **Given** an operator with a built ephemeral cart, **When** they initiate split tender, **Then** a single transaction creates the ticket row, all item rows, and the initial split-tender draft state, and the screen routes to `/checkout/<new-id>` for the mid-split UI.
2. **Given** the operator is now on the mid-split-tender screen, **When** they capture each leg, **Then** all existing leg-settlement, draft-invalidation, and ticket-status transitions occur unchanged.
3. **Given** the operator is on the mid-split-tender screen and a real ticket exists, **When** they choose to Discard, **Then** the existing discard behavior (subject to the issue #25/#26 guards) is preserved.

---

### Edge Cases

- **Browser refresh mid-cart-build**: Cart state is lost; the page reloads to an empty cart. The database has no record of the abandoned cart. Intentional, consistent with unsaved-document semantics elsewhere on the web.
- **Two tabs open on same browser**: Each tab holds its own independent ephemeral cart. A commit in one tab does not affect the other tab's cart; the other tab continues to hold uncommitted state until the operator submits, refreshes, or navigates away.
- **Operator navigates to another sidebar route and back to `/checkout`**: Cart state is lost on leaving the route. Returning to `/checkout` shows an empty cart. (Aligned with the unsaved-document model.)
- **Network failure mid-submit**: The atomic transaction either completes fully or rolls back fully. No partial ticket/items/payment state can exist.
- **Square Terminal API rejection after local DB write**: The just-created rows are rolled back (deleted) inside the same server action; the operator sees an error and must rebuild the cart (the ephemeral cart state was already consumed by the commit attempt).
- **Operator-attempted Discard on the cart-building phase**: Not possible — the button is removed entirely because no row exists to discard.
- **Pre-existing real ticket mid-split-tender**: Discard remains available and operates against the real ticket exactly as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST NOT write rows to the `tickets` or `ticket_items` tables when an operator navigates to the cart-building checkout page.
- **FR-002**: System MUST hold cart state — selected services, discounts, customer reference, tech assignment, and intended tip/notes if any — exclusively in client-side state until a payment commit is attempted.
- **FR-003**: System MUST create the ticket row, all corresponding ticket item rows, and the first payment row (or initial split-tender draft state) atomically in a single transaction at payment commit.
- **FR-004**: System MUST clear ephemeral cart state when the operator navigates away from, refreshes, or closes the cart-building route.
- **FR-005**: System MUST route the three existing entry points — dashboard "New transaction" CTA, sidebar "Checkout" link, and DoneScreen "New sale" link — to `/checkout` with no ticket ID and no eager ticket creation.
- **FR-006**: System MUST NOT display Cancel or Discard controls on the cart-building phase.
- **FR-007**: System MUST preserve the Discard control and its behavior on the mid-split-tender screen, where a real ticket exists.
- **FR-008**: When the Square Terminal API call fails after the local rows have been written, system MUST remove the just-created ticket, item, and pending payment rows so the database returns to the pre-attempt state.
- **FR-009**: System MUST preserve all existing post-commit behavior unchanged, including split-tender leg settlement, Square Terminal webhook and polling lifecycle, receipt screen rendering, and audit logging for events that occur after the first commit.
- **FR-010**: System MUST treat the post-commit URL `/checkout/<ticket-id>` as a valid view for mid-split-tender and completed-sale receipt purposes only — never as a cart-building entry point.
- **FR-011**: System MUST NOT persist cart state to local storage, session storage, IndexedDB, cookies, or any server-side draft store; the cart is purely in-memory React state.
- **FR-012**: The cart-building page MUST function without depending on the resume-today's-open-ticket sidebar capability, which is removed as part of this change because no pre-commit tickets exist to resume.

### Key Entities *(include if feature involves data)*

- **Ephemeral Cart** (new, client-only, not persisted anywhere): the in-memory representation of a transaction being built, holding selected services, discounts, customer reference, tech assignment, and any tip/notes. Lives only for the duration of the cart-building session in a single tab; lost on navigation, refresh, or close.
- **Ticket** (existing, schema unchanged): now created at first commit rather than at page-open. After commit, behaves exactly as today.
- **Ticket Item** (existing, schema unchanged): now bulk-inserted at first commit alongside the ticket. After commit, behaves exactly as today.
- **Payment** (existing, schema unchanged): the first payment row is now created in the same transaction as the ticket and items at commit time. After commit, behaves exactly as today.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator visiting the cart-building page and taking no actions results in zero writes to the `tickets` and `ticket_items` tables.
- **SC-002**: An operator building a cart of arbitrary size — including services, discounts, customer, and tech — and then leaving (navigation, refresh, or close) results in zero writes to the `tickets` and `ticket_items` tables.
- **SC-003**: After any complete operator session — committed or abandoned — no `tickets` row exists in state `open` with zero associated `ticket_items` rows.
- **SC-004**: Each of the four commit paths (cash, gift card, Square Terminal handoff, split-tender initiation) produces the same final database state as today for an equivalent transaction, verified by row-by-row comparison of `tickets`, `ticket_items`, `payments`, and `audit_log`.
- **SC-005**: The full existing end-to-end test suite passes after updates that account for the route topology change (no `/checkout/<id>` for cart-building) and the removed Cancel/Discard buttons on the cart-building phase.
- **SC-006**: A Square Terminal handoff failure that occurs after the local DB write results in zero residual rows in the `tickets`, `ticket_items`, or `payments` tables for that attempt.

## Assumptions

- **Cart state is destroyed when leaving the route**. Navigating to another sidebar link and returning to `/checkout` does not restore prior cart state. This is consistent with the unsaved-document model and avoids confusing operators about whether state is "saved" or not.
- **Multi-device pre-commit cart visibility is not supported**. Each operator's ephemeral cart lives only in the tab where it was built; no other device or tab can see or contribute to it pre-commit. (Two staff on different iPads sharing a mid-build cart was not an observed workflow.)
- **No inactivity auto-clear timer is required**. The cart simply persists until the operator navigates away or refreshes; if a browser is left open overnight, the cart is still there in the morning. This avoids surprising the operator with silent clears.
- **No pre-commit audit events are needed**. The current `ticket.created` event fires for many empty tickets that are abandoned, which is largely noise. Post-commit audit coverage (sale, payment, discard of real ticket) remains intact and complete.
- **Square Terminal handoff failure is recovered by direct row deletion** in the same server action — this is system rollback of a failed transaction, not an operator-facing discard, so it bypasses `discardTicket` and its in-flight-payment guard. No audit event is needed because the rows never persisted past the failed transaction boundary.
- **The three prerequisite bugfix issues (#25, #26, #27) are merged to `main` before this work begins**. Without them, the new commit paths inherit known money-handling gaps from today's checkout flow.
- **No schema migrations are required**. All existing tables, columns, constraints, indexes, and RPCs are reused as-is; the only changes are in the application layer (server actions, client cart state, route topology, button visibility).
- **The existing split-tender mid-flow UI continues to assume a real ticket row exists** at the URL `/checkout/<id>`. Initiating split tender from the ephemeral cart performs the ticket+items create, then redirects to this URL so the existing split-tender screen takes over unchanged.
