// E2E for the Services catalog at /services (specs/008-services-catalog).
// Reached from the studio sidebar — not nested under Settings.
//
// US1 — see the catalog at a glance. Seeded state (from supabase/seed.sql):
//   - Manicure: Classic manicure, Gel polish
//   - Pedicure: Classic pedicure, Spa pedicure
//   - Add-on:  Nail art (variable price, no techs)
// That's 5 active services across 3 categories. The independent-test note
// in tasks.md asks for "6 services / 2 categories / 1 archived" — instead
// of mutating the shared seed (which other specs depend on) we insert ONE
// extra archived service directly via the service-role client in `beforeAll`
// so the toggle has something to flip. Documented as a deliberate deviation.
//
// Docker / Supabase availability: the same probe pattern as
// `tests/e2e/staff.spec.ts`. Without Docker the local Supabase is offline
// and the suite skips itself rather than failing.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import { getAuditLogRows, truncateAuditLog } from "./_db";

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

// Stable id for the archived seed row inserted in beforeAll; chosen so the
// row id is obviously distinct from the seeded `20000000-…-001..005` set.
const ARCHIVED_ID = "20000000-0000-0000-0000-000000000099";

async function insertArchivedSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.from("services").upsert(
    {
      id: ARCHIVED_ID,
      name: "Paraffin treatment",
      category: "Add-on",
      duration_min: 20,
      price_cents: 1500,
      color_token: "--avatar-amber",
      taxable: true,
      active: false,
      variable_price: false,
      price_from_cents: null,
      price_to_cents: null,
      variable_price_note: null,
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`insertArchivedSeed: ${error.message}`);
}

async function removeArchivedSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Best-effort cleanup. RLS doesn't apply (service-role bypasses).
  await c.from("services").delete().eq("id", ARCHIVED_ID);
}

// Mirrors `signInAsMaya` in staff.spec.ts — Maya is the seeded owner
// (display name "Maya Patel", PIN 1234, linked to owner@tangnails.dev).
async function signInAsMaya(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fservices");
  await page.locator("#email").fill("owner@tangnails.dev");
  await page.getByLabel("Password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("US1: see the services catalog at a glance", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 services specs (Docker unavailable)."
      );
      return;
    }
    // Insert the archived seed row once per describe — the toggle test needs
    // something to flip. Idempotent via upsert.
    await insertArchivedSeed();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await removeArchivedSeed();
  });

  test("(a) owner reaches /services and sees the seeded catalog grouped by category", async ({
    page,
  }) => {
    await signInAsMaya(page);
    expect(new URL(page.url()).pathname).toBe("/services");

    // Default view: archived hidden, 5 active rows visible.
    const rows = page.locator("[data-slot='service-row']");
    await expect(rows).toHaveCount(5);

    // Summary derived from the unfiltered roster (5 active + 1 archived = 6 total).
    await expect(page.locator("[data-slot='services-summary']")).toHaveText("5 active · 6 total");

    // Group order: Add-on → Manicure → Pedicure (alpha ascending,
    // case-insensitive).
    const groupHeaders = await page
      .locator("[data-slot='services-group-header']")
      .allTextContents();
    expect(groupHeaders).toEqual(["Add-on", "Manicure", "Pedicure"]);

    // Within each group, rows are alpha ascending. Spot-check Pedicure:
    // Classic pedicure < Spa pedicure.
    const pedicureGroup = page.locator(
      "[data-slot='services-group'][data-category='Pedicure'] [data-slot='service-row']"
    );
    const pedicureNames = await pedicureGroup
      .locator("[data-slot='service-name']")
      .allTextContents();
    expect(pedicureNames).toEqual(["Classic pedicure", "Spa pedicure"]);

    // Row composition spot-check (Classic manicure — fixed price + 2 techs):
    const classicMani = page.locator(
      `[data-slot='service-row'][data-service-id='20000000-0000-0000-0000-000000000001']`
    );
    await expect(classicMani.locator("[data-slot='service-duration-pill']")).toHaveText("30 min");
    await expect(classicMani.locator("[data-slot='service-price-pill']")).toHaveText("$25");
    await expect(classicMani.locator("[data-slot='service-tech-pill']")).toHaveText("2 techs");

    // Nail art is variable-price with `from=$15`, `to=null` → "From $15"
    // and has no techs assigned → warning pill.
    const nailArt = page.locator(
      `[data-slot='service-row'][data-service-id='20000000-0000-0000-0000-000000000005']`
    );
    await expect(nailArt.locator("[data-slot='service-price-pill']")).toHaveText("From $15");
    const techPill = nailArt.locator("[data-slot='service-tech-pill']");
    await expect(techPill).toHaveText("No techs");
    await expect(techPill).toHaveAttribute("data-tone", "warning");
  });

  test("(b) search 'mani' narrows the catalog to manicure rows only", async ({ page }) => {
    await signInAsMaya(page);

    const input = page.locator("[data-slot='services-search-input']");
    await input.fill("mani");

    // Two matches: Classic manicure + Gel polish? No — search is substring
    // on `name`, not category. "mani" matches "Classic manicure" only (Gel
    // polish has no "mani"). Pedicure rows have "pedi" not "mani".
    const rows = page.locator("[data-slot='service-row']");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Classic manicure");

    // Only the Manicure group header is rendered — empty groups are stripped.
    const groupHeaders = await page
      .locator("[data-slot='services-group-header']")
      .allTextContents();
    expect(groupHeaders).toEqual(["Manicure"]);
  });

  test("(c) no-match search shows 'No services match your search.'", async ({ page }) => {
    await signInAsMaya(page);
    await page.locator("[data-slot='services-search-input']").fill("zzzz-not-a-service");
    await expect(page.locator("[data-slot='services-no-results']")).toHaveText(
      "No services match your search."
    );
    // The grouped list is gone (no groups rendered).
    await expect(page.locator("[data-slot='services-group']")).toHaveCount(0);
  });

  test("(d) Show-archived toggle reveals the archived seed row when on", async ({ page }) => {
    await signInAsMaya(page);

    // By default: 5 active rows; archived row is hidden.
    const rows = page.locator("[data-slot='service-row']");
    await expect(rows).toHaveCount(5);
    await expect(
      page.locator(`[data-slot='service-row'][data-service-id='${ARCHIVED_ID}']`)
    ).toHaveCount(0);

    // Toggle Show archived on.
    const toggle = page.locator("[data-slot='show-archived-toggle'] [data-slot='switch']");
    await toggle.click();

    await expect(rows).toHaveCount(6);
    const archivedRow = page.locator(`[data-slot='service-row'][data-service-id='${ARCHIVED_ID}']`);
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toHaveAttribute("data-archived", "true");
    await expect(archivedRow.locator("[data-slot='service-archived-badge']")).toHaveText(
      "Archived"
    );

    // Toggle off — archived disappears again.
    await toggle.click();
    await expect(rows).toHaveCount(5);
  });

  test("(e) clicking a row updates ?selected= in the URL (drawer not wired in US1)", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Sanity: bare URL initially.
    expect(new URL(page.url()).search).toBe("");

    // The row sits inside a <Link href="?selected=<id>"> — verify the href
    // and navigate via keyboard (same idiom as staff.spec.ts to avoid
    // pointer-event-intercept flakiness).
    const classicMani = page.locator(
      `[data-slot='service-row'][data-service-id='20000000-0000-0000-0000-000000000001']`
    );
    const link = classicMani.locator("xpath=ancestor::a");
    await expect(link).toHaveAttribute(
      "href",
      /\/services\?selected=20000000-0000-0000-0000-000000000001/
    );

    await link.focus();
    await link.press("Enter");
    await page.waitForURL(/\/services\?selected=.+/);

    // The row's data-selected flips to true. No overlay appears — the
    // drawer wiring lands in US2/US3.
    await expect(classicMani).toHaveAttribute("data-selected", "true");
  });
});

