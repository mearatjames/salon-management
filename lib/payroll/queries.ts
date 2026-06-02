// lib/payroll/queries.ts
// -----------------------------------------------------------------------------
// Live Supabase query layer for the Payroll page read model. Server-only.
//
// `loadPayrollLedger` resolves the requested semi-monthly pay period, lazily
// ensures its `pay_periods` row, then assembles the `PayrollLedgerModel`:
//
//  1. resolve the period window (`resolvePayPeriod` + `semiMonthlyWindowAt`);
//  2. lazily ensure the `pay_periods` row — a read for a period without a row
//     must not fail, so we insert-if-not-exists via the service-role client
//     (the `pay_periods` RLS is select-only — mirrors the cash-drawer
//     lazy-open in migration 0014);
//  3. reuse the Report query + `projectReport()` for the period window to get
//     per-tech `commissionableCents` / `cardTipsCents` — NO new ticket/payment
//     SQL is written;
//  4. read the `payroll_payouts` rows for the period;
//  5. read the active staff roster + their payroll rates;
//  6. hand everything to the pure `projectPayrollLedger`.
//
// See specs/047-payroll-page/contracts/read-model.md § "Ledger read model".

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import type { Database } from "@/lib/db/types";
import { loadReportPage } from "@/lib/report/queries";
import type { ReportWindow } from "@/lib/report/window";
import { salonNow, semiMonthlyWindowAt } from "@/lib/time/period-windows";
import {
  projectDailyActivity,
  projectPayrollLedger,
  type AdjustmentLine,
  type PayrollLedgerModel,
  type PayrollPayoutRow,
  type PayrollStaffRow,
  type TechDetailModel,
} from "./aggregate";
import { formatAdjustmentTimestamp } from "./format";
import { payPeriodRefFromRow, resolvePayPeriod, type PayPeriodRef } from "./window";

type AnySupabase = SupabaseClient<Database>;

// ── History read model — closed periods, for the Payroll History view ───────

/** One closed pay period, projected for the History list (US4). */
export type PayrollHistoryEntry = {
  /** The closed period — `status` is always `"closed"`. */
  readonly period: PayPeriodRef;
  /**
   * The period's `offset` relative to the current open period (negative), or
   * `null` when it lies further back than the resolver search window. Drives
   * the History row's `?offset=` link into the read-only ledger.
   */
  readonly offset: number | null;
  /** Σ cashPayment + Σ checkPortion across the period's frozen payout rows. */
  readonly totalPaidCents: number;
  /** Display name of the staff member who closed the period. */
  readonly closedByName: string;
  /** ISO timestamp the period was closed. */
  readonly closedAt: string;
};

// How far back `loadPayrollHistory` resolves a closed period's offset — two
// years of semi-monthly cycles is ample for v1 (older rows still list, they
// just lack a switcher-reachable link).
const HISTORY_OFFSET_SEARCH = 48;

// How many recent periods (the open one + this many closed ones) the period
// switcher offers.
const RECENT_PERIOD_COUNT = 6;

// ── Lazy `pay_periods` ensure ───────────────────────────────────────────────

/**
 * Resolves the `pay_periods` row for `period`, creating it if absent.
 *
 * `pay_periods` RLS is select-only, so the insert goes through the service-role
 * client. The insert is `on conflict (starts_on) do nothing` — concurrent
 * first-accesses race harmlessly, and an already-seeded period is a no-op. The
 * returned ref carries the row's `id` and `status` (a closed period overwrites
 * the resolver's default `"open"`).
 */
async function ensurePayPeriodRow(
  supabase: AnySupabase,
  period: PayPeriodRef
): Promise<PayPeriodRef> {
  // First, a plain RLS-bound read — the common path (the row already exists).
  const existing = await supabase
    .from("pay_periods")
    .select("id, status")
    .eq("starts_on", period.startsOn)
    .maybeSingle();

  const existingRow = (existing as { data: { id: string; status: string } | null }).data;
  if (existingRow) {
    return {
      ...period,
      id: existingRow.id,
      status: existingRow.status === "closed" ? "closed" : "open",
    };
  }

  // No row — lazily create one (insert-if-not-exists via the service role).
  const admin = createSupabaseServiceRoleClient();
  await admin.from("pay_periods").upsert(
    {
      starts_on: period.startsOn,
      ends_on: period.endsOn,
      pay_date: period.payDate,
      status: "open",
    },
    { onConflict: "starts_on", ignoreDuplicates: true }
  );

  // Re-read so we have the canonical id (the upsert may have no-op'd on a race).
  const created = await supabase
    .from("pay_periods")
    .select("id, status")
    .eq("starts_on", period.startsOn)
    .maybeSingle();
  const createdRow = (created as { data: { id: string; status: string } | null }).data;

  return {
    ...period,
    id: createdRow?.id ?? null,
    status: createdRow?.status === "closed" ? "closed" : "open",
  };
}

