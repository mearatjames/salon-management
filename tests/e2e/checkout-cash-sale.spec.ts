// E2E for the US1 happy path of feature 011 (cash-only walk-in sale),
// updated for feature 043-checkout-ephemeral-draft.
//
// Covers acceptance scenarios 1–5:
//   (a) dashboard CTA → paramless /checkout (NO redirect to
//       /checkout/[ticketId] while the cart is built — the cart is an
//       ephemeral in-memory draft)
//   (b) header tech avatar row → tap collapses to chip + Change link
//   (c) service tile → cart line appears with snapshotted price; DB has
//       NO `tickets` / `ticket_items` / `audit_log` rows yet
//   (d) Take cash → the cart is persisted atomically + charged; the URL
//       becomes /checkout/[ticketId]; DoneScreen shows "Charged $X"; DB:
//       payments row method='cash' status='succeeded' + tickets.status
//       ='paid' + the `payment.captured` audit row
//   (e) "New sale" → fresh empty /checkout reachable
//
// Docker / Supabase availability: same probe pattern as the rest of the
// suite — skip when the local Supabase is unreachable.

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

test.describe("US1: process a cash-only walk-in sale end-to-end", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 checkout specs (Docker unavailable)."
      );
    }
  });

  test("(a–e) dashboard → ephemeral cart → take cash → DoneScreen → New sale", async ({ page }) => {
    const cursor = newAuditCursor();
    const admin = adminClient();

    await page.goto("/dashboard");

    // (a) Click "New transaction" CTA from the dashboard. The CTA links to
    //     the paramless `/checkout` — there is NO redirect to a
    //     `/checkout/[ticketId]` URL while the cart is built.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // (b) Pre-pick state: tech avatar row visible. Pick Jordan Lee.
    const techRow = page.locator("[data-slot='checkout-tech-row']");
    await expect(techRow).toBeVisible();
    await techRow.locator("[data-staff-name='Jordan Lee']").click();
    // After pick: row collapses to chip + Change link.
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible();
    await expect(page.locator("[data-slot='checkout-tech-row']")).toHaveCount(0);

    // (c) Tap "Classic manicure" tile ($25.00 / 2500c). A cart line appears.
    const tile = page.locator(
      "[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']"
    );
    await expect(tile).toBeEnabled();
    await tile.click();
    const cartLine = page.locator("[data-slot='cart-line']").first();
    await expect(cartLine).toContainText("Classic manicure");
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // Feature 043 (T015): the in-progress cart is an ephemeral draft —
    // opening /checkout and adding a service persist NOTHING to the DB.
    // The URL stays paramless `/checkout` (no `/checkout/[ticketId]`
    // route) and the checkout shell is marked `data-ephemeral="true"` —
    // both are per-page signals that hold regardless of what parallel
    // workers do to the shared DB (a global row-count would race).
    expect(new URL(page.url()).pathname).toBe("/checkout");
    await expect(page.locator("[data-slot='checkout-shell']")).toHaveAttribute(
      "data-ephemeral",
      "true"
    );

    // (d) Take cash. The whole cart is persisted atomically + charged.
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await page.locator("[data-slot='take-cash-button']").click();
    // After payment the client navigates to the persisted /checkout/[id].
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const firstTicketId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-slot='done-charged-amount']")).toHaveText("$25.00");

    // DB-level assertions: payments + tickets state.
    const { data: payments, error: payErr } = await admin
      .from("payments")
      .select("id, method, status, amount_cents, ticket_id")
      .eq("ticket_id", firstTicketId);
    expect(payErr).toBeNull();
    expect(payments).toHaveLength(1);
    expect(payments![0].method).toBe("cash");
    expect(payments![0].status).toBe("succeeded");
    expect(payments![0].amount_cents).toBe(2500);

    const { data: ticketRow, error: tkErr } = await admin
      .from("tickets")
      .select("status, total_cents, closed_by_staff_id, closed_at")
      .eq("id", firstTicketId)
      .single();
    expect(tkErr).toBeNull();
    expect(ticketRow!.status).toBe("paid");
    expect(ticketRow!.total_cents).toBe(2500);
    expect(ticketRow!.closed_by_staff_id).toBeTruthy();
    expect(ticketRow!.closed_at).toBeTruthy();

    // The persisted cart has exactly one service `ticket_items` row.
    const { data: itemRows, error: itemErr } = await admin
      .from("ticket_items")
      .select("kind, ref_id, unit_price_cents")
      .eq("ticket_id", firstTicketId);
    expect(itemErr).toBeNull();
    expect(itemRows).toHaveLength(1);
    expect(itemRows![0].kind).toBe("service");
    expect(itemRows![0].unit_price_cents).toBe(2500);

    // Audit: a `payment.captured` row exists for THIS ticket. Filter by
    // payload.ticket_id — parallel workers running the other checkout
    // specs also capture cash against the shared `audit_log` table, so a
    // bare "last row" pick would race.
    const auditRows = await getAuditLogRowsSince(cursor);
    const captureRows = auditRows.filter(
      (r) =>
        r.action === "payment.captured" &&
        (r.payload as { ticket_id?: string } | null)?.ticket_id === firstTicketId
    );
    expect(captureRows.length).toBeGreaterThanOrEqual(1);
    // entity_type for payment.captured is "payment" (derived by prefix).
    expect(captureRows[captureRows.length - 1].entity_type).toBe("payment");

    // (e) "New sale" must reach a fresh empty /checkout. The browser is
    //     already on /checkout/<firstTicketId>; the Link target is the
    //     paramless /checkout, which renders a fresh ephemeral cart.
    await page.locator("[data-slot='new-sale-button']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 15_000 });
    // The fresh draft cart shows the empty pre-pick tech row again.
    await expect(page.locator("[data-slot='checkout-tech-row']")).toBeVisible();
  });
});
