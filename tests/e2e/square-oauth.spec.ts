// tests/e2e/square-oauth.spec.ts
//
// US1 — Connect Square — end-to-end journey:
//   1. Start unconnected, navigate to /settings/square.
//   2. Click "Connect Square". The Server Action returns Square's authorize
//      URL.
//   3. Playwright's context.route intercepts the browser navigation to
//      `connect.squareupsandbox.com/oauth2/authorize` and synthesizes a
//      302 redirect back to /settings/square/callback?code=fake&state=<original>.
//   4. The server-side OAuth callback handler exchanges the (stubbed) code
//      against our local HTTP stub (SQUARE_API_BASE_URL=http://127.0.0.1:4567),
//      persists encrypted tokens, fires `integration.square_connected`,
//      lists devices, and lands on /settings/square?connected=1.
//   5. Two devices appear. Rename device 1 to "Front desk", mark it default.
//   6. Reload — assertions persist.
//   7. Click Disconnect → confirm. The connection is gone; the unconnected
//      CTA reappears. `select count(*) from square_oauth` returns 0.
//   8. The audit log shows the four expected verbs in order.

import { expect, test, type Page } from "@playwright/test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
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

async function signInAsMaya(page: Page): Promise<void> {
  await page.goto("/login?next=%2Fsettings%2Fsquare");
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
  await page.waitForURL(/\/settings\/square(\?|$)/, { timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("US1: Connect Square", () => {
  let supabaseUp = false;
  let stub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US1 Square OAuth spec.");
      return;
    }
    await acquireStubLock();
    stub = getStubControls();
  });

  test.afterAll(async () => {
    releaseStubLock();
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await stub.reset();
    await stub.setMerchant({ id: "MERCHANT_STUB", business_name: "Stub Salon" });
    await stub.setDevices([
      { id: "device:STUB_AAA", name: "Lobby Terminal", status: "PAIRED" },
      { id: "device:STUB_BBB", name: "Back Room Terminal", status: "PAIRED" },
    ]);
    await clearSquareTables();
  });

  test("connect → rename → default → disconnect, four audit verbs in order", async ({
    page,
    context,
    baseURL,
  }) => {
    if (!supabaseUp) test.skip();

    const cursor = newAuditCursor();

    // Intercept the browser navigation to Square's authorize page and
    // synthesize the redirect Square would normally do back to our
    // callback. The Server-side server stub then handles the token
    // exchange.
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

    await signInAsMaya(page);

    // 1) Unconnected CTA visible.
    await expect(page.getByTestId("square-connect-button")).toBeVisible();

    // 2) Click Connect → end up on /settings/square?connected=1 with the
    //    "Connected to Stub Salon" header + 2 device rows.
    await page.getByTestId("square-connect-button").click();
    await page.waitForURL(/\/settings\/square(\?|$)/, { timeout: 15_000 });

    await expect(page.getByText(/Connected to Stub Salon/i)).toBeVisible({ timeout: 10_000 });
    const lobbyRow = page.getByTestId("square-device-row-device:STUB_AAA");
    const backRow = page.getByTestId("square-device-row-device:STUB_BBB");
    await expect(lobbyRow).toBeVisible();
    await expect(backRow).toBeVisible();

    // 3) Rename device 1 to "Front desk".
    const lobbyInput = lobbyRow.getByRole("textbox");
    await lobbyInput.click();
    await lobbyInput.fill("Front desk");
    // Force a blur on the active element — fires the onBlur handler that
    // invokes renameDevice via useTransition. `press("Tab")` does not
    // reliably blur a focused input when the next focusable sibling is a
    // disabled or radio element in some Chromium builds.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await expect(page.getByText(/Device renamed\./i)).toBeVisible({ timeout: 10_000 });

    // 4) Mark it default.
    await page.getByTestId("square-device-default-device:STUB_AAA").click();
    await expect(page.getByText(/Default terminal updated\./i)).toBeVisible({ timeout: 5000 });

    // 5) Reload and confirm persistence.
    await page.reload();
    await expect(lobbyRow.getByRole("textbox")).toHaveValue("Front desk");
    await expect(page.getByTestId("square-device-default-device:STUB_AAA")).toBeChecked();

    // 6) Click Disconnect → confirm.
    await page.getByTestId("square-disconnect-button").click();
    await page.getByTestId("square-disconnect-confirm").click();
    await expect(page.getByText(/Square disconnected\./i)).toBeVisible({ timeout: 5000 });

    // 7) Unconnected CTA returns.
    await expect(page.getByTestId("square-connect-button")).toBeVisible({ timeout: 5000 });

    const c = serviceClient();
    const { count } = await c.from("square_oauth").select("*", { count: "exact", head: true });
    expect(count).toBe(0);

    // 8) Audit verbs in order.
    const rows = await getAuditLogRowsSince(cursor);
    const squareRows = rows.filter((r) => r.action.startsWith("integration.square"));
    const actions = squareRows.map((r) => r.action);
    expect(actions).toEqual([
      "integration.square_connected",
      "integration.square_device_renamed",
      "integration.square_device_default_set",
      "integration.square_disconnected",
    ]);
  });
});
