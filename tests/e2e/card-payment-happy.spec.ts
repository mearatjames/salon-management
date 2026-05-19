// tests/e2e/card-payment-happy.spec.ts
//
// US2 happy path — front desk takes a card payment end-to-end. UPDATED
// for 042 ephemeral cart:
//   1. Sign in, connect Square via stub, default device set.
//   2. Navigate to /checkout (cart-build, no ticket row yet), pick tech
//      + service.
//   3. Pick Card → "Send to Square Terminal · $X" → the from-cart action
//      materializes the ticket + pending payment row + calls Square's
//      createCheckout, then redirects to /checkout/<ticketId>.
//   4. After 500ms, simulateWebhook fires terminal.checkout.updated
//      COMPLETED with tip_money 800 against the pending payment row.
//   5. UI advances to DoneScreen within ~8s of the webhook.
//   6. DB: payments row succeeded, tip_cents=800, raw IS NOT NULL,
//      tickets.status='paid'. Audit log has payment.captured with
//      payload.method='card'.

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

  // Mark the lone device default.
  const defaultRadio = page.getByTestId("square-device-default-device:STUB_HAPPY");
  if (await defaultRadio.isVisible()) {
    await defaultRadio.click();
    await expect(page.getByText(/Default terminal updated\./i)).toBeVisible({ timeout: 5000 });
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US2: Take a card payment — happy path", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US2 happy spec.");
      return;
    }
    await acquireStubLock();
    serverStub = getStubControls();
  });

  test.afterAll(async () => {
    releaseStubLock();
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await serverStub.reset();
    await serverStub.setMerchant({ id: "MERCHANT_STUB", business_name: "Stub Salon" });
    await serverStub.setDevices([
      { id: "device:STUB_HAPPY", name: "Lobby Terminal", status: "PAIRED" },
    ]);
    await clearSquareTables();
  });

  test("US2 connect → pick card → webhook arrives → Done with tip recorded", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();

    // 1) Sign in and complete the OAuth round-trip.
    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    // 2) Set up the browser-side Square stub so any in-page Square API hits
    //    are intercepted. The action's `createCheckout` goes through the
    //    Square SDK, which we point at SQUARE_API_BASE_URL — but we also
    //    install the page-side stub for any client-bundle fallout.
    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: "device:STUB_HAPPY", name: "Lobby Terminal", status: "PAIRED" }]);

    // 3) Open the cart-build screen via the dashboard CTA. 042 ephemeral
    //    cart: lands on /checkout (no ticket row yet).
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // 4) Pick Jordan + Classic manicure ($25).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    const supabase = serviceClient();

    // 5) Tap Card tile → CTA appears → tap "Send to Square Terminal · $X".
    //    sendCardToTerminalFromCart materializes the ticket + pending card
    //    payment (with square_terminal_checkout_id populated by Square's
    //    createCheckout) and redirects to /checkout/<ticketId>.
    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();

    // 6) Wait for the redirect to /checkout/<ticketId>.
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 15_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // 7) Read the pending payment row to get its square_terminal_checkout_id.
    //    The from-cart action persists this synchronously before
    //    returning ok:true, so it is available immediately after redirect.
    type PendingPaymentRow = { id: string; square_terminal_checkout_id: string | null };
    let pendingRow: PendingPaymentRow | null = null;
    let attempt = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while (attempt < 20 && !(pendingRow as any)?.square_terminal_checkout_id) {
      const { data } = await supabase
        .from("payments")
        .select("id, square_terminal_checkout_id")
        .eq("ticket_id", ticketId)
        .eq("method", "card")
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      const row = data as { id: string; square_terminal_checkout_id: string | null } | null;
      if (row?.square_terminal_checkout_id) {
        pendingRow = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
      attempt++;
    }
    expect(pendingRow?.square_terminal_checkout_id).toBeTruthy();
    const checkoutId = pendingRow!.square_terminal_checkout_id!;

    // 9) After 500ms simulate the webhook.
    await new Promise((r) => setTimeout(r, 500));
    const webhookRes = await stub.simulateWebhook({
      merchant_id: "MERCHANT_STUB",
      type: "terminal.checkout.updated",
      event_id: `evt_happy_${Date.now()}`,
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
            tip_money: { amount: 800, currency: "USD" },
          },
        },
      },
    });
    expect(webhookRes.status).toBe(200);

    // 10) Force a client navigation so the server component re-reads the
    //     ticket and renders DoneScreen. After the 042 ephemeral-cart
    //     refactor, the cart-build → /checkout/<id> redirect lands the
    //     screen in `cardStage:"cart"` (no auto-enter-waiting yet — see
    //     `checkout-ephemeral-cart.spec.ts` line ~462 future-enhancement
    //     note). Realtime/polling is gated by `cardStage === "waiting"`,
    //     so the webhook-driven flip won't auto-reflect here. Reloading
    //     re-runs the server fetch which now sees status='paid'.
    await page.reload();
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 8000 });

    // 11) DB asserts.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, tip_cents, raw, square_payment_id")
      .eq("ticket_id", ticketId)
      .eq("method", "card")
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.tip_cents).toBe(800);
    expect(paymentRow?.raw).not.toBeNull();
    expect(paymentRow?.square_payment_id).toBe(`pay_${checkoutId}`);

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    // 12) Audit row payment.captured with payload.method='card'.
    const auditRows = await getAuditLogRowsSince(cursor, "payment.captured");
    const cardCaptured = auditRows.find(
      (r) => (r.payload as { method?: string })?.method === "card"
    );
    expect(cardCaptured).toBeDefined();

    stub.assertNoLiveSquareCalls();
  });
});
