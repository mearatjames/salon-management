// lib/transactions/queries.ts
// -----------------------------------------------------------------------------
// Live Supabase query layer for the Transactions page read model. Server-only.
//
// Unlike `lib/dashboard/queries.ts` (whose windows always end at `now`), this
// module browses full historical `[start, end)` periods — so it has its own
// query layer rather than extending the dashboard's (research R1). The query
// shape is the same two-step pattern the dashboard uses: fetch `tickets`, then
// `ticket_items` + `payments` by `.in("ticket_id", ids)` — no RPC.
//
// All reads are RLS-bound (the supabase client comes from the server-side
// cookie-aware helper). Reads hit `public.tickets`, `public.ticket_items`,
// `public.payments`, `public.staff`, `public.services`, and `public.settings`.
//
// See contracts/transactions-read-model.md § C2.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Technician } from "@/lib/dashboard/aggregate";
import { getSalonTimezone } from "@/lib/db/settings";
import type { Database } from "@/lib/db/types";
import { salonNow } from "@/lib/time/period-windows";
import { salonDateString } from "@/lib/time/format";

import {
  projectTransactions,
  type ProjectItemRow,
  type ProjectPaymentRow,
  type ProjectServiceRow,
  type ProjectStaffRow,
  type ProjectTicketRow,
  type TransactionDetail,
} from "./aggregate";
import { resolveWindow, type PeriodWindow } from "./window";

type AnySupabase = SupabaseClient<Database>;

// Feature 052: the Transactions ledger surfaces completed sales AND their
// reversals — a void/refund keeps the sale in the history with a status
// badge (it does not vanish). All four carry `closed_at`/`closed_by_staff_id`
// (the closed-consistency CHECK), so the `closed_at` window query is valid.
const LEDGER_STATUSES = ["paid", "void", "refunded", "partially_refunded"] as const;

// ── queryTransactions ─────────────────────────────────────────────────────
//
// Every `status = 'paid'` ticket with `closed_at ∈ [window.start, window.end)`,
// projected to `TransactionDetail`, newest-first. The window is half-open:
// `.gte` the start, `.lt` the end. Empty window → `[]` with no child queries.

export async function queryTransactions(
  supabase: AnySupabase,
  tz: string,
  window: PeriodWindow
): Promise<readonly TransactionDetail[]> {
  const ticketsRes = await supabase
    .from("tickets")
    .select("id, status, subtotal_cents, tax_cents, total_cents, closed_at, closed_by_staff_id")
    .in("status", LEDGER_STATUSES)
    .gte("closed_at", window.start.toISOString())
    .lt("closed_at", window.end.toISOString())
    .order("closed_at", { ascending: false });

  const tickets = ((ticketsRes as { data: ProjectTicketRow[] | null }).data ??
    []) as readonly ProjectTicketRow[];

  if (tickets.length === 0) {
    return [];
  }

  const ticketIds = tickets.map((t) => t.id);

  const [itemsRes, paymentsRes, staffRes] = await Promise.all([
    supabase
      .from("ticket_items")
      // Feature 049 (T022): `id` + `discount_target_line_ids` are needed
      // to resolve `targetNames` for scoped discount rows in `projectTransactions`.
      .select(
        "id, ticket_id, kind, qty, name_snapshot, assigned_staff_id, unit_price_cents, ref_id, discount_target_line_ids"
      )
      .in("ticket_id", ticketIds),
    supabase
      // Feature 052: `kind` lets the projection separate original payment
      // legs from refund legs (the latter feed `refundedCents`, not the
      // payment breakdown). Only succeeded legs count.
      .from("payments")
      .select("ticket_id, method, status, kind, amount_cents, tip_cents")
      .in("ticket_id", ticketIds)
      .eq("status", "succeeded"),
    supabase.from("staff").select("id, display_name, color_token"),
  ]);

  const items = ((itemsRes as { data: ProjectItemRow[] | null }).data ??
    []) as readonly ProjectItemRow[];
  const payments = ((paymentsRes as { data: ProjectPaymentRow[] | null }).data ??
    []) as readonly ProjectPaymentRow[];
  const staff = ((staffRes as { data: ProjectStaffRow[] | null }).data ??
    []) as readonly ProjectStaffRow[];

  // Resolve service categories for the line items that reference a service.
  const serviceIds = Array.from(
    new Set(items.map((it) => it.ref_id).filter((id): id is string => id !== null))
  );
  let services: readonly ProjectServiceRow[] = [];
  if (serviceIds.length > 0) {
    const servicesRes = await supabase.from("services").select("id, category").in("id", serviceIds);
    services = ((servicesRes as { data: ProjectServiceRow[] | null }).data ??
      []) as readonly ProjectServiceRow[];
  }

  return projectTransactions({ tz, tickets, items, payments, staff, services });
}

// ── queryPeriodCount ──────────────────────────────────────────────────────
//
// Count of ledger tickets (paid + reversed) with `closed_at` in the window.
// Used for the KPI "vs previous period" delta against the *previous* window —
// scoped to the same statuses the current period's count includes.

export async function queryPeriodCount(
  supabase: AnySupabase,
  window: PeriodWindow
): Promise<number> {
  const res = await supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .in("status", LEDGER_STATUSES)
    .gte("closed_at", window.start.toISOString())
    .lt("closed_at", window.end.toISOString());

  return (res as { count: number | null }).count ?? 0;
}

// ── queryStaffRoster ──────────────────────────────────────────────────────

type StaffRow = { id: string; display_name: string; color_token: string };

async function queryStaffRoster(supabase: AnySupabase): Promise<readonly Technician[]> {
  const res = await supabase
    .from("staff")
    .select("id, display_name, color_token")
    .eq("active", true);

  const rows = ((res as { data: StaffRow[] | null }).data ?? []) as readonly StaffRow[];
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    colorToken: r.color_token,
  }));
}

// ── loadTransactionsPage — orchestrator ───────────────────────────────────
//
// The orchestrator the page Server Component calls. Resolves the salon tz,
// then runs the transaction query, the previous-period count, and the staff
// roster concurrently. `previousPeriodCount` is the count of the window one
// step further back, so the KPI strip can render a "vs previous period" delta.

export async function loadTransactionsPage(
  supabase: AnySupabase,
  window: PeriodWindow
): Promise<{
  transactions: readonly TransactionDetail[];
  staff: readonly Technician[];
  previousPeriodCount: number;
  tz: string;
  todayKey: string;
}> {
  const tz = await getSalonTimezone(supabase);
  const now = salonNow(tz);

  // The previous window is the same granularity, one offset step further back.
  // Re-resolve it (rather than shifting by a fixed duration) so DST-variable
  // period lengths stay correct.
  const previousWindow = resolveWindow(tz, window.granularity, window.offset - 1, now);

  const [transactions, previousPeriodCount, staff] = await Promise.all([
    queryTransactions(supabase, tz, window),
    queryPeriodCount(supabase, previousWindow),
    queryStaffRoster(supabase),
  ]);

  return {
    transactions,
    staff,
    previousPeriodCount,
    tz,
    todayKey: salonDateString(tz, now),
  };
}
