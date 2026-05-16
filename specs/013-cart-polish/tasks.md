---

description: "Task list for Checkout — Cart Polish (Variable Pricing, Discounts, Bill Preview)"
---

# Tasks: Checkout — Cart Polish (Variable Pricing, Discounts, Bill Preview)

**Input**: Design documents from `/specs/013-cart-polish/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/server-actions.md](./contracts/server-actions.md), [contracts/audit.contract.md](./contracts/audit.contract.md), [quickstart.md](./quickstart.md).

**Tests**: REQUIRED. Constitution Principle IV (Test-First for Critical Paths) covers Charge eligibility (the discount floor at $0 and the unconfirmed-line gate) — this phase's polish touches the money critical path even though no new payment method is added. This task list sequences tests before implementation in every phase. `test:e2e` invocations use the project default (parallel workers, scoped via `-g "USn"` at intermediate gates per `CLAUDE.md`).

**Organization**: Tasks are grouped by user story so each story can ship independently. MVP scope is Phase 1 + Phase 2 + Phase 3 (US1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories — [US1], [US2], [US3], [US4]
- Setup, Foundational, and Polish tasks have no story label.

## Path Conventions

Repo root: this is the worktree at `/Users/mearathou/Dev/salon-management/.claude/worktrees/013-cart-polish/`. Paths below are repo-relative (e.g., `app/(studio)/checkout/actions.ts`). Single Next.js project — Option 1 from the template, as recorded in `plan.md` § Project Structure. The route group `(studio)` and `components/lacquer/checkout/` already exist from phase 2.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the one new directory this feature owns. The repo and the checkout subtree are already scaffolded by phase 2; this phase is intentionally tiny.

- [ ] T001 [P] Create `lib/settings/` directory so subsequent file-creation tasks have a target. No code change.

**Checkpoint**: Directory exists; feature work can proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema migration, types regen, audit-vocabulary additions, error classes, settings reader, and the cart-totals helper extension — every user story depends on these.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Schema (data-model.md)

- [ ] T002 Create `supabase/migrations/0005_cart_polish.sql` per `data-model.md` §§ 1–5: (a) `alter type public.ticket_item_kind add value 'discount'`; (b) `ticket_items` column adds (`discount_pct numeric(5,2) null`, `note text null`) + nullability relax on `ref_id` and `assigned_staff_id`; (c) drop the existing `ticket_items_unit_price_cents_check` constraint and add the kind-conditional replacement (`service ≥ 0`, `discount ≤ 0`), the note-length CHECK, and the `ticket_items_kind_columns_chk` constraint; (d) `services` column add (`presets jsonb null`) + array-shape CHECK; (e) `public.settings` table + RLS `select-to-authenticated` + `settings_set_updated_at` trigger + seed rows (`salon.name`, `salon.address`, `salon.phone`, `discount.manager_threshold_cents`); (f) `create or replace function public.pos_take_cash(...)` re-emitting the body unchanged from `0004`, plus the `revoke all … from public` / `grant execute … to service_role` re-emit.
- [ ] T003 Run `supabase db reset` locally to apply the new migration; verify `\d public.ticket_items` shows the new columns + the kind-conditional CHECK, `\d public.services` shows `presets`, and `select key from public.settings order by key` lists four rows.
- [ ] T004 Update `supabase/seed.sql` to set the `presets` JSON array on the `Nail art · medium` service row per `data-model.md` § 2 (3 entries: Small / Medium / Large). Re-run `supabase db reset`; confirm `select name, presets from public.services where name='Nail art · medium'` returns a row whose `presets` is a 3-element JSON array.
- [ ] T005 Regenerate `lib/db/types.ts` from the updated schema (`supabase gen types typescript --local > lib/db/types.ts` — match the convention used by phase 2's migration). Confirm the new `discount_pct`, `note`, `presets`, and `settings` types appear.

### Audit vocabulary (contracts/audit.contract.md)

- [ ] T006 Extend `AuditAction` in `lib/auth/audit.ts` with the four new verbs (`line.price_set`, `discount.added`, `discount.removed`, `bill.emailed`) and extend `deriveEntityType` to dispatch the `line.*`, `discount.*`, and `bill.*` prefixes — all map to `"ticket"`. No call sites yet — additions only.

### Error classes (contracts/server-actions.md)

- [ ] T007 Extend `app/(studio)/checkout/_errors.ts` with the three new error subclasses per `contracts/server-actions.md § Type exports`: `InvalidPriceError`, `DiscountInvalidError` (with `reason` field: `'flat_value_non_positive' | 'percent_out_of_range' | 'note_too_long' | 'not_a_discount_line'`), and `EmailAddressInvalidError`. Widen `CheckoutActionError` to include the three new codes.

### Settings reader

- [ ] T008 [P] Create `lib/settings/read.ts` exporting `export async function getSetting<T = unknown>(key: string): Promise<T | null>` per `research.md § R12`. Uses the service-role Supabase client from `lib/db/admin.ts`. Returns `data?.value as T` on hit, `null` on miss. Server-only — file MUST live outside any `"use client"` boundary.

### Cart-totals helper extension + unit test (red → green)

- [ ] T009 [P] Modify `tests/unit/checkout/cart-totals.test.ts` (existing from phase 2) to add the new cases per `quickstart.md § 3a`: (a) `computeTotals([fixed(20), flatDiscount(5)])` → subtotal 1500, total 1500; (b) `computeTotals([fixed(20), percentDiscount(10)])` → subtotal 1800, total 1800; (c) `computeTotals([fixed(20), flatDiscount(30)])` → subtotal 0, total 0 (floored), `chargeEligible=false`; (d) `computeTotals([fixed(20), unconfirmed(), flatDiscount(5)])` → `chargeEligible=false` due to unconfirmed line. These cases are the red baseline before T010 lands.
- [ ] T010 Extend `lib/pos/cart.ts` (existing from phase 2): teach `computeTotals` about discount lines (`kind === 'discount'`). New rules: service subtotal = sum over `kind='service' && !priceUnconfirmed`; for percent-discount items, compute amount = `-round(pct * service_subtotal / 100)`; discount total = sum of all `kind='discount'` amounts (negative); final `subtotalCents = max(0, service_subtotal + discount_total)`; `totalCents = subtotalCents`; `chargeEligible = totalCents > 0 && items.every(i => !i.priceUnconfirmed)`. Make T009's tests pass.

### Server-action recompute helper extension (action-layer counterpart to T010)

- [ ] T011 Extend the `recomputeTicketTotals` helper inside `app/(studio)/checkout/actions.ts` per `research.md § R11 + § R18`: change the SELECT to include `kind, discount_pct`; for each row where `kind='discount' && discount_pct is not null`, UPDATE the row's `unit_price_cents` to the freshly recomputed `-round(pct * service_subtotal / 100)` (only when the recomputed value differs from the stored one — guard with `if (newAmount !== row.unit_price_cents)`); re-read or fold the discount rows' new amounts in memory; write `tickets.subtotal_cents = max(0, service_subtotal + discount_total)`, `tickets.total_cents = subtotal_cents` (tax stays 0). The helper signature and call sites in phase 2's `addServiceLine` / `removeLine` stay unchanged.

**Checkpoint**: Schema + types + audit + errors + settings reader + cart-totals (pure + server-helper) all support discount lines and percent recompute. User-story phases can now begin.

---

## Phase 3: User Story 1 — Set the price on a variable-priced service before charging (Priority: P1) 🎯 MVP

**Goal**: Tapping a `variable=true` service tile appends a cart row in the unconfirmed-price state AND auto-opens a real price-entry sheet (replacing phase 2's placeholder dialog). Quick adjusters, optional presets, tap-to-reveal numpad, Save clears the unconfirmed flag and enables Charge, Cancel just closes, Remove deletes the row (only when unconfirmed). Covers FR-001 — FR-008, FR-010 (Charge button hint), and the parts of FR-029 / FR-030 that drive the sheet (the `presets` column read + the existing variable-price columns surface).

**Independent Test**: Sign in, click "New transaction" on the dashboard, pick a tech, tap the `Nail art · medium` tile, verify the price sheet auto-opens, tap the "Medium · $45" preset, tap "+ $5", tap Save, verify the cart row shows $50, the highlight clears, and the Charge button reads "Charge $50.00" and is enabled. SC-001, SC-002.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [ ] T012 [P] [US1] Write `tests/unit/checkout/set-line-price-action.test.ts`: mock the service-role supabase client. Cover (a) happy path on an unconfirmed service row → row updated, `price_unconfirmed=false`, totals recomputed, `line.price_set` audit row written; (b) override path on a confirmed row → same result, audit payload `was_unconfirmed=false`; (c) attempt on a `kind='discount'` row → throws `InvalidPriceError` (mock returns a row with `kind='discount'`); (d) `unitPriceCents <= 0` → throws `InvalidPriceError` (server-side defense). Red baseline before T015.
- [ ] T013 [P] [US1] Write `tests/e2e/checkout-variable-price.spec.ts`. Describe block: `"US1: Variable price entry"`. Covers US1 acceptance scenarios 1–7: (a) tile tap auto-opens the price sheet AND row lands unconfirmed AND Charge reads "Set price on highlighted items"; (b) preset chip click sets the working amount and enables Save; (c) quick adjuster +$5 nudges; (d) tap the amount → numpad pops; first keypress replaces; (e) Save closes sheet, clears highlight, Charge enables and reads "Charge $X". Asserts at DB level: `ticket_items.unit_price_cents` matches the entered amount and `price_unconfirmed=false`; `audit_log` has a fresh `line.price_set` row scoped via `newAuditCursor()` + `getAuditLogRowsSince()` from `tests/e2e/_db.ts`.

> Run `npm test && npm run test:e2e -g "US1"`. T012 should fail (no `setLinePrice` yet). T013 should fail at the auto-open or the missing PriceSheet. Move on once you've confirmed they're red.

### Server Action (US1-specific)

- [ ] T014 [US1] Implement `setLinePrice(input)` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md § 1`: validate session, UUID-validate `ticketId` + `lineId`, refuse if ticket not open (`TicketNotOpenError`), read the named line, refuse if not on this ticket (defensive `Error`), refuse if `kind='discount'` (`InvalidPriceError("cannot price-override a discount row")`), refuse if `unitPriceCents <= 0` (`InvalidPriceError`). Capture `previous_unit_price_cents` and `was_unconfirmed` before the write. UPDATE the row's `unit_price_cents` and set `price_unconfirmed = false`. Call `recomputeTicketTotals` (extended in T011). Emit `line.price_set` audit with `payload = { ticket_id, previous_unit_price_cents, new_unit_price_cents, was_unconfirmed }`. Return `{ subtotalCents, totalCents }`.

