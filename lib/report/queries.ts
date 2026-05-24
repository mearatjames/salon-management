// lib/report/queries.ts
// -----------------------------------------------------------------------------
// Live Supabase query layer for the Report page read model. Server-only.
//
// `loadReportPage` browses a full historical `[start, end)` reporting window,
// fetching the paid tickets in that window and their service items / succeeded
// payments, then resolving the deduction config (`services`) and the performing
// technicians (`staff`, with NO `active` filter — a removed tech still appears
// in past periods, R8). The pure `projectReport` does the deduction/tip math.
//
// All reads are RLS-bound (the supabase client comes from the server-side
// cookie-aware helper). Reads hit `public.tickets`, `public.ticket_items`,
// `public.payments`, `public.services`, `public.staff`, and `public.settings`.
//
// See contracts/report-read-model.md § C2.

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSalonTimezone } from "@/lib/db/settings";
import type { Database } from "@/lib/db/types";
import {
  projectReport,
  type ReportItemRow,
  type ReportPaymentRow,
  type ReportReadModel,
  type ReportServiceRow,
  type ReportStaffRow,
  type ReportTicketRow,
} from "./aggregate";
import type { ReportWindow } from "./window";

type AnySupabase = SupabaseClient<Database>;

const EMPTY_READ_MODEL: ReportReadModel = {
  technicians: [],
  totals: {
    technicianCount: 0,
    transactionCount: 0,
    serviceCount: 0,
    grossCents: 0,
    cardFeeCents: 0,
    supplyCents: 0,
    totalDeductionsCents: 0,
    commissionableCents: 0,
    cardTipsCents: 0,
    discountsCents: 0,
  },
  isEmpty: true,
};

/**
 * Loads the Report page read model for `window` (contract C2).
 *
 * Orchestrates, in order:
 *  1. resolve the salon timezone;
 *  2. query `status='paid'` tickets with `closed_at ∈ [start, end)` — an empty
 *     ticket set returns the empty read model with no child queries;
 *  3. fetch `ticket_items` + succeeded `payments` for those tickets concurrently;
 *  4. resolve `services` for the distinct non-null `ref_id`s;
 *  5. resolve `staff` for the distinct service-item `assigned_staff_id`s — by
 *     id, with no `active` filter;
 *  6. project everything into the `ReportReadModel`.
 */
export async function loadReportPage(
  supabase: AnySupabase,
  window: ReportWindow
): Promise<{ report: ReportReadModel; tz: string }> {
  const tz = await getSalonTimezone(supabase);

  const ticketsRes = await supabase
    .from("tickets")
    .select("id, status, closed_at")
    .eq("status", "paid")
    .gte("closed_at", window.start.toISOString())
    .lt("closed_at", window.end.toISOString())
    .order("closed_at", { ascending: false });

  const tickets = ((ticketsRes as { data: ReportTicketRow[] | null }).data ??
    []) as readonly ReportTicketRow[];

  if (tickets.length === 0) {
    return { report: EMPTY_READ_MODEL, tz };
  }

  const ticketIds = tickets.map((t) => t.id);

  const [itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from("ticket_items")
      .select("ticket_id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id")
      .in("ticket_id", ticketIds),
    supabase
      .from("payments")
      .select("ticket_id, method, status, tip_cents")
      .in("ticket_id", ticketIds)
      .eq("status", "succeeded"),
  ]);

  const items = ((itemsRes as { data: ReportItemRow[] | null }).data ??
    []) as readonly ReportItemRow[];
  const payments = ((paymentsRes as { data: ReportPaymentRow[] | null }).data ??
    []) as readonly ReportPaymentRow[];

  // Resolve deduction config for the services the service-line items reference.
  const serviceIds = Array.from(
    new Set(
      items
        .filter((it) => it.kind === "service")
        .map((it) => it.ref_id)
        .filter((id): id is string => id !== null)
    )
  );
  let services: readonly ReportServiceRow[] = [];
  if (serviceIds.length > 0) {
    const servicesRes = await supabase
      .from("services")
      .select("id, card_fee_mode, card_fee_custom_cents, supply_amount_cents, supply_type_id")
      .in("id", serviceIds);
    services = ((servicesRes as { data: ReportServiceRow[] | null }).data ??
      []) as readonly ReportServiceRow[];
  }

  // Resolve the performing technicians of the service-line items — by id, with
  // NO `active` filter, so a removed tech still appears in past periods (R8).
  const performerIds = Array.from(
    new Set(
      items
        .filter((it) => it.kind === "service")
        .map((it) => it.assigned_staff_id)
        .filter((id): id is string => id !== null)
    )
  );
  let staff: readonly ReportStaffRow[] = [];
  if (performerIds.length > 0) {
    const staffRes = await supabase
      .from("staff")
      .select("id, display_name, color_token, card_fee_exempt, supply_mode, supply_except")
      .in("id", performerIds);
    staff = ((staffRes as { data: ReportStaffRow[] | null }).data ??
      []) as readonly ReportStaffRow[];
  }

  const report = projectReport({ tz, tickets, items, payments, staff, services });
  return { report, tz };
}
