// E2E for the studio left navigation panel (specs/007-left-panel-nav).
//
// Uses the worker-scoped `authState` fixture (issue #42) — sign-in
// happens once per worker (in the fixture), tests land already
// authenticated on first `page.goto(...)`.
//
// DOM contract under test:
//   specs/007-left-panel-nav/contracts/nav-items.contract.md § 4.

import { expect, test } from "./_fixtures";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

// The nav items in render order — matches `NAV_CONFIG` in
// `components/lacquer/sidebar/nav-items.ts` and the table in
// `contracts/nav-items.contract.md` § 2. `transactions` is owner/manager
// only (feature 045); `report` is owner/manager only (feature 046) and sits
// in the Operations group before `settings`. This spec runs as owner so both
// role-gated items are present.
const EXPECTED_NAV_IDS = [
  "dashboard",
  "schedule",
  "clients",
  "services",
  "checkout",
  "transactions",
  "walkin",
  "end-of-day",
  "report",
  "settings",
] as const;

test.describe.configure({ mode: "serial" });

test.describe("Studio left navigation panel", () => {
  test("(1) sidebar landmark + all items render in expected order on /dashboard", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const aside = page.locator('aside[aria-label="Studio navigation"]');
    await expect(aside).toBeVisible();

    // Every item present.
    for (const id of EXPECTED_NAV_IDS) {
      await expect(aside.locator(`[data-nav-id="${id}"]`)).toBeVisible();
    }

    // Order matches NAV_CONFIG render order. Read every `data-nav-id` from
    // top-to-bottom and compare against the expected sequence.
    const renderedIds = await aside
      .locator("[data-nav-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(renderedIds).toEqual([...EXPECTED_NAV_IDS]);
  });

  test("(2) clicking Schedule navigates to /calendar; URL-driven active state highlights one item", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Click "Schedule" — the link must fire navigation to /calendar.
    await page.locator('[data-nav-id="schedule"]').click();
    await page.waitForURL(/\/calendar(\?|$)/);
    expect(new URL(page.url()).pathname).toBe("/calendar");

    // Active-state assertion is decoupled from `/calendar` because that route
    // has no `page.tsx` yet (placeholder per dashboard.spec.ts) and the
    // Next.js 404 fallback does not render the (studio) layout, so the
    // sidebar disappears once we land there. To keep the active-state check
    // anchored on a real (studio) page while still exercising the URL → item
    // mapping, navigate directly to `/dashboard` and assert exactly one item
    // is active. The `isActiveSection` helper is unit-tested for every
    // pathname/href combination in `tests/unit/sidebar/is-active-section.test.ts`.
    await page.goto("/dashboard");
    await expect(page.locator('[data-nav-id="dashboard"]')).toHaveAttribute("data-active", "true");

    const activeIds = await page
      .locator('aside[aria-label="Studio navigation"] [data-nav-id][data-active="true"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(activeIds).toEqual(["dashboard"]);
  });

  test("(3) visiting /settings/staff directly marks settings active (nested route)", async ({
    page,
  }) => {
    await page.goto("/settings/staff");

    await expect(page.locator('[data-nav-id="settings"]')).toHaveAttribute("data-active", "true");

    const activeIds = await page
      .locator('aside[aria-label="Studio navigation"] [data-nav-id][data-active="true"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(activeIds).toEqual(["settings"]);
  });

  test("(4) services nav item routes to /services and marks itself active", async ({ page }) => {
    await page.goto("/dashboard");

    const services = page.locator('[data-nav-id="services"]');
    // Wired entry — not disabled.
    await expect(services).toHaveAttribute("data-disabled", "false");
    await expect(services).not.toHaveAttribute("aria-disabled", "true");

    await services.click();
    await page.waitForURL(/\/services(\?|$)/);
    expect(new URL(page.url()).pathname).toBe("/services");

    // Active highlight transferred from dashboard to services.
    await expect(services).toHaveAttribute("data-active", "true");
    const activeIds = await page
      .locator('aside[aria-label="Studio navigation"] [data-nav-id][data-active="true"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(activeIds).toEqual(["services"]);
  });

  test("(5) collapse toggle resizes the sidebar and persists across reloads", async ({ page }) => {
    await page.goto("/dashboard");

    // Ensure we start expanded — the previous test in this serial run might
    // have left the panel collapsed via localStorage. Force the known state
    // before measuring so the test is independent.
    const initiallyCollapsed = await page.evaluate(
      () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "true"
    );
    if (initiallyCollapsed) {
      await page.getByRole("button", { name: /Expand sidebar/i }).click();
      await page.waitForFunction(
        () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "false"
      );
    }

    const aside = page.locator('aside[aria-label="Studio navigation"]');

    // Expanded baseline ~224px (±4 for borders).
    const expandedBox = await aside.boundingBox();
    expect(expandedBox).not.toBeNull();
    expect(Math.abs((expandedBox?.width ?? 0) - 224)).toBeLessThanOrEqual(4);

    // Collapse.
    await page.getByRole("button", { name: /Collapse sidebar/i }).click();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "true"
    );
    // CSS transition is 220ms ease-out; wait it out before measuring.
    await page.waitForTimeout(350);
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute("data-studio-sidebar-collapsed")
      )
    ).toBe("true");

    const collapsedBox = await aside.boundingBox();
    expect(collapsedBox).not.toBeNull();
    expect(Math.abs((collapsedBox?.width ?? 0) - 56)).toBeLessThanOrEqual(4);

    // Reload → still collapsed (no flash of expanded width).
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "true"
    );
    await page.waitForTimeout(350);
    const collapsedAfterReload = await aside.boundingBox();
    expect(Math.abs((collapsedAfterReload?.width ?? 0) - 56)).toBeLessThanOrEqual(4);

    // Expand again — the toggle button's aria-label flips to "Expand sidebar"
    // while collapsed.
    await page.getByRole("button", { name: /Expand sidebar/i }).click();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "false"
    );
    await page.waitForTimeout(350);
    const reExpanded = await aside.boundingBox();
    expect(Math.abs((reExpanded?.width ?? 0) - 224)).toBeLessThanOrEqual(4);

    // Reload → still expanded.
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-studio-sidebar-collapsed") === "false"
    );
    await page.waitForTimeout(350);
    const expandedAfterReload = await aside.boundingBox();
    expect(Math.abs((expandedAfterReload?.width ?? 0) - 224)).toBeLessThanOrEqual(4);
  });
});