// ── Period window → ReportWindow ────────────────────────────────────────────

// `loadReportPage` browses a `[start, end)` window. The pay period's bounds are
// the same `semiMonthlyWindowAt` result the resolver used — reuse it directly.
function reportWindowForPeriod(tz: string, offset: number, now: Date): ReportWindow {
  const [start, end] = semiMonthlyWindowAt(tz, now, offset);
  return {
    granularity: "semi",
    offset,
    start,
    end,
    isCurrent: offset === 0,
    label: "",
    rangeLabel: "",
  };
}

// ── loadPayrollLedger ───────────────────────────────────────────────────────

// What `assemblePayrollLedger` returns — the projected model plus the Report
// read model it was built from (the tech-detail loader reuses the per-tech
// transaction rows to avoid re-querying tickets/payments).
type AssembledLedger = {
  model: PayrollLedgerModel;
  report: Awaited<ReturnType<typeof loadReportPage>>["report"];
};

/**
 * Resolves the period, ensures its `pay_periods` row, and assembles the full
 * `PayrollLedgerModel` (including `recentPeriods`). Shared by `loadPayrollLedger`
 * and `loadTechDetail` so both see one consistent projection.
 */
async function assemblePayrollLedger(
  supabase: AnySupabase,
  tz: string,
  offset: number
): Promise<AssembledLedger> {
  const now = salonNow(tz);

  // 1–2. Resolve the period and ensure its `pay_periods` row.
  const resolved = resolvePayPeriod(tz, now, offset);
  const period = await ensurePayPeriodRow(supabase, resolved);

  // 3. Per-tech earnings for the period window — reuse the Report query.
  const window = reportWindowForPeriod(tz, period.offset, now);
  const { report } = await loadReportPage(supabase, window);

  // 4. Frozen payout snapshots for this period.
  let payouts: readonly PayrollPayoutRow[] = [];
  if (period.id) {
    const payoutsRes = await supabase
      .from("payroll_payouts")
      .select(
        "staff_id, paid, method, paid_on, recorded_by_staff_id, commissionable_cents, " +
          "income_after_split_cents, card_tips_cents, tips_after_split_cents, " +
          "check_portion_cents, cash_payment_cents, service_commission_pct, tip_split_pct"
      )
      .eq("pay_period_id", period.id);
    payouts = ((payoutsRes as { data: PayrollPayoutRow[] | null }).data ??
      []) as readonly PayrollPayoutRow[];
  }

  // 5. Active staff roster + their payroll rates. One ledger row per active
  //    tech; a recorded-but-now-inactive tech still surfaces (their payout
  //    row references them) — resolve those by id alongside the active set.
  const recordedIds = new Set(payouts.map((p) => p.staff_id));
  for (const p of payouts) {
    if (p.recorded_by_staff_id) recordedIds.add(p.recorded_by_staff_id);
  }

  const activeRes = await supabase
    .from("staff")
    .select(
      "id, display_name, role, color_token, service_commission_pct, tip_split_pct, check_portion_cents"
    )
    .eq("active", true);
  const activeStaff = ((activeRes as { data: PayrollStaffRow[] | null }).data ??
    []) as readonly PayrollStaffRow[];

  // Pull in any recorded staff not in the active set (removed mid-period).
  const activeIds = new Set(activeStaff.map((s) => s.id));
  const missingIds = [...recordedIds].filter((id) => !activeIds.has(id));
  let extraStaff: readonly PayrollStaffRow[] = [];
  if (missingIds.length > 0) {
    const extraRes = await supabase
      .from("staff")
      .select(
        "id, display_name, role, color_token, service_commission_pct, tip_split_pct, check_portion_cents"
      )
      .in("id", missingIds);
    extraStaff = ((extraRes as { data: PayrollStaffRow[] | null }).data ??
      []) as readonly PayrollStaffRow[];
  }
  const allStaff = [...activeStaff, ...extraStaff];

  // The ledger rows are the active staff plus any recorded inactive tech.
  const ledgerStaff = allStaff.filter((s) => activeIds.has(s.id) || recordedIds.has(s.id));

  // `recorded_by` name lookup, for the payout receipts.
  const recordedByNames: Record<string, string> = {};
  for (const s of allStaff) recordedByNames[s.id] = s.display_name;

  // 5b. Manual payout adjustments for this period (feature 053, US2). One query,
  //     grouped client-side into `AdjustmentLine[]` per staff. The creator name
  //     resolves from the staff-name map; the timestamp is salon-formatted;
  //     `edited` reflects a non-null `updated_at`.
  const adjustmentsByStaff: Record<string, AdjustmentLine[]> = {};
  if (period.id) {
    const adjRes = await supabase
      .from("payout_adjustments")
      .select(
        "id, staff_id, amount_cents, reason, created_by_staff_id, created_by_user_id, created_at, updated_at"
      )
      .eq("pay_period_id", period.id)
      .order("created_at", { ascending: true });
    type AdjustmentRow = {
      id: string;
      staff_id: string;
      amount_cents: number;
      reason: string;
      created_by_staff_id: string | null;
      created_by_user_id: string | null;
      created_at: string;
      updated_at: string | null;
    };
    const adjustmentRows = ((adjRes as { data: AdjustmentRow[] | null }).data ??
      []) as readonly AdjustmentRow[];
    for (const a of adjustmentRows) {
      const line: AdjustmentLine = {
        id: a.id,
        amountCents: a.amount_cents,
        reason: a.reason,
        createdByName: a.created_by_staff_id
          ? (recordedByNames[a.created_by_staff_id] ?? null)
          : null,
        createdAtLabel: formatAdjustmentTimestamp(a.created_at, tz),
        edited: a.updated_at !== null,
      };
      (adjustmentsByStaff[a.staff_id] ??= []).push(line);
    }
  }

  // 6. Pure projection.
  const model = projectPayrollLedger({
    period,
    staff: ledgerStaff,
    technicianReports: report.technicians,
    payouts,
    recordedByNames,
    adjustmentsByStaff,
  });

  // The period switcher offers the open period plus the recent closed ones.
  const recentPeriods: PayPeriodRef[] = [];
  for (let o = 0; o > -RECENT_PERIOD_COUNT; o -= 1) {
    recentPeriods.push(resolvePayPeriod(tz, now, o));
  }

  return { model: { ...model, recentPeriods }, report };
}

