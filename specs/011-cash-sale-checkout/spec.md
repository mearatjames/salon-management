# Feature Specification: Checkout — Cash-Only Sale

**Feature Branch**: `011-cash-sale-wip`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Build the new-transaction checkout flow — cash-only, fresh standalone ticket, no client or appointment attached yet. Front desk taps 'New transaction' on the dashboard (or 'Checkout' in the sidebar), lands in the single-screen cart, picks a tech, taps services from the tile grid, sees the running cart, chooses Cash, marks cash received, and sees a 'Charged $X' confirmation with a 'New sale' button. Cash only this phase; card, gift, split, tips, discounts, client/appointment attach, variable-price modal, voids/refunds, drawer-session gating, and realtime sync are explicitly later phases."

## Clarifications

### Session 2026-05-16

- Q: How should the sidebar "Checkout" resume rule handle stale open tickets (e.g., one left open from a previous shift)? → A: Resume only if the open ticket was created today (same calendar day in salon timezone); older opens are not auto-resumed and a fresh empty ticket is created instead.
- Q: Who can view the printable receipt page for a ticket? → A: Any signed-in staff session can view any ticket's receipt; the URL is not publicly accessible.
- Q: What happens if the cash-payment write fails (network drop, DB error)? → A: Payment insert and ticket status flip are a single atomic transaction; on failure, neither persists, the operator stays on the checkout screen with an error banner ("Cash payment didn't save — try again"), and the Take cash button is re-enabled. No partial state, no optimistic confirmation, no silent retry.
- Q: Which staff roles are allowed to ring up a cash sale through this flow? → A: Any signed-in staff member, no role gate in this phase. A formal POS-permission model is deferred to a dedicated future feature.
- Q: How does the operator throw away an in-progress ticket when the customer walks out (no sale)? → A: Keep "Cancel" as "leave the ticket open and step away" (resumable). Add a separate explicit "Discard ticket" action that marks the ticket as voided (terminal, non-resumable, excluded from sales reporting). Cancel and Discard are distinct controls on the checkout screen.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Process a cash-only walk-in sale from start to finish (Priority: P1)

A nail technician at the front desk needs to ring up a walk-in customer who is paying cash. From the dashboard the technician taps "New transaction" (or "Checkout" in the sidebar). The studio creates a fresh, empty ticket and routes the technician into the single-screen checkout. They pick which tech performed the service, tap one or more service tiles to add them to the cart, watch the running total update, tap the cash payment tile, confirm the cash has been received, and land on a "Charged $X" confirmation. The sale is now closed and recorded as paid.

**Why this priority**: This is the entire reason the feature exists. Without an end-to-end cash sale, the studio cannot collect money for a service. Every other story in this feature is a refinement of this core flow.

**Independent Test**: From a signed-in studio session, start a transaction from either entry point, add at least one fixed-price service, complete the cash payment, and verify the confirmation screen appears and the underlying ticket is recorded as paid.

**Acceptance Scenarios**:

1. **Given** a signed-in technician on the dashboard, **When** they tap "New transaction", **Then** a new empty ticket is created and the checkout screen for that ticket is shown.
2. **Given** a fresh empty ticket on the checkout screen, **When** the technician selects a tech from the tech row, **Then** the tech row collapses to a single chip and the service tile grid becomes the focus of the screen.
3. **Given** a tech has been picked, **When** the technician taps a fixed-price service tile, **Then** the service appears as a line in the cart with the snapshotted name and price, assigned to the picked tech, and the subtotal/total update accordingly.
4. **Given** the cart contains at least one priced service line and no unpriced lines, **When** the technician taps "Take cash · $X", **Then** the system records a cash payment for the full total, marks the ticket as paid, and shows the "Charged $X" confirmation screen.
5. **Given** the confirmation screen is shown, **When** the technician views the action area, **Then** a "New sale" button is present.

---

### User Story 2 — Resume an open ticket from the sidebar (Priority: P2)

A technician started a transaction earlier in their shift but stepped away before charging it. They return to the studio and tap "Checkout" in the sidebar. Instead of being dropped into a brand-new empty ticket, they are routed back into the open ticket they had in progress — services already added, tech already picked. They finish the sale from where they left off.

