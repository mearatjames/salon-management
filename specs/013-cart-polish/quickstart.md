# Quickstart — Checkout — Cart Polish

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

This walkthrough gets a developer from a clean checkout of branch `worktree-013-cart-polish` to a working cart-polish flow on their machine, with the local quality gates green, ready to start `/speckit-tasks`.

Estimated time: 30 minutes if Supabase is already installed locally.

---

## 0. Prerequisites

- Node 22, npm 10.
- Supabase CLI installed (`brew install supabase/tap/supabase`) and Docker running.
- `.env.local` populated per `README` (Supabase project keys, `SALON_TZ`).
- Branch / worktree: `worktree-013-cart-polish` at `.claude/worktrees/013-cart-polish/` — this quickstart assumes you're working in the worktree.
- Dependencies installed inside the worktree: `npm install` (the worktree has its own `node_modules`).

Phase 2 is the prerequisite feature for this phase; assume `specs/011-cash-sale-checkout/` is fully landed (it is, on `main`).

---

## 1. Apply the new migration locally

```bash
supabase start                    # local Supabase if not already up
supabase db reset                 # rebuilds local DB from supabase/migrations/* + seed.sql
```

Confirm the new migration lands:

```bash
supabase db diff                  # should show "no differences"
psql "$LOCAL_SUPABASE_URL" -c "\d public.ticket_items"   # should show discount_pct + note + the kind-conditional CHECK
psql "$LOCAL_SUPABASE_URL" -c "\d public.services"       # should show the presets column
psql "$LOCAL_SUPABASE_URL" -c "select key, value from public.settings"  # should list four rows
```

The hosted preview/prod projects auto-apply the migration via
`.github/workflows/db-migrate-{preview,prod}.yml` on PR / push — do not
`supabase db push --linked` from your machine (Constitution § Schema drift forbidden).

---

## 2. Seed update

`supabase/seed.sql` is modified in this phase to set `presets` on the `Nail art · medium` service row (see `data-model.md § 2`). Re-seeding:

```bash
supabase db reset                 # truncates + re-runs seed.sql
```

You should now see:

```bash
psql "$LOCAL_SUPABASE_URL" \
  -c "select name, presets from public.services where name = 'Nail art · medium'"
```

…returning a row whose `presets` column is a 3-element JSON array of `{ label, price_cents }`.

---

## 3. Build order (red → green)

Per Constitution Principle IV (Test-First on money paths) and Tang Nails' "scoped intermediate gates" convention (`CLAUDE.md`), this is the recommended order:

### 3a. Unit tests first (Vitest, red)

Write these tests before the implementation. They will fail until step 3c/3d lands:

1. `tests/unit/checkout/cart-totals.test.ts` (MODIFY — phase 2 file gets new cases):
   - `computeTotals([fixed(20), flatDiscount(5)])` → subtotal 1500, total 1500
   - `computeTotals([fixed(20), percentDiscount(10)])` → subtotal 1800, total 1800
   - `computeTotals([fixed(20), flatDiscount(30)])` → subtotal 0, total 0 (floored), `chargeEligible=false`
   - `computeTotals([fixed(20), unconfirmed(), flatDiscount(5)])` → `chargeEligible=false` because of the unconfirmed line, but the discount still applies to the displayed subtotal

2. `tests/unit/checkout/set-line-price-action.test.ts` (NEW):
   - Happy path on an unconfirmed service line → row updated, `price_unconfirmed=false`, totals recomputed, `line.price_set` audit row written.
   - Override path on a confirmed line → same result; audit payload `was_unconfirmed=false`.
   - Attempt to set price on a `kind='discount'` line → throws `InvalidPriceError`.
   - Attempt to set price ≤ 0 → throws `InvalidPriceError` (server-side defense even though zod catches client-side).

