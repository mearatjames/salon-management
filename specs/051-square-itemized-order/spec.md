# Feature Specification: Itemized Square Terminal Checkout

**Feature Branch**: `051-square-itemized-order`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Spec out for issue https://github.com/mearatjames/salon-management/issues/149 — feat: send itemized Order to Square Terminal so dashboard + receipt show services and discounts"

**Source issue**: [#149](https://github.com/mearatjames/salon-management/issues/149)

## Clarifications

### Session 2026-05-24

- Q: Split-tender card-leg Order scope → A: Single-tender card sales send an itemized Order; split-tender card legs continue to send a non-itemized `amountMoney`-only checkout (today's behaviour preserved).
- Q: Per-service discount granularity → A: Discounts whose `discount_target_line_ids` is set are sent line-level on the Square Order (attached to the targeted line items via `applied_discounts`); discounts without targeting are sent Order-level.
- Q: Orphan Order disposition on permanent failure → A: Best-effort cancel of the orphan Order when the subsequent terminal checkout permanently fails or the operator cancels before customer interaction. A failed cancel call is logged but does not block the operator UI or retry path; idempotency still collapses checkout retries onto the same Order.

## User Scenarios & Testing

### User Story 1 — Owner reconciles Square dashboard with itemized charges (Priority: P1)

The salon owner opens the Square dashboard at the end of the day to reconcile what was sold. Each card payment that ran through the Square Terminal shows the actual services that were paid for — for example, "Gel manicure $45 · Pedicure $60 · 10% off (-$10.50)" — instead of one opaque "Custom amount $94.50" line. The owner can answer "what did this customer buy?" without opening Tang Nails.

**Why this priority**: This is the headline customer ask in the issue. Without it, the Square dashboard is unusable for reconciliation, audit, and reporting; owners have to keep both tools open in parallel today. Solving just this story is already MVP-grade value.

**Independent Test**: Run a card sale through the Square Terminal for a ticket containing at least one service and one discount line, then log into the Square dashboard and confirm each service appears as its own line item with the correct name and unit price, the discount appears with its label and amount, and the total matches what the operator and customer saw on the Tang Nails screen.

**Acceptance Scenarios**:

1. **Given** an open ticket with two service lines (a $45 gel manicure and a $60 pedicure) and no discount, **When** the operator sends the ticket to the Square Terminal and the customer completes payment, **Then** the Square dashboard shows two line items with names "Gel manicure" and "Pedicure", unit prices $45.00 and $60.00, and a total of $105.00.
2. **Given** an open ticket with three services totaling $120 and a "10% off" promotional discount of -$12, **When** the customer pays on the terminal, **Then** the Square dashboard shows the three services as line items, a discount line labeled "10% off" for -$12, and a grand total of $108 that matches Tang Nails.
3. **Given** an open ticket with a service whose name contains an apostrophe ("Owner's special"), **When** the customer pays on the terminal, **Then** the Square dashboard renders the line-item name exactly as it appeared on the Tang Nails ticket.

---

### User Story 2 — Customer's printed receipt itemizes the sale (Priority: P2)

The customer receives a Square-printed receipt (or emailed receipt) at the end of the transaction. The receipt lists each service line by name and price and shows any discount applied, instead of a single "Custom amount" line. The customer can verify they were charged for the right work before walking out.

**Why this priority**: Customer-facing receipt clarity is a frequent complaint and reduces "what was I charged for?" support questions, but it is downstream of the dashboard story — Square renders the same line items on its receipts that it shows on the dashboard, so this story typically lands the moment US1 ships.

**Independent Test**: Run a card sale for a multi-service ticket through the terminal, request a printed receipt at the prompt, and verify the receipt lists each service name with unit price and any discount with its label.

**Acceptance Scenarios**:

1. **Given** a ticket with two services and one discount line, **When** the customer chooses "Print receipt" at the end of the terminal flow, **Then** the printed receipt lists each service with its name and price and shows the discount on its own line.
2. **Given** the customer chooses "Email receipt" with a valid address, **When** the email arrives, **Then** the body contains the same itemization that appears on the dashboard for the same checkout.

---

### User Story 3 — Square totals match Tang Nails exactly (Priority: P3)

For every itemized terminal sale, the subtotal, discount total, tax, tip, and grand total Square records exactly match the amounts the operator and customer saw on the Tang Nails screen and the amount Tang Nails recorded against the ticket. There is no silent drift introduced by sending the Order (for example, a default tax rate auto-applied by the Square location, or rounding differences between line items and the previously-sent `amountMoney`).

**Why this priority**: A mismatch between Tang Nails and Square totals would be more harmful than the current "custom amount" display because it forces every reconciliation to investigate the diff. The previous "custom amount" path already establishes parity (one charged amount, no itemization); the new path must preserve that parity while adding itemization.

**Independent Test**: For a representative ticket (services + discount + tip + zero tax), compare the Square dashboard's recorded subtotal, discount, tax, tip, and grand total to the Tang Nails ticket totals — every line must match to the cent.

**Acceptance Scenarios**:

1. **Given** a ticket with subtotal $105, a -$10.50 discount, $0 tax, and a $5 tip captured on the terminal, **When** the checkout settles, **Then** the Square dashboard shows subtotal $105, discount -$10.50, tax $0, tip $5, and grand total $99.50 — all matching Tang Nails.
2. **Given** the Square location has a default tax rate configured at the Square account level, **When** an itemized ticket is sent, **Then** the Square charge does not auto-apply that default tax; the recorded tax matches the Tang Nails tax field (currently always $0).
3. **Given** a card sale that succeeds on the first attempt, **When** the operator inspects the Square dashboard, **Then** exactly one Order is recorded for that ticket (no orphan Orders from earlier failed checkouts on the same ticket attempt).

---

### Edge Cases

- **Split-tender card leg (`card` + `cash` or `card` + `gift`)**: card legs of a split-tender sale continue to send a non-itemized `amountMoney`-only checkout (no Order). The Square dashboard for those legs continues to show "Custom amount" exactly as today; itemization applies only to single-tender card sales. (See Clarifications session 2026-05-24.)
- **Per-service-targeted discount (feature 049)**: when a discount row has `discount_target_line_ids` set, the Order MUST attach that discount line-level to the corresponding Square line items (via `applied_discounts`) rather than applying it Order-wide. Untargeted discounts continue to be sent as Order-level discounts. (See Clarifications session 2026-05-24.)
- **Order created, terminal checkout creation fails**: a network or Square error between the two SDK calls leaves an Order in Square with no associated checkout or payment. The system MUST collapse retries (same ticket + payment attempt = same Order, not a fresh one). On permanent failure, the system MUST make a best-effort attempt to cancel the orphan Order so the Square dashboard does not show empty Orders; a failure of that cancel call MUST be logged but MUST NOT block the operator UI or any retry path.
- **Operator cancels at the waiting screen before the customer taps**: the existing cancel flow remains; an Order may have been created but no payment attached. The system MUST make the same best-effort cancel attempt on the orphan Order described in the previous bullet.
- **Customer declines on the terminal**: the Order remains but unpaid; the Tang Nails payment row is marked failed exactly as today. Subsequent re-attempts produce a fresh payment row and therefore a fresh Order (per FR-007); a retry of the same payment attempt collapses onto the same Order via the deterministic idempotency key (per FR-006).
- **Tip is added by the customer on the terminal**: the tip is captured after the Order is created, exactly as today. The Order's recorded totals must reflect the final tip Square reports, not the pre-tip subtotal.
- **Ad-hoc service name characters**: service `name_snapshot` is user-edited text. Names with quotes, ampersands, emoji, or extreme length must not break Order creation; they MUST render on the dashboard as-is or be truncated only to Square's documented limits.
- **Zero-priced service line** (a complimentary service): must appear on the Order as a $0 line item (not omitted), so the receipt still shows what was performed.
- **Ticket containing only a discount (no service)**: cannot occur under current cart rules — discount lines require at least one service — and so the Order will always have ≥ 1 non-discount line item.

## Requirements

### Functional Requirements

- **FR-001**: When a **single-tender** card payment is sent to the Square Terminal for an open ticket (the card is the only payment method covering the full ticket total), the system MUST create a Square Order containing every service line on the ticket as an individual Order line item. Split-tender card legs MUST continue to send a non-itemized `amountMoney`-only checkout — they are out of scope for itemization in this feature.
- **FR-002**: Each Order line item MUST carry the service's display name (as shown to the operator and customer in Tang Nails) and the unit price the operator confirmed; quantity MUST mirror the ticket-line quantity.
- **FR-003**: When the ticket contains one or more discount lines, the system MUST represent those discounts on the Order so they appear on the Square dashboard and printed receipt as discounts (not as negative line items). Discount rows whose `discount_target_line_ids` is set MUST be attached line-level to the targeted Order line items; discount rows without targeting MUST be applied Order-level. The resulting Square discount totals MUST match the Tang Nails discount totals to the cent.
- **FR-004**: The grand total Square charges and records MUST exactly match the amount Tang Nails displayed to the operator and customer for that payment (current behaviour: cent-accurate parity with `amountMoney`).
- **FR-005**: The system MUST prevent Square's automatic tax inheritance from a location's default tax rate from altering the recorded charge; recorded tax MUST equal what Tang Nails calculated (currently $0).
- **FR-006**: Retrying the same payment attempt (same ticket + same in-flight payment row) MUST NOT produce a duplicate Order on the Square side; the retry MUST collapse onto the original Order.
- **FR-007**: A fresh card payment attempt for the same ticket after a prior failure MUST produce a brand-new Order (preserving the existing per-attempt-row contract).
- **FR-008**: When Order creation succeeds but the subsequent terminal checkout creation fails, the system MUST surface the same operator-facing failure experience as today (the operator sees an actionable error and can retry or switch payment method); the orphan Order MUST NOT block retries. The system MUST make a best-effort attempt to cancel the orphan Order; if that cancel call fails, the error MUST be logged but MUST NOT surface to the operator and MUST NOT prevent retry or method-switch.
- **FR-009**: The system MUST tag each Order with the Tang Nails ticket identifier so the Order is traceable from Square back to the originating ticket without manual lookup.
- **FR-010**: Cancellation of a terminal checkout from the waiting screen MUST continue to honour the existing "Square wins" race semantics; itemization changes MUST NOT introduce a new ambiguity for the cancel path.
- **FR-011**: When the customer adds a tip on the terminal, Square's recorded tip on the Order MUST equal the tip Tang Nails persists against the payment row.
- **FR-012**: All previously supported terminal flows (single-tender card, success, cancellation, decline, polling fallback, webhook settlement) MUST continue to work end-to-end with no regression in the operator-facing UI.
- **FR-013**: For audit purposes, the system MUST persist a reference to the Square Order alongside the existing `square_terminal_checkout_id` so support can pull the Order without recomputing it from the Square API.
- **FR-014**: Pre-existing operator-facing copy on the waiting screen, settle screen, and dashboard MUST NOT change as a result of this feature.

### Key Entities

- **Ticket**: a sale-in-progress in Tang Nails containing one or more service lines, optional discount lines, and (after payment) one or more payment rows. Already exists.
- **Ticket line item**: a row on a ticket representing either a service performed (with a name snapshot, unit price, quantity, and assigned tech) or a discount (label and amount, optionally scoped to specific service lines).
- **Payment**: a single attempt to collect money against a ticket via one method (card / cash / gift). One ticket can have multiple payments (split-tender) and multiple attempts (a card payment can fail and be retried; each retry is a separate row).
- **Square Order**: a Square-side record of what was sold, holding line items, discounts, taxes, totals, and a reference back to the originating ticket. Created server-side immediately before each Square Terminal checkout that will be itemized. New external entity for this feature.
- **Square Terminal Checkout**: the Square-side record of the prompt pushed to the paired terminal device. After this feature, an itemized checkout carries a reference to its Order; Square pulls amount and itemization from the Order rather than from inline `amountMoney`. Already exists.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For 100% of single-tender card sales, the Square dashboard displays each Tang Nails service line as its own line item with the matching name and unit price.
- **SC-002**: For 100% of itemized card sales with at least one discount, the Square dashboard renders the discount with its label and amount (not as a negative line item or hidden inside the total).
- **SC-003**: For 100% of completed itemized card sales, the Square-recorded subtotal, discount total, tax, tip, and grand total match the corresponding Tang Nails values to the cent.
- **SC-004**: When the same card payment attempt is retried (same ticket + payment row), Square shows exactly one Order — zero duplicate Orders observed across at least 20 retry scenarios in QA.
- **SC-005**: Mean operator-visible time from "Send to terminal" tap to "waiting for customer" screen does not regress by more than 500 ms compared to today's non-itemized flow (Order create + checkout create is two SDK round-trips instead of one).
- **SC-006**: For 100% of card sales, the previously-recorded operator-facing failure rate (Square-unreachable, decline, cancel) is unchanged within statistical noise after this feature ships.
- **SC-007**: Owners self-report on at least one post-launch reconciliation pass that they no longer need to open Tang Nails to identify what each Square dashboard charge corresponds to.
- **SC-008**: After a simulated `terminal.checkouts.create` failure path, 100% of resulting orphan Orders are either canceled or have a logged cancel-attempt failure — zero silent orphans are introduced into the Square dashboard during QA scenarios.

## Assumptions

- The Square account remains connected (OAuth tokens present and not in `refresh_failed_at` state) — same precondition as today's terminal payment path.
- A `location_id` is available to the server-side code (already required by the Orders API; we either resolve it via the existing Square connection or store it during OAuth — to be settled in planning).
- Tang Nails will not push the `services` catalog into Square Catalog as part of this feature. Order line items are sent ad-hoc with name and unit price; Square's documented contract requires only `quantity` and accepts `name` + `base_price_money` without a catalog object id.
- Tax remains $0 for the salon's current configuration. The feature must defend against Square's location-default tax injection but does not introduce a tax-collection flow.
- The existing realtime / polling / webhook settlement paths (`terminal.checkout.updated`) do not need to change — Square continues to emit the same events for itemized checkouts as for non-itemized ones; only the create-side payload changes.
- The existing audit trail (`payment.created`, `payment.succeeded`, `payment.failed`) is sufficient; this feature does not introduce new audit event kinds beyond at most an Order-id field on existing events.
- Square's free-text Order line-item name length limits accommodate every existing Tang Nails `services.name` value (the longest current service name is well within typical SDK limits). If a future service name violates the limit, planning will choose between truncation and rejection.
- Implementation will reuse the deterministic SHA-256 idempotency key already derived from `(ticketId, paymentId)` so Order create and Terminal checkout create both retry-collapse against the same attempt.

## Out of Scope

- Pushing the Tang Nails `services` table into Square Catalog (named in the issue as a possible future enhancement).
- Changes to webhook handling, polling, tip extraction, or settlement (the create-side payload is the only thing changing).
- Changes to non-card payment methods (cash, gift) — those never round-trip Square.
- Reporting changes inside Tang Nails — this feature improves Square-side reporting, not Tang Nails' own reports / payroll / EOD screens.
- Refunds via the Square dashboard — feature 015 already covers (or does not) refund support; itemization does not change refund behaviour.
- A migration to add `services.square_catalog_object_id` (explicitly called out in the issue as not required for this feature).
