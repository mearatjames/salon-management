// E2E for the phone-portrait dashboard layout (issue #161).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established)
// the dashboard tightens to a phone-first layout:
//   - no horizontal scroll at 375 / 430px;
//   - the whole surface scrolls as one column (the feed no longer scrolls
//     inside its own card the way it does on desktop — FR-012);
//   - the recent-transactions feed restacks from a 5-column grid into a
//     card-style row via `grid-template-areas`;
//   - the primary CTA spans the full content width.
//
// Read-only + parallel-safe: it only signs in and inspects layout, asserting
// no global aggregate over a shared table, so it lives in the `main` project
// (not a serial baseline). Mirrors the Supabase-reachable guard + fixture
// sign-in pattern from `tests/e2e/staff-mobile.spec.ts`.

import { test, expect, signInAs } from "./_fixtures";

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

// 375 (iPhone SE/13 mini) and 430 (iPhone 15 Pro Max) bracket the phone range
// the issue calls out.
const PHONE_WIDTHS = [375, 430] as const;

test.describe("#161-US1: phone-portrait dashboard layout", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #161 mobile specs (Docker unavailable)."
      );
    }
  });

  for (const width of PHONE_WIDTHS) {
    test(`(a) no horizontal scroll at ${width}px`, async ({ page, staffFixture }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/dashboard" });

      await expect(page.locator(".tx-landing")).toBeVisible();

      const noHScroll = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth;
      });
      expect(noHScroll).toBe(true);
    });
  }

  test("(b) the feed restacks into a card layout and the CTA is full-width", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/dashboard" });

    await expect(page.locator(".tx-landing")).toBeVisible();

    // The primary CTA spans the content width (viewport minus the 16px phone
    // gutters on each side).
    const ctaWidth = await page
      .locator(".tx-cta-primary")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(ctaWidth).toBeGreaterThanOrEqual(375 - 32 - 2);

    // The stat grid collapses to two columns.
    const statCols = await page
      .locator(".tx-stat-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(statCols).toBe(2);

    // Feed rows (when present) use the phone card layout — `grid-template-areas`
    // is set, unlike the desktop 5-column grid which leaves it `none`. Guarded
    // on row presence so the test stays parallel-safe regardless of what the
    // shared today-feed holds.
    const firstRow = page.locator(".tx-feed-row").first();
    if ((await firstRow.count()) > 0) {
      const areas = await firstRow.evaluate((el) => getComputedStyle(el).gridTemplateAreas);
      expect(areas).not.toBe("none");
    }
  });
});