**Why this priority**: Walk-in salon traffic is interruption-heavy (clients walk in, the phone rings, a stylist needs help). Without resume, a technician who navigates away has to rebuild the cart from scratch and may accidentally leave behind orphaned open tickets that pollute reporting. Resume is what makes the sidebar entry usable across a shift.

**Independent Test**: Start a transaction, add services and pick a tech, navigate away from the checkout screen without paying, return via the sidebar "Checkout" item, and verify the same in-progress ticket is shown (same services, same tech, same totals).

**Acceptance Scenarios**:

1. **Given** the signed-in operator has exactly one open ticket they created today, **When** they tap "Checkout" in the sidebar, **Then** they are routed to that open ticket's checkout screen with its existing cart contents intact.
2. **Given** the signed-in operator has no open tickets created today, **When** they tap "Checkout" in the sidebar, **Then** a new empty ticket is created and they are routed to it (even if an open ticket from a previous day exists).
3. **Given** the signed-in operator has more than one open ticket they created today, **When** they tap "Checkout" in the sidebar, **Then** the most recently updated same-day open ticket is resumed. (No multi-ticket picker in this phase.)

---

### User Story 3 — Assign a different tech to one line in the cart (Priority: P3)

The technician at the front desk picked Mai as the working tech, but one of the services in the cart was actually performed by Linh. The technician needs to reassign that single line to Linh without changing the header pick and without re-adding the service.

**Why this priority**: Per-line tech attribution is required for fair tip splits and labor reporting later, but a single-tech-per-ticket default still produces a correct charged total today. The per-line override is a quality-of-life refinement on top of the core P1 flow, not a blocker for collecting money.

**Independent Test**: Add a service to a cart whose header tech is set to one staff member, open the line's tech chip, pick a different staff member, and verify only that line's assigned tech changes — other lines and the header pick remain unchanged.

**Acceptance Scenarios**:

1. **Given** a cart line is assigned to the header-picked tech, **When** the technician opens the line's tech chip and selects a different tech, **Then** only that line's tech assignment changes and the header-picked tech remains the default for any subsequently added lines.
2. **Given** a line's tech has been overridden, **When** the technician views the cart, **Then** the line's tech chip visibly indicates the overridden tech (not the header pick).

---

### User Story 4 — Print a paper receipt for a completed sale (Priority: P3)

After a cash sale is closed, the customer asks for a paper receipt. From the confirmation screen the technician opens a printable receipt and uses the browser's print dialog to send it to the salon's receipt printer.

**Why this priority**: Receipt issuance is expected at any retail counter and is often a tax-record need, but the in-app charged-confirmation screen already proves to the customer that the sale was captured. A printable receipt is required for a complete cash-sale experience but is independent of the core charge flow.

**Independent Test**: Complete a cash sale, navigate to the receipt URL for that ticket, trigger the browser print dialog, and verify the printed/print-previewed page lists the salon name, the services with prices, the total charged, and the payment method.

**Acceptance Scenarios**:

1. **Given** a ticket has been marked paid by a cash payment, **When** the technician opens the receipt page for that ticket, **Then** a printable layout is shown listing the line items (snapshotted name and price), the subtotal, the total charged, and the payment method (cash).
2. **Given** the printable receipt is shown, **When** the technician invokes the browser's print action, **Then** the receipt content prints (or print-previews) without studio chrome (no sidebar, no header nav).

---

### Edge Cases

