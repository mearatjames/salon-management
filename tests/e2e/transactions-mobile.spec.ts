// E2E for the phone-portrait transactions ledger (issue #168).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established)
// the dense transactions ledger tightens to a phone-first layout:
//   - no horizontal scroll at 375 / 430px;
//   - the whole surface scrolls as one column (`.tp-table-scroll` no longer
//     scrolls inside its own region the way it does on desktop);
//   - the 5-up KPI strip collapses to a 2-up grid;
//   - the filter row stacks full-width (search · method chips · tech/status);
//   - each `.tp-table` row restacks from a 9-column table row into a card via
//     `grid-template-areas` (issue option (b)) — every key field readable.
//
// Read-only + parallel-safe: it only signs in and inspects layout, asserting
// no global aggregate over a shared table, so it lives in the `main` project
// (not a serial baseline). Mirrors the Supabase-reachable guard + fixture
// sign-in pattern from `tests/e2e/dashboard-mobile.spec.ts`.

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

test.describe("#168-US1: phone-portrait transactions ledger", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #168 mobile specs (Docker unavailable)."
      );
    }
  });

  for (const width of PHONE_WIDTHS) {
    test(`(a) no horizontal scroll at ${width}px`, async ({ page, staffFixture }) => {
      await page.setViewportSize({ width, height: 900 });
      // Sign in (lands on /dashboard) then navigate to the owner/manager-only
      // ledger — mirrors `transactions.spec.ts`, which reaches the page the
      // same way rather than deep-linking through the `?next=` sign-in flow.
      await signInAs(page, staffFixture, staffFixture.owner);
      await page.goto("/transactions");

      // The App Router can leave a transient `aria-hidden` copy of the old
      // segment mid-transition, so scope to the live (non-hidden) page.
      await expect(page.locator(".tp-page:not([aria-hidden='true'])")).toBeVisible();

      const noHScroll = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth;
      });
      expect(noHScroll).toBe(true);
    });
  }

  test("(b) KPIs collapse to 2-up, search is full-width, and rows restack into cards", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAs(page, staffFixture, staffFixture.owner);
    await page.goto("/transactions");

    // Scope to the live (non-hidden) page — the App Router can leave a
    // transient `aria-hidden` copy of the old segment mid-transition.
    const live = page.locator(".tp-page:not([aria-hidden='true'])");
    await expect(live).toBeVisible();

    // The KPI strip collapses from 5-up to two columns.
    const kpiCols = await live
      .locator(".tp-kpis")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(kpiCols).toBe(2);

    // The search field spans the content width (viewport minus the 16px phone
    // gutters on each side).
    const searchWidth = await live
      .locator(".tp-search")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(searchWidth).toBeGreaterThanOrEqual(375 - 32 - 2);

    // Ledger rows (when the seeded period has any) use the phone card layout —
    // `grid-template-areas` is set, unlike the desktop table row which leaves
    // it `none`. Guarded on row presence so the test stays parallel-safe
    // regardless of what the shared `tickets` table holds this week.
    const firstRow = live.locator(".tp-table tbody tr").first();
    if ((await firstRow.count()) > 0) {
      const areas = await firstRow.evaluate((el) => getComputedStyle(el).gridTemplateAreas);
      expect(areas).not.toBe("none");
    }
  });
});
