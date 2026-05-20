// tests/e2e/gift-card-errors.spec.ts
//
// US1 edge cases — each GAN suffix exercises a distinct error UI surface:
//   - 9999 → NOT_FOUND   → "Gift card not found"
//   - BLKD → BLOCKED     → "This gift card is blocked"
//   - PEND → PENDING     → "still pending activation"
//   - DEAC → DEACTIVATED → "deactivated"
//   - 0000 → ZERO_BALANCE→ "$0.00 available"
//
// Each branch asserts:
//   1. The distinct UI copy is rendered.
//   2. No `payments` row is created for the ticket (no draft, no pending,
//      no succeeded — lookup-only path).
//   3. The cursor sees exactly one `gift_card.balance_looked_up` audit row
//      and no `payment.draft_created` / `gift_card.redeemed` rows.

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

async function typeGanIntoNumpad(page: Page, ganChars: string): Promise<void> {
  for (const ch of ganChars) {
    if (/[0-9]/.test(ch)) {
      await page.getByRole("button", { name: `Digit ${ch}` }).click();
    } else {
      await page.keyboard.press(ch);
    }
  }
}

// Feature 043: build an ephemeral $40 cart. These error variants never
// tap "Redeem" — they only exercise the read-only GAN lookup — so no
// ticket is ever persisted. The URL stays paramless `/checkout`.
async function openEphemeralCheckoutWithFortyDollarService(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.locator("[data-slot='new-transaction-cta']").click();
  await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
  await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Sam Chen']").click();
  await page
    .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000003']")
    .click();
  await expect(page.locator("[data-slot='checkout-total-amount']")).toHaveText("$40.00");
}

test.describe.configure({ mode: "serial" });

test.describe("US1: gift card errors", () => {
  let supabaseUp = false;
  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping US1 gift-card-errors spec.");
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
    await serverStub.setDevices([{ id: "device:STUB_GIFT_ERR", name: "Lobby", status: "PAIRED" }]);
    await serverStub.setWebhookBaseUrl(baseURL ?? "http://127.0.0.1:3000");
    await clearSquareTables();
  });

  for (const variant of [
    {
      label: "NOT_FOUND (suffix 9999) shows 'Gift card not found'",
      ganDigits: "6000123456789999",
      expectSlot: "[data-slot='gift-card-balance-not-found']",
      expectText: /Gift card not found/i,
    },
    {
      label: "BLOCKED (suffix BLKD) shows 'blocked' copy",
      ganDigits: "600012345678BLKD",
      expectSlot: "[data-slot='gift-card-balance-not-redeemable']",
      expectText: /blocked/i,
    },
    {
      label: "PENDING (suffix PEND) shows 'still pending activation' copy",
      ganDigits: "600012345678PEND",
      expectSlot: "[data-slot='gift-card-balance-not-redeemable']",
      expectText: /still pending activation/i,
    },
    {
      label: "DEACTIVATED (suffix DEAC) shows 'deactivated' copy",
      ganDigits: "600012345678DEAC",
      expectSlot: "[data-slot='gift-card-balance-not-redeemable']",
      expectText: /deactivated/i,
    },
    {
      label: "ZERO_BALANCE (suffix 0000) shows '$0.00 available'",
      ganDigits: "6000123456780000",
      expectSlot: "[data-slot='gift-card-balance-zero']",
      expectText: /\$0\.00/i,
    },
  ]) {
    test(`US1 ${variant.label}`, async ({ page, context, baseURL }) => {
      if (!supabaseUp) test.skip();
      const cursor = newAuditCursor();

      await page.goto("/settings/square");
      await connectSquareViaStub(page, context, baseURL!);

      const stub: SquareStub = await squareStub(context, baseURL!);
      stub.stubListDevices([{ id: "device:STUB_GIFT_ERR", name: "Lobby", status: "PAIRED" }]);

      await openEphemeralCheckoutWithFortyDollarService(page);

      // Open gift flow.
      await page.locator("[data-slot='payment-tile'][data-method='gift']").click();
      await expect(page.locator("[data-slot='gan-numpad-sheet']")).toBeVisible({
        timeout: 5_000,
      });

      await typeGanIntoNumpad(page, variant.ganDigits);
      await page.locator("[data-slot='gan-numpad-submit']").click();

      // Assert the distinct UI copy renders.
      await expect(page.locator(variant.expectSlot)).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(variant.expectSlot)).toContainText(variant.expectText);

      // Feature 043: the GAN lookup is read-only — no Redeem tapped, so no
      // ticket is persisted. The URL stays paramless `/checkout` — a
      // per-page signal that no payment-initiating action ran (the client
      // only `router.replace`s to `/checkout/[id]` once a ticket is
      // persisted). This holds regardless of what parallel workers do to
      // the shared DB, unlike a global `audit_log` row-count.
      expect(new URL(page.url()).pathname).toBe("/checkout");

      // Audit cursor: exactly one balance_looked_up; no payment composed
      // or redeemed for this gift card.
      const rows = await getAuditLogRowsSince(cursor);
      const actions = rows.map((r) => r.action);
      expect(actions.filter((a) => a === "gift_card.balance_looked_up").length).toBe(1);
      expect(actions).not.toContain("payment.draft_created");
      expect(actions).not.toContain("gift_card.redeemed");

      stub.assertNoLiveSquareCalls();
    });
  }
});
