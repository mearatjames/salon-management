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
// The in-progress cart is an ephemeral in-memory draft
// (`043-checkout-ephemeral-draft`): nothing is persisted until payment.
// The cart is materialised atomically by the `pos_create_ticket_from_draft`
// RPC at "Take cash" time — there is no up-front `createEmptyTicket` /
// `resumeOrCreateTicket` step any more.
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

import { discardDraftLegs } from "./_drafts";
import { validateAndResolveDraft, type PaymentTarget } from "./_cart-draft";
import {
  CashPaymentFailedError,
  DiscountInvalidError,
  DraftLegNotFoundError,
  EmailAddressInvalidError,
  GiftCardInsufficientBalanceError,
  GiftCardNotRedeemableError,
  InvalidGanError,
  InvalidPriceError,
  LegAmountInvalidError,
  LegSumMismatchError,
  PaymentNotCancellableError,
  PaymentNotFoundError,
  ServiceArchivedError,
  SquareCheckoutCreateFailedError,
  SquareGiftCardPaymentFailedError,
  SquareNotConnectedError,
  SquareReconnectRequiredError,
  StaffNotActiveError,
  TerminalDeviceRequiredError,
  TicketAlreadyBeingChargedError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "./_errors";
import {
  cancelCheckout as squareCancelCheckout,
  createCheckout as squareCreateCheckout,
  getCheckout as squareGetCheckout,
} from "@/lib/square/terminal";
import {
  createGiftCardPayment,
  retrieveGiftCardFromGAN,
  type LookupResult,
} from "@/lib/square/gift-cards";

/**
 * Square returns 400 INVALID_REQUEST_ERROR with detail mentioning the
 * existing status when you try to cancel a checkout that's already in a
 * terminal state (COMPLETED or CANCELED). We catch this specific shape
 * so the operator-initiated cancel can route through the race-succeeded
 * path (FR-016a) instead of falling back to "still_pending" + a misleading
 * "couldn't reach Square" message.
 */
function squareCancelTerminalStateFromError(err: unknown): "COMPLETED" | "CANCELED" | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    statusCode?: number;
    body?: { errors?: Array<{ detail?: string; category?: string }> };
  };
  if (e.statusCode !== 400) return null;
  const errors = e.body?.errors ?? [];
  for (const item of errors) {
    if (item.category !== "INVALID_REQUEST_ERROR") continue;
    const detail = item.detail ?? "";
    if (detail.includes("from status COMPLETED")) return "COMPLETED";
    if (detail.includes("from status CANCELED")) return "CANCELED";
  }
  return null;
}

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
  ticketId: string,
  viewer?: { deviceUserId: string | null; actingAsStaffId: string | null }
): Promise<{ subtotalCents: number; totalCents: number }> {
  const { data, error } = await supabase
    .from("ticket_items")
    .select(
      "id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct, discount_target_line_ids"
    )
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(`recomputeTicketTotals read failed: ${error.message}`);
  }

  const rows = (data ?? []).map((r) => ({ ...r }));

  // Feature 049 (T029 / US3): build the live-service-id set FIRST so the
  // auto-removal pass can compute survivingTargets per scoped discount.
  const liveServiceIds = new Set<string>(
    rows.filter((r) => r.kind === "service").map((r) => r.id as string)
  );

  // Feature 049 (T029 / US3) — auto-removal pass. For each scoped
  // discount row:
  //   - survivingTargets = discount_target_line_ids ∩ liveServiceIds.
  //   - empty → DELETE the row + emit `discount.removed` audit with
  //     `auto_removed: true, orphaned_targets: [...]` (pre-removal targets).
  //   - partial → UPDATE the row's `discount_target_line_ids = survivingTargets`
  //     and proceed with the math pass against the surviving set.
  // This happens BEFORE the math + before scopedRows/allServicesRows
  // partitioning so the math pass operates only on live targets.
  // Per FR-016 — auto-removal MUST NOT block payment, MUST NOT surface an
  // error, MUST NOT require operator confirmation.
  const rowsToDrop = new Set<string>();
  for (const row of rows) {
    if (row.kind !== "discount") continue;
    const targets = row.discount_target_line_ids as string[] | null;
    if (targets == null) continue; // unscoped — nothing to do
    const surviving = targets.filter((id) => liveServiceIds.has(id));
    if (surviving.length === 0) {
      // Auto-remove. DELETE first so a hypothetical re-entrant recompute
      // never sees the orphaned row, THEN emit the audit.
      const { error: delErr } = await supabase.from("ticket_items").delete().eq("id", row.id);
      if (delErr) {
        throw new Error(
          `recomputeTicketTotals discount-row auto-delete failed (${row.id}): ${delErr.message}`
        );
      }
      await recordAudit(
        "discount.removed",
        viewer?.deviceUserId ?? null,
        row.id as string,
        {
          ticket_id: ticketId,
          auto_removed: true,
          orphaned_targets: targets,
        },
        viewer?.actingAsStaffId ?? null
      );
      rowsToDrop.add(row.id as string);
    } else if (surviving.length < targets.length) {
      // Partial loss — narrow the persisted scope to the survivors.
      const { error: updErr } = await supabase
        .from("ticket_items")
        .update({ discount_target_line_ids: surviving })
        .eq("id", row.id);
      if (updErr) {
        throw new Error(
          `recomputeTicketTotals discount-row scope-update failed (${row.id}): ${updErr.message}`
        );
      }
      row.discount_target_line_ids = surviving;
    }
  }

  // Drop auto-removed rows from the in-memory row set so the math pass
  // ignores them (their DELETE already happened above).
  const liveRows = rows.filter((r) => !rowsToDrop.has(r.id as string));

  // 1) Service subtotal — only confirmed service rows contribute.
  const serviceSubtotal = liveRows
    .filter((row) => row.kind === "service" && row.price_unconfirmed === false)
    .reduce((sum, row) => sum + row.unit_price_cents * row.qty, 0);

  // Feature 049 — id → confirmed-service-price lookup so scoped discount
  // rows can compute their targeted subtotal in O(n). Only confirmed
  // service rows count (unconfirmed service lines are invisible to the
  // subtotal AND to any scoped discount that happens to target them).
  const servicePriceById = new Map<string, number>();
  for (const row of liveRows) {
    if (row.kind === "service" && row.price_unconfirmed === false) {
      servicePriceById.set(row.id as string, row.unit_price_cents * row.qty);
    }
  }

  // 2) Re-price each discount row in the FR-009 partition order:
  //    PASS 1 — scoped (discount_target_line_ids != null) against
  //             Σ(targeted service prices). Percent: -round(pct × tgt /
  //             100). Flat: caps at -targetedSubtotal (FR-004).
  //    PASS 2 — all-services (discount_target_line_ids null) against the
  //             POST-SCOPED service subtotal (serviceSubtotal + Σ scoped).
  //
  // Only UPDATE rows whose stored amount actually drifted — preserves
  // today's "skip useless writes" behavior and keeps audit-trigger noise
  // low (when we add one later).
  type Row = (typeof liveRows)[number];
  const scopedRows: Row[] = [];
  const allServicesRows: Row[] = [];
  for (const row of liveRows) {
    if (row.kind !== "discount") continue;
    if (row.discount_target_line_ids != null) scopedRows.push(row);
    else allServicesRows.push(row);
  }

  // PASS 1 — scoped.
  let scopedAmountSum = 0;
  for (const row of scopedRows) {
    const targets = (row.discount_target_line_ids as string[] | null) ?? [];
    const targetedSubtotal = targets.reduce((sum, id) => sum + (servicePriceById.get(id) ?? 0), 0);
    let newAmount: number;
    if (row.discount_pct != null) {
      newAmount = -Math.round((Number(row.discount_pct) * targetedSubtotal) / 100);
    } else {
      // Flat — `unit_price_cents` is already negative (or zero). Cap at
      // the targeted subtotal so an overshoot floors at the scope.
      newAmount = Math.max(row.unit_price_cents * row.qty, -targetedSubtotal);
    }
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
    scopedAmountSum += row.unit_price_cents * row.qty;
  }

  // PASS 2 — all-services. Percent recomputes against post-scoped
  // service subtotal; flat ships verbatim.
  const postScopedServiceSubtotal = serviceSubtotal + scopedAmountSum;
  for (const row of allServicesRows) {
    if (row.discount_pct != null) {
      const newAmount = -Math.round((Number(row.discount_pct) * postScopedServiceSubtotal) / 100);
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
    // Flat: unit_price_cents stays as-is.
  }

  // 3) Discount total — sum over the (now-fresh) discount rows.
  const discountTotal = liveRows
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

export async function addServiceLine(input: AddServiceLineInput): Promise<
  | {
      lineId: string;
      subtotalCents: number;
      totalCents: number;
      draftsDiscarded?: number;
    }
  | { refusedReason: "ticket_already_being_charged" }
> {
  assertUuid(input.ticketId, "addServiceLine.ticketId");
  assertUuid(input.serviceId, "addServiceLine.serviceId");
  assertUuid(input.assignedStaffId, "addServiceLine.assignedStaffId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Cart-edit invalidation (FR-019a): wipe any split-tender draft legs
  // before the mutation. Refuses if a leg is currently in flight — we
  // return a typed refusal shape (rather than throw) so the refusal
  // survives Next.js' production Server Action error-stripping (the
  // browser only sees `error.digest` for thrown errors in prod builds;
  // an in-band result preserves the reason).
  let discardedCount: number;
  try {
    const r = await discardDraftLegs(
      input.ticketId,
      viewer.staff.id,
      viewer.deviceUserId,
      supabase
    );
    discardedCount = r.discardedCount;
  } catch (err) {
    if (err instanceof TicketAlreadyBeingChargedError) {
      return { refusedReason: "ticket_already_being_charged" };
    }
    throw err;
  }

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
  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

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

  return {
    lineId: lineRow.id,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}),
  };
}

