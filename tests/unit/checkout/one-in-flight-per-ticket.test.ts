// @vitest-environment node

// Live-DB integration test for the partial-unique-index
// `payments_one_in_flight_per_ticket_idx` (feature 018 migration 0011).
//
// Asserts that exactly one row may have `status='pending'` per ticket at a
// time. A second activation attempt while one is already pending hits the
// unique-violation 23505. The action mapping (23505 → TicketAlreadyBeingChargedError)
// is covered in unit tests for `activateCashDraft` (T034) and
// `composeDraftLeg` (T032).
//
// This file follows the pattern in `last_owner_trigger.test.ts` — skip
// when Supabase env vars are missing, otherwise use the service-role
// client.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const haveSupabase = Boolean(url && key);
const describeIfSupabase = haveSupabase ? describe : describe.skip;

describeIfSupabase("payments_one_in_flight_per_ticket_idx", () => {
  let supabase: SupabaseClient;
  const createdTicketIds: string[] = [];
  let ownerId: string;

  beforeAll(async () => {
    supabase = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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
    await supabase.from("payments").delete().in("ticket_id", createdTicketIds);
    await supabase.from("ticket_items").delete().in("ticket_id", createdTicketIds);
    await supabase.from("tickets").delete().in("id", createdTicketIds);
  });

  afterAll(async () => {
    // afterEach handled it.
  });

  async function seedTicket(totalCents: number): Promise<string> {
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

  it("rejects a second pending row on the same ticket with 23505 (unique_violation)", async () => {
    const ticketId = await seedTicket(6000);

    // First pending row — insert directly to mimic an in-flight card/gift leg.
    const { error: firstErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 3000,
      status: "pending",
      taken_by_staff_id: ownerId,
    });
    expect(firstErr).toBeNull();

    // Second pending row — must trip the partial unique index.
    const { error: secondErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "gift",
      kind: "payment",
      amount_cents: 3000,
      status: "pending",
      taken_by_staff_id: ownerId,
    });

    expect(secondErr).not.toBeNull();
    expect((secondErr as { code?: string }).code).toBe("23505");
  });

  it("permits a second pending insert after the first is marked failed", async () => {
    const ticketId = await seedTicket(6000);

    const { data: firstRow, error: firstErr } = await supabase
      .from("payments")
      .insert({
        ticket_id: ticketId,
        method: "card",
        kind: "payment",
        amount_cents: 3000,
        status: "pending",
        taken_by_staff_id: ownerId,
      })
      .select("id")
      .single();
    expect(firstErr).toBeNull();

    // Mark first failed.
    const { error: updErr } = await supabase
      .from("payments")
      .update({ status: "failed", failure_reason: "square_unreachable" })
      .eq("id", firstRow!.id);
    expect(updErr).toBeNull();

    // Now a second pending insert is permitted (the partial index excludes
    // failed rows).
    const { error: secondErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "gift",
      kind: "payment",
      amount_cents: 3000,
      status: "pending",
      taken_by_staff_id: ownerId,
    });

    expect(secondErr).toBeNull();
  });

  it("permits a pending row alongside succeeded rows on the same ticket", async () => {
    const ticketId = await seedTicket(6000);

    const { error: succErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "cash",
      kind: "payment",
      amount_cents: 2000,
      status: "succeeded",
      taken_by_staff_id: ownerId,
      processed_at: new Date().toISOString(),
    });
    expect(succErr).toBeNull();

    const { error: pendErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      status: "pending",
      taken_by_staff_id: ownerId,
    });
    expect(pendErr).toBeNull();
  });
});
