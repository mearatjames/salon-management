// tests/e2e/card-payment-late-capture-recovery.spec.ts
//
// Issue #27 — pos_record_card_payment: auto-recover late captures after
// discard. Two RPC-isolated scenarios:
//
//   1. Recovery branch — a `terminal.checkout.updated → COMPLETED` event
//      lands for a ticket the operator has already discarded. The RPC
//      auto-flips the ticket back to `paid`, preserves the original
//      discarded actor in the audit payload, and writes a
//      `payment.captured_after_discard` row.
//
//   2. Orphan branch — the ticket is in a third state (here: `paid` via
//      a direct DB write that bypasses normal flows). The RPC leaves the
//      ticket untouched and writes a `payment.capture_orphaned` audit
//      row. The payment row still flips to `succeeded` because Square
//      already has the money.
//
// These tests deliberately bypass the issue #25 / #26 guards by writing
// directly to the DB so the RPC's behavior under each branch can be
// exercised in isolation. Describe name uses "Issue27" so `-g "Issue27"`
// filters this spec.
//
// Setup-light: no UI flow, no Square OAuth round-trip. The webhook
// route's merchant-id check is satisfied either by the absence of a
// square_oauth row (the test resets the table first) or by the inserted
// row's merchant_id matching the simulated event. The signed POST is
// sent with the fixture HMAC key that mirrors the dev .env.local.
//
// Feature 043-checkout-ephemeral-draft: the seed below — a persisted
// `tickets` row + its `pending` card payment — is exactly the state a
// ticket is in *after* the first card-send payment-initiating action.
// The late-capture recovery webhook path operates on that persisted
// ticket unchanged (FR-008/FR-009), so this spec needs no ephemeral-entry
// rewrite: it already starts from the post-payment-initiation state.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";
const MAYA_STAFF_ID = "10000000-0000-0000-0000-000000000001";
const JORDAN_STAFF_ID = "10000000-0000-0000-0000-000000000002";

async function supabaseIsReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(SUPABASE_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function loadWebhookKey(): string {
  try {
    return readFileSync(
      join(process.cwd(), "tests/fixtures/square-webhook-key.txt"),
      "utf-8"
    ).trim();
  } catch {
    const fromEnv = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!fromEnv) {
      throw new Error(
        "Issue27 spec: SQUARE_WEBHOOK_SIGNATURE_KEY not set and tests/fixtures/square-webhook-key.txt missing"
      );
    }
    return fromEnv;
  }
}

async function postSignedWebhook(baseURL: string, event: object): Promise<{ status: number }> {
  const key = loadWebhookKey();
  const rawBody = JSON.stringify(event);
  const url = new URL("/api/webhooks/square", baseURL).toString();
  const signature = createHmac("sha256", key)
    .update(url + rawBody)
    .digest("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": signature,
    },
    body: rawBody,
  });
  return { status: res.status };
}

async function clearSquareTables(): Promise<void> {
  const c = serviceClient();
  await c.from("square_devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await c.from("square_oauth").delete().eq("id", true);
}

type SeedResult = {
  ticketId: string;
  paymentId: string;
  checkoutId: string;
};

/**
 * Build the minimum state the webhook handler needs to route a
 * `terminal.checkout.updated` event into pos_record_card_payment:
 *   - an open ticket with a single $25 service line and total=2500
 *   - a pending card payment row carrying the checkout id
 *
 * Returns the inserted ids so the caller can drive the webhook and
 * assert downstream state.
 */
async function seedOpenTicketWithPendingCardPayment(
  supabase: SupabaseClient,
  uniq: string
): Promise<SeedResult> {
  const ticketInsert = await supabase
    .from("tickets")
    .insert({
      status: "open",
      subtotal_cents: 2500,
      total_cents: 2500,
      opened_by_staff_id: MAYA_STAFF_ID,
    })
    .select("id")
    .single();
  expect(ticketInsert.error).toBeNull();
  const ticketId = ticketInsert.data!.id as string;

  // Classic manicure ($25) seeded by 0003_services_catalog.sql.
  const itemInsert = await supabase.from("ticket_items").insert({
    ticket_id: ticketId,
    kind: "service",
    ref_id: "20000000-0000-0000-0000-000000000001",
    name_snapshot: "Classic manicure",
    unit_price_cents: 2500,
    qty: 1,
    assigned_staff_id: JORDAN_STAFF_ID,
  });
  expect(itemInsert.error).toBeNull();

  const checkoutId = `tco_issue27_${uniq}`;
  const paymentInsert = await supabase
    .from("payments")
    .insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 2500,
      tip_cents: 0,
      status: "pending",
      taken_by_staff_id: JORDAN_STAFF_ID,
      square_terminal_checkout_id: checkoutId,
    })
    .select("id")
    .single();
  expect(paymentInsert.error).toBeNull();
  const paymentId = paymentInsert.data!.id as string;

  return { ticketId, paymentId, checkoutId };
}

