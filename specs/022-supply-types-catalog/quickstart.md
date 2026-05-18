# Quickstart — Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17 · **Companion**: [spec.md](./spec.md), [plan.md](./plan.md)

How to run, verify, and visually compare the work. Mirrors the structure of `specs/021-services-deductions/quickstart.md`. Each User Story has a short manual checklist mapped to its independent test.

---

## Local setup

```sh
# 1. Install + start the local Supabase.
npm install
supabase start                # if you don't already have a local DB running

# 2. Apply migrations (includes 0017_supply_types_catalog.sql).
supabase db reset             # full reset — drops & reseeds + runs all migrations
# OR, if you want to apply just the new migration on top of existing local state:
supabase migration up

# 3. Regenerate DB types (the 0017 migration changes services.Row + adds supply_types).
npx supabase gen types typescript --local > lib/db/types.ts

# 4. Start the dev server.
npm run dev
```

Sign in as an owner or manager (the seed fixture creates `owner@example.com`). Navigate to `/services`.

---

## US1 — Pick a supply type from a managed list when editing a service

**Independent test (from spec)**: Open `/services`, pick a service whose existing `supply_label` was backfilled. Confirm the Supply section shows the picker pre-populated with the migrated type. Open a different service, turn Supply on, pick the same type from the dropdown, set an amount, save. Inspect the row in the catalog: both services now reference the same `supply_type_id`. Reload the page; both rows render the same supply name from the catalog (no free-text persisted).

**Manual checks**:

1. The supply input on the edit panel is now a button-like dropdown (no free-text input).
2. Clicking it opens a popover with active types alphabetically sorted, plus "+ Create new supply type…" pinned at the bottom.
3. Clicking "+ Create new supply type…" reveals an inline text input + Save / Cancel. Typing a name and hitting Save closes the picker with the new type pre-selected — no separate "Save service" round-trip is required to land on the new type.
4. Typing a name that case-insensitively matches an existing active type changes the primary action to "Select existing" with a hint; activating it selects the existing row.
5. Saving the service writes `supply_type_id` and `supply_amount_cents`; no `supply_label` column exists in the row (regenerated types reflect this).

---

## US2 — Rename a supply type once and see it update everywhere

**Independent test (from spec)**: Seed the catalog with a type "GelX tips & gel" referenced by two services. Open Edit Policy → Supply types, rename it to "GelX materials" inline. Close the sheet. Open each of the two services in the catalog edit panel; both show the new name in the picker. Inspect the database — only one row in `supply_types` was updated, no `services` rows were rewritten.

**Manual checks**:

1. From `/services`, click "Edit policy" in the page header → the EditPolicySheet opens with the Supply Types section visible.
2. Each active type row shows the name, usage count badge ("2 services"), and an Archive button (disabled in this case because usage > 0).
3. Clicking the name turns it into an inline input. Type the new name; press Enter. The row updates optimistically.
4. Close the sheet. Open each of the two referencing services; the picker now shows the new name.
5. SQL: `select count(*) from supply_types where … updated_at > <pre-rename ts>;` should return exactly 1. `select count(*) from services where updated_at > <pre-rename ts>;` should return 0.

---

## US3 — Archive a supply type that's no longer in use

**Independent test (from spec)**: Create a supply type "Cat-eye gel" with one referencing service. From Edit Policy, click Archive — confirm the button is disabled and a tooltip explains "Remove this type from the 1 service that uses it first." Open that service, switch Supply off, save. Return to Edit Policy and click Archive — now it succeeds. Open another service, turn Supply on — confirm "Cat-eye gel" no longer appears in the picker dropdown.

**Manual checks**:

1. The archive button on each type row is disabled with the count-aware tooltip when usage > 0.
2. After removing the last reference and saving the service, returning to the Edit Policy sheet shows the archive button enabled.
3. Clicking Archive immediately moves the row to an "Archived" sub-section with a Reactivate control.
4. The picker on any service no longer lists the archived type.
5. The picker on a service that historically used the type (if such a path exists — defense in depth only, since archive is blocked when active references exist) still resolves the name correctly via the row's `supply_type_id`.

---

## US4 — See which services use each supply type at a glance

**Independent test (from spec)**: Open Edit Policy → Supply types with three services referencing one type and zero referencing another. Confirm one row shows "3 services" and another shows "Unused". Expand the populated row — three sub-rows render, each naming a service. Click any sub-row; the Edit Policy sheet closes and the catalog navigates to that service's edit panel with it selected.

**Manual checks**:

