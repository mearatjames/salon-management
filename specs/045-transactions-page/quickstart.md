# Quickstart: Transactions Page

**Feature**: 045-transactions-page · **Branch**: `feat/045-transactions-page`

How to run, exercise, and verify this feature locally. Work happens in the
existing worktree `.claude/worktrees/045-transactions-page`.

## Prerequisites

- Dependencies installed (`npm ci`) and `.env.local` present (the worktree's
  `.worktreeinclude` copies env files in).
- Local Supabase running: `supabase start` (shared across worktrees).
- Seeded baseline: `supabase db reset` applies migrations + `supabase/seed.sql`
  (5 paid tickets dated "today").

## Run it

```bash
npm run dev      # http://localhost:3000
```

1. Sign in, select an **owner** or **manager** operator.
2. The sidebar's **Workspace** group now shows **Transactions** (receipt icon)
   between **Checkout** and **Walk-in**. Click it → `/transactions`.
3. From the dashboard, the **Recent transactions** feed's **View all** control
   also navigates to `/transactions`.
4. Sign in as a **technician** or **front-desk** operator → the Transactions
   nav item is gone, and visiting `/transactions` directly redirects to
   `/dashboard`.

## What to verify (maps to the spec)

- **Period filter** — toggle Today / This week / This month; the ‹ › arrows
  step to earlier periods; "next" is disabled on the current period. The range
  label and the listed transactions update. (US1)
- **Day grouping** — transactions are grouped by day, newest first, each group
  header showing the date, a relative label, and that day's count / revenue /
  tips. (US1)
- **KPI strip** — count (with a vs-previous-period delta), gross revenue,
  services rendered, tips collected, average ticket. (US1)
- **Receipt drawer** — click any row → drawer with line items (name, category,
  tech, price), subtotal/tip/tax/total, payment, cashier, and the "sale
  completed" activity line. Closes via the ✕, the backdrop, or `Esc`. (US2)
- **Search & filters** — search by service or transaction ID; method chips
  (with counts) and the tech multi-select narrow the list and recompute the KPI
  strip; active tech filters show as removable pills; "Clear filters" resets.
  (US3)
- **Empty states** — a period with no sales shows the empty state; a filter
  combination matching nothing shows the filtered-empty state with "Clear
  filters". (Edge cases)

> **Manual QA note**: the seed only has paid tickets for *today*, so "This
> week" / "This month" look thin and earlier `offset` steps are empty out of
> the box. To exercise multi-day grouping, either run a few checkouts or insert
> paid tickets on earlier dates. The e2e spec self-seeds its own history and
> does not depend on this.

## Tests

```bash
# Unit — pure logic for this feature
npx vitest run tests/unit/transactions tests/unit/time/period-windows.test.ts

# E2E — this feature's spec
npx playwright test tests/e2e/transactions.spec.ts --no-deps
```

`tests/e2e/transactions.spec.ts` seeds historical paid tickets in `beforeAll`
and cleans them up in `afterAll`; it asserts on those known rows, role-gating,
and filter behaviour — never on global aggregate counts — so it runs in the
parallel `main` project.

## Final gate (before pushing / opening the PR)

Run the full set, in order (Constitution § Development Workflow & Quality
Gates):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

## Design-system check

Before claiming the UI done, compare `/transactions` side-by-side with
`design-system/prototypes/transaction/Transactions.html` (copied in as part of
FR-020) and confirm every color / spacing / radius / shadow in
`styles/transactions.css` resolves to a `styles/tokens.css` token — no raw hex
or `oklch` literals.

## Notable scope reminders

- **No database migration** — the feature reads existing tables only.
- **Read-only** — no mutations; refund/void, CSV export, and Print/Email
  drawer actions are out of scope.
- **Client column** shows "Walk-in" for every transaction (no `clients` table
  in v1).
- **Tax** displays as the stored `$0` — no tax is computed.
