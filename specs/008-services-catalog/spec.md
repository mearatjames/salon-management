# Feature Specification: Services catalog (top-level /services)

**Feature Branch**: `008-services-catalog`

**Created**: 2026-05-15

**Status**: Draft (with 2026-05-16 scope amendment — see below)

## Scope amendment — 2026-05-16

Per-tech service assignment is deferred to a later phase for MVP. The
**data model and Server Action payload are unchanged** — `services` +
`staff_services` tables, the `assignment_count` field on `CatalogService`,
the `ServiceAssignment` type, and the `staff_ids[]` / `override_min[*]`
FormData inputs all still exist and existing assignments are preserved on
edit. What was **removed from the UI surface and the toast flow**:

- **Catalog list** — the "{N} techs" / "No techs" pill on each row
  (FR-002 trailing clause, FR-009).
- **Add / Edit drawer** — the entire "Who can perform this service?"
  section (FR-011 trailing clause, FR-012), assignment hydration on Edit
  (FR-017 trailing clause), the assignment-diff contribution to `isDirty`
  / "Save changes" enabling (FR-019, FR-020 trailing clauses), assignment
  add / remove on save (FR-021, FR-022), and the read-only operator
  gating of assignment controls (FR-030 trailing clause).
- **Toast flow** — the `&secondary=no_techs_assigned` redirect param +
  companion warning toast (FR-015, FR-036 second sentence).
- **User Story 3** — every Edit-flow scenario beyond the simple
  scalar/colour/variable-price fields is paused. The "Edit a service's
  details" wording in US3's title still applies; "and per-tech
  assignments" does not.
- **Success Criteria SC-001** — the "tick the techs who perform it" step
  is dropped from the 60-second add-a-service workflow.

**Still in scope for MVP**: US1, US2 (happy path minus the assignment
list), US4, US5, US6 (minus assignment-checkbox assertions), US7 (minus
the secondary-warning case).

**Tests** — `tests/e2e/services.spec.ts` has US3 (entire describe), US2
(b), and US7 (c) marked `test.skip`; US1 (a), US2 (a), US6 (b), and US7
(a) had assignment-specific assertions stripped. Unit suite unaffected
(the `_diff` helper and its tests stay valid, dormant until the UI
returns). `quickstart.md` walkthrough steps 2-5 reference the removed
assignment UI and should be skipped until reinstatement.

**Reinstatement checklist**: un-skip the e2e blocks, restore the tech-pill
and assignment assertions in the four edited tests, re-add the
`secondarySuffix` param in `app/(studio)/services/actions.ts`, re-import
+ render `<StaffAssignmentList>` in
`components/lacquer/services/drawer.client.tsx`, and re-pass
`assignableStaff` from the page.

**Input**: User description: "Build the Services catalog management surface as a top-level studio destination reachable from the existing sidebar nav (the `services` placeholder item shipped in feature 007). What it does: lets an owner/manager add, edit, archive, and re-order the services the salon sells (e.g. Gel polish, Classic manicure, Nail art). Each service has a name, default duration (minutes), default price (cents), a category, a Lacquer color token, an `active` flag, and a `taxable` flag (reserved for future tax computation — no UI effect in v1). A service can be flagged 'variable price' with optional `price_from` / `price_to` bounds and a note shown in the variable-price sheet later. Also captures per-tech duration overrides (`staff_services` join table): in the service edit view, pick which staff can perform this service and optionally set a per-tech duration that overrides the default. Entry point: `/services` (top-level studio route; the sidebar nav item is wired to it). Reuse: the existing staff management UI patterns at `app/(studio)/settings/staff` as a template for list + drawer pattern and audit-log writes. DB: new `services` table and `staff_services` join (per the data model in `docs/system-design.md`). Migration is part of this phase. Authorization: only owner/manager can write; technicians/front_desk can read. Privileged writes go through a Server Action that checks `staff.role` for the current `acting_as_staff_id` and writes an `audit_log` row with `action='settings.updated'`. Out of scope: Square catalog sync, tax computation, service photos, drag-drop reorder."

This feature ships the **Services catalog** surface for Tang Nails Studio, reached from the sidebar's existing `services` nav item (Sparkles icon, currently a disabled placeholder). It lets an owner (or manager) maintain the salon's service catalog — the list of things customers can book and pay for (Gel polish, Classic manicure, Nail art, etc.) — and decide which technicians perform each one and how long each tech takes. The page lives at `/services` (top-level studio destination), not under Settings; the sidebar's `services` entry is changed from disabled placeholder to a wired link as part of this feature.

## Clarifications

### Session 2026-05-15