1. The usage badge formats as `"N services"` when N > 0 and `"Unused"` when N = 0.
2. Each row with N > 0 has a chevron-right expand affordance.
3. Expanding reveals indented rows with the service's color dot, name, current supply amount as `−$X.XX`, and an arrow-right icon.
4. Clicking a sub-row closes the sheet (URL: `/services?selected=<id>`) and the service is pre-selected on the page.
5. Editing a service to add/remove its supply reference, then re-opening Edit Policy, updates the usage count (server-side revalidation runs on every catalog and service save).

---

## US5 — Existing services keep displaying the right supply name after migration

**Independent test (from spec)**: Before applying the migration, snapshot the distinct active `supply_label` values from the services table. After the migration, query `supply_types` — every snapshotted name must appear exactly once (case-insensitively deduped). Every service that had a non-null `supply_label` must now have a non-null `supply_type_id` pointing at the type whose name matches its old label.

**Manual checks**:

1. Before running the migration, on a snapshot of production-shaped data:
   ```sql
   create temporary table _before as
     select distinct lower(trim(supply_label)) as canonical, supply_label as sample
       from public.services
      where supply_label is not null;
   ```
2. Run the migration (`supabase migration up`).
3. After the migration:
   ```sql
   -- Every distinct legacy label has exactly one supply_types row.
   select b.canonical, count(*) as type_rows
     from _before b
     join public.supply_types st
       on st.name_canonical = b.canonical
    group by b.canonical
   having count(*) <> 1;     -- expected: zero rows
   ```
4. Every previously-supplied service now has a non-null FK:
   ```sql
   select count(*) from public.services where supply_type_id is null and 1 = 1
     and id in (select id from _before_services_supplied);  -- expected: 0
   ```
5. The `audit_log` has one `supply_type.created` row per seeded type, all with `payload->>'source' = 'migration:022'` (per `contracts/audit-payload.contract.md § 1`).
6. The `services.supply_label` column no longer exists in `lib/db/types.ts`.
7. On `/services`, every row that previously displayed a supply chip still displays one with the same name (resolved via LEFT JOIN at read time) — no operator-visible change.

---

## Visual compare — Lacquer fidelity

Per CLAUDE.md design-system rules:

1. Open `design-system/prototypes/services/EditPolicySheet.jsx` in the design-system preview (`design-system/preview/EditPolicySheet.html` if it exists; otherwise serve the prototype directly).
2. Open `/services` in `npm run dev`, click "Edit policy".
3. Compare side-by-side, specifically:
   - The "Supply types" section header (icon + title + hint).
   - The row layout: name (click-to-rename) + usage badge + archive button.
   - The expanded sub-row: color dot + name + amount (in amber) + arrow.
   - The "Add supply type" row: rose text + plus icon → inline form.
   - The archived sub-section: muted background + "Reactivate" outline button.
4. Confirm: every color, spacing, radius, shadow, font weight resolves to a token in `styles/tokens.css`. No raw hex codes. No off-scale spacing.

---

## Pre-push quality gates

Per CLAUDE.md "Pre-push quality gates", run in this order before pushing:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e         # set PLAYWRIGHT_PROD=1 to use the prebuilt server
```

All five MUST be green locally. CI runs the same commands.

The Playwright spec for 022 is `tests/e2e/supply-types-catalog.spec.ts`. To run only US3 during phase verification:

```sh
npx playwright test tests/e2e/supply-types-catalog.spec.ts -g "US3"
```

(Per CLAUDE.md "Scoping intermediate phase gates" — the describe-name convention is `US1: …`, `US2: …`, etc.)

---

## Troubleshooting

- **Migration applies but the picker is empty after seed reset**: `supabase db reset` runs the full seed; the seed fixture must include at least one service with a non-null `supply_label` before this migration to produce a seeded supply type. If the seed has been updated for 022 to use `supply_type_id` directly, no backfill happens (and that's correct — empty fresh catalog is allowed per the spec).
- **`supply_type.created` audit row missing for a seeded type**: re-check `lib/auth/audit.ts` — the `AuditAction` union must include `"supply_type.created"` AND `deriveEntityType` must return `"supply_type"` for the prefix. Without those, the JS-layer assertion in the Playwright spec would skip the row even though the migration wrote it correctly.
- **Rename appears to succeed but the picker still shows the old name**: confirm both `revalidatePath('/services')` AND `revalidatePath('/settings/staff')` are called in the rename action. The `/services` revalidation is what flips the picker; the staff path is forward-looking for 023.
- **`?policy=open` query param sticks around after closing the sheet**: the URL bridge in `<EditPolicyButton>` should strip the param via `router.replace` on `onOpenChange(false)`. If it doesn't, the next page render keeps re-opening the sheet.
