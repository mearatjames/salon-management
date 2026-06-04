// lib/dashboard/queries.ts
// -----------------------------------------------------------------------------
// Live Supabase query layer for the dashboard read model.
//
// All reads are RLS-bound (the supabase client comes from the server-side
// cookie-aware helper). Every public function in this module is server-only —
// the queries hit `public.tickets`, `public.ticket_items`, `public.payments`,
// `public.staff`, and `public.settings`.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  summarizeRows,
  type DashboardData,
  type DashboardPeriod,
  type DashboardSummary,
  type PaymentMethod,
  type QuickAction,
  type SummarizeItem,
  type SummarizePayment,
  type SummarizeTicket,
  type Technician,
  type TransactionRow,
} from "@/lib/dashboard/aggregate";
import { formatServiceLabel } from "@/lib/dashboard/format";
import { getSalonTimezone } from "@/lib/db/settings";
import type { Database } from "@/lib/db/types";
import { formatSubtitle, formatTime } from "@/lib/time/format";
import { monthWindow, salonNow, todayWindow, weekWindow } from "@/lib/time/period-windows";
import { Banknote, Calendar, FileBarChart, Footprints } from "lucide-react";

export { salonNow };

type AnySupabase = SupabaseClient<Database>;

// ── Quick actions — moved out of the legacy aggregate.ts so the live page
// can stop importing the mock-data module entirely. The legacy
// QUICK_ACTIONS export in aggregate.ts stays during Phase 2 for back-compat.

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "calendar",
    label: "Today's calendar",
    hint: "See appointments + chairs",
    icon: Calendar,
    href: "/calendar",
  },
  {
    id: "walkin",
    label: "Walk-in",
    hint: "Skip the appointment book",
    icon: Footprints,
    href: "/walkin",
  },
  {
    id: "report",
    label: "Report",
    hint: "Sales by tech, by service",
    icon: FileBarChart,
    href: "/report",
  },
  {
    id: "cashout",
    label: "End of Day Cash",
    hint: "Reconcile the till",
    icon: Banknote,
    href: "/end-of-day",
  },
];

// ── queryDashboardSummaries ───────────────────────────────────────────────
//
// The today / week / month windows all end at `now` and nest strictly
// (today ⊂ week ⊂ month), so the month rows are a superset of the other two.
// Rather than scan tickets/items/payments once per window (3× redundant row
// transfer at scale), fetch once over the month window and bucket the rows in
// memory. `summarizeRows` only aggregates over the tickets handed to it
// (items/payments are looked up by ticket id), so feeding each bucket the full
// month-wide items/payments yields exactly the per-window result (issue #205).

type SummariesByPeriod = Record<DashboardPeriod, DashboardSummary>;

function emptySummaries(): SummariesByPeriod {
  return {
    today: summarizeRows({ tickets: [], items: [], payments: [] }, "today"),
    week: summarizeRows({ tickets: [], items: [], payments: [] }, "week"),
    month: summarizeRows({ tickets: [], items: [], payments: [] }, "month"),
  };
}

// Pure: split the month-wide rows into today / week / month summaries. A sale
// whose `closed_at` is exactly at a window's start instant lands inside that
// window (matching the live query's inclusive `.gte` lower bound).
export function bucketSummaries(
  tz: string,
  now: Date,
  tickets: readonly SummarizeTicket[],
  items: readonly SummarizeItem[],
  payments: readonly SummarizePayment[]
): SummariesByPeriod {
  const todayStartMs = todayWindow(tz, now)[0].getTime();
  const weekStartMs = weekWindow(tz, now)[0].getTime();

  const closedAtMs = (t: SummarizeTicket): number =>
    t.closed_at ? new Date(t.closed_at).getTime() : Number.NaN;

  const todayTickets = tickets.filter((t) => closedAtMs(t) >= todayStartMs);
  const weekTickets = tickets.filter((t) => closedAtMs(t) >= weekStartMs);

  return {
    today: summarizeRows({ tickets: todayTickets, items, payments }, "today"),
    week: summarizeRows({ tickets: weekTickets, items, payments }, "week"),
    month: summarizeRows({ tickets, items, payments }, "month"),
  };
}

