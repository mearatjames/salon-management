// E2E for Settings → Staff roster chrome (filter chips + related).
// Feature: 023-staff-payout-exemptions, User Stories US4 (filter chips) and
// US5 (forthcoming — deferred-write semantics + edge cases for the chip bar).
//
// These are roster-side concerns separate from the panel-side
// `staff-payout-exemptions.spec.ts`. Mirrors the Supabase-reachable / serial /
// per-test seed pattern from `tests/e2e/staff.spec.ts`.

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

// Reuses the seeded `owner@tangnails.dev` / `tang-nails-dev` device login
// pattern from auth.spec.ts, then pins in as Maya Patel (PIN 1234, seeded
// owner staff row).
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

// Insert one inactive seed row (Inactive Iris) directly via the service-role
// client. Cleaned up by `resetStaffToSeed()` in the next `beforeEach`.
async function insertInactiveSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.from("staff").upsert(
    {
      id: "10000000-0000-0000-0000-000000000099",
      display_name: "Inactive Iris",
      role: "front_desk",
      pin_hash: "$2b$11$0000000000000000000000.0000000000000000000000000000000",
      color_token: "--avatar-slate",
      active: false,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertInactiveSeed: ${error.message}`);
}

test.describe.configure({ mode: "serial" });

test.describe("US4: Filter chips", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US4 roster-chrome specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ context }) => {
    if (!supabaseUp) return;
    await resetStaffToSeed();
    // Each test starts as a "first-time visitor": clear cookies and ensure
    // no prior `tn:settings:staff:filter` localStorage value bleeds across
    // tests (Playwright contexts persist localStorage within the same
    // context across page navigations).
    await context.clearCookies();
  });

  test("(a) chip bar renders with three chips + tabular counts matching seed", async ({ page }) => {
    await signInAsMaya(page);

    const chips = page.locator("[data-slot='staff-filter-chip']");
    await expect(chips).toHaveCount(3);

    const all = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const active = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactive = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");

    // Default seed: 3 active, 0 inactive, 3 total.
    await expect(active).toContainText("Active");
    await expect(active).toContainText("3");
    await expect(inactive).toContainText("Inactive");
    await expect(inactive).toContainText("0");
    await expect(all).toContainText("All");
    await expect(all).toContainText("3");

    // Count spans use tabular numerals.
    await expect(page.locator("[data-slot='staff-filter-chip-count']").first()).toHaveCSS(
      "font-variant-numeric",
      /tabular-nums/
    );
  });

  test("(b) first-time visitor (cleared localStorage) sees Active selected by default", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Clear localStorage AFTER the first navigation (clearCookies in
    // beforeEach already gives us a fresh session storage at the start of
    // the test, but reload-and-check is the explicit assertion).
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    const active = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    await expect(active).toHaveAttribute("data-selected", "true");

    const all = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const inactive = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
    await expect(all).toHaveAttribute("data-selected", "false");
    await expect(inactive).toHaveAttribute("data-selected", "false");
  });

  test("(c) clicking Inactive, All, then Active filters rows accordingly", async ({ page }) => {
    // Add an inactive row so the Inactive filter has something to show.
    await insertInactiveSeed();

    await signInAsMaya(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    const all = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const active = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactive = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");

    // Default Active: 3 active rows visible.
    await expect(rows).toHaveCount(3);

    // Click Inactive → only Inactive Iris (1 row).
    await inactive.click();
    await expect(inactive).toHaveAttribute("data-selected", "true");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Inactive Iris");

    // Click All → all 4 rows.
    await all.click();
    await expect(all).toHaveAttribute("data-selected", "true");
    await expect(rows).toHaveCount(4);

    // Click Active → back to 3.
    await active.click();
    await expect(active).toHaveAttribute("data-selected", "true");
    await expect(rows).toHaveCount(3);
  });

  test("(d) reload preserves selection", async ({ page }) => {
    await insertInactiveSeed();

    await signInAsMaya(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    // Click Inactive — this should be persisted.
    await page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']").click();
    await expect(
      page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']")
    ).toHaveAttribute("data-selected", "true");

    // Reload — the chip should remain Inactive.
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    await expect(
      page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']")
    ).toHaveAttribute("data-selected", "true");

    // The roster should still be filtered to inactive.
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Inactive Iris");
  });

  test("(e) localStorage uses new key; legacy show-inactive key is never written", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    // Click Inactive then All so the new key is touched.
    await page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']").click();
    await page.locator("[data-slot='staff-filter-chip'][data-filter='all']").click();

    // New key reflects the latest selection.
    const newKeyValue = await page.evaluate(() => localStorage.getItem("tn:settings:staff:filter"));
    expect(newKeyValue).toBe("all");

    // Legacy key (deprecated by this feature) must NEVER be written.
    const legacyKeyValue = await page.evaluate(() =>
      localStorage.getItem("tn:settings:staff:show-inactive")
    );
    expect(legacyKeyValue).toBeNull();
  });

  test("(f) empty Inactive state shows 'No inactive staff.' with 'Switch to Active' link (FR-020)", async ({
    page,
  }) => {
    // Default seed has zero inactive staff — perfect for the empty-state.
    await signInAsMaya(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    // Select Inactive — no rows match.
    await page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']").click();

    const emptyRow = page.locator("[data-slot='staff-no-results']");
    await expect(emptyRow).toContainText("No inactive staff.");

    // Inline "Switch to Active" link.
    const switchLink = page.locator("[data-slot='staff-switch-to-active']");
    await expect(switchLink).toBeVisible();
    await expect(switchLink).toContainText("Switch to Active");

    // Click → filter flips to Active, rows return.
    await switchLink.click();
    await expect(
      page.locator("[data-slot='staff-filter-chip'][data-filter='active']")
    ).toHaveAttribute("data-selected", "true");
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    await expect(rows).toHaveCount(3);
  });
});

// US5 helper — insert one inactive seed row WITH a dummy PIN hash so the
// row-redesign opacity/dot tests can target it. (Pin-set state isn't what
// this row asserts on — it's the inactive dot + opacity behaviour.) The
// dummy hash satisfies the CHECK without needing a free auth user.
async function insertInactiveNoPinSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.from("staff").upsert(
    {
      id: "10000000-0000-0000-0000-000000000098",
      display_name: "Inactive Ivy",
      role: "technician",
      pin_hash: "$2b$11$0000000000000000000000.0000000000000000000000000000000",
      user_id: null,
      color_token: "--avatar-slate",
      active: false,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertInactiveNoPinSeed: ${error.message}`);
}

