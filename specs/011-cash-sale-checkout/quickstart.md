# Quickstart — Checkout — Cash-Only Sale

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

This walkthrough gets a developer from a clean checkout of branch `011-cash-sale-wip` to a working cash-sale flow on their machine, with the local quality gates green, ready to start `/speckit-tasks`.

Estimated time: 30 minutes if Supabase is already installed locally; +15 minutes the first time.

---

## 0. Prerequisites

- Node 22, npm 10.
- Supabase CLI installed (`brew install supabase/tap/supabase`) and Docker running.
- `.env.local` populated per `README` (Supabase project keys, `SALON_TZ`).
- Branch checked out: `git checkout 011-cash-sale-wip`.
- Dependencies installed: `npm install`.

If you are using a worktree (recommended for parallel work): the worktree at `.worktrees/011-cash-sale-wip` has its own `node_modules`. Run `npm install` once inside it.

---

## 1. Apply the new migration locally

```bash
supabase start                    # local Supabase if not already up
supabase db reset                 # rebuilds local DB from supabase/migrations/* + seed.sql
```

Confirm the new migration lands:

```bash
supabase db diff                  # should show "no differences"
psql "$LOCAL_SUPABASE_URL" -c "\dt public.tickets;"   # should list the table
```

The hosted preview/prod projects auto-apply the migration via
`.github/workflows/db-migrate-{preview,prod}.yml` on PR / push — do not
`supabase db push --linked` from your machine (Constitution § Schema drift forbidden).

---

## 2. Seed enough data to exercise the flow

The existing `supabase/seed.sql` already creates two staff (Mai, Linh) and several services from feature 008. If you need fresh data:

```bash
supabase db reset                 # truncates + reseeds
```

Sign in as the seeded owner, pick a staff PIN at `/select-staff`, and you should land on `/dashboard`.

---

## 3. Build order (red → green)

Per Constitution Principle IV (Test-First on money paths), this is the order:

### 3a. Unit tests first (Vitest, red)

Write these tests before the implementation. They will fail until step 3c/3d lands:

1. `tests/unit/checkout/cart-totals.test.ts`
   - `computeTotals([])` → subtotal=0, total=0
   - `computeTotals([fixed(20)])` → subtotal=2000, total=2000
   - `computeTotals([fixed(20), fixed(15)])` → subtotal=3500
   - `computeTotals([fixed(20), unconfirmed()])` → `chargeEligible=false`, totals exclude unconfirmed
2. `tests/unit/checkout/take-cash-action.test.ts`
   - Mocks the supabase service-role client. When the mocked RPC throws mid-transaction, the action throws `CashPaymentFailedError`. (The unit test does not verify the SQL transaction itself; that is an e2e concern.)

Run: `npm test`. Expect red.

### 3b. Schema migration (green for "tables exist")

Create `supabase/migrations/0004_checkout_cash_sale.sql` per `data-model.md`. Apply locally:

```bash
supabase db reset
```

### 3c. Server Actions (green for unit tests)

Create `app/(studio)/checkout/actions.ts` per `contracts/server-actions.md`. Implement the seven actions; extend `lib/auth/audit.ts` per `contracts/audit.contract.md`.

Run: `npm test`. Expect green on the cart-totals + take-cash unit tests.

### 3d. UI components and pages

Adapt `design-system/prototypes/transaction/FlowSingle.jsx` into `components/lacquer/checkout/*` per `plan.md` § Project Structure. Compose into:

- `app/(studio)/checkout/page.tsx` — calls `resumeOrCreateTicket()` and `redirect()`s.
- `app/(studio)/checkout/[ticketId]/page.tsx` — loads ticket + cart + roster + catalog server-side, renders `<CheckoutScreen/>`.
- `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` — the client island.
- `app/(studio)/checkout/[ticketId]/receipt/page.tsx` — gated server-rendered receipt.

### 3e. End-to-end tests (Playwright, red → green)

Write before the integration is fully wired:

