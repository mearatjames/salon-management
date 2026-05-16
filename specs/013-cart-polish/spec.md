# Feature Specification: Checkout — Cart Polish (Variable Pricing, Discounts, Bill Preview)

**Feature Branch**: `worktree-013-cart-polish`

**Created**: 2026-05-16

**Status**: Draft

**Input**: User description: "Add the cart-side polish to the existing single-screen checkout: variable pricing, discount lines, and a restaurant-style 'drop the bill' preview that prints or emails before payment is taken. Builds on phase 2's `/checkout/[ticketId]` page."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Set the price on a variable-priced service before charging (Priority: P1)

A nail technician adds "Nail art · medium" to the cart, which the salon prices on the fly depending on the design. The tile is flagged variable, so the cart row lands without a confirmed price and the Charge button refuses to fire. A price sheet opens automatically: the technician taps a preset chip (e.g., "Medium · $45"), nudges it with a quick adjuster (+$5 for an accent finger), and saves. The row is now priced, the highlight clears, and the Charge button is enabled.

**Why this priority**: Phase 2 already supports adding a variable-priced service to the cart, but charges are blocked while any line is unconfirmed and the placeholder dialog refuses input. Without a real price-entry surface, the salon cannot actually charge for any service that isn't fixed-price, which is most of their custom work. This is the most-load-bearing missing piece.

**Independent Test**: From a signed-in studio session in checkout, add a service flagged variable, confirm the cart row enters the unconfirmed state and the Charge button shows the "Set price on highlighted items" hint, then open the price sheet (auto-opened on add), set a price via a preset or adjuster, save, and verify the row reflects the saved price, the highlight clears, and the Charge button is enabled.

**Acceptance Scenarios**:

1. **Given** the technician is on the checkout screen with a tech picked and an otherwise empty cart, **When** they tap a service tile flagged variable, **Then** the row is appended to the cart in an unconfirmed-price state AND the price sheet opens automatically for that row.
2. **Given** the price sheet is open for a variable service that defines presets, **When** the technician taps a preset chip, **Then** the displayed amount jumps to that preset and the Save button enables.
3. **Given** the price sheet is open with a working amount, **When** the technician taps a quick adjuster (−$10, −$5, +$5, +$10, +$20), **Then** the working amount changes by that delta (never below $0).
4. **Given** the price sheet is open, **When** the technician taps the displayed amount to reveal the numpad, **Then** a numeric keypad appears and lets them type an exact amount, replacing the working amount.
5. **Given** the price sheet shows a positive working amount, **When** the technician taps Save, **Then** the cart row is updated to that price, the unconfirmed flag clears for that row, the highlight clears, and the sheet closes.
6. **Given** any line in the cart is still unconfirmed, **When** the technician views the cart footer, **Then** the Charge button reads "Set price on highlighted items" and is disabled.
7. **Given** no lines are unconfirmed, **When** the technician views the cart footer, **Then** the Charge button reads "Charge $X" with the current total and is enabled.

---

### User Story 2 — Override the snapshotted price on any cart row for one sale (Priority: P2)

The technician already added "Gel polish · $60" to the cart, but the customer is a regular getting a complimentary $10 off as a courtesy. Rather than adding a discount line, the technician taps the $60 price button on that row, the same price sheet opens, they nudge with −$10, and save. The row now shows $50 for this sale only. The salon's catalog row for Gel polish is unchanged for the next customer.

**Why this priority**: One-off pricing tweaks (a quick complimentary adjustment, a re-do at a reduced rate, an upcharge for extra length) come up often enough at the front desk that a row-level override is meaningfully faster than discounts every time. It reuses the exact same sheet built for P1, so the marginal cost is small and the operational payoff is real. Lower than P1 because the discount path (P3) covers most regulated reductions and a full discount line is auditable in ways an in-place override is not.

