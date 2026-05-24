// Tiny service-role Supabase client for Playwright E2E specs.
//
// NOT a server-runtime helper — `lib/db/admin.ts` is RSC-only (it imports
// types and is intended for the audit writer). This file is plain Node and
// uses `@supabase/supabase-js` directly so Playwright tests can read
// `audit_log` rows for verification.
//
// The service-role key MUST be present in `.env.local` (or process env). If
// it is missing, helpers throw — the test should already have skipped via
// the Supabase reachability probe in `auth.spec.ts`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "tests/e2e/_db.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (typically in .env.local)"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type AuditRow = {
  action: string;
  actor_user_id: string | null;
  acting_as_staff_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  ts: string;
};

// Capture the start-of-test timestamp to use as a cursor for subsequent
// `getAuditLogRowsSince()` queries. Call this in `beforeEach` (or `beforeAll`
// when an assertion spans multiple serial tests) instead of truncating the
// table. Each test then sees only the rows written after its own cursor,
// which lets the suite run with `workers > 1` — global truncation would
// race across spec files that share the `audit_log` table.
//
// Node and Postgres share the host clock on dev + CI, so a simple Node
// `new Date()` is within sub-ms of the value Postgres will stamp on rows
// inserted moments later. If we ever split Postgres onto another host,
// swap this for an RPC that returns server-side `now()`.
export function newAuditCursor(): string {
  return new Date().toISOString();
}

// Returns audit rows written at or after `cursor` (use `newAuditCursor()` to
// produce one in `beforeEach`). Optionally filtered to a specific `action`,
// and/or to rows whose `acting_as_staff_id` is in `actingStaffIds`.
//
// Pass `actingStaffIds` (a worker's staff trio) when an assertion checks for
// the *absence* of audit rows: under `workers > 1` a concurrent worker may
// write rows in the same cursor window, and an unscoped `expect(rows)
// .toEqual([])` would race. Scoping to the calling worker's own staff makes
// the absence check see only rows it could itself have caused.
//
// Ordered by `ts` ascending so multi-row assertions can assume insertion
// order.
export async function getAuditLogRowsSince(
  cursor: string,
  action?: string,
  actingStaffIds?: ReadonlyArray<string>
): Promise<AuditRow[]> {
  let query = client()
    .from("audit_log")
    .select("action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload, ts")
    .gte("ts", cursor)
    .order("ts", { ascending: true });
  if (action) {
    query = query.eq("action", action);
  }
  if (actingStaffIds && actingStaffIds.length > 0) {
    query = query.in("acting_as_staff_id", actingStaffIds as string[]);
  }
  const { data, error } = await query;
  if (error) throw new Error(`audit_log read failed: ${error.message}`);
  return (data as AuditRow[]) ?? [];
}

export type StaffRow = { id: string; display_name: string };

/**
 * Look up a staff row by display name. Used by E2E specs that need a
 * stable staff id without hard-coding UUIDs (the seed migration uses
 * `gen_random_uuid()` so ids are not deterministic across resets).
 */
export async function getStaffByDisplayName(name: string): Promise<StaffRow> {
  const { data, error } = await client()
    .from("staff")
    .select("id, display_name")
    .eq("display_name", name)
    .single();
  if (error) {
    throw new Error(`staff lookup failed for "${name}": ${error.message}`);
  }
  return data as StaffRow;
}

/**
 * Resolve an `auth.users.id` by email. Used by US6 specs that need to
 * assert an audit row's `actor_user_id` matches the device user without
 * hard-coding UUIDs.
 *
 * Uses the service-role client's admin API (`auth.admin.listUsers`) — the
 * standard PostgREST surface does not expose `auth.users` directly.
 */
export async function getAuthUserByEmail(email: string): Promise<{ id: string }> {
  const { data, error } = await client().auth.admin.listUsers();
  if (error) {
    throw new Error(`auth.admin.listUsers failed: ${error.message}`);
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    throw new Error(`auth user not found for email "${email}"`);
  }
  return { id: user.id };
}

