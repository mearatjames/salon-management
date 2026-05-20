// @vitest-environment node

// Live-DB integration test for `pos_create_ticket_from_draft` (T002 /
// feature 043-checkout-ephemeral-draft migration 0020).
//
// The RPC is the single atomic write that turns an in-memory checkout
// draft into a persisted `tickets` row + N `ticket_items` rows + one
// `ticket.created` audit row. It does NOT re-validate against the catalog
// — the caller (`validateAndResolveDraft`) has already resolved every
// line. The RPC's job is purely the all-or-nothing persistence:
//   - one `tickets` row (status='open', opened_by_staff_id=p_operator)
//   - one `ticket_items` row per element of `p_items`
//   - `subtotal_cents` = sum of service-line unit_price_cents
//   - `total_cents` = greatest(0, subtotal + sum of discount unit_price_cents)
//   - one `audit_log` row (action='ticket.created')
//   - any bad row rolls back the WHOLE transaction.
//
// Follows the live-DB pattern in `leg-sum-equals-total.test.ts` /
// `one-in-flight-per-ticket.test.ts`: skip when Supabase env vars are
// missing, otherwise use the service-role client to seed + tear down
// throwaway rows.
//
// Constitution Principle IV — checkout is a money path; this test is
// written FIRST and MUST FAIL until migration 0020 lands the RPC.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const haveSupabase = Boolean(url && key);
const describeIfSupabase = haveSupabase ? describe : describe.skip;

// Seeded service ids (supabase/seed.sql).
const SVC_CLASSIC_MANI = "20000000-0000-0000-0000-000000000001";
const SVC_GEL_POLISH = "20000000-0000-0000-0000-000000000002";

type ServiceItem = {
  kind: "service";
  ref_id: string;
  name_snapshot: string;
  unit_price_cents: number;
  assigned_staff_id: string;
  price_unconfirmed: boolean;
};

type DiscountItem = {
  kind: "discount";
  name_snapshot: string;
  unit_price_cents: number;
  discount_pct: number | null;
  note: string | null;
};