- Q: When a service is flagged variable-price, what value lives in `services.price_cents`? → A: `price_cents` stays non-null and stores `price_from_cents` (or 0 if From is unset). The `variable_price` flag is the only signal downstream consumers need to opt into the "show a range" UI; snapshot columns on `appointment_services` and `ticket_items` still record the actual charged amount at checkout.
- Q: Should the catalog also support variable duration (parallel to variable price)? → A: No — duration is a single fixed default for v1, treated as the "typical" estimate even for variable-price services. Variable duration is a follow-up; the calendar uses the default to size slots and per-tech overrides remain a single number.
- Q: Should `category` be required at create time? → A: Required, pre-seeded with `Other` on a new service so first-run users can save immediately without picking a taxonomy. Owners can rename or replace the default at any time. The list view always groups under a non-null category header.
- Q: After a successful Add save, should the drawer close or flip to Edit mode for the just-created service? → A: Flip to Edit mode (mirrors the Edit save pattern from FR-020). The title changes to "Edit service", "Save changes" disables, the archive action appears, and the success toast still confirms the save. Add and Edit now share one post-save mental model.
- Q: Should the services catalog use the staff feature's "Deactivate / Reactivate" verbs or its own "Archive / Restore" verbs? → A: Keep "Archive / Restore" for catalog items. The verbs match the domain (POS/catalog idiom: archive items, deactivate people), even though both operations flip the same underlying `active` column. No copy change needed; the divergence from the staff feature is intentional.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — See the service catalog at a glance (Priority: P1)

The owner opens the Services catalog from the sidebar and immediately sees every service the salon sells: name, category, default duration, default price (or price range for variable-price services), a swatch showing the Lacquer color token, the count of techs who can perform it, and whether it's active. Services are grouped by category (alphabetical), with services sorted alphabetically inside each group. A search field filters by name. A "Show archived" toggle controls whether inactive services appear. A summary line above the list shows "X active · Y total."

**Why this priority**: Without a readable catalog, none of the other actions can be performed safely — an admin needs to find the right service before they can edit it, archive it, or change who performs it. This is also the entry point that every other story branches from.

**Independent Test**: Seed the database with at least 5 services across 2 categories (one archived). Click the Services item in the sidebar, confirm the list groups by category, the active/total summary is correct, each row shows a color swatch + duration + price + tech-count, the search filter narrows the rows by name, and the "Show archived" toggle hides/shows the archived service.

**Acceptance Scenarios**:

1. **Given** the salon has 6 services across categories "Manicure" and "Pedicure" (one Manicure service archived), **When** the owner opens the Services catalog from the sidebar with "Show archived" off, **Then** 5 rows appear in 2 category groups (Manicure first alphabetically), each row shows a color swatch + name + duration in minutes + price (or "From $X" for variable price) + a "{N} techs" pill, and the summary reads "5 active · 6 total".
2. **Given** the same catalog, **When** the owner toggles "Show archived" on, **Then** all 6 rows appear, the archived row is visibly muted with an "Archived" badge, and the summary still reads "5 active · 6 total".
3. **Given** the same catalog, **When** the owner types "gel" into the search field, **Then** only rows whose names contain "gel" (case-insensitive) remain visible across all category groups; empty groups are hidden.
4. **Given** a service has no techs assigned, **When** the row renders, **Then** the tech-count pill reads "No techs" in a warning tone (amber dot).
5. **Given** the search returns no rows, **When** the list renders, **Then** the page shows the empty message "No services match your search."
6. **Given** the catalog is empty (first-run salon), **When** the page first renders, **Then** the list area shows an empty state with a Sparkles icon, the copy "Add your first service to start booking appointments," and a primary "Add service" button.

---

### User Story 2 — Add a new service (Priority: P1)

The owner clicks "Add service" and a right-side drawer opens with the new-service form: display name, category (with auto-complete from existing categories), default duration in minutes, default price in dollars, a Lacquer color swatch picker (8 swatches), a "taxable" toggle (default off), and a "Variable price" toggle that — when on — reveals optional `From` and `To` bounds plus a short free-text note. Below the basics is a "Who can perform this service?" section listing every active staff member with a checkbox and an optional per-tech duration override field. Saving writes the service and the chosen staff assignments atomically.

**Why this priority**: Adding services is what unlocks every downstream booking and POS flow — appointments, walk-ins, and checkout all read from the services catalog. Without it, the salon can't sell anything in v1.

**Independent Test**: From an empty or pre-populated catalog, click "Add service", fill in name + duration + price + category, pick a color and at least one staff member, click Save; confirm a toast announces the addition, the drawer closes, the new row appears in the list under the right category group, and the tech-count pill reflects the chosen staff count.

**Acceptance Scenarios**:

1. **Given** the Add drawer is closed, **When** the owner clicks "Add service", **Then** a right-side drawer slides in with the title "Add service", a primary "Save service" button (disabled), and an empty form with default category "Other", default duration "30", default color "Rose", taxable off, variable price off, and no staff selected.
2. **Given** the Add drawer is open, **When** the owner types "Gel" in the category field, **Then** an auto-complete dropdown lists every existing category whose name starts with "Gel" (case-insensitive), plus a "+ Create 'Gel'" option at the bottom if no exact match exists.
3. **Given** the form has name "Gel polish", category "Manicure", duration `45`, price `35.00`, color Rose, and 2 staff selected, **When** the owner clicks "Save service", **Then** the drawer's title flips to "Edit service", the primary button becomes "Save changes" (disabled, since the baseline now matches the saved values), the "Archive service" action appears at the bottom, a toast reads "Gel polish added to the catalog", and the new row appears in the list under "Manicure" with the chosen color, "45 min", "$35", and "2 techs".
4. **Given** the "Variable price" toggle is on, **When** the form renders, **Then** the single Price field is replaced by two side-by-side fields labeled "From" and "To" (both optional) and a single-line note field with the placeholder "Tell staff when to use this — e.g. depends on nail length", and the list-row preview uses "From $X" if only From is set, "$X – $Y" if both are set, or "Variable" if neither is set.
5. **Given** the display name is empty, the duration is not a positive integer, or the price (when variable-price is off) is not a non-negative decimal, **When** the owner views the form, **Then** the "Save service" button is disabled and the offending fields show inline validation hints.
6. **Given** the form has no staff selected in the "Who can perform this service?" list, **When** the owner clicks "Save service", **Then** the service still saves (no staff is allowed) but a single secondary toast appears alongside the success toast: "Nobody can perform this service yet. Add techs from the edit drawer."
7. **Given** the owner clicks the backdrop, presses Escape, or clicks "Cancel" with unsaved changes, **When** the close gesture fires, **Then** a confirm dialog reads "Discard changes?" with Cancel / Discard buttons; Discard closes the drawer with no save.

---

### User Story 3 — Edit a service's details and per-tech assignments (Priority: P1)

The owner clicks a row in the catalog list; the same drawer used for Add opens in Edit mode, pre-populated with the service's saved values. Every field is editable — name, category, duration, price, color, taxable, variable-price bounds and note, and the staff assignment list (with per-tech duration overrides). The header reads "Edit service" and shows a live preview of the row (color swatch + name + category + price/duration) that updates as the user types. Changes are draft-only until "Save changes" is pressed; the button is enabled only when the form actually differs from the saved state. After save, the drawer stays open, the row in the list updates in place, and a toast confirms "Changes saved."

**Why this priority**: Service durations and prices change as the salon evolves (a new gel system shortens a manicure by 5 min; a price increase; a tech learns nail art). Without an in-product editor, the owner has to fall back on database access for every tweak.

**Independent Test**: Click a row, change one or more fields (e.g. raise the price, swap the color, toggle a tech on/off, set a per-tech duration override), confirm the Save button enables, click Save; confirm the row updates and a toast appears. Open the same row again and confirm the new values are persisted.

**Acceptance Scenarios**:

1. **Given** no row is selected, **When** the page first renders, **Then** the page shows the catalog list and the drawer is closed.
2. **Given** the owner clicks a service row, **When** the drawer opens, **Then** the title reads "Edit service", every field is pre-filled with the service's current values, the staff-assignment list reflects who currently performs it (with each per-tech override shown in the per-tech duration input), and "Save changes" is disabled.
3. **Given** the drawer is open with the service's saved values, **When** the owner changes the price to `40.00`, **Then** the live header preview updates immediately, the list row in the background still shows the old price until save, and "Save changes" enables.
4. **Given** the drawer is open, **When** the owner ticks a previously-unassigned tech and types `60` in that tech's per-tech duration field, **Then** "Save changes" enables, and on save the staff is added to `staff_services` with `duration_min_override = 60`.
5. **Given** the drawer is open, **When** the owner unticks a previously-assigned tech, **Then** on save that staff's row is removed from `staff_services` for this service (their per-tech override is forgotten); they can be re-added later but will not retain the prior override.
6. **Given** a tech is ticked but their per-tech duration field is empty, **When** the owner saves, **Then** that staff's row is written with `duration_min_override = null` so the service's default duration applies to bookings with that tech.
7. **Given** "Variable price" is on and the saved service had bounds `$30` – `$50`, **When** the owner toggles "Variable price" off, **Then** the bounds and note are hidden, the Price field re-appears empty, and "Save changes" is disabled until a valid Price is entered.
8. **Given** the owner closes the drawer with unsaved changes, **When** they click the backdrop / Escape / Cancel, **Then** the "Discard changes?" confirm dialog appears (same behavior as Add); confirming Discard closes the drawer with no save.
9. **Given** the owner saves successfully, **When** the response returns, **Then** the drawer stays open, the form's "saved" baseline matches the new values (Save disables again), the list row in the background re-renders with the new values, and a toast reads "Changes saved".

---

### User Story 4 — Archive or restore a service (Priority: P2)

