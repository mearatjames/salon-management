// E2E for the phone-portrait payroll surfaces (issue #165).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established)
// the two payroll surfaces — the `/payroll` period overview and the
// `/payroll/[staffId]` tech detail — restack for phone:
//   - no horizontal scroll of the whole page at 375 / 430px (the only
//     permitted local scroll is the dense daily chart on the detail screen);
//   - the page flows as one column (`.pr-app.dr-app-page` drops its desktop
//     `height/overflow` so it no longer scrolls inside its own region);
//   - the 5-up `.pr-kpis` band collapses to a 2-up grid;
//   - each `.pl-table` `tr.pl-row-link` restacks from a 12-column table row
//     into a card (issue option (b)) — `display` flips table-row → grid;
//   - the detail `.pp-detail-grid` two-column (`1fr 360px`) layout becomes a
//     single column.
//
// Read-only + parallel-safe: it only signs in and inspects layout, asserting
// no global aggregate over a shared table, so it lives in the `main` project
// (not a serial baseline). Mirrors the Supabase-reachable guard + fixture
// sign-in pattern from `tests/e2e/transactions-mobile.spec.ts`.

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

// The overview page is `.pr-app.dr-app-page`; the detail screen adds
// `.pp-detail-screen`. The App Router can leave a transient `aria-hidden` copy
// of the old segment mid-transition, so every page-root selector excludes it.
const OVERVIEW_ROOT = ".pr-app.dr-app-page:not(.pp-detail-screen):not([aria-hidden='true'])";
const DETAIL_ROOT = ".pr-app.pp-detail-screen:not([aria-hidden='true'])";

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(
      true,
      "Supabase not reachable at 127.0.0.1:54321 — skipping #165 mobile specs (Docker unavailable)."
    );
  }
});

test.describe("#165-US1: phone-portrait payroll ledger", () => {
  for (const width of PHONE_WIDTHS) {
    test(`no horizontal scroll at ${width}px`, async ({ page, staffFixture }) => {
      await page.setViewportSize({ width, height: 900 });
      // Sign in (lands on /dashboard) then navigate to the owner/manager-only
      // payroll overview — mirrors `payroll.spec.ts`, which reaches the page the
      // same way rather than deep-linking through the `?next=` sign-in flow.
      await signInAs(page, staffFixture, staffFixture.owner);
      await page.goto("/payroll");

      await expect(page.locator(OVERVIEW_ROOT)).toBeVisible();

      const noHScroll = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth;
      });
      expect(noHScroll).toBe(true);
    });
  }

  test("KPIs collapse to 2-up and ledger rows restack into cards", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAs(page, staffFixture, staffFixture.owner);
    await page.goto("/payroll");

    const live = page.locator(OVERVIEW_ROOT);
    await expect(live).toBeVisible();

    // The KPI band collapses from 5-up to two columns.
    const kpiCols = await live
      .locator(".pr-kpis")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(kpiCols).toBe(2);

    // Each ledger row restacks from a table row into a phone card — `display`
    // flips from the desktop `table-row` to `grid`. Guarded on row presence so
    // the test stays parallel-safe regardless of what the shared `staff` /
    // `tickets` tables hold this period.
    const firstRow = live.locator(".pl-table tbody tr.pl-row-link").first();
    if ((await firstRow.count()) > 0) {
      const display = await firstRow.evaluate((el) => getComputedStyle(el).display);
      expect(display).toBe("grid");
    }
  });
});

test.describe("#165-US2: phone-portrait tech detail", () => {
  test("detail page has no horizontal scroll and stacks to one column at 375px", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAs(page, staffFixture, staffFixture.owner);
    await page.goto("/payroll");

    const overview = page.locator(OVERVIEW_ROOT);
    await expect(overview).toBeVisible();

    // Tap through to the first technician's detail via the stretched row
    // <Link> (the whole card is the tap target after the restack).
    const firstRowLink = overview.locator("a[data-slot='ledger-row-link']").first();
    if ((await firstRowLink.count()) === 0) {
      test.skip(true, "No ledger rows in the seeded period — nothing to drill into.");
      return;
    }
    await firstRowLink.click();

    const detail = page.locator(DETAIL_ROOT);
    await expect(detail).toBeVisible();
    await expect(page).toHaveURL(/\/payroll\/[^/]+/);

    // The whole page must not scroll horizontally — only the dense daily chart
    // is permitted its own local scroll, which doesn't widen the document.
    const noHScroll = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth <= de.clientWidth;
    });
    expect(noHScroll).toBe(true);

    // The `1fr 360px` two-column grid collapses to a single column.
    const gridCols = await detail
      .locator(".pp-detail-grid")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(gridCols).toBe(1);
  });
});
