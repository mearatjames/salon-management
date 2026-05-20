// E2E for the per-service deductions + two-pane services layout
// (specs/021-services-deductions).
//
// This spec was pruned in #61 (issue #45 follow-up). The audit at
// `docs/e2e-pruning-audit.md § services-deductions.spec.ts` removed 7
// duplicates of `tests/unit/services/deductions.test.ts` +
// `validation.test.ts` outright, and migrated 22 more to unit coverage —
// `tests/unit/services/audit-diff-keys.test.ts` picked up the FR-030
// audit-diff selectivity cases the legacy US5 (e)/(f)/(g) tests used to
// exercise via the browser. What stays here is the work that genuinely
// needs Playwright: two-pane DOM shape, panel mode transitions, discard
// guards, toast redirects, live-preview keystroke timing, the FR-021
// supply buffer-preservation cycle, and the role-gate aria/View-only chip.
//
// Patterns intentionally mirror tests/e2e/services.spec.ts (the 008 suite)
// so failures here read familiarly: same sign-in helper shape, same
// keyboard-driven row clicks (Enter on a focused <a>) to avoid pointer-
// event interception flakiness, same Supabase reachability probe.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

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
  const modal = page.getByRole("dialog");
  await modal.waitFor({ state: "visible" });
  await modal.getByRole("button", { name: "Digit 1", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 2", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 3", exact: true }).click();
  await modal.getByRole("button", { name: "Digit 4", exact: true }).click();
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

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
  const modal = page.getByRole("dialog");
  await modal.waitFor({ state: "visible" });
  for (const d of ["9", "9", "9", "9"]) {
    await modal.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  await page.waitForURL(/\/services(\?|$)/, { timeout: 10_000 });
}

// Restore the seed name for Classic manicure so the edit-and-save case in
// US1 doesn't leak modified state into later runs of the suite.
async function restoreClassicManicureName(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c.from("services").update({ name: "Classic manicure" }).eq("id", CLASSIC_MANICURE_ID);
}

// Reset Classic manicure's supply + card-fee fields back to the seeded
// defaults (mode = 'default', custom = null, supply = null). Run from
// `beforeEach` of the US3 / US4 describes that drive the supply form.
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
      supply_type_id: null,
    })
    .eq("id", CLASSIC_MANICURE_ID);
}

// Tracks every supply type this suite seeded so afterAll can detach + delete
// them in one pass (idempotent — re-runs see an empty set on the second pass).
const seededSupplyTypeIds = new Set<string>();