### UI components (parallelizable — separate files)

- [ ] T015 [P] [US1] Create `components/lacquer/checkout/price-sheet.tsx` adapted 1:1 from `design-system/prototypes/transaction/components.jsx::PriceSheet`. Props: `{ item: CartLine, isOverride: boolean, onSave: (cents: number) => void, onCancel: () => void, onRemove?: () => void }`. Wiring per `research.md § R10`: Remove rendered only when `!isOverride && item.price_unconfirmed`; Cancel always just closes (per clarification); Save enabled only when working amount > 0 (FR-006); quick adjusters −$10/−$5/+$5/+$10/+$20 with clamp at 0 (FR-004); preset chips rendered only when `item.service?.presets?.length > 0` (FR-003) — chip label/price comes from the array element; numpad-on-tap with fresh-edit affordance (FR-005). Context note string: variable → `"Varies $X–$Y · {note}"` from the service's `price_from_cents` / `price_to_cents` / `variable_price_note`; confirmed → `"Adjust price for this sale"`. Lacquer tokens only; tabular numerals on the working-amount display.
- [ ] T016 [P] [US1] DELETE `components/lacquer/checkout/variable-price-placeholder-dialog.tsx`. Its phase-2 placeholder is fully superseded by `price-sheet.tsx`. Remove any lingering imports — the only known caller is `cart-row-with-tech.tsx`, which T017 rewires.