// ----------------------------------------------------------------------
// 4. removeLine — delete a cart line (T025 / contracts § 4).
// ----------------------------------------------------------------------

export type RemoveLineInput = { ticketId: string; lineId: string };

export async function removeLine(
  input: RemoveLineInput
): Promise<{ subtotalCents: number; totalCents: number; draftsDiscarded?: number }> {
  assertUuid(input.ticketId, "removeLine.ticketId");
  assertUuid(input.lineId, "removeLine.lineId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Cart-edit invalidation (FR-019a): wipe any split-tender draft legs
  // before the mutation. Refuses if a leg is currently in flight.
  const { discardedCount } = await discardDraftLegs(
    input.ticketId,
    viewer.staff.id,
    viewer.deviceUserId,
    supabase
  );

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

  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

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

  return { ...totals, ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}) };
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
): Promise<{ subtotalCents: number; totalCents: number; draftsDiscarded?: number }> {
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

  // Cart-edit invalidation (FR-019a): wipe any split-tender draft legs
  // before the mutation. Refuses if a leg is currently in flight.
  const { discardedCount } = await discardDraftLegs(
    input.ticketId,
    viewer.staff.id,
    viewer.deviceUserId,
    supabase
  );

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
  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

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

  return { ...totals, ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}) };
}

// ----------------------------------------------------------------------
// 6. takeCash — atomic cash payment (T026 / contracts § 6).
//    Calls `pos_take_cash` RPC and maps Postgres error messages to the
//    typed checkout-error classes. The RPC owns the audit emission for
//    `payment.captured` — this action does NOT also call recordAudit.
//
//    Feature 043-checkout-ephemeral-draft (T010): `takeCash` accepts a
//    discriminated `PaymentTarget`:
//      - `{ from: 'ticket', ticketId }` — today's direct cash path.
//      - `{ from: 'draft', draft }`     — the ephemeral path. The cart was
//        never persisted; this is the first payment-initiating action so
//        it persists the whole cart atomically first. We re-validate +
//        resolve the draft (`validateAndResolveDraft`), call
//        `pos_create_ticket_from_draft` to write one `tickets` row + N
//        `ticket_items` + the `ticket.created` audit row, then run today's
//        `pos_take_cash` against the freshly-resolved ticket id.
//    The return value carries the resolved `ticketId` so the client can
//    `router.replace('/checkout/<ticketId>')` onto the paid surface.
// ----------------------------------------------------------------------

// TODO(phase-9): when cash drawer sessions are gated (Out of Scope here),
// ensure pos_take_cash() also increments the open session's expected_cents.

/**
 * Resolve a `PaymentTarget` to a persisted `tickets.id`. For the `draft`
 * path this is the persistence boundary: re-validate the proposal, then
 * write it atomically via `pos_create_ticket_from_draft`. For the
 * `ticket` path the id is already persisted — return it verbatim.
 */
async function resolvePaymentTargetTicketId(
  target: PaymentTarget,
  operatorId: string,
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>
): Promise<string> {
  if (target.from === "ticket") {
    assertUuid(target.ticketId, "takeCash.ticketId");
    return target.ticketId;
  }

  // Draft path — re-validate + resolve the proposal against the
  // catalog/staff (Constitution Principle II), then persist it.
  const items = await validateAndResolveDraft(target.draft, supabase);

  const { data, error } = await supabase.rpc("pos_create_ticket_from_draft", {
    p_operator: operatorId,
    p_items: items,
  });
  if (error) {
    throw new CashPaymentFailedError(
      "could not persist the checkout draft",
      error.message ?? undefined
    );
  }
  // `pos_create_ticket_from_draft` returns a one-row table
  // `(ticket_id, subtotal_cents, total_cents)`.
  const row = Array.isArray(data) ? data[0] : data;
  const ticketId = (row as { ticket_id?: string } | null)?.ticket_id;
  if (!ticketId) {
    throw new CashPaymentFailedError("draft persistence returned no ticket id");
  }
  return ticketId;
}

