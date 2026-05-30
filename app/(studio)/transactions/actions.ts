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
// Feature 052 (US2) — refund a past sale. The refund-specific typed errors
// live in the checkout `_errors` module (re-exported there alongside the
// shared `PermissionDeniedError`); the void path uses the same set.
import {
  PaymentNotOnTicketError,
  RefundExceedsRemainingError,
  SquareRefundFailedError,
} from "@/app/(studio)/checkout/_errors";
import { buildRefundIdempotencyKey } from "@/lib/square/terminal";
import { refundCardPayment } from "@/lib/square/refunds";
import { formatTxId } from "@/lib/transactions/format";

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

// ---------------------------------------------------------------------------
// getRefundableTicket — feature 052 (US2). Loads a paid ticket's succeeded
// ORIGINAL payments plus each one's already-refunded total, so the refund
// composition sheet can render a per-payment input bounded by the live
// remaining (original − Σ succeeded refunds). Owner/manager only — it backs
// the refund affordance shared by the dashboard feed, the receipt drawer, and
// the End-of-Day cash list. Read-only; no audit, no revalidate.
// ---------------------------------------------------------------------------

export type RefundablePayment = {
  id: string;
  method: "cash" | "card" | "gift";
  amountCents: number;
  remainingCents: number;
};

export type RefundableTicket = {
  ticketId: string;
  displayId: string;
  payments: readonly RefundablePayment[];
};

export async function getRefundableTicket(ticketId: string): Promise<RefundableTicket> {
  assertUuid(ticketId, "getRefundableTicket.ticketId");

  const viewer = await requireStudioSession();
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    throw new PermissionDeniedError();
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) {
    throw new TicketOrLineNotFoundError();
  }

  // All payment rows on the ticket — originals + any refund legs. The
  // remaining for each original = its amount − Σ its succeeded refunds.
  const { data: rows, error } = await supabase
    .from("payments")
    .select("id, method, kind, status, amount_cents, refunds_payment_id")
    .eq("ticket_id", ticketId);
  if (error) {
    throw new Error(`getRefundableTicket payments read failed: ${error.message}`);
  }

  const refundedByOriginal = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r.kind === "refund" && r.status === "succeeded" && r.refunds_payment_id) {
      refundedByOriginal.set(
        r.refunds_payment_id,
        (refundedByOriginal.get(r.refunds_payment_id) ?? 0) + r.amount_cents
      );
    }
  }

  const payments: RefundablePayment[] = (rows ?? [])
    .filter((r) => r.kind === "payment" && r.status === "succeeded")
    .map((r) => {
      const method =
        r.method === "card" || r.method === "cash" || r.method === "gift" ? r.method : "cash";
      const refunded = refundedByOriginal.get(r.id) ?? 0;
      return {
        id: r.id as string,
        method,
        amountCents: r.amount_cents as number,
        remainingCents: (r.amount_cents as number) - refunded,
      };
    });

  return {
    ticketId,
    displayId: formatTxId(ticketId),
    payments,
  };
}

// ---------------------------------------------------------------------------
// refundTicket — feature 052 (US2). Contract:
// `specs/052-privileged-action-overrides/contracts/server-actions.contract.md`.
//
// Partial or full reversal of one or more of a paid ticket's payments.
// Owner/manager only. Two-phase Square settlement (research D4), mirroring
// `voidSale`:
//   1. `pos_refund_payments` (service-role) locks the ticket + its payments,
//      asserts each line's `amountCents ≤ remaining` (else
//      `refund_exceeds_remaining`) and that the original belongs to the
//      ticket + is `kind='payment' status='succeeded'` (else
//      `payment_not_on_ticket`), then inserts a kind='refund' row per line
//      (cash→succeeded, card/gift→pending) and returns them.
//   2. For each card/gift leg, fire `refundCardPayment(...)`. On ANY throw we
//      mark the still-pending refund legs `failed`, abort, and throw
//      `SquareRefundFailedError` — the ticket is untouched (no status change),
//      fully recoverable.
//   3. `pos_finalize_refund` flips the card/gift legs → succeeded +
//      square_refund_id, recomputes status (`refunded` iff Σ succeeded refunds
//      == Σ succeeded payments else `partially_refunded`), sets closed_* on
//      the first reversal, and writes the single `payment.refund_issued`
//      audit row.
// ---------------------------------------------------------------------------

export type RefundTicketInput = {
  ticketId: string;
  lines: Array<{ originalPaymentId: string; amountCents: number }>;
};

export type RefundTicketResult = {
  ticketId: string;
  status: "partially_refunded" | "refunded";
  refundedCents: number;
};

type RefundRow = {
  refund_payment_id: string;
  original_payment_id: string;
  method: "cash" | "card" | "gift";
  square_payment_id: string | null;
  amount_cents: number;
};

