// E2E for the consolidated exit control on TxHeader (FR-005, SC-008),
// updated for feature 043-checkout-ephemeral-draft.
//
// After 043, the in-progress cart is an ephemeral in-memory draft — a
// ticket only exists in the DB once a payment-initiating action has
// persisted it. So this spec seeds a *persisted open* ticket directly
// (mirroring `concurrent-charge-blocked.spec.ts` — the discard path under
// test is orthogonal to which payment-initiating action created the
// ticket), opens it at `/checkout/[ticketId]` where the consolidated exit
// control reads "Discard", and verifies discard → status `discarded` +
// the `ticket.discarded` audit row. The next "New transaction" CTA lands
// on the paramless ephemeral `/checkout` (it no longer creates a ticket).

import { expect, test } from "./_fixtures";
import { createClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("US1: discard control marks ticket discarded and returns to dashboard", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping discard spec (Docker unavailable)."
      );
    }
  });

  test("discarding a non-empty cart marks the ticket discarded, audits, and returns to /dashboard", async ({
    page,
  }) => {
    const cursor = newAuditCursor();
    const admin = adminClient();

    // A ticket only exists once a payment-initiating action has persisted
    // it (043). Seed a persisted *open* ticket with one Classic manicure
    // ($25) line directly — this stands in for "a payment was initiated"
    // and keeps the test focused on the discard path. Maya is the operator.
    const { data: maya } = await admin
      .from("staff")
      .select("id")
      .eq("display_name", "Maya Patel")
      .single();
    const ownerId = maya!.id;

    const { data: ticket, error: tkErr } = await admin
      .from("tickets")
      .insert({
        opened_by_staff_id: ownerId,
        status: "open",
        subtotal_cents: 2500,
        tax_cents: 0,
        total_cents: 2500,
      })
      .select("id")
      .single();
    if (tkErr || !ticket) throw new Error(`seed ticket failed: ${tkErr?.message}`);
    const ticketId = ticket.id;

    await admin.from("ticket_items").insert({
      ticket_id: ticketId,
      kind: "service",
      ref_id: "20000000-0000-0000-0000-000000000001", // Classic manicure ($25)
      assigned_staff_id: ownerId,
      name_snapshot: "Classic manicure",
      unit_price_cents: 2500,
      qty: 1,
      price_unconfirmed: false,
    });

    // Open the persisted ticket. The consolidated exit control reads
    // "Discard" in persisted mode.
    await page.goto(`/checkout/${ticketId}`);
    await page.waitForURL(new RegExp(`/checkout/${ticketId}`), { timeout: 10_000 });
    await expect(page.locator("[data-slot='cart-line']").first()).toContainText("Classic manicure");

    // Click the consolidated exit control (labeled "Discard" here). It
    // calls `discardTicket()` then routes back to /dashboard (terminal
    // action — never optimistic).
    const exit = page.locator("[data-slot='checkout-exit-control']");
    await expect(exit).toContainText(/Discard/i);
    await exit.click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // DB-level: ticket is discarded, closed_at + closed_by set.
    const { data: row, error } = await admin
      .from("tickets")
      .select("status, closed_at, closed_by_staff_id")
      .eq("id", ticketId)
      .single();
    expect(error).toBeNull();
    expect(row!.status).toBe("discarded");
    expect(row!.closed_at).toBeTruthy();
    expect(row!.closed_by_staff_id).toBeTruthy();

    // Audit: ticket.discarded row for this ticket exists with the contract
    // payload (subtotal + line count snapshot at discard time).
    const auditRows = await getAuditLogRowsSince(cursor, "ticket.discarded");
    const matching = auditRows.filter((r) => r.entity_id === ticketId);
    expect(matching).toHaveLength(1);
    const payload = (matching[0].payload ?? {}) as Record<string, unknown>;
    expect(typeof payload.subtotal_cents_at_discard).toBe("number");
    expect(typeof payload.line_count_at_discard).toBe("number");
    expect(payload.line_count_at_discard).toBe(1);
    expect(payload.subtotal_cents_at_discard).toBe(2500);

    // Tapping "New transaction" again reaches a fresh ephemeral
    // /checkout (043: the CTA no longer creates a ticket — the new cart is
    // an in-memory draft, so the discarded ticket is simply left behind).
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.locator("[data-slot='checkout-shell']")).toHaveAttribute(
      "data-ephemeral",
      "true"
    );
  });
});
