# Feature Specification: Per-service deductions + two-pane services layout

**Feature Branch**: `021-services-deductions`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Upgrade the existing Services catalog (`/services`, feature 008) with per-service deductions and refactor the layout from drawer-overlay to two-pane. Reference design: `design-system/Services Page.html` / `ServicesV1.jsx` (V1 · Refined two-pane). Each service gains: (1) a card-fee mode — `default` (hardcoded $3 this phase; Phase 2 makes it a global policy), `custom` (per-service cents), or `exempt` (no card fee, ever); (2) an optional supply deduction (flat cents + short free-text label). Supply applies regardless of payment method; card fee applies when paid by card or gift card. Neither value is consumed by checkout in this phase — capture and display only. Replace the right-side drawer with a two-pane layout (~440px grouped list on the left, always-visible edit panel on the right). Add deduction chips to list rows. Add a Deductions section to the edit panel with a segmented Default · Custom · Exempt control, a supply toggle + amount + label, and a live 'Net to tech (card)' preview. Migration adds `card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label` to `services` with CHECK constraints and backfill defaults. Authorization unchanged. Out of scope: global policy entity / policy strip / Edit Policy sheet (Phase 2); wiring deductions into checkout / receipts / payouts (Phase 3); pedi-tier deductions; V2 payout-first table; per-tech staff assignments (remain deferred)."

This feature extends the **Services catalog** shipped in feature 008 with **per-service deductions** — the small amounts the salon subtracts from a tech's payout for card-processing costs and consumable supplies — and reshapes the page from a drawer-overlay to a **two-pane layout** so deductions can be edited without losing sight of the catalog list. It is **Phase 1 of three**. Phase 2 will introduce a global card-fee policy entity (replacing the hardcoded $3 default with a configurable value plus exempt-tech list); Phase 3 will wire the deductions into checkout / receipts / payout calculations. This phase captures and displays the values only.

The design reference is `design-system/ServicesV1.jsx` (the "V1 · Refined two-pane" variation). The same file's V2 variation is a comparison fork and is explicitly NOT what we are building.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See the catalog and edit a service without a modal drawer (Priority: P1)

The owner opens `/services` and sees the same catalog list they see today, now rendered as the left pane of a two-pane layout. The right pane is an always-visible **edit panel** that starts in an empty state ("Pick a service to edit, or add a new one"). Clicking a list row immediately reveals the panel pre-filled in **edit mode** for that service. Clicking "Add service" reveals the panel in **add mode** with a fresh draft. The right pane never overlays the list — the list is always visible alongside, the operator can switch between services with a single click, and there is no backdrop / Escape close gesture because nothing is being overlaid. Every field the drawer surfaces today (name, category, duration, price, color, taxable, variable-price + bounds + note) remains, in the same order, in the new panel.