// Empty-state test runs in its own describe so the beforeAll wipe doesn't
// leak into the rest of the suite. It deletes every service row, asserts
// the empty state copy, then restores via re-running the seed SQL fragment
// in afterAll.
test.describe("US1 (empty-state): zero services in the catalog", () => {
  let supabaseUp = false;

  // We don't try to "restore the seed" automatically — that's the seed
  // file's job. Instead the test runs against an explicit blank table, and
  // re-seeds at the end via direct upsert so subsequent specs see the same
  // 5 active rows.
  const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 empty-state spec (Docker unavailable)."
      );
      return;
    }
  });

  test("(f) renders the Sparkles empty-state when the catalog is empty", async ({ page }) => {
    const c = createClient(url(), key(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Snapshot the current rows so we can put them back. The `services`
    // table is small (≤10 rows in tests) so this is cheap.
    const snapshot = await c
      .from("services")
      .select(
        "id, name, category, duration_min, price_cents, color_token, taxable, active, variable_price, price_from_cents, price_to_cents, variable_price_note"
      );
    if (snapshot.error) throw new Error(`snapshot read failed: ${snapshot.error.message}`);
    const assignmentsSnapshot = await c
      .from("staff_services")
      .select("service_id, staff_id, duration_min_override");
    if (assignmentsSnapshot.error) {
      throw new Error(`assignments snapshot read failed: ${assignmentsSnapshot.error.message}`);
    }

    // Wipe assignments first (FK on service_id), then services.
    {
      const { error } = await c.from("staff_services").delete().not("service_id", "is", null);
      if (error) throw new Error(`staff_services wipe failed: ${error.message}`);
    }
    {
      const { error } = await c.from("services").delete().not("id", "is", null);
      if (error) throw new Error(`services wipe failed: ${error.message}`);
    }

    try {
      await signInAsMaya(page);

      const emptyState = page.locator("[data-slot='services-empty-state']");
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toContainText(
        "Add your first service to start booking appointments."
      );

      // Summary reads 0 active · 0 total.
      await expect(page.locator("[data-slot='services-summary']")).toHaveText("0 active · 0 total");

      // No rows rendered.
      await expect(page.locator("[data-slot='service-row']")).toHaveCount(0);
    } finally {
      // Restore the seeded services + assignments. Service-role bypasses
      // RLS and cascades are not in play (we already wiped both tables).
      if ((snapshot.data ?? []).length > 0) {
        const { error } = await c
          .from("services")
          .upsert(snapshot.data ?? [], { onConflict: "id" });
        if (error) throw new Error(`services restore failed: ${error.message}`);
      }
      if ((assignmentsSnapshot.data ?? []).length > 0) {
        const { error } = await c
          .from("staff_services")
          .upsert(assignmentsSnapshot.data ?? [], { onConflict: "service_id,staff_id" });
        if (error) throw new Error(`assignments restore failed: ${error.message}`);
      }
    }
  });
});

// US2 — Add a new service via the drawer.
// Independent test (per tasks.md):
//   1. Click "Add service" → drawer slides in (mode=add).
//   2. Fill name + category (auto-fills "Other") + duration + price + color +
//      tick at least one tech → Save.
//   3. Drawer flips to Edit mode for the just-created service (URL gains
//      `?selected=<newId>`), the title reads "Edit service", primary button
//      label is "Save changes", new row appears in the list, and the
//      `?toast=service_added&name=...` URL fragment is set.
//   4. Repeat with zero techs ticked → assert `&secondary=no_techs_assigned`
//      is also appended.
test.describe("US2: add a new service via the drawer", () => {
  let supabaseUp = false;

  // IDs of services this describe creates — wiped in afterAll so re-runs are
  // idempotent and other specs aren't polluted.
  const createdIds: string[] = [];

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 services specs (Docker unavailable)."
      );
      return;
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp || createdIds.length === 0) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Wipe assignments first (FK), then services.
    await c.from("staff_services").delete().in("service_id", createdIds);
    await c.from("services").delete().in("id", createdIds);
  });

  test("(a) Add service with one tech → drawer flips to Edit, toast + row appear", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Click the Add service link in the catalog list.
    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    // Drawer is visible in add mode.
    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "add");
    await expect(drawer.locator("[data-slot='services-drawer-title']")).toHaveText("Add service");

    // Fill the form. The category field is pre-filled with "Other" per
    // Clarifications Q3 — change it so the new service lands in a known
    // category for the list assertion.
    await page.locator("[data-slot='service-form-name-input']").fill("Polish change");
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Manicure");
    await page.locator("[data-slot='service-form-duration-input']").fill("");
    await page.locator("[data-slot='service-form-duration-input']").fill("20");
    await page.locator("[data-slot='service-form-price-input']").fill("18");

    // Tick the first staff row (Jordan).
    const jordanRow = page.locator(
      "[data-slot='staff-assignment-row'][data-staff-id='10000000-0000-0000-0000-000000000002']"
    );
    await jordanRow.locator("[data-slot='staff-assignment-checkbox']").check();

    // Save.
    await page.locator("[data-slot='services-drawer-save']").click();

    // Redirect lands on `?selected=<newId>&toast=service_added&name=Polish%20change`.
    await page.waitForURL(/\?selected=[^&]+&toast=service_added&name=Polish/);

    // Capture the newly-created id for afterAll cleanup.
    const url = new URL(page.url());
    const newId = url.searchParams.get("selected");
    expect(newId).toBeTruthy();
    if (newId) createdIds.push(newId);

    // Drawer is now in Edit mode for the just-created service.
    await expect(drawer).toHaveAttribute("data-mode", "edit");
    await expect(drawer.locator("[data-slot='services-drawer-title']")).toHaveText("Edit service");

    // Primary button label flips to "Save changes" and is disabled (clean
    // baseline = no diff).
    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toHaveText("Save changes");
    await expect(save).toBeDisabled();

    // The Archive slot is now visible (Phase 4 ships the slot; Phase 6
    // wires the button — for now it renders the label text).
    await expect(
      page.locator("[data-slot='services-drawer-bottom-action'][data-archive-state='active']")
    ).toBeVisible();

    // The new row appears in the catalog list.
    const newRow = page.locator(`[data-slot='service-row'][data-service-id='${newId}']`);
    await expect(newRow).toBeVisible();
    await expect(newRow.locator("[data-slot='service-name']")).toHaveText("Polish change");
    await expect(newRow.locator("[data-slot='service-price-pill']")).toHaveText("$18");
    await expect(newRow.locator("[data-slot='service-tech-pill']")).toHaveText("1 tech");
  });

  test("(b) Add service with zero techs → secondary no_techs_assigned param fires", async ({
    page,
  }) => {
    await signInAsMaya(page);

    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    await page.locator("[data-slot='service-form-name-input']").fill("Hot stone add-on");
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Add-on");
    await page.locator("[data-slot='service-form-duration-input']").fill("");
    await page.locator("[data-slot='service-form-duration-input']").fill("15");
    await page.locator("[data-slot='service-form-price-input']").fill("10");

    // Intentionally tick no staff — the secondary toast should fire.
    await page.locator("[data-slot='services-drawer-save']").click();

    // Both `toast=service_added` AND `secondary=no_techs_assigned` must
    // be present in the URL — the URL-toast bridge (Phase 9) consumes both.
    await page.waitForURL(
      /\?selected=[^&]+&toast=service_added&name=Hot[^&]+&secondary=no_techs_assigned/
    );

    const url = new URL(page.url());
    const newId = url.searchParams.get("selected");
    expect(newId).toBeTruthy();
    if (newId) createdIds.push(newId);
    expect(url.searchParams.get("secondary")).toBe("no_techs_assigned");

    // Drawer flipped to Edit mode for the new service.
    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");

    // Tech-count pill on the new row reads "No techs" in warning tone.
    const newRow = page.locator(`[data-slot='service-row'][data-service-id='${newId}']`);
    const techPill = newRow.locator("[data-slot='service-tech-pill']");
    await expect(techPill).toHaveText("No techs");
    await expect(techPill).toHaveAttribute("data-tone", "warning");
  });
});

