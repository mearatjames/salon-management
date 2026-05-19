// tests/e2e/checkout-discard-during-waiting.spec.ts
//
// Issue #25 — Discard during Square Terminal wait must cancel checkout first.
//
// Scenarios:
//   (a) Cancel-then-discard: with the terminal in the "waiting for card
//       tap" state, clicking Discard issues the Square cancel call before
//       flipping the ticket to discarded. We assert both:
//         - the stub recorded a POST to /v2/terminals/checkouts/:id/cancel
//         - the ticket landed in `discarded`
//       Together these prove the cancel ran before the discard (the UI
//       awaits cancel before calling discardTicket).
//   (b) Cancel unreachable: when Square is unreachable, the UI surfaces
//       the existing "could not cancel" banner and does NOT discard the
//       ticket — the ticket stays open.
//
// Describe name uses "Issue25" so `-g "Issue25"` filters this spec.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  acquireStubLock,
  getStubControls,
  releaseStubLock,
  type ServerStubControls,
} from "./_square-server-stub";
import { squareStub, type SquareStub } from "./_square-stub";

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

  // With a single paired device the server picks it as default automatically,
  // so we don't need to click the radio. The radio still renders, but
  // clicking it on an already-default device is a no-op (no toast fires)
  // and we then strand on the toast assertion. Skip it.
}

async function setupCheckoutInWaiting(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  deviceId: string,
  serverStub: ServerStubControls
): Promise<{ ticketId: string; pendingPaymentId: string; checkoutId: string; stub: SquareStub }> {
  await serverStub.setDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

  await signInAsMaya(page, "/settings/square");
  await connectSquareViaStub(page, context, baseURL);

  const stub: SquareStub = await squareStub(context, baseURL);
  stub.stubListDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

  await page.goto("/dashboard");
  await page.locator("[data-slot='new-transaction-cta']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  const ticketId = new URL(page.url()).pathname.split("/").pop()!;

  await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
  await page
    .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
    .click();
  await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

  // Send to Square Terminal → waiting screen.
  await page.locator("[data-slot='payment-tile'][data-method='card']").click();
  await page.locator("[data-slot='send-to-terminal-button']").click();
  await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

  // Wait for the pending row + checkoutId so we can prime cancel response.
  const supabase = serviceClient();
  let pendingRow: { id: string; square_terminal_checkout_id: string | null } | null = null;
  let attempt = 0;
  while (attempt < 20 && !pendingRow?.square_terminal_checkout_id) {
    const { data } = await supabase
      .from("payments")
      .select("id, square_terminal_checkout_id")
      .eq("ticket_id", ticketId)
      .eq("method", "card")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    pendingRow = data as { id: string; square_terminal_checkout_id: string | null } | null;
    if (pendingRow?.square_terminal_checkout_id) break;
    await new Promise((r) => setTimeout(r, 200));
    attempt++;
  }
  expect(pendingRow?.square_terminal_checkout_id).toBeTruthy();

  return {
    ticketId,
    pendingPaymentId: pendingRow!.id,
    checkoutId: pendingRow!.square_terminal_checkout_id!,
    stub,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Issue25: Discard during Square Terminal wait cancels checkout first", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping Issue25 spec.");
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
    await clearSquareTables();
  });

  test("waiting + Discard → cancelCheckout fires before the ticket flips to discarded", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_ISSUE25_A";

    const { ticketId, checkoutId, stub } = await setupCheckoutInWaiting(
      page,
      context,
      baseURL!,
      deviceId,
      serverStub
    );

    // Default stub response is CANCELED, but be explicit for readability.
    await serverStub.setCheckoutCancel(checkoutId, { responseStatus: "CANCELED" });

    // Click Discard from the TxHeader on the waiting screen.
    await page.locator("[data-slot='discard-ticket-button']").click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // The cancel endpoint was hit — this is what proves cancelTerminalPayment
    // ran. If discard had fired without cancelling, no cancel POST would
    // appear in the stub's recorded calls.
    const recorded = await serverStub.recordedCalls();
    const cancelCalls = recorded.filter(
      (c) => c.method === "POST" && c.path === `/v2/terminals/checkouts/${checkoutId}/cancel`
    );
    expect(cancelCalls.length).toBeGreaterThanOrEqual(1);

    // Ticket landed in `discarded` (cancel succeeded → discard proceeded).
    const supabase = serviceClient();
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status, closed_at")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("discarded");
    expect(ticketRow?.closed_at).toBeTruthy();

    stub.assertNoLiveSquareCalls();
  });

  test("waiting + Discard with Square unreachable → banner shown, ticket stays open", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_ISSUE25_B";

    const { ticketId, checkoutId, stub } = await setupCheckoutInWaiting(
      page,
      context,
      baseURL!,
      deviceId,
      serverStub
    );

    // Square unreachable for cancel → cancelTerminalPayment returns
    // still_pending → UI must surface the existing banner and abort discard.
    await serverStub.setCheckoutCancel(checkoutId, { responseStatus: "NETWORK_ERROR" });

    await page.locator("[data-slot='discard-ticket-button']").click();

    // We stay on the waiting screen with the soft banner.
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible();
    await expect(page.locator("[data-slot='card-waiting-notice']")).toContainText(
      /Couldn.t reach Square to cancel/
    );

    // Ticket must still be open (discard did NOT proceed).
    const supabase = serviceClient();
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("open");

    stub.assertNoLiveSquareCalls();
  });
});