**Independent Test**: In a checkout with a fixed-price service in the cart, tap the row's price button, set a different positive amount, save, and verify the row shows the new amount, the running total recomputes, and the underlying service catalog row is unchanged.

**Acceptance Scenarios**:

1. **Given** a cart row whose price is confirmed (fixed-price service or a previously-confirmed variable one), **When** the technician taps the row's price button, **Then** the price sheet opens pre-filled with the row's current amount.
2. **Given** the price sheet is open over a confirmed row, **When** the technician changes the amount and taps Save, **Then** only that row's price changes and the running subtotal/total recompute; the catalog row remains untouched.
3. **Given** the price sheet is open over a confirmed row, **When** the technician taps Cancel or dismisses the sheet, **Then** no change is persisted and the row keeps its prior price.
4. **Given** the price sheet is open over a confirmed (already-priced) row, **When** the technician views the sheet's actions, **Then** no Remove action is offered (Remove appears only for rows that are still unconfirmed — see US1).
5. **Given** the price sheet is open over an unconfirmed row, **When** the technician taps Remove, **Then** the row is deleted from the cart and the sheet closes.

---

### User Story 3 — Add a discount line to the cart (Priority: P2)

A returning customer has a $10-off loyalty perk. The technician taps "+ Discount" in the cart header, picks "Flat amount," types $10, optionally notes "Loyalty perk," and saves. A discount line appears under the services with `−$10.00`. The total recalculates. Later in the same sale, the same UI also supports a percentage discount (e.g., 15% off the service subtotal) for promotions.

**Why this priority**: Discounts are a recurring, customer-facing part of running a nail salon (loyalty, promos, employee perks, comps). They're priority-tied with P2 in-place overrides because they cover the structured/auditable case (a named, line-itemized reduction) while overrides cover the informal case. Lower than P1 because the salon can technically work around discounts via overrides; higher than nothing because losing the audit trail of explicit discount lines is unhealthy for a managed business.

**Independent Test**: In a checkout with at least one service line, open the discount sheet from the cart header, pick "Flat amount" and enter a positive value, save, and verify a new line appears in the cart with a negative amount equal to the entered value and the running total recomputes accordingly. Repeat for "Percent" and verify the saved amount equals the chosen percent of the current service-line subtotal.

**Acceptance Scenarios**:

1. **Given** a cart containing at least one service line, **When** the technician taps "+ Discount" in the cart header, **Then** a small sheet opens with two shape options: "Flat amount" and "Percent."
2. **Given** the discount sheet has "Flat amount" selected, **When** the technician enters a positive amount and saves, **Then** a new cart line is added with kind = discount and a negative amount equal to the entered value, the cart subtotal/total recompute, and the sheet closes.
3. **Given** the discount sheet has "Percent" selected, **When** the technician enters a positive whole percent (e.g., 15) and saves, **Then** a new cart line is added with kind = discount whose amount equals −(percent × current service-line subtotal), and that percent is persisted so the discount amount remains correct if a service line is later added/removed/repriced before charging.
4. **Given** a discount line exists in the cart, **When** the technician removes it via the row's remove control, **Then** the discount is deleted and the running totals recompute.
5. **Given** a discount has been entered that exceeds the configured manager-PIN threshold (if any threshold is set), **When** the technician saves it, **Then** the discount is still accepted in this phase (no manager-PIN prompt yet — wired in a later phase).
6. **Given** the manager-PIN threshold setting is null (the v1 default), **When** any discount is saved, **Then** no override prompt is shown for any amount.

---

### User Story 4 — Drop the bill: print or email an itemized check before taking payment (Priority: P2)

The customer is finishing their service and wants to see what they owe before reaching for their wallet — same expectation a restaurant guest has when the server brings the check. The technician taps Bill in the cart footer (next to Charge). A restaurant-style bill preview opens on top of the cart: salon name and address, the line items with snapshotted names and prices, subtotal and tax, total before tip, and a suggested-gratuity block (18% / 20% / 25%) showing the resulting all-in totals. The technician taps Print bill to fire the browser print dialog, or Email to send the check to a customer-provided address.