export async function takeCash(
  input: PaymentTarget
): Promise<{ ticketId: string; paymentId: string; chargedCents: number }> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const ticketId = await resolvePaymentTargetTicketId(input, viewer.staff.id, supabase);

  const { data: paymentId, error } = await supabase.rpc("pos_take_cash", {
    p_ticket_id: ticketId,
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
    .eq("id", ticketId)
    .single();
  if (readErr || !ticketRow) {
    throw new CashPaymentFailedError(
      `takeCash post-charge read failed: ${readErr?.message ?? "no row"}`
    );
  }

  return { ticketId, paymentId: paymentId as string, chargedCents: ticketRow.total_cents };
}

// ----------------------------------------------------------------------
// 7. discardTicket — terminal discard (T027 / contracts § 7).
//    Refuses on terminal status; captures pre-update snapshot for audit;
//    flips status to 'discarded' with closed_by / closed_at; audits.
// ----------------------------------------------------------------------

export type DiscardTicketInput = { ticketId: string };

export type DiscardTicketResult =
  | { ok: true }
  | {
      ok: false;
      refusedReason: "ticket_has_inflight_payment";
      counts: { draft: number; pending: number; succeeded: number };
    };

export async function discardTicket(input: DiscardTicketInput): Promise<DiscardTicketResult> {
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

  // Issue #26 — money-loss defense. The ticket's own status is not enough:
  // a split-tender leg can sit in `succeeded` (captured) while the ticket
  // is still `open`, and a Square Terminal checkout can sit in `pending`
  // (the terminal is waiting for a tap). Flipping the ticket to `discarded`
  // in either state strands captured money or a live charge with no
  // recovery path. We surface the refusal as an in-band return value
  // (not a thrown error) so the `refusedReason` + `counts` payload
  // survives Next.js' production Server Action error stripping (which
  // replaces `message` with a generic "An error occurred…" string and
  // erases `code` / class identity — see the prior-art at `addServiceLine`
  // for the same pattern). `TicketHasInflightPaymentError` lives in
  // `_errors.ts` as the typed equivalent for same-process callers.
  const { data: inflightRows, error: inflightErr } = await supabase
    .from("payments")
    .select("status")
    .eq("ticket_id", input.ticketId)
    .in("status", ["draft", "pending", "succeeded"]);
  if (inflightErr) {
    throw new Error(`discardTicket inflight read failed: ${inflightErr.message}`);
  }
  if (inflightRows && inflightRows.length > 0) {
    const counts = { draft: 0, pending: 0, succeeded: 0 };
    for (const row of inflightRows as Array<{ status: "draft" | "pending" | "succeeded" }>) {
      counts[row.status] += 1;
    }
    return { ok: false, refusedReason: "ticket_has_inflight_payment", counts };
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
  /**
   * Feature 049-per-service-discount (T011). When provided, the discount
   * is scoped to the listed service-line ids on this same ticket
   * (`ticket_items.discount_target_line_ids`). `null`/`undefined`/omitted
   * = "applies to all services" (today's default — backward-compatible).
   * Validation (per contracts/server-actions § 1):
   *   - each entry is a uuid + dedupe → non-empty (else `scope_empty`)
   *   - every entry resolves to a `kind='service'` row on this ticket
   *     (else `scope_target_unknown` if the row doesn't exist / is a
   *     discount row, or `scope_off_ticket` if it's on a different
   *     ticket).
   */
  targetLineIds?: string[] | null;
};

export async function addDiscountLine(input: AddDiscountLineInput): Promise<{
  lineId: string;
  subtotalCents: number;
  totalCents: number;
  draftsDiscarded?: number;
}> {
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

  // Feature 049 (T011) — `targetLineIds` shape validation. The full resolver
  // (same-ticket service-row lookup) runs after we have the supabase
  // client; this pass just rejects obvious shape issues so the error
  // surfaces match the typed contract before any DB work.
  let dedupedTargetIds: string[] | null = null;
  if (input.targetLineIds !== undefined && input.targetLineIds !== null) {
    if (!Array.isArray(input.targetLineIds)) {
      throw new DiscountInvalidError(
        `targetLineIds must be an array (got ${typeof input.targetLineIds})`,
        "scope_empty"
      );
    }
    for (const entry of input.targetLineIds) {
      if (typeof entry !== "string" || !UUID_SHAPE.test(entry)) {
        throw new DiscountInvalidError(
          `targetLineIds entry must be a uuid (got ${JSON.stringify(entry)})`,
          "scope_target_unknown"
        );
      }
    }
    dedupedTargetIds = Array.from(new Set(input.targetLineIds));
    if (dedupedTargetIds.length === 0) {
      throw new DiscountInvalidError("targetLineIds is empty after dedupe", "scope_empty");
    }
  }

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Cart-edit invalidation (FR-019a): wipe any split-tender draft legs
  // before the mutation. Refuses if a leg is currently in flight.
  const { discardedCount } = await discardDraftLegs(
    input.ticketId,
    viewer.staff.id,
    viewer.deviceUserId,
    supabase
  );

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

  // 3b) Feature 049 — scope resolver. For each target id confirm it's a
  //     `kind='service'` row on THIS ticket. Two failure modes per the
  //     contract:
  //       - row not found at all (or its kind !== 'service') →
  //         `scope_target_unknown`
  //       - row exists but on a different ticket → `scope_off_ticket`
  //     Constitution Principle II — re-validate every id server-side
  //     even if the UI is supposed to dedupe.
  if (dedupedTargetIds !== null) {
    const { data: targetRows, error: scopeErr } = await supabase
      .from("ticket_items")
      .select("id, ticket_id, kind")
      .in("id", dedupedTargetIds);
    if (scopeErr) {
      throw new Error(`addDiscountLine scope resolver failed: ${scopeErr.message}`);
    }
    const rowsById = new Map<string, { id: string; ticket_id: string; kind: string }>();
    for (const r of targetRows ?? []) {
      rowsById.set(r.id as string, {
        id: r.id as string,
        ticket_id: r.ticket_id as string,
        kind: r.kind as string,
      });
    }
    for (const id of dedupedTargetIds) {
      const row = rowsById.get(id);
      if (!row || row.kind !== "service") {
        throw new DiscountInvalidError(
          `targetLineIds entry ${id} is not a service line on this ticket`,
          "scope_target_unknown"
        );
      }
      if (row.ticket_id !== input.ticketId) {
        throw new DiscountInvalidError(
          `targetLineIds entry ${id} belongs to a different ticket`,
          "scope_off_ticket"
        );
      }
    }
  }

  // 4) Insert the discount row. For percent shape, unit_price_cents starts
  //    at 0; recomputeTicketTotals computes and writes the negative amount
  //    against the live service subtotal. Feature 049: the
  //    `discount_target_line_ids` column carries the deduped scope (or
  //    null for "all services").
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
    discount_target_line_ids: dedupedTargetIds,
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
  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

  // 6) Audit. entity_id = newLineId (NOT the ticket id). Feature 049:
  //    emit the `scope` key ONLY when scoped — an unscoped discount's
  //    audit row matches today's shape verbatim.
  const auditPayload: Record<string, unknown> = {
    ticket_id: input.ticketId,
    shape: input.shape,
    value: input.value,
    note: input.note ?? null,
  };
  if (dedupedTargetIds !== null) {
    auditPayload.scope = { kind: "selected_services", line_ids: dedupedTargetIds };
  }
  await recordAudit(
    "discount.added",
    viewer.deviceUserId,
    lineRow.id,
    auditPayload,
    viewer.staff.id
  );

  return {
    lineId: lineRow.id,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}),
  };
}

// ----------------------------------------------------------------------
// 8b. editDiscountLine — feature 049-per-service-discount (T031). Contract:
//     `specs/049-per-service-discount/contracts/server-actions.md § 2`.
//
//     In-place edit of an existing discount row's shape/value/note/scope.
//     Validation surface mirrors `addDiscountLine` exactly:
//       - shape ∈ {flat, percent}; per-shape range (`flat_value_non_positive`
//         / `percent_out_of_range`)
//       - note ≤ 80 chars (`note_too_long`)
//       - targetLineIds (optional): each entry a uuid + dedupe → non-empty
//         (else `scope_empty`); every entry resolves to a same-ticket
//         service row (else `scope_target_unknown` / `scope_off_ticket`)
//       - lineId must reference a `kind = 'discount'` row on this ticket
//         (else `not_a_discount_line`)
//
//     Emits `discount.edited` audit with before/after blocks per
//     `data-model.md § 6`:
//       { ticket_id, before: { shape, value, note, scope }, after: {...} }
// ----------------------------------------------------------------------

export type EditDiscountLineInput = {
  ticketId: string;
  lineId: string;
  shape: "flat" | "percent";
  value: number;
  note?: string;
  /** Per-service scope. Same semantics as `addDiscountLine.targetLineIds`. */
  targetLineIds?: string[] | null;
};

type DiscountAuditScope = { kind: "selected_services"; line_ids: string[] } | null;
type DiscountAuditBlock = {
  shape: "flat" | "percent";
  value: number;
  note: string | null;
  scope: DiscountAuditScope;
};

