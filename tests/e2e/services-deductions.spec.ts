// E2E for the per-service deductions + two-pane services layout
// (specs/021-services-deductions).
//
// US1 — two-pane layout (this phase). The drawer was deleted; the page now
// renders a `services-two-pane` grid with the catalog on the left and an
// always-mounted edit inspector on the right. Discard-changes dialog gates
// row-switches and Add-service clicks when the draft is dirty.
//
// Patterns intentionally mirror tests/e2e/services.spec.ts (the 008 suite)
// so failures here read familiarly: same sign-in helper shape, same
// keyboard-driven row clicks (Enter on a focused <a>) to avoid pointer-
// event interception flakiness, same Supabase reachability probe.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

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

// Seeded service ids — match supabase/seed.sql. Two stable rows the US1
// cases use across the describe.
const CLASSIC_MANICURE_ID = "20000000-0000-0000-0000-000000000001";
const GEL_POLISH_ID = "20000000-0000-0000-0000-000000000002";

// Mirrors `signInAsMaya` in services.spec.ts. Maya is the seeded owner
// (display name "Maya Patel", PIN 1234, linked to owner@tangnails.dev).
async function signInAsMaya(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fservices");
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
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

// Restore the seed name for Classic manicure so the edit-and-save case in
// this describe doesn't leak modified state into later runs of the suite.
async function restoreClassicManicureName(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c.from("services").update({ name: "Classic manicure" }).eq("id", CLASSIC_MANICURE_ID);
}

// Track any ad-hoc rows the Add-service case creates so afterAll can clean
// them up; keeps re-runs idempotent and prevents leaking into 008/011 specs.
const createdIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.describe("021-US1: two-pane layout", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping 021-US1 specs (Docker unavailable)."
      );
      return;
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureName();
    if (createdIds.length > 0) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const c = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await c.from("staff_services").delete().in("service_id", createdIds);
      await c.from("services").delete().in("id", createdIds);
    }
  });

  test("(a) two-pane shape: left list visible, right pane empty-state, no drawer", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Two-pane shell mounts with the resolved panel mode.
    const twoPane = page.locator("[data-slot='services-two-pane']");
    await expect(twoPane).toBeVisible();
    await expect(twoPane).toHaveAttribute("data-panel-mode", "closed");

    // Left pane: the list shows the seeded rows.
    const rows = page.locator("[data-slot='service-row']");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(1);

    // Right pane: the empty-state inspector is mounted in closed mode.
    const inspector = page.locator("[data-slot='services-edit-panel']");
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute("data-mode", "closed");
    await expect(page.locator("[data-slot='services-edit-panel-empty-headline']")).toHaveText(
      "Pick a service"
    );

    // Drawer removed: no [role="dialog"] for the panel, no `data-drawer-mode`
    // attribute anywhere on the page.
    await expect(page.locator("[data-slot='services-drawer']")).toHaveCount(0);
    await expect(page.locator("[data-drawer-mode]")).toHaveCount(0);
  });

  test("(b) click row → panel pre-fills the name input within ~200ms; Save disabled", async ({
    page,
  }) => {
    await signInAsMaya(page);

    for (const id of [CLASSIC_MANICURE_ID, GEL_POLISH_ID]) {
      const row = page.locator(`[data-slot='service-row'][data-service-id='${id}']`);
      const link = row.locator("xpath=ancestor::a");
      await link.focus();
      await link.press("Enter");
      await page.waitForURL(new RegExp(`\\?selected=${id}`));

      // Panel hydrated in edit mode.
      const panel = page.locator("[data-slot='services-edit-panel']");
      await expect(panel).toHaveAttribute("data-mode", "edit");

      // Name input takes the row's value. Use the seed for the two rows.
      const expectedName = id === CLASSIC_MANICURE_ID ? "Classic manicure" : "Gel polish";
      const nameInput = page.locator("[data-slot='service-form-name-input']");
      await expect(nameInput).toHaveValue(expectedName, { timeout: 500 });

      // Save disabled — baseline equals draft.
      await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
    }
  });

  test("(c) edit + save: name change enables Save, redirect toast fires, list row updates, panel stays in edit mode", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Open Classic manicure.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Type a new name → Save enables.
    const nameInput = page.locator("[data-slot='service-form-name-input']");
    const renamed = `Classic manicure (021-US1)`;
    await nameInput.fill(renamed);

    const save = page.locator("[data-slot='services-edit-panel-save']");
    await expect(save).toBeEnabled();
    await save.click();

    // Redirect lands on `?selected=<id>&toast=changes_saved&...`. The
    // services toaster strips `?toast=` after firing so we wait on the
    // intermediate URL instead.
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`), {
      timeout: 5000,
    });

    // Sonner success — best-effort, the toaster fires `toast.success`.
    // We don't tightly couple to its DOM (Sonner internals change shape);
    // assertion is loose, just confirming the success message is visible.
    await expect(page.getByText("Changes saved")).toBeVisible({ timeout: 5000 });

    // Panel stays in edit mode for the same row.
    const panel = page.locator("[data-slot='services-edit-panel']");
    await expect(panel).toHaveAttribute("data-mode", "edit");
    await expect(nameInput).toHaveValue(renamed);

    // List row text reflects the new name.
    await expect(row.locator("[data-slot='service-name']")).toHaveText(renamed);
  });

  test("(d) Add service: panel flips to add mode with default values, submit flips to edit for the new row", async ({
    page,
  }) => {
    await signInAsMaya(page);

    await page.locator("[data-slot='services-add-button']").click();
    await page.waitForURL(/\?adding=1/);

    const panel = page.locator("[data-slot='services-edit-panel']");
    await expect(panel).toHaveAttribute("data-mode", "add");

    // Default values: name empty (placeholder "New service" in the header),
    // category "Other", duration 30. These are makeDefaultDraft().
    const nameInput = page.locator("[data-slot='service-form-name-input']");
    await expect(nameInput).toHaveValue("");
    await expect(page.locator("[data-slot='service-form-category-input']")).toHaveValue("Other");
    await expect(page.locator("[data-slot='service-form-duration-input']")).toHaveValue("30");

    // Fill minimal required fields and submit.
    const newName = `Polish change 021-${Date.now().toString().slice(-6)}`;
    await nameInput.fill(newName);
    const categoryInput = page.locator("[data-slot='service-form-category-input']");
    await categoryInput.click();
    await categoryInput.fill("");
    await categoryInput.fill("Manicure");
    await page.locator("[data-slot='service-form-price-input']").fill("18");

    await page.locator("[data-slot='services-edit-panel-save']").click();

    // Redirect lands on `?selected=<newId>&toast=service_added&name=…`.
    await page.waitForURL(/\?selected=[^&]+.*toast=service_added/);
    const url = new URL(page.url());
    const newId = url.searchParams.get("selected");
    expect(newId).toBeTruthy();
    if (newId) createdIds.push(newId);

    // Panel flips to edit mode for the new service.
    await expect(panel).toHaveAttribute("data-mode", "edit");

    // The new row appears in the list.
    const newRow = page.locator(`[data-slot='service-row'][data-service-id='${newId}']`);
    await expect(newRow).toBeVisible();
    await expect(newRow.locator("[data-slot='service-name']")).toHaveText(newName);
  });

  test("(e) discard guard on row-switch: Cancel keeps panel, Discard navigates", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Open Classic manicure.
    const classicRow = page.locator(
      `[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`
    );
    const classicLink = classicRow.locator("xpath=ancestor::a");
    await classicLink.focus();
    await classicLink.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Make a draft edit (without saving).
    const nameInput = page.locator("[data-slot='service-form-name-input']");
    const originalName = await nameInput.inputValue();
    await nameInput.fill(`${originalName} draft`);

    // Click a different row (Gel polish). The capture-phase listener fires
    // the discard guard before the navigation runs.
    const gelRow = page.locator(`[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`);
    await gelRow.click();

    // Discard dialog appears, naming the current service.
    const dialog = page.locator("[data-slot='discard-changes-dialog']");
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-slot='discard-changes-body']")).toContainText(originalName);

    // Cancel → dialog closes, panel stays.
    await page.locator("[data-slot='discard-changes-cancel']").click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).searchParams.get("selected")).toBe(CLASSIC_MANICURE_ID);

    // Re-click the Gel polish row + Discard → URL flips.
    await gelRow.click();
    await expect(dialog).toBeVisible();
    await page.locator("[data-slot='discard-changes-confirm']").click();
    await page.waitForURL(new RegExp(`\\?selected=${GEL_POLISH_ID}`));

    const panel = page.locator("[data-slot='services-edit-panel']");
    await expect(panel).toHaveAttribute("data-mode", "edit");
    await expect(nameInput).toHaveValue("Gel polish");
  });

  test("(f) discard guard on Add service: Discard flips panel to add mode", async ({ page }) => {
    await signInAsMaya(page);

    // Open Classic manicure.
    const classicRow = page.locator(
      `[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`
    );
    const classicLink = classicRow.locator("xpath=ancestor::a");
    await classicLink.focus();
    await classicLink.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Make a draft edit.
    const nameInput = page.locator("[data-slot='service-form-name-input']");
    await nameInput.fill(`Classic manicure draft`);

    // Click Add service. Capture-phase guard intercepts.
    await page.locator("[data-slot='services-add-button']").click();

    const dialog = page.locator("[data-slot='discard-changes-dialog']");
    await expect(dialog).toBeVisible();

    // Discard → panel flips to add mode.
    await page.locator("[data-slot='discard-changes-confirm']").click();
    await page.waitForURL(/\?adding=1/);

    const panel = page.locator("[data-slot='services-edit-panel']");
    await expect(panel).toHaveAttribute("data-mode", "add");
  });
});

// ============================================================================
// US2 — Per-service card-fee mode
// ============================================================================

// Reset Classic manicure's card-fee fields back to the seeded default
// (mode = 'default', custom = null). Run from `beforeEach` so each US2
// test starts from the same baseline regardless of what the prior test left
// behind.
async function restoreClassicManicureCardFee(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c
    .from("services")
    .update({
      card_fee_mode: "default",
      card_fee_custom_cents: null,
    })
    .eq("id", CLASSIC_MANICURE_ID);
}

async function readCardFeeRow(id: string): Promise<{
  card_fee_mode: string;
  card_fee_custom_cents: number | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c
    .from("services")
    .select("card_fee_mode, card_fee_custom_cents")
    .eq("id", id)
    .single();
  if (error) throw new Error(`readCardFeeRow failed: ${error.message}`);
  return data as { card_fee_mode: string; card_fee_custom_cents: number | null };
}

test.describe("021-US2: card-fee mode", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping 021-US2 specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureCardFee();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureCardFee();
  });

  test("(a) seeded service shows default $3 card fee chip on its row", async ({ page }) => {
    await signInAsMaya(page);
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const chip = row.locator("[data-slot='deduction-chip'][data-kind='card-default']");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("$3 card fee");
  });

  test("(b) default → custom round-trip persists value, chip updates", async ({ page }) => {
    await signInAsMaya(page);

    // Open Classic manicure.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Click Custom option.
    const customOption = page.locator(
      "[data-slot='deductions-card-fee-option'][data-value='custom']"
    );
    await customOption.click();

    // Type 4.50 into the amount input.
    const amount = page.locator("[data-slot='deductions-card-fee-custom-input']");
    await expect(amount).toBeVisible();
    await amount.fill("4.50");

    // Save enables; click.
    const save = page.locator("[data-slot='services-edit-panel-save']");
    await expect(save).toBeEnabled();
    await save.click();

    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`), {
      timeout: 5000,
    });

    // Row shows custom chip with $4.50.
    const customChip = row.locator("[data-slot='deduction-chip'][data-kind='card-custom']");
    await expect(customChip).toBeVisible();
    await expect(customChip).toHaveText("$4.50 card fee");

    // Re-opening the panel renders the saved value in the input.
    await expect(amount).toHaveValue("4.50");

    // DB row reflects the change.
    const dbRow = await readCardFeeRow(CLASSIC_MANICURE_ID);
    expect(dbRow.card_fee_mode).toBe("custom");
    expect(dbRow.card_fee_custom_cents).toBe(450);
  });

  test("(c) custom → exempt clears chip, hides custom input", async ({ page }) => {
    await signInAsMaya(page);

    // Set up custom first.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));
    await page.locator("[data-slot='deductions-card-fee-option'][data-value='custom']").click();
    await page.locator("[data-slot='deductions-card-fee-custom-input']").fill("4.50");
    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    // Now flip to exempt.
    await page.locator("[data-slot='deductions-card-fee-option'][data-value='exempt']").click();
    // Custom input disappears.
    await expect(page.locator("[data-slot='deductions-card-fee-custom-input']")).toHaveCount(0);
    // Save.
    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    // No blue chip on the row (US3 will add the muted "No fees" chip; here
    // we assert only that the blue/default chip is absent).
    await expect(row.locator("[data-slot='deduction-chip'][data-kind='card-default']")).toHaveCount(
      0
    );
    await expect(row.locator("[data-slot='deduction-chip'][data-kind='card-custom']")).toHaveCount(
      0
    );
  });

  test("(d) exempt → default brings chip back; custom cents null", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Set custom first (so the next flip to default proves the cents got nulled).
    await page.locator("[data-slot='deductions-card-fee-option'][data-value='custom']").click();
    await page.locator("[data-slot='deductions-card-fee-custom-input']").fill("7");
    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    // Flip to default + save.
    await page.locator("[data-slot='deductions-card-fee-option'][data-value='default']").click();
    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    // Default chip back.
    const chip = row.locator("[data-slot='deduction-chip'][data-kind='card-default']");
    await expect(chip).toHaveText("$3 card fee");

    // DB: custom cents null.
    const dbRow = await readCardFeeRow(CLASSIC_MANICURE_ID);
    expect(dbRow.card_fee_mode).toBe("default");
    expect(dbRow.card_fee_custom_cents).toBeNull();
  });

  test("(e) custom > $50 surfaces inline hint and Save stays disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-card-fee-option'][data-value='custom']").click();
    await page.locator("[data-slot='deductions-card-fee-custom-input']").fill("60");

    const hint = page.locator("[data-slot='deductions-card-fee-custom-hint']");
    await expect(hint).toHaveText("Card fee can't exceed $50.");
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(f) empty custom-amount in custom mode disables Save", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-card-fee-option'][data-value='custom']").click();
    // Buffer starts empty for a baseline that was 'default' — typing nothing
    // keeps it empty. Assert the hint + disabled state.
    const amount = page.locator("[data-slot='deductions-card-fee-custom-input']");
    await expect(amount).toHaveValue("");
    await expect(page.locator("[data-slot='deductions-card-fee-custom-hint']")).toHaveText(
      "Enter an amount up to $50."
    );
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(g) custom = 0 is allowed and persists card_fee_custom_cents = 0", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-card-fee-option'][data-value='custom']").click();
    await page.locator("[data-slot='deductions-card-fee-custom-input']").fill("0");

    // No inline hint, Save enabled.
    await expect(page.locator("[data-slot='deductions-card-fee-custom-hint']")).toHaveCount(0);
    const save = page.locator("[data-slot='services-edit-panel-save']");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    const dbRow = await readCardFeeRow(CLASSIC_MANICURE_ID);
    expect(dbRow.card_fee_mode).toBe("custom");
    expect(dbRow.card_fee_custom_cents).toBe(0);
  });
});

