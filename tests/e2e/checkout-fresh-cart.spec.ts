// tests/e2e/checkout-fresh-cart.spec.ts
//
// Feature 043-checkout-ephemeral-draft — User Story 3:
// "Checkout always opens a fresh cart."
//
// Resume — today's "reopen your most-recent same-day open ticket" — is
// removed entirely. Every entry to /checkout opens a fresh, empty,
// ephemeral in-memory draft cart:
//   - the sidebar "Checkout" nav link → paramless /checkout, empty cart
//   - the dashboard "New transaction" CTA → paramless /checkout, empty cart
//   - building a partial cart then navigating away and returning → the
//     prior contents are gone (the draft lived only in page memory)
//   - refreshing /checkout mid-build → cart cleared, fresh empty cart
//   - a second operator on the same shared device → a fresh empty cart
//     with no trace of the first operator's cart
//
// This spec replaces the old checkout-resume.spec.ts: the resume server
// action (`resumeOrCreateTicket`) and the `?fresh=1` dispatch are gone,
// so all of that spec's "most-recently-updated open ticket wins"
// assertions no longer describe the product and have been deleted.
//
// "Empty cart" is asserted per-page (race-free against parallel workers
// sharing the local Supabase): the cart-line list
// (`[data-slot='cart-line']`) has count 0 and the checkout shell carries
// `data-ephemeral="true"`. No DB row-count assertions are needed —
// the ephemeral draft writes nothing until "Take cash".
//
// Describe name uses "US3" so `-g "US3"` filters this spec.

import { expect, test } from "./_fixtures";

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

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

/**
 * Assert the checkout screen shows a fresh, empty ephemeral cart: the
 * shell is in ephemeral mode and there are zero cart lines.
 */
async function expectFreshEmptyCart(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("[data-slot='checkout-shell']")).toHaveAttribute(
    "data-ephemeral",
    "true"
  );
  await expect(page.locator("[data-slot='cart-line']")).toHaveCount(0);
}

/**
 * Build a partial cart: pick the seeded tech Jordan Lee, then add one
 * service tile. Leaves the screen with exactly one cart line.
 */
async function buildPartialCart(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
  await page
    .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
    .click();
  await expect(page.locator("[data-slot='cart-line']")).toHaveCount(1);
}

test.describe.configure({ mode: "serial" });

test.describe("US3: checkout always opens a fresh cart", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 fresh-cart spec (Docker unavailable)."
      );
    }
  });

  test("(a) sidebar Checkout link → paramless /checkout, fresh empty cart", async ({ page }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // The sidebar renders an anchor with href="/checkout" (no query) per
    // components/lacquer/sidebar/nav-items.ts. Clicking it lands on the
    // paramless /checkout — no /checkout/[ticketId] redirect.
    await page.locator('aside.studio-sidebar a[href="/checkout"]').first().click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/checkout");

    await expectFreshEmptyCart(page);
  });

  test("(b) dashboard 'new sale' CTA → paramless /checkout, fresh empty cart", async ({ page }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/checkout");

    await expectFreshEmptyCart(page);
  });

  test("(c) build a partial cart, go to /dashboard and back → fresh empty cart", async ({
    page,
  }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // Build a partial cart so there is something that could leak.
    await buildPartialCart(page);

    // Navigate away — the ephemeral draft is discarded with the page.
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // Return to checkout — the prior contents must be gone.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expectFreshEmptyCart(page);
  });

  test("(d) refresh /checkout mid-build → cart cleared, fresh empty cart", async ({ page }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // Build a partial cart, then refresh — the in-memory draft is dropped.
    await buildPartialCart(page);
    await page.reload();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    await expectFreshEmptyCart(page);
  });

  test("(e) a second operator on the same device → fresh empty cart, no residue", async ({
    browser,
    authState,
  }) => {
    if (!supabaseUp) test.skip();

    // Operator one (owner) opens checkout and builds a partial cart.
    const ownerContext = await browser.newContext({ storageState: authState.owner });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/dashboard");
    await ownerPage.locator("[data-slot='new-transaction-cta']").click();
    await ownerPage.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await buildPartialCart(ownerPage);
    await ownerContext.close();

    // Operator two (manager) signs in on the same shared device and opens
    // checkout — they must see a fresh empty cart with no trace of the
    // first operator's in-progress cart. The ephemeral draft never left
    // operator one's browser memory, so there is nothing to inherit.
    const managerContext = await browser.newContext({ storageState: authState.manager });
    const managerPage = await managerContext.newPage();
    await managerPage.goto("/dashboard");
    await managerPage.locator("[data-slot='new-transaction-cta']").click();
    await managerPage.waitForURL(/\/checkout$/, { timeout: 10_000 });
    expect(new URL(managerPage.url()).pathname).toBe("/checkout");
    await expectFreshEmptyCart(managerPage);
    await managerContext.close();
  });
});