1. `tests/e2e/checkout-cash-sale.spec.ts` — US1 happy path.
2. `tests/e2e/checkout-resume.spec.ts` — US2 same-day resume + cross-day no-resume + discarded-no-resume.
3. `tests/e2e/checkout-discard.spec.ts` — US-aligned (discard transitions ticket to non-resumable + excluded from sales).
4. `tests/e2e/checkout-receipt.spec.ts` — US4 (printable receipt) + FR-026 (anonymous GET refused).

Run with `--workers=1` per `CLAUDE.md`:

```bash
npm run test:e2e -- --workers=1
```

---

## 4. Walk the US1 cash sale by hand

With `npm run dev` running on a different port from your other Claude session
(e.g., `PORT=3001 npm run dev` if the 010 work is on 3000):

1. Sign in, pick a staff at `/select-staff`.
2. From `/dashboard`, click **New transaction**. You should land on `/checkout/<some-uuid>` with a fresh empty cart.
3. Pick a tech in the tech row (it collapses to a chip with a Change link).
4. Tap a fixed-price service tile. The cart shows the line with the snapshotted name + price; subtotal + total update.
5. Tap **Take cash · $X**. You should immediately see **DoneScreen** with "Charged $X".
6. Click **New sale**. You should land on a fresh `/checkout/<new-uuid>`.

Then verify the receipt:

7. From a paid ticket's id, open `/checkout/<paid-ticket-id>/receipt` in a new tab.
8. The page should show salon name, line items, total, and "Cash" as method, with no studio chrome.
9. File → Print preview should render a single clean page.
10. Open the same URL in an Incognito tab (no session): you should be redirected to `/login`.

---

## 5. Walk the failure paths

- **Cash payment failure**: temporarily drop the `pos_take_cash` function (`drop function pos_take_cash(uuid, uuid)`), retry Take cash from the UI. You should see the FR-019 banner "Cash payment didn't save — try again" and the button re-enables. Restore the function.
- **Variable-price line**: with a service whose `variable_price=true`, add it to the cart. Take cash button is disabled; the hint "Set price on highlighted items" appears. Click the line's price control — placeholder dialog opens explaining variable pricing comes in the next phase.
- **Discard from header**: with at least one line in the cart, click **Discard ticket**. You return to the dashboard. Click **Checkout** from the sidebar — a FRESH empty ticket appears (the discarded one is NOT resumed).
- **Same-day resume**: add lines but do NOT pay; navigate away to `/dashboard`. Click **Checkout** from the sidebar — you return to the SAME ticket with the same cart.
- **Cross-day no-resume**: same setup, but advance the local SALON_TZ date (e.g., `update tickets set created_at = created_at - interval '1 day';` against the in-progress ticket). Click **Checkout** — a fresh empty ticket is created.

---

## 6. Side-by-side design review

Per Constitution Principle I and `CLAUDE.md` § "When you change UI":

1. Open `design-system/prototypes/transaction/FlowSingle.jsx` (and the rendered preview under `design-system/preview/Transaction Flows.html` if present).
2. Open your `/checkout/<id>` in the browser at the same width.
3. Check each value (color, spacing, radius, shadow, type) traces to a token in `styles/tokens.css`.
4. Specifically verify:
   - PaymentTiles renders **four tiles** (cash, card, gift, split) but only cash is enabled. Disabled tiles show the "Coming soon" tooltip on hover.
   - Tech row collapses to a chip + Change link after a pick (single-select variant of the prototype's TechAvatarRow).
   - DoneScreen mirrors the prototype's done branch (no tip line, since this phase has no tip capture).

---

## 7. Run the full local gate set

Per `CLAUDE.md` § "Pre-push quality gates", in this order:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e -- --workers=1
```

All five MUST be green locally. CI runs the same commands and a missed one will bounce the PR.

---

## 8. Hand off to `/speckit-tasks`

When all of the above is green, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and this quickstart are complete and consistent.

Next: run `/speckit-tasks` to generate the dependency-ordered task breakdown.