// ============================================================================
// US3 — Per-service supply deduction
// ============================================================================

// Reset Classic manicure's supply + card-fee fields back to the seeded
// defaults (mode = 'default', custom = null, supply = null). Run from
// `beforeEach` so each US3 test starts from the same baseline regardless of
// what the prior test left behind.
async function restoreClassicManicureDeductions(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c
    .from("services")
    .update({
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
      supply_label: null,
    })
    .eq("id", CLASSIC_MANICURE_ID);
}

// Reset a list of services to seeded defaults. Used after the
// combined/exempt chip tests that need to leave the DB clean for
// subsequent runs.
async function resetServicesDeductions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c
    .from("services")
    .update({
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
      supply_label: null,
    })
    .in("id", ids);
}

// Directly set deduction columns on a service via service-role — used to
// seed combined/exempt-only scenarios that the US3 chip tests assert
// against. Bypasses RLS + the Server Action so the test setup stays
// deterministic.
async function setServiceDeductions(
  id: string,
  patch: {
    card_fee_mode: "default" | "custom" | "exempt";
    card_fee_custom_cents: number | null;
    supply_amount_cents: number | null;
    supply_label: string | null;
  }
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.from("services").update(patch).eq("id", id);
  if (error) throw new Error(`setServiceDeductions failed: ${error.message}`);
}

