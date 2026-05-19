// Direct DB-side construction of an open ticket + items (and optionally a
// paid ticket + cash payment row). Used by e2e specs that exercise mid-
// build or post-commit affordances (Bill, Discount, Discard, Price-
// override, Tech-override, Variable-price, card-payment, gift-card flows)
// on top of an already-existing ticket.
//
// Background — feature 042-ephemeral-cart removed the eager-create entry
// point: clicking the dashboard "New transaction" CTA now lands on
// /checkout (cart-build, in-memory only). A ticket row is only inserted
// on commit (cash take, card success, etc.). The cart-edit UI at
// /checkout/[ticketId]/checkout-screen.client.tsx is still present and
// fully functional once a ticket exists (it's reused after commit for
// the post-commit "Cancel"/"Discard" affordances, and pre-existing open
// rows from the seed remain editable there). So pre-042 specs that
// tested mid-build affordances can keep their UI assertions verbatim —
// they just need a different SETUP step to land them at /checkout/<id>
// with a status='open' ticket.
//
// Column names mirror `app/(studio)/checkout/actions.ts § insertTicketAndItems`
// verbatim; see also `supabase/migrations/0004_checkout_cash_sale.sql`
// for the ticket/ticket_items/payments shapes.

import type { SupabaseClient } from "@supabase/supabase-js";

export type OpenTicketItem = {
  /** Service id (FK target for ticket_items.ref_id). */
  serviceId: string;
  /** Display name to snapshot onto the ticket_items row. */
  displayName: string;
  /** Per-unit price in cents. The line total is unit_price_cents * qty. */
  unitPriceCents: number;
  /** Defaults to 1. */
  qty?: number;
  /** Defaults to false. */
  priceUnconfirmed?: boolean;
};

export type OpenTicketSeed = {
  /** The tech assigned to each ticket line. */
  techId: string;
  /** The opener — populates `tickets.opened_by_staff_id`. */
  openedByStaffId: string;
  /** Zero or more lines to attach. Defaults to no lines. */
  items?: ReadonlyArray<OpenTicketItem>;
};

/**
 * Insert a `status='open'` ticket + 0..N service lines. Returns the new
 * ticket id. Subtotal/total are computed from the items' unit_price * qty.
 *
 * Throws on any insert failure with a descriptive message.
 */
export async function createOpenTicket(
  admin: SupabaseClient,
  seed: OpenTicketSeed
): Promise<string> {
  const items = seed.items ?? [];
  const totalCents = items.reduce((acc, i) => acc + i.unitPriceCents * (i.qty ?? 1), 0);

  // 1) Insert the ticket row. `tickets_total_matches_subtotal_chk`
  //    requires `total = subtotal + tax`, with `tax_cents = 0` in v1.
  const { data: tkRow, error: tkErr } = await admin
    .from("tickets")
    .insert({
      status: "open",
      appointment_id: null,
      opened_by_staff_id: seed.openedByStaffId,
      subtotal_cents: totalCents,
      tax_cents: 0,
      total_cents: totalCents,
    })
    .select("id")
    .single();
  if (tkErr || !tkRow) {
    throw new Error(`createOpenTicket: ticket insert failed: ${tkErr?.message ?? "no row"}`);
  }
  const ticketId = tkRow.id as string;

  // 2) Bulk-insert items if any.
  if (items.length > 0) {
    const rows = items.map((i) => ({
      ticket_id: ticketId,
      kind: "service" as const,
      ref_id: i.serviceId,
      name_snapshot: i.displayName,
      unit_price_cents: i.unitPriceCents,
      qty: i.qty ?? 1,
      assigned_staff_id: seed.techId,
      price_unconfirmed: i.priceUnconfirmed ?? false,
    }));
    const { error: itErr } = await admin.from("ticket_items").insert(rows);
    if (itErr) {
      // Compensating delete on the just-inserted ticket so we leave no
      // orphan if the test setup fails mid-way.
      await admin.from("tickets").delete().eq("id", ticketId);
      throw new Error(`createOpenTicket: items insert failed: ${itErr.message}`);
    }
  }

  return ticketId;
}

