# Quickstart — 021-services-deductions

How to run, verify, and visually compare this feature against the canonical design.

This feature **extends** the 008 services surface. The 008 quickstart at `specs/008-services-catalog/quickstart.md` is the baseline; everything below is the additional setup and the new manual checks.

---

## 1. Local prerequisites

You should already have the repo set up from prior features:

```bash
node --version    # 20.x
npm --version
supabase --version
```

If not, run `npm install` and `supabase start` from the repo root.

## 2. Apply the migration

```bash
# From repo root.
supabase db reset
```

`supabase db reset` re-applies every migration including `0016_services_deductions.sql`. After it completes, regenerate types:

```bash
npx supabase gen types typescript --local > lib/db/types.ts
```

You should see four new fields on the `services` row type. Confirm with:

```bash
grep -E "card_fee_mode|card_fee_custom_cents|supply_amount_cents|supply_label" lib/db/types.ts
```

The expected matches: each appears once in `services.Row`, once in `services.Insert`, and once in `services.Update`.

## 3. Seed data

The existing seed (`scripts/seed-dev.ts` or equivalent) creates five baseline services from 008. After 021's migration, all five rows automatically get `card_fee_mode = 'default'` and the three nullable columns at `null` (per the column default behavior — no seed edits required for the base case).

**To exercise all chip kinds in dev**, manually update three rows in SQL Studio (or extend the seed):

```sql
-- "Gel polish" with a custom card fee.
update public.services
   set card_fee_mode = 'custom',
       card_fee_custom_cents = 450
 where name = 'Gel polish';

-- "Spa pedicure" with a supply deduction.
update public.services
   set supply_amount_cents = 500,
       supply_label = 'Chrome powder'
 where name = 'Spa pedicure';

-- "Nail art" with both a custom fee AND a supply.
update public.services
   set card_fee_mode = 'custom',
       card_fee_custom_cents = 600,
       supply_amount_cents = 800,
       supply_label = 'GelX tips & gel'
 where name = 'Nail art';

-- Make one service "fully exempt" (no fees, no supply) to exercise the muted "No fees" chip.
update public.services
   set card_fee_mode = 'exempt'
 where name = 'Classic manicure';
```

After these updates, the catalog list shows: one default chip, one custom chip, one supply chip, one combined (custom + supply) chip, and one muted "No fees" chip — covering every render path in `deduction-chips.tsx`.

## 4. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000/services. You should see:

- The page renders as a two-pane grid: left pane ~440px wide showing the grouped catalog list with deduction chips on every row; right pane showing the empty-state inspector "Pick a service / Select a service on the left to edit, or add a new one."
- Clicking any row immediately re-renders the right pane in edit mode pre-filled for that service. No drawer slides in. The list stays visible.
- The panel's Deductions section is below the existing service fields. It shows the three-way Segmented control (Default · $3 · Custom · Exempt), the Supply row with toggle + (conditional) inputs, and the Net to tech (card) preview at the bottom.
- Type into the price field. The Net to tech amount updates within 100ms.

## 5. Manual verification — User Stories

Follow each in order.

### US1 — Two-pane layout

1. `localhost:3000/services` — empty-state panel visible on the right.
2. Click a row — panel re-renders in edit mode for that service. List remains visible.
3. Edit the name to `Gel polish v2`. Save changes. Toast "Changes saved" appears; the list row updates in place; the panel stays open in edit mode.
4. Click "Add service" — panel switches to add mode with a fresh draft.
5. Type a draft name `Test`. Click a different list row — `<DiscardChangesDialog>` appears. Click Cancel — panel stays on the in-progress draft with `Test`. Click the row again, then Discard — panel switches to that service in edit mode.

### US2 — Card-fee mode

1. Open any service. Confirm the Segmented control reads `Default · $3 · Custom · Exempt` and the active option is `Default · $3`.
2. Click Custom. Confirm the custom amount input appears with placeholder `0.00` and focus.
3. Type `4.50`. Save. Confirm the list row shows a blue `$4.50 card fee` chip and the panel re-baselines.
4. Click Default. Save. Confirm the chip flips to `$3 card fee` and the custom input disappears.
5. Click Exempt. Save. Confirm the muted `No fees` chip appears (assuming no supply on this service).
6. Try typing `60` into a custom amount input — confirm the inline hint "Card fee can't exceed $50." appears and Save stays disabled.