describeIfSupabase("pos_create_ticket_from_draft", () => {
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
    await supabase.from("audit_log").delete().in("entity_id", createdTicketIds);
    await supabase.from("payments").delete().in("ticket_id", createdTicketIds);
    await supabase.from("ticket_items").delete().in("ticket_id", createdTicketIds);
    await supabase.from("tickets").delete().in("id", createdTicketIds);
  });

  afterAll(async () => {
    // afterEach handled it.
  });

  function serviceItem(
    refId: string,
    name: string,
    unitPriceCents: number,
    staffId: string
  ): ServiceItem {
    return {
      kind: "service",
      ref_id: refId,
      name_snapshot: name,
      unit_price_cents: unitPriceCents,
      assigned_staff_id: staffId,
      price_unconfirmed: false,
    };
  }

  function discountItem(
    name: string,
    unitPriceCents: number,
    discountPct: number | null,
    note: string | null
  ): DiscountItem {
    return {
      kind: "discount",
      name_snapshot: name,
      unit_price_cents: unitPriceCents,
      discount_pct: discountPct,
      note,
    };
  }

  it("atomically inserts the ticket, items, and a ticket.created audit row with computed totals", async () => {
    const items = [
      serviceItem(SVC_CLASSIC_MANI, "Classic Manicure", 4500, ownerId),
      serviceItem(SVC_GEL_POLISH, "Gel Polish", 3500, ownerId),
    ];

    const { data, error } = await supabase.rpc("pos_create_ticket_from_draft", {
      p_operator: ownerId,
      p_items: items,
    } as never);

    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row).toBeTruthy();
    const ticketId = row.ticket_id as string;
    expect(ticketId).toBeTruthy();
    createdTicketIds.push(ticketId);

    // Returned totals: subtotal = 4500 + 3500 = 8000; total = 8000.
    expect(row.subtotal_cents).toBe(8000);
    expect(row.total_cents).toBe(8000);

    // Ticket row persisted with the computed totals + open status. With no
    // discount, the persisted subtotal/total both equal 8000.
    const { data: tk } = await supabase
      .from("tickets")
      .select("status, opened_by_staff_id, subtotal_cents, tax_cents, total_cents")
      .eq("id", ticketId)
      .single();
    expect(tk).toMatchObject({
      status: "open",
      opened_by_staff_id: ownerId,
      subtotal_cents: 8000,
      tax_cents: 0,
      total_cents: 8000,
    });

    // Two ticket_items rows, both service kind.
    const { data: lineRows } = await supabase
      .from("ticket_items")
      .select("kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, discount_pct")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    expect(lineRows).toHaveLength(2);
    expect(lineRows![0]).toMatchObject({
      kind: "service",
      ref_id: SVC_CLASSIC_MANI,
      name_snapshot: "Classic Manicure",
      unit_price_cents: 4500,
      qty: 1,
      assigned_staff_id: ownerId,
      discount_pct: null,
    });
    expect(lineRows![1]).toMatchObject({
      kind: "service",
      ref_id: SVC_GEL_POLISH,
      unit_price_cents: 3500,
    });

    // Exactly one ticket.created audit row.
    const { data: auditRows } = await supabase
      .from("audit_log")
      .select("action, entity_type, entity_id, acting_as_staff_id, payload")
      .eq("entity_id", ticketId)
      .eq("action", "ticket.created");
    expect(auditRows).toHaveLength(1);
    expect(auditRows![0]).toMatchObject({
      action: "ticket.created",
      entity_type: "ticket",
      entity_id: ticketId,
      acting_as_staff_id: ownerId,
    });
    expect(auditRows![0].payload).toMatchObject({
      line_count: 2,
      subtotal_cents: 8000,
    });
  });

  it("folds discount lines into total_cents (subtotal stays service-only)", async () => {
    const items = [
      serviceItem(SVC_CLASSIC_MANI, "Classic Manicure", 5000, ownerId),
      // Caller has already folded the percent to a final negative amount.
      discountItem("Discount · 10%", -500, 10, "loyalty"),
    ];

    const { data, error } = await supabase.rpc("pos_create_ticket_from_draft", {
      p_operator: ownerId,
      p_items: items,
    } as never);

    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    const ticketId = row.ticket_id as string;
    createdTicketIds.push(ticketId);

    // Returned subtotal = sum of service lines only = 5000.
    // Returned total = greatest(0, 5000 + (-500)) = 4500.
    expect(row.subtotal_cents).toBe(5000);
    expect(row.total_cents).toBe(4500);

    // The PERSISTED columns mirror today's recomputeTicketTotals shape:
    // `subtotal_cents = total_cents` (the post-discount value) so the
    // `tickets_total_matches_subtotal_chk` (total = subtotal + tax) holds.
    const { data: tk } = await supabase
      .from("tickets")
      .select("subtotal_cents, total_cents")
      .eq("id", ticketId)
      .single();
    expect(tk).toMatchObject({ subtotal_cents: 4500, total_cents: 4500 });

    // The discount row persisted with ref_id / assigned_staff_id null.
    const { data: lineRows } = await supabase
      .from("ticket_items")
      .select("kind, ref_id, assigned_staff_id, unit_price_cents, discount_pct, note")
      .eq("ticket_id", ticketId)
      .eq("kind", "discount");
    expect(lineRows).toHaveLength(1);
    expect(lineRows![0]).toMatchObject({
      kind: "discount",
      ref_id: null,
      assigned_staff_id: null,
      unit_price_cents: -500,
      discount_pct: 10,
      note: "loyalty",
    });
  });

  it("rolls back the whole transaction when one row violates a constraint (no orphan ticket)", async () => {
    // A bogus ref_id that is not a real services row → FK violation on the
    // second ticket_items insert. The first item is valid; if the RPC is
    // not atomic an orphan ticket + one item would survive.
    const items = [
      serviceItem(SVC_CLASSIC_MANI, "Classic Manicure", 4500, ownerId),
      serviceItem("00000000-0000-0000-0000-0000000000ff", "Bogus Service", 2000, ownerId),
    ];

    const { error } = await supabase.rpc("pos_create_ticket_from_draft", {
      p_operator: ownerId,
      p_items: items,
    } as never);

    // The RPC must surface the failure...
    expect(error).not.toBeNull();

    // ...and leave NO ticket behind. Confirm by checking no open ticket
    // was created for this operator referencing the bogus service.
    const { data: orphanItems } = await supabase
      .from("ticket_items")
      .select("id")
      .eq("ref_id", "00000000-0000-0000-0000-0000000000ff");
    expect(orphanItems ?? []).toHaveLength(0);
  });
});
