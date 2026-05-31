// E2E for the mobile (phone-portrait) End-of-Day surfaces. Issue #164.
//
// At the shared studio breakpoint (max-width: 640px) the three EOD pages
// collapse to one column:
//   - Cash count: the numpad is primary ("Count first"); the desktop
//     left-hand cash list is `display:none` and reached through a bottom
//     sheet opened by the `.eod-summary-bar` trigger.
//   - History list: the fixed-grid rows restack into cards.
//   - History detail: single column; the breakdown card no longer carries
//     a 320px min-width floor, so nothing scrolls sideways.
//
// Parallel-safe: read-only navigation plus a client-only sheet toggle —
// no DB mutation, no global-aggregate assertions. The cash-count page may
// render the open (numpad) OR closed (done-screen) state depending on the
// shared cash-drawer session, so the count assertions branch on which is
// present; either way the page must not scroll sideways at 375 / 430.
//
// Docker / Supabase availability: same probe pattern as the rest of the
// suite — skip when the local Supabase is unreachable.

import { type Page } from "@playwright/test";

import { test, expect } from "./_fixtures";

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

// No element should overflow the viewport horizontally. We check the
// document scroller plus the EOD scroll containers (each manages its own
// overflow). A 1px tolerance absorbs sub-pixel rounding.
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const offenders: { sel: string; scrollWidth: number; clientWidth: number }[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      offenders.push({
        sel: ":root",
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      });
    }
    for (const sel of [
      ".eod-right",
      ".eod-history-scroll",
      ".eod-detail-shell",
      ".eod-done",
      ".eod-sheet",
      ".eod-sheet .eod-left",
    ]) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) {
          offenders.push({ sel, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
        }
      });
    }
    return offenders;
  });
  expect(overflow, `horizontal overflow at ${JSON.stringify(overflow)}`).toEqual([]);
}

test.use({
  viewport: { width: 375, height: 812 },
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

test.describe("164-US: End-of-day mobile (375px)", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    test.skip(
      !supabaseUp,
      "Supabase not reachable at 127.0.0.1:54321 — skipping mobile EOD specs."
    );
  });

  test("cash count: numpad-first, no sideways scroll, cash list reached via bottom sheet", async ({
    page,
  }) => {
    await page.goto("/end-of-day");
    await page
      .locator("[data-slot='eod-cash-count'], [data-slot='eod-done-screen']")
      .first()
      .waitFor();

    await expectNoHorizontalScroll(page);

    const trigger = page.locator("[data-slot='eod-cash-sheet-trigger']");
    const open = await trigger.isVisible();

    if (open) {
      // OPEN state: numpad is primary and the desktop left list is hidden.
      await expect(page.locator("[data-slot='eod-numpad']")).toBeVisible();
      // The page-level cash list (left panel) exists but is collapsed on phone.
      expect(await page.locator(".eod-body > [data-slot='eod-cash-list']").isVisible()).toBe(false);

      // Open the sheet → the cash list inside it becomes visible and fits.
      await trigger.click();
      const scrim = page.locator("[data-slot='eod-cash-sheet-scrim']");
      await expect(scrim).toBeVisible();
      await expect(page.locator(".eod-sheet [data-slot='eod-cash-list']")).toBeVisible();
      await expectNoHorizontalScroll(page);

      // Close it again.
      await page.locator("[data-slot='eod-cash-sheet-close']").click();
      await expect(scrim).toHaveCount(0);
    } else {
      // CLOSED state: a prior close left the done screen — still must fit.
      await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible();
    }
  });

  test("history list: no sideways scroll; rows restack into cards", async ({ page }) => {
    await page.goto("/end-of-day/history");
    await expect(page.locator("[data-slot='eod-history-list']")).toBeVisible();

    await expectNoHorizontalScroll(page);

    const firstRow = page.locator("[data-slot='eod-history-row']").first();
    if (await firstRow.count()) {
      // Card layout stacks the row's children vertically.
      const flexDir = await firstRow.evaluate((el) => getComputedStyle(el).flexDirection);
      expect(flexDir).toBe("column");
    }
  });

  test("history detail: single column, breakdown card fits the viewport", async ({ page }) => {
    await page.goto("/end-of-day/history");
    const firstRow = page.locator("[data-slot='eod-history-row']").first();
    test.skip((await firstRow.count()) === 0, "No closed sessions seeded — nothing to drill into.");

    await firstRow.click();
    await expect(page.locator("[data-slot='eod-history-detail']")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
