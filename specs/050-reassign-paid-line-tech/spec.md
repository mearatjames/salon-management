# Feature Specification: Correct staff attribution on a paid ticket (within open pay period)

**Feature Branch**: `050-reassign-paid-line-tech`

**Created**: 2026-05-23

**Status**: Draft

**Input**: GitHub issue [#147](https://github.com/mearatjames/salon-management/issues/147) — "Owner/manager: correct staff attribution on a paid ticket (within open pay period)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Owner or manager corrects the assigned tech on a paid service line (Priority: P1)

Whoever runs checkout sometimes picks the wrong technician for a service line. Once the customer has paid, the salon currently has no way to fix the mistake — and the wrong attribution flows straight into the daily Report, the dashboard tech counts, and the technician's payout for the period. With this feature, an owner or manager can open a paid ticket's receipt drawer, change the assigned tech on a specific service line via a small "change" control next to the staff chip, pick the correct active technician from a picker, and save. The correction takes effect immediately for every downstream view that derives from the assigned tech, including the report, dashboard, transactions list, and the in-flight payroll calculation for the current pay period.

**Why this priority**: This is the entire reason for the feature. Without it the salon owner cannot ship an accurate payroll for any pay period that contains a mis-assigned ticket; the only workaround today is to refund and re-ring the ticket, which is destructive, fast and only available to the operator at the moment of payment. Every other story in this spec is a guardrail around this one.

**Independent Test**: Sign in as an owner. Open a paid ticket from today's transactions (one whose pay period has not yet been finalized) and pick a service line attributed to Tech A. Use the new control next to the staff chip on that line to switch it to Tech B. Save. Reopen the same ticket — the chip shows Tech B. Open the dashboard's per-tech totals — the service is now counted under Tech B, not Tech A. Open the Report for the current period — the line appears under Tech B. Repeat the entire flow as a manager and observe identical behavior.

**Acceptance Scenarios**:

1. **Given** an owner viewing a paid ticket from today with a service line assigned to Tech A, **When** the owner taps the "change" control next to the staff chip, picks Tech B from the active-staff picker, and saves, **Then** the chip on that line updates to Tech B, the drawer stays open, and no other field on the ticket changes (price, tip, discount, total, cashier, client all stay the same).
2. **Given** a manager viewing the same ticket as Acceptance #1, **When** they perform the same reassignment, **Then** the result is identical to the owner's.
3. **Given** a paid ticket whose service line has **no** assigned tech (assignment was skipped at checkout), **When** an owner or manager uses the same control, **Then** they can assign a tech to that line for the first time using the same flow.
4. **Given** a successful reassignment, **When** anyone reopens the dashboard, the transactions list, the receipt drawer, or the Report for the current period, **Then** the new tech attribution is reflected on the next render — without the operator having to take any extra action.
5. **Given** a successful reassignment, **When** the audit log is inspected, **Then** exactly one audit entry exists for the action, distinct from the audit entry that recorded the original checkout-time assignment, and the entry captures the ticket, the line, the previous tech, the new tech, the ticket's closed-at timestamp, the pay period start, and the acting user.

---

### User Story 2 — Non-privileged staff cannot see or trigger the correction (Priority: P2)

Technicians and front-desk staff regularly open paid tickets in the receipt drawer to check what was sold, to reprint a receipt, or to look up a client. They must not be able to alter staff attribution — even accidentally — because every such change moves money between people's payouts. The receipt drawer for these roles must look and behave exactly as it does today.

**Why this priority**: Without this guardrail, the new edit affordance becomes a payroll-shifting tool in the hands of any logged-in staff member. The behavior is small (do nothing in the UI, reject at the server) but the absence of it is unacceptable.

**Independent Test**: Sign in as a technician. Open the same paid ticket used in User Story 1. The "change" control next to the staff chip is not present on any service line. Sign in as a front-desk user. Same: no control, no affordance, no entry point. Attempt to invoke the reassignment action directly (e.g., via a crafted request) — the server rejects it with a typed permission error and writes nothing to the ticket or the audit log.

**Acceptance Scenarios**:

1. **Given** a technician viewing any paid ticket, **When** the receipt drawer renders, **Then** no "change" control is shown on any service line and the staff chip is plain.
2. **Given** a front-desk user viewing any paid ticket, **When** the receipt drawer renders, **Then** the surface is identical to today's read-only experience.
3. **Given** a technician or front-desk user that bypasses the UI and sends the reassignment request directly to the server, **When** the request is processed, **Then** the server returns a typed permission error, the ticket is unchanged, and no audit log row is written.

---

### User Story 3 — Once the pay period is finalized, the correction surface locks (Priority: P3)

When the salon owner runs payroll for a pay period, the payouts for that period become a financial record everyone has been paid against. Allowing staff reassignment on tickets inside that period would create a silent gap between "what the report now says" and "what was actually paid out" — there is no reconciliation path for that gap today. Once a pay period is finalized, the correction surface must visibly close, and the staff chip must communicate why the edit is no longer available.

**Why this priority**: Without this, an owner can quietly change paid-ticket attribution after payroll is run, producing a report that disagrees with the payouts already issued. This is the safety boundary that makes the feature shippable; without it the feature is irresponsible to enable.

**Independent Test**: Pick a paid ticket inside a pay period for which payouts have been finalized. Sign in as an owner. Open the receipt drawer. No "change" control is shown on any service line. Each staff chip shows a small lock affordance; hovering or tapping the lock reveals the explanation *"Payouts for this pay period have been finalized."* Repeat as a manager — same behavior. Attempt to invoke the reassignment action directly against a finalized-period ticket — the server rejects it and writes nothing.

**Acceptance Scenarios**:

1. **Given** an owner or manager viewing a paid ticket whose pay period has been finalized, **When** the receipt drawer renders, **Then** the "change" control is not shown on any service line and each staff chip displays a lock indicator with a tooltip explaining the period is finalized.
2. **Given** the same ticket as #1, **When** the reassignment action is sent directly to the server, **Then** the server returns a typed "period frozen" error, the ticket is unchanged, and no audit log row is written.
3. **Given** a ticket whose pay period is **still open**, **When** an owner or manager views it, **Then** no lock indicator is shown and the "change" control is available as described in User Story 1.

---

### Edge Cases

- **New tech is inactive at save time.** The picker only shows active staff, so this should not be reachable via the UI. If the request reaches the server (race, direct call, staff deactivated between picker open and save), the server rejects with a typed "staff inactive" error and writes nothing.
- **Ticket is not paid.** This surface only exists for paid tickets; the reassignment action MUST be rejected with a typed "ticket not paid" error if invoked against any other ticket status. Open-cart attribution continues to use today's existing flow.
- **Same tech selected as the current assignee.** Saving the same tech is a no-op: no audit row is written, no downstream view changes, and the operator sees the drawer return to its prior state without an error.
- **Ticket or line does not exist (deleted/garbled id).** The server returns a typed "not found" error and writes nothing.
- **Concurrent reassignment of the same line.** If two privileged users reassign the same line at the same time, the last successful save wins; each successful save writes its own audit row so the history is reconstructible. No locking dialog is shown to the operator.
- **Tip and commission attribution.** The salon's payroll already derives each tech's earnings (commission and tip share) from the assigned tech on the line. Reassigning the line automatically moves both — no separate edit is needed.
- **Lines that were never assigned at checkout.** Lines with no assigned tech are eligible for this surface and can be assigned for the first time through it; the audit row records the previous tech as "none."
- **Reassigning during the same pay-period boundary minute.** The pay period is computed from the ticket's closed-at timestamp, not from "now," so a reassignment performed right after a period closes still uses the ticket's own period — which by then is finalized, so the lock will already apply.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let an owner or a manager change the assigned technician on any individual service line of a paid ticket, from inside the existing receipt drawer, while the ticket's pay period is still open.
- **FR-002**: The system MUST treat a ticket's pay period as "still open" if and only if no payout has been finalized for the pay period that contains the ticket's closed-at timestamp. As soon as a payout exists for that period, the period is "finalized" and reassignment is forbidden.
- **FR-003**: The system MUST NOT show the "change" affordance, the picker, or any other entry point to the reassignment flow to technician or front-desk users — under any circumstances.
- **FR-004**: The system MUST display, on every staff chip of a paid ticket inside a finalized pay period, a lock indicator whose tooltip explains *"Payouts for this pay period have been finalized."* — and the "change" affordance MUST be absent in this state for every role, including owner and manager.
- **FR-005**: The staff picker used by the reassignment flow MUST list **only active staff**. Inactive staff MUST NOT be selectable, and the picker MUST present the same interaction model used by the open-cart staff picker so the experience feels familiar.
- **FR-006**: The system MUST permit reassignment on service lines that previously had no assigned technician, treating the reassignment as a first-time assignment for audit and reporting purposes.
- **FR-007**: The system MUST NOT permit, from this surface, any change to: the service itself, the line quantity, the line price, the tip total, any discount, the customer/client field, or the cashier (the person who took payment). Money fields and identity fields on the ticket are out of scope of this feature.
- **FR-008**: Tip and commission attribution for the affected line MUST follow the new assigned technician automatically — the salon owner MUST NOT need to take any extra action to move tips or commission earnings from the previous tech to the new tech.
- **FR-009**: After a successful reassignment, the receipt drawer, the transactions list, the dashboard's per-tech counts, and the current-period Report MUST all reflect the new attribution on their next render — without further operator action.
- **FR-010**: Every successful reassignment MUST write **exactly one** audit-log entry whose action is distinct from the audit action used for checkout-time assignment, so that reports and audit history can separate "checkout-time assignment" from "post-checkout correction."
- **FR-011**: The audit entry written by FR-010 MUST capture: the ticket id, the line id, the previous assigned-staff id (which may be empty for lines that were not previously assigned), the new assigned-staff id, the ticket's closed-at timestamp, the pay period start, and the acting user.
- **FR-012**: The system MUST reject the reassignment request — and write no data of any kind, including no audit row — when **any** of the following is true: (a) the caller is not an owner or a manager; (b) the ticket is not in the paid state; (c) the pay period containing the ticket's closed-at has been finalized; (d) the new technician is not active; (e) the ticket or the line does not exist. In each case the server MUST return a typed error distinguishable by the caller.
- **FR-013**: Saving the **same** technician that is already assigned to the line MUST be treated as a no-op: no audit row, no downstream view change, and no error.
- **FR-014**: The permission gate from FR-003 MUST be enforced **both** in the rendered UI (the control is not present for non-privileged roles) **and** on the server (the reassignment request is rejected if it arrives from a non-privileged caller). The server-side gate is the authority; the UI gate is the affordance.

### Key Entities

- **Paid ticket**: A ticket that has been charged and whose status is "paid." Owns one or more service lines, a closed-at timestamp, a cashier identity, totals, and discounts. This feature mutates only the assigned-technician field on its service lines; nothing else.
- **Service line on a paid ticket**: A single performed service inside a paid ticket. Carries an assigned-technician reference (which may be empty) and a price. Only the assigned-technician reference is mutated by this feature.
- **Pay period**: A bounded window of dates over which the salon computes payouts. Every paid ticket belongs to exactly one pay period, determined from its closed-at timestamp using the salon's existing payroll period boundaries. A pay period is either "open" (no finalized payout exists for it) or "finalized" (a payout has been issued for it).
- **Payout**: The financial record of paying every technician for a pay period. The mere existence of a payout for a given pay period is the signal that the period is finalized for the purpose of this feature.
- **Active staff member**: A staff member who can currently perform services and receive attribution. This is the universe the picker draws from.
- **Audit-log entry**: One row recording the reassignment, distinct in action name from the checkout-time assignment audit row, carrying the payload described in FR-011.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner or a manager can correct a single mis-attributed service line on a paid ticket in **under 30 seconds**, measured from opening the receipt drawer to seeing the updated chip — without leaving the drawer.
- **SC-002**: **100%** of successful reassignments produce **exactly one** audit-log entry that is distinguishable in action name from the checkout-time assignment action.
- **SC-003**: After a reassignment, every downstream view that depends on the assigned tech (receipt drawer, transactions list, dashboard per-tech counts, current-period Report, current-period payroll attribution) reflects the new tech on the next render. **Zero** of these views require a separate "rebuild" or "recompute" action.
- **SC-004**: **Zero** reassignments succeed against a paid ticket whose pay period has been finalized — verifiable from both UI inspection (the control is absent and the lock indicator is present) and server-side audit history (no reassignment audit rows exist for any finalized-period ticket after the feature ships).
- **SC-005**: **Zero** reassignment-action invocations succeed from a technician or front-desk identity — verifiable from server-side rejection logs and the absence of audit rows authored by those roles.
- **SC-006**: A reassignment leaves **every monetary field** on the ticket unchanged: subtotal, tips, discounts, total charged, and taxes (today's $0). Verifiable by snapshotting the ticket totals before and after the reassignment.
- **SC-007**: For technicians and front-desk users, the receipt drawer renders **byte-identical** to the pre-feature drawer (no new affordance, no new chrome) on every paid ticket — including finalized-period tickets (where they continue to see the same read-only drawer, with no lock-indicator chrome leaking to them since they could never have edited in the first place).

## Assumptions

- **Pay-period boundary helper exists.** The salon's payroll module already computes the pay period containing a given timestamp; this feature reuses that helper rather than reinventing the boundary math. The open question in the issue ("confirm the exact helper") is an implementation detail belonging to the plan.
- **"Finalized" = a payout row exists.** The salon's data model treats the presence of a payout row for a given pay period as the canonical signal that the period has been finalized. There is no separate "frozen" flag.
- **Staff picker is reusable.** The active-staff picker used in the open-cart flow is reused verbatim here so the operator experiences a single picker model across the app.
- **Receipt drawer is the single edit surface.** No separate edit screen, no admin tool, no list view bulk action — only the inline control inside the existing receipt drawer.
- **Owner and manager are the only privileged roles.** No other role gains edit access through this feature, even by configuration.
- **Cashier is never edited.** The person who took payment is recorded separately from the person who performed the service. This feature mutates the latter only.
- **Downstream views are query-driven.** The dashboard, transactions list, Report, and payroll attribution all derive their per-tech totals from live queries that already read the assigned-tech field; this feature requires no changes to those views beyond cache/route revalidation triggered by the save.
- **Design-system rules apply to any new chrome.** Any new control or lock indicator follows the Lacquer design system — tokens for color/spacing/radii, shadcn/ui primitives, Lucide icons (1.5px stroke, sized 16/20/24), Inter type, no emoji in chrome. The control surface introduced for this feature is small (one inline control + a small lock affordance) and MUST NOT deviate from those rules.
- **No void/refund flow is being introduced.** Reverting an entire ticket remains out of scope; only per-line attribution is mutable through this feature.
- **No required reason note.** The audit row's before/after captures sufficient context; the operator is not required to type a justification to save.
