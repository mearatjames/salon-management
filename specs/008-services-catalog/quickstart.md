# Quickstart — Services catalog

How to bring this feature up locally end-to-end, exercise it against a seeded Supabase, and check it visually against the Lacquer prototype.

---

## 1. Prereqs

- Node + npm (per repo `.nvmrc`).
- Supabase CLI logged in to the right org.
- Local Supabase running (`supabase start`) — the e2e suite needs this.
- `.env.local` populated (copy from `.env.example`; `vercel env pull` is the recommended path if Vercel CLI is installed).

If the migration hasn't been applied locally yet:

```bash
supabase db reset       # nukes local and re-applies every migration (incl. 0003)
# OR
supabase db push --local
```

Hosted preview + production apply automatically via GitHub Actions (`db-migrate-preview.yml` on PR, `db-migrate-prod.yml` on push to `main`). Never run `supabase db push` against the hosted projects by hand (Constitution v1.0.3 § "Schema drift forbidden").

---

## 2. Seed data

The existing staff seed (`scripts/seed-dev.ts` or whatever the repo uses for `npm run seed`) creates an owner, a manager, two technicians, and a front-desk. This feature adds five services for the e2e suite to exercise:

```ts
// scripts/seed-dev.ts (extension)
const services = [
  { name: "Classic manicure", category: "Manicure", duration_min: 30, price_cents: 2500, color_token: "--avatar-rose" },
  { name: "Gel polish",       category: "Manicure", duration_min: 45, price_cents: 3500, color_token: "--avatar-blue" },
  { name: "Classic pedicure", category: "Pedicure", duration_min: 45, price_cents: 4000, color_token: "--avatar-green" },
  { name: "Spa pedicure",     category: "Pedicure", duration_min: 60, price_cents: 5500, color_token: "--avatar-teal" },
  { name: "Nail art",         category: "Add-on",   duration_min: 30, price_cents: 0,    color_token: "--avatar-purple",
    variable_price: true, price_from_cents: 1500, variable_price_note: "Depends on design complexity" },
];
// Two of these are assigned to both technicians; one (Spa pedicure) has a 75-min
// override for one tech; Nail art is assigned to no one (to exercise the
// "No techs" pill and the secondary "no_techs_assigned" toast on edit).
```

---

## 3. Bring up the dev server

```bash
npm run dev        # http://localhost:3000
```

Sign in as the owner (PIN: see seed), then navigate to `/settings/services`.

---

## 4. Manual smoke (mirrors the spec's user stories)

1. **List at a glance (US1).** The list shows 5 services in 3 category groups (Add-on, Manicure, Pedicure — alpha). Nail art's row reads "Variable" with a "No techs" pill in the amber-dot warning tone. Toggle "Show archived" — no change yet (nothing archived). Summary reads "5 active · 5 total".

2. **Add a service (US2).** Click "Add service". The drawer opens with defaults: category "Other", duration "30", color Rose, taxable on, variable off. Type `Test service`, change category to `Manicure` (auto-complete shows the existing "Manicure"), set duration `40`, price `30`, leave Rose, tick both technicians. Click "Save service". Drawer **stays open** and **flips to Edit mode** (title becomes "Edit service", primary becomes "Save changes" disabled, "Archive service" appears at the bottom). Toast reads "Test service added to the catalog". The list in the background gains a "Test service" row under Manicure.

3. **Edit a service (US3).** Change the price to `35`, untick one technician, click "Save changes". Drawer stays open, baseline updates, toast reads "Changes saved". The list row's price flips to `$35` and the tech-count pill drops by 1.

4. **Per-tech override (US3).** Re-tick the unticked tech, type `60` into their override field, save. The drawer's panel shows "60 min" beside that tech; the `staff_services` row now has `duration_min_override = 60`. Inspect via psql to confirm.

5. **Variable price round-trip (US5).** Click Nail art. Toggle "Variable price" off → Price field appears empty, Save is disabled. Toggle back on → bounds + note reappear with their saved values. Save with the same values → "Nothing to save" info toast (no_changes path).

