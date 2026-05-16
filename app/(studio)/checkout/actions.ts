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
import { getSetting } from "@/lib/settings/read";

import {
  CashPaymentFailedError,
  DiscountInvalidError,
  EmailAddressInvalidError,
  InvalidPriceError,
  ServiceArchivedError,
  StaffNotActiveError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "./_errors";

// ----------------------------------------------------------------------
// T035 (US4): shared email regex constant used by `emailBillStub` for
// server-side address validation. The client (`email-bill-dialog.tsx`)
// duplicates this literal so the two validations stay textually identical
// — rather than exporting from this `"use server"` file (which forbids
// non-async exports) we keep the regex tiny and tolerate the duplication.
// ----------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ----------------------------------------------------------------------
// T026 (US3): discountNameSnapshot — co-located helper used by
// addDiscountLine to snapshot the row's `name_snapshot`. Co-located here
// (not exported) because it has exactly one caller.
// ----------------------------------------------------------------------

function discountNameSnapshot(shape: "flat" | "percent", value: number): string {
  return shape === "percent" ? `Discount · ${value}%` : "Discount";
}

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
// items per the contract (R2 / R11 / R18). One SELECT (pulls in `kind`
// and `discount_pct` so percent-discount rows can be recomputed against
// the freshly summed service subtotal), N targeted per-row UPDATEs for
// any percent-discount row whose stored amount has drifted, and one
// final UPDATE on `tickets` with the new subtotal/total. No second
// roundtrip — discount-row amounts are folded in memory after the
// targeted UPDATEs so the ticket UPDATE sees fresh values.
//
// Math (mirrored in `lib/pos/cart.ts::computeTotals`):
//   service_subtotal = sum over kind='service' && !price_unconfirmed
//   percent_amount   = -round(pct * service_subtotal / 100)  per discount row
//   discount_total   = sum over kind='discount' (negative or zero)
//   subtotal_cents   = max(0, service_subtotal + discount_total)
//   total_cents      = subtotal_cents   (tax_cents stays 0 this phase)
//
// Used by every mutating cart action: `addServiceLine`, `removeLine`,
// `setLinePrice`, `addDiscountLine`, `removeDiscountLine`. The signature
// and call sites are unchanged from phase 2 — the body just does more.
// ----------------------------------------------------------------------

async function recomputeTicketTotals(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  ticketId: string
): Promise<{ subtotalCents: number; totalCents: number }> {
  const { data, error } = await supabase
    .from("ticket_items")
    .select("id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct")
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(`recomputeTicketTotals read failed: ${error.message}`);
  }

  const rows = (data ?? []).map((r) => ({ ...r }));

  // 1) Service subtotal — only confirmed service rows contribute.
  const serviceSubtotal = rows
    .filter((row) => row.kind === "service" && row.price_unconfirmed === false)
    .reduce((sum, row) => sum + row.unit_price_cents * row.qty, 0);

  // 2) Re-price each percent-discount row against the fresh service
  //    subtotal. Only UPDATE rows whose stored amount has actually
  //    drifted to avoid useless writes (and audit-trigger noise, when
  //    we add one later).
  for (const row of rows) {
    if (row.kind === "discount" && row.discount_pct != null) {
      const newAmount = -Math.round((Number(row.discount_pct) * serviceSubtotal) / 100);
      if (newAmount !== row.unit_price_cents) {
        const { error: rowErr } = await supabase
          .from("ticket_items")
          .update({ unit_price_cents: newAmount })
          .eq("id", row.id);
        if (rowErr) {
          throw new Error(
            `recomputeTicketTotals discount-row update failed (${row.id}): ${rowErr.message}`
          );
        }
        row.unit_price_cents = newAmount;
      }
    }
  }

  // 3) Discount total — sum over the (now-fresh) discount rows.
  const discountTotal = rows
    .filter((row) => row.kind === "discount")
    .reduce((sum, row) => sum + row.unit_price_cents * row.qty, 0);

  const subtotalCents = Math.max(0, serviceSubtotal + discountTotal);
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
// 5b. setLinePrice — save a price for a variable-priced cart row (US1)
//     OR override the snapshotted price on a confirmed row (US2).
//     Contract: `specs/013-cart-polish/contracts/server-actions.md § 1`.
//
//     Refuses if the named line is on a different ticket (defensive Error,
//     same pattern as setLineTech), if the row is a discount line
//     (InvalidPriceError), or if `unitPriceCents <= 0` (InvalidPriceError;
//     defense in depth — the client also enforces this via the sheet's
//     disabled-Save state and the contract's zod schema).
//
//     Single write path for both auto-open (was_unconfirmed=true) and
//     override (was_unconfirmed=false) — the audit payload disambiguates
//     them for downstream reporting. `price_unconfirmed` is set to false
//     unconditionally because the override path is harmless on already-
//     confirmed rows (the column is already false, the update is a no-op
//     for that field).
// ----------------------------------------------------------------------

export type SetLinePriceInput = {
  ticketId: string;
  lineId: string;
  unitPriceCents: number;
};

export async function setLinePrice(
  input: SetLinePriceInput
): Promise<{ subtotalCents: number; totalCents: number }> {
  assertUuid(input.ticketId, "setLinePrice.ticketId");
  assertUuid(input.lineId, "setLinePrice.lineId");

  // FR-006 server-side defense — zod catches this client-side too.
  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents <= 0) {
    throw new InvalidPriceError(
      `unitPriceCents must be a positive integer (got ${input.unitPriceCents})`
    );
  }

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`setLinePrice ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 2) Read the named line — capture previous price + unconfirmed flag
  //    for the audit payload, and confirm kind != 'discount'.
  const { data: lineRow, error: readErr } = await supabase
    .from("ticket_items")
    .select("id, ticket_id, kind, unit_price_cents, price_unconfirmed")
    .eq("id", input.lineId)
    .single();
  if (readErr || !lineRow) {
    throw new Error(`setLinePrice line read failed: ${readErr?.message ?? "not found"}`);
  }
  if (lineRow.ticket_id !== input.ticketId) {
    throw new Error(
      `setLinePrice: line ${input.lineId} does not belong to ticket ${input.ticketId}`
    );
  }
  if (lineRow.kind === "discount") {
    throw new InvalidPriceError("cannot price-override a discount row");
  }

  const previousUnitPriceCents = lineRow.unit_price_cents as number;
  const wasUnconfirmed = lineRow.price_unconfirmed as boolean;

  // 3) Update the row's price and clear the unconfirmed flag.
  const { error: updErr } = await supabase
    .from("ticket_items")
    .update({
      unit_price_cents: input.unitPriceCents,
      price_unconfirmed: false,
    })
    .eq("id", input.lineId);
  if (updErr) {
    throw new Error(`setLinePrice update failed: ${updErr.message}`);
  }

  // 4) Recompute totals (folds any percent-discount rows against the
  //    fresh service subtotal).
  const totals = await recomputeTicketTotals(supabase, input.ticketId);

  // 5) Audit.
  await recordAudit(
    "line.price_set",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      previous_unit_price_cents: previousUnitPriceCents,
      new_unit_price_cents: input.unitPriceCents,
      was_unconfirmed: wasUnconfirmed,
    },
    viewer.staff.id
  );

  return totals;
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
// 8. addDiscountLine — US3 / T027. Contract: `specs/013-cart-polish/contracts/
//    server-actions.md § 2`.
//
//    Validates session, the input shape, and refuses if the ticket is not
//    open. Per-shape body validation:
//      - shape='flat'    → value > 0 (positive integer cents)
//      - shape='percent' → 1 <= value <= 100 (whole percent)
//    Note must be ≤ 80 chars (caught by the input-shape validator).
//
//    Reads `discount.manager_threshold_cents` via getSetting<number|null>;
//    v1 ignores the return per FR-018 (phase-8 plugs in the manager-PIN
//    gate at this exact point).
//
//    The insert sets `unit_price_cents = -value` for flat and `0` for
//    percent — recomputeTicketTotals walks the rows after insert and
//    writes the correct percent amount back via a targeted UPDATE.
//
//    Emits `discount.added` audit with payload = { ticket_id, shape, value, note }.
// ----------------------------------------------------------------------

export type AddDiscountLineInput = {
  ticketId: string;
  shape: "flat" | "percent";
  value: number;
  note?: string;
};

export async function addDiscountLine(
  input: AddDiscountLineInput
): Promise<{ lineId: string; subtotalCents: number; totalCents: number }> {
  // 1) Input-shape validation. The contract documents a zod schema; we
  //    hand-roll the same guards (no zod dependency in this repo). The
  //    surfaces match the typed error contract in `_errors.ts`:
  //      - `flat_value_non_positive` (covers !int / NaN / ≤ 0)
  //      - `percent_out_of_range`    (covers !int / NaN / not in [1, 100])
  //      - `note_too_long`           (> 80 chars)
  assertUuid(input.ticketId, "addDiscountLine.ticketId");

  if (input.shape !== "flat" && input.shape !== "percent") {
    throw new DiscountInvalidError(
      `unknown discount shape: ${JSON.stringify(input.shape)}`,
      // Use the closest reason — an unknown shape is a programming bug, not
      // an operator-recoverable case; surface it as the flat non-positive
      // bucket so the UI's error branch matches its primary fallback.
      "flat_value_non_positive"
    );
  }

  if (input.shape === "flat") {
    if (!Number.isInteger(input.value) || input.value <= 0) {
      throw new DiscountInvalidError(
        `flat discount value must be a positive integer cents (got ${input.value})`,
        "flat_value_non_positive"
      );
    }
  } else {
    // shape === 'percent'
    if (!Number.isInteger(input.value) || input.value < 1 || input.value > 100) {
      throw new DiscountInvalidError(
        `percent discount value must be an integer in [1, 100] (got ${input.value})`,
        "percent_out_of_range"
      );
    }
  }

  if (input.note != null && input.note.length > 80) {
    throw new DiscountInvalidError(
      `discount note must be ≤ 80 characters (got ${input.note.length})`,
      "note_too_long"
    );
  }

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 2) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`addDiscountLine ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 3) Read the manager-threshold setting. The return is intentionally
  //    ignored in v1 per FR-018 — phase 8 plugs in the manager-PIN gate
  //    here. The read stays so the wire is in place.
  await getSetting<number | null>("discount.manager_threshold_cents");

  // 4) Insert the discount row. For percent shape, unit_price_cents starts
  //    at 0; recomputeTicketTotals computes and writes the negative amount
  //    against the live service subtotal.
  const insertValues = {
    ticket_id: input.ticketId,
    kind: "discount" as const,
    ref_id: null as string | null,
    assigned_staff_id: null as string | null,
    name_snapshot: discountNameSnapshot(input.shape, input.value),
    unit_price_cents: input.shape === "flat" ? -input.value : 0,
    qty: 1,
    discount_pct: input.shape === "percent" ? input.value : null,
    note: input.note ?? null,
  };

  const { data: lineRow, error: insErr } = await supabase
    .from("ticket_items")
    .insert(insertValues)
    .select("id")
    .single();
  if (insErr || !lineRow) {
    throw new Error(`addDiscountLine insert failed: ${insErr?.message ?? "no row returned"}`);
  }

  // 5) Recompute totals — for percent shape this writes the correct
  //    unit_price_cents back to the discount row.
  const totals = await recomputeTicketTotals(supabase, input.ticketId);

  // 6) Audit. entity_id = newLineId (NOT the ticket id).
  await recordAudit(
    "discount.added",
    viewer.deviceUserId,
    lineRow.id,
    {
      ticket_id: input.ticketId,
      shape: input.shape,
      value: input.value,
      note: input.note ?? null,
    },
    viewer.staff.id
  );

  return {
    lineId: lineRow.id,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
  };
}

// ----------------------------------------------------------------------
// 9. removeDiscountLine — US3 / T028. Contract: `specs/013-cart-polish/contracts/
//    server-actions.md § 3`.
//
//    Validates session, refuses if the ticket is not open, refuses if the
//    named line is not on this ticket (defensive Error), refuses if the
//    row's kind !== 'discount' (DiscountInvalidError).
//
//    Captures discount_pct + unit_price_cents + note BEFORE the delete so
//    the audit payload can reconstruct the original entry:
//      - shape = discount_pct != null ? 'percent' : 'flat'
//      - value = discount_pct ?? -unit_price_cents (back to positive)
// ----------------------------------------------------------------------

export type RemoveDiscountLineInput = {
  ticketId: string;
  lineId: string;
};

export async function removeDiscountLine(
  input: RemoveDiscountLineInput
): Promise<{ subtotalCents: number; totalCents: number }> {
  assertUuid(input.ticketId, "removeDiscountLine.ticketId");
  assertUuid(input.lineId, "removeDiscountLine.lineId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`removeDiscountLine ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 2) Read the named line — capture payload fields + confirm membership +
  //    confirm kind='discount'.
  const { data: lineRow, error: readErr } = await supabase
    .from("ticket_items")
    .select("id, ticket_id, kind, unit_price_cents, discount_pct, note")
    .eq("id", input.lineId)
    .single();
  if (readErr || !lineRow) {
    throw new Error(`removeDiscountLine line read failed: ${readErr?.message ?? "not found"}`);
  }
  if (lineRow.ticket_id !== input.ticketId) {
    throw new Error(
      `removeDiscountLine: line ${input.lineId} does not belong to ticket ${input.ticketId}`
    );
  }
  if (lineRow.kind !== "discount") {
    throw new DiscountInvalidError("not a discount line", "not_a_discount_line");
  }

  const capturedDiscountPct = lineRow.discount_pct as number | null;
  const capturedUnitPriceCents = lineRow.unit_price_cents as number;
  const capturedNote = (lineRow.note ?? null) as string | null;

  // 3) Delete the row.
  const { error: delErr } = await supabase.from("ticket_items").delete().eq("id", input.lineId);
  if (delErr) {
    throw new Error(`removeDiscountLine delete failed: ${delErr.message}`);
  }

  // 4) Recompute totals.
  const totals = await recomputeTicketTotals(supabase, input.ticketId);

  // 5) Audit. Reconstruct the original entry shape/value from the captured
  //    fields. discount_pct can be a `numeric(5,2)` so coerce to Number.
  const shape: "flat" | "percent" = capturedDiscountPct != null ? "percent" : "flat";
  const value: number =
    capturedDiscountPct != null ? Number(capturedDiscountPct) : -capturedUnitPriceCents;

  await recordAudit(
    "discount.removed",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      shape,
      value,
      note: capturedNote,
    },
    viewer.staff.id
  );

  return totals;
}

// ----------------------------------------------------------------------
// 10. emailBillStub — US4 / T036. Contract: `specs/013-cart-polish/contracts/
//     server-actions.md § 4`.
//
//     Stub action — DOES NOT dispatch real mail. The audit row is the only
//     persisted evidence the operator pressed Email. Validates the address
//     server-side (defense in depth — the client also runs the same regex
//     in `email-bill-dialog.tsx`). On invalid: throws
//     EmailAddressInvalidError, no audit row, no external call. On valid:
//     emits the `bill.emailed` audit row whose `payload.line_snapshot`
//     forwards the full client-captured bill snapshot verbatim (large by
//     design — the audit is the only evidence of what the operator was
//     looking at).
//
//     Validation is hand-rolled (no zod in this repo, consistent with
//     phase 5's deviations note). UUID via `assertUuid`; the structural
//     check on the snapshot is intentionally minimal — the audit stores
//     whatever the client sent, the test asserts forwarding.
// ----------------------------------------------------------------------

export type EmailBillStubSnapshotLine = {
  id: string;
  kind: "service" | "discount";
  name: string;
  unitPriceCents: number;
  qty: number;
  note: string | null;
  discountPct: number | null;
};

export type EmailBillStubSnapshot = {
  lines: EmailBillStubSnapshotLine[];
  serviceSubtotalCents: number;
  discountTotalCents: number;
  totalCents: number;
  capturedAt: string;
};

export type EmailBillStubInput = {
  ticketId: string;
  address: string;
  snapshot: EmailBillStubSnapshot;
};

export async function emailBillStub(input: EmailBillStubInput): Promise<{ ok: true }> {
  assertUuid(input.ticketId, "emailBillStub.ticketId");

  // Address validation — empty string fails the regex; the regex is the
  // single source of truth (the client mirrors it in email-bill-dialog.tsx).
  if (typeof input.address !== "string" || !EMAIL.test(input.address)) {
    throw new EmailAddressInvalidError(
      `email address is invalid (got ${JSON.stringify(input.address)})`
    );
  }

  const viewer = await requireStudioSession();

  // Audit row — `payload.line_snapshot` forwards the full snapshot verbatim
  // so the audit log preserves exactly what the operator saw when they
  // pressed Email. No external network call; no DB write to any other
  // table. The action does NOT verify the ticket exists — the audit row
  // stands as evidence regardless.
  await recordAudit(
    "bill.emailed",
    viewer.deviceUserId,
    input.ticketId,
    {
      address: input.address,
      line_snapshot: input.snapshot,
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