// US3 — Edit a service's details and per-tech assignments.
//
// Independent test (per tasks.md): click a seeded row → drawer hydrates with
// every field pre-filled (incl. the Spa pedicure's per-tech 75-min override
// for Sam) → change the price, untick a tech, set a per-tech override →
// save → assert the list row updated, the toast URL fragment, and at the end
// of the spec read back `staff_services` rows + the `audit_log` row to
// confirm the DB reflects the diff and the audit payload matches
// `contracts/audit.contract.md § 2`.
//
// Stable id references for the seeded rows used in this describe:
const SPA_PEDICURE_ID = "20000000-0000-0000-0000-000000000004";
const CLASSIC_PEDICURE_ID = "20000000-0000-0000-0000-000000000003";
const JORDAN_ID = "10000000-0000-0000-0000-000000000002";
const SAM_ID = "10000000-0000-0000-0000-000000000003";

test.describe("US3: edit a service's details and per-tech assignments", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 services specs (Docker unavailable)."
      );
      return;
    }
    // Reset the seeded staff_services rows for the two services this
    // describe touches so re-runs are deterministic (the test wipes Sam's
    // override and unticks Jordan from Classic pedicure, so restore both
    // before the run).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Wipe + restore Spa pedicure's assignment (Sam @ 75).
    await c.from("staff_services").delete().eq("service_id", SPA_PEDICURE_ID);
    await c
      .from("staff_services")
      .upsert(
        { service_id: SPA_PEDICURE_ID, staff_id: SAM_ID, duration_min_override: 75 },
        { onConflict: "service_id,staff_id" }
      );
    // Wipe + restore Classic pedicure's two assignments (Jordan + Sam, no override).
    await c.from("staff_services").delete().eq("service_id", CLASSIC_PEDICURE_ID);
    await c.from("staff_services").upsert(
      [
        {
          service_id: CLASSIC_PEDICURE_ID,
          staff_id: JORDAN_ID,
          duration_min_override: null,
        },
        {
          service_id: CLASSIC_PEDICURE_ID,
          staff_id: SAM_ID,
          duration_min_override: null,
        },
      ],
      { onConflict: "service_id,staff_id" }
    );
    // Restore Classic pedicure's services-row baseline (the test changes
    // price + color; the next run must start from the seeded values).
    await c
      .from("services")
      .update({
        name: "Classic pedicure",
        category: "Pedicure",
        duration_min: 45,
        price_cents: 4000,
        color_token: "--avatar-green",
        taxable: true,
        active: true,
        variable_price: false,
        price_from_cents: null,
        price_to_cents: null,
        variable_price_note: null,
      })
      .eq("id", CLASSIC_PEDICURE_ID);

    // Truncate audit_log so this describe's audit assertion is deterministic.
    await truncateAuditLog();
  });

  test("(a) clicking Spa pedicure hydrates the drawer with Sam @ 75-min override pre-filled", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Click the Spa pedicure row → URL gains ?selected=...
    const row = page.locator(`[data-slot='service-row'][data-service-id='${SPA_PEDICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(/\?selected=20000000-0000-0000-0000-000000000004/);

    // Drawer opens in Edit mode.
    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");
    await expect(drawer.locator("[data-slot='services-drawer-title']")).toHaveText("Edit service");

    // Every form field is pre-filled from the saved baseline.
    await expect(page.locator("[data-slot='service-form-name-input']")).toHaveValue("Spa pedicure");
    await expect(page.locator("[data-slot='service-form-category-input']")).toHaveValue("Pedicure");
    await expect(page.locator("[data-slot='service-form-duration-input']")).toHaveValue("60");
    await expect(page.locator("[data-slot='service-form-price-input']")).toHaveValue("55");

    // Color swatch — teal is the seeded color for Spa pedicure.
    await expect(
      page.locator("[data-slot='service-color-swatch'][data-color-token='--avatar-teal']")
    ).toHaveAttribute("data-checked", "true");

    // Sam is ticked; Jordan is not. Sam's override input reads "75".
    const samRow = page.locator(`[data-slot='staff-assignment-row'][data-staff-id='${SAM_ID}']`);
    await expect(samRow).toHaveAttribute("data-checked", "true");
    await expect(samRow.locator("[data-slot='staff-assignment-override-input']")).toHaveValue("75");

    const jordanRow = page.locator(
      `[data-slot='staff-assignment-row'][data-staff-id='${JORDAN_ID}']`
    );
    await expect(jordanRow).toHaveAttribute("data-checked", "false");

    // Save is disabled because the draft is clean (matches baseline).
    await expect(page.locator("[data-slot='services-drawer-save']")).toBeDisabled();
  });

  test("(b) edit Classic pedicure: change price + untick Sam + add a 50-min override for Jordan → save → list row updates + DB reflects the diff", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Click Classic pedicure → drawer opens with both Jordan + Sam ticked.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_PEDICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(/\?selected=20000000-0000-0000-0000-000000000003/);

    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");

    // Baseline state spot-check.
    await expect(page.locator("[data-slot='service-form-price-input']")).toHaveValue("40");
    const samRow = page.locator(`[data-slot='staff-assignment-row'][data-staff-id='${SAM_ID}']`);
    const jordanRow = page.locator(
      `[data-slot='staff-assignment-row'][data-staff-id='${JORDAN_ID}']`
    );
    await expect(samRow).toHaveAttribute("data-checked", "true");
    await expect(jordanRow).toHaveAttribute("data-checked", "true");

    // Change the price 40 → 50.
    const priceInput = page.locator("[data-slot='service-form-price-input']");
    await priceInput.fill("");
    await priceInput.fill("50");

    // Untick Sam.
    await samRow.locator("[data-slot='staff-assignment-checkbox']").uncheck();
    await expect(samRow).toHaveAttribute("data-checked", "false");

    // Set Jordan's per-tech override to 50.
    const jordanOverride = jordanRow.locator("[data-slot='staff-assignment-override-input']");
    await jordanOverride.fill("50");

    // Save — button is enabled because diff is non-empty.
    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeEnabled();
    await save.click();

    // Redirect lands on `?selected=<id>&toast=changes_saved`.
    await page.waitForURL(/\?selected=20000000-0000-0000-0000-000000000003&toast=changes_saved/);

    // List row shows the new price.
    const updatedRow = page.locator(
      `[data-slot='service-row'][data-service-id='${CLASSIC_PEDICURE_ID}']`
    );
    await expect(updatedRow.locator("[data-slot='service-price-pill']")).toHaveText("$50");
    // Tech pill now reads "1 tech" (Sam unticked, Jordan still ticked).
    await expect(updatedRow.locator("[data-slot='service-tech-pill']")).toHaveText("1 tech");
  });

  test("(c) DB reflects the staff_services diff and audit_log has a service.updated row with the documented payload shape", async () => {
    if (!supabaseUp) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // staff_services for Classic pedicure → only Jordan with a 50-min override.
    const { data: assignmentRows, error: assignErr } = await c
      .from("staff_services")
      .select("staff_id, duration_min_override")
      .eq("service_id", CLASSIC_PEDICURE_ID);
    if (assignErr) throw new Error(`staff_services read failed: ${assignErr.message}`);
    expect(assignmentRows).toHaveLength(1);
    expect(assignmentRows![0]).toEqual({
      staff_id: JORDAN_ID,
      duration_min_override: 50,
    });

    // services row — price_cents updated to 5000.
    const { data: serviceRow, error: serviceErr } = await c
      .from("services")
      .select("price_cents")
      .eq("id", CLASSIC_PEDICURE_ID)
      .single();
    if (serviceErr) throw new Error(`services read failed: ${serviceErr.message}`);
    expect(serviceRow!.price_cents).toBe(5000);

    // Audit row — exactly one `service.updated` row for this service id.
    const auditRows = await getAuditLogRows("service.updated");
    const matchRow = auditRows.find((r) => r.entity_id === CLASSIC_PEDICURE_ID);
    expect(matchRow).toBeDefined();
    expect(matchRow!.entity_type).toBe("service");
    const payload = matchRow!.payload as {
      changes: Record<string, [unknown, unknown]>;
      assignment_changes: {
        added: string[];
        removed: string[];
        overrides_changed: Array<{
          staff_id: string;
          before: number | null;
          after: number | null;
        }>;
      };
      before: { price_cents: number; assignment_ids: string[]; active: boolean };
      after: { price_cents: number; assignment_ids: string[]; active: boolean };
    };

    // changes: price_cents only (no other fields edited).
    expect(payload.changes).toEqual({ price_cents: [4000, 5000] });

    // assignment_changes: Sam removed, no one added, Jordan's override
    // changed (null → 50).
    expect(payload.assignment_changes.added).toEqual([]);
    expect(payload.assignment_changes.removed).toEqual([SAM_ID]);
    expect(payload.assignment_changes.overrides_changed).toEqual([
      { staff_id: JORDAN_ID, before: null, after: 50 },
    ]);

    // before/after snapshots: price_cents reflects the diff; assignment_ids
    // reflects the membership.
    expect(payload.before.price_cents).toBe(4000);
    expect(payload.after.price_cents).toBe(5000);
    expect(payload.before.assignment_ids.sort()).toEqual([JORDAN_ID, SAM_ID].sort());
    expect(payload.after.assignment_ids).toEqual([JORDAN_ID]);
    // `active` is never changed by updateService.
    expect(payload.before.active).toBe(true);
    expect(payload.after.active).toBe(true);
  });
});

// US4 — Archive or restore a service.
//
// Independent test (per tasks.md): open a seeded service in the drawer →
// click "Archive service" → dialog renders with the FR-025 body copy →
// confirm → row disappears from the default view, returns under
// Show-archived, toast URL fragment fires, and the drawer's bottom action
// flips to "Restore service". Click Restore → row returns to the default
// view, toast fires, action flips back to "Archive service".
//
// Uses Gel polish (id `…000002`) so the seeded Classic-manicure / Classic-
// pedicure / Spa-pedicure / Nail-art rows used by US1/US2/US3 stay
// untouched between specs.
const GEL_POLISH_ID = "20000000-0000-0000-0000-000000000002";

test.describe("US4: archive or restore a service", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US4 services specs (Docker unavailable)."
      );
      return;
    }
    // Ensure Gel polish starts active so the archive step has something to
    // flip. Idempotent — re-runs reset to the seeded state.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await c.from("services").update({ active: true }).eq("id", GEL_POLISH_ID);
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    // Restore Gel polish to active so unrelated specs see the seeded state.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await c.from("services").update({ active: true }).eq("id", GEL_POLISH_ID);
  });

  test("(a) archive Gel polish → dialog text, row removal, toast, bottom action flips to Restore", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Open Gel polish in the drawer via row click (keyboard idiom mirrors
    // the US1/US3 tests so pointer-event interception doesn't flake).
    const row = page.locator(`[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${GEL_POLISH_ID}`));

    // Drawer is in Edit mode and the bottom action reads "Archive service"
    // (baseline.active === true).
    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");
    const archiveBtn = page.locator("[data-slot='services-drawer-archive-button']");
    await expect(archiveBtn).toBeVisible();
    await expect(archiveBtn).toHaveText("Archive service");

    // Click Archive → confirmation dialog renders with the FR-025 copy
    // (title interpolates the service name; body is verbatim).
    await archiveBtn.click();
    const dialog = page.locator("[data-slot='archive-dialog']");
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-slot='archive-dialog-title']")).toContainText(
      "Archive Gel polish?"
    );
    await expect(page.locator("[data-slot='archive-dialog-body']")).toHaveText(
      "Gel polish won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time."
    );

    // Confirm — the dialog's submit posts to `archiveService`.
    await page.locator("[data-slot='archive-dialog-confirm']").click();

    // Redirect lands on `?selected=<id>&toast=service_archived&name=Gel%20polish`.
    await page.waitForURL(
      new RegExp(`\\?selected=${GEL_POLISH_ID}&toast=service_archived&name=Gel`)
    );

    // Drawer is still open on Gel polish (URL preserved `?selected=`), and
    // the bottom action has flipped to "Restore service". Assert this
    // BEFORE closing the drawer (the toggle assertion below requires the
    // drawer closed because the backdrop intercepts pointer events).
    await expect(drawer).toHaveAttribute("data-mode", "edit");
    const restoreBtn = page.locator("[data-slot='services-drawer-restore-button']");
    await expect(restoreBtn).toBeVisible();
    await expect(restoreBtn).toHaveText("Restore service");
    // Archive button is no longer rendered.
    await expect(page.locator("[data-slot='services-drawer-archive-button']")).toHaveCount(0);

    // Close the drawer so the catalog list is interactive again. The
    // baseline is clean (no edits) so Cancel closes silently — no discard
    // dialog.
    await page.locator("[data-slot='services-drawer-cancel']").click();
    await page.waitForURL(/\/services$/);

    // Default view (archived hidden): Gel polish row is gone.
    await expect(
      page.locator(`[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`)
    ).toHaveCount(0);

    // Toggle Show archived on — the row reappears with the Archived badge
    // and reduced-opacity treatment.
    const toggle = page.locator("[data-slot='show-archived-toggle'] [data-slot='switch']");
    await toggle.click();
    const archivedRow = page.locator(
      `[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`
    );
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toHaveAttribute("data-archived", "true");
    await expect(archivedRow.locator("[data-slot='service-archived-badge']")).toHaveText(
      "Archived"
    );
  });

  test("(b) restore Gel polish → row returns to the default view, toast fires, bottom action flips back to Archive", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Sanity: the previous test left Gel polish archived. Re-open it via
    // Show-archived so the drawer can be hydrated for the restore step.
    const toggle = page.locator("[data-slot='show-archived-toggle'] [data-slot='switch']");
    await toggle.click();

    const row = page.locator(`[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`);
    await expect(row).toHaveAttribute("data-archived", "true");
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${GEL_POLISH_ID}`));

    // Drawer renders the Restore button (no dialog for restore).
    const restoreBtn = page.locator("[data-slot='services-drawer-restore-button']");
    await expect(restoreBtn).toBeVisible();
    await expect(restoreBtn).toHaveText("Restore service");

    await restoreBtn.click();

    // Redirect lands on `?selected=<id>&toast=service_restored&name=Gel%20polish`.
    await page.waitForURL(
      new RegExp(`\\?selected=${GEL_POLISH_ID}&toast=service_restored&name=Gel`)
    );

    // Row is back in the default view (the page reload + URL strips
    // `?showArchived` is sessionStorage-only; the toggle resets to off).
    // We don't make a strict count assertion (other specs may have added
    // rows); we assert the Gel polish row is present and NOT archived.
    const restoredRow = page.locator(
      `[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`
    );
    await expect(restoredRow).toBeVisible();
    await expect(restoredRow).toHaveAttribute("data-archived", "false");

    // Bottom action flips back to "Archive service".
    const archiveBtn = page.locator("[data-slot='services-drawer-archive-button']");
    await expect(archiveBtn).toBeVisible();
    await expect(archiveBtn).toHaveText("Archive service");
    await expect(page.locator("[data-slot='services-drawer-restore-button']")).toHaveCount(0);
  });
});

