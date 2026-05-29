# Feature Specification: Privileged-Action Overrides — Voids & Refunds

**Feature Branch**: `052-privileged-action-overrides`

**Created**: 2026-05-28

**Status**: Draft

**Input**: User description: "Add the privileged-action paths: same-day voids and any-time refunds. Originally specified with a manager-PIN inline override; revised so the actions are gated by the acting staff's role (owner/manager) instead of a PIN. Same-day void on a paid/partially-paid ticket in checkout. Post-close full/partial refund from the dashboard recent-transactions feed and the End-of-Day day report via a refund composition sheet. Out of scope: re-opening a voided ticket, goodwill refunds without an original payment, and the discount approval gate (dropped)."

A salon manager or owner needs to be able to correct money mistakes — a sale rung wrong, a customer who changes their mind, a service refunded after the fact. The salon's policy is that **reversing a sale is a privileged action: only an owner or manager can do it.** This feature adds the two places that policy shows up: voiding a same-day sale and refunding a past sale. Authorization is by the **role of the staff member currently operating the app** — if they are an owner or manager, the reversal action is available; otherwise it is not shown and is refused if attempted.

## Clarifications

### Session 2026-05-28

- Q: Should reversals be gated by an inline manager-PIN override, or by the role of the staff currently operating the app? → A: By role — only an active owner or manager (the acting staff) sees and can perform a void/refund. No manager-PIN dialog and no `verifyManagerPin` step.
- Q: With role-based gating, how is a completed void/refund attributed? → A: Single acting staff — record only the acting owner/manager who performed it; there is no separate "authorizing manager" actor or field.
- Q: Is the owner/manager restriction UI-only, or also enforced server-side? → A: Both — the action is hidden for non-managers AND refused server-side if a non-owner/manager attempts it. The role check is the authorization boundary, not just a display rule.
- Q: Is the oversized-discount manager approval gate part of this feature? → A: No — it is dropped from this feature entirely.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Void a same-day sale (Priority: P1)

A sale was rung up and paid for today, then found to be wrong (wrong customer, duplicate sale, customer walked out). While the day is still open, an owner or manager opens the ticket in checkout and chooses "Void sale." The sale is fully reversed — every payment that was taken is refunded back by its original method — and the ticket is marked as voided. The action is recorded showing who performed it.

**Why this priority**: This is the core privileged-action path and the most common real-world correction. Shipping just this delivers a working, auditable same-day reversal.

**Independent Test**: While operating as an owner or manager, on a salon with a paid same-day ticket, choose "Void sale" and confirm the ticket shows as voided, refund entries exist for each original payment, and the audit trail names the acting owner/manager. Separately, confirm a technician/front-desk operator does not see the action and cannot perform it. Fully testable without Story 2.

**Acceptance Scenarios**:

1. **Given** a same-day ticket fully paid by cash and an owner/manager is operating, **When** they choose "Void sale," **Then** the ticket status becomes voided, a refund entry is created mirroring the cash payment, and the action is recorded with the acting owner/manager.
2. **Given** a same-day ticket paid by card, **When** the void is performed, **Then** the card payment is refunded through the card processor and the ticket is voided; if the processor refund fails, the void does not silently complete (the operator is told it failed and the ticket is not left half-reversed).
3. **Given** a same-day ticket paid by a split of cash and card (or gift), **When** the void is performed, **Then** a refund entry is created for **each** completed payment by its matching method.
4. **Given** a technician or front-desk staff member is the one operating the app, **When** they view a same-day paid ticket, **Then** "Void sale" is not offered, and a direct attempt to void is refused.
5. **Given** a partially-paid ticket (some payment collected, balance outstanding) and an owner/manager operating, **When** "Void sale" is performed, **Then** the collected payments are refunded and the ticket is voided.
6. **Given** a ticket that is already voided, **When** an owner/manager views it, **Then** "Void sale" is not offered again (no double-void), and re-opening a voided ticket is not available.

---

### User Story 2 - Refund a past sale, full or partial (Priority: P2)

After a sale's day has closed — or any time later — a customer returns wanting money back, in full or for just part of what they bought. While operating as an owner or manager, from the dashboard's recent-transactions feed or from the End-of-Day day report, they choose "Refund" on the transaction. A refund composition sheet opens listing the payments that were taken. They pick which payment(s) to refund and enter an amount for each (never more than what was originally taken on that payment), then submit. The chosen amounts are refunded by their original methods, and the ticket is marked fully refunded or partially refunded depending on how much of it has now been returned.

**Why this priority**: Refunds are essential but lower-frequency than same-day corrections. Partial-refund composition is meaningfully more complex than an all-or-nothing void, so it follows once the void path is proven.

**Independent Test**: While operating as an owner/manager, from the dashboard recent-transactions feed open "Refund" on a past paid ticket, refund a partial amount of one payment, and confirm a refund entry for exactly that amount exists, the ticket reads "partially refunded," and the remaining balance is correct; then refund the rest and confirm it reads "refunded." Confirm the action is absent for a technician/front-desk operator.