From the edit drawer, the owner has an "Archive service" action at the bottom (and a "Restore service" action when the service is already archived). Archiving requires a confirmation dialog that names the service and explains the consequence — archived services stop appearing in booking and POS pickers and on the catalog list (unless "Show archived" is on), but historical appointments and tickets that reference the service remain intact. Restoring an archived service brings it back to the list and to every picker.

**Why this priority**: Service mix changes seasonally and as the salon experiments. Lower priority than CRUD only because in a fresh salon the first month is mostly adds and edits; archive can ship a week later without blocking launch.

**Independent Test**: Select an active service, click "Archive service", confirm the dialog copy mentions the service name and the history-preservation note, confirm; the row gains the Archived badge (visible only when "Show archived" is on). Select an archived service, click "Restore service"; the badge clears and the row returns to the default view.

**Acceptance Scenarios**:

1. **Given** an active service is selected in the edit drawer, **When** the owner clicks "Archive service", **Then** a confirmation dialog appears with a destructive icon, the title "Archive {name}?", body copy explaining "{name} won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time," and Cancel + Archive buttons.
2. **Given** the archive dialog is open, **When** the owner clicks Cancel or the backdrop, **Then** the dialog closes with no state change.
3. **Given** the archive dialog is open, **When** the owner clicks Archive, **Then** the service's `active` flag is set to false, the drawer's bottom action flips to "Restore service", a toast reads "{name} archived", the list row hides (or becomes muted with an Archived badge if "Show archived" is on), and the summary count updates.
4. **Given** an archived service is selected and "Show archived" is on, **When** the owner clicks "Restore service" in the drawer, **Then** no dialog appears (restore is non-destructive), `active` flips to true, a toast reads "{name} restored", and the row returns to the default (un-archived) view.
5. **Given** the archived service had per-tech assignments, **When** it is restored, **Then** those assignments are preserved (the `staff_services` rows are never deleted by archive/restore).

---

### User Story 5 — Variable-price services with bounds and a note (Priority: P2)

The owner needs to support services whose price depends on something the staff sees in person (nail length, design complexity). For these services, the price field becomes a non-blocking "Variable" placeholder with optional `From` and `To` bounds and a short free-text note. In the catalog list, variable-price rows show "From $X", "$X – $Y", or just "Variable" depending on which bounds are set. The bounds and note are stored for a later phase that will surface them in the checkout variable-price sheet; in this phase, the only consumer is the catalog list display itself.

**Why this priority**: Nail art and add-ons are typically variable-price in real salons; without this affordance the catalog can't represent half the services the salon sells. Tied with archive for priority — needed before opening doors but not blocking the first day of internal testing.

**Independent Test**: Add a new service with "Variable price" on, leave both bounds and note empty → save → list row reads "Variable". Edit that service, set From `$20` only → save → list row reads "From $20". Set To `$60` as well → save → list row reads "$20 – $60". Add a note → save → no visible change in this phase (note display is deferred to a later checkout sheet).

**Acceptance Scenarios**:

1. **Given** the Add or Edit drawer is open with "Variable price" off, **When** the owner toggles it on, **Then** the single Price field is replaced by two side-by-side fields labeled "From" and "To" (both optional, both accepting non-negative decimals) and a single-line note field below them with the placeholder "Tell staff when to use this — e.g. depends on nail length".
2. **Given** "Variable price" is on and the owner enters a From greater than the To, **When** the form validates, **Then** the To field shows an inline error "Must be at least the From price" and "Save changes" is disabled.
3. **Given** "Variable price" is on and both bounds are empty, **When** the owner saves, **Then** the service is persisted with `price_cents = 0`, `price_from_cents = null`, `price_to_cents = null`, `variable_price = true`, and the list row reads "Variable".
4. **Given** "Variable price" is on and only `From` is set, **When** the list row renders, **Then** it reads "From $X" using the From value.
5. **Given** "Variable price" is on and both bounds are set, **When** the list row renders, **Then** it reads "$X – $Y" with both bounds.
6. **Given** the owner toggles "Variable price" off after the service was variable, **When** they save, **Then** `variable_price` is set to false, the bounds and note are cleared (set to null), and the new fixed `price_cents` is persisted.

---

### User Story 6 — Restrict who can manage the catalog (Priority: P2)

