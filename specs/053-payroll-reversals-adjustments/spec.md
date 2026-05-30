# Feature Specification: Payroll — Reversals & Adjustments

**Feature Branch**: `053-payroll-reversals-adjustments`

**Created**: 2026-05-30

**Status**: Draft

**Input**: User description: "Implement the Payroll — Reversals & Adjustments design (issue #154, follow-up to feature 052). Use the Dialog entry style for adjustments. Do not show the refund-preserved note."

## Overview

A technician's payout is computed today only from sales that ended in a completed (`paid`) state. The moment a sale is **voided** or **refunded** it drops out of that set, so the technician silently loses commission they had earned — and a *partial* refund zeroes the technician's entire commission on that sale. Owners also have no way to make an ad-hoc payout correction (dock a redo, add a bonus, apply goodwill).

This feature has two related parts:

1. **Reversals must not unfairly reduce technician pay.** A refund is treated as a business/customer-service cost, not the technician's loss; the technician keeps commission on the original (pre-refund) service amount. A void still pays $0. Revenue reporting stays net of refunds — only payroll counts the original amounts.
2. **Manual payout adjustments.** An owner or manager can add signed (+/−) adjustment lines to a specific technician's payout for a given pay period, each with a required reason. Adjustments fold into the technician's net payout and are only editable while the period is open.

The owner picks adjustments through a **centered dialog** entry style. The explanatory "refund-preserved" note/flag shown in the design mockup is intentionally **omitted** from this build (the underlying commission-preservation behavior still applies).

## Clarifications

### Session 2026-05-30

- Q: Who may create, edit, and delete payout adjustments? → A: Owner and manager (same gate as the existing record/undo payout actions; no PIN override).
- Q: Can an adjustment be added to a staff member with no computed work this period (e.g. front desk, $0 earnings)? → A: No — adjustments are available only on a technician who has computed earnings this period, matching the design mockup.
- Q: When an owner removes an adjustment on an open period, what happens to the record? → A: Hard delete — the row is removed and disappears from the list; the audit log preserves the create + delete history.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refunds keep technician commission; voids pay $0 (Priority: P1)

A technician completes a $60 service (50% commission). Later that sale is partially refunded by $20. When the owner opens payroll for the period, the technician's commission is still computed on the full original $60 (earning $30), not on the $40 net. If instead the sale had been **voided**, the technician earns $0 for it. Meanwhile the revenue Report shows the sale net of the refund ($40), so revenue and payroll no longer share one number.

**Why this priority**: This corrects an active money bug — technicians are currently underpaid (or zeroed) whenever a sale they worked is reversed. It is the core reason the feature exists and delivers value even with no other part shipped.

**Independent Test**: Create a paid ticket for a technician, issue a partial refund against it, and open payroll for that period — verify the technician's commissionable amount and commission reflect the original service amount. Repeat with a full refund and with a void, and confirm full-refund still preserves commission while void pays $0. Confirm the revenue Report for the same window nets the refund out.

**Acceptance Scenarios**:

1. **Given** a $60 sale by one technician at 50% commission that is then partially refunded $20, **When** the owner views that period's payroll, **Then** the technician's commissionable amount for that sale is $60 and their service commission on it is $30.
2. **Given** the same $60 sale fully refunded ($60 back), **When** the owner views payroll, **Then** the technician still keeps commission on the original $60.
3. **Given** the same $60 sale **voided**, **When** the owner views payroll, **Then** the technician earns $0 for that sale and it does not appear in their payout.
4. **Given** the same partially-refunded $60 sale, **When** the owner views the revenue Report for that window, **Then** the sale contributes $40 (net of the $20 refund) to revenue.
5. **Given** a multi-technician ticket where the whole ticket is refunded, **When** the owner views payroll, **Then** **every** technician on that ticket keeps commission on their original service amount.
6. **Given** any refund, **When** payroll and the Report are computed, **Then** card tips are unchanged by the refund.

---

### User Story 2 - Add manual payout adjustments while the period is open (Priority: P1)