**Acceptance Scenarios**:

1. **Given** a past ticket paid in full and an owner/manager operating, **When** a refund returns the entire amount across all payments, **Then** the ticket status becomes refunded.
2. **Given** a past ticket paid in full, **When** a refund returns only part of one payment, **Then** the ticket status becomes partially refunded and the remaining refundable balance reflects the amount already returned.
3. **Given** the refund composition sheet, **When** a refund amount greater than what was taken on that payment is entered, **Then** the sheet prevents submission and explains the limit.
4. **Given** the refund composition sheet, **When** a refund amount is entered for a payment that has already been partly refunded, **Then** the allowed maximum reflects only the still-unrefunded remainder of that payment.
5. **Given** a refund of a card or gift payment, **When** it is performed, **Then** the refund is issued through the card/gift processor; cash refunds are recorded for in-app handling.
6. **Given** a refund is opened from the End-of-Day day report, **When** it is performed, **Then** it behaves identically to a refund opened from the dashboard feed.
7. **Given** a refund submission, **When** no payment row has a refund amount entered (sum is zero), **Then** submission is blocked.
8. **Given** a technician or front-desk staff member is operating, **When** they view a past transaction, **Then** "Refund" is not offered, and a direct attempt to refund is refused.

---

### Edge Cases

- **Non-privileged operator**: When the acting staff member is not an active owner or manager, void and refund actions are not shown and are refused if attempted directly (e.g. a stale or hand-crafted request) — the role check is enforced on the server, not only in the UI.
- **No owner/manager on the floor**: If whoever is operating is not an owner or manager, the reversal simply isn't available to them; someone with the role must operate the app to perform it. (A salon is expected to always have at least one owner.)
- **Operator abandons the action**: Closing the void confirmation or the refund sheet without completing it changes nothing.
- **Card/gift processor refund fails**: The reversal must not leave the books inconsistent — a failed processor refund stops the action and surfaces the failure rather than marking the ticket reversed.
- **Concurrent reversal of the same ticket**: Two people attempting to void/refund the same ticket at once must not double-refund a payment; the second attempt sees the already-reversed state.
- **Refund amount exceeding remaining refundable balance**: Across repeated partial refunds, the total returned for any payment can never exceed what was originally taken on it.
- **Voided ticket re-ring**: There is no "undo void." Correcting a wrongly-voided ticket means ringing the sale again — explicitly out of scope here.
- **Refund with no original payment** (goodwill/credit): Not supported; every refund must trace to an original payment.

## Requirements *(mandatory)*

### Functional Requirements

**Role-based authorization (shared by both stories)**

- **FR-001**: The system MUST offer void and refund actions only when the staff member currently operating the app is an **active owner or manager**, and MUST NOT display them to any other role or to inactive/removed staff.
- **FR-002**: The system MUST enforce the owner/manager restriction server-side: a void or refund attempted by anyone who is not an active owner or manager MUST be refused with no change made, even if the action was not visible in the UI.
- **FR-003**: The system MUST record, for every completed void or refund, the single acting owner/manager who performed it. There is no separate "authorizing" actor.

**Same-day void (Story 1)**

- **FR-004**: The system MUST offer a "Void sale" action to an owner/manager on a paid or partially-paid ticket that was paid on the current salon-local business day (calendar day, salon timezone) and is not already voided, and MUST NOT offer it on tickets paid on a prior day or already voided. Tickets no longer void-eligible are reversed through the refund path instead.
- **FR-005**: On a void, the system MUST create a refund entry for **each** completed payment on the ticket, matched to that payment's method (cash, card, or gift).
- **FR-006**: For card and gift payments, the void MUST issue the refund through the payment processor exactly once per payment, with safeguards that prevent a duplicate refund if the action is retried.
- **FR-007**: For cash payments, the void MUST record a cash refund entry; reconciling the physical cash drawer for that refund is handled by the later cash-drawer work and is out of scope here.
- **FR-008**: On a successful void, the system MUST set the ticket's status to voided.
- **FR-009**: If any processor refund fails during a void, the system MUST NOT mark the ticket voided and MUST surface the failure to the operator, leaving the ticket in a recoverable state rather than partially reversed.
- **FR-010**: The system MUST record the void in the audit trail as a void event capturing the acting owner/manager and the ticket concerned.
- **FR-011**: The system MUST NOT offer "Void sale" on an already-voided ticket, and MUST NOT provide any way to re-open or un-void a voided ticket.

**Post-close refund, full or partial (Story 2)**