/**
 * Loads the Payroll page ledger read model for the period `offset` half-months
 * before the current one (`offset` is clamped ≤ 0 by `resolvePayPeriod`).
 */
export async function loadPayrollLedger(
  supabase: AnySupabase,
  tz: string,
  offset: number
): Promise<PayrollLedgerModel> {
  const { model } = await assemblePayrollLedger(supabase, tz, offset);
  return model;
}

// ── loadTechDetail ──────────────────────────────────────────────────────────

/**
 * Loads the tech-detail read model for `staffId` in the period `offset`
 * half-months before the current one. Reuses the assembled ledger projection
 * (one consistent set of figures with `/payroll`), then adds the daily-activity
 * grouping from that tech's Report transactions and the ledger-order prev/next
 * neighbours. Returns `null` when the tech is not a row in the ledger.
 */
export async function loadTechDetail(
  supabase: AnySupabase,
  tz: string,
  offset: number,
  staffId: string
): Promise<TechDetailModel | null> {
  const { model, report } = await assemblePayrollLedger(supabase, tz, offset);

  const index = model.rows.findIndex((r) => r.staffId === staffId);
  if (index === -1) return null;

  const row = model.rows[index];
  const prevStaffId = index > 0 ? model.rows[index - 1].staffId : null;
  const nextStaffId = index < model.rows.length - 1 ? model.rows[index + 1].staffId : null;

  // The tech's per-transaction rows for the period — already projected by the
  // Report query. A tech with no work has no `TechnicianReport`; their detail
  // screen still renders every (closed) calendar day.
  const techReport = report.technicians.find((t) => t.staffId === staffId);
  const transactions = techReport?.transactions ?? [];

  const daily = projectDailyActivity({ tz, period: model.period, transactions });

  return {
    period: model.period,
    row,
    days: daily.days,
    bestDay: daily.bestDay,
    avgPerWorkingDayCents: daily.avgPerWorkingDayCents,
    workingDayCount: daily.workingDayCount,
    prevStaffId,
    nextStaffId,
    readOnly: model.readOnly,
  };
}

// ── loadPayrollHistory ──────────────────────────────────────────────────────

/**
 * Loads every closed pay period for the Payroll History view (US4), newest
 * first. For each closed period it sums the frozen `payroll_payouts` rows
 * (`cash_payment_cents + check_portion_cents` — the total handed out) and
 * resolves `closed_by_staff_id` to a display name.
 *
 * Closed periods are addressed by their `id` from here on — `loadPayrollLedger`
 * still reaches them by offset for the read-only ledger render. The `tz`
 * argument is accepted for signature symmetry with the other loaders; period
 * labels are derived from the stored salon-local date columns.
 */
