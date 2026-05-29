# Feature Specification: Privileged-Action Overrides — Voids & Refunds

**Feature Branch**: `052-privileged-action-overrides`

**Created**: 2026-05-28

**Status**: Draft

**Input**: User description: "Add the privileged-action paths: same-day voids and any-time refunds, both gated by a manager-PIN inline override. Reusable ManagerPinDialog; verifyManagerPin server action against active owner/manager pin_hash, no lockout. Same-day void on a paid/partially-paid ticket in checkout. Post-close full/partial refund from the dashboard recent-transactions feed and the End-of-Day day report via a refund composition sheet. Discount manager-PIN gate when a discount line exceeds settings.discount.manager_threshold_cents. Out of scope: re-opening a voided ticket, goodwill refunds without an original payment."

## User Scenarios & Testing *(mandatory)*

A salon manager or owner needs to be able to correct money mistakes — a sale rung wrong, a customer who changes their mind, a service refunded after the fact — without giving every staff member the power to reverse sales. The salon's policy is that **anyone working the counter can start a reversal, but a manager or owner must approve it on the spot** by entering their PIN. This feature adds the three places that policy shows up: voiding a same-day sale, refunding a past sale, and approving an oversized discount.

### User Story 1 - Void a same-day sale with manager approval (Priority: P1)

A staff member rang up and collected payment for a ticket today, then realizes it was wrong (wrong customer, duplicate sale, customer walked out). While the day is still open, they open the ticket in checkout and choose "Void sale." A PIN keypad appears asking for an owner or manager PIN. A manager enters their PIN, the sale is fully reversed — every payment that was taken is refunded back by its original method — and the ticket is marked as voided. The action is recorded showing both who operated and who authorized it.

**Why this priority**: This is the core privileged-action path and the most common real-world correction. It establishes the reusable manager-PIN approval gate that the other stories depend on, so it is both the highest-value slice and the foundation. Shipping just this delivers a working, auditable same-day reversal.

**Independent Test**: On a salon with a paid same-day ticket, attempt "Void sale," confirm the PIN gate blocks until a valid owner/manager PIN is entered, then confirm the ticket shows as voided, refund entries exist for each original payment, and the audit trail names both operator and authorizer. Fully testable without any of the other stories.

**Acceptance Scenarios**:

1. **Given** a same-day ticket fully paid by cash, **When** a staff member chooses "Void sale" and a manager enters a valid PIN, **Then** the ticket status becomes voided, a refund entry is created mirroring the cash payment, and the action is recorded with the operator and the authorizing manager.
2. **Given** a same-day ticket paid by card, **When** the void is approved, **Then** the card payment is refunded through the card processor and the ticket is voided; if the processor refund fails, the void does not silently complete (the operator is told it failed and the ticket is not left half-reversed).
3. **Given** a same-day ticket paid by a split of cash and card (or gift), **When** the void is approved, **Then** a refund entry is created for **each** completed payment by its matching method.
4. **Given** the PIN keypad is shown, **When** a PIN that does not belong to an active owner or manager is entered (wrong PIN, or a technician's PIN), **Then** the action is rejected with a clear message and nothing is changed.
5. **Given** a partially-paid ticket (some payment collected, balance outstanding), **When** "Void sale" is approved, **Then** the collected payments are refunded and the ticket is voided.
6. **Given** a ticket that is already voided, **When** a staff member views it, **Then** "Void sale" is not offered again (no double-void), and re-opening a voided ticket is not available.

---

### User Story 2 - Refund a past sale, full or partial, with manager approval (Priority: P2)

After a sale's day has closed — or any time later — a customer returns wanting money back, in full or for just part of what they bought. From the dashboard's recent-transactions feed or from the End-of-Day day report, a staff member chooses "Refund" on the transaction. A refund composition sheet opens listing the payments that were taken. The staff member picks which payment(s) to refund and enters an amount for each (never more than what was originally taken on that payment). They submit, a manager enters their PIN, and the chosen amounts are refunded by their original methods. The ticket is then marked as fully refunded or partially refunded depending on how much of it has now been returned.

**Why this priority**: Refunds are essential but lower-frequency than same-day corrections, and they reuse the manager-PIN gate built in Story 1. Partial-refund composition is meaningfully more complex than an all-or-nothing void, so it follows once the approval mechanism is proven.

**Independent Test**: From the dashboard recent-transactions feed, open "Refund" on a past paid ticket, refund a partial amount of one payment with manager approval, and confirm a refund entry for exactly that amount exists, the ticket reads "partially refunded," and the remaining balance is correct; then refund the rest and confirm it reads "refunded."

**Acceptance Scenarios**:

1. **Given** a past ticket paid in full, **When** a manager-approved refund returns the entire amount across all payments, **Then** the ticket status becomes refunded.
2. **Given** a past ticket paid in full, **When** a manager-approved refund returns only part of one payment, **Then** the ticket status becomes partially refunded and the remaining refundable balance reflects the amount already returned.
3. **Given** the refund composition sheet, **When** a staff member enters a refund amount greater than what was taken on that payment, **Then** the sheet prevents submission and explains the limit.
4. **Given** the refund composition sheet, **When** a staff member enters a refund amount for a payment that has already been partly refunded, **Then** the allowed maximum reflects only the still-unrefunded remainder of that payment.
5. **Given** a refund of a card or gift payment, **When** it is approved, **Then** the refund is issued through the card/gift processor; cash refunds are recorded for in-app handling.
6. **Given** a refund is opened from the End-of-Day day report, **When** it is approved, **Then** it behaves identically to a refund opened from the dashboard feed.
7. **Given** a refund submission, **When** no payment row has a refund amount entered (sum is zero), **Then** submission is blocked.

---

### User Story 3 - Require manager approval for oversized discounts (Priority: P3)

The salon can set a discount ceiling above which a discount needs manager sign-off. When that ceiling is configured and a staff member applies a discount line larger than it, the same manager-PIN keypad appears before the discount is accepted. A manager approves it, and the discount is applied. If no ceiling is configured, discounts apply with no approval, exactly as before.

**Why this priority**: This was deferred from the earlier discount work and is a smaller, self-contained reuse of the manager-PIN gate. It is valuable for loss prevention but not blocking for the void/refund money paths.

**Independent Test**: With a discount ceiling configured, apply a discount below it (applies with no prompt), then apply a discount above it (PIN gate appears; valid owner/manager PIN lets it through, invalid is rejected). With no ceiling configured, confirm no prompt ever appears.

**Acceptance Scenarios**:

1. **Given** a configured discount ceiling, **When** a staff member applies a discount line at or below the ceiling, **Then** it applies with no manager prompt.
2. **Given** a configured discount ceiling, **When** a staff member applies a discount line above the ceiling, **Then** the manager-PIN keypad appears and the discount is accepted only after a valid owner/manager PIN.
3. **Given** no discount ceiling is configured, **When** any discount is applied, **Then** no manager prompt appears.

---

### Edge Cases

- **No eligible approver exists**: If the salon has no active owner or manager with a PIN set, the manager-PIN gate cannot be satisfied; the action is blocked with a message explaining a manager PIN is required. (A salon is expected to always have at least one owner.)
- **Wrong / mistyped PIN, no lockout**: An incorrect PIN is rejected with a clear message and the keypad can be retried immediately. There is no attempt limit or lockout, matching the salon's existing v1 PIN policy.
- **Operator cancels the keypad**: Dismissing the PIN keypad abandons the action with nothing changed.
- **Card/gift processor refund fails**: The reversal must not leave the books inconsistent — a failed processor refund stops the action and surfaces the failure rather than marking the ticket reversed.
- **Concurrent reversal of the same ticket**: Two people attempting to void/refund the same ticket at once must not double-refund a payment; the second attempt sees the already-reversed state.
- **Refund amount exceeding remaining refundable balance**: Across repeated partial refunds, the total returned for any payment can never exceed what was originally taken on it.
- **Voided ticket re-ring**: There is no "undo void." Correcting a wrongly-voided ticket means ringing the sale again — explicitly out of scope here.
- **Refund with no original payment** (goodwill/credit): Not supported; every refund must trace to an original payment.

## Requirements *(mandatory)*

### Functional Requirements

**Manager-PIN approval gate (shared across all stories)**

- **FR-001**: The system MUST provide a reusable manager-PIN approval prompt that any staff member can trigger when initiating a privileged action, regardless of who is currently operating the counter.
- **FR-002**: The approval prompt MUST collect a PIN using the salon's existing PIN keypad interaction (consistent look, behavior, and keyboard support with the rest of the app).
- **FR-003**: The system MUST verify the entered PIN against the PINs of **active owner and manager** staff only, and MUST reject PINs belonging to any other role or to inactive/removed staff.
- **FR-004**: On a valid PIN, the system MUST identify which authorizing staff member approved the action and make that identity available to the action being performed.
- **FR-005**: On an invalid PIN, the system MUST reject the action with a clear message, change nothing, and allow an immediate retry. The system MUST NOT impose any attempt limit or lockout.
- **FR-006**: The system MUST record, for every privileged action, both the staff member who operated it and the manager/owner who authorized it.

**Same-day void (Story 1)**

- **FR-007**: The system MUST offer a "Void sale" action on a paid or partially-paid ticket that was paid on the current salon-local business day (calendar day, salon timezone) and is not already voided, and MUST NOT offer it on tickets paid on a prior day or already voided. Tickets no longer void-eligible are reversed through the refund path instead.
- **FR-008**: Choosing "Void sale" MUST require manager-PIN approval before any change is made.
- **FR-009**: On an approved void, the system MUST create a refund entry for **each** completed payment on the ticket, matched to that payment's method (cash, card, or gift).
- **FR-010**: For card and gift payments, the void MUST issue the refund through the payment processor exactly once per payment, with safeguards that prevent a duplicate refund if the action is retried.
- **FR-011**: For cash payments, the void MUST record a cash refund entry; reconciling the physical cash drawer for that refund is handled by the later cash-drawer work and is out of scope here.
- **FR-012**: On a successful void, the system MUST set the ticket's status to voided.
- **FR-013**: If any processor refund fails during a void, the system MUST NOT mark the ticket voided and MUST surface the failure to the operator, leaving the ticket in a recoverable state rather than partially reversed.
- **FR-014**: The system MUST record the void in the audit trail as a void event capturing the operator and the authorizing manager.

**Post-close refund, full or partial (Story 2)**

- **FR-015**: The system MUST offer a "Refund" action on past transactions from both the dashboard recent-transactions feed and the End-of-Day day report.
- **FR-016**: Choosing "Refund" MUST open a refund composition view that lists the ticket's payments and lets the operator select one or more and enter a refund amount for each.
- **FR-017**: The system MUST prevent any per-payment refund amount from exceeding that payment's remaining unrefunded amount, and MUST prevent submitting a refund whose total is zero.
- **FR-018**: Submitting a refund MUST require manager-PIN approval before any change is made.
- **FR-019**: On an approved refund, the system MUST create a refund entry for each selected payment, linked to the original payment it reverses.
- **FR-020**: For card and gift payments, the refund MUST be issued through the payment processor; for cash, a cash refund entry MUST be recorded for in-app handling.
- **FR-021**: After a refund, the system MUST set the ticket status to refunded if the entire ticket has now been returned, or partially refunded if only part has been returned.
- **FR-022**: The system MUST record each refund in the audit trail capturing the operator and the authorizing manager.

**Discount approval gate (Story 3)**

- **FR-023**: When a discount ceiling is configured and a staff member applies a discount line that exceeds it, the system MUST require manager-PIN approval before accepting the discount.
- **FR-024**: When no discount ceiling is configured, the system MUST apply discounts with no manager prompt.
- **FR-025**: A discount at or below the configured ceiling MUST apply with no manager prompt.

**Out of scope**

- **FR-026**: The system MUST NOT provide a way to re-open or un-void a voided ticket; correcting a void is done by ringing a new sale.
- **FR-027**: The system MUST NOT support refunds that are not tied to an original payment (e.g. goodwill credits).

### Key Entities *(include if feature involves data)*

- **Ticket**: A sale. Gains the reversal-related statuses *voided*, *refunded*, and *partially refunded* in addition to its existing open/paid states. A voided or fully-refunded ticket has had all of its money returned; a partially-refunded ticket has some still outstanding.
- **Payment**: A single money movement on a ticket, of a method (cash / card / gift) and a kind (an original payment, or a refund). A refund payment references the original payment it reverses and is tagged with the manager who authorized it. The refundable remainder of an original payment is what it took in minus what has already been refunded against it.
- **Staff member**: A person with a role (owner, manager, technician, front desk), an active/inactive state, and possibly a PIN. Only active owners and managers can authorize privileged actions.
- **Audit record**: A log of a significant action, capturing the action type (e.g. void issued, refund issued), the operating staff member, the authorizing manager, and which ticket/payment it concerned.
- **Discount ceiling setting**: A configurable money threshold above which a discount line requires manager approval; absent/unset means no approval is required.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of completed voids and refunds carry a recorded operator **and** a recorded authorizing manager/owner — none are missing either.
- **SC-002**: No privileged action (void, refund, or over-ceiling discount) is ever completed without a valid active owner/manager PIN — 0 unauthorized completions.
- **SC-003**: For any payment, the total amount refunded never exceeds the amount originally taken on it — 0 over-refunds across all tickets.
- **SC-004**: A card/gift processor refund is issued at most once per payment even when an action is retried — 0 duplicate processor refunds.
- **SC-005**: A staff member can complete a straightforward same-day full void in under 30 seconds (open ticket → void → manager PIN → confirmed).
- **SC-006**: After a partial refund, the ticket's displayed status (partially refunded vs refunded) and remaining refundable balance match the actual sum of refunds — verifiable on 100% of partially-refunded tickets.
- **SC-007**: When a processor refund fails mid-void, the ticket is never left marked voided — 0 half-reversed tickets.
- **SC-008**: With a discount ceiling configured, 100% of discount lines above the ceiling require manager approval and 0% of lines at/below it do.

## Assumptions

- **Void vs. refund boundary**: Void eligibility is keyed off the ticket's paid date being the current salon-local calendar day (resolved 2026-05-28). The window resets at salon-local midnight; a ticket paid on a prior day is reversed through the refund path. When the cash-drawer session that will formally bound "the day" arrives in later work, this rule may be revisited to tie to the close event instead of the clock.
- **Both paths can apply same-day**: A same-day paid ticket may be fully reversed via "Void sale" in checkout, while the refund path (dashboard / day report) remains the route for partial returns and for any past day.
- **Tips on reversal**: A full void returns the entire payment including any tip taken on it. The partial-refund composition operates on the amount taken per payment; separately itemizing tip vs. service within a partial refund is not part of this feature.
- **Reuse of existing PIN policy**: The no-lockout, retry-immediately PIN behavior matches the salon's existing v1 PIN policy; this feature does not change PIN storage or introduce lockout.
- **Eligible approver availability**: Every salon is assumed to have at least one active owner with a PIN, so a manager-PIN approval is always satisfiable in normal operation.
- **Payroll / commission effects**: Reversing a sale reduces the net the salon recognizes for that ticket; how voids/refunds flow into payroll and commissions is governed by the existing payroll aggregation and is not redefined here.
- **Cash-drawer reconciliation deferred**: Cash refund entries are recorded now; the physical-drawer adjustment for them is owned by the later cash-drawer session work.
- **Single salon, trusted operators**: Consistent with the app's single-salon scope, operators are trusted staff and the manager-PIN gate is a policy/audit control, not a defense against a hostile actor.

## Resolved Decisions

- **Void-eligibility window** (resolved 2026-05-28): A paid ticket is eligible for "Void sale" when it was paid on the **current salon-local calendar day**; otherwise it is reversed through the refund path. Chosen over tying the window to the End-of-Day count because the cash-drawer session does not exist yet — see FR-007 and Assumptions.
