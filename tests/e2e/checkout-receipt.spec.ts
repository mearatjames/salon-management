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

import { createPaidTicket, SEEDED_SERVICE_IDS, SEEDED_STAFF_IDS } from "./_open-ticket";

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

/**
 * Direct-inserts a paid ticket via the admin client and returns its id.
 *
 * 042-ephemeral-cart removed the eager-create entry point from the
 * dashboard CTA. Driving the cart-build → cash-take flow through the UI
 * just to land a paid ticket in the DB adds ~5 navigations per test and
 * exercises code paths that have their own dedicated spec
 * (`checkout-cash-sale.spec.ts`). The receipt-page assertions only need
 * a paid ticket sitting in the DB, so we skip the UI entirely.
 */
async function seedPaidTicket(): Promise<string> {
  return createPaidTicket(adminClient(), {
    techId: SEEDED_STAFF_IDS.jordan,
    openedByStaffId: SEEDED_STAFF_IDS.maya,
    closedByStaffId: SEEDED_STAFF_IDS.maya,
    items: [
      {
        serviceId: SEEDED_SERVICE_IDS.classicManicure,
        displayName: "Classic manicure",
        unitPriceCents: 2500,
      },
    ],
  });
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
    const ticketId = await seedPaidTicket();

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
    const ticketId = await seedPaidTicket();
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
  }) => {
    // Seed a paid ticket via the admin client (no UI needed), then verify
    // anonymous access is barred via a fresh context with no cookies.
    const ticketId = await seedPaidTicket();

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
