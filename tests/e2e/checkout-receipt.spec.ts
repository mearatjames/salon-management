// E2E for US4 — printable browser-rendered receipt
// (`/checkout/[ticketId]/receipt`). Covers acceptance scenarios 1–2 +
// FR-026:
//
//   (a) authenticated GET of a paid ticket's receipt URL renders the
//       salon name, line items, subtotal, total, and the cash payment
//       method
//   (b) printable layout omits the studio chrome — the sidebar /
//       topbar selectors that the parent `app/(studio)/layout.tsx`
//       renders are NOT present in the DOM (the receipt route lives
//       under the sibling `app/(receipt-print)/` route group, whose
//       bare layout does not wrap children in the studio shell)
//   (c) anonymous GET (no auth cookies) is redirected to /login and
//       the response body does NOT leak receipt content
//
// Docker / Supabase availability: same probe pattern as the rest of the
// suite — skip when the local Supabase is unreachable.

import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const CLASSIC_MANICURE_ID = "20000000-0000-0000-0000-000000000001";

/**
 * Walks the US1 happy path UI to land a paid ticket in the DB, returning
 * its id. Uses the same selectors as `checkout-cash-sale.spec.ts` so a
 * change in the cart screen breaks both specs in the same place.
 */
async function createPaidTicket(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/dashboard");
  await page.locator("[data-slot='new-transaction-cta']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  const ticketId = new URL(page.url()).pathname.split("/").pop()!;

  await page
    .locator("[data-slot='checkout-tech-row']")
    .locator("[data-staff-name='Jordan Lee']")
    .click();
  await page
    .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANICURE_ID}']`)
    .click();
  await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
  await page.locator("[data-slot='take-cash-button']").click();
  await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });

  return ticketId;
}

test.describe.configure({ mode: "serial" });

test.describe("US4: printable receipt", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US4 receipt specs (Docker unavailable)."
      );
    }
  });

  test("(a) authenticated GET renders salon name, line items, subtotal, total, cash payment", async ({
    page,
  }) => {
    const ticketId = await createPaidTicket(page);

    await page.goto(`/checkout/${ticketId}/receipt`);
    await expect(page.locator("[data-slot='receipt-page']")).toBeVisible({ timeout: 10_000 });

    // Salon name
    await expect(page.locator("[data-slot='receipt-salon-name']")).toHaveText("Tang Nails");

    // At least one line item with name_snapshot of the Classic manicure.
    const items = page.locator("[data-slot='receipt-item']");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Classic manicure");

    // Totals: subtotal $25.00, tax $0.00, total $25.00.
    await expect(page.locator("[data-slot='receipt-subtotal']")).toHaveText("$25.00");
    await expect(page.locator("[data-slot='receipt-tax']")).toHaveText("$0.00");
    await expect(page.locator("[data-slot='receipt-total']")).toHaveText("$25.00");

    // Cash payment line.
    const paymentBlock = page.locator("[data-slot='receipt-payment']");
    await expect(paymentBlock).toContainText("Paid by cash");
    await expect(page.locator("[data-slot='receipt-payment-amount']")).toHaveText("$25.00");

    // Tabular numerals applied on the grand total (Constitution Principle I).
    const totalFontVariant = await page
      .locator("[data-slot='receipt-total']")
      .evaluate((el) => getComputedStyle(el as Element).fontVariantNumeric);
    expect(totalFontVariant).toContain("tabular-nums");
  });

  test("(b) printable layout omits the studio chrome (sidebar + topbar absent from DOM)", async ({
    page,
  }) => {
    const ticketId = await createPaidTicket(page);
    await page.goto(`/checkout/${ticketId}/receipt`);
    await expect(page.locator("[data-slot='receipt-page']")).toBeVisible({ timeout: 10_000 });

    // Studio chrome selectors (set by `app/(studio)/layout.tsx`) must be
    // absent — the local `layout.tsx` override at this depth suppresses
    // the parent shell entirely.
    await expect(page.locator("#studio-sidebar")).toHaveCount(0);
    await expect(page.locator(".studio-sidebar")).toHaveCount(0);
    await expect(page.locator(".studio-topbar")).toHaveCount(0);
    await expect(page.locator(".studio-shell")).toHaveCount(0);
  });

  test("(c) anonymous GET redirects to /login and does not leak receipt content (FR-026)", async ({
    browser,
    page,
  }) => {
    // Use the authenticated session only to seed a paid ticket; then
    // discard the session entirely and verify anonymous access is barred.
    const ticketId = await createPaidTicket(page);

    // Clean context: no cookies, no storageState — simulates a fully
    // anonymous browser.
    const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      // Disable auto-redirects on the underlying request so we can assert
      // the 30x destination directly.
      const res = await anonContext.request.get(`/checkout/${ticketId}/receipt`, {
        maxRedirects: 0,
      });

      // Either the auth middleware returns a 30x to /login (typical), or
      // the route renders an empty body that triggers a client-side
      // redirect. Accept any 3xx with a Location pointing at /login, OR
      // a 2xx whose body contains no receipt content.
      const status = res.status();
      if (status >= 300 && status < 400) {
        const location = res.headers()["location"] ?? "";
        expect(location).toMatch(/\/login/);
      } else {
        const body = await res.text();
        // Defensive: even on a 200 (shouldn't happen), the body must not
        // contain receipt content.
        expect(body).not.toContain("Paid by cash");
        expect(body).not.toContain('data-slot="receipt-page"');
      }

      // Belt-and-suspenders: a full browser nav from the anon context
      // ends up on /login (the middleware redirect lands there).
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/checkout/${ticketId}/receipt`);
      await anonPage.waitForURL(/\/login(\?|$)/, { timeout: 10_000 });
      await expect(anonPage.locator("[data-slot='receipt-page']")).toHaveCount(0);
    } finally {
      await anonContext.close();
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    // Cleanup any paid tickets we created during the describe — keeps the
    // local DB tidy for re-runs. The cash-sale spec follows a similar
    // pattern (discards its "second" ticket in-place).
    const admin = adminClient();
    await admin
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: "10000000-0000-0000-0000-000000000001",
      })
      .eq("status", "open")
      .eq("opened_by_staff_id", "10000000-0000-0000-0000-000000000001");
  });
});
