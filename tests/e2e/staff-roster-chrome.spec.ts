// E2E for Settings → Staff roster chrome (filter chips + related).
// Feature: 023-staff-payout-exemptions, User Stories US4 (filter chips) and
// US5 (forthcoming — deferred-write semantics + edge cases for the chip bar).
//
// These are roster-side concerns separate from the panel-side
// `staff-payout-exemptions.spec.ts`. Mirrors the Supabase-reachable / serial /
// per-test seed pattern from `tests/e2e/staff.spec.ts`.

import { createClient } from "@supabase/supabase-js";

import { test, expect, signInAs, type StaffFixture } from "./_fixtures";

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

// Per-worker namespaced ids for the extra staff this spec inserts. The
// `[wN]` suffix on display_name lets `staffFixture.deleteExtras()` reclaim
// them in the next `beforeEach` under `workers > 1`.
function workerHex(workerIndex: number): string {
  return workerIndex.toString(16).padStart(4, "0");
}
function inactiveIrisId(fixture: StaffFixture): string {
  return `f0000000-0000-0000-${workerHex(fixture.workerIndex)}-000000000099`;
}
function inactiveIvyId(fixture: StaffFixture): string {
  return `f0000000-0000-0000-${workerHex(fixture.workerIndex)}-000000000098`;
}
function pendingPatId(fixture: StaffFixture): string {
  return `f0000000-0000-0000-${workerHex(fixture.workerIndex)}-000000000097`;
}
function inactiveIrisName(fixture: StaffFixture): string {
  return `Inactive Iris [w${fixture.workerIndex}]`;
}
function inactiveIvyName(fixture: StaffFixture): string {
  return `Inactive Ivy [w${fixture.workerIndex}]`;
}
function pendingPatName(fixture: StaffFixture): string {
  return `Pending Pat [w${fixture.workerIndex}]`;
}