Only owners and managers can mutate the services catalog; technicians and front-desk staff can read the page (it's useful reference) but every write control — the Add button, every form field, the staff-assignment list, the archive/restore action — is disabled with a tooltip explaining "Only owners and managers can edit the catalog." Server Actions independently re-verify the operator's role on every invocation. Every mutation writes an `audit_log` row with `action = 'settings.updated'`, the operating staff, and the entity reference.

**Why this priority**: Security floor — must ship before the page is reachable in production. Lower priority than P1 only because the page can be developed and demoed against an owner-only seed; the role gate must be wired in before merge.

**Independent Test**: Log in as a technician → navigate to `/services` → confirm the page renders read-only (the list is visible; the Add button and every drawer mutation are disabled with the tooltip). Log in as a manager → confirm every mutation works. Inspect `audit_log` after any mutation; confirm the row exists with the expected `action`, `acting_as_staff_id`, and entity reference.

**Acceptance Scenarios**:

1. **Given** a technician's PIN session, **When** they navigate to `/services`, **Then** the page renders the catalog list (read-only), the "Add service" button is disabled with a tooltip "Only owners and managers can edit the catalog," and clicking a row opens the drawer in a read-only state where every input, toggle, color swatch, staff-assignment checkbox, and per-tech duration field is disabled and the primary action shows "View only".
2. **Given** a front-desk operator's PIN session, **When** they navigate to `/services`, **Then** behavior is identical to the technician case.
3. **Given** an owner's or manager's PIN session, **When** they perform any mutation (add, edit, archive, restore), **Then** the change commits immediately and an `audit_log` row is written with `action = 'settings.updated'`, `entity = 'service'`, `entity_id = {service.id}`, `acting_as_staff_id = {operator.id}`, and a `payload` describing the change (created fields, diff of edited fields, or `{archived: true}` / `{restored: true}`).
4. **Given** a non-privileged operator attempts a Server Action mutation directly (bypassing the disabled UI), **When** the Server Action runs, **Then** it rejects the request with no mutation and no audit row.
5. **Given** any mutation is committed, **When** the audit log is inspected, **Then** the row records both the device user and the operating staff.

---

### User Story 7 — Get clear feedback after every action (Priority: P3)

Every mutation (add, edit, archive, restore) shows a single-line confirmation toast at the bottom of the screen for ~3 seconds. The toast wording matches the action and uses the service name where it adds clarity. The page never shows a stale list — after a successful save the list reflects the new state immediately.

**Why this priority**: Polish that nudges trust ("did that go through?") without blocking core use. Easy to add after Stories 1–6.

**Independent Test**: Perform each mutation in sequence and confirm a toast appears for each with the correct copy.

**Acceptance Scenarios**:

1. After a successful add: toast reads "{name} added to the catalog".
2. After a successful edit: toast reads "Changes saved".
3. After a successful archive: toast reads "{name} archived".
4. After a successful restore: toast reads "{name} restored".
5. **Given** two toasts fire in quick succession, **When** the second fires, **Then** the first dismisses (no stacking) and the second shows for its full duration.

---

### Edge Cases

- **Renaming or re-pricing a service with appointment history.** Allowed without restriction. Historical `appointment_services` and `ticket_items` rows already snapshot the service's price and duration at booking/checkout time, so editing the catalog row never rewrites past records.
- **Archiving a service referenced by a future appointment.** Allowed without restriction in v1 (no appointments feature yet); the archive dialog does not surface a future-appointment count. When the appointments feature ships later, it will add the count to this dialog (same pattern the staff feature deferred for upcoming appointments).
- **Archiving a service that's the only thing a tech can perform.** Allowed; no warning. The tech's `staff_services` row to this service is preserved through the archive.
- **Last active service.** No special restriction — the salon can archive its last service if it wants (it can also start empty). The catalog list shows its empty state when no active services remain.
- **Duplicate service names.** Allowed without a warning; categories disambiguate ("Polish change" can exist under both Manicure and Pedicure).
- **Service with zero assigned techs.** Allowed at save time (with the secondary "Nobody can perform this service yet" toast). The row's tech-count pill reads "No techs" in an amber warning tone so it's easy to spot from the list.
- **Per-tech duration override of 0 or negative.** Inline validation requires a positive integer; the field's hint text reads "Minutes — leave empty to use the default."
- **Concurrent edits.** Last-write-wins on the service row; if two admins edit the same service in different browser tabs, the second save replaces the first. Realtime invalidation is not required for this surface in v1 (consistent with the staff page).
- **Currency input formatting.** The price field accepts plain decimals (`35`, `35.00`, `35.5`) and rejects negative values; on blur the value formats to two decimals. Internally the value is stored as integer cents.
- **Color swatch reuse.** Two services may share a color token; no warning. Color is decorative on the catalog and calendar surfaces, not an identifier.
- **Archived service in the staff-assignment list.** When editing a service, the staff-assignment list shows only active staff. When editing a staff member (separate feature), the staff edit drawer's "What can this staff perform?" view will likewise show only active services. Archived entities never appear in cross-references.
- **Variable price toggled mid-edit.** Switching `Variable price` on/off clears the now-irrelevant fields (single price, or bounds + note) so the user can't accidentally save stale data; "Save changes" stays disabled until the now-required fields are valid.
- **Variable-duration services.** Not supported in v1. Services whose real-world duration varies widely (e.g. nail art) MUST set their default duration to a "typical" estimate — the calendar uses this to size the booking slot and per-tech overrides remain a single number. If runtime experience shows the estimate is too noisy, a follow-up feature will add optional `duration_min_from` / `duration_min_to` bounds and adjust per-tech overrides accordingly.
- **Category renames.** Out of scope. There is no "manage categories" surface in v1 — categories are derived from `services.category` strings. Renaming category "Manicure" to "Manicures" today requires editing each service individually (and the orphaned "Manicure" group disappears once the last service moves away).

## Requirements *(mandatory)*

### Functional Requirements

#### Catalog list view
- **FR-001**: System MUST display every service the operator can read in a single grouped list, with one section per distinct `category` value (sections sorted alphabetically) and services sorted alphabetically within each section.
- **FR-002**: Each list row MUST show, in order: a color swatch (the service's Lacquer color token), display name, default duration (e.g. "45 min"), default price (or "From $X" / "$X – $Y" / "Variable" for variable-price services), and a "{N} techs" pill reflecting the count of active staff assigned via `staff_services`.
- **FR-003**: System MUST show a summary above the list reading "{X} active · {Y} total" where Y includes archived services.
- **FR-004**: System MUST provide a free-text search field that filters rows by case-insensitive substring match on display name; empty category groups MUST be hidden when search yields no rows for them.
- **FR-005**: System MUST provide a "Show archived" toggle that hides or shows services where `active = false`; the toggle's state MUST persist for the session.
- **FR-006**: When the search returns no matches, the list MUST show the empty message "No services match your search."
- **FR-007**: When the catalog has zero services (active or archived), the page MUST show an empty state with a Sparkles icon, copy "Add your first service to start booking appointments," and a primary "Add service" call-to-action.
- **FR-008**: Archived rows (visible only when "Show archived" is on) MUST be visually muted (reduced opacity) and labeled with an "Archived" badge.
- **FR-009**: A row whose assigned-tech count is zero MUST show the "No techs" pill in a warning tone (amber dot) regardless of active status.

#### Add service
- **FR-010**: A primary "Add service" button above the list MUST open a right-side drawer for creating a new service.
- **FR-011**: The Add drawer MUST collect, in this order: display name (required, ≥2 characters after trim), category (free-text with auto-complete from existing distinct `services.category` values; required, ≥1 character after trim; pre-seeded with `Other` on a new service so a first-time owner can save without picking a taxonomy), default duration in minutes (required positive integer; required even when `variable_price` is on, since duration is per-booking not per-charge), default price in dollars (required non-negative decimal when `variable_price` is off; hidden when on), color token (required; one of the 8 Lacquer swatches; defaults to Rose), `taxable` toggle (defaults to off), `variable_price` toggle (defaults to off), variable-price `From` and `To` bounds (both optional, both non-negative decimals, To ≥ From when both set; visible only when `variable_price` is on), variable-price note (optional single-line free text; visible only when `variable_price` is on), and the staff-assignment list.
- **FR-012**: The staff-assignment list MUST render every currently-active staff member as a row with a checkbox, the staff member's avatar + display name + role, and an optional per-tech duration override input (numeric, positive integer, placeholder "{default} min"); the override input MUST be disabled until the checkbox is ticked.
- **FR-013**: The "Save service" button MUST be disabled until all required fields are valid (per FR-011 and any conditional validations).
- **FR-014**: On successful save, the drawer MUST remain open and flip to Edit mode for the just-created service (title becomes "Edit service", primary button becomes "Save changes" and is disabled, "Archive service" action appears at the bottom). The new service MUST appear in the list under the correct category group, the list MUST scroll the new row into view, and a toast MUST read "{name} added to the catalog".
- **FR-015**: If the operator saves with zero techs ticked, the save MUST succeed and a secondary toast MUST appear in addition to the success toast: "Nobody can perform this service yet. Add techs from the edit drawer."
- **FR-016**: Closing the drawer with unsaved changes (backdrop click, Escape, or Cancel) MUST show a "Discard changes?" confirm dialog with Cancel / Discard buttons; Discard closes the drawer with no save.

#### Edit service
- **FR-017**: Clicking a row in the catalog list MUST open the same drawer in Edit mode, pre-populated with the service's saved values and the current set of assigned staff (including per-tech duration overrides).
- **FR-018**: The Edit drawer header MUST show a live preview (color swatch + name + category + price / duration) that reflects current draft values while the list in the background MUST continue showing the saved values until the user presses "Save changes".
- **FR-019**: The "Save changes" button MUST be disabled when the form is identical to the saved values (including the staff-assignment list and per-tech overrides) or when any field is invalid.
- **FR-020**: Pressing "Save changes" MUST persist all edited fields and the staff-assignment diff atomically (one transaction); a toast MUST confirm "Changes saved" and the drawer MUST remain open with its baseline updated to the new values.
- **FR-021**: Unticking a previously-assigned tech MUST remove that `staff_services` row on save (per-tech overrides are forgotten if the tech is later re-added).
- **FR-022**: Ticking a previously-unassigned tech MUST insert a `staff_services` row on save with `duration_min_override` equal to the value typed in that tech's override field (or null if empty).
- **FR-023**: Toggling `variable_price` off MUST hide and clear the bounds and note fields and re-show (empty) the single Price field; toggling it on MUST hide and clear the single Price field and show (empty) the bounds and note fields. In both directions, "Save changes" MUST be disabled until the now-required field(s) are valid.

#### Archive / restore
- **FR-024**: The Edit drawer MUST surface an "Archive service" action at the bottom when the service is active and a "Restore service" action when it is archived.
- **FR-025**: "Archive service" MUST require a confirmation dialog naming the service and explaining the consequence in plain language ("{name} won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time."); Cancel and backdrop clicks MUST close the dialog with no change.
- **FR-026**: Confirming archive MUST set `active = false` on the service row, write an audit entry, swap the drawer's action to "Restore service", and show a "{name} archived" toast.
- **FR-027**: "Restore service" MUST NOT show a confirmation dialog (restore is non-destructive); it MUST set `active = true`, write an audit entry, swap the drawer's action back to "Archive service", and show a "{name} restored" toast.
- **FR-028**: Archive and restore MUST NOT modify the service's `staff_services` rows — assignments are preserved across the cycle.

#### Authorization
- **FR-029**: All authenticated operators MUST be able to reach `/services` and read the catalog list and drawer contents.
- **FR-030**: Only operators whose `staff.role` (for the current `acting_as_staff_id`) is `owner` or `manager` MUST be able to perform any mutation (add, edit, archive, restore). For all other operators the "Add service" button MUST be disabled with a tooltip "Only owners and managers can edit the catalog," and every input, toggle, color swatch, staff-assignment checkbox, per-tech override field, and bottom action in the drawer MUST be disabled with the same tooltip.
- **FR-031**: Every privileged write MUST go through a Server Action that re-verifies `staff.role ∈ {'owner','manager'}` for the current `acting_as_staff_id` (defense in depth against direct FormData posts that bypass the layout's UI gate). A request from a non-privileged operator MUST be rejected with no mutation and no audit row.
- **FR-032**: Every successful mutation MUST write an `audit_log` row with `action = 'settings.updated'`, `entity = 'service'`, `entity_id = {service.id}`, the device user, the operating staff (`acting_as_staff_id`), and a `payload` describing the change. The payload SHOULD capture: for add, the new field values; for edit, a diff of changed fields (including added / removed staff IDs); for archive, `{archived: true}`; for restore, `{restored: true}`.

#### Data
- **FR-033**: The migration delivered with this feature MUST create a `services` table with columns id (primary key), name, category, duration_min, price_cents (non-null integer; for variable-price services it stores `price_from_cents` or `0` when From is unset), color_token, taxable, active, variable_price, price_from_cents (nullable), price_to_cents (nullable), variable_price_note (nullable), created_at, and updated_at. Column types MUST match the project's existing conventions for the other Settings tables (see `staff` as the reference). The `variable_price` flag is the sole signal that downstream consumers use to render a range or "Variable" label instead of the raw `price_cents`.
- **FR-034**: The migration MUST create a `staff_services` join table with primary key (`staff_id`, `service_id`), a nullable `duration_min_override` column, and `created_at` / `updated_at` timestamps. Both foreign keys MUST cascade on delete of the parent staff or service row (which only happens via hard delete, never used by this feature).
- **FR-035**: Row-level security policies on both tables MUST follow the project's existing pattern (every authenticated user reads all rows; the kiosk JWT has no access; writes happen via privileged Server Actions, not direct RLS-policed inserts).

#### Feedback & polish
- **FR-036**: Successful mutations MUST surface a single bottom-center toast with a check icon for ~3 seconds; only one toast may be visible at a time (a new one replaces the previous). The "no techs assigned" secondary toast is an exception and may appear stacked beside its companion success toast for the same 3 seconds.
- **FR-037**: All page surfaces (list, drawer, dialogs, toasts) MUST use Lacquer tokens, the studio shell layout (sidebar + topbar) from feature 007, the Inter type / 4px spacing scale, and the icons defined in `design-system/`. No raw hex colors, off-scale spacing, custom font weights, or emoji in chrome.
- **FR-038**: All numeric values on the page (durations in minutes, prices, tech counts, totals) MUST render with tabular numerals.
- **FR-039**: All currency display MUST follow the Lacquer copy guidance: whole-dollar amounts as `$45`, non-whole amounts as `$45.50`, ranges as `$30 – $50` with an en-dash, "From" prefix as `From $30`, and `Variable` (neutral tone) when no bounds are set.

### Key Entities

- **Service** — a single sellable offering in the salon's catalog. Carries a display name, a category string, a default duration in minutes, a default price in cents (non-null; for variable-price services it stores `price_from_cents` or `0` when From is unset), a Lacquer color token, a `taxable` flag (reserved for a later tax feature; no UI effect in v1), an `active` flag (drives archive/restore), a `variable_price` flag with optional `From` / `To` cents bounds and a free-text note, and creation/update timestamps. New in this feature as the `services` table per `docs/system-design.md`.
- **Staff service assignment** — a row connecting a service to a staff member who can perform it, optionally with a per-tech duration override that overrides the service's default duration when this staff books the service. New in this feature as the `staff_services` join table.
- **Audit entry** — a record of every catalog mutation, capturing the device user, the operating staff, `action = 'settings.updated'`, `entity = 'service'`, the service id, and a payload describing the change. Already defined in the system design as the `audit_log` table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can add a brand-new service end-to-end (open Add drawer → enter name, category, duration, price → pick a color → tick the techs who perform it → save → see the new row) in **under 60 seconds** with no documentation.
- **SC-002**: After ship, the salon administrator performs **zero database edits** to manage the catalog — every CRUD and archive operation is reachable from the page.
- **SC-003**: Changing a service's price or duration — from clicking the row to seeing the "Changes saved" toast — completes in **under 20 seconds**.
- **SC-004**: 100% of catalog mutations write a corresponding `audit_log` row with `action = 'settings.updated'`, the entity id, the device user, and the operating staff.
- **SC-005**: All page surfaces pass the Lacquer design check (every visual value traces to a token; matches the source prototype side-by-side) before the feature is marked complete, per `CLAUDE.md` § "When you change UI".
- **SC-006**: Filtering and searching a catalog of up to 100 services feels instant — the list updates within **100ms** of a keystroke or toggle change on a typical staff laptop.
- **SC-007**: A returning admin can find any service by name in **under 5 seconds** using the search field, regardless of catalog size up to 100 services.
- **SC-008**: 0% of catalog edits cause regressions in historical appointment or ticket data — every `appointment_services` and `ticket_items` row that pre-dated the edit remains byte-identical (verified by the snapshot columns documented in `docs/system-design.md`).

## Assumptions

- This feature implements the **Services** catalog as a top-level studio route at `/services`. It reuses the studio shell (sidebar + topbar) shipped in feature 007-left-panel-nav and wires the previously-disabled `services` sidebar entry to the new route. The Settings tab strip (General · Staff · Notifications · Billing) loses its Services tab — Services is no longer a Settings sub-route.
- The `audit_log` table already exists (per feature 006 and `docs/system-design.md`) and accepts `action = 'settings.updated'` with `entity = 'service'`. This feature does not extend the audit schema.
- The fixed color palette is the same 8 OKLCH Lacquer swatches enumerated in the staff feature (Rose / Blue / Green / Amber / Purple / Teal / Orange / Slate); they are stored as Lacquer color tokens, not raw hex.
- Categories are free-text strings stored on `services.category` (no separate `categories` table). The auto-complete list is `SELECT DISTINCT category FROM services ORDER BY category`. There is no "manage categories" surface in v1; renaming a category means editing each service in it.
- "Archive" is a soft delete via the existing `services.active` boolean (not a separate `archived_at` column). The label "Archived" in the UI maps to `active = false`; the label "Active" maps to `active = true`.
- Prices are entered in dollars (decimal) in the UI but stored as integer cents in the database, consistent with every other money column in the system design.
- The `taxable` flag is captured and stored but has no UI effect beyond the toggle itself in v1 (it's reserved for the future tax-computation feature). The Add-drawer toggle defaults to `false` on new services so the owner makes an explicit per-service decision. The DB column default in `0003_services_catalog.sql` is still `true` (immutable migration history); the app always provides an explicit value, so the column default is academic.
- Per-tech duration overrides apply to bookings going forward; this feature does not rewrite historical `appointment_services.duration_min_snapshot` rows on a change.
- The variable-price note is captured and stored but is not displayed anywhere in v1 beyond the edit drawer itself — it will be surfaced by the checkout variable-price sheet in a later feature.
- Realtime sync is not required for this surface in v1 — the system design lists `services` and `staff_services` outside the realtime channels table. Last-write-wins is acceptable for concurrent admin edits, matching the staff surface.
- The staff-assignment list shows only active staff (`staff.active = true AND staff.removed_at IS NULL`); inactive / removed staff never appear in the picker even if they previously had `staff_services` rows. Existing `staff_services` rows for now-inactive staff are preserved in the database but not shown in the drawer until the staff is reactivated.
- The drawer / dialog / toast / sheet / avatar / badge components already exist in `components/lacquer/*` (or are extended here as part of the design-system mapping); no new component library is introduced.
- Square catalog sync, service photos, marketing copy, and drag-drop manual re-ordering are all explicitly out of scope; the catalog sorts itself by category then name.