### Cart row + client-island wiring

- [ ] T017 [US1] Modify `components/lacquer/checkout/cart-row-with-tech.tsx`: replace the `<VariablePricePlaceholderDialog/>` wire-up with a callback to the parent that asks it to open `<PriceSheet/>` with the right `isOverride` prop. Tapping the price button on a confirmed row sends `isOverride=true`; on an unconfirmed row sends `isOverride=false`. Highlight ring on `price_unconfirmed=true` rows (matches the prototype's `.variable` class via the existing token-scoped CSS).
- [ ] T018 [US1] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`: (a) hold `priceSheet` local state `{ lineId: string; isOverride: boolean } | null`; (b) when `addServiceLine` returns a row with `price_unconfirmed: true`, set `priceSheet = { lineId, isOverride: false }` so the sheet auto-opens (FR-001); (c) on `cart-row-with-tech` callback, set `priceSheet` accordingly; (d) mount `<PriceSheet item={…} isOverride={…} onSave={(cents) => setLinePrice({…, unitPriceCents: cents})} onCancel={() => setPriceSheet(null)} onRemove={…} />` when state non-null; (e) wire `onRemove` to the existing `removeLine` action (only when `!isOverride && item.price_unconfirmed`); (f) ensure Charge button label/disabled state uses `computeTotals(localItems).chargeEligible` AND reads `"Set price on highlighted items"` when any line carries `price_unconfirmed=true` (FR-010, already partially wired in phase 2 — confirm + extend).

### Verification

- [ ] T019 [US1] Scoped intermediate gate per `CLAUDE.md § Scoping intermediate phase gates`: `npm test` (T012 green) and `npx playwright test tests/e2e/checkout-variable-price.spec.ts -g "US1"` (T013 green). Then run scoped Prettier + ESLint over the diff: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` and `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)`. `npm run typecheck` stays full-suite.

**Checkpoint**: US1 is fully functional. Variable-priced services can be added, priced via the sheet (preset / adjuster / numpad), and the cart's Charge button transitions disabled → enabled. The placeholder dialog from phase 2 is gone.

---

## Phase 4: User Story 2 — Override the snapshotted price on any cart row for one sale (Priority: P2)

**Goal**: Tapping the price button on a confirmed cart row opens the same `<PriceSheet/>` in override mode (no Remove button) pre-filled with the row's current amount. Save mutates only that row's `unit_price_cents`; the catalog row is untouched. Covers FR-009, FR-011, US2 acceptance scenarios 1–5.

**Independent Test**: With US1 complete, start a cart with a fixed-price service, tap the row's price button, set a different positive amount, save, verify the row shows the new amount, the running total recomputes, and the underlying service catalog row is unchanged. SC-003.

### Tests for User Story 2

- [ ] T020 [P] [US2] Write `tests/e2e/checkout-price-override.spec.ts`. Describe block: `"US2: Row-level price override"`. Covers US2 acceptance scenarios 1–5: (a) tap a confirmed row's price button → sheet opens pre-filled with current amount and shows NO Remove button; (b) Save updates only that row → cart total recomputes; (c) re-add the same service to a fresh ticket → it appears at the catalog price (override didn't propagate); (d) Cancel leaves the row unchanged; (e) over an unconfirmed row, the override path still shows Remove (US1 + US2 interaction). Assert via DB read on `services.price_cents` (unchanged) and `ticket_items.unit_price_cents` (changed only on the named row).

### Implementation

