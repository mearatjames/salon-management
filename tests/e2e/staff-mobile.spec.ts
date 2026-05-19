// E2E for the mobile bottom sheet + FAB on Settings → Staff.
// Feature: 023-staff-payout-exemptions, User Story 8 (US8, P3).
//
// At viewports < 900px wide the staff page collapses to a single column:
//   - the desktop right-hand aside (`.settings-staff-panel`) is `display:none`;
//   - the inline `[data-section="identity"]` is therefore NOT in the DOM at
//     page load (it lives inside the aside / inside <EditPanel>);
//   - selecting a row opens a bottom sheet (`<StaffMobileSheet>`), a Radix
//     Dialog with `side="bottom"`, which auto-locks body scroll (research § R6);
//   - a FAB pinned to the lower right opens the same Add-staff wizard sheet
//     from US7.
//
// Mirrors the Supabase-reachable / serial / per-test seed pattern from
// `tests/e2e/staff.spec.ts`.

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

test.describe.configure({ mode: "serial" });

// Whole describe runs at 800x1000 (a typical phone-portrait surrogate that
// triggers the `@media (max-width: 899px)` breakpoint defined in research § R5).
test.use({ viewport: { width: 800, height: 1000 } });

test.describe("US8: Mobile bottom sheet + FAB", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US8 mobile specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
  });

  test("(a) roster renders full-width; identity section is NOT in the DOM until a row is tapped", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    // The roster (StaffTable) is visible.
    await expect(page.locator("[data-slot='staff-page']")).toBeVisible();

    // The desktop aside is `display: none` under 900px, so its descendant
    // `[data-section="identity"]` should not be visible. Use isVisible() so
    // hidden elements (display:none) are treated as absent.
    const identity = page.locator("[data-section='identity']");
    expect(await identity.isVisible()).toBe(false);

    // And the mobile sheet is NOT mounted in an open state.
    const openSheet = page.locator("[data-component='staff-mobile-sheet'][data-state='open']");
    await expect(openSheet).toHaveCount(0);
  });

  test("(b) the FAB renders in the lower-right under 900px wide", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    const fab = page.locator("[data-component='staff-fab']");
    await expect(fab).toBeVisible();

    // Position fixed at lower-right — assert via getBoundingClientRect against
    // the viewport.
    const box = await fab.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) return;
    // The FAB should be in the lower half horizontally close to the right edge
    // and within ~80px of the bottom (24px offset + ~56px FAB height).
    expect(viewport.width - (box.x + box.width)).toBeLessThanOrEqual(40);
    expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(40);
  });

  test("(c) tapping a row opens the bottom sheet, height ≤ 92vh", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    // Tap the first roster row.
    const firstRow = page.locator(".staff-row").first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const sheet = page.locator("[data-component='staff-mobile-sheet'][data-state='open']");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    const sheetHeight = await sheet.evaluate((el) => el.getBoundingClientRect().height);
    const vh92 = await page.evaluate(() => window.innerHeight * 0.92);
    expect(sheetHeight).toBeLessThanOrEqual(vh92 + 1); // +1 px tolerance for rounding
  });

  test("(d) body scroll is locked while the sheet is open", async ({ page, staffFixture }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    await page.locator(".staff-row").first().click();
    const sheet = page.locator("[data-component='staff-mobile-sheet'][data-state='open']");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // Radix Dialog (which <Sheet> wraps) sets `overflow: hidden` on document.body
    // while open. The scroll-lock attribute name varies across Radix versions
    // (`data-scroll-locked`, `data-radix-scroll-lock`), so accept either signal.
    const lockState = await page.evaluate(() => {
      const body = document.body;
      return {
        overflow: body.style.overflow,
        scrollLockedAttr:
          body.getAttribute("data-scroll-locked") ?? body.getAttribute("data-radix-scroll-lock"),
      };
    });
    const locked = lockState.overflow === "hidden" || lockState.scrollLockedAttr !== null;
    expect(locked).toBe(true);
  });

  test("(e) dismissing the sheet restores body scroll and clears `?selected=`", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    await page.locator(".staff-row").first().click();
    const sheet = page.locator("[data-component='staff-mobile-sheet'][data-state='open']");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // The Radix SheetContent renders a built-in close button (X icon).
    await page
      .locator("[data-component='staff-mobile-sheet'] [data-slot='sheet-close']")
      .first()
      .click();

    // After close, the sheet's open instance is gone.
    await expect(sheet).toHaveCount(0, { timeout: 5_000 });

    // Body scroll restored — `overflow` style is empty (Radix removes it).
    const restored = await page.evaluate(() => {
      const body = document.body;
      return (
        body.style.overflow === "" &&
        body.getAttribute("data-scroll-locked") === null &&
        body.getAttribute("data-radix-scroll-lock") === null
      );
    });
    expect(restored).toBe(true);

    // The URL no longer carries `?selected=`.
    const url = new URL(page.url());
    expect(url.searchParams.get("selected")).toBeNull();
  });

  test("(f) tapping the FAB opens the Add-staff wizard sheet from US7", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    const fab = page.locator("[data-component='staff-fab']");
    await expect(fab).toBeVisible();
    await fab.click();

    // The wizard sheet (US7) opens — selector matches the existing US7 e2e.
    const wizard = page.locator("[data-slot='add-staff-wizard-sheet'][data-state='open']");
    await expect(wizard).toBeVisible({ timeout: 5_000 });
  });
});