// Insert one inactive staff row scoped to the fixture's worker namespace.
// `staffFixture.deleteExtras()` in the next `beforeEach` reclaims it.
async function insertInactiveSeed(fixture: StaffFixture): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = inactiveIrisId(fixture);
  const { error } = await c.from("staff").upsert(
    {
      id,
      display_name: inactiveIrisName(fixture),
      role: "front_desk",
      pin_hash: "$2b$11$0000000000000000000000.0000000000000000000000000000000",
      color_token: "--avatar-slate",
      active: false,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertInactiveSeed: ${error.message}`);
  return id;
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

  test.beforeEach(async ({ context, staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await staffFixture.deleteExtras();
    // Sweep any `@tangnails.test` staff that onboarding tests leak (they
    // use display_names without `[wN]` so deleteExtras can't catch them).
    // Required for US4(f) "No inactive staff" empty-state to render
    // deterministically when the suite runs end-to-end.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const c = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.from("staff").delete().like("email", "%@tangnails.test");
    }
    // Each test starts as a "first-time visitor": clear cookies and ensure
    // no prior `tn:settings:staff:filter` localStorage value bleeds across
    // tests (Playwright contexts persist localStorage within the same
    // context across page navigations).
    await context.clearCookies();
  });

  test("(a) chip bar renders with three chips + tabular counts including seed + fixture trio", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    const chips = page.locator("[data-slot='staff-filter-chip']");
    await expect(chips).toHaveCount(3);

    const all = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const active = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactive = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");

    await expect(active).toContainText("Active");
    await expect(inactive).toContainText("Inactive");
    await expect(all).toContainText("All");

    // Counts come from the global roster. Workers > 1 means other workers'
    // fixture trios may or may not be live, so the floor (this worker's
    // trio + the 3 seeded staff = 6) is what we can assert deterministically.
    // Inactive count is left unasserted: parallel workers may have their
    // own inactive extras live during this test (their fixture's
    // `deleteExtras` only sweeps the worker's own namespace).
    const activeCount = Number(
      (await active.locator("[data-slot='staff-filter-chip-count']").textContent()) ?? "0"
    );
    expect(activeCount).toBeGreaterThanOrEqual(6);
    const allCount = Number(
      (await all.locator("[data-slot='staff-filter-chip-count']").textContent()) ?? "0"
    );
    expect(allCount).toBeGreaterThanOrEqual(6);

    // Count spans use tabular numerals.
    await expect(page.locator("[data-slot='staff-filter-chip-count']").first()).toHaveCSS(
      "font-variant-numeric",
      /tabular-nums/
    );
  });

  test("(b) first-time visitor (cleared localStorage) sees Active selected by default", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

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

  test("(c) clicking Inactive, All, then Active filters rows accordingly", async ({
    page,
    staffFixture,
  }) => {
    // Add an inactive row so the Inactive filter has something to show.
    const irisId = await insertInactiveSeed(staffFixture);

    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForURL(/\/settings\/staff(\?|$)/);

    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    const all = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const active = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactive = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
    const irisRow = page.locator(`[data-slot='staff-table'] [data-staff-id='${irisId}']`);

    // Default Active: at least 6 active rows visible (3 seed + 3 fixture trio).
    // The inactive Iris must NOT be among them.
    await expect(rows).not.toHaveCount(0);
    expect(await rows.count()).toBeGreaterThanOrEqual(6);
    await expect(irisRow).toHaveCount(0);

    // Click Inactive — Iris becomes visible; only inactive rows show.
    await inactive.click();
    await expect(inactive).toHaveAttribute("data-selected", "true");
    await expect(irisRow).toBeVisible();
    await expect(irisRow).toContainText(inactiveIrisName(staffFixture));

    // Click All — Iris stays visible alongside the active rows.
    await all.click();
    await expect(all).toHaveAttribute("data-selected", "true");
    await expect(irisRow).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(7);

    // Click Active — Iris disappears again.
    await active.click();
    await expect(active).toHaveAttribute("data-selected", "true");
    await expect(irisRow).toHaveCount(0);
  });

  test("(d) reload preserves selection", async ({ page, staffFixture }) => {
    const irisId = await insertInactiveSeed(staffFixture);

    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
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

    // The inactive Iris is still visible under the Inactive filter.
    const irisRow = page.locator(`[data-slot='staff-table'] [data-staff-id='${irisId}']`);
    await expect(irisRow).toBeVisible();
    await expect(irisRow).toContainText(inactiveIrisName(staffFixture));
  });

  test("(e) localStorage uses new key; legacy show-inactive key is never written", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
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
    staffFixture,
  }) => {
    // Default seed + fixture trio have zero inactive staff — perfect for
    // the empty-state.
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
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

    // Click → filter flips to Active, the fixture owner row is visible.
    await switchLink.click();
    await expect(
      page.locator("[data-slot='staff-filter-chip'][data-filter='active']")
    ).toHaveAttribute("data-selected", "true");
    await expect(
      page.locator(`[data-slot='staff-table'] [data-staff-id='${staffFixture.owner.id}']`)
    ).toBeVisible();
  });
});

// US5 helper — insert one inactive seed row WITH a dummy PIN hash so the
// row-redesign opacity/dot tests can target it. (Pin-set state isn't what
// this row asserts on — it's the inactive dot + opacity behaviour.) The
// dummy hash satisfies the CHECK without needing a free auth user.
async function insertInactiveNoPinSeed(fixture: StaffFixture): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = inactiveIvyId(fixture);
  const { error } = await c.from("staff").upsert(
    {
      id,
      display_name: inactiveIvyName(fixture),
      role: "technician",
      pin_hash: "$2b$11$0000000000000000000000.0000000000000000000000000000000",
      user_id: null,
      color_token: "--avatar-slate",
      active: false,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertInactiveNoPinSeed: ${error.message}`);
  return id;
}