export async function loadPayrollHistory(
  supabase: AnySupabase,
  tz: string
): Promise<readonly PayrollHistoryEntry[]> {
  // 1. Recent closed periods, newest first. Bounded to `HISTORY_OFFSET_SEARCH`
  //    (two years of semi-monthly cycles) — a closed period older than that
  //    window has no resolvable switcher offset anyway (step 4 falls its link
  //    back to "/payroll"), so fetching beyond it only grows the payload for
  //    no UI gain. The History list surfaces these recent periods (#196).
  const periodsRes = await supabase
    .from("pay_periods")
    .select("id, starts_on, ends_on, pay_date, status, closed_at, closed_by_staff_id")
    .eq("status", "closed")
    .order("starts_on", { ascending: false })
    .limit(HISTORY_OFFSET_SEARCH);

  type ClosedPeriodRow = {
    id: string;
    starts_on: string;
    ends_on: string;
    pay_date: string;
    status: string;
    closed_at: string | null;
    closed_by_staff_id: string | null;
  };
  const periods = ((periodsRes as { data: ClosedPeriodRow[] | null }).data ??
    []) as readonly ClosedPeriodRow[];
  if (periods.length === 0) return [];

  // 2. Frozen payout rows for every closed period — one query, grouped client
  //    side into per-period paid totals.
  const periodIds = periods.map((p) => p.id);
  const payoutsRes = await supabase
    .from("payroll_payouts")
    .select("pay_period_id, cash_payment_cents, check_portion_cents")
    .in("pay_period_id", periodIds);
  type HistoryPayoutRow = {
    pay_period_id: string;
    cash_payment_cents: number;
    check_portion_cents: number;
  };
  const payouts = ((payoutsRes as { data: HistoryPayoutRow[] | null }).data ??
    []) as readonly HistoryPayoutRow[];

  const totalByPeriod = new Map<string, number>();
  for (const p of payouts) {
    const prev = totalByPeriod.get(p.pay_period_id) ?? 0;
    totalByPeriod.set(p.pay_period_id, prev + p.cash_payment_cents + p.check_portion_cents);
  }

  // 2b. Manual payout adjustments per closed period (feature 053, US2) — fold
  //     each period's signed Σ into its paid total so History reflects cash +
  //     check + adjustments (the net handed out).
  const adjRes = await supabase
    .from("payout_adjustments")
    .select("pay_period_id, amount_cents")
    .in("pay_period_id", periodIds);
  type HistoryAdjustmentRow = { pay_period_id: string; amount_cents: number };
  const adjustments = ((adjRes as { data: HistoryAdjustmentRow[] | null }).data ??
    []) as readonly HistoryAdjustmentRow[];
  for (const a of adjustments) {
    const prev = totalByPeriod.get(a.pay_period_id) ?? 0;
    totalByPeriod.set(a.pay_period_id, prev + a.amount_cents);
  }

  // 3. Resolve the closing staff display names.
  const closerIds = [
    ...new Set(periods.map((p) => p.closed_by_staff_id).filter((id): id is string => !!id)),
  ];
  const namesById = new Map<string, string>();
  if (closerIds.length > 0) {
    const staffRes = await supabase.from("staff").select("id, display_name").in("id", closerIds);
    const staff = ((staffRes as { data: { id: string; display_name: string }[] | null }).data ??
      []) as readonly { id: string; display_name: string }[];
    for (const s of staff) namesById.set(s.id, s.display_name);
  }

  // 4. Resolve each closed period's `offset` relative to the open period — the
  //    History row links into the read-only ledger via `?offset=`. Walk the
  //    resolver back from 0 and match on `startsOn`.
  const now = salonNow(tz);
  const offsetByStart = new Map<string, number>();
  for (let o = 0; o > -HISTORY_OFFSET_SEARCH; o -= 1) {
    offsetByStart.set(resolvePayPeriod(tz, now, o).startsOn, o);
  }

  // 5. Project each closed period into a History entry.
  return periods.map((p): PayrollHistoryEntry => {
    const period = payPeriodRefFromRow({
      id: p.id,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      payDate: p.pay_date,
      status: "closed",
    });
    return {
      period,
      offset: offsetByStart.get(p.starts_on) ?? null,
      totalPaidCents: totalByPeriod.get(p.id) ?? 0,
      closedByName: p.closed_by_staff_id
        ? (namesById.get(p.closed_by_staff_id) ?? "Unknown")
        : "Unknown",
      closedAt: p.closed_at ?? "",
    };
  });
}