3. `tests/unit/checkout/add-discount-line-action.test.ts` (NEW):
   - Flat `value: 1000` on a $30 cart → discount line inserted with `unit_price_cents=-1000`, `discount_pct=null`, total = $20.
   - Percent `value: 15` on a $30 cart → discount line inserted with `unit_price_cents=-450` (computed by recompute) and `discount_pct=15`.
   - Percent `value: 0` → throws `DiscountInvalidError{reason: 'percent_out_of_range'}`.
   - Note > 80 chars → zod rejects.
   - After insert, simulate `addServiceLine` → percent discount recomputes against new subtotal.

4. `tests/unit/checkout/email-bill-stub-action.test.ts` (NEW):
   - Valid address → returns `{ ok: true }` AND a `bill.emailed` audit row is written (`recordAudit` mock asserts call).
   - Invalid address (`"not an email"`) → throws `EmailAddressInvalidError`; no audit call made.
   - Empty address → throws.

Run: `npm test`. Expect red.

### 3b. Schema migration (green for "tables/columns exist")

Create `supabase/migrations/0005_cart_polish.sql` per `data-model.md`. Apply locally:

```bash
supabase db reset
```

You can sanity-check the kind-conditional CHECK manually:

```bash
psql "$LOCAL_SUPABASE_URL" -c "
  insert into public.ticket_items (ticket_id, kind, ref_id, name_snapshot, unit_price_cents)
  values ('<some-existing-ticket-uuid>', 'discount', '<some-service-uuid>', 'bogus', -1000)
"
# should fail with: new row for relation "ticket_items" violates check constraint "ticket_items_kind_columns_chk"
```

### 3c. Server Actions (green for unit tests)

Modify `app/(studio)/checkout/actions.ts` to add the four new actions per `contracts/server-actions.md`; modify `app/(studio)/checkout/_errors.ts` to add the three new error subclasses; extend `lib/auth/audit.ts` per `contracts/audit.contract.md` (add the four verbs to the union, add three prefix branches to `deriveEntityType`).

Create `lib/settings/read.ts` with the small `getSetting<T>(key)` helper.

Extend `recomputeTicketTotals` in `actions.ts` per research.md § R18 (fold discount lines into the running total; write back percent-discount amounts).

Run: `npm test`. Expect green on the four unit suites.

### 3d. UI components and pages

Replace `components/lacquer/checkout/variable-price-placeholder-dialog.tsx` with `components/lacquer/checkout/price-sheet.tsx` adapted 1:1 from `design-system/prototypes/transaction/components.jsx::PriceSheet`. The component takes `{ item, isOverride, onSave, onCancel, onRemove? }` per research.md § R10.

Create `components/lacquer/checkout/discount-sheet.tsx` (small new component; shadcn/ui Dialog + RadioGroup + Input + Label).

Create `components/lacquer/checkout/bill-sheet.tsx` adapted 1:1 from `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet`. Use `lucide-react`'s `Mail` and `Printer` icons (replacing the inline-SVG shim from the prototype).

Create `components/lacquer/checkout/email-bill-dialog.tsx` for the address-entry dialog opened from the BillSheet's Email button.