- **Service added before a tech is picked**: The service tile grid is not interactive until a tech is selected from the tech row. Tapping a tile while no tech is picked has no effect (or surfaces a one-line hint asking the technician to pick a tech first).
- **Variable-price service in the cart**: A variable-price service can be added to the cart but lands with its price unconfirmed. While any cart line has an unconfirmed price, the "Take cash" button is disabled and the screen surfaces the hint "Set price on highlighted items." Tapping the line's price control in this phase opens a placeholder dialog that explains variable pricing will be available in the next checkout phase — no price entry is supported yet.
- **Empty cart**: With no lines in the cart, the "Take cash" action is disabled (no total to charge).
- **Removing the last line after one had been added**: The cart returns to its empty state; the "Take cash" action becomes disabled again. Subtotal/total return to $0.
- **Cancel from the checkout header**: The technician can cancel out of the checkout screen. The in-progress ticket remains "open" (it can be resumed via the sidebar per FR-003). Cancellation does not delete the ticket and does not mark it discarded.
- **Discard from the checkout header**: The technician can explicitly discard the in-progress ticket (customer walked out, wrong cart, etc.). The ticket transitions to "discarded", is no longer resumable, and is excluded from sales reporting. Once discarded, a ticket MUST NOT be re-opened in this phase.
- **Discard with a non-empty cart**: Allowed. The cart lines remain attached to the discarded ticket for audit history but the ticket as a whole is terminal.
- **Two devices opening the same open ticket**: There is no live multi-device sync in this phase. If two devices have the same open ticket on screen and one of them completes the cash sale, the other device's view will be stale until it is reloaded — known and accepted limitation, addressed in a later phase.
- **Browser refresh mid-cart**: The cart is the persisted ticket. After a refresh the same lines, tech assignments, and totals reappear from the server.
- **Tax**: Tax is $0 in this phase. Subtotal and total are equal.
- **Cash drawer**: A cash payment is accepted in this phase without first opening a drawer session. The need for a drawer-open gate is a known later requirement (see Out of Scope) and is intentionally not enforced here.
- **Tips on cash**: Cash tips are not captured in the app in this phase (matching the prototype). The confirmation screen reflects only the charged total.

## Requirements *(mandatory)*

### Functional Requirements

#### Entry and ticket lifecycle

