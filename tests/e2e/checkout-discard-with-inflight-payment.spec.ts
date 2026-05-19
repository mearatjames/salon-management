// tests/e2e/checkout-discard-with-inflight-payment.spec.ts
//
// Issue #26 — discardTicket money-loss defense.
//
// Scenario:
//   1. Open a fresh ticket via UI and add one service line.
//   2. Insert a captured (`succeeded`) cash payment row directly via the
//      admin client to simulate one settled leg of a split tender. We
//      bypass the split-tender UI because reaching `succeeded` through
//      activateCashDraft would require a second leg whose only methods
//      (card / gift) need a connected Square sandbox stub — orthogonal
//      to what this issue is testing. The cash-status check constraint
//      already enforces method=cash → status=succeeded, so the inserted
//      row exactly mirrors the production shape.
//   3. Tap Discard from the TxHeader.
//   4. Server refuses because the ticket has a `succeeded` payments row;
//      the client surfaces the dedicated banner copy.
//   5. The ticket must remain `open` in the DB.
//
// Describe name uses "Issue26" so `-g "Issue26"` filters this spec.

import { type Page } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";
const MAYA_STAFF_ID = "10000000-0000-0000-0000-000000000001";

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

test.describe.configure({ mode: "serial" });

test.describe("Issue26: discard refuses while in-flight payments exist", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping Issue26 spec.");
    }
  });

  test("ticket with a captured (succeeded) payments row refuses to discard and shows the banner", async ({
    page,
  }) => {
    if (!supabaseUp) test.skip();
    const supabase = serviceClient();

    await page.goto("/dashboard");

    // Open a fresh ticket via the dashboard CTA.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // Pick a tech + Classic manicure ($25) so the ticket isn't empty
    // (the Discard button is enabled on any non-terminal ticket regardless,
    // but a non-empty cart matches how a real partial split would arrive).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // Simulate a captured cash leg of a split tender by inserting the
    // payment row directly. method=cash + status=succeeded satisfies the
    // payments_cash_status_succeeded_chk constraint.
    const { error: insertErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "cash",
      kind: "payment",
      amount_cents: 1000,
      status: "succeeded",
      taken_by_staff_id: MAYA_STAFF_ID,
    });
    expect(insertErr).toBeNull();

    // Tap Discard — server must refuse because of the captured payment.
    await page.locator("[data-slot='discard-ticket-button']").click();

    // Banner appears with the required copy.
    await expect(page.locator("[data-slot='checkout-error-banner']")).toContainText(
      /pending or captured payments\. Cancel or void them before discarding/i,
      { timeout: 5_000 }
    );

    // The page does NOT navigate to /dashboard.
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/);

    // DB state: ticket stayed open; the captured payment is still there.
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status, closed_at, closed_by_staff_id")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("open");
    expect(ticketRow?.closed_at).toBeNull();
    expect(ticketRow?.closed_by_staff_id).toBeNull();

    const { data: paymentRows } = await supabase
      .from("payments")
      .select("status, method, amount_cents")
      .eq("ticket_id", ticketId);
    expect(paymentRows?.length).toBe(1);
    expect(paymentRows?.[0].status).toBe("succeeded");
    expect(paymentRows?.[0].method).toBe("cash");

    // Cleanup: delete the captured payment row and force-discard the ticket
    // (the test deliberately prevented the UI from doing so). The cash-status
    // constraint forbids flipping the row's status, so we delete it outright.
    await supabase.from("payments").delete().eq("ticket_id", ticketId);
    await supabase
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: MAYA_STAFF_ID,
      })
      .eq("id", ticketId);
  });
});
