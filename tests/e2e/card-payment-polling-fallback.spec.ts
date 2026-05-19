// tests/e2e/card-payment-polling-fallback.spec.ts
//
// SC-004 — polling fallback path. The Supabase Realtime channel may be
// delayed or dropped. The waiting screen polls
// `/api/square/terminal-checkout/[paymentId]` every 5 seconds and MUST
// advance to Done within 10 seconds of the local payment row flipping to
// `succeeded`.
//
// We model the lost-Realtime scenario by directly UPDATING the payment row
// to `succeeded` via service-role after the screen opens. The polling loop
// in the UI is what surfaces the change — no webhook fires.

import { type Page, type BrowserContext } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  const defaultRadio = page.getByTestId("square-device-default-device:STUB_POLL");
  if (await defaultRadio.isVisible()) {
    await defaultRadio.click();
    await expect(page.getByText(/Default terminal updated\./i)).toBeVisible({ timeout: 5000 });
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US2: Take a card payment — polling fallback", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping polling fallback spec.");
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
      { id: "device:STUB_POLL", name: "Lobby Terminal", status: "PAIRED" },
    ]);
    await clearSquareTables();
  });

  test("US2 polling: row flips succeeded via service-role; UI advances within 10s without webhook", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!);

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();

    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

    const supabase = serviceClient();
    // Wait for the pending payment row, then directly RPC to mark it
    // succeeded. This simulates "the webhook fired but to some other
    // endpoint" — the local DB has the truth, and only polling can find it.
    let attempt = 0;
    let paymentId: string | null = null;
    while (attempt < 20 && !paymentId) {
      const { data } = await supabase
        .from("payments")
        .select("id")
        .eq("ticket_id", ticketId)
        .eq("method", "card")
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        paymentId = data.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
      attempt++;
    }
    expect(paymentId).toBeTruthy();

    // After a small delay, flip the row to succeeded via the RPC (which
    // also flips the ticket to paid + writes the audit row).
    await new Promise((r) => setTimeout(r, 300));
    const { error: rpcErr } = await supabase.rpc("pos_record_card_payment", {
      p_payment_id: paymentId!,
      p_new_status: "succeeded",
      p_tip_cents: 500,
      p_square_payment_id: "pay_polling_test",
      p_raw: { kind: "polling_test_synthetic" },
      p_failure_reason: null,
    });
    expect(rpcErr).toBeNull();

    // The UI must advance within ~10s via polling (poll cadence is 5s).
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 12_000 });

    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, tip_cents")
      .eq("id", paymentId!)
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.tip_cents).toBe(500);

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");
  });
});
