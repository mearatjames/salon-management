// E2E for the US1 happy path of feature 011 (cash-only walk-in sale).
// Covers acceptance scenarios 1–5:
//   (a) dashboard CTA → /checkout → fresh ticket created → redirected to
//       /checkout/[ticketId]
//   (b) header tech avatar row → tap collapses to chip + Change link
//   (c) service tile → cart line appears with snapshotted price
//   (d) Take cash → DoneScreen shows "Charged $X"; DB: payments row with
//       method='cash', status='succeeded' + tickets.status='paid'
//   (e) "New sale" → fresh empty ticket reachable
//
// Docker / Supabase availability: same probe pattern as the rest of the
// suite — skip when the local Supabase is unreachable.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

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

// Reuses the standard sign-in flow: Maya Patel (owner; PIN 1234). Mirrors
// the helpers in staff.spec.ts / services.spec.ts.
async function signInAsMaya(
  page: import("@playwright/test").Page,
  next = "/dashboard"
): Promise<void> {
  const encodedNext = encodeURIComponent(next);
  await page.goto(`/login?next=${encodedNext}`);
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
  const nextRegex = new RegExp(`${next.replace(/[/\-]/g, "\\$&")}(\\?|$)`);
  await page.waitForURL(nextRegex, { timeout: 10_000 });
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

  test("(a–e) dashboard → cart → take cash → DoneScreen → New sale", async ({ page }) => {
    const cursor = newAuditCursor();

    await signInAsMaya(page, "/dashboard");

    // (a) Click "New transaction" CTA from the dashboard.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const firstTicketId = new URL(page.url()).pathname.split("/").pop()!;

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

    // (d) Take cash. Wait for DoneScreen.
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await page.locator("[data-slot='take-cash-button']").click();
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-slot='done-charged-amount']")).toHaveText("$25.00");

    // DB-level assertions: payments + tickets state.
    const admin = adminClient();
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

    // Audit: at minimum a `payment.captured` row exists for this ticket.
    const auditRows = await getAuditLogRowsSince(cursor);
    const captureRows = auditRows.filter((r) => r.action === "payment.captured");
    expect(captureRows.length).toBeGreaterThanOrEqual(1);
    // entity_type for payment.captured is "payment" (derived by prefix).
    expect(captureRows[captureRows.length - 1].entity_type).toBe("payment");
    expect((captureRows[captureRows.length - 1].payload ?? {}).ticket_id).toBe(firstTicketId);

    // (e) "New sale" must reach a fresh empty ticket. The browser is
    //     already on /checkout/<firstTicketId>; the Link target is
    //     /checkout, which the entry-point page redirects to a *new*
    //     /checkout/<newTicketId>. Wait specifically for the path to be
    //     a checkout-ticket URL that is NOT the firstTicketId.
    await page.locator("[data-slot='new-sale-button']").click();
    await page.waitForURL(
      (url) => {
        const m = url.pathname.match(/^\/checkout\/([0-9a-f-]{36})$/);
        return m !== null && m[1] !== firstTicketId;
      },
      { timeout: 15_000 }
    );
    const secondTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(secondTicketId).not.toBe(firstTicketId);

    // Cleanup: discard the freshly created ticket so a re-run starts clean.
    await admin
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: "10000000-0000-0000-0000-000000000001",
      })
      .eq("id", secondTicketId);
  });
});