export async function refundTicket(input: RefundTicketInput): Promise<RefundTicketResult> {
  // 1) Parse input.
  assertUuid(input.ticketId, "refundTicket.ticketId");

  // 2) Validate `lines` non-empty, each amountCents a positive integer, and
  //    each originalPaymentId a uuid. (Zod-equivalent hand-rolled guards —
  //    no zod dependency in this module; the server is the backstop for the
  //    sheet's client-side validation.)
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new RefundExceedsRemainingError("a refund needs at least one line");
  }
  for (const line of input.lines) {
    assertUuid(line.originalPaymentId, "refundTicket.lines[].originalPaymentId");
    if (!Number.isInteger(line.amountCents) || line.amountCents <= 0) {
      throw new RefundExceedsRemainingError(
        `each refund line amount must be a positive integer cents (got ${line.amountCents})`
      );
    }
  }

  // 3) Auth + owner/manager gate (defense in depth above the surfaces'
  //    affordance-absence for technicians).
  const viewer = await requireStudioSession();
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    throw new PermissionDeniedError();
  }

  const supabase = createSupabaseServiceRoleClient();

  // 4) Prepare phase — create the mirror refund rows under lock. Maps the
  //    RPC's raised conditions to typed errors.
  const { data: prepData, error: prepErr } = await supabase.rpc("pos_refund_payments", {
    p_ticket_id: input.ticketId,
    p_operator: viewer.staff.id,
    p_lines: input.lines.map((l) => ({
      originalPaymentId: l.originalPaymentId,
      amountCents: l.amountCents,
    })),
  } as unknown as Parameters<typeof supabase.rpc<"pos_refund_payments">>[1]);
  if (prepErr) {
    const msg = prepErr.message ?? "";
    if (msg.includes("refund_exceeds_remaining")) {
      throw new RefundExceedsRemainingError();
    }
    if (msg.includes("payment_not_on_ticket")) {
      throw new PaymentNotOnTicketError();
    }
    throw new Error(`refundTicket prepare RPC failed: ${msg}`);
  }

  const refundRows = (Array.isArray(prepData) ? prepData : []) as RefundRow[];
  const refundedCents = refundRows.reduce((sum, r) => sum + r.amount_cents, 0);

  // 5) Card/gift legs need a Square refund; cash legs are already settled.
  const squareLegs = refundRows.filter((r) => r.method === "card" || r.method === "gift");
  const refundResults: Array<{
    refund_payment_id: string;
    square_refund_id: string | null;
    original_payment_id: string;
    method: "cash" | "card" | "gift";
    amount_cents: number;
  }> = [];

  if (squareLegs.length > 0) {
    // 6) Fire the Square refunds. On ANY throw → mark every pending refund
    //    leg `failed`, abort, surface SquareRefundFailedError. No status
    //    change — the ticket is recoverable (SC-007).
    try {
      for (const leg of squareLegs) {
        if (!leg.square_payment_id) {
          throw new SquareRefundFailedError(
            "a card/gift leg is missing its Square payment reference"
          );
        }
        const { squareRefundId } = await refundCardPayment({
          squarePaymentId: leg.square_payment_id,
          amountCents: leg.amount_cents,
          idempotencyKey: buildRefundIdempotencyKey(leg.original_payment_id, leg.refund_payment_id),
        });
        refundResults.push({
          refund_payment_id: leg.refund_payment_id,
          square_refund_id: squareRefundId,
          original_payment_id: leg.original_payment_id,
          method: leg.method,
          amount_cents: leg.amount_cents,
        });
      }
    } catch (err) {
      await supabase
        .from("payments")
        .update({ status: "failed" })
        .in(
          "id",
          squareLegs.map((r) => r.refund_payment_id)
        )
        .eq("status", "pending");
      if (err instanceof SquareRefundFailedError) throw err;
      throw new SquareRefundFailedError(
        "Square couldn't process the refund. The sale is unchanged.",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // 7) Cash legs settle immediately — include them in the finalize payload
  //    (square_refund_id null) so the audit row's `lines[]` mirrors every
  //    reversed leg, not just the Square ones.
  for (const leg of refundRows) {
    if (leg.method === "cash") {
      refundResults.push({
        refund_payment_id: leg.refund_payment_id,
        square_refund_id: null,
        original_payment_id: leg.original_payment_id,
        method: leg.method,
        amount_cents: leg.amount_cents,
      });
    }
  }

  // 8) Finalize — flip card/gift legs → succeeded + square_refund_id,
  //    recompute status, set closed_* on first reversal, write the audit row.
  const { error: finErr } = await supabase.rpc("pos_finalize_refund", {
    p_ticket_id: input.ticketId,
    p_refund_results: refundResults,
  } as unknown as Parameters<typeof supabase.rpc<"pos_finalize_refund">>[1]);
  if (finErr) {
    throw new Error(`refundTicket finalize RPC failed: ${finErr.message}`);
  }

  // 9) Read back the recomputed status (the RPC is the source of truth).
  const { data: ticketRow, error: readErr } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", input.ticketId)
    .single();
  if (readErr || !ticketRow) {
    throw new Error(`refundTicket post-finalize read failed: ${readErr?.message ?? "no row"}`);
  }
  const status = ticketRow.status === "refunded" ? "refunded" : "partially_refunded";

  // 10) Revalidate every surface that renders this ticket's status.
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/end-of-day");

  return { ticketId: input.ticketId, status, refundedCents };
}
