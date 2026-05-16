"use server";

// Server Actions for the cash-only checkout flow (`/checkout`).
//
// Contract: `specs/011-cash-sale-checkout/contracts/server-actions.md`.
// Every action follows the shared prelude documented there:
//   1. `requireStudioSession()`  — auth resolver; throws AuthRedirectError
//   2. parse + validate args     — per-action
//   3. load + status-check       — refuse on terminal-status tickets
//   4. mutate via service-role   — bypasses RLS (writes have no client policy)
//   5. recompute totals (write)  — for line mutations; total flows back to UI
//   6. `recordAudit(...)`        — controlled-vocab verbs from lib/auth/audit.ts
//   7. return the typed result   — no redirect; the client island reacts
//
// Phase 2 (this file's initial commit) ships the scaffold + the one action
// shared across stories: `createEmptyTicket()`. The other six actions land
// in their respective user-story phases.
//
// Typed error classes live in `./_errors` because Next.js' `"use server"`
// constraint forbids any non-async export from this file. Callers
// (`checkout-screen.client.tsx`, tests/unit/checkout/*) import the
// classes directly from `./_errors`; for backward-compat with anything
// that was importing them from this module, the actions throw instances
// of those same classes, so `instanceof` checks against `./_errors`
// imports still narrow correctly.

import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

import {
  CashPaymentFailedError,
  ServiceArchivedError,
  StaffNotActiveError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "./_errors";

// Loose 36-char hyphenated hex shape check. The DB FKs are the real
// guard; this just drops obviously bogus payloads before a round-trip.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_SHAPE.test(value)) {
    throw new Error(`${label}: expected uuid, got ${JSON.stringify(value)}`);
  }
}

// ----------------------------------------------------------------------
// 1. createEmptyTicket — opens a fresh ticket with no appointment and no
//    lines. Called by:
//      - the dashboard "New transaction" CTA (passes 'dashboard_cta')
//      - the DoneScreen's "New sale" button (FR-023; default 'unspecified'
//        — startNewSale below)
//      - `resumeOrCreateTicket()` when no same-day open ticket is found
//        for this operator (US2; passes 'sidebar_resume_or_create')
//
//    Returns `{ ticketId }` so the caller can redirect to
//    `/checkout/[ticketId]`. The server emits the `ticket.created` audit
//    row before returning; the redirect is the caller's responsibility.
//
//    The `entryPoint` argument is stamped onto the audit payload
//    (`payload.created_by_entry_point`) so the audit log explains which
//    surface created the ticket. Defaults to `'unspecified'` for
//    backward-compatible callers that haven't been parameterised yet.
// ----------------------------------------------------------------------

export type TicketEntryPoint =
  | "unspecified"
  | "dashboard_cta"
  | "sidebar_resume_or_create"
  | "done_screen_new_sale";