- [ ] T021 [US2] No new action needed — `setLinePrice` from T014 already handles both paths. Confirm the action's `was_unconfirmed=false` branch is exercised by adding a Vitest case to `tests/unit/checkout/set-line-price-action.test.ts` (T012) that mocks a confirmed row and asserts the audit payload reflects the override.
- [ ] T022 [US2] Confirm the wiring from T017 + T018 already supports the override path: tapping the price button on a confirmed row sends `isOverride=true` to `<PriceSheet/>`, which hides Remove per its prop contract. If the manual hand-walk reveals any wiring slip, fix it here.

### Verification

- [ ] T023 [US2] Scoped intermediate gate: `npx playwright test tests/e2e/checkout-price-override.spec.ts -g "US2"` (T020 green); `npm test` (T021 case green); re-run `-g "US1"` to confirm no regression in the auto-open path. Scoped Prettier + ESLint over the diff.

**Checkpoint**: US2 is fully functional. Operators can override the snapshotted price on any cart row without touching the catalog.

---

## Phase 5: User Story 3 — Add a discount line to the cart (Priority: P2)

**Goal**: A `+ Discount` affordance in the cart header opens a small sheet with two shapes (flat amount / percent), an optional note (max 80 chars), and persists the discount as a `ticket_items` row with `kind='discount'`. Percent discounts recompute amount against the live service-line subtotal on subsequent cart edits. Over-discount disables Charge. Covers FR-012 — FR-019, FR-031 (the `discount.manager_threshold_cents` read).

**Independent Test**: With US1 complete, add at least one service line, open `+ Discount`, pick Flat amount with a note → row appears below services with the note suffix and negative amount; pick Percent → row appears with recomputed amount; add another service → percent discount amount recomputes. SC-004, SC-005.

### Tests for User Story 3 (write FIRST, ensure they FAIL)

- [ ] T024 [P] [US3] Write `tests/unit/checkout/add-discount-line-action.test.ts`: mock supabase + `getSetting`. Cover (a) `shape='flat', value=1000` → discount row inserted with `unit_price_cents=-1000`, `discount_pct=null`, totals recomputed, `discount.added` audit with `payload.shape='flat', value=1000`; (b) `shape='percent', value=15` on a $30 service-subtotal → discount row inserted with `discount_pct=15` AND `recomputeTicketTotals` produces `unit_price_cents=-450`; (c) `shape='percent', value=0` → throws `DiscountInvalidError{reason: 'percent_out_of_range'}` (zod boundary); (d) `shape='percent', value=101` → same throw; (e) `shape='flat', value=0` → throws `DiscountInvalidError{reason: 'flat_value_non_positive'}`; (f) note 81+ chars → zod rejects; (g) `getSetting('discount.manager_threshold_cents')` mock returns null AND the action still succeeds (FR-018 — v1 read is ignored). Red baseline before T027.
- [ ] T025 [P] [US3] Write `tests/e2e/checkout-discount.spec.ts`. Describe block: `"US3: Discount lines"`. Covers US3 acceptance scenarios 1–8: (a) `+ Discount` opens sheet with two shape options; (b) Flat amount + note "Loyalty perk" → row shows note as suffix label, negative amount, total recomputes; (c) Percent 15 → row shows "-$X.XX" computed from current service subtotal; (d) adding a new service line → percent discount amount recomputes against new subtotal; (e) remove discount via row's remove control → total recomputes back; (f) over-discount (flat $50 on a $30 cart) → displayed total floors to $0 AND Charge disabled; (g) note empty → row falls back to "Discount" (flat) or "Discount · 15%" (percent); (h) note populated → row shows the note. Assert via DB on `ticket_items` rows (`kind='discount'`, `discount_pct`, `note`) and on `audit_log` via cursor.

> Run `npm test && npm run test:e2e -g "US3"`. Both should fail. Move on once red.

### Server Actions (US3-specific — sequence by file)

- [ ] T026 [US3] Implement a small naming helper inside `app/(studio)/checkout/actions.ts` (top-of-file, before the actions): `discountNameSnapshot(shape: 'flat' | 'percent', value: number): string` returning `"Discount"` for flat, `"Discount · {value}%"` for percent. Used by `addDiscountLine`. Co-located here (not exported elsewhere) because it has exactly one caller.
- [ ] T027 [US3] Implement `addDiscountLine(input)` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md § 2`: validate session, zod-parse the input, refuse if ticket not open. Per-shape validation: flat → `value > 0`; percent → `1 <= value <= 100`. Read `discount.manager_threshold_cents` via `getSetting<number | null>(…)` (ignore the return per FR-018). Insert `ticket_items` with `kind='discount'`, `ref_id=null`, `assigned_staff_id=null`, `name_snapshot = discountNameSnapshot(shape, value)`, `unit_price_cents = shape === 'flat' ? -value : 0`, `qty=1`, `discount_pct = shape === 'percent' ? value : null`, `note = input.note ?? null`. Call `recomputeTicketTotals` (this is where the percent-discount `unit_price_cents` is computed and written). Emit `discount.added` audit with `payload = { ticket_id, shape, value, note }`. Return `{ lineId, subtotalCents, totalCents }`.
- [ ] T028 [US3] Implement `removeDiscountLine(input)` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md § 3`: validate session, refuse if ticket not open, refuse if the named line is not on this ticket (defensive `Error`), refuse if `kind !== 'discount'` (`DiscountInvalidError("not a discount line")`). Capture `discount_pct`, `unit_price_cents`, `note` before delete (for audit payload reconstruction). DELETE the row. Call `recomputeTicketTotals`. Emit `discount.removed` audit with `payload = { ticket_id, shape, value, note }` where `shape = discount_pct != null ? 'percent' : 'flat'` and `value = discount_pct ?? -unit_price_cents` (back to the original positive entry).

