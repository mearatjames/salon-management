# Feature Specification: Gift card redemption & split-tender checkout

**Feature Branch**: `018-gift-card-split-tender`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Add Square gift card redemption and split-tender (multiple payments composing one ticket). Gift card flow with GAN entry, balance lookup, partial-balance auto-split, and explicit split mode for composing 2+ payment legs across cash / card / gift methods. Each leg charged through its existing flow; ticket completes when succeeded legs sum to total. Out of scope: selling/issuing gift cards and digital-wallet UI."

## Clarifications

### Session 2026-05-17

- Q: GAN masking in audit logs — what should the audit log persist for a gift-card transaction? → A: Mask to last 4 only (audit row records `••••1234` plus the upstream gift_card_id; the full number is never persisted in the salon's own datastore).
- Q: After a partial gift-card payment leaves balance owed, how is the next leg set up? → A: Auto-open split mode with the owed amount pre-filled as leg 2; staff only picks a method and activates.
- Q: Can the staff enter Split mode after a non-split payment leg has already succeeded? → A: Yes — Split is available at any time before the ticket is fully paid, regardless of how many legs have already succeeded.
- Q: What does the cart allow while a card-on-terminal leg is in-progress? → A: Cart is read-only/frozen until that leg resolves (succeeded, failed, or cancelled). No edits, no other leg activations.
- Q: How are pending unactivated split legs persisted across page reload / device switch? → A: Persisted server-side per ticket; reload (and a different device that opens the same ticket) restores them. Already aligned with FR-022's server-side awareness of the charging session.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Redeem a gift card that covers the whole ticket (Priority: P1)

A customer hands the front desk a salon gift card for a ticket that the gift card can fully cover. The staff member picks the "Gift card" payment tile, enters the gift card number on a numpad sheet, sees the available balance, confirms the redemption, and the ticket flips to paid without needing any other payment method.

**Why this priority**: This is the simplest and most common gift-card path — a customer is using a card whose balance is sufficient. Without it, the salon cannot accept gift cards at all, which is the headline capability of this feature.

**Independent Test**: With a known active gift card whose balance ≥ a test ticket's amount due, the staff can complete checkout end-to-end using only the gift card, and the ticket transitions to a paid state with a single recorded payment. Verifiable on its own without split tender working.

**Acceptance Scenarios**:

1. **Given** a ticket with amount due of $40 and a gift card with $60 available, **When** the staff selects "Gift card", enters the gift card number, and confirms, **Then** the system charges $40 to the gift card, leaves $20 on the card, and marks the ticket paid.
2. **Given** a ticket with amount due of $40 and a gift card with exactly $40 available, **When** the staff redeems the gift card, **Then** the system charges $40, the card balance becomes $0, and the ticket is marked paid.
3. **Given** the staff has typed a partial gift card number, **When** the staff dismisses the numpad sheet, **Then** no payment is attempted and the cart returns to the unpaid state with the payment tiles re-enabled.

---

### User Story 2 — Split a ticket across two payment methods (Priority: P2)

A customer wants to pay part of their bill in cash and the rest on a credit card (or any combination of cash, card, and gift card). The staff member taps a "Split" affordance on the payment tile row, enters the amount and method for each leg, and then activates each leg in turn. As legs succeed, the cart shows running totals ("Paid $X of $Y · Owes $Z") until the ticket is fully paid.

**Why this priority**: Splitting is a common ask at the front desk and is the structural foundation that makes the partial-gift-card path (Story 3) work. It is P2 rather than P1 only because a salon can still take any single payment without it.

**Independent Test**: For a $60 ticket, the staff can compose a $20 cash leg + $40 card leg, activate them in order, and have the ticket transition to paid only when both succeed. Verifiable without gift cards involved at all.

**Acceptance Scenarios**:

1. **Given** a $60 ticket with no payments yet, **When** the staff enters split mode, composes a $20 cash leg and a $40 card leg, activates the cash leg (which records instantly), and activates the card leg (which the customer completes on the terminal), **Then** the ticket is marked paid and shows two payment records totaling $60.
2. **Given** a split ticket with one pending leg not yet activated, **When** the staff removes that pending leg, **Then** the leg is discarded, the "owes" running total updates, and no payment record is created for it.
3. **Given** a split ticket with one succeeded leg and one pending leg, **When** the staff cancels the in-progress activation of the pending leg before it completes (e.g., cancels on the terminal), **Then** only the succeeded leg remains recorded and the pending leg returns to the unactivated state for retry or removal.
4. **Given** the staff is composing split legs, **When** the sum of leg amounts does not equal the amount due, **Then** the system prevents activation of legs (or activation of the last leg) until the leg amounts exactly cover the amount due.

---

### User Story 3 — Redeem a partial-balance gift card and finish on another method (Priority: P3)

A customer presents a gift card whose remaining balance is less than the amount due. The staff picks "Gift card", enters the number, and sees that the card cannot cover the ticket. The system applies the card's available balance to the ticket, transitions the cart into a "balance still owed" state, and the staff picks a second payment method (cash, card, or another gift card) to close out the ticket.

**Why this priority**: This is a real but less common case (a customer's gift card balance has been partially consumed in a prior visit). It depends on both Story 1 (gift card redemption) and Story 2 (split tender) working, so it ships after them.

**Independent Test**: With a known gift card with $15 available and a $40 ticket, the staff redeems the card, sees "Owes $25", picks cash, and closes the ticket. The ticket ends with two recorded payments ($15 on the gift card, $25 cash) summing to the ticket total.

**Acceptance Scenarios**:

1. **Given** a $40 ticket and a gift card with $15 available, **When** the staff redeems the gift card, **Then** the system charges $15 to the gift card, marks that leg succeeded, and the cart shows "Paid $15 of $40 · Owes $25" with the payment tiles re-enabled.
2. **Given** the state from scenario 1, **When** the staff then selects Cash and confirms $25, **Then** the cash leg records instantly and the ticket flips to paid with two payment records totaling $40.
3. **Given** a $40 ticket and a gift card with $0 available, **When** the staff enters the gift card number, **Then** the system shows "$0 available on this card" and does not allow the gift card to be applied; the ticket remains unpaid and the staff can pick another method.

---

### Edge Cases

- **Unknown / invalid gift card number**: The lookup returns no card. Staff sees a clear "Gift card not found" message and can re-enter or cancel; no payment is attempted and the ticket state is unchanged.
- **Inactive or blocked gift card**: The lookup returns a card in a non-redeemable state. Staff sees a clear "Gift card not available for use" message; no redemption is attempted.
- **Gift card with zero balance**: Lookup succeeds but balance is $0. Staff sees "$0 available on this card"; the redeem button is disabled; staff can dismiss and try a different method.
- **Network or upstream payment-provider failure during gift-card lookup**: Staff sees a retryable error and can re-attempt or choose another method; no partial state is left on the ticket.
- **Failed payment leg (card declined, terminal timeout, etc.)**: The failed leg is shown as failed in the cart, does not count toward "paid", and can be removed or retried. Other succeeded legs are preserved.
- **Staff edits the cart (adds/removes a service, applies a discount) while pending unactivated split legs exist**: Pending unactivated legs are invalidated and discarded so the staff re-composes them against the new amount due. Succeeded legs are preserved and the amount due is recomputed against them.
- **Duplicate activation attempts on the same leg (double-tap, retry on flaky network)**: The system processes the leg exactly once; a second submit is recognised as a retry of the same intent rather than a new charge.
- **Two staff members open the same ticket on different devices and attempt to charge in parallel**: Only one charging operation per leg succeeds; the loser sees a clear "ticket already being charged" message and is shown the current state.

## Requirements *(mandatory)*

### Functional Requirements

#### Gift card redemption

- **FR-001**: System MUST present "Gift card" as a selectable payment method alongside the existing methods (cash, card-on-terminal) in the cart's payment tile row.
- **FR-002**: System MUST collect the gift card number from the staff via a numpad sheet that is keyboard- and touch-friendly, and MUST allow the staff to cancel out of the sheet without side effects.
- **FR-003**: System MUST look up the gift card by number against the upstream payment provider and display the card's available balance to the staff before any charge is attempted.
- **FR-004**: System MUST distinguish, in the UI, between "card not found", "card found but not redeemable", and "card found with zero balance" so that the staff knows what to do next.
- **FR-005**: When the gift card's available balance is greater than or equal to the amount due, the system MUST charge exactly the amount due (not the full balance) to the gift card upon staff confirmation.
- **FR-006**: When the gift card's available balance is greater than zero but less than the amount due, the system MUST charge the available balance to the gift card and automatically enter split mode with a pre-populated next leg whose amount equals the remaining owed balance. The staff MUST only need to pick a method and activate that pre-populated leg — no separate "enter amount" step.
- **FR-007**: System MUST cache a record of each redeemed gift card locally — at minimum its number, its last-known available balance, and the time that balance was last refreshed — so that repeated lookups for the same card within a short window do not require a fresh round-trip if a recent balance is acceptable.
- **FR-008**: System MUST treat the gift card number as sensitive; it MUST NOT be displayed in plaintext after entry except as a masked tail (e.g., last 4) on receipts and in audit/history views.

#### Split tender

- **FR-009**: System MUST provide an affordance (a "Split" control) on the payment tile row that switches the cart footer into split-composition mode. This control MUST be available at any time before the ticket is fully paid — including after one or more non-split payment legs have already succeeded (in which case Split mode opens with leg amounts that account for the already-succeeded payments and target the still-owed balance).
- **FR-010**: In split mode, system MUST let the staff add 2 or more payment legs, where each leg has an amount and a payment method (cash, card-on-terminal, or gift card).
- **FR-011**: System MUST continuously display, in split mode, the running totals: amount paid (sum of succeeded legs), amount due, and amount still owed (amount due − amount paid − sum of pending unactivated legs).
- **FR-012**: System MUST prevent activating the final leg unless the sum of all legs (succeeded + pending) exactly equals the ticket's amount due.
- **FR-013**: For each leg, system MUST run that leg through its method's existing flow — cash legs record instantly; card legs send to the terminal for that specific leg amount; gift-card legs prompt for a gift card number.
- **FR-014**: System MUST allow the staff to remove any leg that has not yet been activated, recompute totals, and continue.
- **FR-014a**: Pending unactivated split legs (their composed amount and chosen method) MUST be persisted server-side against the ticket so that a browser reload, tab switch, or opening the same ticket from a second device restores the in-progress split composition exactly as it was. Pending legs MUST be discarded only when the staff explicitly removes them, when the ticket flips to paid, when an edit to the cart invalidates them (per the edge-case rule above), or when the ticket itself is voided.
- **FR-015**: System MUST NOT allow a succeeded leg to be removed or edited from this checkout flow; reversal of a succeeded leg is handled exclusively through the refund flow.
- **FR-016**: System MUST mark the ticket paid only when the sum of succeeded legs equals the amount due AND there are no pending unactivated legs and no in-progress activations.
- **FR-017**: System MUST persist all payment legs (their amount, method, and outcome) against the ticket so they appear on receipts and in the ticket's payment history.
- **FR-018**: System MUST ensure each leg's interaction with the upstream payment provider is idempotent — re-submitting the same leg after a network blip or accidental double-tap MUST NOT result in a second charge.
- **FR-019**: When a leg fails (decline, timeout, customer cancel), system MUST show the leg as failed without marking the ticket paid, and MUST allow the staff to retry that leg or remove it and compose a different one.
- **FR-019a**: While a payment leg is in-progress (e.g., a card-on-terminal charge awaiting customer dip/tap, or a gift-card charge awaiting upstream confirmation), the cart MUST be read-only: no cart edits, no leg composition changes, no activation of any other leg, until the in-progress leg resolves to a terminal state (succeeded, failed, or cancelled).

#### Cross-cutting

- **FR-020**: System MUST recover gracefully when the upstream payment provider is slow or unreachable for either lookup or charge — the staff is shown a clear retry-or-cancel state and the ticket is not left in an inconsistent paid/unpaid limbo.
- **FR-021**: System MUST log each gift-card lookup and each payment-leg attempt (with outcome) to the audit history so that disputes and reconciliation can be investigated after the fact. Gift card numbers in audit rows MUST be masked to the last 4 digits only (e.g., `••••1234`); the full gift card number MUST NOT be persisted in the salon's datastore. The upstream payment provider's stable gift_card_id MAY be stored alongside the mask to allow correlation with the provider's own records.
- **FR-022**: System MUST ensure only one staff member can be actively charging a given ticket at a time — concurrent attempts on the same ticket from different devices MUST be detected and the second attempt rejected with a clear message.

### Key Entities *(include if feature involves data)*

- **Gift card**: A redeemable stored-value instrument issued by the upstream payment provider. Identified by its number; carries an available balance and a redeemable/non-redeemable state. The salon caches a row per encountered gift card to avoid repeated lookups, holding the last-known balance and when it was last refreshed.
- **Payment leg**: A single charge against a ticket via one payment method for a specific portion of the amount due. A ticket with one payment method has one leg; a split ticket has 2 or more legs. Each leg has an amount, a method, an outcome (pending / in-progress / succeeded / failed), and is the unit of idempotency for the upstream payment provider.
- **Ticket payment state**: The aggregate state of a ticket's payments — derived from the sum of its succeeded legs versus its amount due. A ticket is "paid" only when succeeded legs sum to amount due and no legs are pending or in-progress.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A trained staff member can complete a full-balance gift-card checkout (Story 1) in under 30 seconds from selecting the "Gift card" tile to the ticket flipping paid, on a stable network.
- **SC-002**: A trained staff member can complete a two-leg split-tender checkout (Story 2) in under 90 seconds from tapping "Split" to the ticket flipping paid, on a stable network.
- **SC-003**: For partial-balance gift-card checkouts (Story 3), the system transitions automatically into "balance still owed" mode with at most one staff tap between the gift-card success and the second payment method's entry screen.
- **SC-004**: No customer is double-charged: across a 30-day audit window, the count of duplicate upstream charges attributable to this checkout flow is 0.
- **SC-005**: No ticket is left in an inconsistent paid/unpaid state: across a 30-day audit window, the count of tickets whose recorded succeeded-leg total disagrees with their displayed payment status is 0.
- **SC-006**: For every gift-card lookup that the upstream provider answers, the staff sees a definitive available-balance figure or a definitive error (not-found / not-redeemable) within 3 seconds on a stable network.

## Assumptions

- **Tipping is out of scope for this feature.** Tang Nails has not yet shipped a tip flow in checkout, so neither gift cards nor split legs handle tip allocation in this feature. If tipping is added later, gift-card and split behaviour will need to be revisited.
- **Gift cards are not sold or topped up in this feature.** Issuing, loading, or reloading gift cards is explicitly out of scope; this feature only redeems pre-existing gift cards that the customer brings to the salon.
- **Digital wallets (Apple Pay, Google Pay) need no extra UI in this feature.** They flow through the card-on-terminal leg automatically via the existing terminal integration.
- **Gift-card overage stays on the card.** When a gift card's balance exceeds the amount due, the salon charges only the amount due and leaves the residual balance on the card for future use. The salon does not auto-refund overage as cash.
- **A gift card is identified only by its number** at the front desk; there is no separate PIN or customer-identity check required to redeem it. (If the upstream payment provider enforces additional verification, those checks flow through as native upstream errors.)
- **Refunds and reversals of completed split-tender legs are handled by the separate refund flow (a later phase) and are not part of this feature.** This feature is forward-direction only: composing payments to bring a ticket to paid.
- **One nail-salon location, one cash drawer, one terminal.** Multi-location or multi-terminal coordination is not in scope; the concurrent-edit protection (FR-022) covers the single-site, multi-staff-device case only.
- **The existing per-ticket-multiple-payment-rows data model from earlier checkout phases is reused.** This feature adds the gift-card entity and any leg-state fields the split flow needs; it does not redesign the ticket↔payments relationship.