Modify `components/lacquer/checkout/cart-row-with-tech.tsx`:
- Tap-on-price-button opens `<PriceSheet isOverride={!row.price_unconfirmed} />` (replacing the placeholder dialog wire-up).
- For `kind='discount'` rows, render a discount-row layout (name + optional note + negative amount in the destructive token).
- Highlight ring on `price_unconfirmed=true` rows.

Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`:
- Wire auto-open of `<PriceSheet/>` on add of a variable service (driven by `addServiceLine`'s return).
- Add the `+ Discount` affordance in the cart header.
- Add the `Bill` button in the cart footer alongside Charge.
- Mount `<PriceSheet/>`, `<DiscountSheet/>`, `<BillSheet/>`, `<EmailBillDialog/>` as modals controlled by local state.
- Capture a frozen snapshot of the cart when opening BillSheet (research.md § R14).

Modify `app/(studio)/checkout/checkout.css` to add the print-only block scoped to `.lacquer-bill-doc` per research.md § R13.

### 3e. End-to-end tests (Playwright, red → green)

Write these before the integration is fully wired (or alongside, depending on your style — but they MUST exist before the phase is called done).

1. `tests/e2e/checkout-variable-price.spec.ts` (NEW) — describe block: `"US1: Variable price entry"`. Verifies:
   - Tapping a variable-priced service tile opens the price sheet automatically with the row in the unconfirmed-price state.
   - Charge button reads "Set price on highlighted items" while unconfirmed.
   - Preset chip click sets the working amount.
   - Quick adjuster (+$5) nudges the working amount.
   - Tap the amount → numpad opens; first keypress replaces.
   - Save closes the sheet, clears the highlight, and enables Charge.

2. `tests/e2e/checkout-price-override.spec.ts` (NEW) — describe block: `"US2: Row-level price override"`. Verifies:
   - Tap on a confirmed row's price button opens the price sheet pre-filled with the row's current amount and shows no Remove button.
   - Save updates only that row; total recomputes.
   - The catalog row is unchanged (re-add the same service to a new ticket → it appears at the original catalog price).
   - Cancel leaves the row untouched.

3. `tests/e2e/checkout-discount.spec.ts` (NEW) — describe block: `"US3: Discount lines"`. Verifies:
   - `+ Discount` in the cart header opens the discount sheet with two shape options.
   - Flat amount + a note: a discount line appears with the note as the row label suffix; total recomputes.
   - Percent amount: discount line shows the recomputed amount; adding a new service line re-recomputes the discount amount.
   - Removing the discount via the row's remove control recomputes the total back.
   - Over-discount (flat amount > service subtotal): displayed total is $0, Charge is disabled.

4. `tests/e2e/checkout-bill.spec.ts` (NEW) — describe block: `"US4: Bill preview"`. Verifies:
   - Bill button opens the sheet over the cart with masthead, items, totals, suggested gratuity.
   - The sheet is a frozen snapshot: edits to the cart underneath do not mutate the sheet.
   - `await page.emulateMedia({ media: 'print' })` then snapshot the DOM: `.lacquer-bill-doc` is visible; `.studio-chrome`/sidebar/cart elements are `visibility: hidden`.
   - Email button opens the email dialog.
   - Valid address submit shows a success toast AND writes a `bill.emailed` audit row (asserted via `getAuditLogRowsSince()` from `tests/e2e/_db.ts`).
   - Invalid address submit shows inline error and does NOT write an audit row.

Run with the existing parallel-workers default (the e2e parallelism work landed in phase 2):

```bash
npm run test:e2e -- -g "US1"   # scoped intermediate gate (variable price)
npm run test:e2e -- -g "US3"   # discount
# … etc.
npm run test:e2e               # full suite
```

For the intermediate gate scoping convention, see `CLAUDE.md` § "Scoping intermediate phase gates."

---

## 4. Walk the flows by hand

With `npm run dev` running on a port that doesn't conflict with other Claude sessions (e.g., `PORT=3001 npm run dev`):

### 4a. Variable price (US1)

1. Sign in, pick a staff at `/select-staff`.
2. From `/dashboard`, click **New transaction** → land on `/checkout/<uuid>`.
3. Pick a tech in the tech row.
4. Tap **Nail art · medium** (the variable-priced service). Expect: row appended in unconfirmed state (highlighted), price sheet opens automatically.
5. Tap the "Medium · $45" preset chip. Tap **+ $5**. Working amount shows $50.
6. Tap the displayed amount → numpad pops; type `60`. Working amount shows $60.
7. Tap **Set $60**. Sheet closes, row highlight clears, Charge button reads **Charge $60.00** and is enabled.

### 4b. Price override (US2)

1. Continue the same cart from 4a (or start fresh with a fixed-price service).
2. Tap a fixed-price row's price button. Expect: price sheet opens pre-filled with the row's current amount; Remove button is NOT shown.
3. Tap **− $10**, then **Set …**. Row updates; total recomputes.
4. Verify the catalog is unchanged: open `/settings/services`, look at the same service — its catalog price is unchanged.

### 4c. Discount (US3)

1. In a cart with at least one priced service line, click **+ Discount** in the cart header.
2. Pick **Flat amount**, type `1000` (or whatever cents UI lets you enter — the discount dialog uses dollar input), enter note "Loyalty perk", click **Add discount**. Expect: a discount row appears under services showing the note and a negative amount.
3. Tap **+ Discount** again, pick **Percent**, type `15`, click **Add discount**. Expect: a second discount row showing the recomputed negative amount.
4. Add another fixed-price service tile to the cart. Expect: the percent discount's amount recomputes against the new subtotal automatically.
5. Remove the flat discount. Expect: total recomputes back up.

### 4d. Bill preview (US4)

1. In a cart with at least one priced service line and a tech picked, click **Bill** in the cart footer.
2. Expect: bill sheet opens over the cart with the salon masthead (Tang Nails / 218 Hayes St / 415 …), the line items, the subtotal/tax/total, and three suggested-gratuity rows (18/20/25%).
3. Click **Print bill**. Browser print dialog opens. In the preview: only the bill renders — no sidebar, no cart, no studio chrome.
4. Close the print dialog. Click **Email**. Type a valid email (e.g., `you@example.com`). Submit. Expect: success toast "Bill emailed to you@example.com" and the audit log gains a `bill.emailed` row (verify via `select * from audit_log where action='bill.emailed'`).
5. Click **Email** again; type `not-an-email`; submit. Expect: inline validation error, no toast, no new audit row.

---

## 5. Walk the failure paths

- **Charge while a row is unconfirmed**: add a variable service, Cancel the auto-opened price sheet (don't Save and don't Remove). The row stays in the cart in the unconfirmed state. The Charge button reads "Set price on highlighted items" and is disabled. Tap the row's price button to re-open the sheet.
- **Over-discount**: add a $30 service, then add a flat $50 discount. Displayed total floors to $0; Charge is disabled. Remove the discount or reduce it to proceed.
- **Discount on empty cart subtotal**: open `+ Discount`, pick Percent, type `15`. The discount line is added with `unit_price_cents=0` (15% of $0 is $0). Adding a service later recomputes the discount.
- **Email validation bypass**: open browser devtools, manually call `emailBillStub({ ticketId, address: 'not-an-email', snapshot: … })` via a Server Action invocation. Expect: server throws `EmailAddressInvalidError`; no audit row written. (Defense-in-depth check.)

---

## 6. Side-by-side design review

Per Constitution Principle I and `CLAUDE.md` § "When you change UI":

1. Open `design-system/prototypes/transaction/components.jsx` (PriceSheet) and `design-system/prototypes/transaction/FlowSingleExtras.jsx` (BillSheet) in your editor. Open the rendered `design-system/preview/Transaction Flows.html` in a browser at studio width.
2. Open your `/checkout/<id>` in another browser tab and reproduce both sheets.
3. Check each value (color, spacing, radius, shadow, type) traces to a token in `styles/tokens.css`.
4. Specifically verify:
   - The price sheet's quick-adjuster row has exactly five buttons: −$10, −$5, +$5, +$10, +$20.
   - The preset chip row is HIDDEN when the service has no presets.
   - The numpad replaces the working amount on first press after open (fresh-edit affordance).
   - The discount sheet uses RadioGroup (not a tabbed control) for the shape toggle, matching the small-sheet convention of other studio sheets.
   - The bill sheet's footer has Back, Email, Print bill — in that order — and the Print bill is the primary (filled) button.
   - The bill sheet's masthead matches the prototype's Lacquer Salon layout.

---

## 7. Run the full local gate set

Per `CLAUDE.md` § "Pre-push quality gates", in this order:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

All five MUST be green locally. CI runs the same commands and a missed one will bounce the PR.

For intermediate phase gates (per `CLAUDE.md` § "Scoping intermediate phase gates"), use the scoped variants:

```bash
npx playwright test tests/e2e/checkout-variable-price.spec.ts -g "US1"
npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)
npx eslint   $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)
npm run typecheck
npm test
```

The full suite is the final gate before the feature is considered done.

---

## 8. Hand off to `/speckit-tasks`

When all of the above is green, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and this quickstart are complete and consistent.

Next: run `/speckit-tasks` to generate the dependency-ordered task breakdown.
