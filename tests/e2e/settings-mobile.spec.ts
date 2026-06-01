// E2E for the phone-portrait Settings shell + form sub-pages (issue #169).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established):
//   - the settings tab bar (Staff · Onboarding · Square) becomes a horizontal
//     scroller and the TabBar client island scrolls the active tab into view
//     on navigation;
//   - the onboarding roster rows drop their 5-column desktop grid and reflow
//     across three rows so nothing overflows;
//   - every settings sub-page fits within the viewport with no horizontal
//     scroll.
//
// Read-only + parallel-safe: it signs in as the seeded owner, navigates, and
// inspects layout — it asserts no global aggregate over a shared table and
// mutates nothing, so it lives in the `main` project (not a serial baseline).
// Mirrors the Supabase-reachable guard + sign-in pattern from
// `tests/e2e/services-mobile.spec.ts`.

import { expect, test } from "@playwright/test";

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

// Maya is the seeded owner (display "Maya Patel", PIN 1234, owner@tangnails.dev).
// Sign in and land on the dashboard; the individual tests `goto` the settings
// sub-page they exercise (deep-linking owner-gated pages via `next=` is flakier
// than sign-in-then-goto).
async function signInAsMaya(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fdashboard");
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  const modal = page.getByRole("dialog");
  await modal.waitFor({ state: "visible" });
  await modal.getByRole("button", { name: "Digit 1", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 2", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 3", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 4", exact: true }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });
}

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

// Phone-portrait default plus the two widths the acceptance criteria call out
// explicitly (375 = iPhone SE/13 mini, 430 = iPhone 15 Pro Max).
const PHONE = { width: 390, height: 844 };
const NO_SCROLL_WIDTHS = [375, 390, 430] as const;

// Every settings sub-page Maya (owner) can reach. The index redirects to staff.
const SUB_PAGES = [
  { path: "/settings/staff", ready: ".staff-row, .settings-staff-roster" },
  { path: "/settings/onboarding", ready: ".onb-page" },
  { path: "/settings/square", ready: '[data-slot="square-settings-page"]' },
] as const;

test.describe("#169: settings shell + form sub-pages on phone portrait", () => {
  test.use({ viewport: PHONE });

  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #169 mobile specs (Docker unavailable)."
      );
    }
  });

  for (const width of NO_SCROLL_WIDTHS) {
    test(`no horizontal scroll on every settings sub-page at ${width}px`, async ({ page }) => {
      await signInAsMaya(page);
      await page.setViewportSize({ width, height: PHONE.height });

      for (const { path, ready } of SUB_PAGES) {
        await page.goto(path);
        // Wait for the page's own content to render before measuring — prod
        // cold paths can be slow under parallel load.
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 15_000 });
        const doc = await horizontalOverflow(page);
        expect(doc.scrollWidth, `${path} overflows horizontally at ${width}px`).toBeLessThanOrEqual(
          doc.clientWidth + 1
        );
      }
    });
  }

  test("the active tab is scrolled into view on the rightmost (Square) tab", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/square");

    const tabBar = page.locator(".settings-tab-bar");
    const activeTab = tabBar.locator('[data-active="true"]');
    await expect(activeTab).toHaveText("Square");

    // The active tab sits within the tab bar's visible box (the scroller has
    // brought it into view rather than leaving it clipped past the right edge).
    const barBox = await tabBar.boundingBox();
    const tabBox = await activeTab.boundingBox();
    expect(barBox).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect(tabBox!.x).toBeGreaterThanOrEqual(barBox!.x - 1);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width + 1);
  });

  test("all settings tabs are reachable in the bar", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff");

    const tabBar = page.locator(".settings-tab-bar");
    // Every tab label is present in the DOM (the bar is a horizontal scroller
    // at this width, so any tab past the edge is reachable by scrolling).
    for (const label of ["Staff", "Onboarding", "Square"]) {
      await expect(tabBar.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });
});
