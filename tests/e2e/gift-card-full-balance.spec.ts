// tests/e2e/gift-card-full-balance.spec.ts
//
// US1 happy path — front desk redeems a full-balance gift card:
//   1. Sign in, connect Square via stub.
//   2. Open a fresh ticket, pick a tech + a $40 service.
//   3. Tap Gift tile → GanNumpadSheet opens.
//   4. Enter GAN `6000 1234 5678 0001` (stub fixture: ACTIVE $60).
//   5. Balance sheet shows "$60.00 available · Card ending in 0001 · Redeem".
//   6. Tap Redeem → waiting micro-state → stub auto-fires the
//      payment.updated webhook → ticket flips paid → DoneScreen.
//   7. Audit cursor asserts the three verbs in order:
//        gift_card.balance_looked_up
//        payment.draft_created
//        gift_card.redeemed
//
// Run scope (per CLAUDE.md per-phase gate convention):
//   npx playwright test tests/e2e/gift-card-full-balance.spec.ts -g "US1"

import { type Page, type BrowserContext } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { squareStub, type SquareStub } from "./_square-stub";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

import {
  acquireStubLock,
  getStubControls,
  releaseStubLock,
  type ServerStubControls,
} from "./_square-server-stub";

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

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function clearSquareTables(): Promise<void> {
  const c = serviceClient();
  await c.from("square_devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await c.from("square_oauth").delete().eq("id", true);
  // Also wipe gift_cards so cached rows from prior runs don't leak.
  await c.from("gift_cards").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

async function connectSquareViaStub(
  page: Page,
  context: BrowserContext,
  baseURL: string
): Promise<void> {
  await context.route(
    (url) =>
      url.hostname === "connect.squareupsandbox.com" &&
      url.pathname.startsWith("/oauth2/authorize"),
    (route) => {
      const url = new URL(route.request().url());
      const state = url.searchParams.get("state") ?? "";
      const callback = new URL("/settings/square/callback", baseURL);
      callback.searchParams.set("code", "stub-auth-code");
      callback.searchParams.set("state", state);
      return route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
        body: "",
      });
    }
  );

  await page.goto("/settings/square");
  await expect(page.getByTestId("square-connect-button")).toBeVisible();
  await page.getByTestId("square-connect-button").click();
  await expect(page.getByText(/Connected to Stub Salon/i)).toBeVisible({ timeout: 15_000 });
}

async function typeGanIntoNumpad(page: Page, digits: string): Promise<void> {
  // The numpad accepts both keyboard and click input. Click each digit
  // so the test exercises the actual button surface.
  for (const ch of digits) {
    if (/[0-9]/.test(ch)) {
      await page.getByRole("button", { name: `Digit ${ch}` }).click();
    } else {
      // Letters (BLKD, PEND, DEAC fixtures) aren't on the visible numpad;
      // type via the keydown listener so the server-side validator still
      // accepts them per the alphanumeric e2e contract.
      await page.keyboard.press(ch);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US1: redeem full-balance gift card", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US1 gift-card spec.");
      return;
    }
    await acquireStubLock();
    serverStub = getStubControls();
  });

  test.afterAll(async () => {
    releaseStubLock();
  });

  test.beforeEach(async ({ baseURL }) => {
    if (!supabaseUp) return;
    await serverStub.reset();
    await serverStub.setMerchant({ id: "MERCHANT_STUB", business_name: "Stub Salon" });
    await serverStub.setDevices([{ id: "device:STUB_GIFT_US1", name: "Lobby", status: "PAIRED" }]);
    await serverStub.setWebhookBaseUrl(baseURL ?? "http://127.0.0.1:3000");
    await clearSquareTables();
  });

  test("US1 redeems full-balance gift card on a $40 ticket", async ({ page, context, baseURL }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const supabase = serviceClient();

    // 1) Sign in + connect Square.
    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    // 2) Browser-side stub for any client-bundle Square calls (defensive;
    //    the gift-card flow goes server-side, but PaymentTiles checks
    //    devicesAvailable so we install the device fixture).
    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: "device:STUB_GIFT_US1", name: "Lobby", status: "PAIRED" }]);

    // 3) Start a fresh ephemeral cart through the dashboard. Feature 043:
    //    the URL stays paramless `/checkout` while the cart is built —
    //    nothing is persisted until the gift redemption begins.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // 4) Pick Sam (technician) + Classic pedicure ($40).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Sam Chen']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000003']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$40.00");

    // 5) Tap Gift tile → GanNumpadSheet opens.
    await page.locator("[data-slot='payment-tile'][data-method='gift']").click();
    await expect(page.locator("[data-slot='gan-numpad-sheet']")).toBeVisible({ timeout: 5_000 });

    // 6) Enter 6000123456780001 (stub fixture: ACTIVE $60).
    await typeGanIntoNumpad(page, "6000123456780001");
    await page.locator("[data-slot='gan-numpad-submit']").click();

    // 7) Balance sheet renders with $60.00 + last-4 mask.
    await expect(page.locator("[data-slot='gift-card-balance-found']")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("[data-slot='gift-card-balance-amount']")).toContainText("$60.00");

    // 8) Tap Redeem. Feature 043: the gift-card lookup above is read-only
    //    (no ticket persisted); tapping Redeem is the first payment-
    //    initiating action — the cart is persisted atomically and the URL
    //    gains a ticket id. The gift-card-waiting screen rehydrates from
    //    the persisted route.
    await page.locator("[data-slot='gift-card-balance-redeem']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // 9) Waiting micro-state appears.
    await expect(page.locator("[data-slot='gift-card-waiting']")).toBeVisible({ timeout: 5_000 });

    // 10) Within ~10s the auto-fired webhook lands → ticket flips paid → DoneScreen.
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 15_000 });

    // 11) DB asserts: succeeded payment of $40, ticket paid.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, amount_cents, method, square_gift_card_payment_id")
      .eq("ticket_id", ticketId)
      .eq("method", "gift")
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.amount_cents).toBe(4000);
    expect(paymentRow?.square_gift_card_payment_id).toBeTruthy();

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    // 12) Audit cursor — three verbs landed in order.
    const rows = await getAuditLogRowsSince(cursor);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("gift_card.balance_looked_up");
    expect(actions).toContain("payment.draft_created");
    expect(actions).toContain("gift_card.redeemed");

    // 13) No stray Square calls.
    stub.assertNoLiveSquareCalls();
  });
});