### US3 — Supply deduction

1. Open any service with Supply off. Confirm the Supply toggle is off and the amount/label inputs are not rendered.
2. Flip the toggle on. Confirm the amount input pre-fills with `5.00` and the label input is empty with focus + placeholder. Type `GelX tips & gel` in the label. Save. Confirm the amber `$5 GelX tips & gel` chip appears on the list row.
3. Flip the toggle off. Save. Confirm the chip disappears and re-opening the panel shows Supply off with no amount/label values surfaced.
4. Try typing `0` into the amount input with Supply on — confirm "Enter a positive amount up to $50, or turn Supply off." appears and Save stays disabled.
5. Try typing a 70-char label — confirm a character counter appears within the last 8 chars and the count exceeds the limit; Save stays disabled with "Label must be 64 characters or fewer."

### US4 — Net to tech preview

1. Open a service with price `$50`, card-fee Default ($3), Supply on with `$5 chrome`. Confirm the preview reads `$42` with breakdown `$50 service`, `−$3 card fee`, `−$5 chrome`.
2. Change the price input to `60` (no save). Confirm the preview re-computes to `$52` within ~100ms.
3. Switch to Exempt. Confirm the preview becomes `$55` and the `−$3 card fee` line is omitted.
4. Toggle Supply off. Confirm the preview becomes `$60` and the supply line is omitted.

### US5 — Role-gated read-only state

1. Switch operator to a `technician` via the Switch Staff button (or seed a tech PIN session).
2. Navigate to `/services`. Confirm every deduction chip renders on the list rows.
3. Click a row. Confirm the Segmented control, the Custom amount input, the Supply toggle, the amount/label inputs, and the Save button are all disabled with the tooltip "Only owners and managers can edit the catalog."
4. Confirm the Net to tech preview still renders correctly (read-only by nature).

## 6. Visual fidelity check

Per CLAUDE.md § "When you change UI":

1. Open `design-system/preview/services-v1.html` in a browser (or open `design-system/ServicesV1.jsx` in a code editor) and compare side-by-side with `localhost:3000/services` at the same viewport (1024×720 minimum).
2. Verify: panel container surface + shadow; chip palette (blue / amber / muted); Segmented control's selected-pill shadow; Supply row's `100px 1fr` grid; Net-to-tech amount font size + tabular numerals + breakdown alignment; the right-aligned amount in the list row's duration/price band.
3. Run the design-auditor agent against the surface (it runs automatically on UI-touching phases via the existing `speckit-design-auditor` workflow).

## 7. Pre-push gates

Final gate (before opening the PR):

```bash
npm run format:check && \
npm run lint && \
npm run typecheck && \
npm test && \
npm run test:e2e
```

The Playwright e2e (`services-deductions.spec.ts`) needs the local Supabase running:

```bash
supabase start
npm run test:e2e
```

`PLAYWRIGHT_PROD=1 npm run test:e2e` opts into the prebuilt server (recommended in CI parity).

## 8. Deployment

The migration is applied automatically on:
- PR open / synchronize → `db-migrate-preview.yml` applies to the preview Supabase project.
- Push to `main` → `db-migrate-prod.yml` applies to the production Supabase project.

**Do not run `supabase db push` against hosted projects by hand** unless explicitly recovering from a CI failure (per Constitution v1.0.3 "Schema drift forbidden").

## 9. Rollback

If a runtime regression appears after deploy:
1. Revert the PR — the migration's columns are added with safe defaults; rolling back the Server Action and UI code leaves the columns in place but unused, which is safe.
2. If a hard schema rollback is required, apply `0017_services_deductions_rollback.sql` (not committed; reach out to the maintainer first) following the SQL outlined in `contracts/db-migration.contract.md § 9`. This is destructive — deduction values are lost.

The default disposition on a regression is **forward-fix**: a follow-up migration that corrects the issue, not a column drop.
