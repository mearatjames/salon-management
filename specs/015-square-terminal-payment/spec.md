# Feature Specification: Square Terminal Card Payment

**Feature Branch**: `015-square-terminal-payment`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Add Square Terminal card payment to the existing checkout. OAuth, terminal cloud-to-device, webhook + 5s polling fallback."

## Clarifications

### Session 2026-05-16

- Q: When front desk retries a failed card payment, does the system reuse the original Payment row or create a new one? → A: One Payment row per attempt. Failed rows stay `failed` for audit; each retry creates a fresh row with its own `payment_id`, Square checkout id, and raw payload. The idempotency key `${ticket_id}:${payment_id}` is naturally unique per attempt.
- Q: When front desk cancels a payment but Square confirms the card was already charged, which signal wins? → A: Square wins. A succeeded webhook always settles the payment to `succeeded` and the ticket to paid, even if front desk had requested cancel. Front desk sees a clear "card was charged before cancel reached the terminal" notice and is advanced to Done. Reversing the charge is a refund (out of scope for this phase).
- Q: How does front desk pick a terminal when the salon has more than one paired? → A: Owner marks one device as the salon default in settings; the checkout picker pre-selects it and lets front desk override per-checkout with one tap. Single-terminal salons skip the picker entirely.
- Q: What happens to a card payment that stays `pending` for an extended period (terminal crashed, customer walked away)? → A: After 5 minutes of `pending` with no resolution from webhook or polling, the system auto-marks the payment `failed` with reason `expired`. No new admin UI in this phase. If a late `succeeded` webhook arrives for an expired row, Square still wins (per the cancel-vs-success rule) and the payment flips to `succeeded`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect the salon to Square (Priority: P1)

The salon owner opens settings, clicks **Connect Square**, signs in to Square in a hosted flow, and is returned to a settings screen that lists the salon's Square Terminal devices. The owner gives each terminal a friendly name (e.g., "Front desk," "Back room") so staff can pick the right one at checkout.

**Why this priority**: Without a Square connection and at least one named device, the salon cannot accept card payments at all. This is the foundation everything else in the feature rests on, and on its own it delivers visible setup value (the owner can see "we're connected; here are our terminals").

**Independent Test**: With nothing connected, click Connect Square, complete the sandbox OAuth flow, return to settings, see at least one terminal device listed, rename it, and confirm the connection persists across reload.

**Acceptance Scenarios**:

1. **Given** the salon has never connected Square, **When** the owner clicks Connect Square and completes the hosted authorization, **Then** the settings page returns showing "Connected" with the merchant's name and a list of paired terminal devices.
2. **Given** Square is connected with a paired terminal, **When** the owner edits the device's friendly name to "Front desk" and saves, **Then** the new name appears wherever terminals are selected (settings list and the checkout device picker).
3. **Given** Square is connected, **When** the owner clicks Disconnect and confirms, **Then** the connection is removed, no Square tokens remain stored, and the Card payment option in checkout becomes unavailable until reconnected.
4. **Given** Square is connected, **When** time passes such that the stored access token would otherwise expire, **Then** the system has refreshed the token in the background and card payments continue to work without owner intervention.

---

### User Story 2 - Take a card payment from a customer (Priority: P1)

At checkout, front desk picks **Card** (or, on a single-method "Card" salon, the default Charge action), the ticket total is sent to the customer's Square Terminal, the customer taps/inserts their card and chooses a tip on the device, and the cart automatically advances to the Done screen as soon as the payment succeeds.

**Why this priority**: This is the entire reason the feature exists — accepting cards is the most common payment method. Even with the OAuth flow built, no salon value is delivered until front desk can actually take a card payment end-to-end.

**Independent Test**: With Square already connected and a paired sandbox terminal, start a ticket, pick Card, watch the chosen terminal display the amount, complete the tap with a sandbox card, and confirm the cart screen flips to Done with the tip recorded.

**Acceptance Scenarios**:

1. **Given** a ticket with at least one service and Square is connected with one terminal, **When** front desk picks Card on the payment-method screen, **Then** the screen shows "Send to Square Terminal · $X" with X equal to the ticket total to the cent.
2. **Given** front desk has tapped Send to Square Terminal, **When** the chosen device is online, **Then** within a few seconds the device displays the amount, a tip prompt, and the card-entry UI.
3. **Given** the customer taps a valid card and selects a tip on the device, **When** Square confirms the payment, **Then** the ticket flips to paid, the customer's tip is recorded against the ticket, and the cart screen advances to Done without any extra tap from front desk.
4. **Given** front desk has sent a checkout but the webhook has not arrived after a few seconds, **When** the waiting screen polls Square directly, **Then** the screen advances to Done as soon as the underlying payment is observed as succeeded, regardless of webhook delay.
5. **Given** the salon has more than one paired terminal, **When** front desk picks Card, **Then** they can choose which named terminal to send the amount to before confirming.

---

### User Story 3 - Cancel or recover from a card payment in progress (Priority: P2)

While waiting for the customer to tap their card, front desk taps **Cancel and pick a different method**. The terminal cancels its prompt, the cart returns to the payment-method screen, and front desk can pick Cash (or another method) without leaving a stuck transaction behind.

**Why this priority**: Card payments fail in real-world ways — customer's card is declined, device is offline, customer changes their mind, the terminal locks up. Without graceful recovery, every failure becomes a manual reset by the owner. This is not the MVP but it is required before the feature is usable in a live salon.

**Independent Test**: With a checkout sent to a sandbox terminal, before tapping a card, click Cancel and pick a different method. Confirm the terminal screen returns to idle, the cart returns to the payment-method screen, and choosing Cash for the same ticket completes normally.

**Acceptance Scenarios**:

1. **Given** the cart is on the waiting screen, **When** front desk taps Cancel and pick a different method, **Then** the terminal cancels its prompt and the cart returns to the payment-method screen with the ticket still open.
2. **Given** a terminal payment fails (declined card, device offline, timeout), **When** Square reports the failure, **Then** the waiting screen shows a clear failure message and offers to try again or pick a different method, without marking the ticket as paid.
3. **Given** the same webhook is delivered to the system twice (Square retry), **When** the second delivery arrives, **Then** the ticket and payment row are not modified a second time — no duplicate tip, no duplicate payment record.

---

### Edge Cases

- **Square not connected**: When no Square connection exists, the Card option in checkout is hidden (or shown disabled with "Connect Square in settings to accept cards"). The single-method "Charge" default is replaced with a setup prompt.
- **No paired terminals**: When Square is connected but the merchant has no Terminal devices, the Card option shows "No Square Terminal paired — pair one in the Square Dashboard" instead of failing silently.
- **Token refresh failure**: When the daily refresh cannot get a new access token (revoked authorization, network outage that persists past the buffer), the settings page shows a "Reconnect" banner and the Card option falls back to disabled until the owner reconnects.
- **Tampered or unsigned webhook**: Any webhook request whose signature does not verify is rejected with HTTP 401 and the payment state is not touched.
- **Webhook arrives for an unknown checkout**: A webhook for a checkout the system did not create (or has no payment row for) is acknowledged but ignored, never crashing the handler.
- **Device offline mid-checkout**: If the terminal stops responding before the customer taps, polling surfaces the eventual failure state and the cart returns to the recovery flow described in User Story 3.
- **Webhook never arrives**: If the polling fallback also fails for an extended period (terminal hung), front desk can cancel and pick a different method. The payment row remains `pending` and is auto-marked `failed` (reason `expired`) after 5 minutes; no admin UI is added in this phase to surface stuck rows.
- **Partial payment coverage**: When existing payments on the ticket plus this terminal payment do not yet cover the total (e.g., partial payment scenarios outside this phase), the ticket does NOT flip to paid even if the terminal succeeded.
- **Cancel races a successful charge**: If front desk taps Cancel after the customer has already tapped their card, Square is authoritative. A `terminal.checkout.updated → SUCCEEDED` event for the cancel-requested payment still settles the payment to `succeeded` and the ticket to paid. Front desk sees a notice on the Done screen — "Card was charged before cancel reached the terminal." (Refunding is out of scope for this phase.)

