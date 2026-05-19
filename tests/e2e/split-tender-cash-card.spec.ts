// tests/e2e/split-tender-cash-card.spec.ts
//
// US2 happy path — front desk splits a $60 ticket into $20 cash + $40 card:
//   1. Sign in, connect Square via stub.
//   2. Open a fresh ticket, pick a tech + a $60 service.
//   3. Tap Split tile → SplitCartFooter renders.
//   4. Add a $20 cash draft + a $40 card draft.
//   5. Activate the cash draft → row flips to succeeded ("Paid $20 of $60").
//   6. Activate the card draft → terminal stub emits webhook → ticket
//      flips paid → DoneScreen.
//   7. Audit cursor asserts the four verbs:
//        payment.draft_created (cash $20)
//        payment.draft_created (card $40)
//        payment.captured     (cash activation)
//        payment.captured     (card activation via webhook)

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

  // Mark the lone device default so sendCardToTerminal resolves it.
  const defaultRadio = page.getByTestId("square-device-default-device:STUB_SPLIT");
  if (await defaultRadio.isVisible()) {
    await defaultRadio.click();
    await expect(page.getByText(/Default terminal updated\./i)).toBeVisible({ timeout: 5000 });
  }
}

async function fillComposer(
  page: Page,
  amount: string,
  method: "cash" | "card" | "gift"
): Promise<void> {
  await page.locator("[data-slot='split-add-leg']").click();
  await expect(page.locator("[data-slot='split-composer']")).toBeVisible();
  await page.locator("[data-slot='split-composer-amount']").fill(amount);
  await page.locator(`[data-slot='split-composer-method'][data-method='${method}']`).click();
  await page.locator("[data-slot='split-composer-submit']").click();
}

test.describe.configure({ mode: "serial" });

test.describe("US2: split tender — cash + card", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US2 split-tender spec.");
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
    await serverStub.setDevices([
      { id: "device:STUB_SPLIT", name: "Lobby Terminal", status: "PAIRED" },
    ]);
    await serverStub.setWebhookBaseUrl(baseURL ?? "http://127.0.0.1:3000");
    await clearSquareTables();
  });

  test("US2 splits $60 ticket into $20 cash + $40 card → both activate → DoneScreen", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const supabase = serviceClient();

    // 1) Sign in + connect Square.
    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    // 2) Browser-side stub: defensive for any in-page Square calls.
    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: "device:STUB_SPLIT", name: "Lobby Terminal", status: "PAIRED" }]);

    // 3) Open a fresh ticket via dashboard.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // 4) Pick Sam, then Gel polish ($35) + Classic manicure ($25) = $60.
    //    The seed catalog has no single $60 fixed-price service, so we
    //    compose the total with two lines assigned to Sam (who can do both).
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Sam Chen']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000002']")
      .click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$60.00");

    // 5) Tap Split tile → SplitCartFooter renders.
    await page.locator("[data-slot='payment-tile'][data-method='split']").click();
    await expect(page.locator("[data-slot='split-cart-footer']")).toBeVisible({ timeout: 5_000 });

    // 6) Compose $20 cash + $40 card drafts.
    await fillComposer(page, "20.00", "cash");
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='cash'][data-status='draft']")
    ).toBeVisible({ timeout: 5_000 });
    await fillComposer(page, "40.00", "card");
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='card'][data-status='draft']")
    ).toBeVisible({ timeout: 5_000 });

    // Verify "Owes $0.00" since 20+40=60.
    await expect(page.locator("[data-slot='split-owed']")).toContainText("$0.00");

    // 7) Activate the cash leg by tapping it. The activateCashDraft action
    //    runs the legs-sum guard server-side (20+40=60 ✓) and flips
    //    draft→succeeded.
    await page.locator("[data-slot='payment-leg-row'][data-method='cash']").click();
    await expect(
      page.locator("[data-slot='payment-leg-row'][data-method='cash'][data-status='succeeded']")
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-slot='split-paid']")).toContainText("$20.00");

    // 8) Activate the card leg. The row transitions draft → pending and
    //    the CardWaiting screen takes over.
    await page.locator("[data-slot='payment-leg-row'][data-method='card']").click();
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

    // 9) Find the pending card row's Square terminal-checkout id so we
    //    can simulate the webhook.
    let attempt = 0;
    type PendingPaymentRow = {
      id: string;
      square_terminal_checkout_id: string | null;
    };
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

    // 10) After 500ms simulate the terminal-checkout webhook with 0 tip.
    await new Promise((r) => setTimeout(r, 500));
    const webhookRes = await stub.simulateWebhook({
      merchant_id: "MERCHANT_STUB",
      type: "terminal.checkout.updated",
      event_id: `evt_split_${Date.now()}`,
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
            amount_money: { amount: 4000, currency: "USD" },
            tip_money: { amount: 0, currency: "USD" },
          },
        },
      },
    });
    expect(webhookRes.status).toBe(200);

    // 11) DoneScreen renders within 8s (realtime + polling fallback).
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });

    // 12) DB asserts.
    const { data: paymentRows } = await supabase
      .from("payments")
      .select("status, amount_cents, method")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    const cashRow = paymentRows?.find((r) => r.method === "cash");
    const cardRow = paymentRows?.find((r) => r.method === "card");
    expect(cashRow?.status).toBe("succeeded");
    expect(cashRow?.amount_cents).toBe(2000);
    expect(cardRow?.status).toBe("succeeded");
    expect(cardRow?.amount_cents).toBe(4000);

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    // 13) Audit cursor — four verbs landed.
    const rows = await getAuditLogRowsSince(cursor);
    const actions = rows.map((r) => r.action);
    const draftCreatedCount = actions.filter((a) => a === "payment.draft_created").length;
    const capturedCount = actions.filter((a) => a === "payment.captured").length;
    expect(draftCreatedCount).toBeGreaterThanOrEqual(2);
    expect(capturedCount).toBeGreaterThanOrEqual(2);

    stub.assertNoLiveSquareCalls();
  });
});
