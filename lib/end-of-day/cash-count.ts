// Server-only query layer for the End-of-Day Cash Count page.
//
// `loadCashCount(supabase, tz, now)` returns everything the page RSC needs
// in a single round-trip-ish read:
//   - `sessionState` — 'open' if no closed session exists for today,
//     'closed' otherwise.
//   - `businessDay` — YYYY-MM-DD in the salon's local zone.
//   - `expectedCents` — sum of today's succeeded cash payments. Refund
//     rows subtract; today the `payments.kind` enum only carries
//     'payment', so this collapses to a plain sum, but the aggregator
//     handles the refund case for forward-compat.
//   - `rows` — the per-payment cash list (time, client, services, techs,
//     amount, tip), time-ordered ascending.
//   - `closedSession` — present iff the day is already closed; carries
//     the persisted counted/variance/notes for the done-screen.
//
// The function is intentionally permissive about the supabase client type
// (server-cookie-aware or service-role) so it can be reused later by a
// scheduled job. Reads only — never writes.

import type { CashRow, TechBadge } from "@/lib/end-of-day/aggregate";
import { expectedCentsFromRows, formatServicesSummary } from "@/lib/end-of-day/aggregate";
import { todayWindow } from "@/lib/time/period-windows";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type AnySupabase = SupabaseClient<Database>;

export type ClosedSessionSummary = {
  id: string;
  closedAt: Date;
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
  notes: string | null;
  closedByStaffId: string | null;
};

export type CashCountSnapshot = {
  sessionState: "open" | "closed";
  /** YYYY-MM-DD in the salon's local zone. */
  businessDay: string;
  expectedCents: number;
  rows: CashRow[];
  closedSession?: ClosedSessionSummary;
};

type PaymentRow = {
  id: string;
  ticket_id: string;
  amount_cents: number;
  tip_cents: number;
  processed_at: string;
  kind: Database["public"]["Enums"]["payment_kind"];
};

type TicketItemRow = {
  ticket_id: string;
  kind: Database["public"]["Enums"]["ticket_item_kind"];
  name_snapshot: string;
  // Nullable on purpose: `discount` line items carry no staff — the
  // `ticket_items_kind_columns_chk` constraint forces `assigned_staff_id`
  // to NULL for them. Typing this as plain `string` was the bug behind
  // the End-of-Day page crash (see the null-strip in `loadCashCount`).
  assigned_staff_id: string | null;
};

type TicketRow = {
  id: string;
  appointment_id: string | null;
};

type StaffRow = {
  id: string;
  display_name: string;
  color_token: string;
};

type CashSessionRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  closed_by_staff_id: string | null;
  expected_cents: number | null;
  counted_cents: number | null;
  variance_cents: number | null;
  notes: string | null;
  business_day: string;
};

/**
 * Returns a YYYY-MM-DD string for the local date that contains `now` in
 * `tz`. Pure; used by both the query layer (for `closedSession` matching)
 * and the close Server Action (for the RPC's p_business_day arg).
 *
 * Kept here rather than in `lib/time/format.ts` because the format helper
 * stays UI-facing; this one is server-internal. T011 adds the canonical
 * `salonDateString` to `lib/time/format.ts` for the action's use.
 */