// US5 helper — insert one active row with NO PIN so the active+no-PIN pill
// variant has a target independent of the inactive case. The staff CHECK
// requires pin_hash IS NOT NULL OR user_id IS NOT NULL — so we mint a
// throwaway per-worker auth user and link it.
async function insertActiveNoPinSeed(fixture: StaffFixture): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = pendingPatId(fixture);
  const w = workerHex(fixture.workerIndex);
  const authUserId = `f0000000-1111-0000-${w}-000000000097`;
  const email = `pending-pat-w${fixture.workerIndex}@e2e.test`;

  // Best-effort idempotent auth-user create (skip on already-exists).
  const existing = await c.auth.admin.getUserById(authUserId);
  if (!existing.data.user) {
    const { error: authErr } = await c.auth.admin.createUser({
      id: authUserId,
      email,
      password: "tang-nails-test",
      email_confirm: true,
    } as Parameters<typeof c.auth.admin.createUser>[0]);
    if (authErr && !/already (registered|exists)/i.test(authErr.message)) {
      throw new Error(`insertActiveNoPinSeed auth-user create failed: ${authErr.message}`);
    }
  }

  // The unique constraint on staff.user_id forbids two rows sharing a user;
  // wipe any prior worker-namespaced Pat row attached to this user before
  // re-inserting.
  await c.from("staff").delete().eq("user_id", authUserId);

  const { error } = await c.from("staff").upsert(
    {
      id,
      display_name: pendingPatName(fixture),
      role: "technician",
      pin_hash: null,
      user_id: authUserId,
      color_token: "--avatar-teal",
      active: true,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertActiveNoPinSeed: ${error.message}`);
  return id;
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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await staffFixture.deleteExtras();
  });

  test("(a) active row with PIN shows success dot + Set pill + tabular Added MMM YYYY", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    // The fixture owner is always active + PIN set, so it's a stable target
    // for the happy-path assertions regardless of the default filter chip.
    const row = page.locator(
      `[data-slot='staff-table'] [data-staff-id='${staffFixture.owner.id}']`
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

  test("(b) active row without PIN shows the same dot + warning No PIN pill", async ({
    page,
    staffFixture,
  }) => {
    const patId = await insertActiveNoPinSeed(staffFixture);
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    const row = page.locator(`[data-slot='staff-table'] [data-staff-id='${patId}']`);
    await expect(row).toBeVisible();

    const dot = row.locator("[data-slot='staff-status-dot']");
    await expect(dot).toHaveClass(/staff-status-dot--active/);

    const pinPill = row.locator("[data-slot='staff-pin-pill']");
    await expect(pinPill).toHaveText("No PIN");
    await expect(pinPill).toHaveClass(/staff-pin-pill--no-pin/);
  });

  test("(c) inactive row shows muted dot + ~60% opacity", async ({ page, staffFixture }) => {
    const ivyId = await insertInactiveNoPinSeed(staffFixture);
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    await showInactiveRows(page);

    const row = page.locator(`[data-slot='staff-table'] [data-staff-id='${ivyId}']`);
    await expect(row).toBeVisible();

    const dot = row.locator("[data-slot='staff-status-dot']");
    await expect(dot).toHaveClass(/staff-status-dot--inactive/);

    const opacity = await row.evaluate((el) => window.getComputedStyle(el as HTMLElement).opacity);
    expect(parseFloat(opacity)).toBeCloseTo(0.6, 1);
  });

  test("(d) selecting an inactive row restores opacity to 1 + paints a 3px left accent bar", async ({
    page,
    staffFixture,
  }) => {
    const ivyId = await insertInactiveNoPinSeed(staffFixture);
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    await showInactiveRows(page);

    const row = page.locator(`[data-slot='staff-table'] [data-staff-id='${ivyId}']`);
    await expect(row).toBeVisible();
    await row.click();

    // The page navigates to ?selected=… ; wait for the URL transition before
    // asserting on the row's selected-state attribute. Without this wait the
    // assertion may race the soft-nav re-render.
    await page.waitForURL(new RegExp(`\\/settings\\/staff\\?selected=${ivyId}`), {
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

  test("(e) viewport <900px hides the date and shows the chevron", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    await page.setViewportSize({ width: 800, height: 600 });

    const row = page.locator(
      `[data-slot='staff-table'] [data-staff-id='${staffFixture.owner.id}']`
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