export async function createEmptyTicket(
  entryPoint: TicketEntryPoint = "unspecified"
): Promise<{ ticketId: string }> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("tickets")
    .insert({
      status: "open",
      appointment_id: null,
      opened_by_staff_id: viewer.staff.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createEmptyTicket failed: ${error?.message ?? "no row returned"}`);
  }

  await recordAudit(
    "ticket.created",
    viewer.deviceUserId,
    data.id,
    { created_by_entry_point: entryPoint },
    viewer.staff.id
  );

  return { ticketId: data.id };
}

// ----------------------------------------------------------------------
// 2. resumeOrCreateTicket — sidebar "Checkout" entry-point (T033 /
//    contracts § 2 / research.md § R8). Returns the operator's existing
//    same-day open ticket (most recently updated) if one exists;
//    otherwise delegates to `createEmptyTicket('sidebar_resume_or_create')`.
//
//    Resume is the read path — NO audit row is emitted when an existing
//    ticket is returned (no write occurred). Audit emission happens only
//    via the delegated `createEmptyTicket()` call when we fall through to
//    the create branch, with `created_by_entry_point` set correctly.
//
//    "Today" is the operator's salon-local calendar day (FR-003 / R8):
//    we read `process.env.SALON_TZ` (defaulting to America/New_York to
//    match research.md), derive today's YYYY-MM-DD in that zone via
//    `Intl.DateTimeFormat`, and compute the UTC instants for
//    salon-midnight today and salon-midnight tomorrow. The query then
//    filters `created_at >= startOfDay AND created_at < nextDay`.
//    DST is handled by the two-pass offset trick in
//    `salonMidnightUtc()` — see comments there.
// ----------------------------------------------------------------------

const SALON_TZ_DEFAULT = "America/New_York";

/**
 * Returns the UTC `Date` instant corresponding to salon-local midnight on
 * `ymd` (`YYYY-MM-DD`) in the IANA zone `tz`. Two-pass:
 *   1. Treat `${ymd}T00:00:00` as if it were UTC; ask `Intl` what
 *      wall-clock that instant is in `tz`.
 *   2. The difference between the original "as-if-UTC" instant and the
 *      wall-clock `Intl` reports back is the zone offset (signed). Add
 *      it back to land on the true midnight-in-`tz` UTC instant.
 *
 * Correct across DST transitions because the offset is queried for the
 * specific date being computed, not a fixed value.
 */
function salonMidnightUtc(ymd: string, tz: string): Date {
  const asUtc = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(asUtc);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const observedWall = Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`
  );
  const offsetMs = asUtc.getTime() - observedWall;
  return new Date(asUtc.getTime() + offsetMs);
}

/**
 * Returns `[startOfDay, nextDay]` — the UTC instants bounding the
 * salon's current calendar day. Exported for unit tests + future
 * `lib/time/*` extraction.
 */
function salonTodayBoundsUtc(): { startOfDay: Date; nextDay: Date } {
  const tz = process.env.SALON_TZ ?? SALON_TZ_DEFAULT;
  // Derive the salon's current Y-M-D in `tz`-local terms.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const salonYmd = `${get("year")}-${get("month")}-${get("day")}`;
  const startOfDay = salonMidnightUtc(salonYmd, tz);
  const nextDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDay, nextDay };
}

export async function resumeOrCreateTicket(): Promise<{
  ticketId: string;
  resumed: boolean;
}> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const { startOfDay, nextDay } = salonTodayBoundsUtc();

  // The partial index `tickets_open_by_operator_recent_idx` on
  // (opened_by_staff_id, updated_at desc) WHERE status='open' makes this
  // an index-only resume lookup. Filter by created_at within the salon's
  // current day; order by most-recently-updated and take the first row.
  const { data, error } = await supabase
    .from("tickets")
    .select("id")
    .eq("status", "open")
    .eq("opened_by_staff_id", viewer.staff.id)
    .gte("created_at", startOfDay.toISOString())
    .lt("created_at", nextDay.toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`resumeOrCreateTicket query failed: ${error.message}`);
  }

  if (data?.id) {
    // Read-only hit — no audit (no write occurred). Per contracts § 2.
    return { ticketId: data.id, resumed: true };
  }

  // No same-day open ticket for this operator — fall through to create.
  // The `ticket.created` audit row is emitted by `createEmptyTicket()`
  // with `created_by_entry_point = 'sidebar_resume_or_create'`.
  const { ticketId } = await createEmptyTicket("sidebar_resume_or_create");
  return { ticketId, resumed: false };
}

// ----------------------------------------------------------------------
// Internal totals helper — re-derives subtotal / total over a ticket's
// items per the contract (R2): subtotal sums only fixed-price lines
// (`price_unconfirmed = false`); tax stays 0; total = subtotal + tax.
// Used by `addServiceLine` and `removeLine` after each mutation.
// ----------------------------------------------------------------------