// US5 helper — insert one active row with NO PIN so the active+no-PIN pill
// variant has a target independent of the inactive case.
async function insertActiveNoPinSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // CHECK requires pin_hash IS NOT NULL OR user_id IS NOT NULL. The seeded
  // `reset-test@tangnails.dev` auth user (00000000-0000-0000-0000-0000000000ff)
  // has no associated staff row in the seed, so we can attach it here
  // without colliding with Maya/Jordan/Sam's user_ids.
  const { error } = await c.from("staff").upsert(
    {
      id: "10000000-0000-0000-0000-000000000097",
      display_name: "Pending Pat",
      role: "technician",
      pin_hash: null,
      user_id: "00000000-0000-0000-0000-0000000000ff",
      color_token: "--avatar-teal",
      active: true,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertActiveNoPinSeed: ${error.message}`);
}

// Helper: surface inactive rows in the roster regardless of whether US4's
// chip bar or the legacy show-inactive toggle is the active UI. Phase 6
// (US4) replaces the toggle with chips; until that lands the legacy toggle
// is still the path. This helper picks whichever exists.
async function showInactiveRows(page: import("@playwright/test").Page): Promise<void> {
  const chip = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
  if (await chip.count()) {
    await chip.click();
    return;
  }
  const toggle = page.locator("[data-slot='show-inactive-toggle'] [data-slot='switch']");
  if (await toggle.count()) {
    await toggle.click();
    return;
  }
  throw new Error(
    "showInactiveRows: neither the US4 chip bar nor the legacy show-inactive toggle was found"
  );
}

test.describe("US5: Staff row redesign", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US5 row-redesign specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await resetStaffToSeed();
  });

  test("(a) active row with PIN shows success dot + Set pill + tabular Added MMM YYYY", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Maya is always active + PIN set, so she's a stable target for the
    // happy-path assertions regardless of the default filter chip.
    const row = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000001']"
    );
    await expect(row).toBeVisible();

    const dot = row.locator("[data-slot='staff-status-dot']");
    await expect(dot).toHaveClass(/staff-status-dot--active/);

    const pinPill = row.locator("[data-slot='staff-pin-pill']");
    await expect(pinPill).toHaveText("Set");
    await expect(pinPill).toHaveClass(/staff-pin-pill--set/);

    const dateSlot = row.locator("[data-slot='staff-row-added-date']");
    await expect(dateSlot).toHaveText(/^Added [A-Z][a-z]{2} \d{4}$/);
    await expect(dateSlot).toHaveCSS("font-variant-numeric", /tabular-nums/);
  });

  test("(b) active row without PIN shows the same dot + warning No PIN pill", async ({ page }) => {
    await insertActiveNoPinSeed();
    await signInAsMaya(page);

    const row = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000097']"
    );
    await expect(row).toBeVisible();

    const dot = row.locator("[data-slot='staff-status-dot']");
    await expect(dot).toHaveClass(/staff-status-dot--active/);

    const pinPill = row.locator("[data-slot='staff-pin-pill']");
    await expect(pinPill).toHaveText("No PIN");
    await expect(pinPill).toHaveClass(/staff-pin-pill--no-pin/);
  });

  test("(c) inactive row shows muted dot + ~60% opacity", async ({ page }) => {
    await insertInactiveNoPinSeed();
    await signInAsMaya(page);

    await showInactiveRows(page);

    const row = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000098']"
    );
    await expect(row).toBeVisible();

    const dot = row.locator("[data-slot='staff-status-dot']");
    await expect(dot).toHaveClass(/staff-status-dot--inactive/);

    const opacity = await row.evaluate((el) => window.getComputedStyle(el as HTMLElement).opacity);
    expect(parseFloat(opacity)).toBeCloseTo(0.6, 1);
  });

  test("(d) selecting an inactive row restores opacity to 1 + paints a 3px left accent bar", async ({
    page,
  }) => {
    await insertInactiveNoPinSeed();
    await signInAsMaya(page);

    await showInactiveRows(page);

    const row = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000098']"
    );
    await expect(row).toBeVisible();
    await row.click();

    // The page navigates to ?selected=… ; wait for the URL transition before
    // asserting on the row's selected-state attribute. Without this wait the
    // assertion may race the soft-nav re-render.
    await page.waitForURL(/\/settings\/staff\?selected=10000000-0000-0000-0000-000000000098/, {
      timeout: 5_000,
    });
    await expect(row).toHaveAttribute("data-selected", "true");

    const opacity = await row.evaluate((el) => window.getComputedStyle(el as HTMLElement).opacity);
    expect(parseFloat(opacity)).toBeCloseTo(1, 1);

    const beforeWidth = await row.evaluate(
      (el) => window.getComputedStyle(el as HTMLElement, "::before").width
    );
    expect(beforeWidth).toBe("3px");
  });

  test("(e) viewport <900px hides the date and shows the chevron", async ({ page }) => {
    await signInAsMaya(page);

    await page.setViewportSize({ width: 800, height: 600 });

    const row = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000001']"
    );
    await expect(row).toBeVisible();

    const dateDisplay = await row
      .locator("[data-slot='staff-row-added-date']")
      .evaluate((el) => window.getComputedStyle(el as HTMLElement).display);
    expect(dateDisplay).toBe("none");

    const chevronDisplay = await row
      .locator("[data-slot='staff-row-chevron']")
      .evaluate((el) => window.getComputedStyle(el as HTMLElement).display);
    // Tailwind preflight + browser computed-style normalisation can resolve
    // the CSS-declared `inline-flex` to either `inline-flex` or `flex`; both
    // mean "the chevron is now visible". Assert against both.
    expect(["inline-flex", "flex"]).toContain(chevronDisplay);
  });
});
