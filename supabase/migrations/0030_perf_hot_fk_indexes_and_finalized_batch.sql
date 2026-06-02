-- Migration: 0030_perf_hot_fk_indexes_and_finalized_batch.sql
-- Issue: #196 — chore(perf): DB indexes on hot FKs + bound payroll/transactions
--
-- Two changes, both performance-only (no behaviour change):
--
-- 1. Covering indexes on the foreign keys that the payroll / report /
--    transactions / end-of-day read paths actually join or filter on. The
--    production performance advisor flagged these as unindexed foreign keys
--    (https://supabase.com/docs/guides/database/database-linter?lint=0001).
--    Only the FKs on real read paths are indexed here; purely-administrative
--    FKs (`*_invited_by`, `*_offboarded_by`, `square_oauth_connected_by_*`,
--    `*_opened_by_*`, etc.) are left unindexed — low cardinality, rarely
--    queried.
--
--    Deliberately NOT added (already covered, so adding would duplicate):
--      - payroll_payouts.pay_period_id   → payroll_payouts_period_idx (0021)
--      - payout_adjustments.pay_period_id → leading col of
--                                           payout_adjustments_period_staff_idx (0029)
--
--    NB: these new indexes will themselves show up as "unused" in the advisor
--    until production has real traffic — that is expected and pruning is
--    explicitly out of scope for #196 (re-run the advisor after real usage).
--
-- 2. `payroll_periods_finalized(date[])` — a single batch read that returns the
--    finalized status for many pay periods at once, collapsing the Transactions
--    page's N per-period `isPayPeriodFinalized` round-trips into one RPC. A
--    period is finalized when its `pay_periods` row is `status='closed'` OR ≥ 1
--    `payroll_payouts` row references it (same rule as
--    `lib/payroll/finalized.ts#isPayPeriodFinalized`).
--
-- Idempotent throughout (`if not exists` / `or replace`).

-- ----------------------------------------------------------------------
-- 1. Covering indexes on hot foreign keys.
-- ----------------------------------------------------------------------

-- Report / payroll group ticket lines by the tech they were assigned to.
create index if not exists ticket_items_assigned_staff_idx
  on public.ticket_items (assigned_staff_id);

-- End-of-day cash attributes each payment to the staffer who took it.
create index if not exists payments_taken_by_staff_idx
  on public.payments (taken_by_staff_id);

-- Payroll history / ledger resolve a tech's frozen payout rows.
create index if not exists payroll_payouts_staff_idx
  on public.payroll_payouts (staff_id);

-- Adjustments are surfaced per tech (and the FK cascades on staff delete).
create index if not exists payout_adjustments_staff_idx
  on public.payout_adjustments (staff_id);

-- The adjustment ledger resolves the recorder's display name.
create index if not exists payout_adjustments_created_by_staff_idx
  on public.payout_adjustments (created_by_staff_id);

-- Report / transactions filter on closed tickets by the closing tech.
create index if not exists tickets_closed_by_staff_idx
  on public.tickets (closed_by_staff_id);

-- ----------------------------------------------------------------------
-- 2. payroll_periods_finalized — batch finalized lookup.
-- ----------------------------------------------------------------------
-- Returns one row per input `starts_on` with whether that pay period is
-- finalized. `security invoker` (the default, made explicit): the function
-- reads `pay_periods` / `payroll_payouts` under the caller's RLS, both of
-- which expose `select to authenticated using (true)` (migration 0021), so a
-- studio session reads exactly what `isPayPeriodFinalized` would per-period.
create or replace function public.payroll_periods_finalized(p_starts_on date[])
returns table (starts_on date, finalized boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    s.starts_on,
    exists (
      select 1
      from public.pay_periods pp
      where pp.starts_on = s.starts_on
        and (
          pp.status = 'closed'
          or exists (
            select 1
            from public.payroll_payouts po
            where po.pay_period_id = pp.id
          )
        )
    ) as finalized
  from unnest(p_starts_on) as s(starts_on);
$$;

grant execute on function public.payroll_periods_finalized(date[]) to authenticated;
