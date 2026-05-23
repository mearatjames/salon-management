# Feature Specification: Per-service discount in checkout

**Feature Branch**: `049-per-service-discount`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "I want to spec out the feature or the improvement to the existing feature, specifically on the discount in the checkout page. because currently, the discount applies to pretty much everything in that transaction, which is good. But then I also want to have the ability to give discount to certain service in that transaction, like, not for every services listed in that transaction."

## Clarifications

### Session 2026-05-22

- Q: Per-service discount: does it reduce the assigned technician's commission base, or only the customer total? → A: Status quo — customer-facing only. The targeted service's full pre-discount price still counts toward the assigned tech's commission base; the discount is a salon-level revenue cost.
- Q: How should the scope of a per-service discount be shown in the cart vs. on the receipt? → A: Cart row shows the targeted service name when exactly one service is scoped, or "N services" when more than one. The printed/displayed receipt and the past-transaction detail view enumerate every targeted service by name.
- Q: When both an "all-services" discount and a scoped discount apply to one sale, which base does each compute against? → A: Sequential — scoped discount(s) are applied to their targeted services first; the all-services percent is then computed against the post-scoped service subtotal. Matches Square's behavior; cannot drive the total below $0.
- Q: When every targeted service is removed from the cart, what should happen to the scoped discount row? → A: Auto-remove. The discount disappears from the cart the moment its last target is removed; the operator re-adds it from scratch if they want it back after re-adding services.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scope a discount to selected services (Priority: P1)