- **FR-012**: The system MUST offer a "Refund" action to an owner/manager on past transactions from both the dashboard recent-transactions feed and the End-of-Day day report.
- **FR-013**: Choosing "Refund" MUST open a refund composition view that lists the ticket's payments and lets the operator select one or more and enter a refund amount for each.
- **FR-014**: The system MUST prevent any per-payment refund amount from exceeding that payment's remaining unrefunded amount, and MUST prevent submitting a refund whose total is zero.
- **FR-015**: On a refund, the system MUST create a refund entry for each selected payment, linked to the original payment it reverses.
- **FR-016**: For card and gift payments, the refund MUST be issued through the payment processor; for cash, a cash refund entry MUST be recorded for in-app handling.
- **FR-017**: After a refund, the system MUST set the ticket status to refunded if the entire ticket has now been returned, or partially refunded if only part has been returned.
- **FR-018**: The system MUST record each refund in the audit trail capturing the acting owner/manager and the ticket/payment concerned.

**Out of scope**

- **FR-019**: The system MUST NOT provide a way to re-open or un-void a voided ticket; correcting a void is done by ringing a new sale.
- **FR-020**: The system MUST NOT support refunds that are not tied to an original payment (e.g. goodwill credits).

### Key Entities *(include if feature involves data)*

- **Ticket**: A sale. Gains the reversal-related statuses *voided*, *refunded*, and *partially refunded* in addition to its existing open/paid states. A voided or fully-refunded ticket has had all of its money returned; a partially-refunded ticket has some still outstanding.
- **Payment**: A single money movement on a ticket, of a method (cash / card / gift) and a kind (an original payment, or a refund). A refund payment references the original payment it reverses. The refundable remainder of an original payment is what it took in minus what has already been refunded against it.
- **Staff member**: A person with a role (owner, manager, technician, front desk) and an active/inactive state. Only an active owner or manager — when they are the one operating the app — can perform a void or refund.
- **Audit record**: A log of a significant action, capturing the action type (e.g. void issued, refund issued), the acting owner/manager who performed it, and which ticket/payment it concerned.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of completed voids and refunds carry a recorded acting owner/manager — none are missing the performer.
- **SC-002**: No void or refund is ever completed by a staff member who is not an active owner or manager — 0 unauthorized completions, including direct/server-side attempts that bypass the UI.
- **SC-003**: For any payment, the total amount refunded never exceeds the amount originally taken on it — 0 over-refunds across all tickets.
- **SC-004**: A card/gift processor refund is issued at most once per payment even when an action is retried — 0 duplicate processor refunds.
- **SC-005**: An owner/manager can complete a straightforward same-day full void in under 30 seconds (open ticket → void → confirmed).
- **SC-006**: After a partial refund, the ticket's displayed status (partially refunded vs refunded) and remaining refundable balance match the actual sum of refunds — verifiable on 100% of partially-refunded tickets.
- **SC-007**: When a processor refund fails mid-void, the ticket is never left marked voided — 0 half-reversed tickets.

## Assumptions

- **Authorization is by acting-staff role**: The reversal actions are gated by the role of the staff member currently operating the app (the app's existing acting/active-staff concept). There is no inline PIN re-authorization and no second authorizer. A salon is assumed to always have at least one active owner, so a reversal is always performable by someone with the role.
- **Void vs. refund boundary**: Void eligibility is keyed off the ticket's paid date being the current salon-local calendar day (resolved 2026-05-28). The window resets at salon-local midnight; a ticket paid on a prior day is reversed through the refund path. When the cash-drawer session that will formally bound "the day" arrives in later work, this rule may be revisited to tie to the close event instead of the clock.
- **Both paths can apply same-day**: A same-day paid ticket may be fully reversed via "Void sale" in checkout, while the refund path (dashboard / day report) remains the route for partial returns and for any past day.
- **Tips on reversal**: A full void returns the entire payment including any tip taken on it. The partial-refund composition operates on the amount taken per payment; separately itemizing tip vs. service within a partial refund is not part of this feature.
- **Payroll / commission effects**: Reversing a sale reduces the net the salon recognizes for that ticket; how voids/refunds flow into payroll and commissions is governed by the existing payroll aggregation and is not redefined here.
- **Cash-drawer reconciliation deferred**: Cash refund entries are recorded now; the physical-drawer adjustment for them is owned by the later cash-drawer session work.
- **Single salon, trusted operators**: Consistent with the app's single-salon scope, operators are trusted staff and the owner/manager role gate is a policy/audit control, not a defense against a hostile actor.

## Resolved Decisions

- **Authorization model** (resolved 2026-05-28): Reversals are gated by the **acting staff's role** (active owner or manager), enforced both in the UI (action hidden) and server-side (action refused). The originally-specified manager-PIN inline override (`ManagerPinDialog` + `verifyManagerPin`) is **not** part of this feature. Each reversal is attributed to the single acting owner/manager; there is no separate authorizing actor or `authorized_by` field.
- **Discount approval gate dropped** (resolved 2026-05-28): The oversized-discount manager-approval gate (previously deferred from the discount work) is **removed** from this feature's scope.
- **Void-eligibility window** (resolved 2026-05-28): A paid ticket is eligible for "Void sale" when it was paid on the **current salon-local calendar day**; otherwise it is reversed through the refund path. Chosen over tying the window to the End-of-Day count because the cash-drawer session does not exist yet — see FR-004 and Assumptions.