## Requirements *(mandatory)*

### Functional Requirements

**Connecting Square (owner-facing setup)**

- **FR-001**: Owners MUST be able to start a Square authorization flow from a single button in settings.
- **FR-002**: Once authorization completes, the system MUST store the salon's Square access and refresh credentials encrypted at rest such that a database dump alone does not expose them.
- **FR-003**: The system MUST list the salon's paired Square Terminal devices on the settings page after a successful connection.
- **FR-004**: Owners MUST be able to assign and edit a friendly name on each terminal device; the friendly name is what staff see at checkout.
- **FR-005**: Owners MUST be able to disconnect Square; disconnection removes the stored credentials and immediately makes the Card payment option unavailable.
- **FR-006**: Owners MUST be able to reconnect Square (re-run the authorization flow) without first disconnecting.
- **FR-007**: The system MUST refresh the Square access token on a recurring schedule before the token expires, with no owner action required in the happy path.
- **FR-008**: If a token refresh fails after retries, the system MUST surface a "Reconnect" prompt in settings and disable Card payments until reconnected.

**Taking a card payment (front-desk-facing flow)**

- **FR-009**: Front desk MUST be able to pick Card as a payment method whenever Square is connected and at least one terminal is paired.
- **FR-010**: Front desk MUST be able to pick which named terminal to send the amount to when the salon has more than one paired terminal; a single-terminal salon skips this picker.
- **FR-010a**: Owners MUST be able to designate exactly one paired terminal as the salon default in settings. At checkout, the terminal picker MUST pre-select the default device, allowing front desk to confirm with one tap on the common path and override per-checkout for the exceptional path. If no default has been set yet (multi-terminal salon with no choice made), the picker shows nothing pre-selected and requires an explicit choice.
- **FR-011**: When the cart is sent to the terminal, the device MUST display the exact ticket total in dollars and cents.
- **FR-012**: The customer MUST choose any tip on the Square Terminal device (not in the salon app); the system MUST record the chosen tip amount server-side against the ticket.
- **FR-013**: While the terminal is waiting on the customer, the cart screen MUST show a clear waiting state with instruction copy ("Hand the terminal to your client") and an option to cancel and pick a different method.
- **FR-014**: When the payment succeeds, the system MUST mark the corresponding payment as succeeded, flip the ticket to paid if total payments cover the ticket, and advance the cart to the Done screen automatically — no extra tap from front desk.
- **FR-015**: When the payment fails (decline, cancellation, device error), the system MUST mark the payment as failed and offer to try again or pick a different method, without ever flipping the ticket to paid. A retry MUST create a new Payment row; the failed row stays in the database for audit and is never reused or mutated back to `pending`.
- **FR-016**: Front desk MUST be able to cancel a pending terminal payment from the waiting screen; cancellation MUST cause the terminal to stop prompting the customer.
- **FR-016a**: Square is the authoritative source on whether money moved. If a `succeeded` event arrives after a cancel was requested (or after the local payment was marked cancelled), the system MUST settle the payment to `succeeded`, flip the ticket to paid, and advance the cart to Done with a notice that the card was charged before cancel could land. The system MUST NOT leave the ticket unpaid when Square has taken the money.

**Settlement signals (system-facing)**

- **FR-017**: The system MUST accept payment-status updates from Square at a dedicated endpoint and MUST reject any request whose cryptographic signature does not verify.
- **FR-018**: The system MUST also poll Square directly for the active terminal checkout while its status is pending, as a fallback for delayed or dropped webhooks.
- **FR-019**: The system MUST handle repeated deliveries of the same payment-update event without producing duplicate payments, duplicate tips, or repeated ticket transitions (idempotent processing).
- **FR-020**: The system MUST store, against each payment, enough to trace it back to Square: the Square payment identifier, the Square terminal checkout identifier, the tip amount, and the raw event payload for audit.
- **FR-021**: The system MUST use a deterministic key when creating a Square terminal checkout so that retries from the salon app do not create duplicate Square charges.
- **FR-021a**: A Payment row that has been `pending` for longer than 5 minutes with no terminal response MUST be auto-marked `failed` with a recorded reason of `expired`. If Square later delivers a `succeeded` event for that same payment, the system MUST still settle it to `succeeded` (Square remains authoritative).