function completedEvent(checkoutId: string, ticketId: string, eventId: string): object {
  return {
    merchant_id: "MERCHANT_STUB",
    type: "terminal.checkout.updated",
    event_id: eventId,
    created_at: new Date().toISOString(),
    data: {
      type: "checkout",
      id: checkoutId,
      object: {
        checkout: {
          id: checkoutId,
          status: "COMPLETED",
          reference_id: ticketId,
          payment_ids: [`pay_${checkoutId}`],
          amount_money: { amount: 2500, currency: "USD" },
          tip_money: { amount: 0, currency: "USD" },
        },
      },
    },
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Issue27: pos_record_card_payment auto-recovers late captures", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping Issue27 spec.");
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await clearSquareTables();
  });

  test("Issue27: late COMPLETED for a discarded ticket auto-flips to paid and emits payment.captured_after_discard", async ({
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const supabase = serviceClient();
    const cursor = newAuditCursor();

    const uniq = Date.now().toString(36);
    const { ticketId, paymentId, checkoutId } = await seedOpenTicketWithPendingCardPayment(
      supabase,
      `recovery_${uniq}`
    );

    // Bypass #26's discard guard — write the discarded state directly so
    // we can isolate the RPC's recovery branch. The check constraint
    // requires closed_at + closed_by_staff_id when status = 'discarded'.
    const discardedAt = new Date().toISOString();
    const forceDiscard = await supabase
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: discardedAt,
        closed_by_staff_id: MAYA_STAFF_ID,
      })
      .eq("id", ticketId);
    expect(forceDiscard.error).toBeNull();

    const webhookRes = await postSignedWebhook(
      baseURL!,
      completedEvent(checkoutId, ticketId, `evt_recovery_${uniq}`)
    );
    expect(webhookRes.status).toBe(200);

    // Ticket recovered to paid; closed_by preserved as the original
    // discarding operator (Maya), not the payment's taken_by (Jordan).
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status, closed_by_staff_id, closed_at")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");
    expect(ticketRow?.closed_by_staff_id).toBe(MAYA_STAFF_ID);
    expect(ticketRow?.closed_at).not.toBeNull();
    // closed_at is rewritten to the recovery moment — strictly newer than
    // the original discardedAt timestamp.
    expect(new Date(ticketRow!.closed_at as string).getTime()).toBeGreaterThan(
      new Date(discardedAt).getTime()
    );

    // Payment row mirrors Square's reality.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, square_payment_id")
      .eq("id", paymentId)
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.square_payment_id).toBe(`pay_${checkoutId}`);

    // Anomaly audit row exists with the recovery payload — and the
    // generic payment.captured row does NOT (recovery branch returns
    // before the generic insert).
    const recoveryRows = await getAuditLogRowsSince(cursor, "payment.captured_after_discard");
    const recovery = recoveryRows.find((r) => r.entity_id === paymentId);
    expect(recovery).toBeDefined();
    const payload = recovery!.payload as {
      ticket_id?: string;
      payment_id?: string;
      amount_cents?: number;
      square_terminal_checkout_id?: string;
      original_discarded_at?: string;
      original_discarded_by_staff_id?: string;
      recovered_at?: string;
    };
    expect(payload.ticket_id).toBe(ticketId);
    expect(payload.payment_id).toBe(paymentId);
    expect(payload.amount_cents).toBe(2500);
    expect(payload.square_terminal_checkout_id).toBe(checkoutId);
    expect(payload.original_discarded_by_staff_id).toBe(MAYA_STAFF_ID);
    expect(payload.original_discarded_at).toBeDefined();
    expect(payload.recovered_at).toBeDefined();

    const genericCapturedRows = await getAuditLogRowsSince(cursor, "payment.captured");
    const genericCapturedForThis = genericCapturedRows.find((r) => r.entity_id === paymentId);
    expect(genericCapturedForThis).toBeUndefined();

    // Cleanup: remove the test ticket + payment so subsequent test runs
    // start from a clean slate.
    await supabase.from("payments").delete().eq("ticket_id", ticketId);
    await supabase.from("ticket_items").delete().eq("ticket_id", ticketId);
    await supabase.from("tickets").delete().eq("id", ticketId);
  });

  test("Issue27: late COMPLETED for a ticket in a third state emits payment.capture_orphaned and leaves the ticket", async ({
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const supabase = serviceClient();
    const cursor = newAuditCursor();

    const uniq = Date.now().toString(36);
    const { ticketId, paymentId, checkoutId } = await seedOpenTicketWithPendingCardPayment(
      supabase,
      `orphan_${uniq}`
    );

    // Force ticket into the "third state" — neither `open` nor
    // `discarded`. The ticket_status enum only has three values, so we
    // use `paid` (with the closed_at + closed_by_staff_id consistency
    // constraint satisfied) as a stand-in for "any non-open / non-
    // discarded state a future schema change might introduce."
    const fakePaidAt = new Date(Date.now() - 60_000).toISOString();
    const forcePaid = await supabase
      .from("tickets")
      .update({
        status: "paid",
        closed_at: fakePaidAt,
        closed_by_staff_id: MAYA_STAFF_ID,
      })
      .eq("id", ticketId);
    expect(forcePaid.error).toBeNull();

    const webhookRes = await postSignedWebhook(
      baseURL!,
      completedEvent(checkoutId, ticketId, `evt_orphan_${uniq}`)
    );
    expect(webhookRes.status).toBe(200);

    // Ticket is unchanged — recovery branch only touches `discarded`
    // tickets; the orphan branch is a pure observer.
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status, closed_by_staff_id, closed_at")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");
    expect(ticketRow?.closed_by_staff_id).toBe(MAYA_STAFF_ID);
    // Postgres returns timestamptz with a `+00:00` suffix; compare via
    // Date so the format difference (`Z` vs `+00:00`) doesn't matter.
    expect(new Date(ticketRow!.closed_at as string).getTime()).toBe(new Date(fakePaidAt).getTime());

    // Payment row still flips to succeeded — Square has the money.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, square_payment_id")
      .eq("id", paymentId)
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.square_payment_id).toBe(`pay_${checkoutId}`);

    const orphanRows = await getAuditLogRowsSince(cursor, "payment.capture_orphaned");
    const orphan = orphanRows.find((r) => r.entity_id === paymentId);
    expect(orphan).toBeDefined();
    const payload = orphan!.payload as {
      ticket_id?: string;
      ticket_status?: string;
      payment_id?: string;
      amount_cents?: number;
      square_terminal_checkout_id?: string;
    };
    expect(payload.ticket_id).toBe(ticketId);
    expect(payload.ticket_status).toBe("paid");
    expect(payload.payment_id).toBe(paymentId);
    expect(payload.amount_cents).toBe(2500);
    expect(payload.square_terminal_checkout_id).toBe(checkoutId);

    // And neither the generic captured row nor a recovery row was
    // emitted for this payment.
    const genericCaptured = await getAuditLogRowsSince(cursor, "payment.captured");
    expect(genericCaptured.find((r) => r.entity_id === paymentId)).toBeUndefined();
    const recovery = await getAuditLogRowsSince(cursor, "payment.captured_after_discard");
    expect(recovery.find((r) => r.entity_id === paymentId)).toBeUndefined();

    // Cleanup.
    await supabase.from("payments").delete().eq("ticket_id", ticketId);
    await supabase.from("ticket_items").delete().eq("ticket_id", ticketId);
    await supabase.from("tickets").delete().eq("id", ticketId);
  });
});
