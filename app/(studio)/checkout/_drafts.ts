// app/(studio)/checkout/_drafts.ts
//
// Cart-edit invalidation helper for split-tender drafts (feature 018).
//
// `discardDraftLegs` is called as the first post-prelude step of every
// line-mutation Server Action (`addServiceLine`, `removeLine`,
// `setLinePrice`, `addDiscountLine`, `removeDiscountLine`). It enforces
// FR-019a: when the operator edits the cart while one or more draft legs
// exist, the drafts are wiped (and audited) before the line mutation
// proceeds — preventing a stale leg from being activated against a
// changed total.
//
// Refusal contract: if ANY leg on the ticket is currently `status='pending'`
// (a charge is in flight on another device or this device — `card.create`
// has been called and we're awaiting the webhook), this helper throws
// `TicketAlreadyBeingChargedError`. The caller surfaces the spec's "ticket
// is already being charged on another device" copy.
//
// Audit: one `payment.draft_removed` row per discarded leg, with payload
// `{ ticket_id, method, amount_cents, reason: 'cart_edit_invalidated' }`.
// See `contracts/audit.contract.md § 3.b`.

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "@/lib/auth/audit";
import type { Database } from "@/lib/db/types";

import { TicketAlreadyBeingChargedError } from "./_errors";

export async function discardDraftLegs(
  ticketId: string,
  operatorStaffId: string,
  deviceUserId: string | null,
  supabase: SupabaseClient<Database>
): Promise<{ discardedCount: number }> {
  // 1) Refuse if any leg is in-flight (FR-019a) — a pending charge cannot
  //    be invalidated by a cart edit; the operator must wait for it to
  //    settle (or fail) before mutating the cart.
  const { data: inFlight, error: inFlightErr } = await supabase
    .from("payments")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("status", "pending")
    .limit(1);
  if (inFlightErr) {
    throw new Error(`discardDraftLegs in-flight check failed: ${inFlightErr.message}`);
  }
  if (inFlight && inFlight.length > 0) {
    throw new TicketAlreadyBeingChargedError();
  }

  // 2) Read drafts so we can audit each before deleting.
  const { data: drafts, error: draftsErr } = await supabase
    .from("payments")
    .select("id, method, amount_cents")
    .eq("ticket_id", ticketId)
    .eq("status", "draft");
  if (draftsErr) {
    throw new Error(`discardDraftLegs drafts read failed: ${draftsErr.message}`);
  }

  const rows = drafts ?? [];
  if (rows.length === 0) {
    return { discardedCount: 0 };
  }

  // 3) Audit each draft before delete (preserves entity_id traceability).
  for (const d of rows) {
    await recordAudit(
      "payment.draft_removed",
      deviceUserId,
      d.id,
      {
        ticket_id: ticketId,
        method: d.method,
        amount_cents: d.amount_cents,
        reason: "cart_edit_invalidated",
      },
      operatorStaffId
    );
  }

  // 4) Delete all drafts for this ticket in one statement.
  const { error: delErr } = await supabase
    .from("payments")
    .delete()
    .eq("ticket_id", ticketId)
    .eq("status", "draft");
  if (delErr) {
    throw new Error(`discardDraftLegs delete failed: ${delErr.message}`);
  }

  return { discardedCount: rows.length };
}