An owner or manager opens a technician's payroll detail for the current (open) period and adds an adjustment: chooses **Add** or **Deduct**, enters a dollar amount, picks or types a required reason, and confirms. The adjustment appears in the technician's adjustment list and folds into their net payout (e.g. a $15 deduction with reason "redo on the house" drops the technician's period payout by $15). The owner can edit or remove an adjustment they added while the period stays open.

**Why this priority**: Gives owners the manual lever the issue calls for and is the second half of the feature's value. Independent of Part 1 — it works whether or not any reversal occurred.

**Independent Test**: Open a technician's detail for an open period, add a −$15 adjustment with a reason, and verify the technician's net payout drops by $15, the adjustment shows in the list with who/when, and the ledger's net-payout and adjustments columns update. Then edit and delete it and confirm the totals follow.

**Acceptance Scenarios**:

1. **Given** an open pay period and a technician with $X net payout, **When** the owner adds a deduction of $15 with reason "redo on the house", **Then** the technician's net payout becomes $X − $15 and the adjustment is listed with the creator's name and a timestamp.
2. **Given** the add dialog is open, **When** the amount is empty/zero **or** the reason is blank, **Then** the confirm action is disabled (an adjustment requires a positive amount and a non-empty reason).
3. **Given** the add dialog is open with a valid amount and direction, **When** the owner reviews the dialog, **Then** a live preview shows the technician's net payout before and after the adjustment.
4. **Given** an existing adjustment on an open period, **When** the owner edits its amount, direction, or reason, **Then** the technician's net payout and the listed line update, and the line records that it was edited.
5. **Given** an existing adjustment on an open period, **When** the owner deletes it, **Then** it is removed from the list and the technician's net payout no longer includes it.
6. **Given** one or more adjustments on a technician, **When** the payroll ledger is viewed, **Then** the technician's row shows a signed adjustments amount and a net-payout total that folds the adjustments in, and the period KPIs/totals reflect the adjustment sum.

---

### User Story 3 - Adjustments are locked once the period is closed or paid out (Priority: P2)

After a pay period is closed, or after a technician's payout has been recorded, no adjustments can be added, edited, or deleted for that scope — consistent with the no-clawback rule. The technician's detail and the adjustments surface show a clear "period closed" state, the add affordance and the edit/delete controls are gone, and previously recorded adjustments remain visible (read-only) and still folded into the frozen payout figure.

**Why this priority**: A guardrail that protects already-finalized money. Important for correctness but only meaningful once Part 2 exists, so it follows US2.

**Independent Test**: Add an adjustment on an open period, close the period (or record the technician's payout), and confirm the add/edit/delete controls disappear, the closed indicator shows, the existing adjustment is still visible, and any attempt to create/modify an adjustment for that scope is refused.

**Acceptance Scenarios**:

1. **Given** a closed pay period, **When** the owner opens a technician's detail, **Then** the adjustments surface shows a "period closed" indicator and offers no add/edit/delete controls.
2. **Given** a closed or paid-out scope, **When** a create/edit/delete of an adjustment is attempted (e.g. via a stale form), **Then** it is refused and the payout figures are unchanged.
3. **Given** a technician whose payout has been recorded, **When** their detail is viewed, **Then** existing adjustments remain visible and the recorded payout reflects the adjustments that existed at payout time.

---

### Edge Cases

- **Refund larger than original / over-refund**: payroll still credits commission on the original service amount only; it never goes negative or exceeds the original.
- **Discarded / open / unpaid tickets**: only sales that were actually completed (and then refunded/partially-refunded) preserve commission; voided and never-completed sales pay $0 and do not appear in payroll.
- **A technician with no computed work**: the adjustments affordance is **not** offered for a staff member with $0 computed earnings this period (consistent with the design mockup); adjustments target only technicians who have computed earnings.
- **Adjustment that drives net payout negative**: a deduction larger than computed earnings is allowed; the net payout is shown as a negative figure (the owner is choosing to dock the technician).
- **Concurrent edit**: if two operators act on the same adjustment, the surface reflects the latest committed state; an edit/delete against an already-removed adjustment is a no-op/refused.
- **Period boundary**: a sale's refund issued in a later period does not retroactively change a closed period's frozen payout.
- **Reason length**: an over-long reason note is bounded to a reasonable maximum.

## Requirements *(mandatory)*

### Functional Requirements

**Part 1 — Reversal-aware pay**

- **FR-001**: Payroll MUST compute each technician's service commission on the **original** service amounts of their sales, treating `refunded` and `partially_refunded` sales as if the refund had not happened.
- **FR-002**: Payroll MUST continue to pay **$0** for any `void` sale and exclude it from a technician's payout.
- **FR-003**: Refund preservation MUST apply to **every** technician on a multi-technician ticket, each on their own original service amount.
- **FR-004**: The revenue Report MUST remain **net of refunds** — refunded amounts reduce reported revenue — while payroll counts original amounts; the two figures MUST be decoupled so they no longer derive from a single shared `status = 'paid'` query.
- **FR-005**: Refunds MUST NOT change technician **tips** in either payroll or the Report.
- **FR-006**: The build MUST NOT display the "refund-preserved" explanatory note, banner, or row flag from the design mockup; the preservation behavior applies silently.

**Part 2 — Manual payout adjustments**

- **FR-007**: An **owner or manager** (the same roles permitted to record/undo payouts) MUST be able to add one or more adjustment lines to a specific technician's payout for a given pay period. The adjustments affordance is offered **only** for a technician with computed earnings in that period; a no-work / $0 staff row offers no adjustments. No PIN/privileged-action override is required.
- **FR-008**: Each adjustment MUST capture a target technician, a signed amount (an **addition** or a **deduction**), a required non-empty **reason** note, and a record of **who** created it and **when**.
- **FR-009**: The system MUST reject an adjustment with a non-positive amount or an empty reason (the confirm control is disabled until both are valid).
- **FR-010**: A technician's **net payout** for the period MUST equal their computed cash payment plus the sum of their adjustments for that period.
- **FR-011**: Owners/managers MUST be able to **edit** and **delete** an adjustment while the period is open; an edit MUST update the amount, direction, and/or reason and record that the line was modified. A **delete** is a hard delete — the adjustment row is removed and no longer appears in the list (its create + delete history is preserved only in the audit trail per FR-016).
- **FR-012**: Adjustments MUST be allowed **only while the pay period is open**. Once the period is **closed** or the technician's payout has been **recorded/paid out**, no adjustment for that scope may be added, edited, or deleted; such attempts MUST be refused server-side, not only hidden in the UI.
- **FR-013**: The adjustment entry experience MUST use a **centered dialog** containing: an Add/Deduct direction toggle, a dollar amount field, reason preset chips plus a free-text reason input, a live before/after net-payout preview, and Cancel / confirm actions.
- **FR-014**: Adjustments MUST be visible in the payroll surface alongside computed earnings: the technician's **detail** shows each adjustment line (reason, signed amount, creator, timestamp), a net-adjustment subtotal, and a net-payout total that folds them in; the **ledger** shows a signed adjustments column and a net-payout column, and the period totals/KPIs reflect the adjustment sum.
- **FR-015**: A closed or paid-out scope MUST present a clear read-only "period closed" state with existing adjustments still visible and no add/edit/delete affordances.
- **FR-016**: Every adjustment create, edit, and delete MUST be recorded in the audit trail with the actor and the adjustment details.

### Key Entities *(include if feature involves data)*

- **Payout adjustment**: a signed manual correction to one technician's payout for one pay period. Attributes: target technician, pay period, signed amount (cents; positive = addition, negative = deduction), reason note, creator (staff/user), created-at, and last-edited marker. Belongs to exactly one (pay period, technician) scope; mutable only while that period is open.
- **Pay period** (existing): the semi-monthly window with an open/closed status and a pay date. Gains the rule that its open/closed status gates adjustment mutability.
- **Technician payout** (existing snapshot): the per-technician frozen earnings recorded when a payout is paid. The net payout it represents now includes the adjustments that existed at payout time.
- **Sale / ticket (existing)**: gains the distinction, for payroll, between net (post-refund) and original (pre-refund) service amounts; `void` sales contribute nothing, `refunded`/`partially_refunded` sales contribute their original amount to payroll but net amount to revenue.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a sale that is partially or fully refunded, the technician's computed commission equals 100% of what it would have been with no refund (0% pay loss from refunds).
- **SC-002**: For a voided sale, the technician's commission contribution is exactly $0.
- **SC-003**: For the same refunded sale, the revenue Report and the payroll figure differ by exactly the refunded amount (revenue is lower by the refund; payroll is not).
- **SC-004**: An owner can add a payout adjustment and see the technician's net payout change by the adjustment amount within the same view, with no manual recalculation.
- **SC-005**: 100% of attempts to add, edit, or delete an adjustment on a closed or paid-out period are refused and leave payout figures unchanged.
- **SC-006**: Every adjustment create/edit/delete produces exactly one audit entry attributing the action to the operator.
- **SC-007**: A technician's net payout shown in the ledger equals their net payout shown in their detail equals computed cash payment plus the sum of their adjustments, for every technician in the period.

## Assumptions

- **Entry style**: The adjustment add/edit experience uses the centered **Dialog** variant from the design (not the inline or right-side-sheet variants), per the user's instruction.
- **Refund note omitted**: The "refund-preserved" note/banner/flag and the reversal explainer banner from the mockup are intentionally not built; only the silent commission-preservation behavior ships, per the user's instruction.
- **Reason presets**: The dialog offers the design's reason preset chips (e.g. Bonus, Redo on the house, Supply dock, Goodwill, Correction, Late / no-show) plus a free-text field; the presets are a convenience, the stored value is the chosen/typed text.
- **Permissions**: Adjustment create/edit/delete is restricted to **owner and manager** roles, consistent with existing payroll mutations (record/undo payout); no PIN/privileged-action override is required. (Resolved in Clarifications.)
- **No automatic refund→pay coupling**: There is no per-refund "should this affect pay?" prompt; owners use manual adjustments for any discretionary docking. (Explicitly out of scope per the issue.)
- **No clawback**: Closed/paid-out periods are immutable; adjustments cannot be applied retroactively. (Explicitly out of scope.)
- **No per-individual refund attribution on multi-tech tickets**: refund preservation operates on each technician's original service line; the feature does not attempt to attribute a single refund to one technician on a shared ticket. (Explicitly out of scope.)
- **Reversal data exists**: The `void`, `refunded`, and `partially_refunded` statuses and refund payment rows from feature 052 (migrations 0025–0027) are present and are the source of truth for which sales were reversed.

## Out of Scope

- Any automatic coupling of a refund to a payout change, or a per-refund "should this affect pay?" choice (considered and rejected — owners use manual adjustments instead).
- Clawback or adjustment of payouts on already-closed or paid-out periods.
- Per-individual-technician attribution of a single refund on a multi-technician ticket.
- The refund-preserved explanatory note/banner/flag UI from the mockup.