**Why this priority**: Tied with discounts as the second-most-load-bearing addition. The bill preview lets the front desk confirm the check with the guest before any money changes hands, prevents the awkward "wait, can I see what I owe?" backtrack after Charge is tapped, and gives a salon a credible answer to "can I get a receipt before I pay?" Lower than P1 (variable pricing) because a sale can still close without a printed bill; higher than nothing because dropping the bill cleanly is what distinguishes a polished checkout from a calculator.

**Independent Test**: In a checkout with at least one priced service line and a tech picked, tap Bill in the cart footer, verify the bill sheet opens showing the salon header, the line items, the subtotal/tax/total, and three suggested gratuity rows; tap Print bill and verify the browser's print dialog fires against a print-only stylesheet that renders the bill alone (no studio chrome); tap Email, enter an address, submit, and verify a success toast appears.

**Acceptance Scenarios**:

1. **Given** the checkout has at least one cart line (any kind), **When** the technician taps the Bill button in the cart footer, **Then** the bill sheet opens as an overlay on top of the cart (the cart remains the page below).
2. **Given** the bill sheet is open, **When** the technician views it, **Then** it shows the salon name / address / phone, the guest label ("Walk-in client" when none attached), the tech name, an itemized list of every cart line (services and discounts) with snapshotted name and per-line amount, the subtotal of service lines, the discount line(s), the tax line, the total before tip, and three suggested-gratuity rows at 18% / 20% / 25%.
3. **Given** the bill sheet is open, **When** the technician taps Print bill, **Then** the browser's print dialog opens with only the bill rendered (no studio chrome, no cart, no sidebar) per the print-only stylesheet.
4. **Given** the bill sheet is open, **When** the technician taps Email, **Then** a small dialog opens asking for the customer's email address.
5. **Given** the email dialog is open, **When** the technician enters a syntactically valid email and submits, **Then** the system records the email-bill request in the audit log (action = `bill.emailed`) and shows a "Bill emailed to {address}" success toast.
6. **Given** the email dialog is open, **When** the technician submits with an empty or syntactically invalid address, **Then** the system shows an inline validation error and does not log or toast success.
7. **Given** the bill has been printed or emailed, **When** the technician closes the bill sheet, **Then** the cart returns to its prior state with no ticket-status change (payment has not been taken).

---

### Edge Cases