// Find-or-create a supply type by display name. Returns its uuid. Idempotent.
async function ensureSupplyType(name: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Match on the canonical column the DB enforces via UNIQUE (lower(trim(name))
  // collapsed whitespace). Cheaper than running canonicalizeName client-side.
  const trimmedLower = name.trim().toLowerCase().replace(/\s+/g, " ");
  const { data: existing, error: selErr } = await c
    .from("supply_types")
    .select("id")
    .eq("name_canonical", trimmedLower)
    .maybeSingle();
  if (selErr) throw new Error(`ensureSupplyType select failed: ${selErr.message}`);
  if (existing) {
    seededSupplyTypeIds.add(existing.id as string);
    return existing.id as string;
  }
  const { data, error } = await c.from("supply_types").insert({ name }).select("id").single();
  if (error) throw new Error(`ensureSupplyType insert failed: ${error.message}`);
  const id = data.id as string;
  seededSupplyTypeIds.add(id);
  return id;
}

// Detach any services pointing at the suite's seeded supply types, then
// delete the types + their audit rows. Idempotent.
async function cleanupSeededSupplyTypes(): Promise<void> {
  if (seededSupplyTypeIds.size === 0) return;
  const ids = Array.from(seededSupplyTypeIds);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c
    .from("services")
    .update({ supply_type_id: null, supply_amount_cents: null })
    .in("supply_type_id", ids);
  await c.from("audit_log").delete().in("entity_id", ids);
  await c.from("supply_types").delete().in("id", ids);
  seededSupplyTypeIds.clear();
}

// Picker-driven supply selection: open the trigger, then either click an
// existing row or use the inline-create flow. Returns when the picker has
// closed and the trigger reflects the chosen name.
async function pickSupplyType(
  page: import("@playwright/test").Page,
  name: string,
  mode: "create" | "existing"
): Promise<void> {
  const trigger = page.locator("[data-slot='supply-type-picker-trigger']");
  await trigger.click();
  if (mode === "create") {
    await page.locator("[data-slot='supply-type-picker-create-row']").click();
    const inlineInput = page.locator("[data-slot='supply-type-picker-create-input']");
    await expect(inlineInput).toBeVisible();
    await inlineInput.fill(name);
    await page.locator("[data-slot='supply-type-picker-create-save']").click();
  } else {
    await page.locator(`[data-slot='supply-type-picker-item']:has-text("${name}")`).first().click();
  }
  await expect(trigger).toContainText(name, { timeout: 5000 });
}

// Track any ad-hoc rows the Add-service case creates so afterAll can clean
// them up; keeps re-runs idempotent and prevents leaking into 008/011 specs.
const createdIds: string[] = [];

// Tooltip copy must match the deductions-section / owner-only-tooltip
// vocabulary exactly. If you change it in one place, change it in both.
const ROLE_GATE_TOOLTIP_COPY = "Only owners and managers can edit the catalog.";

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
// US3 — Supply deduction (only the FR-021 buffer-preservation case remains;
// the rest moved to `tests/unit/services/validation.test.ts` +
// `deductions.test.ts` per the #61 prune).
// ============================================================================

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
    await restoreClassicManicureDeductions();
    await cleanupSeededSupplyTypes();
  });

  test("(e) buffer preservation on toggle off → on (FR-021)", async ({ page }) => {
    await signInAsMaya(page);

    // 022 (T052): seed an existing supply type so the picker has a row to
    // select; the buffered state we're verifying is the picker's selectedId
    // (the supply_type_id) — same FR-021 rule, just expressed via the FK
    // instead of a free-text label.
    const typeName = "Buffer test gel";
    await ensureSupplyType(typeName);

    const row = page.locator(`[data-slot='service-row'][data-service-id='${CLASSIC_MANICURE_ID}']`);
    const link = row.locator("xpath=ancestor::a");
    await link.focus();
    await link.press("Enter");
    await page.waitForURL(new RegExp(`\\?selected=${CLASSIC_MANICURE_ID}`));

    const toggle = page.locator("[data-slot='deductions-supply-toggle']");
    await toggle.click();
    // Pick the seeded existing type.
    await pickSupplyType(page, typeName, "existing");
    // Toggle off → on without saving.
    await toggle.click();
    await expect(page.locator("[data-slot='deductions-supply-inputs']")).toHaveCount(0);
    await toggle.click();
    // Buffer preserved: the picker still shows the previously-selected type.
    const trigger = page.locator("[data-slot='supply-type-picker-trigger']");
    await expect(trigger).toContainText(typeName);
  });
});

// ============================================================================
// US4 — Net-to-tech (card) preview (only the live-keystroke timing case
// remains; the math itself moved to `tests/unit/services/deductions.test.ts`
// per the #61 prune).
// ============================================================================

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
    // Seed the "chrome" supply type once so the kept (b) case can pick it
    // via the existing-row path.
    await ensureSupplyType("chrome");
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureDeductions();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await restoreClassicManicureDeductions();
    await cleanupSeededSupplyTypes();
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
    await pickSupplyType(page, "chrome", "existing");
    const amount = page.locator("[data-slot='deductions-net-to-tech-amount']");
    await expect(amount).toHaveText("$42");

    // Type a new price — no Save click. Preview should reflect 60 - 3 - 5 = 52.
    await page.locator("[data-slot='service-form-price-input']").fill("60");
    await expect(amount).toHaveText("$52", { timeout: 500 });
  });
});

// ============================================================================
// 021-US5 — Role-gated edits + audit trail
// ============================================================================
//
// Only the aria-disabled / View-only chip / tooltip case remains. The audit
// row + minimal-diff (FR-030) tests moved to
// `tests/unit/services/audit-diff-keys.test.ts`; the role permission
// matrix is already exhaustively covered by
// `tests/unit/services/permissions.test.ts`. What's irreducibly e2e here
// is the accessibility wiring: aria-disabled on the segmented control + its
// options, the View-only chip swap, and the role-gate tooltip surfacing on
// hover of the wrapper span around the disabled Switch.

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

    // Supply toggle: aria-disabled at the underlying Radix Switch root.
    const supplyToggle = page.locator("[data-slot='deductions-supply-toggle']");
    await expect(supplyToggle).toHaveAttribute("aria-disabled", "true");
    // shadcn Switch also passes through the native `disabled` attribute.
    await expect(supplyToggle).toBeDisabled();

    // Supply amount input + picker are not rendered (toggle is off). We
    // assert this is the contracted state.
    await expect(page.locator("[data-slot='deductions-supply-amount-input']")).toHaveCount(0);
    await expect(page.locator("[data-slot='supply-type-picker']")).toHaveCount(0);

    // Save button is replaced by the "View only" chip per the existing 008
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
});
