# Feature Specification: Supply Types Catalog

**Feature Branch**: `022-supply-types-catalog`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Supply types catalog + Services refactor from supply_label to supply_type_id. 021-services-deductions (PR #22) shipped services.supply_label as free-text. The newer design prototype models supply types as a first-class entity so renames flow through every consumer (services, EditPolicySheet, future Staff Settings exemptions) and identical types are guaranteed identical via stable ids. This feature ships the catalog + refactors 021's per-service supply column to reference it. NO checkout-time wiring yet (still Phase 3); NO per-staff exemptions yet (023 picks that up)."

## Clarifications

### Session 2026-05-17

- Q: After the migration backfills `services.supply_type_id` from the old `services.supply_label`, what happens to the `supply_label` column itself? → A: Drop it in the same migration after backfill verification. Catalog is the single source of truth; one writer, no dual-write surface for renames to keep in sync.
- Q: How should the one-time backfill migration interact with the audit log, given SC-007 says "no catalog mutation can succeed without an audit row" and the migration has no operator? → A: Migration writes one `supply_type.created` audit row per seeded type with a system actor (`actor = 'system:migration'`, `actor_user_id = null`). SC-007 invariant holds uniformly; audit log explains seeded types.
- Q: What are the validation rules for a supply-type display name (length, character set, whitespace)? → A: Match the existing adjacent surfaces — trim leading/trailing whitespace, min 2 chars (matching `services.name`), max 64 chars (matching the prior `supply_label` cap from 021), free Unicode allowed. Case-insensitive uniqueness across active types (already specified). The migration normalizes each legacy label the same way before deduping.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a supply type from a managed list when editing a service (Priority: P1)

When the owner opens a service in the catalog edit panel and turns Supply on, they no longer type a free-text label. Instead they pick from a dropdown of named supply types the salon already uses ("GelX tips & gel", "Chrome powder", "Cat-eye gel", "OPI bottle wear" seeded from existing usage). If the supply they need isn't in the list, they create it inline with one click ("+ Create new supply type…") and it becomes the selected value immediately. The saved service references the supply type by a stable id, not by its display name — so renames flow through automatically and the same physical supply across services is guaranteed to be the same entity.

**Why this priority**: This is the only change that touches the operator's daily catalog workflow. Without it, supply labels stay free-text and the rename problem the catalog exists to solve isn't actually solved. Every other story builds on the stable id this picker writes.

**Independent Test**: Open `/services`, pick a service whose existing `supply_label` was backfilled. Confirm the Supply section shows the picker pre-populated with the migrated type. Open a different service, turn Supply on, pick the same type from the dropdown, set an amount, save. Inspect the row in the catalog: both services now reference the same `supply_type_id`. Reload the page; both rows render the same supply name from the catalog (no free-text persisted).

**Acceptance Scenarios**:

1. **Given** Supply is being turned on for a service AND the catalog already contains at least one active supply type, **When** the owner opens the supply-type picker, **Then** the dropdown lists every active type alphabetically by name, plus an inline "+ Create new supply type…" row pinned at the bottom.
2. **Given** the supply-type picker is open AND the owner clicks "+ Create new supply type…", **When** they type a name and press Enter or click Save, **Then** a new supply type is created, the picker closes with that type pre-selected, and the operator can proceed to enter the amount without a second save round-trip.
3. **Given** the owner types a name that case-insensitively matches an existing active type, **When** they attempt to save the new type, **Then** the create flow surfaces a soft hint ("A supply type with this name already exists — selecting it instead") and selects the existing row rather than creating a duplicate.
4. **Given** Supply is on AND a supply type is selected AND an amount is set, **When** the operator saves the service, **Then** the row persists `supply_type_id` (uuid) and `supply_amount_cents` (int), with no `supply_label` text stored.
5. **Given** a service that pre-existed before this feature shipped, **When** the operator opens its edit panel, **Then** the supply picker reflects the type that was migrated from its old `supply_label` (case-insensitively deduped — services that shared a label now share the same type).

---

### User Story 2 - Rename a supply type once and see it update everywhere (Priority: P1)

The owner opens the Edit Policy sheet (existing surface from 021) and finds a new "Supply types" section listing every type in the catalog. Inline rename is a click on the name itself — type the new name, press Enter, done. Every service that references the renamed type updates immediately, and the rename will flow into the future Staff Settings exemption checklist (023) the same way without any per-screen synchronization.

**Why this priority**: This is the central proof that the catalog model delivers what the free-text model couldn't. If the operator has to hunt for every service that uses a label to rename them in sync, the catalog adds friction instead of removing it.

**Independent Test**: Seed the catalog with a type "GelX tips & gel" referenced by two services. Open Edit Policy → Supply types, rename it to "GelX materials" inline. Close the sheet. Open each of the two services in the catalog edit panel; both show the new name in the picker. Inspect the database — only one row in `supply_types` was updated, no `services` rows were rewritten.

**Acceptance Scenarios**:

1. **Given** a supply type with one or more referencing services, **When** the owner clicks the name in the Edit Policy "Supply types" section, **Then** an inline text field appears with the current name selected so they can type a replacement.
2. **Given** an inline rename is in progress, **When** the owner presses Enter or blurs the field with a valid non-empty name, **Then** the rename persists, the row updates optimistically, and a successful rename does not require any other surface to be refreshed.
3. **Given** the owner submits an empty or whitespace-only rename, **When** the field blurs, **Then** the rename is rejected with an inline hint and the prior name is restored without persistence.
4. **Given** the owner submits a rename that case-insensitively collides with another active type, **When** the field blurs, **Then** the rename is rejected with an inline hint ("A supply type with this name already exists") and the prior name is restored.
5. **Given** a rename completed in another tab seconds ago, **When** the operator opens the supply-type picker on a service, **Then** the picker reflects the new name (the catalog is the single source of truth; no per-page label cache).

---

### User Story 3 - Archive a supply type that's no longer in use (Priority: P2)

When a supply type is no longer relevant (e.g., the salon stopped selling chrome powder), the owner archives it from the Edit Policy "Supply types" section. Archived types are hidden from the picker on new edits but remain visible on services that historically referenced them (the old service rows still display the type name). The archive button is disabled while any active service still references the type — the owner has to switch those services to a different type, or turn Supply off, before the archive can succeed.

**Why this priority**: Archive prevents the catalog from accumulating dead names over time. Lower priority than rename because users can live with extra dropdown items longer than they can live with stale names propagating everywhere.

**Independent Test**: Create a supply type "Cat-eye gel" with one referencing service. From Edit Policy, click Archive — confirm the button is disabled and a tooltip explains "Remove this type from the 1 service that uses it first." Open that service, switch Supply off, save. Return to Edit Policy and click Archive — now it succeeds. Open another service, turn Supply on — confirm "Cat-eye gel" no longer appears in the picker dropdown.

**Acceptance Scenarios**:

1. **Given** a supply type with at least one active service referencing it, **When** the owner views the Edit Policy "Supply types" row, **Then** the Archive control is disabled with a tooltip naming the blocker ("Remove this type from N services that use it first").
2. **Given** a supply type with zero active references, **When** the owner clicks Archive, **Then** the type is marked archived in the catalog, drops out of the picker on future edits, and the row in Edit Policy moves to a muted "Archived" sub-section.
3. **Given** an archived supply type, **When** the owner opens the same Edit Policy section, **Then** a Reactivate control is available that restores the type to active status (subject to name uniqueness against current active types).
4. **Given** an archived supply type that no current service references but was referenced historically before backfill or by older services that have since changed type, **When** the catalog is queried for active types (the picker query), **Then** the archived type is excluded.

---

### User Story 4 - See which services use each supply type at a glance (Priority: P2)

In the Edit Policy "Supply types" section each type shows a usage count alongside its name. Expanding a row reveals an indented list of every service that references that type; clicking any sub-row jumps the operator into that service's edit panel on the catalog. This gives the owner a single place to audit "which services charge for chrome powder?" without rummaging through the full catalog row by row.

**Why this priority**: Usage visibility makes archive decisions safer and makes the catalog feel maintainable. Without it, the section is a flat list with no context for whether a name is load-bearing.

**Independent Test**: Open Edit Policy → Supply types with three services referencing one type and zero referencing another. Confirm one row shows "3 services" and another shows "Unused". Expand the populated row — three sub-rows render, each naming a service. Click any sub-row; the Edit Policy sheet closes and the catalog navigates to that service's edit panel with it selected.

**Acceptance Scenarios**:

1. **Given** the Edit Policy "Supply types" section is rendered, **When** the operator reads each row, **Then** the row shows the type name, a stable id (small muted text for debugging/copy), and a usage count formatted as "N services" or "Unused" when zero.
2. **Given** a supply type with at least one referencing service, **When** the operator expands the row, **Then** the panel reveals an indented sub-row per referencing service showing the service name and its current price.
3. **Given** an expanded supply-type row, **When** the operator clicks any service sub-row, **Then** the Edit Policy sheet closes and the catalog navigates to that service's edit panel with the service pre-selected.
4. **Given** a supply type whose usage count changes after a service edit elsewhere (e.g., another tab), **When** the operator reopens Edit Policy, **Then** the count reflects the current state without manual refresh of the section.

---

### User Story 5 - Existing services keep displaying the right supply name after migration (Priority: P1)

Operators should never see "broken" supply data after the migration. Every service that had a non-null `supply_label` before the migration must, after deploy, show that same name in the picker and on the catalog row. Services that shared a label (case-insensitively) must now share a single supply type so renaming once updates both.

**Why this priority**: The migration runs once against production data. If it leaves orphans or duplicates, the catalog model the rest of this feature depends on is wrong from minute one. This is the data-integrity guarantee under everything else.

**Independent Test**: Before applying the migration, snapshot the distinct active `supply_label` values from the services table. After the migration, query `supply_types` — every snapshotted name must appear exactly once (case-insensitively deduped). Every service that had a non-null `supply_label` must now have a non-null `supply_type_id` pointing at the type whose name matches its old label.

**Acceptance Scenarios**:

1. **Given** the catalog contains services with non-null `supply_label` values before the migration runs, **When** the migration completes, **Then** the `supply_types` table contains one active row per distinct case-insensitive label.
2. **Given** two services that shared the same `supply_label` (case-insensitive match), **When** the migration completes, **Then** both services reference the same `supply_type_id`.
3. **Given** a service that had a null `supply_label` before the migration, **When** the migration completes, **Then** its `supply_type_id` is null (Supply remained off).
4. **Given** the migration completes, **When** an operator loads `/services`, **Then** every row that previously displayed a supply label displays the same name resolved from the catalog (no visual change for the operator).

---

### Edge Cases

- A supply type is created in one tab and referenced from another tab seconds later — the second tab's picker reflects the new type without manual refresh (resolved server-side by reloading the catalog on every page Server Component render; revalidate is fired by the create action).
- An operator tries to archive a type that has zero current references but is named in a service draft that hasn't been saved yet — archive succeeds, the unsaved draft is unaffected until save, at which point validation rejects the stale reference and shows an inline hint.
- Two operators race to create a supply type with the same name simultaneously — the partial unique index on `lower(name) where archived = false` ensures one wins; the loser's action returns a "name taken" error and the picker re-selects the winning row.
- A service is mid-edit (draft buffer has the old free-text label) when the deploy applies the migration — the draft is discarded on the next save and reloads from the now-migrated catalog row, so no operator action is required.
- Rename collides with an archived type's name — allowed; archived types are excluded from the uniqueness constraint, and there's no semantic conflict since the archived row is hidden from the picker.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a catalog of named supply types with stable identifiers, where each type has at minimum a display name and an archive status. The display name MUST be trimmed of leading/trailing whitespace, between 2 and 64 characters long, and may contain any Unicode (matching the existing `services.name` minimum and the prior `supply_label` cap from 021).
- **FR-002**: System MUST replace the free-text supply label on services with a reference to a supply type from the catalog. Services that have a supply configured MUST reference exactly one type; services without supply MUST reference no type.
- **FR-003**: Owners and managers MUST be able to create a new supply type inline from the service edit panel's supply-type picker, in a single interaction that both creates the type and selects it on the current service draft.
- **FR-004**: System MUST reject creating a new supply type whose name case-insensitively matches an existing active type, falling back to selecting the existing type so duplicates can't be introduced from the picker.
- **FR-005**: Owners and managers MUST be able to rename an active supply type from the Edit Policy "Supply types" section; the rename MUST propagate to every consuming surface (service edit panels, catalog rows, future Staff Settings exemption checklist) without per-surface synchronization.
- **FR-006**: System MUST reject renaming an active supply type to a name that case-insensitively matches another active type, preserving the prior name with an inline hint.
- **FR-007**: Owners and managers MUST be able to archive a supply type that has zero active referencing services; the system MUST prevent archiving while any active service still references the type, surfacing the blocker count in the disabled control's tooltip.
- **FR-008**: Owners and managers MUST be able to reactivate an archived supply type subject to active-name uniqueness.
- **FR-009**: The supply-type picker MUST list only active types for new selections; archived types MUST NOT appear in the picker (but services that historically referenced them MUST still display their name).
- **FR-010**: The Edit Policy "Supply types" section MUST display each type's usage count (number of active services referencing it) and, on expansion, an indented list of referencing services that the operator can click to jump to that service's edit panel.
- **FR-011**: System MUST migrate every distinct case-insensitive supply-label value currently present on services into a seeded set of supply types, set each affected service's `supply_type_id` to point at its matching type, and drop the `services.supply_label` column in the same migration after backfill verification. Post-migration, the catalog is the only source of supply names; no denormalized label cache is maintained on services.
- **FR-012**: System MUST enforce at the database layer that a service's supply pair `(supply_amount_cents, supply_type_id)` is both-or-neither: both null when Supply is off, or both non-null with `supply_amount_cents` in `[1, 5000]` when Supply is on.
- **FR-013**: System MUST authorize all supply-type catalog mutations (create / rename / archive / reactivate) to owners and managers only; technicians and front-desk operators MUST be able to read the catalog but the controls MUST be disabled with a tooltip mirroring the existing services-edit gate.
- **FR-014**: Every successful catalog mutation (create / rename / archive / reactivate) MUST write an audit log row that names the operator (or `'system:migration'` when written by the one-time backfill), the supply type, and the before/after values where applicable. The backfill migration MUST write one `supply_type.created` row per seeded type.
- **FR-015**: Every catalog mutation that changes the visible name or active status of a type MUST cause both `/services` and `/settings/staff` to revalidate so dependent pages see the change on next render.
- **FR-016**: When a service edit panel saves with a supply-type id that no longer exists in the catalog (defensive — created by a race), the save MUST be rejected with a hint asking the operator to re-pick.

### Key Entities

- **Supply Type**: A named, archivable category of consumable cost that services can charge against (e.g., "GelX tips & gel", "Chrome powder"). Each type has a stable identifier that survives renames, a display name (trimmed, 2–64 chars, free Unicode, unique across active types case-insensitively), an archived flag, and timestamp metadata. The display name is the only user-visible field; the identifier is what services and future per-staff exemptions reference.
- **Service-to-SupplyType Reference**: A nullable link from a service to one supply type. Pairs with the existing per-service supply amount: both must be present (supply is on for the service) or both must be null (supply is off). The reference is by identifier, not by name, so renames don't cascade through the services table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration, 100% of services that had a non-null supply label before the migration display the same supply name on the catalog page, with no operator action required.
- **SC-002**: After migration, the supply-types catalog contains exactly one row per distinct case-insensitive supply-label value that existed before the migration, with zero duplicate active rows.
- **SC-003**: An owner can rename a supply type referenced by N services and observe the new name on all N service rows after a single save action, without editing any service individually.
- **SC-004**: An owner can create and select a new supply type for a service in a single click-to-confirm interaction, completed in under 5 seconds from "Supply toggle on" to "type selected and saved".
- **SC-005**: Zero service rows in the catalog can persist a free-text supply label after this feature ships; all supply identity flows through the catalog by referential link only.
- **SC-006**: An owner can identify every service using a given supply type from a single screen (Edit Policy → expand the supply-type row), without searching the catalog manually.
- **SC-007**: No catalog mutation (create / rename / archive / reactivate) can succeed without writing a corresponding audit log row.

## Assumptions

- The migration that adds the supply types catalog and refactors `services.supply_label` to `supply_type_id` will run via the existing GitHub-Actions-managed Supabase migration pipeline (auto-applied to preview on PR, to prod on merge). No manual `supabase db push` will be required.
- Authorization for the new catalog mutations mirrors the existing services-catalog authorization: owners and managers may mutate; technicians and front-desk operators may read. No new role is introduced.
- The Edit Policy surface from 021-services-deductions already exists and is the right home for the supply-types management section. No standalone settings sub-page is created for the catalog.
- The seeded supply types after migration are exactly the distinct active labels that existed in production at migration time. No "salon defaults" are pre-seeded for fresh installs in this feature — empty catalog is allowed; the picker shows the create-new affordance only.
- Per-staff exemption against supply types (the consumer noted in the prompt) lands in feature 023 and is explicitly out of scope here. This feature delivers a catalog that 023 can reference by stable id.
- Checkout-time application of supply deductions stays Phase 3 of the deductions roadmap and is out of scope. Capture-and-display only, consistent with 021's posture.
- The audit log schema and contract from 021 (`audit_log.action = 'settings.updated'`, `entity = 'service'`) can be extended to a new entity value `'supply_type'` without a schema migration, since `audit_log.entity` is already free-text.
- The audit log row written by the backfill migration uses `actor = 'system:migration'` (and `actor_user_id = null`). If the existing `audit_log` schema lacks a non-FK actor channel, the migration adds the minimum surface needed (e.g., a nullable `actor_label` text column) as part of the same migration — surfaced in the plan, not assumed away.