/**
 * Seed a `payroll_payouts` row that "finalizes" the pay period containing
 * `startsOn` for the given `staffId`. Used by feature-050 US3 specs to flip
 * the reassign-paid-line-tech surface to mode 3 (Lock + tooltip) without
 * recording an actual payout via the Payroll RPC chain.
 *
 * Behaviour (mirrors `lib/payroll/queries.ts § ensurePayPeriodRow`):
 *   1. Upsert the `pay_periods` row (on conflict do nothing) with status
 *      'open' — the current half-month period is shared across workers and
 *      may already exist; the upsert is a no-op if so.
 *   2. Re-read the row to obtain its canonical `id`.
 *   3. Insert one `payroll_payouts` row tied to that `(pay_period_id,
 *      staff_id)` — `paid=true` to satisfy the
 *      `payroll_payouts_paid_consistency_chk` CHECK constraint.
 *
 * Each worker scopes its payout to its own staff id so two workers never
 * collide on the `(pay_period_id, staff_id)` unique constraint.
 *
 * Returns the inserted payout's `id` so `clearPayoutForPeriod` can target
 * it for cleanup without affecting the shared `pay_periods` row.
 */
export async function seedPayoutForPeriod(opts: {
  startsOn: string;
  endsOn: string;
  payDate: string;
  staffId: string;
  recordedByStaffId: string;
}): Promise<{ payoutId: string; payPeriodId: string }> {
  const c = client();

  // 1. Ensure the period row exists.
  const { error: upErr } = await c.from("pay_periods").upsert(
    {
      starts_on: opts.startsOn,
      ends_on: opts.endsOn,
      pay_date: opts.payDate,
      status: "open",
    },
    { onConflict: "starts_on", ignoreDuplicates: true }
  );
  if (upErr) {
    throw new Error(`seedPayoutForPeriod: pay_periods upsert failed: ${upErr.message}`);
  }

  // 2. Read back the canonical id.
  const { data: periodRow, error: rdErr } = await c
    .from("pay_periods")
    .select("id")
    .eq("starts_on", opts.startsOn)
    .single();
  if (rdErr || !periodRow) {
    throw new Error(
      `seedPayoutForPeriod: pay_periods reread failed: ${rdErr?.message ?? "no row"}`
    );
  }
  const periodId = (periodRow as { id: string }).id;

  // 3. Insert one payout for this worker's staff. paid=true plus the
  //    other consistency-required columns satisfies the CHECK constraint.
  const { data: payoutRow, error: insErr } = await c
    .from("payroll_payouts")
    .insert({
      pay_period_id: periodId,
      staff_id: opts.staffId,
      paid: true,
      method: "cash",
      paid_on: opts.payDate,
      recorded_by_staff_id: opts.recordedByStaffId,
      paid_at: new Date().toISOString(),
      commissionable_cents: 0,
      income_after_split_cents: 0,
      card_tips_cents: 0,
      tips_after_split_cents: 0,
      check_portion_cents: 0,
      cash_payment_cents: 0,
      service_commission_pct: 0,
      tip_split_pct: 0,
    })
    .select("id")
    .single();
  if (insErr || !payoutRow) {
    throw new Error(
      `seedPayoutForPeriod: payroll_payouts insert failed: ${insErr?.message ?? "no row"}`
    );
  }

  return {
    payoutId: (payoutRow as { id: string }).id,
    payPeriodId: periodId,
  };
}

/**
 * Delete a single `payroll_payouts` row by id. Leaves the (shared)
 * `pay_periods` row in place so other workers / specs that rely on it
 * are unaffected. Idempotent — a missing row is a no-op.
 */
export async function clearPayoutById(payoutId: string): Promise<void> {
  const { error } = await client().from("payroll_payouts").delete().eq("id", payoutId);
  if (error) {
    throw new Error(`clearPayoutById(${payoutId}) failed: ${error.message}`);
  }
}

/**
 * Wait for a Next.js `loading.tsx` route skeleton to clear after a
 * `page.goto(...)` call.
 *
 * WHY: Next.js can serve the loading.tsx shell immediately when the page
 * loads, then stream in the real RSC content. `page.goto()` resolves on
 * the `load` event, which fires while the skeleton is still in the DOM and
 * before React hydration completes. Non-retrying snapshot queries
 * (`.innerText()`, `.count()`) or keyboard actions (`.press("Enter")`)
 * that run immediately after `goto` may hit the skeleton DOM rather than
 * the real hydrated content, causing assertions to read wrong values or
 * keyboard events to target un-hydrated links.
 *
 * Resolves immediately when no `.lq-skeleton` is present (i.e. the route
 * has no loading.tsx, or the real content streamed in fast enough that the
 * skeleton already detached). The `.catch` swallows the 5s timeout that
 * Playwright uses when the locator was never found in the DOM at all.
 */
export async function waitForRouteSkeleton(page: Page): Promise<void> {
  await page
    .locator(".lq-skeleton")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 })
    .catch(() => {});
}
