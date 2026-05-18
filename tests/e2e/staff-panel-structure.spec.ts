// E2E for Settings → Staff edit-panel structural sectioning (US6 of
// specs/023-staff-payout-exemptions).
//
// These tests assert the DOM shape of the edit panel — section ordering, the
// new panel-profile header card, the danger-zone container, and the FR-028
// invariant that NO destructive action lives outside the danger zone. The
// shape assertions are intentionally light on data (no audit cursor needed)
// so the spec runs fast and can be reused by future panel-restructure work.
//
// Mirrors the Supabase-reachable / serial pattern from
// `staff-payout-exemptions.spec.ts`.

import { expect, test } from "@playwright/test";

import { resetStaffToSeed } from "./_db";

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

// Sign in as Maya Patel (seeded owner; PIN 1234). Mirrors the helpers in
// `staff-payout-exemptions.spec.ts` and `staff-roster-chrome.spec.ts`.
async function signInAsMaya(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fsettings%2Fstaff");
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
  await page.waitForURL(/\/settings\/staff(\?|$)/, { timeout: 10_000 });
}

// Sam Chen — seeded technician (active). Safe target for the active-state
// section tests; doesn't trip last-owner gating or self-edit blocks.
const SAM_ID = "10000000-0000-0000-0000-000000000003";
// Inactive Iris — seeded only by `insertInactiveSeed()` below.
const IRIS_ID = "10000000-0000-0000-0000-000000000099";

async function insertInactiveSeed(): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.from("staff").upsert(
    {
      id: IRIS_ID,
      display_name: "Inactive Iris",
      role: "technician",
      pin_hash: "$2b$11$0000000000000000000000.0000000000000000000000000000000",
      color_token: "--avatar-slate",
      active: false,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertInactiveSeed: ${error.message}`);
}

test.describe.configure({ mode: "serial" });

test.describe("US6: Panel sectioning + danger zone", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US6 panel-structure specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await resetStaffToSeed();
  });

  test("(a) panel-profile header renders at the top with avatar, name, role, added date, and status badges", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    const header = page.locator("[data-slot='staff-panel-profile-header']");
    await expect(header).toBeVisible();
    // Display name appears in the header.
    await expect(header).toContainText("Sam Chen");
    // "Tech · Added <Mon YYYY>" subtitle — exact month varies with seed, so
    // assert the pattern "Tech · Added " + 3-letter month + 4-digit year.
    await expect(header.locator("[data-slot='staff-panel-profile-subtitle']")).toHaveText(
      /Tech\s*·\s*Added\s+[A-Z][a-z]{2}\s+\d{4}/
    );
    // Status badges row mounted inside the header.
    await expect(header.locator("[data-slot='staff-status-badges']")).toBeVisible();
    await expect(header.locator("[data-slot='staff-status-badge-active']")).toBeVisible();

    // The header must be the FIRST direct child of the panel container (above
    // every data-section block). We assert by ordering of bounding rects:
    // header.y < first section.y.
    const headerBox = await header.boundingBox();
    const firstSectionBox = await page.locator("[data-section='identity']").boundingBox();
    expect(headerBox).not.toBeNull();
    expect(firstSectionBox).not.toBeNull();
    expect(headerBox!.y).toBeLessThan(firstSectionBox!.y);
  });

  test("(b) panel sections render in the contracted DOM order", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    await expect(page.locator("[data-slot='staff-edit-panel']")).toBeVisible();

    const expected = ["identity", "access", "pay-deductions", "save", "danger-zone"] as const;

    const sections = page.locator("[data-section]");
    // Each contracted section must be present.
    for (const name of expected) {
      await expect(page.locator(`[data-section="${name}"]`)).toBeVisible();
    }

    // Resolve ordering via bounding rects — robust against wrapper changes.
    const ys: number[] = [];
    for (const name of expected) {
      const box = await page.locator(`[data-section="${name}"]`).boundingBox();
      expect(box, `bounding box for [data-section="${name}"]`).not.toBeNull();
      ys.push(box!.y);
    }
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }

    // Sanity: section count >= the 5 contracted sections.
    expect(await sections.count()).toBeGreaterThanOrEqual(expected.length);
  });

  test("(c) danger-zone background is distinct from neutral section cards", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    await expect(page.locator("[data-section='danger-zone']")).toBeVisible();

    const dangerBg = await page
      .locator("[data-section='danger-zone']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const identityBg = await page
      .locator("[data-section='identity']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const accessBg = await page
      .locator("[data-section='access']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(dangerBg).not.toBe("");
    expect(dangerBg).not.toBe(identityBg);
    expect(dangerBg).not.toBe(accessBg);
  });

  test("(d) active staff shows Deactivate + Remove from roster inside the danger zone", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    const dz = page.locator("[data-section='danger-zone']");
    await expect(dz).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-deactivate']")).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-deactivate']")).toContainText("Deactivate");
    await expect(dz.locator("[data-slot='danger-zone-remove']")).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-remove']")).toContainText(
      "Remove from roster"
    );
  });

  test("(e) inactive staff shows Reactivate + Remove from roster inside the danger zone", async ({
    page,
  }) => {
    await insertInactiveSeed();
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${IRIS_ID}`);

    const dz = page.locator("[data-section='danger-zone']");
    await expect(dz).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-reactivate']")).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-reactivate']")).toContainText("Reactivate");
    await expect(dz.locator("[data-slot='danger-zone-remove']")).toBeVisible();
    await expect(dz.locator("[data-slot='danger-zone-remove']")).toContainText(
      "Remove from roster"
    );
  });

  test("(f) FR-028: no destructive action exists outside the danger zone", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    await expect(page.locator("[data-slot='staff-edit-panel']")).toBeVisible();
    await expect(page.locator("[data-section='danger-zone']")).toBeVisible();

    // Count every destructive flag in the panel; assert that ALL of them
    // share the same ancestor `[data-section="danger-zone"]`.
    const destructiveButtons = page.locator("[data-destructive='true']");
    const total = await destructiveButtons.count();
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i++) {
      const btn = destructiveButtons.nth(i);
      const insideDz = await btn.evaluate((el) =>
        Boolean(el.closest("[data-section='danger-zone']"))
      );
      expect(insideDz).toBe(true);
    }
  });
});
