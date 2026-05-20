// tests/e2e/checkout-flowsingle-layout.spec.ts
//
// Issue #85 — align the /checkout transaction screen with the canonical
// `FlowSingle` prototype (`design-system/prototypes/transaction/FlowSingle.jsx`).
//
// Two structural facts this spec guards:
//   §1 Column order — the service catalog renders on the LEFT, the
//      cart/payment panel on the RIGHT (FlowSingle.jsx:200-206).
//   §2 Tech-assignment band — the tech picker is a full-width band
//      between the header and the two-column body, NOT nested inside the
//      cart column (FlowSingle.jsx:182-199).
//
// Bounding-box comparisons are the authoritative visual check: CSS grid
// placement + source order both feed the rendered column position, so a
// regression that swaps either one is caught here.
//
// §3 (tech-name labels in the pre-pick picker) is covered by the faster
// component test `tests/unit/checkout/tech-avatar-row.test.tsx`.

import { expect, test } from "./_fixtures";

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

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

test.describe("checkout — FlowSingle layout fidelity (issue #85)", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping checkout layout spec (Docker unavailable)."
      );
    }
  });

  test("§1 service catalog renders left of the cart/payment panel", async ({ page }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/checkout");
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.locator("[data-slot='checkout-shell']")).toBeVisible();

    const catalog = page.getByRole("region", { name: "Service catalog" });
    const cart = page.getByRole("region", { name: "Cart" });
    await expect(catalog).toBeVisible();
    await expect(cart).toBeVisible();

    const catalogBox = await catalog.boundingBox();
    const cartBox = await cart.boundingBox();
    expect(catalogBox, "catalog region has a layout box").not.toBeNull();
    expect(cartBox, "cart region has a layout box").not.toBeNull();

    // Catalog sits to the LEFT of the cart — matching FlowSingle.
    expect(catalogBox!.x).toBeLessThan(cartBox!.x);
  });

  test("§2 tech-assignment row is a full-width band above the two columns", async ({ page }) => {
    if (!supabaseUp) test.skip();

    await page.goto("/checkout");
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.locator("[data-slot='checkout-shell']")).toBeVisible();

    const band = page.locator("[data-slot='checkout-tech-band']");
    await expect(band).toBeVisible();

    // The picker lives inside the band, not inside the cart column.
    await expect(
      band.locator("[data-slot='checkout-tech-row']"),
      "tech picker is rendered inside the band"
    ).toHaveCount(1);
    await expect(
      page.locator(".checkout-cart [data-slot='checkout-tech-row']"),
      "tech picker is NOT nested in the cart column"
    ).toHaveCount(0);

    // The band sits above the two-column body.
    const bandBox = await band.boundingBox();
    const bodyBox = await page.locator(".checkout-body").boundingBox();
    expect(bandBox, "tech band has a layout box").not.toBeNull();
    expect(bodyBox, "two-column body has a layout box").not.toBeNull();
    expect(bandBox!.y).toBeLessThan(bodyBox!.y);

    // The band spans the full width of the two-column body below it.
    expect(Math.round(bandBox!.width)).toBe(Math.round(bodyBox!.width));
  });
});