async function readSupplyRow(id: string): Promise<{
  supply_amount_cents: number | null;
  supply_label: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c
    .from("services")
    .select("supply_amount_cents, supply_label")
    .eq("id", id)
    .single();
  if (error) throw new Error(`readSupplyRow failed: ${error.message}`);
  return data as { supply_amount_cents: number | null; supply_label: string | null };
}

// Seeded service ids the US3 combined/exempt chip tests reuse.
const CLASSIC_PEDI_ID = "20000000-0000-0000-0000-000000000003";
const SPA_PEDI_ID = "20000000-0000-0000-0000-000000000004";
const NAIL_ART_ID = "20000000-0000-0000-0000-000000000005";

test.describe("021-US3: supply deduction", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping 021-US3 specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureDeductions();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await resetServicesDeductions([
      CLASSIC_MANICURE_ID,
      GEL_POLISH_ID,
      CLASSIC_PEDI_ID,
      SPA_PEDI_ID,
      NAIL_ART_ID,
    ]);
  });

  test("(a) default state: pre-existing service shows no supply chip + toggle off, inputs hidden", async ({
    page,
  }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    // No supply chip on the row.
    await expect(row.locator("[data-slot='deduction-chip'][data-kind='supply']")).toHaveCount(0);

    // Open panel — supply toggle off, inputs hidden.
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    const toggle = page.locator("[data-slot='deductions-supply-toggle']");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("data-state", "unchecked");
    await expect(page.locator("[data-slot='deductions-supply-inputs']")).toHaveCount(0);
  });

  test("(b) toggle on → amount pre-fills 5.00, label is empty + focused", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();

    const amount = page.locator("[data-slot='deductions-supply-amount-input']");
    const labelInput = page.locator("[data-slot='deductions-supply-label-input']");
    await expect(amount).toHaveValue("5.00");
    await expect(labelInput).toHaveValue("");
    // Focus moved to the label input.
    await expect(labelInput).toBeFocused();
  });

  test("(c) save with valid values: amber chip on row, DB persists", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("GelX tips & gel");

    const save = page.locator("[data-slot='services-edit-panel-save']");
    await expect(save).toBeEnabled();
    await save.click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    const chip = row.locator("[data-slot='deduction-chip'][data-kind='supply']");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("$5 GelX tips & gel");

    const db = await readSupplyRow(CLASSIC_MANICURE_ID);
    expect(db.supply_amount_cents).toBe(500);
    expect(db.supply_label).toBe("GelX tips & gel");
  });

  test("(d) toggle off clears columns + chip disappears", async ({ page }) => {
    await signInAsMaya(page);

    // First, seed supply on Classic manicure directly.
    await setServiceDeductions(CLASSIC_MANICURE_ID, {
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
      supply_label: "Chrome powder",
    });

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Toggle on initially (baseline supply present).
    const toggle = page.locator("[data-slot='deductions-supply-toggle']");
    await expect(toggle).toHaveAttribute("data-state", "checked");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-state", "unchecked");

    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    const db = await readSupplyRow(CLASSIC_MANICURE_ID);
    expect(db.supply_amount_cents).toBeNull();
    expect(db.supply_label).toBeNull();

    await expect(row.locator("[data-slot='deduction-chip'][data-kind='supply']")).toHaveCount(0);
  });

  test("(e) buffer preservation on toggle off → on (FR-021)", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    const toggle = page.locator("[data-slot='deductions-supply-toggle']");
    await toggle.click();
    const labelInput = page.locator("[data-slot='deductions-supply-label-input']");
    await labelInput.fill("Test");
    // Toggle off → on without saving.
    await toggle.click();
    await expect(page.locator("[data-slot='deductions-supply-inputs']")).toHaveCount(0);
    await toggle.click();
    // Buffer preserved.
    await expect(page.locator("[data-slot='deductions-supply-label-input']")).toHaveValue("Test");
  });

  test("(f) amount empty rejection: inline hint + Save disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-amount-input']").fill("");

    const hint = page.locator("[data-slot='deductions-supply-amount-hint']");
    await expect(hint).toHaveText("Enter a positive amount up to $50, or turn Supply off.");
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(g) amount zero rejection: inline hint + Save disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-amount-input']").fill("0");

    const hint = page.locator("[data-slot='deductions-supply-amount-hint']");
    await expect(hint).toHaveText("Enter a positive amount up to $50, or turn Supply off.");
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(h) amount over $50 rejection: cap hint + Save disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-amount-input']").fill("60");

    const hint = page.locator("[data-slot='deductions-supply-amount-hint']");
    await expect(hint).toHaveText("Supply can't exceed $50.");
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(i) label empty rejection: inline hint + Save disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    // Default label is empty on first toggle on → hint visible immediately.
    const hint = page.locator("[data-slot='deductions-supply-label-hint']");
    await expect(hint).toHaveText(
      "Add a short label so staff know what this covers, or turn Supply off."
    );
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(j) label over 64 chars: inline hint + Save disabled", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    const labelInput = page.locator("[data-slot='deductions-supply-label-input']");
    await labelInput.fill("a".repeat(70));

    const hint = page.locator("[data-slot='deductions-supply-label-hint']");
    await expect(hint).toHaveText("Label must be 64 characters or fewer.");
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toBeDisabled();
  });

  test("(k) char counter appears within 8 of limit", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='deductions-supply-toggle']").click();
    const labelInput = page.locator("[data-slot='deductions-supply-label-input']");
    // 57 chars → 7 left.
    await labelInput.fill("a".repeat(57));

    const counter = page.locator("[data-slot='deductions-supply-label-counter']");
    await expect(counter).toBeVisible();
    await expect(counter).toHaveText("7 left");
  });

  test("(l) combined chips: card-custom first, supply second", async ({ page }) => {
    // Seed Gel polish with custom card fee + supply BEFORE the page load so
    // the initial RSC render picks the fresh row up. (The page is a Server
    // Component — direct DB writes via service-role bypass the Next.js
    // revalidation cache, so a post-load `reload()` is needed if we seed
    // after navigation. Seeding first avoids the dance.)
    await setServiceDeductions(GEL_POLISH_ID, {
      card_fee_mode: "custom",
      card_fee_custom_cents: 450,
      supply_amount_cents: 700,
      supply_label: "chrome",
    });
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${GEL_POLISH_ID}']`);
    const chips = row.locator("[data-slot='deduction-chip']");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveAttribute("data-kind", "card-custom");
    await expect(chips.nth(0)).toHaveText("$4.50 card fee");
    await expect(chips.nth(1)).toHaveAttribute("data-kind", "supply");
    await expect(chips.nth(1)).toHaveText("$7 chrome");
  });

  test("(m) exempt + supply: only the supply chip renders (no No fees, no card-fee chip)", async ({
    page,
  }) => {
    await setServiceDeductions(CLASSIC_PEDI_ID, {
      card_fee_mode: "exempt",
      card_fee_custom_cents: null,
      supply_amount_cents: 800,
      supply_label: "premium soak",
    });
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_PEDI_ID}']`);
    const chips = row.locator("[data-slot='deduction-chip']");
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAttribute("data-kind", "supply");
    await expect(chips.first()).toHaveText("$8 premium soak");

    // Defensive — no exempt-no-fees chip and no card-fee chip.
    await expect(
      row.locator("[data-slot='deduction-chip'][data-kind='exempt-no-fees']")
    ).toHaveCount(0);
    await expect(row.locator("[data-slot='deduction-chip'][data-kind='card-default']")).toHaveCount(
      0
    );
    await expect(row.locator("[data-slot='deduction-chip'][data-kind='card-custom']")).toHaveCount(
      0
    );
  });

  test("(n) exempt without supply: muted No fees chip", async ({ page }) => {
    await setServiceDeductions(SPA_PEDI_ID, {
      card_fee_mode: "exempt",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
      supply_label: null,
    });
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${SPA_PEDI_ID}']`);
    const chip = row.locator("[data-slot='deduction-chip'][data-kind='exempt-no-fees']");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("No fees");
  });
});