### UI components

- [ ] T029 [P] [US3] Create `components/lacquer/checkout/discount-sheet.tsx`. Small new component (no prototype; compose from shadcn/ui primitives per `research.md § R16`). Props: `{ onSave: ({ shape, value, note }) => Promise<void>, onCancel: () => void }`. Layout: header "Add discount" + close button; body has RadioGroup ("Flat amount" / "Percent"), Amount input (dollar input for flat, integer 0–100 for percent — switches via the radio), Note input with 80-char counter; footer has Cancel + "Add discount" buttons. Save calls `onSave` and disables itself while pending. All values resolve to tokens in `styles/tokens.css`; tabular numerals on the amount display.
- [ ] T030 [US3] Modify `components/lacquer/checkout/cart-row-with-tech.tsx` to render `kind='discount'` rows in a discount-row layout: row name = `name_snapshot`; if `note` is set, render the note as a small secondary line under or beside the name; amount in destructive token (e.g., `--destructive` text color); remove control wired to the parent's `removeDiscountLine` callback (NOT the existing service-line `removeLine`). The existing service-line rendering path stays unchanged.

### Cart-header + client-island wiring

- [ ] T031 [US3] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`: (a) add `discountSheetOpen: boolean` local state; (b) render a `+ Discount` button in the cart header (next to where the cart title sits) using `tx-btn ghost` styling consistent with the rest of the header chrome; (c) on click set `discountSheetOpen = true`; (d) mount `<DiscountSheet onSave={async ({shape, value, note}) => { await addDiscountLine({ticketId, shape, value, note}); setDiscountSheetOpen(false); }} onCancel={() => setDiscountSheetOpen(false)} />` when open; (e) wire the cart-row Remove callback for `kind='discount'` rows to call `removeDiscountLine` (and the existing `removeLine` for service rows); (f) confirm the Charge button's enable rule honors the floored total — `chargeEligible` from `computeTotals` already handles this from T010.

### Verification

- [ ] T032 [US3] Scoped intermediate gate: `npm test` (T024 green) and `npx playwright test tests/e2e/checkout-discount.spec.ts -g "US3"` (T025 green). Re-run `-g "US1"` and `-g "US2"` to confirm no regression. Scoped Prettier + ESLint.

**Checkpoint**: US3 is fully functional. Discount lines (flat + percent + optional note) can be added and removed, the cart recomputes correctly on subsequent edits, and an over-discount disables Charge.

---

## Phase 6: User Story 4 — Drop the bill: print or email an itemized check before taking payment (Priority: P2)

**Goal**: A `Bill` button in the cart footer opens a restaurant-style bill-preview sheet as an overlay (read-only snapshot of the cart at open time). Print bill uses `window.print()` against a print-only stylesheet so only the bill renders. Email opens a small dialog accepting an address; submit calls a stub Server Action that writes a `bill.emailed` audit row and toasts success without dispatching real mail. Covers FR-020 — FR-027, FR-031 (the `salon.*` settings reads for the masthead).

**Independent Test**: With US1 complete, add at least one priced service line, click `Bill` in the cart footer, verify the bill sheet opens with masthead + items + totals + suggested gratuity (18/20/25); click Print bill → browser print dialog opens, only the bill is in the print preview; click Email, enter a valid address, submit → success toast + a `bill.emailed` audit row exists. SC-006, SC-007, SC-008.

### Tests for User Story 4 (write FIRST, ensure they FAIL)

- [ ] T033 [P] [US4] Write `tests/unit/checkout/email-bill-stub-action.test.ts`: mock supabase + `recordAudit`. Cover (a) valid address → returns `{ ok: true }` AND `recordAudit("bill.emailed", deviceUserId, ticketId, { address, line_snapshot }, staffId)` was called exactly once; (b) invalid address `"not an email"` → throws `EmailAddressInvalidError` AND `recordAudit` NOT called; (c) empty address → throws; (d) snapshot field shape — full snapshot is forwarded into the audit payload verbatim. Red baseline before T036.
- [ ] T034 [P] [US4] Write `tests/e2e/checkout-bill.spec.ts`. Describe block: `"US4: Bill preview"`. Covers US4 acceptance scenarios 1–7: (a) `Bill` opens the sheet overlay; (b) sheet renders salon masthead + items + service subtotal + discount lines (if any) + total + 3 suggested-gratuity rows at 18/20/25; (c) print stylesheet hides chrome — use `await page.emulateMedia({ media: 'print' })` then assert `.lacquer-bill-doc` is visible and the studio sidebar / cart elements have `visibility: hidden`; (d) snapshot semantics — add a service line while the sheet is open; the sheet's content does NOT change; close + re-open → snapshot now reflects the new line; (e) Email submit with `"you@example.com"` → success toast "Bill emailed to you@example.com" AND a `bill.emailed` audit row exists (asserted via `getAuditLogRowsSince()`); (f) Email submit with `"not-an-email"` → inline error AND no toast AND no audit row; (g) closing the bill sheet leaves ticket status unchanged (still `open`) and no payment row was inserted.

> Run `npm test && npm run test:e2e -g "US4"`. Both should fail. Move on once red.

### Server Action (US4-specific)

- [ ] T035 [US4] Add the shared email regex constant `EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` near the top of `app/(studio)/checkout/actions.ts` (small, file-local; the client uses the same literal in T038). The constant is also referenced from `email-bill-dialog.tsx` — duplicate the literal there rather than exporting; the regex is tiny and keeping the client/server validations textually identical is the simplest spec for "they match."
- [ ] T036 [US4] Implement `emailBillStub(input)` in `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md § 4`: validate session, zod-parse the input (`ticketId`, `address`, `snapshot` — see contract for full snapshot shape), test the address against `EMAIL`. On invalid: throw `EmailAddressInvalidError` (no audit row). On valid: call `recordAudit("bill.emailed", viewer.deviceUserId, input.ticketId, { address: input.address, line_snapshot: input.snapshot }, viewer.staff.id)` and return `{ ok: true }`. Does NOT make any external network call.

### UI components (parallelizable — separate files)

- [ ] T037 [P] [US4] Create `components/lacquer/checkout/bill-sheet.tsx` adapted 1:1 from `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet`. Props: `{ snapshot: BillSnapshot, salonInfo: { name: string; address: string; phone: string }, techName: string | null, guestLabel: string, onClose: () => void, onPrint: () => void, onEmail: () => void }`. Root `<div>` carries the `lacquer-bill-doc` class (the print-CSS selector from T039 targets this). Masthead reads from `salonInfo`. Items list reads from `snapshot.lines` (both service and discount kinds; discounts render with the note suffix and a destructive-token amount). Totals block renders `serviceSubtotalCents` + `discountTotalCents` (if any) + tax (always $0 this phase) + total-before-tip. Suggested gratuity block: 3 rows at 18%, 20%, 25% over the service subtotal (matching the prototype's logic — the gratuity computes off the pre-discount service subtotal so the customer sees the typical tip line). Footer: Back (calls `onClose`), Email (calls `onEmail`), Print bill (calls `onPrint` — primary filled button). Lucide `Mail` and `Printer` icons from `lucide-react`.
- [ ] T038 [P] [US4] Create `components/lacquer/checkout/email-bill-dialog.tsx`. Small shadcn/ui Dialog. Props: `{ onSubmit: (address: string) => Promise<void>, onCancel: () => void }`. Body: a single `<Input type="email">` with the same regex literal as T035, an inline-error region under the input, and a Send button. Client-validates on Submit; on invalid → show inline error AND do NOT call `onSubmit`. On valid → `onSubmit(address)`; on rejected promise → show inline error; on resolved → call `onCancel` to close.

### Print-only CSS

- [ ] T039 [US4] Add the print-only block to `app/(studio)/checkout/checkout.css` per `research.md § R13`. Use the `body * { visibility: hidden; }` + `.lacquer-bill-doc, .lacquer-bill-doc * { visibility: visible; }` + `.lacquer-bill-doc { position: absolute; inset: 0; padding: 12mm; max-width: 80mm; background: white; }` pattern. This block is independent of phase 2's receipt-route print CSS (`.studio-chrome { display: none }`) and does not interfere with it.

### Settings + bill-snapshot wiring

- [ ] T040 [US4] Modify `app/(studio)/checkout/[ticketId]/page.tsx` (Server Component) to fetch the three salon-info settings keys in one pass via `getSetting('salon.name')`, `getSetting('salon.address')`, `getSetting('salon.phone')`, defaulting any missing key to a safe string (`"Tang Nails"`, `""`, `""`) per the spec's "Salon settings missing" edge case. Pass `salonInfo` as a prop down through `<CheckoutScreen/>` to `<BillSheet/>`.
- [ ] T041 [US4] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`: (a) add `billSnapshot: BillSnapshot | null` and `emailDialogOpen: boolean` to local state; (b) render a `Bill` button in the cart footer adjacent to Charge using token-styled `tx-btn secondary` with a Lucide `Printer` icon (the prototype shows it as the secondary button); (c) on Bill click, capture `billSnapshot = { lines: structuredClone(cart.lines), serviceSubtotalCents, discountTotalCents, totalCents, capturedAt: new Date().toISOString() }` per `research.md § R14`; (d) mount `<BillSheet snapshot={billSnapshot} salonInfo={salonInfo} techName={…} guestLabel="Walk-in client" onClose={() => setBillSnapshot(null)} onPrint={() => window.print()} onEmail={() => setEmailDialogOpen(true)} />` when snapshot non-null; (e) mount `<EmailBillDialog onSubmit={async (address) => { await emailBillStub({ ticketId, address, snapshot: billSnapshot }); toast.success(`Bill emailed to ${address}`); }} onCancel={() => setEmailDialogOpen(false)} />` when `emailDialogOpen`.

