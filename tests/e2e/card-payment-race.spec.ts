// tests/e2e/card-payment-race.spec.ts
//
// US3 — FR-016a cancel-vs-success race ("Square wins") end-to-end.
//
// checkout sent → operator taps Cancel → 200ms later the server's
// cancel-stub returns `COMPLETED` (Square's response when the customer
// paid before the cancel reached the terminal). The action's
// `cancelTerminalPayment` interprets this as race-succeeded:
//   - calls pos_record_card_payment(succeeded, tip, …)
//   - emits payment.cancelled with resolved_status='race_succeeded'
//   - the RPC emits payment.captured
//
// UI advances to Done with a toast notice "Card was charged before
// cancel reached the terminal. …"
//
// `describe` named "US3: Cancel and recover — race" so `-g "US3"` matches.

import { type Page, type BrowserContext } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { squareStub, type SquareStub } from "./_square-stub";
import { createOpenTicket, SEEDED_SERVICE_IDS, SEEDED_STAFF_IDS } from "./_open-ticket";

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
  baseURL: string,
  deviceId: string
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

  const defaultRadio = page.getByTestId(`square-device-default-${deviceId}`);
  if (await defaultRadio.isVisible()) {
    await defaultRadio.click();
    await expect(page.getByText(/Default terminal updated\./i)).toBeVisible({ timeout: 5000 });
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US3: Cancel and recover — race", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US3 race spec.");
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

  test("US3: cancel meets a customer-paid → Square returns COMPLETED → Done with race notice + dual audits", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_RACE";
    await serverStub.setDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    const cursor = newAuditCursor();

    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!, deviceId);

    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    // 042-ephemeral-cart: direct-insert open ticket (Jordan + Classic
    // manicure $25) and land on the cart-edit route ready for the
    // race-condition assertions below.
    const supabaseSeed = serviceClient();
    const ticketId = await createOpenTicket(supabaseSeed, {
      techId: SEEDED_STAFF_IDS.jordan,
      openedByStaffId: SEEDED_STAFF_IDS.maya,
      items: [
        {
          serviceId: SEEDED_SERVICE_IDS.classicManicure,
          displayName: "Classic manicure",
          unitPriceCents: 2500,
        },
      ],
    });
    await page.goto(`/checkout/${ticketId}`);
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

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
    const checkoutId = pendingRow!.square_terminal_checkout_id!;
    const paymentId = pendingRow!.id;

    // Prime the cancel stub: when the action calls Square's cancel
    // endpoint, the server returns COMPLETED with tip=600 (the customer
    // paid first). This is the deterministic FR-016a race path.
    await serverStub.setCheckoutCancel(checkoutId, {
      responseStatus: "COMPLETED",
      tipCents: 600,
    });

    // 200ms delay before clicking Cancel, to mirror the "operator hesitated"
    // timing in the user story.
    await new Promise((r) => setTimeout(r, 200));
    await page.locator("[data-slot='card-waiting-cancel']").click();

    // Done screen appears.
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 12_000 });

    // Sonner toast notice — the race copy.
    await expect(
      page.getByText(/Card was charged before cancel reached the terminal/i)
    ).toBeVisible({ timeout: 6000 });

    // DB asserts.
    const { data: paymentRow } = await supabase
      .from("payments")
      .select("status, tip_cents, square_payment_id")
      .eq("id", paymentId)
      .single();
    expect(paymentRow?.status).toBe("succeeded");
    expect(paymentRow?.tip_cents).toBe(600);
    expect(paymentRow?.square_payment_id).toBe(`pay_${checkoutId}`);

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    // Audit: payment.cancelled (intent, resolved_status='race_succeeded')
    //        AND payment.captured (outcome from the RPC).
    const cancelledRows = await getAuditLogRowsSince(cursor, "payment.cancelled");
    const cancelledForThis = cancelledRows.find((r) => r.entity_id === paymentId);
    expect(cancelledForThis).toBeDefined();
    expect((cancelledForThis!.payload as { resolved_status?: string }).resolved_status).toBe(
      "race_succeeded"
    );

    const capturedRows = await getAuditLogRowsSince(cursor, "payment.captured");
    const capturedForThis = capturedRows.find(
      (r) => r.entity_id === paymentId && (r.payload as { method?: string })?.method === "card"
    );
    expect(capturedForThis).toBeDefined();
    expect((capturedForThis!.payload as { tip_cents?: number }).tip_cents).toBe(600);

    stub.assertNoLiveSquareCalls();
  });
});
