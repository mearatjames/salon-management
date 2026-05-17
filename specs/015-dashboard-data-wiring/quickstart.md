# Quickstart: Dashboard — Real Supabase Data Wiring

**Feature**: 015-dashboard-data-wiring

A developer's "build, run, verify" walkthrough. Assumes the repo is already set up per `docs/system-design.md` and `supabase` is on the `$PATH`.

---

## 1. Reset the local database with the new migration + seed

From the worktree root:

```bash
supabase db reset
```

This runs all migrations (including the new `0008_dashboard_data_wiring.sql`), seeds the dev fixture (5 paid tickets for today), and restarts the local Supabase containers.

Verify the migration applied cleanly:

```bash
psql "$(supabase status -o env | grep -E '^DB_URL=' | cut -d= -f2 | tr -d '"')" \
  -c "select key, value from public.settings where key = 'salon.timezone';"
```

Expected: one row, `salon.timezone | "America/Los_Angeles"`.

Verify the indexes exist:

```bash
psql "$(supabase status -o env | grep -E '^DB_URL=' | cut -d= -f2 | tr -d '"')" \
  -c "select indexname from pg_indexes where tablename in ('tickets', 'payments') and indexname like '%dashboard%' OR indexname like '%status_%';"
```

Expected: includes `tickets_status_closed_at_idx` and `payments_status_processed_at_idx`.

---

## 2. Start the dev server and visit the dashboard

```bash
npm run dev
```

In a browser, open `http://localhost:3000/dashboard` (after signing in as the dev owner per `quickstart.md` § 1 in the project root).

**You should see**:
- Header subtitle: `Saturday, May 16 · Last sale {seeded-latest-time}` (the weekday/date will match the actual local day you reset the DB).
- Transactions tile: `5`.
- Services tile: `8` (sum of the seeded `qty` across non-discount items — 1 + 2 + 1 + 2 + 3 less the discount line).
- Revenue tile: the sum of the seeded `total_cents` formatted as `$X,YYY`.
- Tips tile: a non-zero number (the seed creates tips on 4 of 5 tickets); the sub-line shows the tip percent average.
- Payment-mix card: three labelled rows (Card, Cash, Gift card) with proportional bar.
- Recent-transactions feed: 5 rows, scrollable inside its slot, ordered by `closed_at desc`.
  - One row shows a **`Split`** pill (the split-tender ticket).
  - One row shows `+1 more` in the service-summary string (the 3-service ticket — discount line is excluded from the count and from the collapse).
- "Techs on shift" tile is gone. Lower-left column is just the Quick Actions stack.
- No `+3 vs avg` or `+12%` badges on any tile.

---

## 3. Verify period switching

Click `Week` in the period toggle. Tile values should change to reflect the calendar week's aggregates (the seed only inserts today's data, so Week will equal Today on the same day — to verify the math, hand-insert one more paid ticket dated 2 days ago via psql and reload).

Click `Month`. Same exercise — same numbers when the only data is today's, larger numbers once you've added history.

Click `Today` again. Numbers return to the today aggregate.

The recent-transactions feed should *not* change when you toggle — it's pinned to today (FR-011).

---

## 4. Verify the salon-timezone behavior

Change the salon timezone via psql:

```bash
psql "$(supabase status -o env | grep -E '^DB_URL=' | cut -d= -f2 | tr -d '"')" \
  -c "update public.settings set value = to_jsonb('Asia/Tokyo'::text) where key = 'salon.timezone';"
```

Reload the dashboard. The header subtitle's weekday + date should now reflect Tokyo's local day — if your local time is the afternoon, Tokyo is likely already on the next calendar day, so the subtitle changes.

Set it back:

```bash
psql "$(supabase status -o env | grep -E '^DB_URL=' | cut -d= -f2 | tr -d '"')" \
  -c "update public.settings set value = to_jsonb('America/Los_Angeles'::text) where key = 'salon.timezone';"
```

---

## 5. Verify the empty-state path

Truncate today's tickets:

```bash
psql "$(supabase status -o env | grep -E '^DB_URL=' | cut -d= -f2 | tr -d '"')" \
  -c "delete from public.ticket_items where ticket_id in (select id from public.tickets where status='paid' and closed_at >= now()::date);
      delete from public.payments where ticket_id in (select id from public.tickets where status='paid' and closed_at >= now()::date);
      delete from public.tickets where status='paid' and closed_at >= now()::date;"
```

Reload the dashboard. With Today selected:
- Every numeric tile shows `0` or `$0`.
- Payment-mix bar renders as a single neutral segment.
- Tips tile shows `$0.00` (no sub-line tip-percent).
- Recent-transactions feed shows the empty-state message: `No sales yet today.`
- Header subtitle collapses to `Saturday, May 16` (no `· Last sale …` clause).

Re-run `supabase db reset` to restore the dev fixture before continuing.

---

## 6. Run the gate suite

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

All five MUST be green before push (CLAUDE.md § Pre-push quality gates). For intermediate per-phase gates, scope by user story:

```bash
npx playwright test tests/e2e/dashboard.spec.ts -g "US1"
npx playwright test tests/e2e/dashboard.spec.ts -g "US2"
npx playwright test tests/e2e/dashboard.spec.ts -g "US3"
```

---

## 7. Side-by-side design comparison

Open the canonical Variation B reference — `design-system/prototypes/transaction/Landing.jsx` lines 282–372 (the `LandingStats` function) — next to `http://localhost:3000/dashboard`. Walk through the checklist:

- **Layout**: same six-column stat grid, same lower split (Quick Actions left, Recent Transactions right).
- **Tokens**: every color, spacing, radius, and shadow on the live page traces to a token in `styles/tokens.css`. No raw hex codes, no off-scale spacing.
- **Type**: Inter only, weights 400/500/600. Tabular numerals on every currency and count.
- **Icons**: Lucide at 1.5px stroke, sized 16/18/20/24. No emoji.
- **Intentional deltas (FR-019..FR-023)**:
  1. No "Techs on shift" tile or label on the live page.
  2. No `+3 vs avg` or `+12%` badges on the Transactions / Revenue tiles.
  3. Header subtitle has no `· N techs on shift` clause.
  4. Recent-transactions feed scrolls inside its slot (drag-scroll inside the feed once 8+ rows are seeded).
  5. Recent-transactions rows have no client-name column — the row reads time | service | techs | method | amount.
- **Additive (FR-014a)**: the seeded split-tender ticket shows a `Split` pill in a neutral muted tone, same shape as the other method pills.

If any value on the live page doesn't trace to a token, or any pre-existing chrome has drifted, **fix it before pushing** — the design auditor will bounce it otherwise.

---

## 8. Useful psql snippets while debugging

```sql
-- Paid tickets today (used by querySummaryRows + queryTodayFeed)
select id, total_cents, closed_at
from public.tickets
where status = 'paid' and closed_at >= now()::date
order by closed_at desc;

-- Today's revenue + tips by method (used by the Payment-mix card)
select method,
       sum(amount_cents) as amount,
       sum(tip_cents) as tip
from public.payments
where status = 'succeeded' and processed_at >= now()::date
group by method;

-- Last sale time (used by the header subtitle)
select max(processed_at)
from public.payments
where status = 'succeeded' and processed_at >= now()::date;

-- Splits today (tickets with 2+ payment methods — drive the Split pill)
select ticket_id, count(distinct method) as methods
from public.payments
where status = 'succeeded' and processed_at >= now()::date
group by ticket_id
having count(distinct method) >= 2;
```
