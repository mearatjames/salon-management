// @vitest-environment node

// Live-DB integration test for the SQL-side legs-sum-to-total guard.
//
// Asserts that `pos_activate_cash_draft` (and, by extension, the same
// guard inside `pos_record_gift_payment`) refuses to activate a leg whose
// non-failed siblings don't already cover `tickets.total_cents`. The SQL
// raises `legs_must_sum_to_total` with errcode P0001; the action wraps it
// in `LegSumMismatchError`.
//
// This file follows the pattern in `tests/unit/staff/last_owner_trigger.test.ts`:
// skip when Supabase env vars are missing (CI may not set them), otherwise
// use the service-role client to seed + tear down throwaway rows.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const haveSupabase = Boolean(url && key);
const describeIfSupabase = haveSupabase ? describe : describe.skip;

describeIfSupabase("pos_activate_cash_draft legs-sum-to-total guard", () => {
  let supabase: SupabaseClient;
  const createdTicketIds: string[] = [];
  let ownerId: string;

  beforeAll(async () => {
    supabase = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve the seeded owner (Maya) for the operator argument.
    const { data, error } = await supabase
      .from("staff")
      .select("id")
      .eq("display_name", "Maya Patel")
      .single();
    if (error || !data) throw new Error(`could not resolve seed owner: ${error?.message}`);
    ownerId = data.id;
  });

  beforeEach(() => {
    createdTicketIds.length = 0;
  });

  afterEach(async () => {
    if (createdTicketIds.length === 0) return;
    // Cascade-delete payments + items via the ticket id.
    await supabase.from("payments").delete().in("ticket_id", createdTicketIds);
    await supabase.from("ticket_items").delete().in("ticket_id", createdTicketIds);
    await supabase.from("tickets").delete().in("id", createdTicketIds);
  });

  afterAll(async () => {
    // afterEach handled it.
  });

  async function seedTicket(totalCents: number): Promise<string> {
    // Create a ticket with a single service line so subtotal/total match.
    const { data: tk, error: tkErr } = await supabase
      .from("tickets")
      .insert({
        opened_by_staff_id: ownerId,
        status: "open",
        subtotal_cents: totalCents,
        tax_cents: 0,
        total_cents: totalCents,
      })
      .select("id")
      .single();
    if (tkErr || !tk) throw new Error(`seed ticket failed: ${tkErr?.message}`);
    createdTicketIds.push(tk.id);

    // Seed a fake service line so the ticket isn't flagged "empty" by other
    // guards. The legs-sum-to-total guard doesn't read ticket_items, but we
    // keep the shape realistic.
    const { error: itErr } = await supabase.from("ticket_items").insert({
      ticket_id: tk.id,
      kind: "service",
      ref_id: "20000000-0000-0000-0000-000000000001",
      assigned_staff_id: ownerId,
      name_snapshot: "Test service",
      unit_price_cents: totalCents,
      qty: 1,
      price_unconfirmed: false,
    });
    if (itErr) throw new Error(`seed ticket_items failed: ${itErr.message}`);

    return tk.id;
  }

  it("refuses activation with `legs_must_sum_to_total` when sum of non-failed legs < ticket total", async () => {
    // $60 ticket, compose only a $20 draft cash leg, then try to activate it.
    // Sum of non-failed legs = $20, total = $60 → guard fires.
    const ticketId = await seedTicket(6000);

    const { data: pid, error: composeErr } = await supabase.rpc("pos_compose_payment_draft", {
      p_ticket_id: ticketId,
      p_operator: ownerId,
      p_method: "cash",
      p_amount: 2000,
    } as never);
    expect(composeErr).toBeNull();
    expect(pid).toBeTruthy();

    const { error: activateErr } = await supabase.rpc("pos_activate_cash_draft", {
      p_payment_id: pid as unknown as string,
      p_operator: ownerId,
    } as never);

    expect(activateErr).not.toBeNull();
    expect(activateErr!.message).toMatch(/legs_must_sum_to_total/);
  });

  it("allows activation when legs cover the total exactly (sum of non-failed = total)", async () => {
    // $30 ticket; compose a single $30 cash draft; activation should succeed
    // and flip the ticket to paid.
    const ticketId = await seedTicket(3000);

    const { data: pid, error: composeErr } = await supabase.rpc("pos_compose_payment_draft", {
      p_ticket_id: ticketId,
      p_operator: ownerId,
      p_method: "cash",
      p_amount: 3000,
    } as never);
    expect(composeErr).toBeNull();

    const { data: activateData, error: activateErr } = await supabase.rpc(
      "pos_activate_cash_draft",
      {
        p_payment_id: pid as unknown as string,
        p_operator: ownerId,
      } as never
    );

    expect(activateErr).toBeNull();
    expect(Array.isArray(activateData) ? activateData[0]?.ticket_flipped_to_paid : null).toBe(true);

    // Confirm the ticket flipped paid.
    const { data: tk } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(tk?.status).toBe("paid");
  });
});