export async function queryDashboardSummaries(
  supabase: AnySupabase,
  tz: string,
  now: Date
): Promise<SummariesByPeriod> {
  const [start] = monthWindow(tz, now);

  const ticketsRes = await supabase
    .from("tickets")
    .select("id, status, subtotal_cents, tax_cents, total_cents, closed_at")
    .eq("status", "paid")
    .gte("closed_at", start.toISOString())
    .lte("closed_at", now.toISOString());

  const tickets = ((ticketsRes as { data: SummarizeTicket[] | null }).data ??
    []) as readonly SummarizeTicket[];

  if (tickets.length === 0) {
    return emptySummaries();
  }

  const ticketIds = tickets.map((t) => t.id);

  const [itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from("ticket_items")
      .select("ticket_id, kind, qty, name_snapshot, assigned_staff_id, unit_price_cents")
      .in("ticket_id", ticketIds),
    supabase
      .from("payments")
      .select("ticket_id, method, status, amount_cents, tip_cents")
      .in("ticket_id", ticketIds)
      .eq("status", "succeeded"),
  ]);

  const items = ((itemsRes as { data: SummarizeItem[] | null }).data ??
    []) as readonly SummarizeItem[];
  const payments = ((paymentsRes as { data: SummarizePayment[] | null }).data ??
    []) as readonly SummarizePayment[];

  return bucketSummaries(tz, now, tickets, items, payments);
}

// ── queryTodayFeed ────────────────────────────────────────────────────────

type TodayFeedItem = SummarizeItem & { ticket_id: string };
type TodayFeedPayment = SummarizePayment & { processed_at: string; kind: string };

export async function queryTodayFeed(
  supabase: AnySupabase,
  tz: string,
  now: Date
): Promise<readonly TransactionRow[]> {
  const [start, end] = todayWindow(tz, now);

  // Feature 052: the live feed shows completed sales AND refunded ones
  // (partial or full) with a badge — a refunded sale is still a real sale
  // that happened today. A voided sale is excluded (a same-day cancellation,
  // not a sale). Revenue summaries are computed separately and stay net.
  const ticketsRes = await supabase
    .from("tickets")
    .select("id, status, subtotal_cents, tax_cents, total_cents, closed_at")
    .in("status", ["paid", "refunded", "partially_refunded"])
    .gte("closed_at", start.toISOString())
    .lte("closed_at", end.toISOString())
    .order("closed_at", { ascending: false });

  const tickets = ((ticketsRes as { data: SummarizeTicket[] | null }).data ??
    []) as readonly SummarizeTicket[];

  if (tickets.length === 0) {
    return [];
  }

  const ticketIds = tickets.map((t) => t.id);

  const [itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from("ticket_items")
      .select("ticket_id, kind, qty, name_snapshot, assigned_staff_id, unit_price_cents")
      .in("ticket_id", ticketIds),
    supabase
      // Feature 052: `kind` separates original legs from refund legs so the
      // method/total describe the sale and refunds feed the net.
      .from("payments")
      .select("ticket_id, method, status, kind, amount_cents, tip_cents, processed_at")
      .in("ticket_id", ticketIds)
      .eq("status", "succeeded"),
  ]);

  const items = ((itemsRes as { data: TodayFeedItem[] | null }).data ??
    []) as readonly TodayFeedItem[];
  const payments = ((paymentsRes as { data: TodayFeedPayment[] | null }).data ??
    []) as readonly TodayFeedPayment[];

  // Bucket items and payments by ticket so row projection is O(n).
  const itemsByTicket = new Map<string, TodayFeedItem[]>();
  for (const it of items) {
    const list = itemsByTicket.get(it.ticket_id) ?? [];
    list.push(it);
    itemsByTicket.set(it.ticket_id, list);
  }
  const paymentsByTicket = new Map<string, TodayFeedPayment[]>();
  for (const p of payments) {
    const list = paymentsByTicket.get(p.ticket_id) ?? [];
    list.push(p);
    paymentsByTicket.set(p.ticket_id, list);
  }

  const rows: TransactionRow[] = [];
  for (const ticket of tickets) {
    const ticketItems = itemsByTicket.get(ticket.id) ?? [];
    const ticketPayments = paymentsByTicket.get(ticket.id) ?? [];

    // serviceLabel — non-discount name_snapshots only.
    const names = ticketItems.filter((it) => it.kind !== "discount").map((it) => it.name_snapshot);

    // techIds — unique non-discount assigned_staff_id, first-occurrence order.
    const techIds: string[] = [];
    for (const it of ticketItems) {
      if (it.kind === "discount") continue;
      const id = it.assigned_staff_id;
      if (!id) continue;
      if (!techIds.includes(id)) {
        techIds.push(id);
      }
    }

    // Feature 052: separate original legs from refund legs. Method/total
    // describe the sale (originals); refunds reduce the net.
    const originalPayments = ticketPayments.filter((p) => p.kind !== "refund");
    const refundedCents = ticketPayments
      .filter((p) => p.kind === "refund")
      .reduce((sum, p) => sum + p.amount_cents, 0);
    const reversal: TransactionRow["reversal"] =
      ticket.status === "refunded" || ticket.status === "partially_refunded" ? ticket.status : null;
    const netTotal = Math.max(0, ticket.total_cents - refundedCents) / 100;

    // method — single succeeded method, or 'split' for ≥2 distinct methods.
    const distinctMethods = Array.from(new Set(originalPayments.map((p) => p.method)));
    let method: PaymentMethod;
    if (distinctMethods.length >= 2) {
      method = "split";
    } else if (distinctMethods.length === 1) {
      const m = distinctMethods[0];
      if (m === "card" || m === "cash" || m === "gift") {
        method = m;
      } else {
        // Defensive fallback for unexpected enum values.
        method = "cash";
      }
    } else {
      // No succeeded payments — defensive default; the ticket shouldn't be
      // status='paid' without one, but project something rather than throw.
      method = "cash";
    }

    rows.push({
      id: ticket.id,
      time: ticket.closed_at ? formatTime(new Date(ticket.closed_at), tz) : "",
      serviceLabel: formatServiceLabel(names),
      techIds,
      method,
      total: ticket.total_cents / 100,
      reversal,
      netTotal,
    });
  }

  return rows;
}