### Verification

- [ ] T042 [US4] Scoped intermediate gate: `npm test` (T033 green) and `npx playwright test tests/e2e/checkout-bill.spec.ts -g "US4"` (T034 green). Re-run `-g "US1"`, `-g "US2"`, `-g "US3"` to confirm no regression. Scoped Prettier + ESLint.

**Checkpoint**: US4 is fully functional. The bill preview opens, prints cleanly, and Email writes the audit row + toasts. All four user stories are independently working.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Pre-push readiness — design review, full gate set, manual smoke tests, marker placement.

- [ ] T043 [P] Side-by-side design review against `design-system/prototypes/transaction/components.jsx::PriceSheet` and `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet` per `CLAUDE.md § "When you change UI"`. Open both sheets in `/checkout/<id>` and compare to the prototypes (and to `design-system/preview/Transaction Flows.html` if present). Spot-check that every color/spacing/radius/shadow in the price sheet, discount sheet, and bill sheet traces to a token in `styles/tokens.css`. Document any drift as a fix-up task before proceeding.
- [ ] T044 [P] Manually walk the failure paths from `quickstart.md § 5`: (a) Cancel the auto-opened price sheet → row stays in unconfirmed state, Charge disabled, hint visible; (b) flat $50 discount on a $30 cart → total floors to $0, Charge disabled; (c) percent 15 on a $0-service-subtotal cart → discount amount is $0 (no-op-effectively); (d) bypass client-side email validation via devtools → server throws `EmailAddressInvalidError`, no audit row. Capture findings inline; fix any divergence.
- [ ] T045 Confirm the salon-info settings keys are seeded after `supabase db reset`: `select key, value from public.settings order by key` returns four rows. Then dispatch a fresh checkout, click Bill, verify the masthead shows the seeded values.
- [ ] T046 Confirm the audit trail is complete for the new verbs. After running each user-story flow, query `select action, count(*) from audit_log where action in ('line.price_set','discount.added','discount.removed','bill.emailed') group by 1`. Confirm rows match expected counts from the walk-through (T044). Spot-check the payload shape against `contracts/audit.contract.md`.
- [ ] T047 Run the full local gate set in order, per `CLAUDE.md § Pre-push quality gates`: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. Fix any failures before moving on. Recall the project default is parallel e2e workers — set `PLAYWRIGHT_PROD=1` if a CI-mirror prebuilt-server run is needed.
- [ ] T048 Open a PR; verify the preview migration GitHub Action (`db-migrate-preview.yml`) applies `0005_cart_polish.sql` to the preview Supabase project and the Vercel preview deploy comes up green against it. Coordinate with any concurrent feature work that also touches `supabase/migrations/`. (Out of subagent scope — PR opening is for orchestrator/user.)
- [ ] T049 [P] Confirm `CLAUDE.md`'s `<!-- SPECKIT START -->` block still points at `specs/013-cart-polish/plan.md` (set during `/speckit-plan`). No action needed unless drift has occurred during implementation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — no dependencies.
- **Phase 2 (Foundational)** — depends on Phase 1. BLOCKS Phases 3–6.
- **Phase 3 (US1)** — depends on Phase 2. Independently testable.
- **Phase 4 (US2)** — depends on Phase 2 AND on Phase 3 (US2 reuses the same `<PriceSheet/>` component built in T015 and the same `setLinePrice` action implemented in T014; the override path is a prop variant, not a parallel implementation).
- **Phase 5 (US3)** — depends on Phase 2. The e2e (T025) uses US1's cart UI to set up state; in practice US1 ships first.
- **Phase 6 (US4)** — depends on Phase 2. The e2e (T034) uses US1's cart UI to set up state; in practice US1 ships first.
- **Phase 7 (Polish)** — depends on every user story you intend to ship in this PR.

