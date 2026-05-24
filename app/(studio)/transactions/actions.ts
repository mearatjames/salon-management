"use server";

// Server Actions for the Transactions page (`/transactions`).
//
// Contract: `specs/050-reassign-paid-line-tech/contracts/server-actions.md`.
//
// Currently exports one action:
//   - `reassignPaidLineTech` — corrects the assigned technician on a single
//     service line of a paid ticket, within the line's still-open pay period.
//
// The action is server-authoritative (Constitution Principle II): the four
// gates (role, paid, finalized-period, active-staff) all live here; the
// drawer's absence-of-affordance is defense in depth (FR-014).
//
// Exactly one `ticket.line_tech_reassigned` audit row is written per
// successful, non-no-op reassignment (Principle III, FR-010). Zero rows on
// any rejection or no-op (FR-012, FR-013).
//
// Typed error classes live in `./_errors` because Next.js' `"use server"`
// constraint forbids any non-async export from this file (mirrors the
// checkout module's split).

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getSalonTimezone } from "@/lib/db/settings";
import { isPayPeriodFinalized, payPeriodForClosedAt } from "@/lib/payroll/finalized";

import {
  PayPeriodFinalizedError,
  PermissionDeniedError,
  StaffNotActiveError,
  TicketNotPaidError,
  TicketOrLineNotFoundError,
} from "./_errors";

// Loose UUID shape check — mirrors the checkout module's `assertUuid`.
// The DB FKs are the real guard; this just drops obviously bogus payloads
// before a round-trip.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_SHAPE.test(value)) {
    throw new Error(`${label}: expected uuid, got ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// reassignPaidLineTech — corrects the assigned technician on a single
// service line of a paid ticket. See contracts/server-actions.md §"Order
// of checks" for the exact step ordering — this implementation matches
// that contract verbatim.
// ---------------------------------------------------------------------------

export type ReassignPaidLineTechInput = {
  ticketId: string;
  lineId: string;
  newAssignedStaffId: string;
};

export type ReassignPaidLineTechResult = { ok: true };

export async function reassignPaidLineTech(
  input: ReassignPaidLineTechInput
): Promise<ReassignPaidLineTechResult> {
  // 1. Parse input.
  assertUuid(input.ticketId, "reassignPaidLineTech.ticketId");
  assertUuid(input.lineId, "reassignPaidLineTech.lineId");
  assertUuid(input.newAssignedStaffId, "reassignPaidLineTech.newAssignedStaffId");

  // 2. Auth.
  const viewer = await requireStudioSession();

  // 3. Role gate (FR-003, FR-012 (a), FR-014).
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    throw new PermissionDeniedError();
  }

  // 4. Service-role Supabase client.
  const supabase = createSupabaseServiceRoleClient();

  // 5. Load the ticket.
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, status, closed_at")
    .eq("id", input.ticketId)
    .single();
  if (!ticket) {
    throw new TicketOrLineNotFoundError();
  }

  // 6. Paid-state gate (FR-012 (b)).
  if (ticket.status !== "paid") {
    throw new TicketNotPaidError();
  }
  if (!ticket.closed_at) {
    // Defensive: a paid ticket must have `closed_at` per migration 0004
    // CHECK constraint. If somehow null, treat as not-found.
    throw new TicketOrLineNotFoundError();
  }

  // 7. Resolve the pay period containing the ticket's `closed_at`.
  const tz = await getSalonTimezone(supabase);
  const periodRef = payPeriodForClosedAt(tz, ticket.closed_at);

  // 8. Finalized-period gate (FR-002, FR-004, FR-012 (c)).
  if (await isPayPeriodFinalized(supabase, periodRef)) {
    throw new PayPeriodFinalizedError();
  }

  // 9. Active-staff gate (FR-005 race, FR-012 (d)).
  const { data: staff } = await supabase
    .from("staff")
    .select("id, active")
    .eq("id", input.newAssignedStaffId)
    .maybeSingle();
  if (!staff || staff.active !== true) {
    throw new StaffNotActiveError();
  }

  // 10. Load the line. Refuse if it doesn't belong to the named ticket
  //     (FR-012 (e)).
  const { data: lineRow } = await supabase
    .from("ticket_items")
    .select("id, ticket_id, assigned_staff_id")
    .eq("id", input.lineId)
    .maybeSingle();
  if (!lineRow || lineRow.ticket_id !== input.ticketId) {
    throw new TicketOrLineNotFoundError();
  }

  const previousStaffId = (lineRow.assigned_staff_id as string | null) ?? null;

  // 11. No-op short-circuit (FR-013): if the line is already assigned to
  //     the requested tech, write nothing and return success.
  if (previousStaffId === input.newAssignedStaffId) {
    return { ok: true };
  }

  // 12. Single-column UPDATE — only `assigned_staff_id` (SC-006, FR-007).
  const { error: updErr } = await supabase
    .from("ticket_items")
    .update({ assigned_staff_id: input.newAssignedStaffId })
    .eq("id", input.lineId);
  if (updErr) {
    throw new Error(`reassignPaidLineTech update failed: ${updErr.message}`);
  }

  // 13. Exactly one audit row (FR-010, FR-011). Payload shape mirrors
  //     data-model.md § "Payload shape".
  await recordAudit(
    "ticket.line_tech_reassigned",
    viewer.deviceUserId,
    input.lineId,
    {
      ticket_id: input.ticketId,
      previous_staff_id: previousStaffId,
      new_staff_id: input.newAssignedStaffId,
      closed_at: ticket.closed_at,
      pay_period_start: periodRef.startsOn,
    },
    viewer.staff.id
  );

  // 14. Revalidate every page that displays this attribution.
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/report");
  revalidatePath("/payroll");

  return { ok: true };
}
