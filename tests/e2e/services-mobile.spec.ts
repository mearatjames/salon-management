// E2E for the phone-portrait Services catalog (issue #167).
//
// At `max-width: 640px` (the single shared mobile breakpoint #160 established)
// the Services surface flips from "edit panel stacks below the full catalog"
// to a one-handed MASTER → DETAIL flow, driven by the `[data-panel-mode]`
// attribute the page already sets on `.services-two-pane`:
//   - closed   → catalog list full-screen, edit panel removed from flow;
//   - edit/add → edit panel promoted to a fixed full-screen layer with a back
//                control in the header and a pinned footer (Save / Cancel /
//                Archive always reachable).
//
// Read-only + parallel-safe: it signs in as the seeded owner, navigates, taps
// a row, and inspects layout — it asserts no global aggregate over a shared
// table and mutates nothing, so it lives in the `main` project (not a serial
// baseline). Mirrors the Supabase-reachable guard + `signInAsMaya` pattern
// from `tests/e2e/services.spec.ts`.

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

// Maya is the seeded owner (display "Maya Patel", PIN 1234, owner@tangnails.dev).
// Mirrors `signInAsMaya` in services.spec.ts; lands on /services.
async function signInAsMaya(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fservices");
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  const modal = page.getByRole("dialog");
  await modal.waitFor({ state: "visible" });
  await modal.getByRole("button", { name: "Digit 1", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 2", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 3", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 4", exact: true }).click();
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

// Phone-portrait default plus the two widths the acceptance criteria call out
// explicitly (375 = iPhone SE/13 mini, 430 = iPhone 15 Pro Max).
const PHONE = { width: 390, height: 844 };
const NO_SCROLL_WIDTHS = [375, 390, 430] as const;

test.describe("#167: services catalog master → detail on phone portrait", () => {
  test.use({ viewport: PHONE });

  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #167 mobile specs (Docker unavailable)."
      );
    }
  });

  test("list mode shows the catalog full-screen; the edit panel is hidden", async ({ page }) => {
    await signInAsMaya(page);

    // Closed (list) mode: the two-pane shell reports no selection.
    await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "closed");

    // The catalog list fills the view; the edit panel is removed from flow.
    await expect(page.locator('[data-slot="services-list"]')).toBeVisible();
    await expect(page.locator('[data-slot="services-edit-panel"]')).toBeHidden();

    // The catalog aggregate ("X active · Y total") stays visible in list mode.
    await expect(page.locator('[data-slot="services-page-header"]')).toBeVisible();
  });

  test("tapping a service opens the editor full-screen; back returns to the list", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Tap the first catalog row to open its editor.
    await page.locator('[data-slot="service-row"]').first().click();

    // Detail mode: the editor fills the view, the catalog list is hidden.
    const twoPane = page.locator(".services-two-pane");
    await expect(twoPane).toHaveAttribute("data-panel-mode", "edit");
    await expect(page.locator('[data-slot="services-edit-panel"]')).toBeVisible();
    await expect(page.locator('[data-slot="services-list"]')).toBeHidden();

    // The footer (Archive / Cancel / Save) is reachable — visible and pinned
    // within the viewport, not pushed below the fold.
    const footer = page.locator('[data-slot="services-edit-panel-footer"]');
    await expect(footer).toBeVisible();
    const box = await footer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height + 1);

    // The phone back affordance returns to the catalog list.
    const back = page.locator('[data-slot="services-edit-back"]');
    await expect(back).toBeVisible();
    await back.click();

    await expect(twoPane).toHaveAttribute("data-panel-mode", "closed");
    await expect(page.locator('[data-slot="services-list"]')).toBeVisible();
  });

  // #186: on phone-portrait the name and its pill group must not share one
  // row — the name reclaims the full width (no ellipsis truncation) and the
  // chips drop to a second line beneath it.
  test("the service name uses the full row width; chips wrap to a second line", async ({
    page,
  }) => {
    await signInAsMaya(page);

    const row = page.locator('[data-slot="service-row"]').first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const name = row.locator('[data-slot="service-name"]');
    const meta = row.locator('[data-slot="service-row-meta"]');

    // The name no longer truncates: with the phone restack it wraps rather
    // than clipping, so its rendered width covers its content.
    const nameOverflow = await name.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(nameOverflow).toBeLessThanOrEqual(1);

    // The chip group sits on a line below the name, not beside it.
    const nameBox = await name.boundingBox();
    const metaBox = await meta.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(metaBox).not.toBeNull();
    expect(metaBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 2);
  });

  for (const width of NO_SCROLL_WIDTHS) {
    test(`no horizontal scroll at ${width}px in list and detail modes`, async ({ page }) => {
      await signInAsMaya(page);
      await page.setViewportSize({ width, height: PHONE.height });
      await page.goto("/services");

      // Wait for the catalog to render before measuring — prod cold paths can
      // be slow under parallel load.
      await expect(page.locator('[data-slot="service-row"]').first()).toBeVisible({
        timeout: 15_000,
      });

      // List mode.
      await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "closed");
      let doc = await horizontalOverflow(page);
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

      // Detail mode.
      await page.locator('[data-slot="service-row"]').first().click();
      await expect(page.locator(".services-two-pane")).toHaveAttribute("data-panel-mode", "edit");
      doc = await horizontalOverflow(page);
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
    });
  }
});
