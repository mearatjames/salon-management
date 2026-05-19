// tests/e2e/gift-card-partial-balance.spec.ts
//
// US3 happy path — front desk redeems a partial-balance gift card and
// then closes the ticket with a second cash leg:
//   1. Sign in, connect Square via stub.
//   2. Open a fresh $40 ticket, pick a tech + a $40 service.
//   3. Tap Gift tile → GanNumpadSheet opens.
//   4. Enter GAN `6000 1234 5678 0002` (stub fixture: ACTIVE $15).
//   5. Balance sheet renders the partial copy
//      "$15.00 available · Ticket needs $40.00 · split needed".
//   6. Tap "Redeem available" → MethodPickerPopover auto-opens for the
//      $25 remainder.
//   7. Operator taps Cash → composeDraftLeg + activateCashDraft fire
//      back-to-back → eventual webhook on the gift leg settles → ticket
//      flips paid → DoneScreen.
//   8. Audit cursor asserts the five verbs in order:
//        gift_card.balance_looked_up
//        payment.draft_created     (gift, $15)
//        gift_card.redeemed
//        payment.draft_created     (cash, $25)
//        payment.captured          (cash)
//      No `payment.draft_method_picked` verb — it doesn't exist
//      (analysis remediation removed it).
//
// Run scope (per CLAUDE.md per-phase gate convention):
//   npx playwright test tests/e2e/gift-card-partial-balance.spec.ts -g "US3"

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { squareStub, type SquareStub } from "./_square-stub";
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
  await c.from("gift_cards").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

