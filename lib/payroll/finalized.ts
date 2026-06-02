// lib/payroll/finalized.ts
// -----------------------------------------------------------------------------
// Helpers the Transactions page uses to decide whether a paid ticket's pay
// period has been "finalized" — meaning the reassign-paid-line-tech surface
// must lock for every role (feature 050, User Story 3 / FR-002).
//
// A pay period is finalized when EITHER:
//   - the `pay_periods` row's `status = 'closed'` (an owner finalized the
//     period via the Payroll close action), OR
//   - ≥ 1 `payroll_payouts` row references the period's id (a payout has
//     been recorded against the period, freezing per-tech earnings).
//
// Both reads are RLS-bound (the supabase client comes from the server-side
// cookie-aware helper). Server-only — never imported from client modules.
//
// See specs/050-reassign-paid-line-tech/data-model.md and research.md §1–§2.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import { resolvePayPeriod, type PayPeriodRef } from "@/lib/payroll/window";

type AnySupabase = SupabaseClient<Database>;

/**
 * Resolves the pay period that contains a paid ticket's `closed_at` instant.
 * A thin wrapper around `resolvePayPeriod(tz, now, 0)` — passing the ticket's
 * `closed_at` as `now` puts the resolver in the period that contained it. The
 * caller already has the salon tz (every page that calls this resolved it
 * upstream via `getSalonTimezone`), so this stays pure / sync.
 *
 * The returned `PayPeriodRef` has `id = null` and `status = 'open'`; pair it
 * with `isPayPeriodFinalized` to learn the live state.
 */
export function payPeriodForClosedAt(tz: string, closedAt: Date | string): PayPeriodRef {
  const now = typeof closedAt === "string" ? new Date(closedAt) : closedAt;
  return resolvePayPeriod(tz, now, 0);
}

/**
 * Returns `true` iff the period referenced by `ref` has been finalized — either
 * its `pay_periods` row is `status='closed'` OR ≥ 1 `payroll_payouts` row
 * references it.
 *
 * Branches (research §2):
 *   (a) no `pay_periods` row                           → false
 *   (b) row with `status='closed'`                     → true
 *   (c) row + ≥ 1 `payroll_payouts` referencing its id → true
 *   (d) row with `status='open'` AND no payouts        → false
 *
 * The payouts query is skipped in branches (a) and (b) to keep the page-load
 * read budget tight (at most 2 reads per distinct period).
 */
export async function isPayPeriodFinalized(
  supabase: AnySupabase,
  ref: PayPeriodRef
): Promise<boolean> {
  const periodRes = await supabase
    .from("pay_periods")
    .select("id, status")
    .eq("starts_on", ref.startsOn)
    .maybeSingle();

  const row = (periodRes as { data: { id: string; status: string } | null }).data;
  if (!row) return false;
  if (row.status === "closed") return true;

  const payoutsRes = await supabase
    .from("payroll_payouts")
    .select("id")
    .eq("pay_period_id", row.id)
    .limit(1);

  const payouts = ((payoutsRes as { data: { id: string }[] | null }).data ?? []) as ReadonlyArray<{
    id: string;
  }>;
  return payouts.length > 0;
}

/**
 * Batched form of {@link isPayPeriodFinalized}: resolves the finalized status
 * for many pay periods in a single round-trip. The Transactions page stamps a
 * `payPeriodFinalized` flag on every paid line, and a busy period can span
 * dozens of distinct pay periods — issuing one `isPayPeriodFinalized` query
 * per period (even parallelised) is N round-trips. This collapses them into a
 * single `payroll_periods_finalized` RPC call (#196).
 *
 * Returns a `Map` keyed by `startsOn` (salon-local `YYYY-MM-DD`). A period the
 * RPC doesn't report (no matching `pay_periods` row) is simply absent from the
 * map — callers treat a miss as `false`, matching branch (a) of the per-period
 * helper. Passing an empty list short-circuits with no query.
 */
export async function payPeriodsFinalizedByStartsOn(
  supabase: AnySupabase,
  startsOnList: readonly string[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (startsOnList.length === 0) return result;

  const { data, error } = await supabase.rpc("payroll_periods_finalized", {
    p_starts_on: [...startsOnList],
  });
  if (error) throw error;

  const rows = (data ?? []) as ReadonlyArray<{ starts_on: string; finalized: boolean }>;
  for (const row of rows) result.set(row.starts_on, row.finalized);
  return result;
}