async function recomputeTicketTotals(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  ticketId: string
): Promise<{ subtotalCents: number; totalCents: number }> {
  const { data, error } = await supabase
    .from("ticket_items")
    .select("unit_price_cents, qty, price_unconfirmed")
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(`recomputeTicketTotals read failed: ${error.message}`);
  }

  const subtotalCents = (data ?? [])
    .filter((row) => row.price_unconfirmed === false)
    .reduce((sum, row) => sum + row.unit_price_cents * row.qty, 0);
  const totalCents = subtotalCents; // tax_cents stays 0 in this phase.

  const { error: updErr } = await supabase
    .from("tickets")
    .update({ subtotal_cents: subtotalCents, total_cents: totalCents })
    .eq("id", ticketId);
  if (updErr) {
    throw new Error(`recomputeTicketTotals write failed: ${updErr.message}`);
  }

  return { subtotalCents, totalCents };
}

// ----------------------------------------------------------------------
// 3. addServiceLine — tap a service tile (T024 / contracts § 3).
//    Validates session, ticket-open, staff-active, service-not-archived,
//    snapshots {name, unit_price, price_unconfirmed} onto the ticket_items
//    row, recomputes totals, emits `ticket.line_added` audit.
// ----------------------------------------------------------------------

export type AddServiceLineInput = {
  ticketId: string;
  serviceId: string;
  assignedStaffId: string;
};