An operator is ringing up a customer who has had three services in one visit. The customer was promised "15% off the pedicure only" — not off the manicure or the polish change. Today the operator can only apply a discount that reduces the **entire** transaction, which over-discounts the sale or forces the operator to fake an amount that approximates the intended scope. With this feature, when the operator opens the Add discount sheet they can choose **what** the discount applies to: either every service in the sale (today's behavior — the default), or **one or more specific services** in the current cart. When the scope is "selected services," only those services contribute to the discount calculation, and the cart total reflects the correct customer-facing reduction.

**Why this priority**: This is the entire reason for the feature. Without it the operator cannot accurately ring up promotions, loyalty perks, or service-specific comps that are common at the salon. Every other story in this spec is supporting polish.

**Independent Test**: With a cart that has at least two services at different prices, open the discount sheet, choose "Selected services," pick exactly one of the services, enter a flat or percent value, and save. The cart total decreases by the correct amount for that one service only; the other service line is untouched. The operator can complete checkout normally.

**Acceptance Scenarios**:

1. **Given** a cart with two services priced $40 (manicure) and $60 (pedicure), **When** the operator adds a 50%-off discount scoped to the pedicure only, **Then** the cart subtotal is $70 ($40 + $60 − $30) and the discount row clearly shows it applies to the pedicure.
2. **Given** a cart with three services, **When** the operator adds a $10 flat discount scoped to two of the three services, **Then** the cart subtotal drops by $10 and the discount row shows it applies to those two services.
3. **Given** the operator opens the discount sheet without changing the scope, **When** they enter an amount and save, **Then** the discount applies to every service in the sale (today's behavior is preserved as the default).
4. **Given** a cart with one service, **When** the operator adds a discount, **Then** "all services" and "selected services with one item picked" produce the same total (the UI need not force the operator to choose between functionally identical options).

---

### User Story 2 - See which services a discount applies to in the cart and on the receipt (Priority: P2)

The operator and the customer both need to see at a glance which services were discounted. The cart, the bill summary, and the printed/emailed receipt should make the scope visible — not just the dollar amount of the reduction. This prevents disputes ("you charged me full price for the pedicure!") and lets staff training stay grounded in what the customer actually paid for each service.

**Why this priority**: Without visible scope the per-service discount is functionally invisible to the customer and to anyone reviewing past transactions. Operators will distrust the feature if they cannot verify what they applied.

**Independent Test**: After completing a sale with a scoped discount, open the transaction's printed/displayed receipt or the past-transactions detail view. The discount entry shows the targeted service names (or a clear indicator like "applies to: Pedicure"), separate from any other discount on the same sale.

**Acceptance Scenarios**:

1. **Given** a discount scoped to one service, **When** the operator views the cart, **Then** the discount row shows the targeted service name beside the amount.
2. **Given** a discount scoped to two services, **When** the cart shows the discount row, **Then** the targeted service names (or "2 services" with the names visible on hover/tap) are shown clearly enough to verify scope without re-opening the discount sheet.
3. **Given** a completed sale with a scoped discount, **When** the operator views the past transaction, **Then** the same scope information appears alongside the discount in the historical record.
4. **Given** an "all services" discount on the same sale, **When** the cart or receipt is viewed, **Then** it is visually distinguishable from a scoped discount on the same sale (e.g., labelled "All services" vs. service names).

---

### User Story 3 - Discount targeting stays correct as the cart changes (Priority: P3)

Operators routinely add, remove, or re-price service lines mid-checkout (customer changes their mind, tech changes the service, etc.). A scoped discount must adapt safely. Removing a targeted service should not leave a "ghost" discount that still subtracts money. Adding a new service should not silently include it in an existing scoped discount the operator already configured. Changing a targeted service's price should keep the discount math correct.

**Why this priority**: Without this, scoped discounts will produce wrong totals every time a busy operator edits a cart mid-checkout. The feature would feel fragile.

**Independent Test**: Build a cart, scope a discount to one service, then remove that service from the cart. The scoped discount disappears (or visibly clears its targets). Add a new service afterwards. The new service is NOT silently included in the existing discount; the operator must re-edit the discount to include it.

**Acceptance Scenarios**:

1. **Given** a scoped discount targeting one service, **When** that service is removed from the cart, **Then** the discount line is removed from the cart in the same update — no placeholder, no inactive state, no error.
2. **Given** a scoped discount targeting two services, **When** one of the two is removed, **Then** the discount remains, now scoped to the one remaining target, and the amount is recomputed accordingly.
3. **Given** a percent discount scoped to a service, **When** the service's price is changed via the price-edit sheet, **Then** the discount amount recomputes from the new price.
4. **Given** a scoped discount in the cart, **When** the operator adds a new service line, **Then** the new line is NOT automatically included in the existing discount.
5. **Given** the operator removes the last target of a scoped discount, **When** the cart re-renders, **Then** the scoped discount line is gone (auto-removed per FR-010); payment can proceed immediately without operator confirmation.

---

### Edge Cases

- **Over-discount on the scope** — A flat discount larger than the sum of the targeted services' prices is allowed to save, but its effective reduction is capped at the targeted services' subtotal so the targeted contribution to the cart never goes negative. The cart's overall subtotal continues to floor at $0 (existing rule).
- **Multiple discounts on the same service** — Stacking is allowed: an operator can add a percent discount scoped to one service and a flat discount scoped to the same service. Each discount is computed independently against its own scope.
- **Mix of "all services" and scoped discounts on the same sale** — Both discount types coexist. The "all services" discount applies to every service line (today's behavior); a scoped discount applies only to its targets. Order of application is well-defined and shown to the operator (see FR-009).
- **Empty scope at save time** — The discount sheet does not allow saving with the "Selected services" mode chosen and zero services picked. The Save button stays disabled until at least one service is selected, with a clear inline hint.
- **All services removed after save** — A scoped discount whose every target service has been removed from the cart is auto-removed in the same update (FR-010). The operator does not see an inactive/placeholder line; the only signal is the cart total snapping to its pre-discount value at the same moment the service line disappears.
- **Variable-price service with unconfirmed price as a discount target** — Selecting an unconfirmed-price service as a discount target is allowed, but the discount contributes $0 (and the cart remains non-chargeable) until the price is confirmed; this mirrors today's rule that unconfirmed services do not contribute to the subtotal.
- **Percent scoped discount when only one targeted service is present and its price is $0** — Discount amount is $0; no error, no division-by-zero artifact.
- **Service removed while the discount sheet is open editing it** — The discount sheet either reflects the change or fails gracefully on save; the cart is the source of truth.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Add discount sheet MUST let the operator choose between two scopes for the discount: "All services in this sale" (default, today's behavior) and "Selected services."
- **FR-002**: When "Selected services" is chosen, the discount sheet MUST present the current cart's service lines as selectable targets (each shown with its display name and current price), and MUST allow the operator to pick one or more — but no fewer than one — services before the discount can be saved.
- **FR-003**: A scoped percent discount MUST compute its dollar reduction as `percent × sum(price of targeted services)`, rounded to whole cents using the same rounding rule the existing all-services percent discount uses.
- **FR-004**: A scoped flat discount MUST reduce the cart by the entered dollar amount, capped at the sum of targeted services' prices (the targeted contribution can never go negative), independent of any other discount on the sale.
- **FR-005**: The default scope ("All services in this sale") MUST behave exactly as today's discount does (no change in math, no change in UI for operators who never engage with the new scope control).
- **FR-006**: The cart row for a scoped discount MUST identify its scope as follows: when exactly one service is targeted, the row shows the service name (e.g., "Discount — Pedicure"); when more than one service is targeted, the row shows "Discount — N services" (e.g., "Discount — 2 services"). The full target list is NOT required on the cart row.
- **FR-007**: The printed/displayed customer receipt AND the past-transaction detail view MUST enumerate every targeted service by name for each scoped discount on the sale (one bullet/line per target), and MUST distinguish scoped discounts from "all services" discounts (an "all services" discount appears without a per-service list and is clearly labelled as applying to the whole sale).
- **FR-008**: An "all services" discount and one or more scoped discounts MUST be allowed to coexist on the same sale, and the cart MUST show their effect in a stable, deterministic order so the operator can reconcile the totals.
- **FR-009**: When both an "all services" discount and one or more scoped discounts apply to the same sale, the system MUST compute the cart total sequentially: (a) apply every scoped discount to its targeted service line(s) first, producing a post-scoped service subtotal; (b) then apply the "all services" discount — if percent, against the post-scoped service subtotal; if flat, as the entered amount. This matches the discount-stacking behavior of the existing Square integration and prevents stacked percent discounts from compounding past 100% of the original subtotal. The cart's on-screen line-by-line breakdown MUST reflect this same order (scoped lines above the all-services line) so the operator and customer can reconcile the math.
- **FR-010**: Removing a targeted service from the cart MUST update the scoped discount: if at least one target remains, the discount stays and its amount recomputes from the remaining targets; if **no** targets remain, the discount MUST be auto-removed from the cart. The discount line disappears in the same cart update cycle as the removed service; there is no inactive/$0 placeholder state.
- **FR-011**: Adding a new service line to the cart MUST NOT silently include it in any pre-existing scoped discount. The new service joins a scoped discount only when the operator explicitly edits the discount to add it.
- **FR-012**: Changing a targeted service's price (via the existing price-edit sheet) MUST cause percent-scoped discounts on that service to recompute, with no operator action required.
- **FR-013**: The "Selected services" mode MUST disable the Save button while zero services are selected and show an inline hint explaining what is missing.
- **FR-014**: The operator MUST be able to remove a scoped discount the same way they remove the current transaction-wide discount (single-tap remove from the cart row, idempotent).
- **FR-015**: Each scoped discount's effect on the cart total MUST never let the cart subtotal fall below $0 (preserves the existing floor-at-zero invariant).
- **FR-016**: Auto-removing an orphaned scoped discount (per FR-010) MUST NOT block payment, MUST NOT surface an error to the operator, and MUST NOT require operator confirmation. Payment is allowed as long as the rest of the cart is otherwise chargeable.
- **FR-017**: The operator MUST be able to edit an existing scoped discount in place (change scope, change shape, change amount, change note) without first removing and re-adding it.
- **FR-018**: Per-service discounts MUST NOT reduce the assigned technician's commission base for the targeted service. The technician's gross-service contribution for reporting and payroll continues to use the service line's pre-discount price. This applies regardless of which technician is assigned to the targeted service.

### Key Entities

- **Discount line (existing, extended)**: An entry in the cart that reduces the customer total. Today it has a shape (flat or percent), a value, and an optional note; this feature adds a **scope** — either "all services" or a list of specific service lines in the same sale that the discount applies to. The scope is a property of the discount, not of the service line.
- **Cart**: The current in-progress sale. Owns service lines and discount lines. Computes the cart subtotal as the service subtotal minus the sum of every discount's effective contribution (floored at $0).
- **Service line**: An item in the cart representing one service performed. Unchanged structurally; gains the property of being **referenceable as a discount target** by the discount line.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can apply a single-service discount on a multi-service cart and complete checkout in under 30 seconds, measured from opening the Add discount sheet to charging the customer.
- **SC-002**: 100% of completed sales that include a per-service discount show, on the customer receipt and in the past-transaction view, the names of the services the discount applied to.
- **SC-003**: When a targeted service is removed from the cart, the cart total is correct within 200 milliseconds without the operator taking any action on the discount row.
- **SC-004**: Zero sales can be completed with a scoped discount that names zero services (the system either prevents save or treats the scope as inactive — never silently applies it to "all").
- **SC-005**: For operators who never engage with the new scope control, the discount flow is unchanged: same number of taps, same default outcome, no extra friction.

## Assumptions

- **Payroll and commission math is unchanged (CONFIRMED in clarification 2026-05-22)** — Today's report and payroll aggregations compute each technician's commission base from their service line prices *before any discount*. This feature does not alter that. A per-service discount reduces what the customer pays but does not reduce the assigned technician's commissionable revenue. (If the salon owner later decides discounts should reduce the responsible technician's pay, that is a separate feature; this spec is explicit about leaving it alone so the change is reversible.)
- **Discount target unit is the service line, not the service catalog item** — If the same service appears twice in one cart (two pedicures on the same ticket), the operator picks line A or line B (or both) individually, not "all pedicures." This matches how the cart already represents duplicate services.
- **Scope is captured per discount, not per service line** — A service line does not carry a "discounted by" marker; the relationship is owned by the discount. This makes "the customer also got a 5% off everything" coexist naturally with a $10-off-this-one-service discount.
- **Tax stays at $0 (v1 invariant)** — Same as today: no tax math affects this feature.
- **Gratuity baseline stays at the pre-discount service subtotal** — Same as today's "tip on the gross service amount" rule.
- **No new server-side roles or permissions** — Any staff role who can add an "all services" discount today can also add a scoped discount; no new role gates.
- **Receipt format change is in-scope** — Updating the printed/displayed receipt to show scope information is part of this feature, not deferred.
- **Past-transaction detail view change is in-scope** — Showing scope information on already-closed transactions is part of this feature for sales created after the feature ships. Sales closed *before* the feature ships continue to render as transaction-wide discounts (their scope was implicitly "all").
- **Multi-select target picker is part of the discount sheet itself** — No new screen or modal; the existing discount sheet grows the scope control inline.
