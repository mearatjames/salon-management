// E2E for the Discard control on TxHeader (FR-005, SC-008).
// With a non-empty cart, click Discard → operator returns to dashboard →
// the discarded ticket's status is `discarded` in the DB and the next
// "New transaction" CTA creates a fresh ticket (the discarded one is
// terminal — sidebar resume in US2 will additionally skip it; that's
// tested in T032).

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

    await page.goto("/dashboard");

    // Open a fresh ticket from the dashboard CTA.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // Pick Jordan + add Classic manicure so the cart is non-empty.
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='cart-line']").first()).toContainText("Classic manicure");

    // Click Discard in the TxHeader. It calls `discardTicket()` then routes
    // back to /dashboard (terminal action — never optimistic).
    await page.locator("[data-slot='discard-ticket-button']").click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // DB-level: ticket is discarded, closed_at + closed_by set.
    const admin = adminClient();
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

    // Tapping "New transaction" again creates a fresh ticket (the discarded
    // one is terminal — sidebar resume rule lands in US2 / T032).
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const nextTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(nextTicketId).not.toBe(ticketId);

    // Cleanup: discard the new ticket so re-runs start clean.
    await admin
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: "10000000-0000-0000-0000-000000000001",
      })
      .eq("id", nextTicketId);
  });
});
