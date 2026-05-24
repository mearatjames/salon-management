# Quickstart: Per-service discount in checkout

**Feature**: `049-per-service-discount` | **Date**: 2026-05-22 | **Spec**:
[spec.md](./spec.md)

This walkthrough validates the three user stories end-to-end. It is the
manual smoke and the script the Playwright e2e covers programmatically.

## Setup

1. Local Supabase up: `supabase start`.
2. Migrations applied (the new `0023_per_service_discount_scope.sql` is
   in `supabase/migrations/`).
3. Dev server: `npm run dev` (or `npm run start` for prod-like).
4. Sign in as an owner (PIN-in as any active staff). Land on `/checkout`.

## US1 — Scope a discount to selected services (P1)

Goal: prove a percent discount can be scoped to one of two services and
the totals match.

1. Pick a tech tile (e.g. Maya).
2. Pick the **Manicure $40** service. Pick the **Pedicure $60** service.
3. Verify the cart shows two service rows; subtotal `$100.00`.
4. Tap **Add discount**.
5. In the sheet: choose **Percent**, type `50`.
6. Scroll to **Applies to**: tap **Selected services**.
7. Tap the **Pedicure $60** chip. (Leave Manicure unselected.)
8. Tap **Add discount**.

**Expected**:

- Discount row appears: `Discount · 50% · Pedicure` (FR-006).
- Subtotal: `$70.00` ($40 + $60 − $30 = $70).
- Cart total: `$70.00`.
- Acceptance Scenario US1-1 satisfied.

## US1-3 — All-services default unchanged (regression)

1. Add **Manicure $40** + **Pedicure $60**.
2. Tap **Add discount**. Pick **Percent**, type `10`. **Do not change** the
   Applies-to radio.
3. Tap **Add discount**.

**Expected**:

- Discount row: `Discount · 10%` (no scope label — FR-006).
- Subtotal: `$90.00`. (Today's behavior preserved — FR-005 / SC-005.)

## US2 — Cart + receipt show scope (P2)

Goal: prove FR-007 — the receipt enumerates targets.

Continue from US1 (cart has a `50% · Pedicure` scoped discount):

1. Tap **Take cash**. The done screen renders.
2. Tap **Print receipt** (or open `/checkout/<ticketId>/receipt`).

**Expected receipt content**:

```
Manicure                       $40.00
Pedicure                       $60.00
Discount · 50%                -$30.00
  Applies to: Pedicure
─────────────────────────────────────
Subtotal                       $70.00
Tax                             $0.00
Total                          $70.00
```

3. Navigate to **Transactions** (left nav). Click the row.
4. Verify the **Receipt drawer** shows the same `Applies to: Pedicure`
   sub-line under the discount item.

**Acceptance Scenario US2-1 / US2-3 satisfied.**

## US2-4 — Mixed all-services + scoped (FR-009 stacking)

1. Fresh cart. Add **Manicure $40** + **Pedicure $60**.
2. Add discount #1: **Percent 50%** scoped to **Pedicure**.
   Cart: subtotal `$70` (=$100 − $30).
3. Add discount #2: **Percent 10%** scoped to **all services**.
   Cart: subtotal `$63` (=$70 × 0.9, scoped applies first per FR-009).
4. Tap Take cash. View receipt.

**Expected**:

- Cart line order: scoped row first, all-services row second (FR-009).
- Receipt totals: subtotal `$63.00`.
- Both discount items render; the scoped one has `Applies to: Pedicure`,
  the all-services one has no sub-line.

## US3 — Targeting adapts as cart changes (P3)

### US3-1: Remove the only target

1. Fresh cart. Add **Manicure $40** + **Pedicure $60**.
2. Add a `$10 flat` discount scoped to **Pedicure only**.
   Cart subtotal: `$90`.
3. Tap the × on the **Pedicure** row.

**Expected**:

- Pedicure row gone. Discount row also gone in the same render (FR-010).
- Cart subtotal: `$40` (= $40, no ghost discount).
- No error banner. Take cash is enabled.

### US3-2: Remove one of two targets

1. Fresh cart. Add **Manicure $40** + **Pedicure $60** + **Polish $15**.
2. Add a `50% flat` discount scoped to **Pedicure + Polish**.
   Cart subtotal: `$77.50` ($115 − $37.50).
3. Remove the **Polish** row.

**Expected**:

- Discount row remains, scope label now reads `Pedicure` (was
  `2 services`).
- Cart subtotal: `$70.00` ($100 − $30, percent recomputed against
  remaining target — AS-2).

### US3-3: Edit a targeted service's price

1. Fresh cart. Add a **Variable-price service** ($0 unconfirmed) — e.g.
   Nail art.
2. Confirm the price as `$50` via the price sheet.
3. Add a `20% flat` discount scoped to that service only.
   Cart subtotal: `$40` ($50 − $10).
4. Tap the price chip on Nail art and change to `$80`.

**Expected**: discount recomputes; cart subtotal `$64` ($80 − $16) —
FR-012 / AS-3.

### US3-4: Add a new service after the discount

Continuing from US3-3:

1. Pick a tech. Pick **Manicure $40**.

**Expected**: Manicure adds to the cart; the existing scoped discount
**does not** include it. Subtotal goes up by exactly $40. (FR-011 /
AS-4.)

### US3-5: Auto-remove never blocks payment

1. Fresh cart. Add Manicure + Pedicure. Scope a discount to Pedicure
   only. Add a `100% flat` discount scoped to Manicure too (subtotal
   $20).
2. Remove BOTH service rows.

**Expected**: both discounts disappear in the same render; cart is
empty; Take cash is disabled (empty cart, not because of discount
state). No error banner. FR-016 satisfied.

## Edge: empty-scope refused at save (FR-013)

1. Fresh cart. Add at least one service.
2. Open **Add discount**. Pick **Percent 10**. Switch scope to **Selected
   services**. Do **not** pick any chip.

**Expected**: Save is disabled; inline hint reads **"Pick at least one
service."** Picking any chip enables Save.

## Edge: over-discount on the scope (Edge cases § "Over-discount")

1. Fresh cart. Add **Manicure $40** only.
2. Add a `$100 flat` discount scoped to Manicure only.

**Expected**:

- Sheet saves (no client-side error).
- Cart subtotal: `$0` (cap = $40, but the targeted contribution flooring
  means the cart shows the discount line at `-$40.00` and Take cash is
  disabled because total is $0).

## Edit an existing discount (FR-017)

1. From a cart with a scoped discount, tap the **Edit** (pencil)
   affordance on the discount row.
2. DiscountSheet opens prefilled (shape, value, note, scope).
3. Change the percent value from `15` to `20`. Tap Save.

**Expected**:

- Single `discount.edited` audit row (one before/after pair) — verify by
  selecting the row from `audit_log` in psql or via the Transactions
  page after cashing out.
- Cart subtotal recomputes.

## Final verification

Run the gate set scoped to this feature before claiming done. Final gate
runs the full suite:

```bash
# Final gate
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

E2E specs to add / extend:

- `tests/e2e/checkout-discount-scoped.spec.ts` (NEW) — covers US1, US2,
  US3, edge cases.
- `tests/e2e/checkout-discount.spec.ts` — regression-verifies the
  all-services default still passes (US1-3 / FR-005 / SC-005).
- `tests/e2e/transactions-page.spec.ts` — extend with the receipt-drawer
  `Applies to:` sub-line assertion (one scenario).

Unit suites to extend:

- `tests/unit/checkout/cart-totals.test.ts` — scoped percent/flat,
  stacking FR-009, over-discount cap, auto-remove math.
- `tests/unit/checkout/add-discount-line-action.test.ts` +
  `tests/unit/checkout/edit-discount-line-action.test.ts` (NEW) —
  validation surface, audit payload shape.