function businessDayString(tz: string, now: Date): string {
  // Use Intl.DateTimeFormat with `en-CA` which formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Constructs initials from a display name. Strips non-letters, takes the
 * first letter of each token, uppercase, max 2 chars. "Alex Park" → "AP";
 * "Jordan" → "J".
 */
function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-z]/g, ""))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export async function loadCashCount(
  supabase: AnySupabase,
  tz: string,
  now: Date
): Promise<CashCountSnapshot> {
  const businessDay = businessDayString(tz, now);
  const [start, end] = todayWindow(tz, now);

  // 1) Load today's succeeded cash payments. `tip_cents` is included even
  //    though it's always 0 today, so the row carries the field if/when
  //    tipping ships.
  const paymentsRes = await supabase
    .from("payments")
    .select("id, ticket_id, amount_cents, tip_cents, processed_at, kind")
    .eq("method", "cash")
    .eq("status", "succeeded")
    .gte("processed_at", start.toISOString())
    .lte("processed_at", end.toISOString())
    .order("processed_at", { ascending: true });

  if (paymentsRes.error) {
    throw paymentsRes.error;
  }
  const payments = (paymentsRes.data ?? []) as readonly PaymentRow[];

  // 2) Load today's cash_drawer_sessions row(s), newest first. The
  //    partial unique index guarantees at most one open row across the
  //    whole table, so the latest row for `business_day` is the
  //    authoritative source of "is the day closed?".
  const sessionRes = await supabase
    .from("cash_drawer_sessions")
    .select(
      "id, opened_at, closed_at, closed_by_staff_id, expected_cents, counted_cents, variance_cents, notes, business_day"
    )
    .eq("business_day", businessDay)
    .order("opened_at", { ascending: false })
    .limit(1);

  if (sessionRes.error) {
    throw sessionRes.error;
  }
  const todaySession = ((sessionRes.data ?? [])[0] as CashSessionRow | undefined) ?? null;

  // If there are no cash payments AND no session row yet, short-circuit.
  if (payments.length === 0 && todaySession === null) {
    return {
      sessionState: "open",
      businessDay,
      expectedCents: 0,
      rows: [],
    };
  }

  // 3) Hydrate ticket → appointment → staff. Even when payments is empty
  //    we still need to project the closed session, so this block runs
  //    only when there are payments to enrich.
  let rows: CashRow[] = [];
  if (payments.length > 0) {
    const ticketIds = Array.from(new Set(payments.map((p) => p.ticket_id)));

    const [ticketsRes, itemsRes] = await Promise.all([
      supabase.from("tickets").select("id, appointment_id").in("id", ticketIds),
      supabase
        .from("ticket_items")
        .select("ticket_id, kind, name_snapshot, assigned_staff_id")
        .in("ticket_id", ticketIds),
    ]);
    if (ticketsRes.error) throw ticketsRes.error;
    if (itemsRes.error) throw itemsRes.error;

    const tickets = (ticketsRes.data ?? []) as readonly TicketRow[];
    const items = (itemsRes.data ?? []) as readonly TicketItemRow[];

    // Collect staff ids referenced by ticket_items, hydrate name + color.
    // `discount` rows have a NULL `assigned_staff_id`; strip those out so
    // the `.in("id", …)` below never receives a null. A null in the list
    // serializes to `id=in.(…,null)`, which Postgres rejects with
    // `invalid input syntax for type uuid: "null"` — the error that
    // crashed the End-of-Day page for any day with a discounted cash
    // sale. Mirrors the null-strip already used in the sibling
    // `lib/end-of-day/history.ts`.
    const staffIds = Array.from(
      new Set(items.map((it) => it.assigned_staff_id).filter((id): id is string => id !== null))
    );
    let staffById = new Map<string, StaffRow>();
    if (staffIds.length > 0) {
      const staffRes = await supabase
        .from("staff")
        .select("id, display_name, color_token")
        .in("id", staffIds);
      if (staffRes.error) throw staffRes.error;
      staffById = new Map(((staffRes.data ?? []) as readonly StaffRow[]).map((s) => [s.id, s]));
    }

    // Bucket items by ticket so we can project per-payment rows.
    const itemsByTicket = new Map<string, TicketItemRow[]>();
    for (const it of items) {
      const list = itemsByTicket.get(it.ticket_id) ?? [];
      list.push(it);
      itemsByTicket.set(it.ticket_id, list);
    }
    const ticketsById = new Map<string, TicketRow>();
    for (const t of tickets) {
      ticketsById.set(t.id, t);
    }

    // Project each payment into a CashRow. Today the clients table
    // doesn't exist yet (see migration 0004 comment) so client always
    // falls back to "Walk-in"; once clients land this is the join site.
    rows = payments.map((p) => {
      const ticketItems = itemsByTicket.get(p.ticket_id) ?? [];
      const serviceNames = ticketItems
        .filter((it) => it.kind !== "discount")
        .map((it) => it.name_snapshot);
      const techBadges: TechBadge[] = [];
      const seenStaff = new Set<string>();
      for (const it of ticketItems) {
        if (it.kind === "discount") continue;
        // Defensive: `assigned_staff_id` is nullable (discount rows). The
        // `kind` check above already skips those, but the explicit null
        // guard narrows the type for the lookups below.
        if (it.assigned_staff_id === null) continue;
        if (seenStaff.has(it.assigned_staff_id)) continue;
        seenStaff.add(it.assigned_staff_id);
        const s = staffById.get(it.assigned_staff_id);
        if (!s) continue;
        techBadges.push({
          id: s.id,
          initials: initialsOf(s.display_name),
          colorToken: s.color_token,
        });
      }

      // Refund detection: when the synthetic refund kind eventually
      // ships, treat the row as a refund. Today every payments.kind is
      // 'payment'.
      const isRefund = (p.kind as unknown as string) === "refund";
      return {
        id: p.id,
        processedAt: new Date(p.processed_at),
        kind: isRefund ? "refund" : "payment",
        client: "Walk-in",
        services: formatServicesSummary(serviceNames),
        techs: techBadges,
        // Refund rows carry negative amounts per the CashRow contract;
        // today's `payments.amount_cents` is always positive but the
        // sign-flip below keeps the aggregator correct when refunds land.
        amountCents: isRefund ? -Math.abs(p.amount_cents) : p.amount_cents,
        tipCents: p.tip_cents,
      };
    });
  }

  const expectedCents = expectedCentsFromRows(rows);

  const sessionState: "open" | "closed" =
    todaySession && todaySession.closed_at !== null ? "closed" : "open";

  const closedSession: ClosedSessionSummary | undefined =
    sessionState === "closed" && todaySession
      ? {
          id: todaySession.id,
          closedAt: new Date(todaySession.closed_at!),
          expectedCents: todaySession.expected_cents ?? 0,
          countedCents: todaySession.counted_cents ?? 0,
          varianceCents: todaySession.variance_cents ?? 0,
          notes: todaySession.notes,
          closedByStaffId: todaySession.closed_by_staff_id,
        }
      : undefined;

  return {
    sessionState,
    businessDay,
    expectedCents,
    rows,
    closedSession,
  };
}