**Operability**

- **FR-022**: A developer running the app against the Square sandbox MUST have a documented path to receive webhooks on their local machine for end-to-end testing.

### Key Entities

- **Square Connection** — the salon's authorization to act against its Square account; tied to merchant identity and expiring credentials; one per salon.
- **Terminal Device** — a Square Terminal physical device paired to the salon's merchant account; has a Square-assigned identity, a salon-assigned friendly name, and a salon-default flag (at most one device per salon is the default); zero or more per salon.
- **Payment** — a record on a ticket capturing **one attempt** to collect money via a specific method; for a card payment it carries amount, tip, status (pending/succeeded/failed), a Square payment identifier, a Square terminal checkout identifier, and the raw event payload for audit. A ticket can have multiple Payment rows over its lifetime — for example, a declined card attempt (`failed`) followed by a successful one (`succeeded`).
- **Ticket** — already exists; for this feature it transitions to **paid** when the sum of succeeded payments covers the ticket total.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A salon owner can go from "never connected" to "connected with a named terminal device" in under 5 minutes, without reading external documentation.
- **SC-002**: Front desk can take a successful card payment end-to-end (pick Card → device prompts → customer taps → Done) in fewer than 4 taps on the salon app.
- **SC-003**: 95% of successful card payments advance from "Send to Square Terminal" tap to the Done screen within 60 seconds (assuming a cooperative customer).
- **SC-004**: When a webhook is delayed or dropped, the waiting screen still advances within 10 seconds of the underlying payment succeeding, via the polling fallback.
- **SC-005**: Duplicate or replayed payment-status events produce exactly zero duplicate payment rows, zero duplicate tips, and zero duplicate ticket transitions across 1,000 simulated replays.
- **SC-006**: Stored Square credentials cannot be read from a raw database export without the encryption key; a security review of token storage passes with no critical findings.
- **SC-007**: After a successful card payment, the recorded tip on the ticket matches what the customer chose on the device, cent-for-cent, in 100% of cases.

## Assumptions

- **Single Square merchant per salon.** The salon authorizes one Square merchant account; multi-merchant or per-staff Square logins are out of scope.
- **Square Terminal handles tip UX.** Tips are collected on the Square Terminal device's native screen (not in the salon app's UI). The salon app reads the chosen tip back from Square and stores it on the payment.
- **Terminals are paired in Square Dashboard, not in this app.** The salon app reads the list of devices the merchant has paired in Square; the app does not enroll, pair, or factory-reset devices.
- **Sandbox in development, production in production.** Which Square environment is used is determined by deployment environment, not by an owner-facing toggle.
- **Receipts are out of scope for this phase.** Emailing or SMS-ing a card-payment receipt to the customer is handled by Square's own customer-prompt flow on the device and/or by the customer's bank statement; the salon app does not send its own receipt in this phase.
- **No partial card payments.** The terminal is always sent the full remaining ticket balance; splitting card across multiple cards or methods is part of the split-tender phase (out of scope here).
- **Realtime channel is scoped narrowly.** A subscription to live payment-status updates exists only for the open ticket on the waiting screen in this phase. Broader cross-screen payment realtime is a later phase.

## Out of Scope

The following are explicitly NOT delivered by this feature:

- **Gift card redemption** — accepting a gift card as a payment method is part of a later phase.
- **Split tender** — splitting a single ticket across multiple methods (e.g., $40 card + $10 cash) is part of a later phase.
- **Refunds** — refunding a completed card payment is part of a later phase.
- **Selling gift cards** — issuing new gift cards through Square is post-v1.
- **Manual card-not-present entry** — typed card numbers, invoices, or remote payment links are not part of this phase.
- **Reporting / settlement views** — listing all Square transactions, daily settlement reports, and reconciliation tools are out of scope.