// US5 — Variable-price services with bounds and a note.
//
// Independent test (per tasks.md):
//   1. Add a Variable-price service with no bounds → list pill reads
//      "Variable" and the DB row's `price_cents = 0`.
//   2. Edit → set From $20 → pill reads "From $20" (and the DB row's
//      `price_from_cents = 2000`).
//   3. Set To $60 → pill reads "$20 – $60".
//   4. Set To $10 (less than From) → inline bounds error renders + Save is
//      disabled.
//   5. Toggle Variable off, supply a fixed price → variable-only fields are
//      cleared in the draft AND nulled in the DB (the
//      `services_fixed_price_consistency_chk` DB constraint requires it),
//      single price re-appears in the form, list pill reads the fixed
//      price.
test.describe("US5: variable-price services with bounds and a note", () => {
  let supabaseUp = false;
  const createdIds: string[] = [];

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US5 services specs (Docker unavailable)."
      );
      return;
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp || createdIds.length === 0) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await c.from("staff_services").delete().in("service_id", createdIds);
    await c.from("services").delete().in("id", createdIds);
  });

  test("(a) Add a variable-price service with no bounds → 'Variable' pill, DB price_cents = 0", async ({
    page,
  }) => {
    await signInAsMaya(page);

    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    await page.locator("[data-slot='service-form-name-input']").fill("Custom design");
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Add-on");
    await page.locator("[data-slot='service-form-duration-input']").fill("");
    await page.locator("[data-slot='service-form-duration-input']").fill("30");

    // Flip Variable on — the price input disappears and From/To/note appear.
    const variableSwitch = page.locator("[data-slot='service-form-variable-switch']");
    await variableSwitch.click();
    await expect(page.locator("[data-slot='service-form-price-input']")).toHaveCount(0);
    await expect(page.locator("[data-slot='service-form-price-from-input']")).toBeVisible();
    await expect(page.locator("[data-slot='service-form-price-to-input']")).toBeVisible();
    // Leave both bounds blank — save with no bounds set.

    await page.locator("[data-slot='services-drawer-save']").click();
    await page.waitForURL(/\?selected=[^&]+&toast=service_added&name=Custom/);

    const url = new URL(page.url());
    const newId = url.searchParams.get("selected");
    expect(newId).toBeTruthy();
    if (newId) createdIds.push(newId);

    // List row pill reads "Variable" (no bounds → no range).
    const newRow = page.locator(`[data-slot='service-row'][data-service-id='${newId}']`);
    await expect(newRow.locator("[data-slot='service-price-pill']")).toHaveText("Variable");

    // DB row: variable_price=true, price_cents=0, both bounds null.
    const c = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: row, error } = await c
      .from("services")
      .select("variable_price, price_cents, price_from_cents, price_to_cents, variable_price_note")
      .eq("id", newId!)
      .single();
    if (error) throw new Error(`services read failed: ${error.message}`);
    expect(row).toEqual({
      variable_price: true,
      price_cents: 0,
      price_from_cents: null,
      price_to_cents: null,
      variable_price_note: null,
    });
  });

  test("(b) Set From $20 only → 'From $20' pill; then To $60 → '$20 – $60' pill", async ({
    page,
  }) => {
    await signInAsMaya(page);
    // Edit the service created in (a).
    const id = createdIds[0];
    expect(id).toBeTruthy();
    await page.goto(`/services?selected=${id}`);

    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");

    // Set From $20.
    const fromInput = page.locator("[data-slot='service-form-price-from-input']");
    await fromInput.fill("20");

    // Save → "From $20" pill.
    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(new RegExp(`\\?selected=${id}&toast=changes_saved`));

    const row = page.locator(`[data-slot='service-row'][data-service-id='${id}']`);
    await expect(row.locator("[data-slot='service-price-pill']")).toHaveText("From $20");

    // Set To $60 → pill becomes "$20 – $60".
    await page.locator("[data-slot='service-form-price-to-input']").fill("60");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(new RegExp(`\\?selected=${id}&toast=changes_saved`));

    await expect(row.locator("[data-slot='service-price-pill']")).toHaveText("$20 – $60");
  });

  test("(c) Set To < From → inline bounds error + Save disabled", async ({ page }) => {
    await signInAsMaya(page);
    const id = createdIds[0];
    expect(id).toBeTruthy();
    await page.goto(`/services?selected=${id}`);

    // Drop To from 60 down to 10 — now To < From (20).
    const toInput = page.locator("[data-slot='service-form-price-to-input']");
    await toInput.fill("");
    await toInput.fill("10");

    // The inline error hint surfaces and Save is disabled.
    const variablePriceRow = page.locator(".service-variable-price-row");
    // The bounds-inverted hint renders as the last error span in the price
    // field — search by text rather than slot to keep the assertion stable
    // across DOM shape tweaks.
    await expect(page.getByText('"From" price can\'t be higher than "To" price.')).toBeVisible();
    expect(await variablePriceRow.count()).toBeGreaterThan(0);

    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeDisabled();

    // Fix To to 65 (different from the 60 baseline so the draft is dirty
    // AND the error is clear) — error hint clears, Save re-enables.
    await toInput.fill("");
    await toInput.fill("65");
    await expect(page.getByText('"From" price can\'t be higher than "To" price.')).toHaveCount(0);
    await expect(save).toBeEnabled();
  });

  test("(d) Toggle Variable off → fields clear, fixed price re-appears, DB nullifies variable-only columns", async ({
    page,
  }) => {
    await signInAsMaya(page);
    const id = createdIds[0];
    expect(id).toBeTruthy();
    await page.goto(`/services?selected=${id}`);

    // Toggle Variable off — the From/To/note inputs disappear and the fixed
    // price input reappears with an empty value (per the toggle-off clear).
    const variableSwitch = page.locator("[data-slot='service-form-variable-switch']");
    await variableSwitch.click();

    await expect(page.locator("[data-slot='service-form-price-from-input']")).toHaveCount(0);
    await expect(page.locator("[data-slot='service-form-price-to-input']")).toHaveCount(0);
    const priceInput = page.locator("[data-slot='service-form-price-input']");
    await expect(priceInput).toBeVisible();
    await expect(priceInput).toHaveValue("");

    // Supply a fixed price and save.
    await priceInput.fill("30");
    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(new RegExp(`\\?selected=${id}&toast=changes_saved`));

    // List row reads the fixed price.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${id}']`);
    await expect(row.locator("[data-slot='service-price-pill']")).toHaveText("$30");

    // DB row: variable_price=false and all three variable-only columns NULL
    // (matches the services_fixed_price_consistency_chk CHECK constraint).
    const c = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: dbRow, error } = await c
      .from("services")
      .select("variable_price, price_cents, price_from_cents, price_to_cents, variable_price_note")
      .eq("id", id)
      .single();
    if (error) throw new Error(`services read failed: ${error.message}`);
    expect(dbRow).toEqual({
      variable_price: false,
      price_cents: 3000,
      price_from_cents: null,
      price_to_cents: null,
      variable_price_note: null,
    });
  });
});