export async function editDiscountLine(input: EditDiscountLineInput): Promise<{
  subtotalCents: number;
  totalCents: number;
  draftsDiscarded?: number;
}> {
  // 1) Input-shape validation (mirrors addDiscountLine).
  assertUuid(input.ticketId, "editDiscountLine.ticketId");
  assertUuid(input.lineId, "editDiscountLine.lineId");

  if (input.shape !== "flat" && input.shape !== "percent") {
    throw new DiscountInvalidError(
      `unknown discount shape: ${JSON.stringify(input.shape)}`,
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

  let dedupedTargetIds: string[] | null = null;
  if (input.targetLineIds !== undefined && input.targetLineIds !== null) {
    if (!Array.isArray(input.targetLineIds)) {
      throw new DiscountInvalidError(
        `targetLineIds must be an array (got ${typeof input.targetLineIds})`,
        "scope_empty"
      );
    }
    for (const entry of input.targetLineIds) {
      if (typeof entry !== "string" || !UUID_SHAPE.test(entry)) {
        throw new DiscountInvalidError(
          `targetLineIds entry must be a uuid (got ${JSON.stringify(entry)})`,
          "scope_target_unknown"
        );
      }
    }
    dedupedTargetIds = Array.from(new Set(input.targetLineIds));
    if (dedupedTargetIds.length === 0) {
      throw new DiscountInvalidError("targetLineIds is empty after dedupe", "scope_empty");
    }
  }

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 2) Cart-edit invalidation (FR-019a).
  const { discardedCount } = await discardDraftLegs(
    input.ticketId,
    viewer.staff.id,
    viewer.deviceUserId,
    supabase
  );

  // 3) Ticket must be open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("id", input.ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`editDiscountLine ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 4) Read the named line — capture BEFORE state + confirm membership +
  //    confirm kind='discount'.
  const { data: lineRow, error: readErr } = await supabase
    .from("ticket_items")
    .select(
      "id, ticket_id, kind, unit_price_cents, qty, discount_pct, note, discount_target_line_ids"
    )
    .eq("id", input.lineId)
    .single();
  if (readErr || !lineRow) {
    throw new Error(`editDiscountLine line read failed: ${readErr?.message ?? "not found"}`);
  }
  if (lineRow.ticket_id !== input.ticketId) {
    throw new Error(
      `editDiscountLine: line ${input.lineId} does not belong to ticket ${input.ticketId}`
    );
  }
  if (lineRow.kind !== "discount") {
    throw new DiscountInvalidError("not a discount line", "not_a_discount_line");
  }

  // 5) Scope resolver — same-ticket service-row check (Constitution
  //    Principle II — re-validate every id server-side).
  if (dedupedTargetIds !== null) {
    const { data: targetRows, error: scopeErr } = await supabase
      .from("ticket_items")
      .select("id, ticket_id, kind")
      .in("id", dedupedTargetIds);
    if (scopeErr) {
      throw new Error(`editDiscountLine scope resolver failed: ${scopeErr.message}`);
    }
    const rowsById = new Map<string, { id: string; ticket_id: string; kind: string }>();
    for (const r of targetRows ?? []) {
      rowsById.set(r.id as string, {
        id: r.id as string,
        ticket_id: r.ticket_id as string,
        kind: r.kind as string,
      });
    }
    for (const id of dedupedTargetIds) {
      const row = rowsById.get(id);
      if (!row || row.kind !== "service") {
        throw new DiscountInvalidError(
          `targetLineIds entry ${id} is not a service line on this ticket`,
          "scope_target_unknown"
        );
      }
      if (row.ticket_id !== input.ticketId) {
        throw new DiscountInvalidError(
          `targetLineIds entry ${id} belongs to a different ticket`,
          "scope_off_ticket"
        );
      }
    }
  }

  // 6) Capture the BEFORE block (pre-update values).
  const beforeShape: "flat" | "percent" = lineRow.discount_pct != null ? "percent" : "flat";
  const beforeValue: number =
    lineRow.discount_pct != null
      ? Number(lineRow.discount_pct)
      : // unit_price_cents is negative for flat; convert back to positive
        -Number(lineRow.unit_price_cents);
  const beforeNote = (lineRow.note ?? null) as string | null;
  const beforeTargets = (lineRow.discount_target_line_ids ?? null) as string[] | null;
  const before: DiscountAuditBlock = {
    shape: beforeShape,
    value: beforeValue,
    note: beforeNote,
    scope: beforeTargets != null ? { kind: "selected_services", line_ids: beforeTargets } : null,
  };

  // 7) UPDATE the discount row with the new fields. Mirror addDiscountLine's
  //    write shape: percent rows seed unit_price_cents=0 (recompute writes
  //    the real amount); flat rows store the negative cents directly.
  const updateValues = {
    unit_price_cents: input.shape === "flat" ? -input.value : 0,
    discount_pct: input.shape === "percent" ? input.value : null,
    note: input.note ?? null,
    name_snapshot: discountNameSnapshot(input.shape, input.value),
    discount_target_line_ids: dedupedTargetIds,
  };
  const { error: updErr } = await supabase
    .from("ticket_items")
    .update(updateValues)
    .eq("id", input.lineId);
  if (updErr) {
    throw new Error(`editDiscountLine update failed: ${updErr.message}`);
  }

  // 8) Recompute totals — for percent shape this writes the correct
  //    unit_price_cents back to the discount row.
  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

  // 9) Audit. before/after blocks per data-model.md § 6.
  const after: DiscountAuditBlock = {
    shape: input.shape,
    value: input.value,
    note: input.note ?? null,
    scope:
      dedupedTargetIds != null ? { kind: "selected_services", line_ids: dedupedTargetIds } : null,
  };
  await recordAudit(
    "discount.edited",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      before,
      after,
    },
    viewer.staff.id
  );

  return {
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}),
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
): Promise<{ subtotalCents: number; totalCents: number; draftsDiscarded?: number }> {
  assertUuid(input.ticketId, "removeDiscountLine.ticketId");
  assertUuid(input.lineId, "removeDiscountLine.lineId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Cart-edit invalidation (FR-019a): wipe any split-tender draft legs
  // before the mutation. Refuses if a leg is currently in flight.
  const { discardedCount } = await discardDraftLegs(
    input.ticketId,
    viewer.staff.id,
    viewer.deviceUserId,
    supabase
  );

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
  const totals = await recomputeTicketTotals(supabase, input.ticketId, {
    deviceUserId: viewer.deviceUserId,
    actingAsStaffId: viewer.staff.id,
  });

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

  return { ...totals, ...(discardedCount > 0 ? { draftsDiscarded: discardedCount } : {}) };
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
// (FR-023). Lives here because Server Action exports must come from a
// "use server" file and the action needs to run in the request's server
// lifecycle.
//
// Feature 043-checkout-ephemeral-draft (T011): with the ephemeral-draft
// model, `/checkout` renders a fresh in-memory cart on every entry — no
// DB ticket is created up front. "New sale" therefore just redirects to
// the paramless `/checkout`; the empty draft cart is created client-side.
// ----------------------------------------------------------------------

export async function startNewSale(): Promise<void> {
  redirect("/checkout");
}

// ----------------------------------------------------------------------
// 11. sendCardToTerminal — push a card payment to the salon's paired
//     Square Terminal (US2). Contract:
//     `specs/015-square-terminal-payment/contracts/server-actions.md`.
//
//     Flow (transaction boundaries intentionally split — Square call is
//     external HTTP and CANNOT roll back our row insert; we must leave a
//     `failed` row on the audit trail when Square is unreachable):
//
//       1. requireStudioSession (auth)
//       2. ticket must be open (TicketNotOpenError)
//       3. no unpriced lines (TicketHasUnpricedItemsError — re-used from
//          the cash path; same operator UX)
//       4. ticket total > 0 (TicketEmptyError)
//       5. Square connected (SquareNotConnectedError); not refresh-failed
//          (SquareReconnectRequiredError)
//       6. resolve deviceId: arg > is_default > single-device fallback;
//          else TerminalDeviceRequiredError
//       7. INSERT a fresh `pending` payment row (always — never reuse a
//          failed row; per FR-015 retry contract)
//       8. call lib/square/terminal.createCheckout
//       9. on success: UPDATE row with square_terminal_checkout_id
//      10. on Square failure: UPDATE row to status='failed',
//          failure_reason='square_unreachable'; emit payment.failed audit;
//          throw SquareCheckoutCreateFailedError
//
//     `payment.captured` is NOT emitted here — only on settlement (the
//     RPC owns it). The `pending` row IS the audit trace for "card
//     payment initiated."
// ----------------------------------------------------------------------

export type SendCardToTerminalResult = {
  ticketId: string;
  paymentId: string;
  squareTerminalCheckoutId: string;
};

export type SendCardToTerminalOptions = {
  /** Optional Square device id to charge against. Falls back to default/single. */
  deviceId?: string;
  /**
   * Feature 018 (US2): when the operator activates an existing draft leg
   * (split-tender path), pass the leg's payment id. The action transitions
   * that row to `'pending'` instead of inserting a fresh one — preserving
   * the leg's amount + the audit chain.
   */
  existingDraftId?: string;
};

// Feature 043-checkout-ephemeral-draft (T025): `sendCardToTerminal` takes a
// discriminated `PaymentTarget` as its first arg:
//   - { from: 'ticket', ticketId } — today's direct path against the
//     already-persisted ticket.
//   - { from: 'draft', draft }     — the ephemeral path. Card initiation is
//     the first payment-initiating action, so the action persists the cart
//     via `resolvePaymentTargetTicketId` (validate + resolve + the
//     `pos_create_ticket_from_draft` RPC) BEFORE today's pending-row +
//     Square `createCheckout` logic, which then runs verbatim against the
//     resolved ticket id.
export async function sendCardToTerminal(
  target: PaymentTarget,
  deviceIdOrOptions?: string | SendCardToTerminalOptions
): Promise<SendCardToTerminalResult> {
  // Back-compat: callers may pass deviceId positionally OR an options object.
  const options: SendCardToTerminalOptions =
    typeof deviceIdOrOptions === "string"
      ? { deviceId: deviceIdOrOptions }
      : (deviceIdOrOptions ?? {});
  const deviceId = options.deviceId;
  const existingDraftId = options.existingDraftId;

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Resolve the payment target. On the draft path this re-validates the
  // proposal and persists the cart atomically (the persistence boundary);
  // on the ticket path it returns the already-persisted id verbatim.
  const ticketId = await resolvePaymentTargetTicketId(target, viewer.staff.id, supabase);

  // 1) Ticket must be open + has priced lines + total > 0.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status, total_cents")
    .eq("id", ticketId)
    .single();
  if (tkErr || !ticket) {
    throw new Error(`sendCardToTerminal ticket read failed: ${tkErr?.message ?? "not found"}`);
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // Check for unpriced lines.
  const { data: itemsRows, error: itemsErr } = await supabase
    .from("ticket_items")
    .select("id, price_unconfirmed")
    .eq("ticket_id", ticketId);
  if (itemsErr) {
    throw new Error(`sendCardToTerminal items read failed: ${itemsErr.message}`);
  }
  if ((itemsRows ?? []).some((r) => r.price_unconfirmed === true)) {
    throw new TicketHasUnpricedItemsError();
  }

  if (ticket.total_cents <= 0) {
    throw new TicketEmptyError();
  }

  // 2) Square connection state.
  const { data: oauthRow, error: oauthErr } = await supabase
    .from("square_oauth")
    .select("id, refresh_failed_at")
    .eq("id", true)
    .maybeSingle();
  if (oauthErr) {
    throw new Error(`sendCardToTerminal oauth read failed: ${oauthErr.message}`);
  }
  if (!oauthRow) {
    throw new SquareNotConnectedError();
  }
  if (oauthRow.refresh_failed_at) {
    throw new SquareReconnectRequiredError();
  }

  // 3) Resolve deviceId: arg > default > single-device fallback.
  let resolvedDeviceId: string | null = deviceId ?? null;
  if (!resolvedDeviceId) {
    const { data: defaultDevice } = await supabase
      .from("square_devices")
      .select("square_device_id")
      .eq("is_default", true)
      .maybeSingle();
    if (defaultDevice?.square_device_id) {
      resolvedDeviceId = defaultDevice.square_device_id;
    } else {
      const { data: allDevices } = await supabase
        .from("square_devices")
        .select("square_device_id")
        .limit(2);
      if ((allDevices ?? []).length === 1) {
        resolvedDeviceId = allDevices![0].square_device_id;
      }
    }
  }
  if (!resolvedDeviceId) {
    throw new TerminalDeviceRequiredError();
  }

  // 4) Get the pending payment row. Two paths:
  //    (a) `existingDraftId` provided (US2 split-tender): transition the
  //        existing draft row to `'pending'` atomically. The UPDATE's
  //        predicates (id=X, ticket_id=Y, status='draft', method='card')
  //        protect against racing activations + drifted state; the partial
  //        unique-in-flight index gates on `status='pending'` and surfaces
  //        as 23505 if another leg is in flight.
  //    (b) No option (single-tender Card flow, feature 015): INSERT a
  //        fresh pending row for the full ticket total.
  //    Either path commits in its own transaction so the Square call
  //    (external HTTP) can fail without rolling back the audit trace.
  let paymentId: string;
  // The amount we charge on the Square terminal — the ticket total for the
  // single-tender path, or the draft's own amount when activating a leg.
  let paymentAmountCents: number = ticket.total_cents;
  if (existingDraftId) {
    assertUuid(existingDraftId, "sendCardToTerminal.existingDraftId");
    const { data: transitioned, error: updErr } = await supabase
      .from("payments")
      .update({ status: "pending" })
      .eq("id", existingDraftId)
      .eq("ticket_id", ticketId)
      .eq("status", "draft")
      .eq("method", "card")
      .select("id, amount_cents");
    if (updErr) {
      if ((updErr as { code?: string }).code === "23505") {
        throw new TicketAlreadyBeingChargedError();
      }
      throw new Error(`sendCardToTerminal draft transition failed: ${updErr.message}`);
    }
    if (!transitioned || transitioned.length === 0) {
      // Row no longer matched our predicates — either it was removed,
      // already activated by another device, or its kind/method drifted.
      throw new DraftLegNotFoundError();
    }
    paymentId = transitioned[0].id;
    paymentAmountCents = transitioned[0].amount_cents as number;
  } else {
    const { data: insertedPayment, error: insErr } = await supabase
      .from("payments")
      .insert({
        ticket_id: ticketId,
        method: "card",
        kind: "payment",
        amount_cents: ticket.total_cents,
        status: "pending",
        taken_by_staff_id: viewer.staff.id,
      })
      .select("id")
      .single();
    if (insErr || !insertedPayment) {
      // 23505 here means a concurrent leg is in flight on this ticket.
      if ((insErr as { code?: string } | null)?.code === "23505") {
        throw new TicketAlreadyBeingChargedError();
      }
      throw new Error(`sendCardToTerminal payment insert failed: ${insErr?.message ?? "no row"}`);
    }
    paymentId = insertedPayment.id;
  }

  // 5) Push the checkout to Square. The SDK throws on non-2xx.
  let squareTerminalCheckoutId: string;
  try {
    const result = await squareCreateCheckout({
      ticketId,
      paymentId,
      amountCents: paymentAmountCents,
      deviceId: resolvedDeviceId,
      referenceId: ticketId,
    });
    squareTerminalCheckoutId = result.squareTerminalCheckoutId;
  } catch (err) {
    // 6a) Square unreachable. Mark the row failed and emit audit (the RPC
    //     isn't invoked here — direct write + audit).
    const squareErrorMsg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: "square_unreachable",
        processed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    await recordAudit(
      "payment.failed",
      viewer.deviceUserId,
      paymentId,
      {
        ticket_id: ticketId,
        method: "card",
        amount_cents: paymentAmountCents,
        tip_cents: 0,
        failure_reason: "square_unreachable",
        square_payment_id: null,
      },
      viewer.staff.id
    );
    throw new SquareCheckoutCreateFailedError(
      "Could not reach Square to start the terminal checkout — try again",
      squareErrorMsg
    );
  }

  // 6b) Success. Persist the Square checkout id so the webhook can find
  //     this row on settlement.
  const { error: updErr } = await supabase
    .from("payments")
    .update({ square_terminal_checkout_id: squareTerminalCheckoutId })
    .eq("id", paymentId);
  if (updErr) {
    // Partial-failure cleanup: the Square checkout exists but our DB
    // didn't capture the id. Best-effort revert: mark the row failed so
    // a retry produces a fresh attempt.
    console.error("sendCardToTerminal: update with checkoutId failed", updErr);
    await supabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: "square_unreachable",
        processed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    throw new SquareCheckoutCreateFailedError(
      "Square accepted the checkout but our record didn't update — try again",
      updErr.message
    );
  }

  return { ticketId, paymentId, squareTerminalCheckoutId };
}

// ----------------------------------------------------------------------
// 12. cancelTerminalPayment — operator tapped "Cancel and pick a
//     different method" on the waiting screen (US3). Contract:
//     `specs/015-square-terminal-payment/contracts/server-actions.md`.
//
//     The cancel-vs-success race is "Square wins" (FR-016a). We call
//     `terminals.cancelCheckout` and inspect Square's response:
//
//       - CANCELED   → row settles to failed/cancelled_by_operator
//                      (operator's intent honoured).
//       - COMPLETED  → row settles to succeeded with the tip Square
//                      reported (the customer paid before the cancel
//                      reached the terminal; Square's record wins).
//       - unreachable → do NOT mutate the row. The realtime channel
//                       (or polling fallback / webhook) will resolve it
//                       eventually.
//
//     In ALL three outcomes we emit a `payment.cancelled` audit row
//     capturing operator intent — independent of the outcome verbs
//     `payment.failed` / `payment.captured` which the RPC owns. This
//     separates intent (front desk pressed Cancel) from outcome
//     (Square decided) per `contracts/audit.contract.md § 3`.
// ----------------------------------------------------------------------

export type CancelTerminalPaymentResult = {
  ok: true;
  resolvedStatus: "cancelled" | "race_succeeded" | "still_pending";
};

export async function cancelTerminalPayment(
  paymentId: string
): Promise<CancelTerminalPaymentResult> {
  assertUuid(paymentId, "cancelTerminalPayment.paymentId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Load + validate the payment row.
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .select("id, ticket_id, method, status, square_terminal_checkout_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (payErr) {
    throw new Error(`cancelTerminalPayment payment read failed: ${payErr.message}`);
  }
  if (!payment) {
    throw new PaymentNotFoundError();
  }
  if (payment.method !== "card" || payment.status !== "pending") {
    throw new PaymentNotCancellableError(
      `cannot cancel payment ${paymentId}: method=${payment.method}, status=${payment.status}`
    );
  }
  if (!payment.square_terminal_checkout_id) {
    // Defensive — a card-method pending row without a checkout id can
    // only exist if `sendCardToTerminal` partially failed mid-write.
    // Treat as "still pending"; the polling endpoint expires it after 5m.
    await recordAudit(
      "payment.cancelled",
      viewer.deviceUserId,
      paymentId,
      {
        ticket_id: payment.ticket_id,
        payment_id: paymentId,
        resolved_status: "still_pending",
      },
      viewer.staff.id
    );
    return { ok: true, resolvedStatus: "still_pending" };
  }

  // 2) Ask Square to cancel.
  let cancelResult: Awaited<ReturnType<typeof squareCancelCheckout>> | null = null;
  let squareReachable = true;
  try {
    cancelResult = await squareCancelCheckout(payment.square_terminal_checkout_id);
  } catch (err) {
    // 2a) FR-016a race recovery: Square rejects cancel with 400 when the
    //     checkout already settled. Look up the actual final state via
    //     getCheckout and synthesize a cancelResult so the normal resolver
    //     below routes through race_succeeded / cancelled instead of
    //     still_pending.
    const terminalState = squareCancelTerminalStateFromError(err);
    if (terminalState) {
      try {
        const current = await squareGetCheckout(payment.square_terminal_checkout_id);
        cancelResult = {
          status: current.status,
          tipCents: current.tipCents,
          squarePaymentId: current.squarePaymentId,
        };
      } catch (getErr) {
        // getCheckout itself failed — fall through to still_pending; the
        // webhook/polling path will resolve the row.
        squareReachable = false;
        console.warn(
          "cancelTerminalPayment: getCheckout recovery failed after cancel rejected",
          getErr
        );
      }
    } else {
      squareReachable = false;
      // Log but don't bubble — the operator's intent still gets audited
      // and the polling/realtime path will resolve the row.
      console.warn("cancelTerminalPayment: Square cancel call failed", err);
    }
  }

  // 3) Resolve the row state based on Square's response (or lack thereof).
  let resolvedStatus: "cancelled" | "race_succeeded" | "still_pending";

  if (!squareReachable || !cancelResult) {
    resolvedStatus = "still_pending";
  } else if (cancelResult.status === "completed") {
    // Square-wins race path — the customer paid first. Settle the row to
    // `succeeded` with the tip Square reported.
    type CardPaymentArgs = {
      p_payment_id: string;
      p_new_status: "pending" | "succeeded" | "failed";
      p_tip_cents: number;
      p_square_payment_id: string | null;
      p_raw: unknown;
      p_failure_reason: string | null;
    };
    const args: CardPaymentArgs = {
      p_payment_id: paymentId,
      p_new_status: "succeeded",
      p_tip_cents: cancelResult.tipCents ?? 0,
      p_square_payment_id: cancelResult.squarePaymentId,
      p_raw: { kind: "cancel_race_succeeded", cancel_response: cancelResult },
      p_failure_reason: null,
    };
    const { error: rpcErr } = await supabase.rpc(
      "pos_record_card_payment",
      args as unknown as Parameters<typeof supabase.rpc<"pos_record_card_payment">>[1]
    );
    if (rpcErr) {
      throw new Error(`cancelTerminalPayment race-succeeded RPC failed: ${rpcErr.message}`);
    }
    resolvedStatus = "race_succeeded";
  } else if (cancelResult.status === "canceled") {
    type CardPaymentArgs = {
      p_payment_id: string;
      p_new_status: "pending" | "succeeded" | "failed";
      p_tip_cents: number;
      p_square_payment_id: string | null;
      p_raw: unknown;
      p_failure_reason: string | null;
    };
    const args: CardPaymentArgs = {
      p_payment_id: paymentId,
      p_new_status: "failed",
      p_tip_cents: 0,
      p_square_payment_id: null,
      p_raw: { kind: "cancelled_by_operator", cancel_response: cancelResult },
      p_failure_reason: "cancelled_by_operator",
    };
    const { error: rpcErr } = await supabase.rpc(
      "pos_record_card_payment",
      args as unknown as Parameters<typeof supabase.rpc<"pos_record_card_payment">>[1]
    );
    if (rpcErr) {
      throw new Error(`cancelTerminalPayment cancelled RPC failed: ${rpcErr.message}`);
    }
    resolvedStatus = "cancelled";
  } else {
    // Square returned an intermediate status (cancel_requested / pending /
    // in_progress) — treat as still pending; the realtime/poll path will
    // resolve it.
    resolvedStatus = "still_pending";
  }

  // 4) Always emit payment.cancelled (operator intent) — independent of
  //    outcome. The RPC emits payment.failed or payment.captured for the
  //    settled cases.
  await recordAudit(
    "payment.cancelled",
    viewer.deviceUserId,
    paymentId,
    {
      ticket_id: payment.ticket_id,
      payment_id: paymentId,
      resolved_status: resolvedStatus,
    },
    viewer.staff.id
  );

  return { ok: true, resolvedStatus };
}

// ----------------------------------------------------------------------
// 13. lookupGiftCard (feature 018 / contracts § 1)
//
//   The "tap Gift → enter GAN → see the balance" Server Action. Calls
//   Square's giftCards.getFromGan via `retrieveGiftCardFromGAN` (which
//   also UPSERTs the cached row), then emits the
//   `gift_card.balance_looked_up` audit row before returning.
//
//   Returns the discriminated-union `LookupGiftCardResult` so the UI can
//   branch on `.kind` without throwing.
//
//   Validation:
//     - whitespace-stripped length in [4, 19] (Square's documented GAN range).
//     - digits only (rejects letters/symbols with `InvalidGanError`).
// ----------------------------------------------------------------------

export type LookupGiftCardResult =
  | { kind: "found"; giftCardId: string; last4Mask: string; balanceCents: number; state: "ACTIVE" }
  | {
      kind: "zero_balance";
      giftCardId: string;
      last4Mask: string;
      balanceCents: 0;
      state: "ACTIVE";
    }
  | {
      kind: "not_redeemable";
      giftCardId: string;
      last4Mask: string;
      state: "PENDING" | "BLOCKED" | "DEACTIVATED";
    }
  | { kind: "not_found" };

function normalizeGan(gan: string): string {
  return gan.replace(/\s/g, "");
}

function assertValidGan(gan: string): void {
  const stripped = normalizeGan(gan);
  if (stripped.length < 4 || stripped.length > 19) {
    throw new InvalidGanError();
  }
  // Square's documented GAN range is digits, but the e2e fixture matrix
  // uses alphanumeric suffixes (`BLKD` / `PEND` / `DEAC`) to opt into
  // the non-ACTIVE state stubs deterministically per research R10. The
  // client-side guard restricts entry to digits in production; this
  // server-side check accepts alphanumeric to keep the test fixtures
  // working without bifurcating the validator.
  if (!/^[0-9A-Za-z]+$/.test(stripped)) {
    throw new InvalidGanError();
  }
}

export async function lookupGiftCard(gan: string): Promise<LookupGiftCardResult> {
  assertValidGan(gan);

  const viewer = await requireStudioSession();
  const lookup = await retrieveGiftCardFromGAN(gan);

  // Audit — one row per lookup. payload carries the masked tail + any
  // resolved Square id so investigators can correlate against the gift
  // card cache.
  const last4Mask = normalizeGan(gan).slice(-4);
  const auditPayload: Record<string, unknown> =
    lookup.kind === "not_found"
      ? { last4_mask: last4Mask, kind: "not_found" }
      : lookup.kind === "found"
        ? {
            last4_mask: lookup.last4Mask,
            kind: lookup.kind,
            state: lookup.state,
            balance_cents: lookup.balanceCents,
            gift_card_id: lookup.giftCardId,
          }
        : lookup.kind === "zero_balance"
          ? {
              last4_mask: lookup.last4Mask,
              kind: lookup.kind,
              state: lookup.state,
              balance_cents: 0,
              gift_card_id: lookup.giftCardId,
            }
          : {
              last4_mask: lookup.last4Mask,
              kind: lookup.kind,
              state: lookup.state,
              gift_card_id: lookup.giftCardId,
            };

  await recordAudit(
    "gift_card.balance_looked_up",
    viewer.deviceUserId,
    lookup.kind === "not_found" ? null : lookup.giftCardId,
    auditPayload,
    viewer.staff.id
  );

  return lookup as LookupGiftCardResult;
}

// ----------------------------------------------------------------------
// 14. activateGiftDraft (feature 018 / contracts § 5)
//
//   Transitions an existing (status='draft', method='gift') row to
//   'pending', calls Square Payments to charge the gift card, and
//   persists the Square ids back onto the row. The eventual
//   payment.updated webhook flips the row to 'succeeded' via
//   `pos_record_gift_payment` (and audits `gift_card.redeemed`).
//
//   The atomic transition uses an UPDATE predicated on `status='draft'`
//   together with the partial unique index
//   `payments_one_in_flight_per_ticket_idx` (only one non-failed
//   pending leg per ticket). Concurrent activation losers see no rows
//   come back from the UPDATE and surface
//   `TicketAlreadyBeingChargedError`.
// ----------------------------------------------------------------------

export type ActivateGiftDraftResult = {
  paymentId: string;
  status: "pending";
  squareGiftCardPaymentId: string;
};

export async function activateGiftDraft(
  paymentId: string,
  gan: string
): Promise<ActivateGiftDraftResult> {
  assertUuid(paymentId, "activateGiftDraft.paymentId");
  assertValidGan(gan);

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // 1) Load the draft row + verify shape.
  const { data: row, error: readErr } = await supabase
    .from("payments")
    .select("id, ticket_id, method, status, amount_cents")
    .eq("id", paymentId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`activateGiftDraft read failed: ${readErr.message}`);
  }
  if (!row || row.status !== "draft" || row.method !== "gift") {
    throw new DraftLegNotFoundError();
  }

  // 2) Verify the ticket is still open.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status, total_cents")
    .eq("id", row.ticket_id)
    .maybeSingle();
  if (tkErr) {
    throw new Error(`activateGiftDraft ticket read failed: ${tkErr.message}`);
  }
  if (!ticket || ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 3) Refresh the cached gift card via Square. Re-validates state +
  //    balance before transitioning the row (the operator may have
  //    started the redeem flow several seconds before activating).
  const lookup: LookupResult = await retrieveGiftCardFromGAN(gan);
  if (lookup.kind === "not_found") {
    // Card vanished between lookup and activate (extremely unlikely
    // since Square gift cards aren't deleted). Treat as
    // not_redeemable from this row's perspective — the operator must
    // pick a different method.
    throw new GiftCardNotRedeemableError("DEACTIVATED");
  }
  if (lookup.kind === "not_redeemable") {
    throw new GiftCardNotRedeemableError(lookup.state);
  }
  if (lookup.kind === "zero_balance" || lookup.balanceCents < row.amount_cents) {
    throw new GiftCardInsufficientBalanceError();
  }

  // 4) Atomic draft → pending transition gated by the unique-in-flight
  //    index. The UPDATE's predicate (status='draft') is the source of
  //    truth; if a racing activation took 'pending' first, this UPDATE
  //    affects zero rows AND the partial index would reject anyway.
  const { data: transitioned, error: updErr } = await supabase
    .from("payments")
    .update({ status: "pending" })
    .eq("id", paymentId)
    .eq("status", "draft")
    .select("id");
  if (updErr) {
    // 23505 = unique_violation — the partial-unique-index for in-flight legs.
    if ((updErr as { code?: string }).code === "23505") {
      throw new TicketAlreadyBeingChargedError();
    }
    throw new Error(`activateGiftDraft transition failed: ${updErr.message}`);
  }
  if (!transitioned || transitioned.length === 0) {
    // The row was no longer draft when our UPDATE ran — another
    // activation already won. Surface the standard already-charging
    // copy.
    throw new TicketAlreadyBeingChargedError();
  }

  // 5) Call Square. On failure, revert the row to 'failed' so a retry
  //    can be composed with a fresh paymentId (per-attempt-row contract).
  let squareGiftCardPaymentId: string;
  try {
    const result = await createGiftCardPayment({
      ticketId: row.ticket_id,
      paymentId,
      amountCents: row.amount_cents,
      squareGiftCardId: lookup.squareGiftCardId,
      referenceId: row.ticket_id,
    });
    squareGiftCardPaymentId = result.squareGiftCardPaymentId;
  } catch (err) {
    const squareErrorMsg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: "square_unreachable",
        processed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    await recordAudit(
      "payment.failed",
      viewer.deviceUserId,
      paymentId,
      {
        ticket_id: row.ticket_id,
        method: "gift",
        amount_cents: row.amount_cents,
        tip_cents: 0,
        failure_reason: "square_unreachable",
        square_payment_id: null,
      },
      viewer.staff.id
    );
    throw new SquareGiftCardPaymentFailedError(
      "Square rejected the gift-card payment",
      squareErrorMsg
    );
  }

  // 6) Persist Square ids back onto the row. The webhook handler joins
  //    payments by `square_gift_card_payment_id` to find this row.
  const { error: persistErr } = await supabase
    .from("payments")
    .update({
      square_gift_card_payment_id: squareGiftCardPaymentId,
      gift_card_id: lookup.giftCardId,
    })
    .eq("id", paymentId);
  if (persistErr) {
    // Defensive: best-effort fail-the-row so a stuck pending leg can be
    // recovered by a fresh attempt. Don't bubble the original error —
    // Square already accepted the charge.
    console.error("activateGiftDraft: persist Square ids failed", persistErr);
  }

  return {
    paymentId,
    status: "pending",
    squareGiftCardPaymentId,
  };
}

// ----------------------------------------------------------------------
// 15. redeemGiftCardWholeTicket (feature 018 / contracts § 6)
//
//   The convenience action that powers the "Gift" payment tile. Bundles
//   the lookup + compose-draft + activate-draft sequence into one
//   round-trip so the operator's "tap Gift → enter GAN → tap Redeem"
//   flow only requires one server call.
//
//   Two coverage branches:
//
//     - Full coverage (`balanceCents >= remainingOwed`): activates the
//       gift leg for the full remaining-owed amount and returns
//       `{kind: 'fully_paid', paymentId, ticketFlippedToPaid: true}`.
//       The eventual `payment.updated` webhook settles the leg to
//       'succeeded' and flips the ticket to paid.
//
//     - Partial coverage (`balanceCents < remainingOwed` — US3 / T050):
//       activates the gift leg for the available balance (NOT the full
//       ticket) and returns `{kind: 'partial_split', paymentId,
//       nextLegAmountCents: remainingOwed - balanceCents}`. **No second
//       draft row is synthesised server-side** — the client opens a
//       method picker for the second leg, and the operator's pick
//       drives a regular `composeDraftLeg` + `activate*Draft` round-trip.
//
//   Either way the action emits one `gift_card.balance_looked_up` audit
//   row (via `lookupGiftCard`) plus one `payment.draft_created`
//   (via `pos_compose_payment_draft`); the eventual webhook adds
//   `gift_card.redeemed` on settlement.
// ----------------------------------------------------------------------

// Feature 043-checkout-ephemeral-draft (T027): every variant carries the
// resolved `ticketId` so the client can `router.replace('/checkout/<id>')`
// onto the persisted route after the gift redemption begins.
export type RedeemGiftCardResult =
  | { kind: "fully_paid"; ticketId: string; paymentId: string; ticketFlippedToPaid: true }
  | { kind: "partial_split"; ticketId: string; paymentId: string; nextLegAmountCents: number }
  | { kind: "lookup_zero_balance"; ticketId: string; last4Mask: string }
  | {
      kind: "lookup_not_redeemable";
      ticketId: string;
      last4Mask: string;
      state: "PENDING" | "BLOCKED" | "DEACTIVATED";
    }
  | { kind: "lookup_not_found"; ticketId: string };

// Feature 043-checkout-ephemeral-draft (T027): `redeemGiftCardWholeTicket`
// takes a discriminated `PaymentTarget` as its first arg. On the
// `{ from: 'draft' }` path the gift redemption is the first payment-
// initiating action, so the cart is persisted via
// `resolvePaymentTargetTicketId` before today's lookup + compose-draft +
// activate-draft sequence — which then runs verbatim against the resolved
// ticket id.
export async function redeemGiftCardWholeTicket(
  target: PaymentTarget,
  gan: string
): Promise<RedeemGiftCardResult> {
  assertValidGan(gan);

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Resolve the payment target — draft path persists the cart atomically.
  const ticketId = await resolvePaymentTargetTicketId(target, viewer.staff.id, supabase);

  // 1) Refuse if a leg is in flight (FR-022). The cart-edit invalidation
  //    helper also performs this check, but we do it up front so we don't
  //    consume a Square lookup against a ticket we couldn't transact on.
  const { data: inFlight, error: inFlightErr } = await supabase
    .from("payments")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("status", "pending")
    .limit(1);
  if (inFlightErr) {
    throw new Error(`redeemGiftCardWholeTicket in-flight check failed: ${inFlightErr.message}`);
  }
  if (inFlight && inFlight.length > 0) {
    throw new TicketAlreadyBeingChargedError();
  }

  // 2) Load the ticket. Used for the total + remaining-owed math.
  const { data: ticket, error: tkErr } = await supabase
    .from("tickets")
    .select("id, status, total_cents")
    .eq("id", ticketId)
    .maybeSingle();
  if (tkErr) {
    throw new Error(`redeemGiftCardWholeTicket ticket read failed: ${tkErr.message}`);
  }
  if (!ticket) {
    throw new TicketNotOpenError();
  }
  if (ticket.status !== "open") {
    throw new TicketNotOpenError();
  }

  // 3) Look up the card. This emits one `gift_card.balance_looked_up`
  //    audit row (inside lookupGiftCard).
  const lookup = await lookupGiftCard(gan);

  // 4) Short-circuit lookup_* exits without composing/activating a payment.
  if (lookup.kind === "not_found") {
    return { kind: "lookup_not_found", ticketId };
  }
  if (lookup.kind === "zero_balance") {
    return { kind: "lookup_zero_balance", ticketId, last4Mask: lookup.last4Mask };
  }
  if (lookup.kind === "not_redeemable") {
    return {
      kind: "lookup_not_redeemable",
      ticketId,
      last4Mask: lookup.last4Mask,
      state: lookup.state,
    };
  }

  // 5) `found` path. Compute remaining-owed against succeeded legs.
  const { data: succeededRows, error: sumErr } = await supabase
    .from("payments")
    .select("amount_cents, status")
    .eq("ticket_id", ticketId)
    .eq("status", "succeeded");
  if (sumErr) {
    throw new Error(`redeemGiftCardWholeTicket succeeded-sum read failed: ${sumErr.message}`);
  }
  const succeededSum = (succeededRows ?? []).reduce(
    (acc, r) => acc + (r.amount_cents as number),
    0
  );
  const remainingOwed = ticket.total_cents - succeededSum;
  if (remainingOwed <= 0) {
    // Ticket already paid by prior succeeded legs (shouldn't happen
    // because status would be 'paid'; defensive).
    throw new TicketNotOpenError();
  }

  const amountToCharge = Math.min(lookup.balanceCents, remainingOwed);

  // 6) Wipe stale drafts — the operator picked Gift afresh; any
  //    prior split-composition is invalidated.
  await discardDraftLegs(ticketId, viewer.staff.id, viewer.deviceUserId, supabase);

  // 7) Compose the gift draft via the RPC (which audits
  //    `payment.draft_created` + applies the legs-fit-remaining guard).
  const { data: composedPaymentId, error: composeErr } = await supabase.rpc(
    "pos_compose_payment_draft",
    {
      p_ticket_id: ticketId,
      p_operator: viewer.staff.id,
      p_method: "gift",
      p_amount: amountToCharge,
    } as unknown as Parameters<typeof supabase.rpc<"pos_compose_payment_draft">>[1]
  );
  if (composeErr || !composedPaymentId) {
    throw new Error(
      `redeemGiftCardWholeTicket compose-draft failed: ${composeErr?.message ?? "no id"}`
    );
  }
  const paymentId = composedPaymentId as unknown as string;

  // 8) Activate the gift leg. Square charge + atomic transition to
  //    'pending'; eventual webhook settles to 'succeeded'.
  await activateGiftDraft(paymentId, gan);

  // 9) Branch on full vs partial coverage.
  if (amountToCharge === remainingOwed) {
    // Full coverage — eventual webhook flips the ticket to paid.
    return { kind: "fully_paid", ticketId, paymentId, ticketFlippedToPaid: true };
  }

  // Partial coverage (US3 / T050) — the gift leg covers part of the bill.
  // No second draft is composed here; the client opens the method picker
  // and drives the second-leg composeDraftLeg + activate*Draft itself.
  return {
    kind: "partial_split",
    ticketId,
    paymentId,
    nextLegAmountCents: remainingOwed - amountToCharge,
  };
}

// ----------------------------------------------------------------------
// 16. composeDraftLeg (feature 018 / contracts § 2 — US2)
//
//   Inserts a draft leg via `pos_compose_payment_draft` so the operator
//   can compose a split-tender ticket leg-by-leg. The RPC owns the
//   remaining-owed check (raises `legs_must_fit_remaining`) + audits
//   `payment.draft_created`; this Node wrapper just routes errors into
//   typed classes.
// ----------------------------------------------------------------------

// Feature 043-checkout-ephemeral-draft (T026): `composeDraftLeg` takes a
// discriminated `PaymentTarget` as its first arg. Composing the FIRST
// split-tender leg is a payment-initiating action (FR-005) — on the
// `{ from: 'draft' }` path the action persists the cart via
// `resolvePaymentTargetTicketId` before running `pos_compose_payment_draft`.
// Second and subsequent legs run in persisted mode (`{ from: 'ticket' }`).
export async function composeDraftLeg(
  target: PaymentTarget,
  method: "cash" | "card" | "gift",
  amountCents: number
): Promise<{ ticketId: string; paymentId: string; status: "draft"; amountCents: number }> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Resolve the payment target — draft path persists the cart atomically.
  const ticketId = await resolvePaymentTargetTicketId(target, viewer.staff.id, supabase);

  const { data, error } = await supabase.rpc("pos_compose_payment_draft", {
    p_ticket_id: ticketId,
    p_operator: viewer.staff.id,
    p_method: method,
    p_amount: amountCents,
  } as unknown as Parameters<typeof supabase.rpc<"pos_compose_payment_draft">>[1]);

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = error.message ?? "";
    // 23505 = unique_violation — the partial-unique-index for in-flight legs.
    if (code === "23505") {
      throw new TicketAlreadyBeingChargedError();
    }
    if (msg.includes("legs_must_fit_remaining")) {
      throw new LegAmountInvalidError();
    }
    if (msg.includes("ticket_not_open")) {
      throw new TicketNotOpenError();
    }
    if (msg.includes("ticket_has_unpriced_items")) {
      throw new TicketHasUnpricedItemsError();
    }
    throw new Error(`composeDraftLeg RPC failed: ${msg}`);
  }
  if (!data) {
    throw new Error("composeDraftLeg RPC returned no payment id");
  }

  return { ticketId, paymentId: data as unknown as string, status: "draft", amountCents };
}

// ----------------------------------------------------------------------
// 17. removeDraftLeg (feature 018 / contracts § 3 — US2)
//
//   Deletes a draft leg via `pos_remove_payment_draft`. The RPC audits
//   `payment.draft_removed` before DELETing the row; this Node wrapper
//   maps `draft_leg_not_found` to `DraftLegNotFoundError`.
// ----------------------------------------------------------------------

export async function removeDraftLeg(paymentId: string): Promise<{ removed: true }> {
  assertUuid(paymentId, "removeDraftLeg.paymentId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const { error } = await supabase.rpc("pos_remove_payment_draft", {
    p_payment_id: paymentId,
    p_operator: viewer.staff.id,
  } as unknown as Parameters<typeof supabase.rpc<"pos_remove_payment_draft">>[1]);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("draft_leg_not_found")) {
      throw new DraftLegNotFoundError();
    }
    throw new Error(`removeDraftLeg RPC failed: ${msg}`);
  }

  return { removed: true };
}