// ── queryLastSaleTime ─────────────────────────────────────────────────────

export async function queryLastSaleTime(
  supabase: AnySupabase,
  tz: string,
  now: Date
): Promise<Date | null> {
  const [start, end] = todayWindow(tz, now);

  const res = await supabase
    .from("payments")
    .select("processed_at")
    .eq("status", "succeeded")
    .gte("processed_at", start.toISOString())
    .lte("processed_at", end.toISOString())
    .order("processed_at", { ascending: false })
    .limit(1);

  const rows = ((res as { data: Array<{ processed_at: string }> | null }).data ??
    []) as ReadonlyArray<{ processed_at: string }>;

  if (rows.length === 0) {
    // Fall back to a client-side max (some Supabase mocks ignore order/limit
    // and just return everything — the contract still wants max, not first).
    return null;
  }

  // Take the max across the returned set to be defensive against test mocks
  // and any future change to ordering.
  let maxIso = rows[0].processed_at;
  for (const r of rows) {
    if (r.processed_at > maxIso) maxIso = r.processed_at;
  }
  return new Date(maxIso);
}

// ── queryStaffRoster ──────────────────────────────────────────────────────

type StaffRow = { id: string; display_name: string; color_token: string };

export async function queryStaffRoster(supabase: AnySupabase): Promise<readonly Technician[]> {
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

// ── loadDashboard — orchestrator ──────────────────────────────────────────

export async function loadDashboard(supabase: AnySupabase): Promise<DashboardData> {
  const tz = await getSalonTimezone(supabase);
  const now = salonNow(tz);

  const [summaries, recent, lastSale, staff] = await Promise.all([
    queryDashboardSummaries(supabase, tz, now),
    queryTodayFeed(supabase, tz, now),
    queryLastSaleTime(supabase, tz, now),
    queryStaffRoster(supabase),
  ]);

  const subtitleBase = formatSubtitle(now, tz);
  const subtitle =
    lastSale !== null ? `${subtitleBase} · Last sale ${formatTime(lastSale, tz)}` : subtitleBase;

  return {
    greeting: {
      title: "Today at the salon",
      subtitle,
    },
    summaries,
    staff,
    recent,
    quickActions: QUICK_ACTIONS,
  };
}