export async function addServiceLine(
  input: AddServiceLineInput
): Promise<{ lineId: string; subtotalCents: number; totalCents: number }> {
  assertUuid(input.ticketId, "addServiceLine.ticketId");
  assertUuid(input.serviceId, "addServiceLine.serviceId");
  assertUuid(input.assignedStaffId, "addServiceLine.assignedStaffId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`addServiceLine ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 2) Staff must be active.
  const { data: staff, error: staffErr } = await supabase
    .from("staff")
    .select("id, active")
    .eq("id", input.assignedStaffId)
    .maybeSingle();
  if (staffErr) {
    throw new Error(`addServiceLine staff read failed: ${staffErr.message}`);
  }
  if (!staff || staff.active !== true) {
    throw new StaffNotActiveError();
  }

  // 3) Service must be active.
  const { data: service, error: svcErr } = await supabase
    .from("services")
    .select("id, name, price_cents, variable_price, active")
    .eq("id", input.serviceId)
    .single();
  if (svcErr || !service) {
    throw new Error(`addServiceLine service read failed: ${svcErr?.message ?? "not found"}`);
  }
  if (service.active === false) {
    throw new ServiceArchivedError();
  }

  // 4) Insert the line — snapshotting name + price at insert time.
  const { data: lineRow, error: insErr } = await supabase
    .from("ticket_items")
    .insert({
      ticket_id: input.ticketId,
      kind: "service",
      ref_id: input.serviceId,
      name_snapshot: service.name,
      unit_price_cents: service.price_cents,
      qty: 1,
      assigned_staff_id: input.assignedStaffId,
      price_unconfirmed: service.variable_price,
    })
    .select("id")
    .single();
  if (insErr || !lineRow) {
    throw new Error(`addServiceLine insert failed: ${insErr?.message ?? "no row returned"}`);
  }

  // 5) Recompute + persist totals (R2).
  const totals = await recomputeTicketTotals(supabase, input.ticketId);

  // 6) Audit.
  await recordAudit(
    "ticket.line_added",
    viewer.deviceUserId,
    lineRow.id,
    {
      ticket_id: input.ticketId,
      service_id: input.serviceId,
      unit_price_cents: service.price_cents,
      price_unconfirmed: service.variable_price,
    },
    viewer.staff.id
  );

  return { lineId: lineRow.id, subtotalCents: totals.subtotalCents, totalCents: totals.totalCents };
}

// ----------------------------------------------------------------------
// 4. removeLine — delete a cart line (T025 / contracts § 4).
// ----------------------------------------------------------------------

export type RemoveLineInput = { ticketId: string; lineId: string };

export async function removeLine(
  input: RemoveLineInput
): Promise<{ subtotalCents: number; totalCents: number }> {
  assertUuid(input.ticketId, "removeLine.ticketId");
  assertUuid(input.lineId, "removeLine.lineId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`removeLine ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // Capture service_id + unit_price for the audit payload before delete.
  const { data: lineRow, error: readErr } = await supabase
    .from("ticket_items")
    .select("id, ref_id, unit_price_cents, ticket_id")
    .eq("id", input.lineId)
    .single();
  if (readErr || !lineRow) {
    throw new Error(`removeLine line read failed: ${readErr?.message ?? "not found"}`);
  }
  if (lineRow.ticket_id !== input.ticketId) {
    throw new Error(`removeLine: line ${input.lineId} does not belong to ticket ${input.ticketId}`);
  }

  const { error: delErr } = await supabase.from("ticket_items").delete().eq("id", input.lineId);
  if (delErr) {
    throw new Error(`removeLine delete failed: ${delErr.message}`);
  }

  const totals = await recomputeTicketTotals(supabase, input.ticketId);

  await recordAudit(
    "ticket.line_removed",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      service_id: lineRow.ref_id,
      unit_price_cents: lineRow.unit_price_cents,
    },
    viewer.staff.id
  );

  return totals;
}

// ----------------------------------------------------------------------
// 5. setLineTech — per-line tech reassignment (T039 / contracts § 5).
//    Reads the row's current `assigned_staff_id` for the audit payload's
//    `previous_staff_id`, then updates ONLY that line's
//    `assigned_staff_id`. The header-picked tech is untouched and no
//    other lines change. Snapshot fields (`name_snapshot`,
//    `unit_price_cents`, `price_unconfirmed`) are NEVER touched here
//    (Constitution Principle III).
// ----------------------------------------------------------------------

export type SetLineTechInput = {
  ticketId: string;
  lineId: string;
  assignedStaffId: string;
};

export async function setLineTech(input: SetLineTechInput): Promise<{ ok: true }> {
  assertUuid(input.ticketId, "setLineTech.ticketId");
  assertUuid(input.lineId, "setLineTech.lineId");
  assertUuid(input.assignedStaffId, "setLineTech.assignedStaffId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`setLineTech ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 2) New staff must be active.
  const { data: staff, error: staffErr } = await supabase
    .from("staff")
    .select("id, active")
    .eq("id", input.assignedStaffId)
    .maybeSingle();
  if (staffErr) {
    throw new Error(`setLineTech staff read failed: ${staffErr.message}`);
  }
  if (!staff || staff.active !== true) {
    throw new StaffNotActiveError();
  }

  // 3) Read the row's current `assigned_staff_id` for the audit payload.
  //    Also defensive: confirm the line actually belongs to this ticket.
  const { data: lineRow, error: readErr } = await supabase
    .from("ticket_items")
    .select("id, ticket_id, assigned_staff_id")
    .eq("id", input.lineId)
    .single();
  if (readErr || !lineRow) {
    throw new Error(`setLineTech line read failed: ${readErr?.message ?? "not found"}`);
  }
  if (lineRow.ticket_id !== input.ticketId) {
    throw new Error(
      `setLineTech: line ${input.lineId} does not belong to ticket ${input.ticketId}`
    );
  }

  const previousStaffId = lineRow.assigned_staff_id as string;

  // 4) Update ONLY the assigned_staff_id on the named row. No totals
  //    recompute — tech reassignment doesn't change subtotal/total.
  const { error: updErr } = await supabase
    .from("ticket_items")
    .update({ assigned_staff_id: input.assignedStaffId })
    .eq("id", input.lineId);
  if (updErr) {
    throw new Error(`setLineTech update failed: ${updErr.message}`);
  }

  // 5) Audit.
  await recordAudit(
    "ticket.line_tech_assigned",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      previous_staff_id: previousStaffId,
      new_staff_id: input.assignedStaffId,
    },
    viewer.staff.id
  );

  return { ok: true };
}

// ----------------------------------------------------------------------
// 6. takeCash — atomic cash payment (T026 / contracts § 6).
//    Calls `pos_take_cash` RPC and maps Postgres error messages to the
//    typed checkout-error classes. The RPC owns the audit emission for
//    `payment.captured` — this action does NOT also call recordAudit.
// ----------------------------------------------------------------------

export type TakeCashInput = { ticketId: string };

// TODO(phase-9): when cash drawer sessions are gated (Out of Scope here),
// ensure pos_take_cash() also increments the open session's expected_cents.

export async function takeCash(
  input: TakeCashInput
): Promise<{ paymentId: string; chargedCents: number }> {
  assertUuid(input.ticketId, "takeCash.ticketId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const { data: paymentId, error } = await supabase.rpc("pos_take_cash", {
    p_ticket_id: input.ticketId,
    p_operator: viewer.staff.id,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ticket_not_open")) {
      throw new TicketNotOpenError();
    }
    if (msg.includes("ticket_has_unpriced_items")) {
      throw new TicketHasUnpricedItemsError();
    }
    if (msg.includes("ticket_empty")) {
      throw new TicketEmptyError();
    }
    throw new CashPaymentFailedError("cash payment failed", msg);
  }

  if (!paymentId) {
    throw new CashPaymentFailedError("cash payment RPC returned no payment id");
  }

  // The RPC only returns the payment id; read back the trusted total
  // (post-charge `tickets.total_cents` is the source of truth).
  const { data: ticketRow, error: readErr } = await supabase
    .from("tickets")
    .select("total_cents")
    .eq("id", input.ticketId)
    .single();
  if (readErr || !ticketRow) {
    throw new CashPaymentFailedError(
      `takeCash post-charge read failed: ${readErr?.message ?? "no row"}`
    );
  }

  return { paymentId: paymentId as string, chargedCents: ticketRow.total_cents };
}

