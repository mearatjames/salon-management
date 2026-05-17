# Quickstart — End of Day Cash Count

A 5-minute manual smoke test plus the exact commands to run the local Supabase + dev server + tests for this feature.

## Prereqs

- `supabase start` (local stack running).
- `.env.local` populated from `supabase status` output (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

## Apply the new migration

```bash
# from repo root
npx supabase db reset            # nukes local db and re-applies seed + every migration in order
# or, if you only want to apply the new one against an existing local db:
npx supabase migration up
```

Verify the new table and RPC exist:

```sql
\d public.cash_drawer_sessions   -- in psql, should show all 12 columns + the partial unique index
\df+ public.pos_close_cash_drawer
```

## Manual smoke test (browser)

1. Run the dev server: `npm run dev`.
2. Sign in as an owner or manager (use a seeded owner account, e.g. `owner@tang.local`).
3. From the dashboard, click the **End-of-day cash** quick-action (or visit `/end-of-day`).
4. Confirm the page renders:
   - Left panel: today's cash payments (or "No cash today" empty state if seed didn't run).
   - Right panel: numpad, $0 display, an empty Comparison block, a disabled **Close Out Day** button.
5. Type the expected total on the numpad → comparison shows "Exact match" in green → button enables.
6. Tap **Close Out Day** → confirmation screen appears with green check, expected/counted/difference, and a close timestamp.
7. Reload `/end-of-day` → page still shows the confirmation (the closed session was persisted).

## Manual variance test

1. Reset the local DB (`npx supabase db reset`) to undo the close.
2. Re-open `/end-of-day`.
3. Type an amount $2 less than the expected → display border turns red, comparison shows "Short −$2.00", a note textarea appears with "Required to close out", and **Close Out Day** is disabled.
4. Type a note ("Gave change for $100 bill") → button enables.
5. Tap **Close Out Day** → confirmation shows the variance and the note in italics.

## Manual stale-data test

1. Reset the local DB.
2. Open `/end-of-day` in tab A.
3. In tab B, complete a cash sale at `/checkout/[anotherTicketId]`.
4. In tab A, type the (now stale) expected total and press **Close Out Day**.
5. Expect: a transient banner "A new cash payment was recorded. Please recount the drawer." and the expected total updates to include the new payment.

## Run the tests

```bash
# Unit suite — fast, no Playwright server boot
npm test -- tests/unit/end-of-day

# Just the e2e for this feature
npx playwright test tests/e2e/end-of-day-cash.spec.ts

# Full local gate set (must be green before push)
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

## Reset the cash drawer between manual tests

Cleanest path: `npx supabase db reset`. If that's overkill (e.g. you want to preserve other state), psql:

```sql
delete from audit_log where action = 'cash_drawer.closed';
delete from cash_drawer_sessions;
```

## Files you'll touch most often during build

- `app/(studio)/end-of-day/page.tsx` — RSC entry; data load + role gate + island mount.
- `components/lacquer/eod/cash-count.client.tsx` — the numpad-driven UI.
- `lib/end-of-day/cash-count.ts` — the query layer.
- `supabase/migrations/0014_end_of_day_cash.sql` — schema + RPC.
- `tests/unit/end-of-day/close-action.test.ts` — write this **first** (TDD per Principle IV).
- `tests/e2e/end-of-day-cash.spec.ts` — describe blocks named `US1:`, `US2:`, `US3:` so per-phase gates can filter via `-g "USn"`.