- **FR-001**: The studio MUST expose two entry points that lead to the same cash-checkout experience: a "New transaction" call-to-action on the dashboard, and a "Checkout" item in the studio sidebar.
- **FR-002**: When the dashboard "New transaction" entry point is used, the system MUST always create a fresh, empty ticket (no client attached, no appointment attached) and route the operator to that ticket's checkout screen.
- **FR-003**: When the sidebar "Checkout" entry point is used, the system MUST resume the operator's open ticket only if that ticket was created on the current calendar day in the salon timezone AND its status is "open" (not "paid" and not "discarded"); otherwise the system MUST create a fresh empty ticket and route to it (per US2). When more than one of the operator's open tickets qualifies under this rule, the system MUST resume the most recently updated one. Open tickets from prior days, paid tickets, and discarded tickets MUST NOT be surfaced by the sidebar entry point.
- **FR-004**: A ticket created by either entry point MUST start in an "open" state with no client and no appointment associated. A ticket's status MUST be exactly one of: "open" (in progress), "paid" (terminal, successfully closed by a payment), or "discarded" (terminal, voided without a sale).
- **FR-005**: The system MUST distinguish between two checkout-exit actions:
  - **Cancel** — the operator steps away from the checkout screen without making a decision about the ticket. The ticket MUST remain in its "open" state with its cart intact so it can be resumed per FR-003.
  - **Discard** — the operator explicitly throws away the in-progress ticket (e.g., the customer walked out, the cart was a mistake). The ticket MUST transition to the terminal "discarded" state and MUST NOT be resumable thereafter. A discarded ticket MUST NOT be counted in sales reporting.
  Both actions MUST be reachable from the checkout screen; neither MUST be the default-on-back-button behavior (the operator's choice MUST be explicit).

#### Tech selection

- **FR-006**: The checkout screen MUST present a tech row above the service grid; until a tech is selected, the service grid MUST NOT add lines to the cart.
- **FR-007**: After a tech is selected, the tech row MUST collapse to a single chip showing the picked tech and provide a way to change the pick.
- **FR-008**: Any service line added to the cart MUST be assigned to the currently picked header tech at the time the line is added.

#### Cart and service selection

- **FR-009**: The service tile grid MUST be searchable and filterable by category (chip-style filters above the grid).
- **FR-010**: Tapping a service tile MUST append a new line to the cart at quantity 1 with a snapshotted name and snapshotted unit price taken from the catalog at the moment of the tap. (Subsequent changes to the catalog MUST NOT alter the line.)
- **FR-011**: Each cart line MUST be individually removable from the cart.
- **FR-012**: The cart MUST display a running subtotal, tax, and total. In this phase tax MUST be $0 and total MUST equal subtotal.
- **FR-013**: Each cart line MUST expose a tech chip that, when activated, lets the operator change that line's assigned tech independently of the header pick (per US3). Changing the header pick MUST NOT retroactively reassign existing lines.

#### Variable-price gating

- **FR-014**: A service whose catalog price is variable MUST be addable to the cart but MUST land with its price marked unconfirmed.
- **FR-015**: While any line in the cart has an unconfirmed price, the "Take cash" action MUST be disabled and the screen MUST display the hint "Set price on highlighted items."
- **FR-016**: In this phase, the line-level price control on an unconfirmed line MUST open a placeholder dialog that explains variable pricing is part of the next checkout phase. No price entry is accepted in this phase.

#### Cash payment

- **FR-017**: The payment area MUST display the same set of payment options as the prototype (cash, card, gift card, split). In this phase, only cash MUST be enabled; the other options MUST be visually present but disabled, with a "Coming soon" hover/long-press hint.
- **FR-018**: Activating the cash payment with a non-zero total and no unconfirmed-price lines MUST record a cash payment for the full current total and flip the ticket to a paid state as a single atomic operation, and MUST then route the operator to the confirmation screen. Recording the payment row and flipping the ticket status MUST NOT be independently observable — either both persist or neither does.
- **FR-019**: If the atomic cash-payment write in FR-018 fails for any reason (network error, database error, validation rejection), the system MUST leave the ticket in its prior open state with no payment row inserted, MUST keep the operator on the checkout screen with the cart intact, MUST surface a visible error banner indicating the payment did not save, and MUST re-enable the "Take cash" action so the operator can retry. The system MUST NOT show the confirmation screen, MUST NOT optimistically appear to succeed, and MUST NOT silently retry without operator action.
- **FR-020**: The cash payment MUST NOT prompt for or capture a tip in this phase.
- **FR-021**: The cash payment MUST proceed regardless of whether a cash-drawer session has been opened in this phase. (Drawer-session gating is later scope.)

#### Confirmation and follow-up

- **FR-022**: After a successful cash payment, the checkout screen MUST render a confirmation that prominently shows the charged total ("Charged $X").
- **FR-023**: The confirmation screen MUST expose a "New sale" action that, when activated, creates a fresh empty ticket (per FR-002) and routes the operator into it.

#### Receipt

- **FR-024**: For any paid ticket, the system MUST expose a printable browser-rendered receipt that lists the salon name, the line items (with snapshotted name and price), subtotal, total charged, and payment method.
- **FR-025**: The printable receipt MUST render without studio chrome (no sidebar, no header nav) so a default browser-print produces a clean page. No external PDF library is required in this phase.
- **FR-026**: The printable receipt page MUST require an active signed-in staff session to view; an unauthenticated request MUST NOT return receipt data, regardless of whether the requester knows the ticket identifier. No publicly shareable receipt URL is exposed in this phase. (Any future customer-facing share — email, SMS, signed link — is out of scope here.)

#### Visual/system constraints

- **FR-027**: All UI in this feature MUST follow the Lacquer design system: tokenized colors/spacing/radii, shadcn/ui primitives, Lucide icons, Inter typography, tabular numerals for currency. The layout MUST adapt the existing single-screen transaction prototype (do not redraw).

#### Authorization

- **FR-028**: Both entry points (dashboard "New transaction" and sidebar "Checkout") and every action inside the checkout flow (creating a ticket, adding/removing cart lines, assigning techs, taking cash, viewing the receipt) MUST be available to any signed-in staff member. The system MUST NOT impose an additional role check on top of "is signed in" in this phase. A formal POS-permission model (e.g., a per-staff "can take payment" flag, or owner/manager gating) is explicitly deferred to a later feature; this phase's behavior is the baseline that future permissions will narrow.

### Key Entities

- **Ticket**: A standalone sale record. Has a status that begins "open" and transitions to one of two terminal states: "paid" (a successful payment closed it out) or "discarded" (the operator explicitly voided the in-progress cart without a sale). May optionally reference a client and an appointment (both null in this phase). Holds the running cart through its associated items, and the payment record(s) that closed it.
- **Ticket item**: A line in the cart. References its parent ticket. In this phase, every item is a "service" kind. Holds a snapshot of the catalog name and unit price at the moment of add, a quantity, the assigned tech for that line, and a flag indicating whether its price is confirmed (always confirmed for fixed-price services in this phase; unconfirmed for variable-price services until a future phase supplies a price).
- **Payment**: A money-in record attached to a ticket. In this phase, the only payment kind is "payment" (no refunds, no voids) and the only payment method is "cash". Carries the amount, method, and a status that begins and ends "succeeded" for cash.
- **Appointment** (schema only): Introduced so that a ticket's optional appointment reference is satisfied by a real table. No appointments UI is in scope in this phase; the field on a ticket remains optional and unused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in technician can complete a cash-only sale (entry point → tech pick → one service → cash → confirmation) in under 30 seconds end-to-end on a typical front-desk device.
- **SC-002**: From either entry point, a fresh open ticket is created and the operator lands on the checkout screen in under 1 second of perceived latency.
- **SC-003**: When the sidebar "Checkout" entry point is used and the operator has an existing open ticket, the resumed cart matches the previously-saved state for that ticket 100% of the time (same lines, same tech assignments, same totals).
- **SC-004**: 100% of cash sales completed through this flow result in a ticket whose recorded status is paid and whose recorded payment total equals the cart total at the moment "Take cash" was activated.
- **SC-005**: 0% of cash sales completed through this flow capture a tip, prompt for a drawer session, attach a client, or attach an appointment (all of those are explicitly later scope).
- **SC-006**: The printable receipt for any paid ticket lists every line item with its snapshotted name and price and a payment method of "cash"; a default browser print produces a single-page receipt with no studio chrome.
- **SC-007**: In an unmoderated walk-through, a technician who has not seen the feature before can locate the "Take cash" action and complete a sale without external guidance.
- **SC-008**: 100% of tickets that the operator explicitly discards transition to a non-resumable "discarded" status and are excluded from any sales-total or payment-count reporting derived from this feature's data.

## Out of Scope

The following are explicitly deferred to later checkout phases and MUST NOT be built in this phase, even if a placeholder is visible in the UI:

- **Variable-pricing modal** (the actual price-entry UI). This phase shows a placeholder dialog only and disables charge when any line is unpriced.
- **Discount lines** and **bill preview**.
- **Client lookup and attach**, **walk-in seeding**, **appointment seeding**.
- **Card payment, gift card payment, split tender** (the tiles are rendered but disabled).
- **Square integration** (any provider integration for card or gift).
- **Tip capture and tip-split dialog**.
- **Voids and refunds**.
- **Cash-drawer "open session" gate** before cash sales are accepted.
- **Realtime payment sync / multi-device cart sync**.

A drawer-tracking TODO comment is left inline at the cash-payment boundary in code so the later phase can pick it up.

## Assumptions

- **Single salon, signed-in operator context**: A signed-in staff session is required to reach the checkout entry points. The "operator" referenced in FR-003's resume rule is the currently signed-in staff member.
- **Service catalog exists**: A populated service catalog (built in an earlier phase) is the source of the tile grid, the snapshotted line names, the snapshotted unit prices, and the variable-price flag per service.
- **Tech roster exists**: A populated staff roster (built in an earlier phase) is the source of the tech row and the per-line tech chip's option set.
- **Schema additions in this phase**: Tickets, ticket items, payments, and appointments are introduced as schema in this phase; appointments is schema-only (no UI). Schema changes follow the project's standard CI migration flow against the shared preview database — coordinate with any concurrent work that also touches `supabase/migrations/`.
- **Optimistic UI without realtime**: Cart mutations may render optimistically on the client; the server is the source of truth and a page refresh re-derives the cart from persisted lines. Multi-device live sync is intentionally absent.
- **Browser print only**: The receipt relies on the operator's browser print dialog. No PDF generation library, no email/SMS receipt delivery, no thermal-printer-specific stylesheet beyond a clean printable layout.
- **Desktop-first studio**: The single-screen checkout assumes a typical salon front-desk device (tablet or laptop class, landscape). A small-mobile-optimized variant is not in scope.
- **No tax in v1**: Tax is recorded as $0. The tax line is rendered so the layout matches the prototype, but it is always zero in this phase.
