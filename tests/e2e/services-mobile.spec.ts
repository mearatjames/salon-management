import { test, expect } from "@playwright/test";

import { signInAs } from "./_auth";

// Phone-portrait viewport. The Services surface flips to a master → detail
// flow at `max-width: 640px` (issue #167): the catalog list and the edit
// panel each own the full viewport one at a time, driven by the
// `[data-panel-mode]` attribute on `.services-two-pane`.
const PHONE = { width: 390, height: 844 };

// Widths the acceptance criteria call out explicitly (375 / 430) plus the
// 390 default. None should produce horizontal overflow.
const NO_SCROLL_WIDTHS = [375, 390, 430];

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe("US: services catalog master → detail on phone portrait", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, "owner");
  });

  test("list mode shows the catalog full-screen; the edit panel is hidden", async ({ page }) => {
    await page.goto("/services");
    await page.waitForLoadState("networkidle");

    // Closed (list) mode: the two-pane shell reports no selection.
    await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "closed");

    // The catalog list fills the view; the edit panel is removed from flow.
    await expect(page.locator('[data-slot="services-list"]')).toBeVisible();
    await expect(page.locator('[data-slot="services-edit-panel"]')).toBeHidden();

    // The catalog aggregate ("X active · Y total") stays visible in list mode.
    await expect(page.locator('[data-slot="services-page-header"]')).toBeVisible();
  });

  test("tapping a service opens the editor full-screen; back returns to the list", async ({
    page,
  }) => {
    await page.goto("/services");
    await page.waitForLoadState("networkidle");

    // Tap the first catalog row to open its editor.
    await page.locator(".service-list-row").first().click();

    // Detail mode: the editor fills the view, the catalog list is hidden.
    await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "edit");
    await expect(page.locator('[data-slot="services-edit-panel"]')).toBeVisible();
    await expect(page.locator('[data-slot="services-list"]')).toBeHidden();

    // The sticky footer (Archive / Cancel / Save) is reachable — visible and
    // pinned within the viewport, not pushed below the fold.
    const footer = page.locator('[data-slot="services-edit-panel-footer"]');
    await expect(footer).toBeVisible();
    const box = await footer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height + 1);

    // The phone back affordance returns to the catalog list.
    const backBtn = page.locator(".services-edit-panel__backbar-btn");
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "closed");
    await expect(page.locator('[data-slot="services-list"]')).toBeVisible();
  });

  for (const width of NO_SCROLL_WIDTHS) {
    test(`no horizontal scroll at ${width}px in list and detail modes`, async ({ page }) => {
      await page.setViewportSize({ width, height: PHONE.height });

      // List mode.
      await page.goto("/services");
      await page.waitForLoadState("networkidle");
      let doc = await horizontalOverflow(page);
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

      // Detail mode.
      await page.locator(".service-list-row").first().click();
      await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "edit");
      doc = await horizontalOverflow(page);
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
    });
  }
});