### Within Each User Story

- Tests are written first and asserted red before implementation begins (Constitution Principle IV; T012/T013 in US1, T020 in US2, T024/T025 in US3, T033/T034 in US4).
- Server Actions before the components that call them (T014 before T017/T018; T026/T027/T028 before T031; T036 before T041).
- Page-level Server Components before the client island that fetches/renders within them (T040 before T041).
- Per-component UI tasks marked [P] within a story are file-independent and run in any order.

### Cross-story dependencies (real)

- **T017 + T018 (cart-row + client-island wiring) in US1** is reused by US2 with no further code change — only the `isOverride` prop value differs. T022 in US2 is a verification task, not new code.
- **T030 (cart-row discount-row rendering) in US3** modifies the same file as T017 in US1; sequence T017 first, then T030 layers on the discount-row branch.
- **T031 (cart-header + client-island wiring) in US3** modifies the same file as T018 in US1; sequence T018 first, then T031 adds the discount-sheet mount + remove-callback dispatch.
- **T041 (bill-sheet + email-dialog wiring) in US4** modifies the same file as T018/T031; sequence after both.
- **T040 (Server Component salon-info fetch) in US4** is independent of US1/US2/US3 wiring and can land at any time after Phase 2's `lib/settings/read.ts` is in place (T008).

---

## Parallel Opportunities

### Phase 2 Foundational

T008 (`lib/settings/read.ts`) and T009 (cart-totals test) are [P] with each other and with T002–T007 (different files / different concerns). The migration apply (T003) and the seed update (T004) must come after T002. T010 implements against T009.

