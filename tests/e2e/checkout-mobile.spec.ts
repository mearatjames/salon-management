// tests/e2e/checkout-mobile.spec.ts
//
// E2E for the phone-portrait checkout screen (issue #163).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established)
// the dense two-column checkout collapses to the SEGMENTED layout from the
// design handoff:
//   - no horizontal scroll at 375 / 430px;
//   - a sticky "Add services ⇄ Cart" segmented toggle swaps which pane the
//     single-column body shows (the inactive pane is `display:none`);
//   - the inline desktop Receipt+Charge row is hidden and a contextual sticky
//     footer carries the charge action instead;
//   - catalog tiles + payment tiles both drop to 2-up;
//   - the toggle + footer CTA are ≥ 44px tap targets.
//
// Adding a service writes nothing until charge (ephemeral draft), so this spec
// asserts no global aggregate over a shared table and is parallel-safe — it
// lives in the `main` project, not a serial baseline. Mirrors the
// Supabase-reachable guard + `signInAs(..., { nextPath })` navigation from
// `tests/e2e/dashboard-mobile.spec.ts`: reaching /checkout through the login
// `?next=` server redirect yields a clean single-copy document, so the
// `documentElement.scrollWidth` check isn't tripped by the App Router's
// transient `aria-hidden` stale-page copy (under a transformed transition
// wrapper the shell's off-canvas `position:fixed` drawer would otherwise
// briefly inflate the scroll width — shell chrome, not checkout content).

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

// First seeded service tile (Gel manicure) — the same id the other checkout
// specs tap.
const SEEDED_SERVICE_ID = "20000000-0000-0000-0000-000000000001";

test.describe("#163-US1: phone-portrait segmented checkout", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #163 mobile specs (Docker unavailable)."
      );
    }
  });

  for (const width of PHONE_WIDTHS) {
    test(`(a) no horizontal scroll at ${width}px`, async ({ page, staffFixture }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/checkout" });

      await expect(
        page.locator("[data-slot='checkout-shell']:not([aria-hidden='true'])")
      ).toBeVisible();
      // The segmented toggle only renders at ≤640px, so waiting for it confirms
      // the mobile layout is applied before measuring.
      await expect(page.locator("[data-slot='checkout-mobile-seg']")).toBeVisible();

      const noHScroll = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth;
      });
      expect(noHScroll).toBe(true);
    });
  }

  test("(b) the segmented toggle swaps the catalog and cart panes", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/checkout" });

    await expect(
      page.locator("[data-slot='checkout-shell']:not([aria-hidden='true'])")
    ).toBeVisible();

    // Mobile chrome is present at this width; the desktop inline charge row is
    // hidden in favour of the sticky footer.
    const seg = page.locator("[data-slot='checkout-mobile-seg']");
    const foot = page.locator("[data-slot='checkout-mobile-foot']");
    await expect(seg).toBeVisible();
    await expect(foot).toBeVisible();
    await expect(page.locator("[data-slot='checkout-charge-row']")).toBeHidden();

    // A fresh (empty) ticket opens on the catalog: catalog visible, cart hidden.
    const catalog = page.locator(".checkout-catalog");
    const cart = page.locator(".checkout-cart");
    await expect(catalog).toBeVisible();
    await expect(cart).toBeHidden();

    // Switch to the cart pane.
    await page.locator("[data-slot='checkout-mobile-seg-cart']").click();
    await expect(cart).toBeVisible();
    await expect(catalog).toBeHidden();

    // …and back to the catalog.
    await page.locator("[data-slot='checkout-mobile-seg-catalog']").click();
    await expect(catalog).toBeVisible();
    await expect(cart).toBeHidden();

    // Both segmented buttons are ≥ 44px tall (one-handed tap target).
    for (const slot of ["checkout-mobile-seg-catalog", "checkout-mobile-seg-cart"]) {
      const box = await page.locator(`[data-slot='${slot}']`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("(c) add a service, then reach the charge action in the sticky footer", async ({
    page,
    staffFixture,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/checkout" });

    await expect(
      page.locator("[data-slot='checkout-shell']:not([aria-hidden='true'])")
    ).toBeVisible();

    // Pick the seeded tech, then add a service from the (default) catalog pane.
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${SEEDED_SERVICE_ID}']`)
      .click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(1);

    // The "Cart" segment now badges the one service line.
    await expect(page.locator("[data-slot='checkout-mobile-seg-cart']")).toContainText("1");

    // Flip to the cart and choose cash — the footer's charge button is the
    // single charge control on phone, and it becomes enabled + ≥ 44px tall.
    await page.locator("[data-slot='checkout-mobile-seg-cart']").click();
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();

    const charge = page.locator("[data-slot='mobile-charge-button']");
    await expect(charge).toBeVisible();
    await expect(charge).toBeEnabled();
    const box = await charge.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