- **Variable service whose catalog has no presets**: The price sheet opens with the quick adjusters and the numpad-on-tap-of-the-amount only. The Quick picks section is omitted entirely. The working amount starts at $0 (or at `price_from_cents` if defined, per the prototype's fallback).
- **Cancel from the auto-opened price sheet on a brand-new variable row**: The row is removed from the cart (the Remove control is wired for unconfirmed rows specifically). Cancel on a confirmed-row override leaves the row priced as before.
- **Saving a $0 price**: The Save button is disabled while the working amount is $0; the technician must enter a positive value or Cancel/Remove the row.
- **Percent discount on a cart whose service subtotal is $0**: The discount amount is computed as $0 (no negative line is added). The discount sheet may show a hint that there's nothing to apply yet, but the action itself is a no-op rather than an error.
- **Discount that would drive the total negative**: The displayed total is floored at $0 (the cart never shows a negative total). The discount line lands on the cart as the operator entered it, but Charge is disabled while the floored total is $0 (the existing phase-2 rule `amount_cents > 0` still holds); the operator must reduce the discount or remove it to proceed.
- **Two discount lines in the same cart**: Allowed. Each line is independent. The total is `subtotal_of_services + sum(discount_lines)` (discount amounts are negative), floored at $0 per the rule above.
- **Discount on a cart that still has an unconfirmed-price line**: Allowed to add the discount line. Charge remains blocked by the unconfirmed-price gate from US1 until every service line is priced.
- **Bill sheet opened on an empty cart**: The bill renders with the "No items in this sale yet" empty state (per the prototype). Suggested-gratuity rows are suppressed. Print/Email are still available but produce an empty bill — acceptable for the print case (rare), and the email submit MUST still validate the address and log the attempt with a payload that records the empty cart so it isn't silently misleading.
- **Bill sheet open while a price is changed underneath**: The bill is a snapshot rendered from the cart at the moment it opened. The Print action prints what the sheet shows. If the technician closes the sheet, edits the cart, and re-opens, the new snapshot reflects the edit.
- **Email integration is stubbed**: The Server Action behind the Email button MUST return success without dispatching any real mail in this phase. The audit log row is the only persisted evidence the action ran.
- **Salon settings missing**: If the `settings` rows for salon name / address / phone aren't populated, the bill MUST fall back to safe defaults seeded by this phase's migration (a salon-name placeholder is acceptable; address/phone fall back to blank lines). The bill MUST NOT fail to render.

## Requirements *(mandatory)*

### Functional Requirements

#### Variable-price entry

- **FR-001**: When the operator adds a service whose catalog flag indicates variable pricing, the system MUST append a cart row in an unconfirmed-price state AND automatically open the price-entry sheet for that row.
- **FR-002**: The price-entry sheet MUST display the service name, a one-line context note ("Varies $X–$Y · {service note}" for variable services; "Adjust price for this sale" when the sheet was opened on an already-confirmed row), a large working-amount display, a row of quick-adjuster buttons (−$10, −$5, +$5, +$10, +$20), an optional preset-chips section, and a numpad that the operator can reveal by tapping the working-amount display.
- **FR-003**: The preset-chips section MUST be rendered only when the underlying service catalog row carries one or more presets; when present, each chip MUST show the preset label and price, and tapping a chip MUST set the working amount to that price.
- **FR-004**: The quick adjusters MUST modify the working amount by their stated delta and MUST clamp the result at $0 (never negative).
- **FR-005**: The numpad MUST replace the working amount on its first keypress after being opened (a fresh-edit affordance) and MUST allow standard digit / decimal-point / backspace input thereafter.
- **FR-006**: The sheet's Save action MUST be enabled only when the working amount is strictly greater than $0, and on save MUST update the row's stored unit price, clear the row's unconfirmed flag, recompute cart totals, and dismiss the sheet.
- **FR-007**: The sheet's Cancel action MUST dismiss the sheet without persisting any change to the row.
- **FR-008**: The sheet MUST surface a Remove action only when the underlying row is in the unconfirmed-price state (newly-added variable service that hasn't been confirmed yet). Tapping Remove MUST delete the row from the cart and dismiss the sheet. Override sessions opened on already-confirmed rows MUST NOT show Remove.
- **FR-009**: The operator MUST be able to re-open the price sheet at any time by tapping the price control on any cart row, including rows whose price is already confirmed (override path). The behavior is otherwise identical to the auto-open variant except for the Remove visibility rule (FR-008) and the context note (FR-002).
- **FR-010**: While any cart line carries the unconfirmed-price flag, the Charge button in the cart footer MUST be disabled AND its label MUST read "Set price on highlighted items"; the affected rows MUST be visually highlighted to point the operator at the work to do.
- **FR-011**: A price override (saving a non-catalog price for a previously-confirmed row) MUST NOT modify the service catalog row; it MUST persist only against the cart line for this single sale.

#### Discount lines

- **FR-012**: The cart header MUST expose a "+ Discount" affordance. Activating it MUST open a small sheet for entering a discount.
- **FR-013**: The discount sheet MUST offer exactly two shapes: a flat amount and a percent.
- **FR-014**: Saving a flat-amount discount MUST insert a new cart line of kind = discount with a unit price equal to the negative of the entered amount, and the line MUST be displayed beneath the service lines.
- **FR-015**: Saving a percent discount MUST insert a new cart line of kind = discount whose stored discount-percent is the entered percent and whose unit price is recomputed as −(percent × current service-line subtotal). The percent MUST be persisted so the line's amount stays correct if service lines are added, removed, or repriced before charge.
- **FR-016**: Discount lines MUST be individually removable from the cart via the same row-remove affordance used for service lines.
- **FR-017**: The cart's running total MUST be `subtotal_of_service_lines + sum(discount_line_amounts)` (discount lines are negative) and MUST be floored at $0 for display and for the Charge action's enable check; a discount that would otherwise produce a negative total MUST cap the displayed total at $0 and MUST disable Charge (a $0 charge is not allowed in v1 per the phase-2 rule).
- **FR-018**: The system MUST read a `discount.manager_threshold_cents` setting at discount-save time. In v1, when the setting is null, all discounts MUST be saved without any override prompt. The system MUST NOT attempt to render a manager-PIN UI in this phase even when a non-null threshold is configured (the override UI lands with the refunds phase). The read MUST be wired so the later phase can plug in the UI without further plumbing changes.
- **FR-019**: Adding or saving a discount line MUST NOT change a ticket's status; the ticket remains "open" until a payment is taken or it is discarded.

#### Bill preview

- **FR-020**: The cart footer MUST expose a "Bill" button positioned alongside the existing Charge button. Activating Bill MUST open the bill-preview sheet as an overlay on top of the cart without changing the ticket's status.
- **FR-021**: The bill-preview sheet MUST render: a masthead containing the salon name, salon address, and salon phone (read from the `settings` table); a meta block containing the guest label ("Walk-in client" when none attached), the picked tech name, and the visit context; an itemized list of every cart line (services and discounts) with snapshotted name and per-line amount; a totals block listing the service subtotal, the discount lines (if any), the tax line, and the total-before-tip; and a suggested-gratuity block listing three rows at 18%, 20%, and 25% (each showing the tip amount and the all-in total at that tip).
- **FR-022**: The bill-preview MUST be a read-only snapshot of the cart at the moment the sheet was opened. Editing the cart underneath while the sheet is open MUST NOT mutate the sheet's contents; closing and re-opening the sheet MUST present a fresh snapshot.
- **FR-023**: The bill sheet MUST expose a "Print bill" action that invokes the browser's print dialog against a print-only stylesheet so only the bill renders to paper (no studio chrome, no cart, no sidebar, no sheet backdrop).
- **FR-024**: The bill sheet MUST expose an "Email" action that opens a small dialog accepting an email address. On submit with a syntactically valid address, the system MUST invoke a Server Action that (in this phase) does not send mail; the action MUST return success and the client MUST show a success toast naming the recipient.
- **FR-025**: Every successful "Email" submission MUST insert a row into `audit_log` with action `bill.emailed`, the acting staff id, the ticket id, and a payload that includes the destination address and a snapshot of the line items being billed.
- **FR-026**: An empty or syntactically invalid email address in the dialog MUST be rejected client-side with an inline validation error; no Server Action call MUST be made and no audit log row MUST be written. The Server Action MUST ALSO validate the address shape server-side (defense in depth) and MUST reject malformed addresses without inserting an audit row.
- **FR-027**: Closing the bill sheet (via its close control, its Back button, or backdrop dismissal) MUST return the operator to the unchanged cart. No ticket-status change, no cart mutation, no payment row.

#### Data model

- **FR-028**: The system MUST extend `ticket_items` to support discount lines: the `kind` enum MUST add the value `discount`, and the table MUST add a nullable `discount_pct` column that holds the percentage (when the discount was entered as a percent) so the amount can be recomputed against the live service-line subtotal until charge.
- **FR-029**: The system MUST extend `services` with a `presets` JSON column that, when populated, supplies the preset chips for the variable-price sheet. Each preset element MUST carry at minimum a human label and a price.
- **FR-030**: The system MUST expose the existing variable-price metadata on `services` (the variable flag, the from/to bounds, and the operator-facing note) to the price sheet. If the underlying columns already exist from an earlier phase, no rename is required; the spec is satisfied by reading and surfacing those values.
- **FR-031**: The system MUST introduce a `settings` table (key/value shape) seeded with sensible defaults for at minimum `salon.name`, `salon.address`, `salon.phone`, and `discount.manager_threshold_cents`. The bill preview and the discount sheet MUST read these values at render time.

#### Visual / system constraints

- **FR-032**: All UI in this feature MUST follow the Lacquer design system: tokenized colors / spacing / radii, shadcn/ui primitives, Lucide icons, Inter typography, and tabular numerals for all currency, percentages, and amounts. The price sheet, discount sheet, and bill sheet MUST be direct adaptations of the prototypes in `design-system/prototypes/transaction/` (do not redraw).

#### Authorization

- **FR-033**: Every action in this feature (setting/overriding a line price, adding/removing a discount line, opening the bill, printing the bill, emailing the bill) MUST be available to any signed-in staff member in this phase. No additional role or PIN gate is enforced. The manager-PIN gate over discounts above threshold (FR-018) is wired only as a setting read; the override UI itself is deferred to the refunds phase.

### Key Entities

- **Ticket item (extended)**: The existing cart-line entity gains support for discount lines via a new `kind = discount` value and a new optional `discount_pct` field. Service lines continue to behave as in phase 2. Discount lines store a negative line amount; when entered as a percent, they also remember the percent so the amount remains correct after subsequent service-line edits.
- **Service (extended)**: The existing catalog entity gains a `presets` field that supplies the chip-row options for the variable-price sheet. The other variable-price metadata (the flag, the from/to bounds, the note) is already present on the entity from an earlier phase and is surfaced unchanged.
- **Settings entry**: A key/value record holding salon-level configuration: at minimum `salon.name`, `salon.address`, and `salon.phone` (used by the bill masthead), and `discount.manager_threshold_cents` (read by the discount save path; UI deferred). Seeded with safe defaults; admin edit UI is out of scope here.
- **Audit log entry (new action)**: The existing audit-log entity gains the action vocabulary value `bill.emailed`, written by the stub email Server Action with a payload carrying the destination address and the billed line snapshot.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in technician can add a variable-priced service, set its price via the auto-opened sheet (preset or adjuster), and have Charge become enabled in under 10 seconds end-to-end.
- **SC-002**: 100% of cart lines created from a service whose catalog flag is variable land in the unconfirmed-price state and block Charge with the "Set price on highlighted items" hint until resolved.
- **SC-003**: A price override saved against a previously-confirmed cart row changes only that row's amount and leaves the underlying service catalog row unchanged (verified by re-adding the same service to a new cart and seeing the catalog price, not the override).
- **SC-004**: A percent discount entered before a subsequent service-line edit MUST recompute its amount against the new service-line subtotal at charge time so the final discount value reflects the actual cart at the moment of payment (the percent persists, not a stale amount).
- **SC-005**: 100% of discount lines persist as a `ticket_items` row with `kind = discount` and (for percent discounts) the entered percentage; the cart's running total reflects the discount immediately on save.
- **SC-006**: The bill preview can be opened and rendered against a non-empty cart in under 1 second of perceived latency, and a Print bill invocation produces a single-page browser-print output containing only the bill (no studio chrome present on the printed page).
- **SC-007**: 100% of Email-bill submissions with a syntactically valid address produce an `audit_log` row with action `bill.emailed` and a payload containing the destination address and the billed line items, without dispatching any real outbound mail in this phase.
- **SC-008**: 0% of bill-preview opens, prints, or emails change a ticket's status, mutate a cart line, or insert a payment row (the bill preview is read-only by construction).
- **SC-009**: In an unmoderated walk-through, a technician who has not seen this polish before can (a) set a price on a variable service via the auto-opened sheet, (b) add a flat-amount discount line, and (c) print a bill, without external guidance.

## Out of Scope

The following are explicitly deferred to later phases and MUST NOT be built in this phase, even if surface area is rendered:

- **Manager-PIN override UI** on discounts above the configured threshold. The setting MUST be read, but no override prompt is shown. Lands in the refunds / approvals phase (phase 8) alongside void / refund approvals.
- **Real outbound email delivery** for the bill. The Email button writes an audit-log row and shows a success toast, but no mail transport is wired. Lands post-v1 with the chosen email provider.
- **Edit UI for the `settings` table** (salon name / address / phone). The values are seeded by the migration. Operator-facing settings administration is its own later feature.
- **Refunds, voids, or undoing a discount after charge.** The discount lives on the open ticket; once the ticket is paid, the discount is part of the closed-out check.
- **Tax computation changes.** Tax remains $0 in this phase per the existing phase-2 invariant. The bill renders a tax line and the suggested-gratuity rows assume the existing v1 tax behavior.
- **Tip capture during Charge.** The bill preview shows suggested gratuity for the customer; the Charge flow itself remains cash-only with no tip capture (phase-2 rule).
- **Per-row quantity controls and product lines.** The ticket-item kind enum gains `discount` in this phase; `product` and any quantity-step UI are later.
- **Multi-device live sync** of the cart, the bill preview, or the discount entry. The existing phase-2 stance holds: server is source of truth, page refresh re-derives state, no realtime push.

## Assumptions

- **Phase 2 is in place**: The single-screen checkout at `/checkout/[ticketId]` (ticket creation, tech pick, service tile grid, cart, cash payment, confirmation screen) exists and is the surface this phase polishes. New affordances (Bill button, "+ Discount", price sheet, override entry points) are additions to that screen, not a replacement.
- **Existing variable-price columns on `services`**: The `services` table already carries `variable_price`, `price_from_cents`, `price_to_cents`, and `variable_price_note` (added in the services-catalog phase). This phase reuses them and only adds `presets` as a JSON column. The spec's user-facing names (`variable`, `price_from`, `price_to`, `note`, `presets`) refer to these underlying columns; no rename is required.
- **Existing `ticket_items` shape**: `ticket_items` carries `kind`, `name_snapshot`, `unit_price_cents`, `qty`, `price_unconfirmed`, and the per-line tech assignment from the phase-2 migration. This phase extends `kind` (`discount`) and adds `discount_pct` only.
- **No `settings` table yet**: This phase introduces it as a simple key/value (or JSON-valued) table. The keys named in FR-031 are the minimum required for this phase; additional keys may be added by future features without renaming.
- **Discount lines do not own a service reference**: Unlike service lines, discount lines do not reference a row in `services`. The data-model design (deferred to plan.md) will decide whether `ticket_items.ref_id` becomes nullable for discount kinds or whether discount lines route through a different mechanism. From the spec's perspective, the requirement is that a discount line is persisted as a `ticket_items` row with `kind = discount`.
- **Stub email Server Action**: The Email button calls a Server Action that returns a success result without performing any external network call. The action MUST insert the audit-log row described in FR-025 and MUST validate the address shape server-side as well (defense in depth against bypassing client validation).
- **Print-only stylesheet scoped to the bill DOM**: The browser-print path relies on a print media query that hides every page region except the bill content (sidebar, page header, cart, sheet backdrop are all hidden). No native-print fall-through APIs (PDF download, thermal printer driver) are introduced.
- **Tabular numerals on every numeric column**: Per Lacquer rules, the price sheet's working amount, the cart row prices, the discount amounts (negative-signed), the bill subtotal/tax/total, and the suggested-gratuity values all use Inter's tabular-numerals feature so digits don't shift width as values change.
- **Single salon, signed-in operator context**: This feature inherits phase 2's authorization stance — any signed-in staff member can perform any action in this surface, with no additional role check in this phase.