### Phase 3 US1

T012 (unit test) and T013 (e2e test) are [P] with each other. T015 (new component) and T016 (file delete) are [P] with each other and with T012/T013. T017 + T018 (same file modifications across two tasks) are NOT [P] — sequence T017 then T018.

### Phase 5 US3 — UI components

T029 (discount-sheet) and T030 (cart-row discount rendering) are [P] with each other (different files). T031 (client-island wiring) depends on both.

### Phase 5 US3 — Server actions

T026, T027, T028 all live in the same file (`actions.ts`). They are NOT [P] — sequence them as T026 (helper) → T027 (addDiscountLine) → T028 (removeDiscountLine).

### Phase 6 US4 — UI components

T037 (bill-sheet) and T038 (email-dialog) are [P] with each other (different files). T039 (CSS), T040 (Server Component fetch), T041 (client-island wiring) are sequenced: T039 + T040 are [P] with each other and with T037/T038; T041 depends on T037, T038, T040.

### Across user stories

Once Phase 3 is complete, Phases 4 / 5 / 6 can run in parallel by different developers — each touches its own set of files in `actions.ts`, `components/lacquer/checkout/`, and `checkout-screen.client.tsx`. The merges into `checkout-screen.client.tsx` from T031 (US3) and T041 (US4) need conflict resolution if landed in parallel; the simplest mitigation is to ship US3 then US4 sequentially in separate PRs.

---

## Parallel Example: User Story 4 UI components

```bash
# Launch the parallelizable component creations in parallel:
Task: T037 [P] [US4] components/lacquer/checkout/bill-sheet.tsx
Task: T038 [P] [US4] components/lacquer/checkout/email-bill-dialog.tsx
Task: T039        [US4] app/(studio)/checkout/checkout.css        # print-only block
Task: T040        [US4] app/(studio)/checkout/[ticketId]/page.tsx  # salon-info fetch
```

Once all four are landed, sequence T041 (wiring) and run T042 (verification).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup): T001.
2. Complete Phase 2 (Foundational): T002–T011. Confirm `npm test` passes for the extended cart-totals unit and the new error class imports compile.
3. Complete Phase 3 (US1): T012–T019. Confirm `checkout-variable-price.spec.ts` passes; the placeholder dialog from phase 2 is gone.
4. **STOP and VALIDATE**: Open a PR with just Phase 1 + 2 + 3. This is a shippable MVP — front desk can now actually price variable services and complete cash sales for them.

### Incremental Delivery (recommended)

1. PR #1: Phase 1 + 2 + 3 (US1) — shippable MVP; variable-price sheet works end-to-end.
2. PR #2: Phase 4 (US2) — row-level price override.
3. PR #3: Phase 5 (US3) — discount lines.
4. PR #4: Phase 6 (US4) — bill preview + Print + Email stub.
5. PR #5 (or rolled into PR #4): Phase 7 (Polish + final gate set).

Each PR touches a tight set of files and ships independently. The CI migration workflow (`db-migrate-preview.yml`) applies the single migration `0005_cart_polish.sql` in PR #1 and is a no-op thereafter.

### Bundled Delivery (alternative)

Ship Phases 1 → 7 in one PR if you prefer fewer review cycles. The task ordering still applies; do not let later phases land before their dependencies. With one bundled PR, the merge conflicts on `checkout-screen.client.tsx` between US3 and US4 don't arise (one developer / one branch).

---

## Notes

- `recomputeTicketTotals` is THE single recompute path. Every mutating action (`addServiceLine`, `removeLine`, `setLinePrice`, `addDiscountLine`, `removeDiscountLine`) calls it. Skipping the call in any new action would leave `tickets.total_cents` stale and the percent-discount recompute would not fire.
- The `pos_take_cash` RPC re-emit in T002 is intentional even though the body is unchanged — keeping the function in scope for `0005` makes any future body change land in a single migration boundary rather than depending on a possibly-stale `0004` body.
- The cash-drawer `// TODO(phase-9)` markers from phase 2 are not touched by this phase. Grep-verify they still exist if needed: `grep -rn 'TODO(phase-9)' supabase/migrations/ app/(studio)/checkout/actions.ts`.
- The discount-line layout convention is "service lines first, then discount lines, then payment buttons" — both in the cart and on the bill. The cart's recompute helper sums service lines first so the percent-discount denominator is the pre-discount service subtotal; the bill renders the same order so the customer reads the math intuitively.
- The discount-percent storage shape is `NUMERIC(5,2)` (per data-model.md) but the UI in this phase only accepts whole percents 1–100. Operators entering "15" save `15.00`. Fractional percents are out of scope and explicitly rejected by zod in T027.
- Every Server Action lives behind `requireStudioSession()`. The returned `StudioViewer.staff.id` is the operator (cookie-driven); `StudioViewer.deviceUserId` is the device user (Supabase auth). There is no role check beyond "is signed in" (FR-033). The `discount.manager_threshold_cents` read is wired in T027 and its return is intentionally ignored — phase 8 plugs in the manager-PIN gate at that exact point.
- The `bill.emailed` audit row is the only persisted evidence the Email action ran in this phase. The payload contains the full bill snapshot the operator was looking at when they pressed Email — large by design.