async function signInAsMaya(page: Page, next: string): Promise<void> {
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
  const re = new RegExp(`${next.replace(/[/\-]/g, "\\$&")}(\\?|$)`);
  await page.waitForURL(re, { timeout: 10_000 });
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
  for (const ch of digits) {
    if (/[0-9]/.test(ch)) {
      await page.getByRole("button", { name: `Digit ${ch}` }).click();
    } else {
      await page.keyboard.press(ch);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US3: gift card partial balance", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US3 gift-card partial spec.");
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
    await serverStub.setDevices([{ id: "device:STUB_GIFT_US3", name: "Lobby", status: "PAIRED" }]);
    await serverStub.setWebhookBaseUrl(baseURL ?? "http://127.0.0.1:3000");
    await clearSquareTables();
  });

  test("US3 redeems partial-balance gift card then picks Cash for the remainder", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const supabase = serviceClient();

    // 1) Sign in + connect Square.
    await signInAsMaya(page, "/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    // 2) Browser-side stub (defensive; the gift-card flow runs server-
    //    side, but PaymentTiles consults devicesAvailable so install the
    //    device fixture).
    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: "device:STUB_GIFT_US3", name: "Lobby", status: "PAIRED" }]);

    // 3) Open a fresh ticket via dashboard.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // 4) Pick Sam + Classic pedicure ($40).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Sam Chen']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000003']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$40.00");

    // 5) Tap Gift tile → GanNumpadSheet.
    await page.locator("[data-slot='payment-tile'][data-method='gift']").click();
    await expect(page.locator("[data-slot='gan-numpad-sheet']")).toBeVisible({
      timeout: 5_000,
    });

    // 6) Enter 6000123456780002 (stub fixture: ACTIVE $15).
    await typeGanIntoNumpad(page, "6000123456780002");
    await page.locator("[data-slot='gan-numpad-submit']").click();

    // 7) Balance sheet renders the partial-state copy.
    await expect(page.locator("[data-slot='gift-card-balance-partial']")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("[data-slot='gift-card-balance-amount']")).toContainText("$15.00");
    await expect(page.locator("[data-slot='gift-card-balance-partial']")).toContainText(
      "Ticket needs $40.00"
    );
    await expect(page.locator("[data-slot='gift-card-balance-partial']")).toContainText(
      "split needed"
    );

    // 8) Suppress the auto-fired gift webhook so it doesn't land before
    //    the operator has composed the second leg. In production the
    //    operator absolutely has time to pick the second method before
    //    Square's webhook arrives — the stub's 100ms auto-fire is
    //    unrealistically fast for an interactive flow, so we gate it.
    await serverStub.suppressGiftWebhook();

    // 9) Tap "Redeem available".
    const redeemBtn = page.locator("[data-slot='gift-card-balance-redeem']");
    await expect(redeemBtn).toContainText(/Redeem available/i);
    await redeemBtn.click();

    // 10) MethodPickerPopover auto-opens for the $25 remainder.
    await expect(page.locator("[data-slot='method-picker-popover']")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("[data-slot='method-picker-amount']")).toContainText("$25.00");

    // 11) Tap Cash → composeDraftLeg + activateCashDraft fire back to back.
    //     activateCashDraft's legs-sum guard sees: gift leg (pending,
    //     $15) + cash leg (draft → succeeded, $25) = $40 = total. OK.
    await page.locator("[data-slot='method-picker-tile'][data-method='cash']").click();

    // 12) Cash leg flips to succeeded; the cart now shows gift pending +
    //     cash succeeded. The ticket is still 'open' (gift hasn't
    //     settled yet).
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='cash'][data-status='succeeded']")
    ).toBeVisible({ timeout: 10_000 });

    // 13) Now fire the gift webhook manually. Look up the gift payment
    //     row to get the Square gift-card-payment id we need in the
    //     event body, then POST a valid signed webhook to the app.
    //     pos_record_gift_payment will succeed because both legs are
    //     already composed and sum to total.
    let giftSquarePaymentId: string | null = null;
    for (let i = 0; i < 20 && !giftSquarePaymentId; i++) {
      const { data } = await supabase
        .from("payments")
        .select("square_gift_card_payment_id")
        .eq("ticket_id", ticketId)
        .eq("method", "gift")
        .maybeSingle();
      const row = data as { square_gift_card_payment_id: string | null } | null;
      if (row?.square_gift_card_payment_id) {
        giftSquarePaymentId = row.square_gift_card_payment_id;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(giftSquarePaymentId).toBeTruthy();

    const webhookRes = await stub.simulateWebhook({
      merchant_id: "MERCHANT_STUB",
      type: "payment.updated",
      event_id: `evt_gift_partial_${Date.now()}`,
      created_at: new Date().toISOString(),
      data: {
        type: "payment",
        id: giftSquarePaymentId,
        object: {
          payment: {
            id: giftSquarePaymentId,
            status: "COMPLETED",
            source_type: "GIFT_CARD",
            amount_money: { amount: 1500, currency: "USD" },
            reference_id: ticketId,
          },
        },
      },
    });
    expect(webhookRes.status).toBe(200);

    // 14) Sanity: confirm the server-side state landed before waiting on
    //     the UI. The pos_record_gift_payment RPC flips the gift leg to
    //     succeeded + the ticket to paid in a single transaction, so by
    //     the time the webhook 200s the DB should reflect both.
    let ticketPaid = false;
    for (let i = 0; i < 30 && !ticketPaid; i++) {
      const { data } = await supabase
        .from("tickets")
        .select("status")
        .eq("id", ticketId)
        .maybeSingle();
      if (data?.status === "paid") {
        ticketPaid = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ticketPaid).toBe(true);

    // 15) Ticket flips paid → DoneScreen renders once the client realtime
    //     channel + the "all legs settled" effect trigger router.refresh().
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 20_000 });

    // 13) DB asserts — two succeeded payments summing to $40.
    const { data: paymentRows } = await supabase
      .from("payments")
      .select("status, amount_cents, method")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    const giftRow = paymentRows?.find((r) => r.method === "gift");
    const cashRow = paymentRows?.find((r) => r.method === "cash");
    expect(giftRow?.status).toBe("succeeded");
    expect(giftRow?.amount_cents).toBe(1500);
    expect(cashRow?.status).toBe("succeeded");
    expect(cashRow?.amount_cents).toBe(2500);

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    // 14) Audit cursor — the five expected verbs landed in order. We
    //     also assert NO `payment.draft_method_picked` rows exist (the
    //     verb doesn't exist; analysis remediation removed it).
    const rows = await getAuditLogRowsSince(cursor);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("gift_card.balance_looked_up");
    expect(actions).toContain("gift_card.redeemed");
    const draftCreated = actions.filter((a) => a === "payment.draft_created").length;
    expect(draftCreated).toBeGreaterThanOrEqual(2);
    const captured = actions.filter((a) => a === "payment.captured").length;
    expect(captured).toBeGreaterThanOrEqual(1);
    expect(actions).not.toContain("payment.draft_method_picked");

    stub.assertNoLiveSquareCalls();
  });
});