// ----------------------------------------------------------------------
// 7. discardTicket — terminal discard (T027 / contracts § 7).
//    Refuses on terminal status; captures pre-update snapshot for audit;
//    flips status to 'discarded' with closed_by / closed_at; audits.
// ----------------------------------------------------------------------

export type DiscardTicketInput = { ticketId: string };

export async function discardTicket(input: DiscardTicketInput): Promise<{ ok: true }> {
  assertUuid(input.ticketId, "discardTicket.ticketId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Snapshot the ticket for terminal-state check + audit payload.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status, subtotal_cents")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`discardTicket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status === "paid" || ticket.status === "discarded") {
    throw new TicketAlreadyTerminalError();
  }

  // Line count for the audit payload (cheap headcount).
  const { count, error: countErr } = await supabase
    .from("ticket_items")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", input.ticketId);
  if (countErr) {
    throw new Error(`discardTicket count failed: ${countErr.message}`);
  }

  const closedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("tickets")
    .update({
      status: "discarded",
      closed_by_staff_id: viewer.staff.id,
      closed_at: closedAt,
    })
    .eq("id", input.ticketId);
  if (updErr) {
    throw new Error(`discardTicket update failed: ${updErr.message}`);
  }

  await recordAudit(
    "ticket.discarded",
    viewer.deviceUserId,
    input.ticketId,
    {
      subtotal_cents_at_discard: ticket.subtotal_cents,
      line_count_at_discard: count ?? 0,
    },
    viewer.staff.id
  );

  return { ok: true };
}

// ----------------------------------------------------------------------
// startNewSale — `<form action={startNewSale}>` helper for DoneScreen
// (FR-023). Creates a fresh empty ticket then redirects server-side.
// Lives here because Server Action exports must come from a "use server"
// file and the action needs to run in the request's server lifecycle.
// ----------------------------------------------------------------------

export async function startNewSale(): Promise<void> {
  const { ticketId } = await createEmptyTicket();
  redirect(`/checkout/${ticketId}`);
}