// ============================================================================
// US4 — Net-to-tech (card) preview (live, no save required)
// ============================================================================

// Reset Nail art (the seeded variable-price row) back to its seed state so
// the variable-price preview case starts from a known baseline. Nail art's
// seeded `price_from_cents` is 1500 — the variable-price test below sets it
// to 3000 first, then asserts the preview reads `$30 - 3 = $27` (default
// card fee, no supply).
async function restoreNailArt(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c
    .from("services")
    .update({
      variable_price: true,
      price_from_cents: 1500,
      price_to_cents: null,
      variable_price_note: "Depends on design complexity",
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
      supply_label: null,
    })
    .eq("id", NAIL_ART_ID);
}

// Mutate a service row's `price_from_cents` directly (service-role bypass)
// so a test can land on a known variable-price baseline without needing to
// drive the form through a sequence of clicks.
async function setVariablePriceFrom(id: string, fromCents: number): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c
    .from("services")
    .update({ variable_price: true, price_from_cents: fromCents })
    .eq("id", id);
  if (error) throw new Error(`setVariablePriceFrom failed: ${error.message}`);
}

test.describe("021-US4: net-to-tech preview", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping 021-US4 specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    // Reset both rows used in this describe so each test starts clean.
    await restoreClassicManicureDeductions();
    await restoreNailArt();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureDeductions();
    await restoreNailArt();
  });

  test("(a) classic case: $50 + default + $5 supply → $42 with three breakdown lines", async ({
    page,
  }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Set price to 50, leave card-fee on default ($3), turn on supply at
    // the default $5 + label "chrome".
    await page.locator("[data-slot='service-form-price-input']").fill("50");
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");

    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$42");

    // Breakdown lines in order: service, card fee, supply.
    const lines = page.locator("[data-slot='deductions-net-to-tech-line']");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toHaveAttribute("data-kind", "service");
    await expect(lines.nth(0)).toContainText("$50");
    await expect(lines.nth(0)).toContainText("service");
    await expect(lines.nth(1)).toHaveAttribute("data-kind", "card-fee");
    await expect(lines.nth(1)).toContainText("−$3");
    await expect(lines.nth(1)).toContainText("card fee");
    await expect(lines.nth(2)).toHaveAttribute("data-kind", "supply");
    await expect(lines.nth(2)).toContainText("−$5");
    await expect(lines.nth(2)).toContainText("chrome");
  });

  test("(b) live price keystroke → preview recomputes within ~200ms", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Set price = 50, default + supply $5 chrome.
    await page.locator("[data-slot='service-form-price-input']").fill("50");
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");
    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$42");

    // Type a new price — no Save click. Preview should reflect 60 - 3 - 5 = 52.
    await page.locator("[data-slot='service-form-price-input']").fill("60");
    await expect(amount).toHaveText("$52", { timeout: 500 });
  });

  test("(c) switch to exempt → preview becomes $55, card-fee breakdown line drops", async ({
    page,
  }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='service-form-price-input']").fill("60");
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");
    // Sanity: $60 - $3 - $5 = $52 with default mode.
    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$52");

    // Flip to exempt. Preview = $60 - $5 = $55. Card-fee line drops.
    await page.locator("[data-slot='deductions-card-fee-option'][data-value='exempt']").click();
    await expect(amount).toHaveText("$55");

    const cardFeeLine = page.locator(
      "[data-slot='deductions-net-to-tech-line'][data-kind='card-fee']"
    );
    await expect(cardFeeLine).toHaveCount(0);

    // Service + supply lines still present.
    await expect(
      page.locator("[data-slot='deductions-net-to-tech-line'][data-kind='service']")
    ).toHaveCount(1);
    await expect(
      page.locator("[data-slot='deductions-net-to-tech-line'][data-kind='supply']")
    ).toHaveCount(1);
  });

  test("(d) toggle supply off → preview becomes $60, supply breakdown line drops", async ({
    page,
  }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    await page.locator("[data-slot='service-form-price-input']").fill("63");
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");
    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    // Sanity: $63 - $3 - $5 = $55.
    await expect(amount).toHaveText("$55");

    // Flip supply off. Preview = $63 - $3 = $60. Supply line drops.
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await expect(amount).toHaveText("$60");
    await expect(
      page.locator("[data-slot='deductions-net-to-tech-line'][data-kind='supply']")
    ).toHaveCount(0);
  });

  test("(e) variable-price service: preview uses price_from (not the empty fixed price) per FR-026", async ({
    page,
  }) => {
    // Seed Nail art's price_from to 30 (cents = 3000) so the preview has
    // a known baseline; default card-fee + no supply.
    await setVariablePriceFrom(NAIL_ART_ID, 3000);
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${NAIL_ART_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${NAIL_ART_ID}`));

    // Variable-price toggle should be on; fixed price input absent.
    await expect(page.locator("[data-slot='service-form-price-input']")).toHaveCount(0);
    await expect(page.locator("[data-slot='service-form-price-from-input']")).toHaveValue("30");

    // Preview uses price_from = 30 (cents = 3000). Default mode → $30 - $3 = $27.
    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$27");
  });

  test("(f) negative net clamps to $0; raw breakdown lines remain visible", async ({ page }) => {
    await signInAsMaya(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Price = 0, default ($3) + supply $5 = -$8 → clamps to $0.
    await page.locator("[data-slot='service-form-price-input']").fill("0");
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");

    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$0");

    // All three breakdown lines are still visible.
    const lines = page.locator("[data-slot='deductions-net-to-tech-line']");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toContainText("$0");
    await expect(lines.nth(1)).toContainText("−$3");
    await expect(lines.nth(2)).toContainText("−$5");
  });
});

// ============================================================================
// 021-US5 — Role-gated edits + audit trail
// ============================================================================
//
// Phase 7 / T040. Mirrors the seeded-role pattern from
// tests/e2e/services.spec.ts § US6 (technician = Sam Chen, PIN 9999) and
// staff.spec.ts § signInAsJordan (manager = Jordan Lee, PIN 5678, linked to
// manager@tangnails.dev). Maya stays the owner-equivalent for cross-checks
// but isn't needed here — the contract only distinguishes write-capable
// (owner/manager) from read-only (technician/front-desk).
//
// Direct-POST forbidden assertion: deferred for the same reason the 008
// US6 spec deferred its equivalent (see services.spec.ts § US6 trailing
// NOTE) — Next.js 16 Server Actions are dispatched with a bundler-derived
// `Next-Action` header whose value changes on every rebuild, so crafting a
// reliable forged POST is brittle. Defense-in-depth is already covered by
// (1) the Vitest `permissions.test.ts` suite that asserts
// `assertCanWriteCatalog('technician')` throws PermissionError, (2) the
// Server Action prelude in `app/(studio)/services/actions.ts` that calls
// `assertCanWriteCatalog(viewer.staff.role)` before any mutation, and
// (3) the UI gate in this describe (parts (b), (c)) that prevents a
// technician from dispatching the action via any legitimate path.

// Sign in as Sam (technician). Same pattern as services.spec.ts
// `signInAsSamOnServicesPage` — Sam has `user_id: null` so the device user
// (owner@tangnails.dev) is used and Sam is picked at /select-staff with PIN
// 9999.
async function signInAsSamOnServicesPage(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login?next=%2Fservices");
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Sam Chen/ }).click();
  await page.waitForURL(/selectedTileId=/);
  for (const d of ["9", "9", "9", "9"]) {
    await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

// Sign in as Jordan (manager). Same pattern as staff.spec.ts §
// signInAsJordan but lands on /services instead of /settings/staff.
async function signInAsJordanOnServicesPage(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login?next=%2Fservices");
  await page.locator("#signin-email").fill("manager@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await page.waitForURL(/selectedTileId=/);
  for (const d of ["5", "6", "7", "8"]) {
    await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

// Tooltip copy must match the deductions-section / owner-only-tooltip
// vocabulary exactly. If you change it in one place, change it in both.
const ROLE_GATE_TOOLTIP_COPY = "Only owners and managers can edit the catalog.";

// Reset Classic manicure's price back to its seeded $25 (2500 cents from
// supabase/seed.sql). Used by US5 because test (g) writes a $60 price and
// the next iteration — plus shared specs that depend on the $25 baseline
// (checkout, services, card-payment) — need the canonical seed value.
async function resetClassicManicurePrice(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c.from("services").update({ price_cents: 2500 }).eq("id", CLASSIC_MANICURE_ID);
}

test.describe("021-US5: role gating + audit", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping 021-US5 specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    // Reset deductions to seed defaults on every test so each case starts
    // from a known baseline (mode='default', custom=null, supply=null).
    // Also reset price_cents in case the previous test changed it (test
    // (g) sets price to 6000).
    await restoreClassicManicureDeductions();
    await resetClassicManicurePrice();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureDeductions();
    await resetClassicManicurePrice();
    // Also reset name in case the manager-write test renamed it
    // accidentally; defensive.
    await restoreClassicManicureName();
  });

  test("(a) technician sees deduction chips on every row (read works)", async ({ page }) => {
    await signInAsSamOnServicesPage(page);

    // At least one row renders. The default $3 card-fee chip ships on
    // every active seeded service (US2 fixture).
    const rows = page.locator("[data-slot='service-row']");
    expect(await rows.count()).toBeGreaterThan(0);

    // The seeded Classic manicure row carries the default card-fee chip.
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const chip = row.locator("[data-slot='deduction-chip'][data-kind='card-default']");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("$3 card fee");
  });

  test("(b) technician sees disabled deduction controls with role-gate tooltip", async ({
    page,
  }) => {
    await signInAsSamOnServicesPage(page);

    // Open Classic manicure via keyboard (avoids pointer-event interception).
    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Segmented control carries aria-disabled at the root.
    const segmented = page.locator("[data-slot='deductions-card-fee-segmented']");
    await expect(segmented).toHaveAttribute("aria-disabled", "true");

    // Each option also carries aria-disabled (per ui.contract.md § 5).
    const options = page.locator("[data-slot='deductions-card-fee-option']");
    const optCount = await options.count();
    expect(optCount).toBeGreaterThan(0);
    for (let i = 0; i < optCount; i++) {
      await expect(options.nth(i)).toHaveAttribute("aria-disabled", "true");
      await expect(options.nth(i)).toHaveAttribute("tabindex", "-1");
    }

    // Custom amount input isn't rendered (mode=default), so no assertion
    // there; the (c) sub-case below tests it in isolation by switching to
    // custom via direct DB (we can't toggle from the disabled UI).

    // Supply toggle: aria-disabled at the underlying Radix Switch root.
    const supplyToggle = page.locator("[data-slot='deductions-supply-toggle']");
    await expect(supplyToggle).toHaveAttribute("aria-disabled", "true");
    // shadcn Switch also passes through the native `disabled` attribute.
    await expect(supplyToggle).toBeDisabled();

    // Supply amount + label inputs are not rendered (toggle is off). We
    // assert this is the contracted state.
    await expect(page.locator("[data-slot='deductions-supply-amount-input']")).toHaveCount(0);
    await expect(page.locator("[data-slot='deductions-supply-label-input']")).toHaveCount(0);

    // Save button is replaced by the "View only" chip per existing 008
    // pattern (services.spec.ts § US6 (b)). The 021 contract is the same:
    // mutations are blocked, the operator sees an explicit view-only chip
    // rather than a disabled-looking Save button.
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toHaveCount(0);
    await expect(page.locator("[data-slot='services-edit-panel-view-only-chip']")).toHaveText(
      "View only"
    );

    // Archive button is suppressed for read-only operators (also matches
    // 008's existing behavior).
    await expect(page.locator("[data-slot='services-edit-panel-archive-button']")).toHaveCount(0);

    // Tooltip: focus the Supply toggle's wrapping span trigger and assert
    // the shared role-gate copy surfaces. Radix tooltips fire on focus +
    // hover, and disabled buttons swallow events, so the inline-block
    // wrapper span is what listens.
    const supplyTooltipTrigger = supplyToggle.locator(
      "xpath=ancestor::span[@data-slot='services-owner-only-tooltip-trigger'][1]"
    );
    await supplyTooltipTrigger.hover();
    await expect(
      page.locator("[data-slot='services-owner-only-tooltip-content']", {
        hasText: ROLE_GATE_TOOLTIP_COPY,
      })
    ).toBeVisible();
  });

  test("(c) technician sees the net-to-tech preview (read-only by design)", async ({ page }) => {
    await signInAsSamOnServicesPage(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Net-to-tech preview block renders regardless of role (FR-029).
    const preview = page.locator("[data-slot='deductions-net-to-tech']");
    await expect(preview).toBeVisible();

    // Headline + amount + service breakdown line all present.
    await expect(page.locator("[data-slot='deductions-net-to-tech-headline']")).toHaveText(
      "Net to tech (card)"
    );
    await expect(page.locator("[data-slot='deductions-net-to-tech-amount']")).toBeVisible();

    // Seeded Classic manicure has price 2500 + default ($3) + no supply
    // → net = $25 - $3 = $22. The breakdown shows two lines (service +
    // card-fee, no supply since the seed has it off).
    await expect(page.locator("[data-slot='deductions-net-to-tech-amount']")).toHaveText("$22");
    const lines = page.locator("[data-slot='deductions-net-to-tech-line']");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveAttribute("data-kind", "service");
    await expect(lines.nth(1)).toHaveAttribute("data-kind", "card-fee");
  });

  test("(d) manager has full interactivity (no aria-disabled, controls write)", async ({
    page,
  }) => {
    await signInAsJordanOnServicesPage(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Segmented control + every option have no aria-disabled.
    const segmented = page.locator("[data-slot='deductions-card-fee-segmented']");
    const segDisabled = await segmented.getAttribute("aria-disabled");
    expect(segDisabled).toBeNull();

    const options = page.locator("[data-slot='deductions-card-fee-option']");
    const optCount = await options.count();
    for (let i = 0; i < optCount; i++) {
      const v = await options.nth(i).getAttribute("aria-disabled");
      expect(v).toBeNull();
      const tabIndex = await options.nth(i).getAttribute("tabindex");
      // Radix RadioGroup uses roving tabindex: exactly one item is
      // tabbable (0), the rest are -1. Either case is fine — what
      // matters is the disabled state isn't forced everywhere.
      if (tabIndex !== null) {
        expect(["0", "-1"]).toContain(tabIndex);
      }
    }

    // Supply toggle is interactive (no aria-disabled, not disabled).
    const supplyToggle = page.locator("[data-slot='deductions-supply-toggle']");
    const toggleDisabled = await supplyToggle.getAttribute("aria-disabled");
    expect(toggleDisabled).toBeNull();
    await expect(supplyToggle).not.toBeDisabled();

    // Save button rendered (not replaced by the View only chip). It's
    // initially disabled (draft is clean) — flipping a control should
    // enable it; tested in part (e).
    await expect(page.locator("[data-slot='services-edit-panel-save']")).toHaveCount(1);
    await expect(page.locator("[data-slot='services-edit-panel-view-only-chip']")).toHaveCount(0);

    // Archive button visible (active service + write role).
    await expect(page.locator("[data-slot='services-edit-panel-archive-button']")).toBeVisible();
  });

  test("(e) manager flipping supply on writes a service.updated audit row with the four deduction keys diffed", async ({
    page,
  }) => {
    const cursor = newAuditCursor();

    await signInAsJordanOnServicesPage(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Flip Supply on.
    await page.locator("[data-slot='deductions-supply-toggle']").click();
    // The amount input pre-fills with $5.00 per FR-021 toggle-on default.
    await expect(page.locator("[data-slot='deductions-supply-amount-input']")).toHaveValue("5.00");
    // Type a label.
    await page.locator("[data-slot='deductions-supply-label-input']").fill("chrome");

    // Save.
    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    // Audit row was written. Filter by `service.updated` and pick the row
    // for this service id.
    const rows = await getAuditLogRowsSince(cursor, "service.updated");
    const match = rows.find((r) => r.entity_id === CLASSIC_MANICURE_ID);
    expect(match).toBeDefined();
    expect(match!.entity_type).toBe("service");

    const payload = match!.payload as {
      changes: Record<string, [unknown, unknown]>;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

    // Two deduction keys flipped: supply_amount_cents (null → 500) and
    // supply_label (null → 'chrome'). The card-fee mode stayed default;
    // card_fee_custom_cents stayed null. So `changes` carries those two
    // keys exactly (plus zero other keys for an otherwise-unchanged row).
    expect(payload.changes).toEqual({
      supply_amount_cents: [null, 500],
      supply_label: [null, "chrome"],
    });

    // before/after snapshots include the four deduction fields.
    expect(payload.before.card_fee_mode).toBe("default");
    expect(payload.before.card_fee_custom_cents).toBeNull();
    expect(payload.before.supply_amount_cents).toBeNull();
    expect(payload.before.supply_label).toBeNull();
    expect(payload.after.card_fee_mode).toBe("default");
    expect(payload.after.card_fee_custom_cents).toBeNull();
    expect(payload.after.supply_amount_cents).toBe(500);
    expect(payload.after.supply_label).toBe("chrome");
  });

  test("(f) deduction-only edit produces a minimal diff (only the changed key)", async ({
    page,
  }) => {
    // Pre-seed supply $5 + 'chrome' so the manager can change just the
    // amount and we can assert the diff covers ONLY supply_amount_cents.
    await setServiceDeductions(CLASSIC_MANICURE_ID, {
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
      supply_label: "chrome",
    });

    const cursor = newAuditCursor();
    await signInAsJordanOnServicesPage(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Confirm baseline supply state hydrated. `makeDraftFromBaseline` formats
    // whole-dollar amounts without a decimal (i.e. "5" not "5.00") — see
    // `dollarsFromCents` in service-form.client.tsx.
    await expect(page.locator("[data-slot='deductions-supply-amount-input']")).toHaveValue("5");
    await expect(page.locator("[data-slot='deductions-supply-label-input']")).toHaveValue("chrome");

    // Change ONLY the supply amount from $5 → $7.50.
    await page.locator("[data-slot='deductions-supply-amount-input']").fill("7.50");
    // Blur off the input so the on-blur reformat fires (no-op for 7.50).
    await page.locator("[data-slot='deductions-supply-label-input']").focus();

    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    const rows = await getAuditLogRowsSince(cursor, "service.updated");
    const match = rows.find((r) => r.entity_id === CLASSIC_MANICURE_ID);
    expect(match).toBeDefined();
    const payload = match!.payload as {
      changes: Record<string, [unknown, unknown]>;
    };

    // FR-030: the diff contains EXACTLY the changed key.
    expect(payload.changes).toEqual({ supply_amount_cents: [500, 750] });
  });

  test("(g) non-deduction edit produces no spurious deduction diff", async ({ page }) => {
    // Pre-seed supply on so the row has all four deduction fields populated;
    // the test then changes ONLY the price and asserts the diff doesn't
    // gratuitously include the deduction keys.
    await setServiceDeductions(CLASSIC_MANICURE_ID, {
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
      supply_label: "chrome",
    });

    const cursor = newAuditCursor();
    await signInAsJordanOnServicesPage(page);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    // Change ONLY the price from $25 (seed: 2500) → $60.
    await page.locator("[data-slot='service-form-price-input']").fill("60");

    await page.locator("[data-slot='services-edit-panel-save']").click();
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}.*toast=changes_saved`));

    const rows = await getAuditLogRowsSince(cursor, "service.updated");
    const match = rows.find((r) => r.entity_id === CLASSIC_MANICURE_ID);
    expect(match).toBeDefined();
    const payload = match!.payload as {
      changes: Record<string, [unknown, unknown]>;
    };

    // FR-030 inverse: ONLY price_cents in the diff — no deduction keys.
    expect(payload.changes).toEqual({ price_cents: [2500, 6000] });
  });
});
