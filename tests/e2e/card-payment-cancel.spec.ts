// tests/e2e/card-payment-cancel.spec.ts
//
// US3 — Cancel + recover from a card payment in progress.
//
// Two scenarios:
//   (a) US3a — checkout sent → before card-tap, click Cancel → cart returns
//       to picker → choose Cash → ticket flips paid via cash flow. Stub
//       asserts `cancelCheckout` was called.
//   (b) US3b — Square stub primes getCheckout to return CANCELED with
//       failure_reason=declined → waiting screen advances to inline
//       failure → Try again creates a new pending row (per FR-015) → second
//       attempt stubs SUCCEEDED → Done.
//
// `describe` named "US3: Cancel and recover" so `-g "US3"` matches.

import { type Page, type BrowserContext } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

test.describe("US3: Cancel and recover", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US3 cancel spec.");
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

  test("US3a: cancel before card-tap → cart returns to picker → cash completes", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_CANCEL_A";
    await serverStub.setDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!, deviceId);

    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    // Feature 043: open a fresh ephemeral cart — the URL stays paramless
    // `/checkout` and nothing is persisted while the cart is built.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // Send to Square Terminal. Feature 043: this is the first payment-
    // initiating action — the cart is persisted and the URL gains a ticket
    // id; the card-waiting screen rehydrates from the persisted route.
    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;
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
    const checkoutId = pendingRow!.square_terminal_checkout_id!;

    // Prime the server-side cancel to return CANCELED so the action calls
    // the RPC and the row settles to failed/cancelled_by_operator.
    await serverStub.setCheckoutCancel(checkoutId, { responseStatus: "CANCELED" });

    // Click Cancel link inside the waiting screen.
    await page.locator("[data-slot='card-waiting-cancel']").click();

    // Cart returns to picker — the Cart heading is visible and so is the
    // payment-tile row again.
    await expect(page.locator("[data-slot='payment-tile'][data-method='card']")).toBeVisible({
      timeout: 6000,
    });

    // The row should now be failed/cancelled_by_operator.
    await expect
      .poll(
        async () => {
          const { data } = await supabase
            .from("payments")
            .select("status, failure_reason")
            .eq("id", pendingRow!.id)
            .single();
          return data?.status;
        },
        { timeout: 6000 }
      )
      .toBe("failed");

    // The cancel stub was consumed (proves cancelCheckout was actually called).
    const recorded = await serverStub.recordedCalls();
    const cancelCalls = recorded.filter(
      (c) => c.method === "POST" && c.path === `/v2/terminals/checkouts/${checkoutId}/cancel`
    );
    expect(cancelCalls.length).toBeGreaterThanOrEqual(1);

    // Pick Cash and complete.
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await page.locator("[data-slot='take-cash-button']").click();
    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });

    // Ticket flipped to paid.
    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    stub.assertNoLiveSquareCalls();
  });

  test("US3b: decline → inline failure → Try again creates new pending row → succeeds", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_CANCEL_B";
    await serverStub.setDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!, deviceId);

    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    // Feature 043: ephemeral cart — paramless `/checkout` while building.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // Send to Square Terminal — first payment-initiating action persists
    // the cart and the URL gains a ticket id.
    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

    const supabase = serviceClient();
    // Wait for the first attempt's pending row.
    let attemptCount = 0;
    let firstAttempt: { id: string; square_terminal_checkout_id: string | null } | null = null;
    while (attemptCount < 20 && !firstAttempt?.square_terminal_checkout_id) {
      const { data } = await supabase
        .from("payments")
        .select("id, square_terminal_checkout_id")
        .eq("ticket_id", ticketId)
        .eq("method", "card")
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      firstAttempt = data as { id: string; square_terminal_checkout_id: string | null } | null;
      if (firstAttempt?.square_terminal_checkout_id) break;
      await new Promise((r) => setTimeout(r, 200));
      attemptCount++;
    }
    expect(firstAttempt?.square_terminal_checkout_id).toBeTruthy();

    // Directly mark the first attempt's row failed/declined via the RPC.
    // The polling fallback path picks up the change and routes us to the
    // inline failure screen (within ~5s due to the poll cadence).
    const { error: rpcErr } = await supabase.rpc("pos_record_card_payment", {
      p_payment_id: firstAttempt!.id,
      p_new_status: "failed",
      p_tip_cents: 0,
      p_square_payment_id: null,
      p_raw: { kind: "test_decline" },
      p_failure_reason: "declined",
    });
    expect(rpcErr).toBeNull();

    // Inline failure UI appears.
    await expect(page.locator("[data-slot='card-failed']")).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("[data-slot='card-failed-title']")).toContainText(/Card declined/i);

    // Click Try again — second attempt inserts a fresh pending row.
    await page.locator("[data-slot='card-failed-retry']").click();
    await expect(page.locator("[data-slot='card-waiting']")).toBeVisible({ timeout: 10_000 });

    // Wait for the 2nd pending row + its checkoutId.
    attemptCount = 0;
    let secondAttempt: { id: string; square_terminal_checkout_id: string | null } | null = null;
    while (attemptCount < 20 && !secondAttempt?.square_terminal_checkout_id) {
      const { data } = await supabase
        .from("payments")
        .select("id, square_terminal_checkout_id")
        .eq("ticket_id", ticketId)
        .eq("method", "card")
        .eq("status", "pending")
        .neq("id", firstAttempt!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      secondAttempt = data as { id: string; square_terminal_checkout_id: string | null } | null;
      if (secondAttempt?.square_terminal_checkout_id) break;
      await new Promise((r) => setTimeout(r, 200));
      attemptCount++;
    }
    expect(secondAttempt).toBeTruthy();
    expect(secondAttempt!.id).not.toBe(firstAttempt!.id);

    // Settle the second attempt via the RPC (Square wins).
    const { error: rpcErr2 } = await supabase.rpc("pos_record_card_payment", {
      p_payment_id: secondAttempt!.id,
      p_new_status: "succeeded",
      p_tip_cents: 400,
      p_square_payment_id: `pay_${secondAttempt!.square_terminal_checkout_id}`,
      p_raw: { kind: "test_second_succeeded" },
      p_failure_reason: null,
    });
    expect(rpcErr2).toBeNull();

    await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 12_000 });

    // Both rows persist; ticket is paid.
    const { data: rows } = await supabase
      .from("payments")
      .select("id, status, failure_reason")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    expect(rows).toHaveLength(2);
    expect(rows![0].status).toBe("failed");
    expect(rows![0].failure_reason).toBe("declined");
    expect(rows![1].status).toBe("succeeded");

    const { data: ticketRow } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(ticketRow?.status).toBe("paid");

    stub.assertNoLiveSquareCalls();
  });

  // -----------------------------------------------------------------
  // (n) Phase 5 / US3 / T022 — Orphan-Order cancel happy path.
  //
  // Square accepts the itemized Order (`POST /v2/orders → 200`) but
  // then fails the Terminal checkout (`POST /v2/terminals/checkouts
  // → 500`). The action must best-effort cancel the orphan Order via
  // `PUT /v2/orders/:id` with `order.state === 'CANCELED'`, leave the
  // payment row `failed` (`square_unreachable`), and surface the same
  // `SquareCheckoutCreateFailedError` banner the operator sees today
  // ("Could not reach Square. Try again or pick a different method.").
  // -----------------------------------------------------------------
  test("(n) US3: terminal-checkout 500 after orders 200 → action cancels the orphan Order via PUT /v2/orders/:id", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();
    const deviceId = "device:STUB_CANCEL_N";
    await serverStub.setDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    await page.goto("/settings/square");
    await connectSquareViaStub(page, context, baseURL!, deviceId);

    const stub: SquareStub = await squareStub(context, baseURL!);
    stub.stubListDevices([{ id: deviceId, name: "Lobby Terminal", status: "PAIRED" }]);

    // Build a single-tender cart so `sendCardToTerminal` takes the
    // Phase 3 itemized branch (which mints the orphan Order Phase 5
    // must cancel).
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$25.00");

    // Arm the fault BEFORE the action runs. The orders.create call
    // still succeeds (default stub path) and mints `ord_stub_*`; the
    // very next terminals/checkouts POST responds with 500 so the
    // action's catch branch fires the orphan-cancel.
    await serverStub.failNextCheckoutCreate({ status: 500 });

    await page.locator("[data-slot='payment-tile'][data-method='card']").click();
    await page.locator("[data-slot='send-to-terminal-button']").click();

    // Operator-facing error banner appears on the picker. Note: in
    // dev + prod Server Action throws strip the error class identity
    // across the boundary, so `instanceof SquareCheckoutCreateFailedError`
    // on the client never matches and the banner falls through to the
    // generic copy on the bottom of the catch in
    // `checkout-screen.client.tsx`. This is the SAME text the operator
    // sees today for any `SquareCheckoutCreateFailedError` thrown by
    // `sendCardToTerminal` — Phase 5 must NOT change it (T022).
    await expect(page.locator("[data-slot='checkout-error-banner']")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("[data-slot='checkout-error-banner']")).toContainText(
      "Couldn’t start the card payment. Try again."
    );

    // The orphan-cancel hit the stub. Exactly one PUT against the
    // minted Order id, body carrying `order.state === 'CANCELED'`.
    const updates = await serverStub.recordedOrderUpdates();
    expect(updates.length).toBe(1);
    const updateBody = updates[0].body as { order?: { state?: string } } | null;
    expect(updateBody?.order?.state).toBe("CANCELED");

    // Sanity: the create recorder shows exactly one orders.create call —
    // proves the cancel targets the SAME Order id we minted (no
    // accidental second mint between the failure and the cancel).
    const creates = await serverStub.recordedOrderCreates();
    expect(creates.length).toBe(1);
    expect(updates[0].orderId).toBe(creates[0].responseOrderId);

    stub.assertNoLiveSquareCalls();
  });
});