6. **Archive + restore (US4).** Open any active service, click "Archive service". Confirm dialog shows the service name and the history-preservation note. Confirm. Row disappears from the list; toast reads "{name} archived". Drawer's bottom action flips to "Restore service". Click Restore (no dialog). Row returns; toast reads "{name} restored".

7. **Authorization (US6).** Sign out, sign in as a technician. Navigate to `/settings/services`. The list renders; "Add service" is disabled with the tooltip; clicking a row opens the drawer in read-only mode (all controls disabled, primary chip reads "View only"). Try posting `addService` directly via DevTools FormData submission — server responds with the `forbidden` toast.

8. **Toasts (US7).** Trigger each mutation in succession; confirm each toast fires in sequence with no stacking (except the secondary `no_techs_assigned` which may stack with `service_added`).

---

## 5. Visual comparison (Lacquer fidelity)

Open these reference files side by side with the running page:

- `design-system/ui_kits/studio/Settings.jsx` — the canonical Settings page shell + services-tab mock (the list-row layout, the category-group header, the drawer's right-side composition).
- `design-system/preview/Settings.html` (or whichever HTML preview is exported) — load in a browser at 1× and 1.5× zoom to verify the swatch colors, the chip pill shapes, and the muted-archived treatment.

Run through every token used on the page and confirm it maps to a `var(--…)` reference in `styles/tokens.css`. Any raw hex, off-scale spacing, or weight outside 400/500/600 is a Principle I violation.

---

## 6. Tests

Local gate set (run in order — CI runs the same):

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e -- --workers=1   # services.spec.ts + the existing suites
```

The Playwright `services.spec.ts` covers:

- US1: list with 5 services across 3 categories, search narrows, "Show archived" toggle reveals/hides the (we archive one as part of the spec setup) archived row.
- US2: Add a service end-to-end, asserts the drawer flips to Edit mode (title text, Save disabled, Archive action visible), toast text, and the new row.
- US3: Edit the price, untick a tech, set a per-tech override; asserts the row update, the toast, the staff_services row in the DB.
- US4: Archive + confirm dialog text + restore; asserts the `?toast=service_archived` URL and the row's visibility transitions.
- US5: Variable-price round-trip — toggle on/off, set bounds, save, verify the list-row label rules in `_format.ts`.
- US6: Read-only flow as a technician — "Add service" disabled, drawer is view-only, direct FormData POST surfaces the `forbidden` toast.
- US7: Toast sequence assertions across the previous five tests.

Vitest unit tests live under `tests/unit/services/`:

- `validation.test.ts` — every validator + edge case (empty, decimal precision, negative, NaN, integer overflow).
- `sort.test.ts` — the grouped catalog sort comparator across mixed-case categories, accents, and identical-name-different-category cases.
- `format.test.ts` — `formatPriceLabel` for every combination of `variable_price`, `price_cents`, `price_from_cents`, `price_to_cents`.
- `diff.test.ts` — `staffAssignmentDiff(baseline, draft)` for all four operations (no-op, add, remove, override-change) including a mixed-bag scenario.
- `permissions.test.ts` — `canWriteCatalog` for each of the four roles.
- `audit-service-entity.test.ts` — `recordAudit('service.added' | 'service.updated' | 'service.archived' | 'service.restored')` writes rows with `entity_type = 'service'`.

---

## 7. Done checklist

Before marking the feature complete:

- [ ] All five local gates green (`format:check`, `lint`, `typecheck`, `test`, `test:e2e --workers=1`).
- [ ] Side-by-side visual check against `design-system/ui_kits/studio/Settings.jsx` and the Settings.html preview.
- [ ] Audit-log spot check: pick one of each mutation; `select action, entity_type, entity_id, payload from audit_log where action like 'service.%' order by ts desc limit 8;` returns the expected verbs, entity_types, and payload shapes (per `contracts/audit.contract.md`).
- [ ] Migration applied automatically by `.github/workflows/db-migrate-preview.yml` on PR (check the workflow run on the PR page; per `[Verify external integrations before claiming absence]` memory).
- [ ] Spec, plan, contracts, data-model, quickstart, and checklist all committed on `008-services-catalog`.
- [ ] PR title and body cite the user-input scope (catalog CRUD, per-tech overrides, archive/restore, variable price; explicitly *not* drag-drop / Square sync / tax / photos).