export type PaidTicketSeed = OpenTicketSeed & {
  /** Populates `payments.taken_by_staff_id` and `tickets.closed_by_staff_id`. */
  closedByStaffId: string;
};

/**
 * Insert a `status='paid'` ticket + items + a single cash `payments` row
 * matching the ticket's total. Returns the new ticket id.
 *
 * Used by `checkout-receipt.spec.ts` which only needs a paid ticket
 * sitting in the DB to render the receipt route. Bypassing the UI
 * commit flow saves ~3 navigations per test.
 */
export async function createPaidTicket(
  admin: SupabaseClient,
  seed: PaidTicketSeed
): Promise<string> {
  const items = seed.items ?? [];
  if (items.length === 0) {
    throw new Error("createPaidTicket: at least one item required (payment amount_cents > 0)");
  }
  const totalCents = items.reduce((acc, i) => acc + i.unitPriceCents * (i.qty ?? 1), 0);
  if (totalCents <= 0) {
    throw new Error("createPaidTicket: total must be > 0 (payments_amount_cents check)");
  }

  // 1) Insert ticket directly as 'paid' with closed_at/closed_by set so
  //    `tickets_closed_consistency_chk` passes.
  const closedAt = new Date().toISOString();
  const { data: tkRow, error: tkErr } = await admin
    .from("tickets")
    .insert({
      status: "paid",
      appointment_id: null,
      opened_by_staff_id: seed.openedByStaffId,
      closed_by_staff_id: seed.closedByStaffId,
      closed_at: closedAt,
      subtotal_cents: totalCents,
      tax_cents: 0,
      total_cents: totalCents,
    })
    .select("id")
    .single();
  if (tkErr || !tkRow) {
    throw new Error(`createPaidTicket: ticket insert failed: ${tkErr?.message ?? "no row"}`);
  }
  const ticketId = tkRow.id as string;

  // 2) Items.
  const itemRows = items.map((i) => ({
    ticket_id: ticketId,
    kind: "service" as const,
    ref_id: i.serviceId,
    name_snapshot: i.displayName,
    unit_price_cents: i.unitPriceCents,
    qty: i.qty ?? 1,
    assigned_staff_id: seed.techId,
    price_unconfirmed: false,
  }));
  const { error: itErr } = await admin.from("ticket_items").insert(itemRows);
  if (itErr) {
    await admin.from("tickets").delete().eq("id", ticketId);
    throw new Error(`createPaidTicket: items insert failed: ${itErr.message}`);
  }

  // 3) Cash payment row matching the total.
  const { error: payErr } = await admin.from("payments").insert({
    ticket_id: ticketId,
    method: "cash",
    kind: "payment",
    amount_cents: totalCents,
    tip_cents: 0,
    status: "succeeded",
    taken_by_staff_id: seed.closedByStaffId,
  });
  if (payErr) {
    await admin.from("ticket_items").delete().eq("ticket_id", ticketId);
    await admin.from("tickets").delete().eq("id", ticketId);
    throw new Error(`createPaidTicket: payment insert failed: ${payErr.message}`);
  }

  return ticketId;
}

// Seeded staff/service ids — duplicated here so callers don't have to
// re-derive them. Mirrors `supabase/seed.sql`.
export const SEEDED_STAFF_IDS = {
  maya: "10000000-0000-0000-0000-000000000001",
  jordan: "10000000-0000-0000-0000-000000000002",
  sam: "10000000-0000-0000-0000-000000000003",
} as const;

export const SEEDED_SERVICE_IDS = {
  classicManicure: "20000000-0000-0000-0000-000000000001", // $25 fixed, Jordan + Sam
  gelPolish: "20000000-0000-0000-0000-000000000002", //       $35 fixed, Sam only
  classicPedicure: "20000000-0000-0000-0000-000000000003", // $40 fixed, Jordan + Sam
  spaPedicure: "20000000-0000-0000-0000-000000000004", //     $55 fixed, Sam ($75 override)
  nailArt: "20000000-0000-0000-0000-000000000005", //         variable, all
} as const;