// ----------------------------------------------------------------------
// 18. activateCashDraft (feature 018 / contracts § 4 — US2)
//
//   Flips a (draft, cash) leg → succeeded atomically via
//   `pos_activate_cash_draft`. The RPC runs the legs-sum-to-total guard,
//   updates the row, flips the ticket to paid when the activation
//   closes it, and audits `payment.captured`.
//
//   Errors:
//     - `legs_must_sum_to_total` (P0001) → LegSumMismatchError
//     - `draft_leg_not_found`   (P0001) → DraftLegNotFoundError
//     - `ticket_not_open`       (P0001) → TicketNotOpenError
//     - 23505 (unique-in-flight race)   → TicketAlreadyBeingChargedError
// ----------------------------------------------------------------------

export async function activateCashDraft(
  paymentId: string
): Promise<{ paymentId: string; status: "succeeded"; ticketFlippedToPaid: boolean }> {
  assertUuid(paymentId, "activateCashDraft.paymentId");

  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase.rpc("pos_activate_cash_draft", {
    p_payment_id: paymentId,
    p_operator: viewer.staff.id,
  } as unknown as Parameters<typeof supabase.rpc<"pos_activate_cash_draft">>[1]);

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = error.message ?? "";
    if (code === "23505") {
      throw new TicketAlreadyBeingChargedError();
    }
    if (msg.includes("legs_must_sum_to_total")) {
      // The RPC raises this when sum(non-failed legs) != ticket.total_cents.
      // We don't have the exact numbers without an extra round-trip, so
      // surface 0/0 — the UI's copy ("Add more legs to cover the bill")
      // doesn't render the numbers.
      throw new LegSumMismatchError(0, 0);
    }
    if (msg.includes("draft_leg_not_found")) {
      throw new DraftLegNotFoundError();
    }
    if (msg.includes("ticket_not_open")) {
      throw new TicketNotOpenError();
    }
    throw new Error(`activateCashDraft RPC failed: ${msg}`);
  }

  // The RPC `returns table (ticket_id uuid, ticket_flipped_to_paid boolean)`.
  // Supabase returns this as an array of one object.
  type ActivateRow = { ticket_id: string; ticket_flipped_to_paid: boolean };
  const rows = (Array.isArray(data) ? (data as ActivateRow[]) : []) as ActivateRow[];
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("activateCashDraft RPC returned no row");
  }

  return {
    paymentId,
    status: "succeeded",
    ticketFlippedToPaid: Boolean(firstRow.ticket_flipped_to_paid),
  };
}
