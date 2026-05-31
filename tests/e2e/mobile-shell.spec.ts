// E2E for the responsive studio shell (Issue #160).
//
// Below the shared phone breakpoint (max-width: 640px) the persistent sidebar
// is replaced by a hamburger in the topbar that opens an off-canvas drawer.
// Above it, the shell is unchanged. These tests verify both halves of that
// switch plus the drawer's keyboard / screen-reader behaviour.
//
// Read-only (navigation only) — uses the worker-scoped owner `authState`, picks
// no staff by name, mutates nothing. Sets its own viewport per describe block.

import { expect, test } from "./_fixtures";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

async function hasNoHorizontalScroll(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth <= el.clientWidth;
  });
}

test.describe("Responsive studio shell — phone portrait (375px)", () => {
  test.use({ viewport: { width: 375, height: 760 } });

  test("(1) no horizontal scroll; sidebar hidden, hamburger shown", async ({ page }) => {
    await page.goto("/dashboard");

    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await expect(page.locator("aside.studio-sidebar")).toBeHidden();
    await expect(page.locator(".studio-topbar-hamburger")).toBeVisible();

    // Topbar controls condense — the switch-staff label and operator name drop
    // out so nothing overflows the bar.
    await expect(page.locator(".studio-switch-staff-label")).toBeHidden();
    await expect(page.locator(".studio-operator-name")).toBeHidden();
  });

  test("(2) hamburger opens the drawer; a nav tap navigates and closes it", async ({ page }) => {
    await page.goto("/dashboard");

    const drawer = page.locator(".studio-drawer");
    await expect(drawer).toBeHidden();

    await page.locator(".studio-topbar-hamburger").click();
    await expect(drawer).toBeVisible();

    // Focus moves into the drawer when it opens.
    const focusInDrawer = await page.evaluate(() => {
      const d = document.querySelector(".studio-drawer");
      return !!d && d.contains(document.activeElement);
    });
    expect(focusInDrawer).toBe(true);

    // Tapping a nav item navigates and dismisses the drawer.
    await drawer.locator('a[href="/services"]').click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(drawer).toBeHidden();
  });

  test("(3) scrim tap closes the drawer", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator(".studio-topbar-hamburger").click();
    await expect(page.locator(".studio-drawer")).toBeVisible();

    // The scrim covers the viewport; click near a corner away from the drawer.
    await page.locator(".studio-scrim").click({ position: { x: 350, y: 700 } });
    await expect(page.locator(".studio-drawer")).toBeHidden();
  });

  test("(4) Escape closes the drawer and restores focus to the hamburger", async ({ page }) => {
    await page.goto("/dashboard");

    const hamburger = page.locator(".studio-topbar-hamburger");
    await hamburger.click();
    await expect(page.locator(".studio-drawer")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".studio-drawer")).toBeHidden();
    await expect(hamburger).toBeFocused();
  });

  test("(5) the drawer is an accessible modal dialog", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator(".studio-topbar-hamburger").click();

    const dialog = page.getByRole("dialog", { name: "Studio navigation" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".studio-topbar-hamburger")).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("Responsive studio shell — smallest target (430px)", () => {
  test.use({ viewport: { width: 430, height: 760 } });

  test("(6) no horizontal scroll, drawer still operable", async ({ page }) => {
    await page.goto("/dashboard");

    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await page.locator(".studio-topbar-hamburger").click();
    await expect(page.locator(".studio-drawer")).toBeVisible();
  });
});

test.describe("Responsive studio shell — desktop unchanged (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("(7) persistent sidebar shown, hamburger and drawer hidden", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.locator("aside.studio-sidebar")).toBeVisible();
    await expect(page.locator(".studio-topbar-hamburger")).toBeHidden();
    await expect(page.locator(".studio-drawer")).toBeHidden();
  });
});