**Why this priority**: Without the two-pane shape, there is no surface to attach the new Deductions section to in the way the design specifies (and the design's whole rhythm — list row → chip → panel section → live preview — depends on the panel being always-visible, not modal). This is the structural prerequisite for US2 and US3.

**Independent Test**: Without touching the new deduction fields, replace the drawer with the panel; confirm the existing 008 add/edit/archive/restore flows still work end-to-end via the new panel. Seed 5 services across 2 categories, click each, confirm the panel pre-fills correctly, edit name + price + color, save, confirm the list row updates in place and a "Changes saved" toast appears. Click "Add service" → fill out a new service → save → confirm the panel flips to edit mode for the just-created service and the list row appears under the right category.

**Acceptance Scenarios**:

1. **Given** the catalog has at least one service, **When** the owner opens `/services` for the first time in a session, **Then** the page renders a left pane with the grouped catalog list (sized roughly 440px wide on desktop) and a right pane with the empty-state edit panel showing an info icon and the copy "Pick a service to edit, or add a new one."
2. **Given** the empty-state panel is showing, **When** the owner clicks a row in the list, **Then** the right pane immediately re-renders in edit mode pre-filled with that service's saved values, with the panel's header showing the service's color swatch + name + category + duration + price, the existing fields (name/category/duration/price/color/taxable/variable-price) visible in the same order as the drawer used today, and "Save changes" disabled (draft matches saved baseline).
3. **Given** the panel is showing service A in edit mode with unsaved changes to the name field, **When** the owner clicks a different list row (service B), **Then** the system shows a "Discard changes?" confirm dialog naming service A; clicking Discard switches the panel to service B; clicking Cancel keeps the panel on service A with the unsaved name preserved.
4. **Given** the panel is in edit mode for a service with no unsaved changes, **When** the owner clicks a different row, **Then** the panel immediately re-pre-fills for the new service with no confirm dialog.
5. **Given** the panel is showing the empty state or a saved service, **When** the owner clicks "Add service", **Then** the panel switches to add mode with a fresh draft (defaults match the drawer's current Add defaults: category "Other", duration `30`, color Rose, taxable off, variable price off), the panel's header reads "New service", and the primary action reads "Save service" (disabled until required fields are valid).
6. **Given** the panel is in add mode with unsaved changes, **When** the owner clicks a list row or the "Add service" button (to discard the in-progress draft), **Then** the same "Discard changes?" confirm dialog appears as in scenario 3.
7. **Given** the panel is in edit mode and the owner clicks Save successfully, **When** the response returns, **Then** the panel remains open in edit mode for the same service with its baseline updated, the list row updates in place, and a "Changes saved" toast appears (behavior unchanged from 008).
8. **Given** the panel is in add mode and the owner clicks Save successfully, **When** the response returns, **Then** the panel flips to edit mode for the just-created service, the new row appears under the correct category group, the list scrolls the new row into view, and a "{name} added to the catalog" toast appears (behavior unchanged from 008).
9. **Given** the catalog is empty (first-run salon), **When** the page renders, **Then** the left pane shows the existing 008 empty state ("Add your first service to start booking appointments" + "Add service" CTA) and the right pane shows the panel empty state.
10. **Given** the page renders on any screen the studio supports, **When** the layout settles, **Then** every visible value (background, border, radius, padding, font weight, swatch color, chip color) traces to a Lacquer token; no raw hex, no off-scale spacing, no custom font weight.

---

### User Story 2 — Set a per-service card-fee mode (Priority: P1)

The owner opens any service in the edit panel and sees a new **Deductions** section. The first row in that section is **Card fee** with a segmented three-way control: `Default · $3` / `Custom` / `Exempt`. Choosing **Default** means the service uses the salon-wide default amount (hardcoded $3 in this phase, configurable in Phase 2); the segmented label shows the current default so the owner sees the actual amount. Choosing **Custom** reveals a `$` amount input where the owner types a per-service amount (e.g. `$4.50` for a long gel-X set). Choosing **Exempt** reveals a one-line explanation ("Card fee never applies, regardless of payment method") and hides the amount input. Saving persists the choice; the list row updates in place with the right deduction chip — blue "$3 card fee" for default, blue with the custom amount for custom, or a muted "No fees" chip when both card fee is exempt AND there is no supply.

**Why this priority**: Card-fee handling is the first of the two deduction concepts the salon needs to model in the catalog before Phase 3 can use them at checkout. Without it, every service silently defaults to "salon eats the fee" and there is no way to mark high-value services that should absorb a higher fee or exempt low-margin services.

**Independent Test**: Open any active service in the panel, set Card fee to Custom and enter `$5`, save; confirm the list row shows a blue "$5 card fee" chip and re-opening the panel shows the saved value. Switch the same service to Exempt, save; confirm the chip disappears (or becomes muted "No fees" if supply is also empty) and the panel shows the Exempt explanation. Switch back to Default, save; confirm the chip reads "$3 card fee" (the hardcoded default for this phase) and the custom amount input is no longer rendered.

**Acceptance Scenarios**:

1. **Given** a service that has never had its card-fee mode changed (existing service from before this feature), **When** the panel opens for it, **Then** the segmented control is set to `Default · $3`, no custom amount input is rendered, and the list row shows a blue "$3 card fee" chip.
2. **Given** the segmented control is set to Default, **When** the owner clicks Custom, **Then** a `$` amount input appears beside the segmented control with placeholder "0.00", focus moves to it, and "Save changes" enables.
3. **Given** Custom is selected, **When** the owner types `4.50` into the amount input and saves, **Then** the service persists with `card_fee_mode = 'custom'` and `card_fee_custom_cents = 450`, the list row shows a blue "$4.50 card fee" chip (using the custom amount, not $3), and the panel re-baselines (Save disables).
4. **Given** Custom is selected with an amount of `0` (or empty), **When** the owner attempts to save, **Then** the custom amount input shows an inline validation hint ("Enter a non-negative amount") and "Save changes" stays disabled; allowed values are `0` or any positive cents (an explicit `$0` is permitted because it means "intentionally zero for this service" rather than "exempt from card-fee logic entirely").
5. **Given** Custom is selected with a valid non-zero amount, **When** the owner clicks Exempt, **Then** the custom amount input disappears (and any value previously typed is cleared from the draft), an explanation reads "Card fee never applies, regardless of payment method," and "Save changes" enables.
6. **Given** Exempt is selected and the service has no supply, **When** the owner saves and the list row renders, **Then** the row shows a single muted "No fees" chip in the deductions slot (signalling that neither card fee nor supply applies).
7. **Given** Exempt is selected and the service has a supply deduction, **When** the list row renders, **Then** the row shows only the supply chip (no card-fee chip and no "No fees" chip — the supply chip already conveys that deductions exist).
8. **Given** the owner switches from Custom to Default, **When** they save, **Then** the persisted `card_fee_custom_cents` is cleared (set to null) and the list row chip flips back to "$3 card fee" using the hardcoded default.
9. **Given** the segmented control's Default label is fixed at `Default · $3` in this phase, **When** Phase 2 ships and replaces the hardcoded default with a configurable policy, **Then** the same control will read `Default · ${policy.amount}` without further migration work (the underlying `card_fee_mode = 'default'` rows do not need to change).

---

### User Story 3 — Set a per-service supply deduction (Priority: P1)

Below the Card fee row in the Deductions section is a **Supply deduction** row with a toggle, a `$` amount input, and a short free-text label input. When the toggle is off (the default for new services and the only state for pre-existing services), no amount or label is captured and no supply chip appears on the list row. When the toggle is on, both the amount AND the label become required; the operator types something like `$5.00` + `GelX tips & gel`. Saving persists both; the list row updates in place with an **amber** chip reading "$5 GelX tips & gel" (amount in tabular numerals, label in a slightly muted weight beside it). Toggling supply off again on a service that previously had it (and saving) clears both fields and removes the chip.

**Why this priority**: Supply pass-through is the second of the two deduction concepts and the more salon-specific one (every shop has its own list — chrome powder, OPI bottle wear, GelX tips, cat-eye gel). Owners need to record these per-service amounts now so Phase 3 can subtract them at checkout regardless of payment method.

**Independent Test**: Open any service, turn Supply on, enter `$5` + `GelX tips & gel`, save; confirm the list row shows an amber "$5 GelX tips & gel" chip and re-opening the panel shows the saved values. Turn Supply off on the same service, save; confirm the chip disappears, the amount/label inputs are no longer rendered, and re-opening the panel shows Supply toggled off with the prior amount/label not retained.

**Acceptance Scenarios**:

1. **Given** an existing service (pre-feature) opens in the panel, **When** the Deductions section renders, **Then** the Supply toggle is off, the amount and label inputs are not rendered, and the list row shows no supply chip.
2. **Given** the Supply toggle is off, **When** the owner flips it on, **Then** the amount input appears (with a sensible starting value such as `$5.00`) and the label input appears (empty, with placeholder "e.g. GelX tips & gel, Chrome powder, OPI bottle wear"); focus moves to the label input; "Save changes" enables.
3. **Given** Supply is on with an amount of `$0` (or empty), **When** the owner tries to save, **Then** the amount input shows an inline hint ("Enter a non-negative amount, or turn Supply off") and "Save changes" stays disabled; an explicit `$0` is rejected because Supply-on with no money is a contradiction (the toggle off state is how you say "no supply for this service").
4. **Given** Supply is on with a valid amount and an empty label, **When** the owner tries to save, **Then** the label input shows an inline hint ("Add a short label so staff know what this covers, or turn Supply off") and "Save changes" stays disabled.
5. **Given** Supply is on with amount `$5.00` and label `GelX tips & gel`, **When** the owner saves, **Then** the service persists with `supply_amount_cents = 500` and `supply_label = 'GelX tips & gel'`, the list row shows an amber chip reading "$5 GelX tips & gel", and the panel re-baselines (Save disables).
6. **Given** the label exceeds the reasonable display length, **When** the owner saves, **Then** the value is rejected on input — the label MUST be at most 64 characters after trim, and the input shows an inline character count when within 8 of the limit.
7. **Given** the label contains only whitespace, **When** the owner tries to save, **Then** the label is treated as empty (validation per scenario 4 applies).
8. **Given** Supply is on with values saved, **When** the owner flips the toggle off and saves, **Then** both `supply_amount_cents` and `supply_label` are cleared (set to null) atomically, the panel's draft clears them, and the list row's amber chip disappears.
9. **Given** the list row has both a card-fee chip and a supply chip, **When** the row renders, **Then** the card-fee chip appears first (blue) and the supply chip second (amber), separated by a small gap, both right-aligned to the row in the same visual band as the duration/price.

---

### User Story 4 — Preview the net the tech takes home (Priority: P2)

At the bottom of the Deductions section is a live **Net to tech (card)** preview: the service's price minus the effective card fee minus the supply deduction, recomputed on every keystroke. The preview shows the net amount in large tabular numerals plus a small right-aligned breakdown ("$45 service / −$3 card fee / −$5 GelX tips & gel") so the owner can see exactly which numbers are flowing into the net. The preview always assumes card payment (the worst case for the tech) and is labeled accordingly so there is no ambiguity about whether cash-only sales differ. The preview is read-only — it never persists — and it updates locally without a server round-trip.

**Why this priority**: This is the affordance that turns the abstract "card fee + supply" inputs into a concrete answer to the question the owner is actually trying to answer when setting deductions ("does the tech still make money on this service?"). Without it, the owner has to do arithmetic on paper. Lower priority than US2/US3 because the underlying data is what drives Phase 3; this is the editor-side calculator.

**Independent Test**: Open a service with price `$50`, card fee Default, supply on with `$5`. Confirm the Net to tech (card) preview reads `$42` ($50 − $3 default card fee − $5 supply) with the breakdown lines `$50 service`, `−$3 card fee`, `−$5 {label}`. Change the price input to `$60` (still draft, not saved); confirm the preview re-computes to `$52` within 100ms of typing. Switch card fee to Exempt; confirm the preview becomes `$55` and the `−$3 card fee` line drops from the breakdown.

**Acceptance Scenarios**:

1. **Given** the Deductions section is rendered, **When** the panel computes the preview, **Then** the net is `max(0, price − effective_card_fee − supply_amount)` where `effective_card_fee` is `$3` for mode=default, `custom_cents` for mode=custom, or `$0` for mode=exempt, and `supply_amount` is `supply_amount_cents` when the toggle is on (`$0` when off).
2. **Given** the service is variable-price (`variable_price = true`), **When** the preview computes, **Then** it uses `price_from_cents` (or `$0` if From is unset) as the service price, matching the existing 008 convention for `price_cents`.
3. **Given** the operator changes the price, card-fee mode, custom amount, supply toggle, supply amount, or supply label, **When** the input fires, **Then** the preview recomputes within 100ms with no server round-trip.
4. **Given** the inputs would produce a negative net, **When** the preview renders, **Then** it clamps to `$0` and the breakdown still shows the raw service / deduction lines (so the operator can see why the math went negative).
5. **Given** the card fee is Exempt, **When** the breakdown renders, **Then** the `−$X card fee` line is omitted entirely (not shown as `−$0`).
6. **Given** Supply is off, **When** the breakdown renders, **Then** the supply line is omitted entirely.
7. **Given** the preview is rendered, **When** the operator reads the label, **Then** the headline reads "Net to tech (card)" so it is unambiguous that the figure assumes card payment; cash-only payouts would be higher by the card-fee amount.

---

### User Story 5 — Restrict who can edit deductions, with an audit trail (Priority: P2)

Authorization is unchanged from 008: only owners and managers can mutate any service field, including the new deductions. Technicians and front-desk operators can read the catalog list (deduction chips visible inline) and open the panel to view a service's deductions, but the segmented card-fee control, the supply toggle, the amount/label inputs, and the Save button are all disabled with a tooltip "Only owners and managers can edit the catalog." Every successful deduction mutation writes an `audit_log` row with `action = 'settings.updated'`, `entity = 'service'`, and a payload that names the fields that changed (so post-hoc review can see who turned a service's supply on or moved its card fee from default to exempt).

**Why this priority**: Security floor — must ship before the new fields are reachable in production. Identical authorization shape to 008 means there is little new ground to cover, but the audit-payload contents are extended to include the new fields and the role gate must explicitly cover the new inputs.

**Independent Test**: Log in as a technician → open `/services` → confirm the deduction chips render on every list row (read works), open the panel for a service → confirm the segmented card-fee control, supply toggle, amount input, label input, and Save button are all disabled with the tooltip, and the Net to tech preview still renders (read-only by nature). Log in as a manager → confirm every deduction control is interactive. Mutate a deduction → inspect `audit_log` → confirm a row exists with `entity = 'service'`, `action = 'settings.updated'`, the service id, and a payload listing the changed deduction fields with before/after values.

**Acceptance Scenarios**:

1. **Given** a technician's PIN session, **When** they navigate to `/services`, **Then** the catalog list renders with all deduction chips visible, clicking a row opens the panel in read-only mode (every existing 008 field stays disabled per FR-030 from 008), AND the segmented card-fee control, supply toggle, amount input, and label input are all disabled with the tooltip "Only owners and managers can edit the catalog."
2. **Given** a front-desk operator's PIN session, **When** they navigate to `/services`, **Then** behavior is identical to the technician case.
3. **Given** a non-privileged operator attempts to submit a deduction mutation directly (bypassing the disabled UI), **When** the Server Action runs, **Then** it rejects the request with no mutation and no audit row (same defense-in-depth as 008's FR-031).
4. **Given** an owner / manager edits any deduction field and saves, **When** the audit row is written, **Then** the `payload` includes the changed deduction fields by name (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`) with their before and after values (matching the diff shape already used for the other service fields).
5. **Given** an owner / manager edits ONLY non-deduction fields (e.g. price), **When** the audit row is written, **Then** the deduction fields do not appear in the payload diff (no spurious entries).

---

### Edge Cases

- **Service archived while the panel is open for it.** Archiving (existing 008 action) still works from the panel's footer. The panel stays open on the now-archived service; the list row gains the Archived badge; switching to a different active service via the list works as normal. No new behavior for deductions on archive.
- **Switching card-fee mode without saving.** The draft mode follows the segmented control; the custom-cents input value is preserved on the draft when the user toggles Custom → Default → Custom (so a fat-finger doesn't lose typed input), but on Save the persisted `card_fee_custom_cents` is cleared whenever mode != 'custom'.
- **Toggling Supply off then on again without saving.** Same shape as card fee: the draft remembers the last-typed amount/label so a fat-finger off-toggle doesn't erase typed values until Save. On Save, an off toggle clears both columns regardless of the draft buffer.
- **Pre-existing service with a category not in the seeded list.** No interaction with deductions; existing category behavior from 008 applies unchanged.
- **Variable-price service.** The Net to tech preview uses `price_from_cents` (or $0 if From is unset). The same chip and breakdown render correctly when From is empty (preview shows `$0` net).
- **Concurrent edits to the same service from two browser tabs.** Last-write-wins on the entire service row (same as 008). The deduction columns are part of the same single update; no field-level merge is attempted. The losing tab will see its older draft baseline diverge from the saved values the next time the row is read.
- **Hardcoded $3 default changing in Phase 2.** Out of scope. Today the segmented control's "Default · $3" label reads from a single constant; Phase 2 will replace that constant with a value read from the policy entity. Services with `card_fee_mode = 'default'` will automatically follow the new value without any data migration.
- **Custom card-fee amount entered in a currency notation the operator's locale prefers.** Out of scope. The input accepts plain decimals (`4`, `4.50`, `4.5`) and rejects negative values, matching the existing 008 Price field behavior; on blur the value formats to two decimals.
- **Supply label localization.** Out of scope. Labels are stored as the raw free-text string the operator typed.
- **Deduction display on the read-only panel (technician view).** The chips, segmented control, supply row, and Net to tech preview all render with the saved values — they just aren't interactive.
- **Existing service with `taxable = true` interacting with card fee.** No interaction. Tax computation is still out of scope (008 reserved `taxable` for a future feature).

## Requirements *(mandatory)*

### Functional Requirements

#### Two-pane layout

- **FR-001**: The `/services` page MUST render as a two-pane layout: a left pane containing the existing grouped catalog list (search field, "Show archived" toggle, category groups, rows) and a right pane containing a single always-visible edit panel. On desktop widths the left pane MUST be roughly 440px wide and the right pane MUST take the remaining width; on narrower widths the layout MAY stack vertically (panel below list) without changing the underlying state machine.
- **FR-002**: The right pane MUST replace the existing drawer overlay from feature 008. The drawer component and its backdrop / Escape close behavior MUST be removed from this surface (drawer-style overlays remain valid for unrelated surfaces).
- **FR-003**: When no service is selected and no add-mode draft exists, the right pane MUST show an empty-state panel with an info icon, the headline "Pick a service", and the copy "Select a service on the left to edit, or add a new one."
- **FR-004**: Clicking a list row MUST switch the right pane into edit mode for that service, pre-filled with the saved values. If the panel was already in edit mode or add mode with unsaved changes, the system MUST first show the existing "Discard changes?" confirm dialog (FR-016 from 008); Discard switches the panel; Cancel keeps it on the prior selection.
- **FR-005**: Clicking "Add service" MUST switch the right pane into add mode with a fresh draft using the same defaults the 008 drawer uses (category "Other", duration `30`, color Rose, taxable off, variable price off, deductions per FR-009/FR-013). If the panel had unsaved changes, FR-004's discard-confirm gate MUST fire first.
- **FR-006**: The panel header MUST render a live preview of the draft — color swatch + name + a single secondary line of `{category} · {duration} min · {price label}` — updating on every input change.
- **FR-007**: All existing 008 fields and their existing validations / behaviors (name, category with auto-complete, duration, price, color swatches, taxable, variable price + bounds + note) MUST remain in the panel in the same order and with the same validation rules.
- **FR-008**: The Save / Cancel footer MUST mirror the 008 drawer's footer: "Save service" in add mode, "Save changes" in edit mode, both disabled when the draft matches the baseline or any required field is invalid; a destructive-toned "Archive service" / "Restore service" action MUST appear at the left of the footer in edit mode (hidden in add mode), matching 008's FR-024.

#### Card fee per service

- **FR-009**: Each service MUST carry a `card_fee_mode` value with exactly three allowed values: `default`, `custom`, and `exempt`. New services MUST default to `default`. The database column MUST default to `default` and existing rows MUST be backfilled to `default` on migration.
- **FR-010**: When `card_fee_mode = 'custom'`, the service MUST also carry a non-null `card_fee_custom_cents` (integer ≥ 0). When `card_fee_mode != 'custom'`, `card_fee_custom_cents` MUST be null. The system MUST enforce this via a database CHECK constraint AND in the Server Action's validation layer.
- **FR-011**: The Deductions section of the panel MUST render a three-way segmented control labeled `Default · $3` / `Custom` / `Exempt`. The "$3" in the Default label MUST be sourced from a single named constant (one place to change for Phase 2); other labels are literal.
- **FR-012**: When Custom is selected, the panel MUST render a single `$` amount input beside the segmented control accepting plain decimals (`0`, `4`, `4.50`, `4.5`), formatting to two decimals on blur, rejecting negative values. The input MUST be required and MUST validate to a non-negative number; "Save" MUST be disabled when empty or invalid. An explicit `$0` is allowed (semantic meaning "intentionally zero for this service").
- **FR-013**: When Exempt is selected, the panel MUST render the single-line explanation "Card fee never applies, regardless of payment method." in the muted text tone and MUST hide the custom amount input.
- **FR-014**: When the operator changes the mode (any direction), the draft `card_fee_custom_cents` MUST be preserved in memory so a fat-finger toggle does not erase typed input; on Save, the persisted `card_fee_custom_cents` MUST be cleared (set to null) whenever the saved `card_fee_mode != 'custom'`.
- **FR-015**: The catalog list row MUST display a card-fee chip when `card_fee_mode = 'default'` (blue tone, reading "$3 card fee" using the same constant as the segmented control) or `card_fee_mode = 'custom'` (blue tone, reading "${amount} card fee" using the service's `card_fee_custom_cents`). When `card_fee_mode = 'exempt'`, no card-fee chip MUST appear on the row.

#### Supply deduction per service

- **FR-016**: Each service MUST optionally carry a supply deduction described by two columns: `supply_amount_cents` (integer ≥ 0, nullable) and `supply_label` (text, nullable). The two MUST be both null or both non-null. The system MUST enforce this via a database CHECK constraint AND in the Server Action's validation layer.
- **FR-017**: The Deductions section MUST render a Supply row with a toggle, a `$` amount input, and a label input. When the toggle is off, the amount and label inputs MUST NOT be rendered. When the toggle is on, both MUST be rendered side by side with the amount input narrower (around 100px) and the label input filling the remaining width.
- **FR-018**: When the operator flips the toggle from off to on, the amount input MUST appear pre-filled with a starting value of `$5.00` (a reasonable mid-range default to nudge the operator toward a plausible amount, matching the design's seeded draft); the label input MUST appear empty with the placeholder "e.g. GelX tips & gel, Chrome powder, OPI bottle wear"; focus MUST move to the label input.
- **FR-019**: When Supply is on, both inputs MUST be required: `supply_amount_cents > 0` (positive non-zero), `supply_label` non-empty (≥ 1 character after trim). Inline validation hints MUST guide the operator: "Enter a non-negative amount, or turn Supply off" for the amount; "Add a short label so staff know what this covers, or turn Supply off" for the label. "Save" MUST be disabled until both are valid.
- **FR-020**: The label MUST be at most 64 characters after trim. The system MUST show a live character count when within 8 characters of the limit and MUST reject longer values in both the Server Action and the database CHECK constraint.
- **FR-021**: When the operator flips Supply off (any direction; on→off→on→off), the draft amount/label MUST be preserved in memory so a fat-finger toggle does not erase typed input; on Save, the persisted `supply_amount_cents` and `supply_label` MUST be cleared (both set to null) whenever the saved Supply state is off.
- **FR-022**: The catalog list row MUST display a supply chip when the service has a supply deduction (amber tone, reading "${amount} {label}" — amount in tabular numerals, label after a single space in a slightly muted weight). When the service has no supply deduction, no supply chip MUST appear.

#### Combined deduction display on list rows

- **FR-023**: When a list row has both a card-fee chip and a supply chip, the row MUST render them in this order: card-fee first (blue), supply second (amber), separated by a 6px gap, in the same horizontal band as the duration / price information.
- **FR-024**: When a list row has `card_fee_mode = 'exempt'` AND no supply deduction, the row MUST render a single muted "No fees" chip in the deductions slot to signal that the operator intentionally exempted this service from all deductions.

#### Net to tech preview

- **FR-025**: The Deductions section MUST render a "Net to tech (card)" preview at the bottom: a large tabular-numeral amount and a small right-aligned breakdown showing the service price minus each active deduction line. The headline MUST be exactly "Net to tech (card)" so the operator unambiguously understands the figure assumes card payment.
- **FR-026**: The preview's net MUST equal `max(0, service_price_cents − effective_card_fee_cents − supply_amount_cents_or_zero)` where `effective_card_fee_cents` is the hardcoded `$3` constant when mode=default, the service's `card_fee_custom_cents` when mode=custom, or `0` when mode=exempt; `supply_amount_cents_or_zero` is `supply_amount_cents` when Supply is on or `0` when off. `service_price_cents` is `price_cents` for fixed-price services and `price_from_cents` (or `0` if From is unset) for variable-price services.
- **FR-027**: The breakdown MUST show one line per non-zero contributor: always "{price} service"; "−{fee} card fee" only when card fee mode != exempt AND effective fee > $0; "−{amount} {label or 'supply'}" only when Supply is on. The omission rule MUST hide lines entirely (not show "−$0").
- **FR-028**: The preview MUST update locally within 100ms of any draft change (no server round-trip).

#### Authorization and audit

- **FR-029**: Authorization on deduction writes MUST match the existing 008 rule (FR-030, FR-031): only operators whose `staff.role` (for the current `acting_as_staff_id`) is `owner` or `manager` MAY mutate any field on a service, including the four new deduction columns. Non-privileged operators MUST see the segmented control, the supply toggle, the amount/label inputs, and the Save button disabled with the existing tooltip "Only owners and managers can edit the catalog." The Server Action MUST re-verify the role on every invocation and reject requests from non-privileged operators with no mutation and no audit row.
- **FR-030**: Every successful service mutation MUST write an `audit_log` row with the existing fields (`action = 'settings.updated'`, `entity = 'service'`, entity id, device user, operating staff). The payload diff MUST extend the existing field set to include the four new deduction columns (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`) so post-hoc review can see who changed a service's deductions and from / to what values. Deduction fields MUST appear in the payload only when they actually changed in this save (no spurious diff entries).

#### Migration

- **FR-031**: The migration delivered with this feature MUST add four columns to the existing `services` table: `card_fee_mode` (enum / text with CHECK constraint allowing exactly `default`, `custom`, `exempt`; non-null; default `default`), `card_fee_custom_cents` (integer, nullable), `supply_amount_cents` (integer, nullable), `supply_label` (text, nullable, max-length 64 enforced via CHECK). Two table-level CHECK constraints MUST be added: (a) `card_fee_custom_cents IS NOT NULL` iff `card_fee_mode = 'custom'`; (b) `supply_amount_cents` and `supply_label` are both null or both non-null AND when non-null `supply_amount_cents > 0` AND `length(trim(supply_label)) >= 1`.
- **FR-032**: Existing service rows MUST be backfilled by the migration to `card_fee_mode = 'default'` (using the column default), `card_fee_custom_cents = NULL`, `supply_amount_cents = NULL`, `supply_label = NULL`. No data loss to existing rows. The migration MUST be applied via the existing GitHub Actions migration workflow (`db-migrate-preview.yml` on PR; `db-migrate-prod.yml` on push to main) — never run by hand against hosted projects.
- **FR-033**: Row-level security policies on `services` MUST remain unchanged (every authenticated user reads all rows; the kiosk JWT has no access; writes go via the Server Action, not direct RLS-policed inserts).

#### Reuse and design fidelity

- **FR-034**: This feature MUST extend the existing 008 primitives — the list row, the form fields, the validators in `_validation.ts`, and the Server Action in `actions.ts` — rather than replace them. The two-pane shell, the Deductions section, the chips, the segmented control, and the supply row MUST be additive components.
- **FR-035**: All visual treatments (the chip tones blue / amber / muted, the segmented control's selected-pill shadow, the panel's card surface and border, the Net to tech preview's typography hierarchy, the color swatches) MUST trace to Lacquer tokens with no raw hex, no off-scale spacing, no custom font weight, no emoji in chrome. The reference is `design-system/ServicesV1.jsx` and `design-system/Services Page.html` (the V1 variation only).
- **FR-036**: All numeric values rendered on this page (durations, prices, fee amounts, supply amounts, net amount) MUST use tabular numerals. Currency display MUST follow the Lacquer convention: whole dollars as `$5`, non-whole as `$4.50`, never `$5.00` for a whole dollar.

### Key Entities

- **Service (extended)** — the existing entity from 008 gains four new attributes: `card_fee_mode` (one of `default`, `custom`, `exempt`; non-null with default `default`); `card_fee_custom_cents` (nullable integer ≥ 0, required only when mode is `custom`); `supply_amount_cents` (nullable integer > 0, required iff `supply_label` is set); `supply_label` (nullable text, ≤ 64 chars, required iff `supply_amount_cents` is set). All other 008 attributes are unchanged.
- **Audit entry (extended)** — the existing `audit_log` schema is unchanged; the payload shape for `action = 'settings.updated'` on a service is extended to include the four new fields when they change.
- **Card-fee default (constant)** — a single named constant in this phase holding the value `$3` (i.e. `300` cents). Referenced by the segmented control's label, the catalog row's default chip text, and the Net to tech preview's calculation. Phase 2 will replace this constant with a value read from a global policy entity; no service row migration will be required at that time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can change a service's card-fee mode (any of the three options) and persist the change in **under 10 seconds** from clicking the list row.
- **SC-002**: An owner can add a supply deduction to a service (toggle on, type amount, type label, save) in **under 20 seconds** from clicking the list row.
- **SC-003**: After the migration runs, **100%** of existing services display a "$3 card fee" chip on their list row by default; **0%** display a supply chip; **0%** display a "No fees" chip.
- **SC-004**: The Net to tech preview updates within **100ms** of any draft change on a typical staff laptop.
- **SC-005**: **100%** of deduction mutations write a corresponding `audit_log` row with `action = 'settings.updated'`, the entity id, the device user, the operating staff, and a payload listing the deduction fields that changed.
- **SC-006**: **0%** of catalog edits cause regression in historical `appointment_services` or `ticket_items` rows — deduction columns are added only to the live `services` row and are not snapshotted onto historical records in this phase (snapshotting is Phase 3).
- **SC-007**: All page surfaces (two-pane shell, list row chips, panel Deductions section, segmented control, supply row, Net to tech preview) pass the Lacquer design check side-by-side against `design-system/ServicesV1.jsx` before the feature is marked complete (per `CLAUDE.md` § "When you change UI").
- **SC-008**: Pre-push gate parity — `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:e2e` all pass green locally before any PR opens (per the project's Pre-push Quality Gates).
- **SC-009**: The two-pane layout never overlays the catalog list — at no point during normal use does the operator lose sight of the list while editing a service. (Verifiable by inspecting the rendered DOM: no fixed-position overlay, no backdrop, no body-scroll lock for the edit panel.)

## Assumptions

- The default card-fee amount is hardcoded to **$3 (300 cents)** in this phase via a single named constant. Phase 2 will replace that constant with a value read from a global card-fee policy entity. Services with `card_fee_mode = 'default'` will automatically follow the new value at that time without any data migration. The constant lives in code, not in the database.
- "Card fee" applies semantically when the service is paid by **card or gift card**; "supply deduction" applies regardless of payment method. This phase **does not enforce** those rules at checkout — neither value is read by `app/(studio)/cash-sale`, `tests/e2e/cash-sale*.spec.ts`, or any payouts/receipts surface. The semantic definitions live in this spec and in the panel's microcopy so Phase 3 has a clear contract.
- The deduction columns are added to the live `services` row only. They are **not snapshotted** onto `appointment_services` or `ticket_items` in this phase. Phase 3 will add snapshot columns to those tables so historical payout calculations remain stable when an owner later changes a service's deductions.
- "Net to tech (card)" assumes card payment because that is the worst case for the tech. The label is explicit so the operator does not assume the figure matches cash payouts.
- Existing 008 surfaces continue to use the drawer pattern where appropriate (this feature only replaces it on `/services`). The drawer component itself is not removed from the codebase.
- The four new columns are part of the same single `UPDATE` / `INSERT` the existing Server Action issues — no separate transaction, no separate audit row.
- Per-tech staff assignments remain deferred per the 2026-05-16 amendment to feature 008. This feature does not reinstate them and does not add deductions per tech (a service's supply / card fee is a property of the service, not of the service-tech pair).
- Realtime sync is not required for `services` mutations (matches 008). Concurrent edits use last-write-wins; the four new columns are part of the single row updated.
- The supply-on default amount of `$5.00` is a UI seed only — it has no special meaning in the data layer and is overridable on every save.
- The "$3" default in the segmented control's "Default · $3" label and the catalog row's "$3 card fee" chip both read from the same named constant, so a change to the constant flows to both surfaces in one edit.
- Out-of-scope items the spec explicitly does **not** cover, repeated here to keep future readers from rediscovering them:
  - The global card-fee **policy entity**, the **policy strip** above the list (showing default amount + exempt-tech list), and the **Edit Policy sheet** (`design-system/EditPolicySheet.jsx`) — all reserved for Phase 2.
  - Wiring deductions into **checkout**, **receipts**, **end-of-day cash counts**, and **payouts** — all reserved for Phase 3 (with the snapshot-column migration noted above).
  - **Pedi-tier deductions** from the Day Report prototype — out of scope; a different deduction shape entirely.
  - The **V2 payout-first table** (`ServicesV2.jsx`) — a comparison fork, not a candidate for this phase.
  - **Per-tech staff assignments** — remain deferred per 008's 2026-05-16 amendment.