// US6 — Restrict who can manage the catalog.
//
// Independent test (per tasks.md T048): sign in as the seeded technician
// (Sam Chen, PIN 9999) → /services renders the read-only catalog
// → "Add service" button is disabled with the FR-030 tooltip and remains
// keyboard-reachable → clicking a row opens the drawer in read-only mode
// (every input / toggle / swatch / checkbox / override field is disabled,
// the bottom Save slot is replaced with a "View only" chip and the
// Archive/Restore action is suppressed). The server-side gate is covered
// independently by the `assertCanWriteCatalog` unit tests (T013) — see the
// note on the deferred direct-POST assertion at the end of this describe.
//
// Sam's seed state: `user_id: null`, so Sam can't sign in directly via
// email+password. Like `staff.spec.ts § signInAsSam`, the device user
// (owner@tangnails.dev) is used and Sam is picked at /select-staff with
// PIN 9999. The signed-in result is a technician-role studio session.
async function signInAsSamOnServicesPage(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fservices");
  await page.locator("#email").fill("owner@tangnails.dev");
  await page.getByLabel("Password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Sam Chen/ }).click();
  await page.waitForURL(/selectedTileId=/);
  for (const d of ["9", "9", "9", "9"]) {
    await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  // /services is a top-level route (not under /settings); it gates itself
  // and is reachable for technicians in read-only mode (FR-029). Other
  // restricted settings pages still gate themselves inside their own page.tsx.
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

test.describe("US6: restrict who can manage the catalog", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US6 services specs (Docker unavailable)."
      );
      return;
    }
  });

  test("(a) technician sees the catalog read-only with disabled Add button and tooltip", async ({
    page,
  }) => {
    await signInAsSamOnServicesPage(page);
    expect(new URL(page.url()).pathname).toBe("/services");

    // The catalog list still renders the seeded rows — read access is
    // universal per FR-029.
    const rows = page.locator("[data-slot='service-row']");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // The Add service button is rendered as a disabled affordance with the
    // FR-030 tooltip. It's a real focusable element so a keyboard user can
    // Tab to it and read the explanation (radix Tooltip listens for focus).
    const addButton = page.locator("[data-slot='services-add-button']");
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveAttribute("aria-disabled", "true");

    // Focus the trigger — that fires the shadcn Tooltip (delayDuration=100)
    // without needing pointer hover (keyboard reachability per T047).
    await addButton.focus();
    await expect(page.locator("[data-slot='services-add-button-tooltip']")).toContainText(
      "Only owners and managers can edit the catalog"
    );
  });

  test("(b) clicking a row opens the drawer in read-only mode (every control disabled, View only chip in footer)", async ({
    page,
  }) => {
    await signInAsSamOnServicesPage(page);

    // Use Classic manicure (id `…000001`) — the seeded fixed-price row used
    // by US1 spec (a). Open it via the same keyboard navigation idiom the
    // other specs use to avoid pointer-event interception flakes.
    const row = page.locator(
      `[data-slot='service-row'][data-service-id='20000000-0000-0000-0000-000000000001']`
    );
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(/\?selected=20000000-0000-0000-0000-000000000001/);

    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");

    // Every primary form control is disabled.
    await expect(page.locator("[data-slot='service-form-name-input']")).toBeDisabled();
    await expect(page.locator("[data-slot='service-form-category-input']")).toBeDisabled();
    await expect(page.locator("[data-slot='service-form-duration-input']")).toBeDisabled();
    await expect(page.locator("[data-slot='service-form-price-input']")).toBeDisabled();

    // The taxable + variable_price switches (shadcn renders the switch root
    // with `data-slot="switch"` and reflects disabled state via
    // `data-disabled` + the native `disabled` prop on the underlying button).
    const taxable = page.locator("[data-slot='service-form-taxable-switch']");
    await expect(taxable).toBeDisabled();
    const variable = page.locator("[data-slot='service-form-variable-switch']");
    await expect(variable).toBeDisabled();

    // Every color swatch radio is disabled (the <fieldset disabled> wraps
    // the radio group, which cascades the disabled state to every <input>).
    const swatchInputs = page.locator(
      "[data-slot='service-form-color-swatches'] input[type='radio']"
    );
    const swatchCount = await swatchInputs.count();
    expect(swatchCount).toBeGreaterThan(0);
    for (let i = 0; i < swatchCount; i++) {
      await expect(swatchInputs.nth(i)).toBeDisabled();
    }

    // Every staff-assignment checkbox is disabled. Classic manicure has 2
    // techs assigned in the seed → the override inputs for those rows are
    // also disabled (the row is ticked, but read-only forces the field off).
    const checkboxes = page.locator("[data-slot='staff-assignment-checkbox']");
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);
    for (let i = 0; i < checkboxCount; i++) {
      await expect(checkboxes.nth(i)).toBeDisabled();
    }
    const overrideInputs = page.locator("[data-slot='staff-assignment-override-input']");
    const overrideCount = await overrideInputs.count();
    for (let i = 0; i < overrideCount; i++) {
      await expect(overrideInputs.nth(i)).toBeDisabled();
    }

    // The footer renders the "View only" chip in place of the Save button.
    // Cancel stays visible so the operator can close the drawer.
    await expect(page.locator("[data-slot='services-drawer-view-only-chip']")).toHaveText(
      "View only"
    );
    await expect(page.locator("[data-slot='services-drawer-save']")).toHaveCount(0);
    await expect(page.locator("[data-slot='services-drawer-cancel']")).toBeVisible();

    // Archive/Restore bottom action is suppressed (T041's gate runs on
    // `canWriteCatalog(operatorRole)`; a technician sees neither button).
    await expect(page.locator("[data-slot='services-drawer-archive-button']")).toHaveCount(0);
    await expect(page.locator("[data-slot='services-drawer-restore-button']")).toHaveCount(0);

    // Cancel closes the drawer silently — draft is clean by definition in
    // read-only mode (every control is disabled, so the discard dialog is
    // unreachable per T046).
    await page.locator("[data-slot='services-drawer-cancel']").click();
    await page.waitForURL(/\/services$/);
  });

  // NOTE on the deferred direct-POST `?error=forbidden` assertion:
  //
  // T048 originally asked for a `page.request.post()` call against
  // `addService` with a forged FormData payload to assert the redirect to
  // `?error=forbidden` and the destructive toast. Next.js 16 Server Actions
  // are dispatched via a POST that includes a generated `Next-Action`
  // header pointing at the bundler-specific action id — re-creating the
  // exact request from a Playwright fixture is brittle (the id changes on
  // every rebuild) and would couple this test to internal RSC framing.
  //
  // The defense-in-depth gate is already covered:
  //   1. Pure-function unit test — `tests/unit/services/permissions.test.ts`
  //      (T013) asserts `assertCanWriteCatalog('technician')` throws a
  //      PermissionError with `code = "forbidden"`.
  //   2. Server Action prelude — every action in
  //      `app/(studio)/services/actions.ts` calls
  //      `assertCanWriteCatalog(viewer.staff.role)` before any mutation;
  //      the catch arm at `handleKnownError()` redirects to
  //      `?error=forbidden` (visible in actions.ts line ~76).
  //   3. UI gate (this spec, parts (a) and (b)) — a technician can't even
  //      click "Add service" or any save button to dispatch the action via
  //      a legitimate path.
  //
  // If a future regression suite needs a true direct-POST forbidden path,
  // the right move is to expose a small REST-like endpoint that wraps
  // `addService` and emits the same redirect; that's out of scope here.
});

