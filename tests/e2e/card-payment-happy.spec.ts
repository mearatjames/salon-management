// tests/e2e/card-payment-happy.spec.ts
//
// US2 happy path — front desk takes a card payment end-to-end:
//   1. Sign in, connect Square via stub, return to settings, default
//      device set.
//   2. Open a fresh ephemeral /checkout (no pre-existing ticket — feature
//      043), pick a tech + service. The URL stays paramless `/checkout`
//      while the cart is built — nothing is persisted yet.
//   3. Pick Card → "Send to Square · $X". This is the first
//      payment-initiating action: the cart is persisted atomically and the
//      URL becomes /checkout/[ticketId]. Terminal stub primes
//      createCheckout PENDING.
//   4. After 500ms, simulateWebhook fires terminal.checkout.updated
//      COMPLETED with tip_money 800.
//   5. UI advances to DoneScreen within 1s of the webhook.
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

    // 3) Start a fresh ephemeral cart through the dashboard. Feature 043:
    //    the in-progress cart is an in-memory draft — the URL stays
    //    paramless `/checkout` and nothing is persisted to the DB until the
    //    first payment-initiating action.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // 4) Pick Jordan + Classic manicure ($25).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // 5) Prime the Square stub: createCheckout returns PENDING; we'll fire
    //    a webhook to flip it COMPLETED.
    const supabase = serviceClient();
    // The server-side SDK call goes via SQUARE_API_BASE_URL=127.0.0.1:4567,
    // not via the browser context.route. The local server stub already
    // accepts POST /v2/terminals/checkouts via a permissive handler. We
    // primed it through the existing `/v2/devices` route; for terminals
    // we extend the stub or rely on the in-process route. The simpler
    // approach: directly INSERT the pending payment row WITHOUT a real
    // Square createCheckout, by mocking SQUARE_API_BASE_URL to return a
    // primed response. The _square-stub.ts only intercepts BROWSER calls.
    //
    // SOLUTION: post-hoc — observe the row that sendCardToTerminal
    // inserts and then drive the webhook against it.

    // 6) Tap Card tile → footer charge button becomes "Send to Square · $X"
    //    → tap it. Feature 043: this is the first payment-initiating action — the
    //    ephemeral cart is persisted atomically and the URL becomes
    //    /checkout/[ticketId].
    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    // Issue #98 regression: picking Card shows exactly one charge button —
    // the footer "Send to Square" CTA — not a second dead "Take cash" button.
    const sendCardButton = page.locator("[data-slot='send-to-terminal-button']");
    await expect(sendCardButton).toHaveCount(1);
    await expect(sendCardButton).toContainText("Send to Square");
    await expect(page.locator("[data-slot='take-cash-button']")).toHaveCount(0);
    await sendCardButton.click();

    // 7) The cart is now persisted: the URL carries a ticket id and the
    //    card-waiting screen rehydrates from the persisted route.
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({
      timeout: 10_000,
    });

    // 8) Read the pending payment row to get its square_terminal_checkout_id.
    await page
      .waitForFunction(
        async () => {
          const res = await fetch(
            `/api/square/_test/payments?ticketId=${encodeURIComponent("__placeholder__")}`
          ).catch(() => null);
          return Boolean(res);
        },
        undefined,
        { timeout: 0 }
      )
      .catch(() => {});
    // Direct DB read for the pending row.
    let attempt = 0;
    type PendingPaymentRow = { id: string; square_terminal_checkout_id: string | null };
    let pendingRow: PendingPaymentRow | null = null;
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

    // 10) DoneScreen visible within 1s of webhook (allow 6s for Realtime
    //     channel + polling fallback).
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 8000 });

    // #86: the done screen summarises the card payment — the tip and the
    // Square reference. (Card last-4 isn't captured from the terminal
    // checkout payload, so no `•••• ` segment for card.)
    await expect(page.locator("[data-slot='done-method-line']")).toContainText("Paid by card");
    await expect(page.locator("[data-slot='done-method-line']")).toContainText("tip $8.00");
    await expect(page.locator("[data-slot='done-reference-line']")).toContainText(
      `Square ref pay_${checkoutId}`
    );

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

    // 13) Feature 051 (T013 (l)) — single-tender card sale sends an
    //     itemized Order to Square. The server-side Square SDK routes
    //     through `SQUARE_API_BASE_URL=http://127.0.0.1:4567` (the
    //     `_square-server-stub.ts` singleton), which records every
    //     `POST /v2/orders` request body. Assert exactly one create and
    //     that its `lineItems` mirror the seeded ticket's service rows.
    const orderCreates = await serverStub.recordedOrderCreates();
    expect(orderCreates).toHaveLength(1);
    const orderBody = orderCreates[0].body as {
      order?: {
        line_items?: Array<{
          name?: string;
          base_price_money?: { amount?: number };
          quantity?: string;
        }>;
      };
    };
    expect(orderBody.order?.line_items).toHaveLength(1);
    const li = orderBody.order!.line_items![0];
    expect(li.name).toBe("Classic manicure");
    // Square SDK serializes BigInt money as a JSON number. Tang Nails
    // sends 2500 cents for the $25 Classic manicure seeded service.
    expect(li.base_price_money?.amount).toBe(2500);
    expect(li.quantity).toBe("1");

    // The persisted payment row also carries the Square Order id so
    // support can pivot from Tang Nails to Square without recomputation.
    const { data: orderedRow } = await supabase
      .from("payments")
      .select("square_order_id")
      .eq("ticket_id", ticketId)
      .eq("method", "card")
      .single();
    expect(orderedRow?.square_order_id).toBe(orderCreates[0].responseOrderId);
  });

  // ---------------------------------------------------------------------
  // Feature 051 (T013 (m)) — split-tender card leg sends NO Order.
  //
  // A $25 ticket is split into $10 cash + $15 card. After the card leg
  // activates we assert the server stub recorded ZERO `POST /v2/orders`
  // because the card amount (1500 cents) is strictly less than the
  // ticket total (2500 cents) — `sendCardToTerminal`'s `isSingleTender`
  // gate keeps the split-tender path on today's `amountMoney`-only
  // contract. No webhook is required to make this assertion; the
  // `card-waiting` screen is enough.
  // ---------------------------------------------------------------------
  test("US1 (m) split-tender card leg → no POST /v2/orders recorded", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const supabase = serviceClient();

    // 1) Sign in + connect Square + set default terminal.
    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: "device:STUB_HAPPY", name: "Lobby Terminal", status: "PAIRED" }]);

    // 2) Open a fresh ephemeral cart, pick a $25 Classic manicure.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // 3) Tap Split → SplitCartFooter renders.
    await page.locator("[data-slot='payment-tile'][data-method='split']").click();
    await expect(page.locator("[data-slot='split-cart-footer']")).toBeVisible({ timeout: 5_000 });

    // 4) Compose $10 cash leg (this persists the cart) + $15 card leg.
    await page.locator("[data-slot='split-add-leg']").click();
    await expect(page.locator("[data-slot='split-composer']")).toBeVisible();
    await page.locator("[data-slot='split-composer-amount']").fill("10.00");
    await page.locator("[data-slot='split-composer-method'][data-method='cash']").click();
    await page.locator("[data-slot='split-composer-submit']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    await page.locator("[data-slot='split-add-leg']").click();
    await expect(page.locator("[data-slot='split-composer']")).toBeVisible();
    await page.locator("[data-slot='split-composer-amount']").fill("15.00");
    await page.locator("[data-slot='split-composer-method'][data-method='card']").click();
    await page.locator("[data-slot='split-composer-submit']").click();
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='card'][data-status='draft']")
    ).toBeVisible({ timeout: 5_000 });

    // 5) Activate the cash leg, then the card leg.
    await page.locator("[data-slot='payment-leg-row'][data-method='cash']").click();
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='cash'][data-status='succeeded']")
    ).toBeVisible({ timeout: 5_000 });

    // Snapshot the order-creates list BEFORE the card leg so we can prove
    // the leg itself added nothing (the happy-path test, run earlier in
    // this serial describe, will have left at least one create on the
    // shared singleton stub's recorder).
    const ordersBefore = await serverStub.recordedOrderCreates();
    const baselineCount = ordersBefore.length;

    await page.locator("[data-slot='payment-leg-row'][data-method='card']").click();
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

    // 6) Wait for the pending card row to land + capture its checkout id
    //    (proves `squareCreateCheckout` was invoked — i.e. the only path
    //    that *could* have called `orders.create` ran fully).
    let attempt = 0;
    type PendingPaymentRow = {
      id: string;
      square_terminal_checkout_id: string | null;
      square_order_id: string | null;
    };
    let pendingRow: PendingPaymentRow | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while (attempt < 20 && !(pendingRow as any)?.square_terminal_checkout_id) {
      const { data } = await supabase
        .from("payments")
        .select("id, square_terminal_checkout_id, square_order_id")
        .eq("ticket_id", ticketId)
        .eq("method", "card")
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      const row = data as PendingPaymentRow | null;
      if (row?.square_terminal_checkout_id) {
        pendingRow = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
      attempt++;
    }
    expect(pendingRow?.square_terminal_checkout_id).toBeTruthy();

    // 7) Split-tender card leg MUST NOT create an Order and the row's
    //    `square_order_id` column stays null.
    const ordersAfter = await serverStub.recordedOrderCreates();
    expect(ordersAfter.length - baselineCount).toBe(0);
    expect(pendingRow?.square_order_id).toBeNull();

    stub.assertNoLiveSquareCalls();
  });
});
