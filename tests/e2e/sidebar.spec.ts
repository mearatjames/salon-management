// E2E for the studio left navigation panel (specs/007-left-panel-nav).
//
// Docker / Supabase availability: same probe pattern as the rest of the suite
// (auth.spec.ts, staff.spec.ts). Without Docker the local Supabase is
// offline, so each describe block skips itself rather than failing.
//
// Reuses the seeded `owner@tangnails.dev` device login + Maya Patel (PIN
// 1234) operator pattern; same as `tests/e2e/staff.spec.ts`. The sidebar
// renders on every (studio) page so any signed-in route works as the landing
// pad.
//
// DOM contract under test:
//   specs/007-left-panel-nav/contracts/nav-items.contract.md § 4.

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

// Reuses the seeded `owner@tangnails.dev` / `tang-nails-dev` device login,
// then pins in as Maya Patel (PIN 1234) — identical to `tests/e2e/staff.spec.ts`.
async function signInAsMaya(
  page: import("@playwright/test").Page,
  next = "/dashboard"
): Promise<void> {
  const encodedNext = encodeURIComponent(next);
  await page.goto(`/login?next=${encodedNext}`);
  await page.locator("#email").fill("owner@tangnails.dev");
  await page.getByLabel("Password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
  // After PIN entry the redirect carries us to the `next` URL.
  const nextRegex = new RegExp(`${next.replace(/[/\-]/g, "\\$&")}(\\?|$)`);
  await page.waitForURL(nextRegex, { timeout: 10_000 });
}

// The 9 nav items in render order — matches `NAV_CONFIG` in
// `components/lacquer/sidebar/nav-items.ts` and the table in
// `contracts/nav-items.contract.md` § 2.
const EXPECTED_NAV_IDS = [
  "dashboard",
  "schedule",
  "clients",
  "services",
  "checkout",
  "walkin",
  "end-of-day",
  "day-report",
  "settings",
] as const;

test.describe.configure({ mode: "serial" });

test.describe("Studio left navigation panel", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping sidebar specs (Docker unavailable)."
      );
      return;
    }
  });

  test("(1) sidebar landmark + 9 items render in expected order on /dashboard", async ({
    page,
  }) => {
    await signInAsMaya(page, "/dashboard");

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
    await signInAsMaya(page, "/dashboard");

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
    await signInAsMaya(page, "/settings/staff");

    await expect(page.locator('[data-nav-id="settings"]')).toHaveAttribute("data-active", "true");

    const activeIds = await page
      .locator('aside[aria-label="Studio navigation"] [data-nav-id][data-active="true"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-id")));
    expect(activeIds).toEqual(["settings"]);
  });

  test("(4) services placeholder is aria-disabled + data-disabled and does not navigate", async ({
    page,
  }) => {
    await signInAsMaya(page, "/dashboard");

    const services = page.locator('[data-nav-id="services"]');
    await expect(services).toHaveAttribute("aria-disabled", "true");
    await expect(services).toHaveAttribute("data-disabled", "true");

    const before = new URL(page.url()).pathname;
    await services.click();
    // Give the router a tick to confirm nothing changed.
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe(before);
  });

  test("(5) collapse toggle resizes the sidebar and persists across reloads", async ({ page }) => {
    await signInAsMaya(page, "/dashboard");

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