// US7 — Get clear feedback after every action.
//
// Phase 9 mounts `<ServicesToaster />` on `/services`. It reads
// `?toast`, `?secondary`, `?name`, `?error` from the URL on every navigation,
// fires the matching Sonner toast(s) per the `TOASTS` map in
// `app/(studio)/services/toasts.ts`, then strips the consumed
// params via `window.history.replaceState` (preserving `?selected=` and
// `?adding=` so the drawer state survives).
//
// Independent test (per tasks.md T051): trigger each mutation in sequence
// (add → edit → archive → restore) and assert exactly one toast is visible
// at each step with the correct copy. Fire two mutations back-to-back and
// assert the first dismisses when the second fires.
//
// We use a dedicated test service ("Lacquer touch-up") so we don't pollute
// the seeded rows other describes assert against.

test.describe("US7: get clear feedback after every action", () => {
  let supabaseUp = false;

  // Track every service id created during this describe so afterAll can
  // wipe them — re-runs stay idempotent and other specs see the seed.
  const createdIds: string[] = [];

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US7 services specs (Docker unavailable)."
      );
      return;
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (createdIds.length > 0) {
      await c.from("staff_services").delete().in("service_id", createdIds);
      await c.from("services").delete().in("id", createdIds);
    }
    // Restore Classic manicure to its seeded baseline. US7(b) mutates the
    // price 25 → 26 → 27 to assert the bridge dismisses the prior toast on
    // a second save. Without this restore, the next full-suite run (or
    // re-run on the same DB) starts with the wrong price and US1(a)'s
    // "$25" assertion fails. Seed values are mirrored from
    // `supabase/seed.sql` lines ~140-153.
    await c
      .from("services")
      .update({
        name: "Classic manicure",
        category: "Manicure",
        duration_min: 30,
        price_cents: 2500,
        color_token: "--avatar-rose",
        taxable: true,
        active: true,
        variable_price: false,
        price_from_cents: null,
        price_to_cents: null,
        variable_price_note: null,
      })
      .eq("id", "20000000-0000-0000-0000-000000000001");
  });

  test("(a) add → edit → archive → restore each fires exactly one toast with the documented copy", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // ── Step 1: add ─────────────────────────────────────────────────────
    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    await page.locator("[data-slot='service-form-name-input']").fill("Lacquer touch-up");
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Manicure");
    await page.locator("[data-slot='service-form-duration-input']").fill("");
    await page.locator("[data-slot='service-form-duration-input']").fill("15");
    await page.locator("[data-slot='service-form-price-input']").fill("12");

    // Tick Jordan so the secondary `no_techs_assigned` toast does NOT fire
    // — this step asserts the singular success-toast case.
    const jordanRow = page.locator(
      "[data-slot='staff-assignment-row'][data-staff-id='10000000-0000-0000-0000-000000000002']"
    );
    await jordanRow.locator("[data-slot='staff-assignment-checkbox']").check();

    await page.locator("[data-slot='services-drawer-save']").click();

    // Toast fires + params get stripped. Assert the toast first (it appears
    // on the redirect with `?toast=service_added&name=Lacquer%20touch-up`),
    // then the URL settles to just `?selected=<id>` after the bridge runs.
    const addedToast = page.locator("[data-sonner-toast]").first();
    await expect(addedToast).toBeVisible({ timeout: 5_000 });
    await expect(addedToast).toContainText("Lacquer touch-up added to the catalog");
    await expect(addedToast).toHaveAttribute("data-type", "success");

    // Exactly one visible toast on screen (Sonner `expand={false}` collapses
    // any prior toast under the front one; we assert via the visible state,
    // not raw count, to mirror US7 staff behavior).
    await expect(page.locator("[data-sonner-toast][data-visible='true']")).toHaveCount(1);

    // Wait for the bridge to strip the toast params; `?selected=<id>` stays.
    // Four `null` values joined by "|" → three separators → "|||" (a missing
    // param returns `null` which stringifies to ""; the empty strings on
    // either side of each "|" make this read as the empty-quadruple).
    await expect
      .poll(() => {
        const u = new URL(page.url());
        return [
          u.searchParams.get("toast"),
          u.searchParams.get("name"),
          u.searchParams.get("secondary"),
          u.searchParams.get("error"),
        ].join("|");
      })
      .toBe("|||");

    const newId = new URL(page.url()).searchParams.get("selected");
    expect(newId).toBeTruthy();
    if (newId) createdIds.push(newId);

    // ── Step 2: edit ────────────────────────────────────────────────────
    // Change the price 12 → 14 and save. The drawer is still open from step 1
    // (drawer flipped to Edit mode on add).
    const priceInput = page.locator("[data-slot='service-form-price-input']");
    await priceInput.fill("");
    await priceInput.fill("14");

    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeEnabled();
    await save.click();

    const savedToast = page.locator("[data-sonner-toast]").first();
    await expect(savedToast).toBeVisible({ timeout: 5_000 });
    await expect(savedToast).toContainText("Changes saved");
    await expect(savedToast).toHaveAttribute("data-type", "success");
    await expect(page.locator("[data-sonner-toast][data-visible='true']")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get("toast")).toBe(null);

    // ── Step 3: archive ─────────────────────────────────────────────────
    const archiveBtn = page.locator("[data-slot='services-drawer-archive-button']");
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    const archiveDialog = page.locator("[data-slot='archive-dialog']");
    await expect(archiveDialog).toBeVisible();
    await page.locator("[data-slot='archive-dialog-confirm']").click();

    const archivedToast = page.locator("[data-sonner-toast]").first();
    await expect(archivedToast).toBeVisible({ timeout: 5_000 });
    await expect(archivedToast).toContainText("Lacquer touch-up archived");
    await expect(archivedToast).toHaveAttribute("data-type", "success");
    await expect(page.locator("[data-sonner-toast][data-visible='true']")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get("toast")).toBe(null);

    // ── Step 4: restore ─────────────────────────────────────────────────
    const restoreBtn = page.locator("[data-slot='services-drawer-restore-button']");
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    const restoredToast = page.locator("[data-sonner-toast]").first();
    await expect(restoredToast).toBeVisible({ timeout: 5_000 });
    await expect(restoredToast).toContainText("Lacquer touch-up restored");
    await expect(restoredToast).toHaveAttribute("data-type", "success");
    await expect(page.locator("[data-sonner-toast][data-visible='true']")).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get("toast")).toBe(null);
  });

  test("(b) two mutations back-to-back: the second toast replaces the first (no stacking)", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Open a seeded service (Classic manicure) and fire two saves in quick
    // succession. The bridge dismisses any prior toast before firing the
    // new one, so only the second toast remains visible.
    const CLASSIC_MANI = "20000000-0000-0000-0000-000000000001";
    await page.goto(`/services?selected=${CLASSIC_MANI}`);

    const drawer = page.locator("[data-slot='services-drawer']");
    await expect(drawer).toHaveAttribute("data-mode", "edit");

    // First save: bump price 25 → 26.
    const priceInput = page.locator("[data-slot='service-form-price-input']");
    await priceInput.fill("");
    await priceInput.fill("26");
    const save = page.locator("[data-slot='services-drawer-save']");
    await expect(save).toBeEnabled();
    await save.click();

    // Wait for the first toast to render so the bridge has actually fired
    // once. We don't assert its text — only that something is visible —
    // because the next save will dismiss/replace it momentarily.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({
      timeout: 5_000,
    });

    // Second save: bump price 26 → 27. The drawer re-hydrates from the
    // server response after the first save; wait for the Save button to be
    // re-enabled for the new diff.
    await priceInput.fill("");
    await priceInput.fill("27");
    await expect(save).toBeEnabled();
    await save.click();

    // The second toast appears (same "Changes saved" copy — that's fine; the
    // assertion is about the visible-count cap, not the text). The bridge's
    // `toast.dismiss()` call collapses the first toast so only one is on
    // screen at any sampled moment.
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("Changes saved", {
      timeout: 5_000,
    });
    await expect(page.locator("[data-sonner-toast][data-visible='true']")).toHaveCount(1);
  });

  test("(c) add with zero techs → success + secondary warning both render", async ({ page }) => {
    await signInAsMaya(page);

    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    await page.locator("[data-slot='service-form-name-input']").fill("Quick file-and-go");
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Add-on");
    await page.locator("[data-slot='service-form-duration-input']").fill("");
    await page.locator("[data-slot='service-form-duration-input']").fill("10");
    await page.locator("[data-slot='service-form-price-input']").fill("8");

    // Intentionally leave every staff row unticked → server appends
    // `&secondary=no_techs_assigned` to the redirect → the bridge fires two
    // toasts (success primary + warning secondary).
    await page.locator("[data-slot='services-drawer-save']").click();

    // Both toasts visible.
    await expect
      .poll(async () => page.locator("[data-sonner-toast][data-visible='true']").count())
      .toBe(2);

    // Verify both messages — order isn't guaranteed by Sonner's stack, so
    // assert via the rendered text rather than nth-of-type.
    const toastsByText = page.locator("[data-sonner-toast][data-visible='true']");
    await expect(toastsByText).toContainText(["Quick file-and-go added to the catalog"]);
    await expect(toastsByText).toContainText([
      "Nobody can perform this service yet. Add techs from the edit drawer.",
    ]);

    // Track for cleanup.
    const newId = new URL(page.url()).searchParams.get("selected");
    if (newId) createdIds.push(newId);

    // Params get stripped by the bridge after firing.
    await expect
      .poll(() => {
        const u = new URL(page.url());
        return [
          u.searchParams.get("toast"),
          u.searchParams.get("secondary"),
          u.searchParams.get("name"),
        ].join("|");
      })
      .toBe("||");
  });
});
