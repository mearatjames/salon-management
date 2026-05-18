// E2E for Settings → Staff (specs/006-staff-management).
//
// Docker / Supabase availability: same probe pattern as
// `tests/e2e/auth.spec.ts`. Without Docker the local Supabase is offline,
// so each describe block skips itself rather than failing.
//
// Each describe runs serial because the seeded state is shared. `beforeEach`
// captures an `audit_log` cursor (per-test) and re-applies the seeded staff
// rows so per-test mutations don't leak. The cursor pattern lets the suite
// run with workers > 1; the previous `truncateAuditLog()` approach forced
// `--workers=1`.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import {
  getAuditLogRowsSince,
  getAuthUserByEmail,
  getStaffByDisplayName,
  newAuditCursor,
  resetStaffToSeed,
} from "./_db";

async function insertInactiveSeed(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // The `staff` CHECK requires pin_hash IS NOT NULL OR user_id IS NOT NULL.
  // Provide a dummy bcrypt-shaped hash so the constraint is satisfied; this
  // row is never logged in with, only used to verify the inactive-row UI.
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
  // After PIN entry the device redirects to the `next` URL — /settings/staff.
  await page.waitForURL(/\/settings\/staff(\?|$)/, { timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("US1: see the roster at a glance", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await resetStaffToSeed();
  });

  test("(a) owner reaches /settings/staff and sees three seeded rows in role-priority order", async ({
    page,
  }) => {
    await signInAsMaya(page);
    expect(new URL(page.url()).pathname).toBe("/settings/staff");

    // Three seeded rows visible.
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    await expect(rows).toHaveCount(3);

    // Order: owner (Maya) → manager (Jordan) → technician (Sam).
    const names = await rows.allTextContents();
    const joined = names.join(" | ");
    const mayaIdx = joined.indexOf("Maya Patel");
    const jordanIdx = joined.indexOf("Jordan Lee");
    const samIdx = joined.indexOf("Sam Chen");
    expect(mayaIdx).toBeGreaterThan(-1);
    expect(jordanIdx).toBeGreaterThan(mayaIdx);
    expect(samIdx).toBeGreaterThan(jordanIdx);

    // 023 § US4 replaced the standalone staff-summary block with the
    // tabular counts on the filter chips. Assert the chip counts instead.
    const activeChip = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const allChip = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const inactiveChip = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
    await expect(activeChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("3");
    await expect(allChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("3");
    await expect(inactiveChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("0");

    // Right panel renders the empty-state heading.
    await expect(page.locator("[data-slot='staff-empty-state']")).toContainText(
      "Select a staff member"
    );
  });

  test('(b) search "ma" narrows the roster to Maya only', async ({ page }) => {
    await signInAsMaya(page);

    const input = page.locator("[data-slot='staff-search-input']");
    await input.fill("ma");

    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Maya Patel");
  });

  test("(c) empty search-result row shows 'No staff match your search.'", async ({ page }) => {
    await signInAsMaya(page);
    await page.locator("[data-slot='staff-search-input']").fill("zzzz-not-a-name");
    await expect(page.locator("[data-slot='staff-no-results']")).toHaveText(
      "No staff match your search."
    );
  });

  test("(d) Filter chips reveal an inactive seeded row when present", async ({ page }) => {
    // Add a fourth, inactive row directly via the service-role client so the
    // chips have something visible to flip to. Cleaned up by the next
    // beforeEach via resetStaffToSeed() (which deletes any non-seed rows).
    await insertInactiveSeed();

    await signInAsMaya(page);

    // Default filter is "Active": 3 active rows; chips show 4 / 3 / 1.
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    await expect(rows).toHaveCount(3);
    const allChip = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const activeChip = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactiveChip = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
    await expect(allChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("4");
    await expect(activeChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("3");
    await expect(inactiveChip.locator("[data-slot='staff-filter-chip-count']")).toHaveText("1");

    // Click All — Iris becomes visible.
    await allChip.click();
    await expect(rows).toHaveCount(4);
    await expect(
      page.locator("[data-staff-id='10000000-0000-0000-0000-000000000099']")
    ).toBeVisible();

    // Back to Active — Iris disappears again.
    await activeChip.click();
    await expect(rows).toHaveCount(3);
  });
});

test.describe("US2: add a new staff member with a PIN", () => {
  let supabaseUp = false;
  let auditCursor = "";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await resetStaffToSeed();
  });

  test("(a) wizard happy path: add Maya Chen with PIN, audit + row + toast URL", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Wizard not yet visible.
    await expect(page.locator("[data-slot='add-staff-wizard-sheet']")).toHaveCount(0);

    // Open wizard.
    await page.locator("[data-slot='add-staff-button']").click();
    await expect(page.locator("[data-slot='add-staff-wizard-sheet']")).toBeVisible();

    // Step 1 — Next disabled until name length ≥ 2.
    const nextBtn = page.locator("[data-slot='add-staff-wizard-footer-primary']");
    await expect(nextBtn).toBeDisabled();

    await page.locator("[data-slot='wizard-name-input']").fill("M");
    await expect(nextBtn).toBeDisabled();
    await page.locator("[data-slot='wizard-name-input']").fill("Maya Chen");
    await expect(nextBtn).toBeEnabled();

    // Pick role = technician (default already, but be explicit).
    await page.locator("[data-slot='wizard-role-select']").selectOption("technician");

    // Pick the Green swatch (default already, but verify by clicking).
    await page
      .locator("[data-slot='color-swatch'][data-color-token='--avatar-green'] input")
      .click();

    // Advance to PIN step.
    await nextBtn.click();
    await expect(page.locator("[data-slot='wizard-pin-step']")).toBeVisible();

    // Enter phase — tap 1 9 8 4.
    for (const d of ["1", "9", "8", "4"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // Auto-advances to confirm phase — the dot row resets.
    await expect(page.getByText("Confirm the PIN")).toBeVisible();

    // Confirm phase — same digits.
    for (const d of ["1", "9", "8", "4"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // The form submits, the action redirects. Wait for the post-action URL.
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=staff_added&name=Maya%20Chen/, {
      timeout: 10_000,
    });

    // After the server-action redirect the page re-renders and the wizard
    // tears down (open state resets to false). New row visible in table.
    await expect(
      page.locator("[data-slot='staff-table'] [data-staff-id]").filter({ hasText: "Maya Chen" })
    ).toHaveCount(1);

    // Audit row check — exactly one `staff.added` with the expected payload.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.added");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    const payload = (audit.payload ?? {}) as Record<string, unknown>;
    expect(payload).toMatchObject({
      display_name: "Maya Chen",
      role: "technician",
      color_token: "--avatar-green",
      pin_set: true,
    });
    // Raw PIN must NEVER appear in the payload.
    expect(JSON.stringify(payload)).not.toContain("1984");
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("authorizing_staff_id");

    // entity_id matches the new row's id.
    const newRow = await getStaffByDisplayName("Maya Chen");
    expect(audit.entity_id).toBe(newRow.id);
  });

  test("(b) PIN mismatch resets buffer and shows error", async ({ page }) => {
    await signInAsMaya(page);
    await page.locator("[data-slot='add-staff-button']").click();
    await page.locator("[data-slot='wizard-name-input']").fill("Test Staff");
    await page.locator("[data-slot='add-staff-wizard-footer-primary']").click();
    await expect(page.locator("[data-slot='wizard-pin-step']")).toBeVisible();

    // Enter 1 1 1 1.
    for (const d of ["1", "1", "1", "1"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    await expect(page.getByText("Confirm the PIN")).toBeVisible();

    // Confirm with 2 2 2 2 (mismatch).
    for (const d of ["2", "2", "2", "2"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // Error appears, return to enter phase.
    await expect(page.getByText("PINs didn't match. Try again.")).toBeVisible();
    await expect(page.getByText("Enter a 4-digit PIN")).toBeVisible();

    // No audit row should exist for the failed attempt.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.added");
    expect(rows).toHaveLength(0);
  });
});

test.describe("US3: edit a staff member", () => {
  let supabaseUp = false;
  let auditCursor = "";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await resetStaffToSeed();
  });

  test("(a) selecting a row opens the edit panel and toggles ?selected= URL", async ({ page }) => {
    await signInAsMaya(page);

    // Initially the panel shows the empty state — no row is selected.
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();

    // The row is a <Link href="?selected=<id>"> — verify the href is correct,
    // then navigate. (Direct `click()` is brittle here: the sticky right-column
    // panel + grid layout intercepts pointer events at default Playwright
    // viewports. The link's `href` is the user-observable behavior we care
    // about — clicking it is what would fire a navigation.)
    const samRow = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000003']"
    );
    await expect(samRow).toHaveAttribute(
      "href",
      /\/settings\/staff\?selected=10000000-0000-0000-0000-000000000003/
    );

    // Activate via the keyboard (Enter on a focused link triggers
    // navigation reliably, regardless of pointer-event intercepts).
    await samRow.focus();
    await samRow.press("Enter");
    await page.waitForURL(/\/settings\/staff\?selected=.+/);

    const panel = page.locator("[data-slot='staff-edit-panel']");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-staff-id", "10000000-0000-0000-0000-000000000003");

    // The currently-selected row's href now toggles back to the bare path
    // — per FR-018, re-activating it deselects.
    await expect(samRow).toHaveAttribute("href", /^\/settings\/staff$/);
    await samRow.focus();
    await samRow.press("Enter");
    await page.waitForURL(/\/settings\/staff(\?.*)?$/);
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();
  });

  test("(b) header preview updates live but the table row keeps old values until Save", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Navigate directly to the selected URL — equivalent to clicking the row
    // (the row is a <Link>). Avoids pointer-event-intercept flakiness.
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    const nameInput = page.locator("[data-slot='edit-panel-name-input']");
    const preview = page.locator("[data-slot='staff-panel-profile-name']");

    // Live preview matches the saved name on first render.
    await expect(preview).toHaveText("Sam Chen");

    // Type a new draft — preview updates immediately.
    await nameInput.fill("Sam C.");
    await expect(preview).toHaveText("Sam C.");

    // Table row still reads "Sam Chen" — drafts are not committed yet.
    const samRow = page.locator(
      "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000003']"
    );
    await expect(samRow).toContainText("Sam Chen");
  });

  test("(c) Save button enables only when draft differs AND name length ≥ 2", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    const save = page.locator("[data-slot='edit-panel-save']");
    const nameInput = page.locator("[data-slot='edit-panel-name-input']");

    // No diff yet — Save disabled.
    await expect(save).toBeDisabled();

    // 1-char name — still disabled (invalid).
    await nameInput.fill("S");
    await expect(save).toBeDisabled();

    // Valid diff — enabled.
    await nameInput.fill("Sam C.");
    await expect(save).toBeEnabled();

    // Revert back to original (no diff) — disabled again.
    await nameInput.fill("Sam Chen");
    await expect(save).toBeDisabled();
  });

  test("(d) Save persists the change, toast URL appears, table reflects new name, audit row has diff-aware payload", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    const nameInput = page.locator("[data-slot='edit-panel-name-input']");
    await nameInput.fill("Sam C.");

    await page.locator("[data-slot='edit-panel-save']").click();

    // Server Action redirects back with ?selected=…&toast=changes_saved.
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=changes_saved/, {
      timeout: 10_000,
    });

    // Table row reflects the new name on next paint.
    await expect(
      page.locator(
        "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000003']"
      )
    ).toContainText("Sam C.");

    // Audit: exactly one `staff.updated` row with diff-aware payload.
    // 023-staff-payout-exemptions reshaped `payload.changes` from
    // `{ key: [before, after] }` to an ordered `string[]` of changed keys
    // (see `app/(studio)/settings/staff/_audit-diff.ts` § STAFF_DIFF_KEYS),
    // with `payload.before` / `payload.after` holding the scoped projections.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    const payload = (audit.payload ?? {}) as Record<string, unknown>;
    const changes = payload.changes as readonly string[];
    expect(changes).toEqual(["display_name"]);
    expect(payload.before).toMatchObject({ display_name: "Sam Chen" });
    expect(payload.after).toMatchObject({ display_name: "Sam C." });
    // No authorizing_staff_id key (override removed per Clarifications Q1).
    expect(payload).not.toHaveProperty("authorizing_staff_id");
  });

  test("(e) switching rows mid-edit silently discards drafts (FR-022)", async ({ page }) => {
    await signInAsMaya(page);

    // Select Sam, type a draft, do NOT save.
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    const nameInput = page.locator("[data-slot='edit-panel-name-input']");
    await nameInput.fill("Discard Me");
    await expect(page.locator("[data-slot='staff-panel-profile-name']")).toHaveText("Discard Me");

    // Switch to Jordan — same as clicking Jordan's row in the table; the
    // panel re-keys on target.id and discards the draft silently.
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000002");

    await expect(page.locator("[data-slot='staff-panel-profile-name']")).toHaveText("Jordan Lee");
    await expect(nameInput).toHaveValue("Jordan Lee");

    // No staff.updated audit row was written (we never saved).
    const rows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(rows).toHaveLength(0);

    // Sam's name in the table is still the seeded value.
    await expect(
      page.locator(
        "[data-slot='staff-table'] [data-staff-id='10000000-0000-0000-0000-000000000003']"
      )
    ).toContainText("Sam Chen");
  });
});

test.describe("US4: set or change PIN", () => {
  let supabaseUp = false;
  let auditCursor = "";

  // Stable id for the no-PIN test staff inserted in test (b). Cleaned up by
  // resetStaffToSeed() in the next beforeEach (it deletes any non-seed rows).
  const LANA_ID = "10000000-0000-0000-0000-000000000088";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US4 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await resetStaffToSeed();
  });

  test("(a) Change PIN for Sam (existing pin_hash) writes audit with previous_pin_set: true and no raw PIN", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // Select Sam (technician, seeded with pin_hash for PIN 9999).
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    // PIN row shows "4-digit PIN set"; button label is "Change".
    const pinRow = page.locator("[data-slot='edit-panel-pin-row']");
    await expect(pinRow).toContainText("4-digit PIN set");
    const pinBtn = page.locator("[data-slot='edit-panel-pin-button']");
    await expect(pinBtn).toHaveText("Change");
    await expect(pinBtn).toBeEnabled();

    // Open the modal — title says "Change PIN — Sam Chen".
    await pinBtn.click();
    const modal = page.locator("[data-slot='change-pin-modal']");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-mode", "change");
    await expect(page.locator("[data-slot='change-pin-title']")).toHaveText(
      "Change PIN — Sam Chen"
    );

    // Enter phase — tap 1 1 1 1, keypad auto-advances to confirm.
    for (const d of ["1", "1", "1", "1"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    await expect(modal).toHaveAttribute("data-phase", "confirm");

    // Confirm phase — same 4 digits, form submits + redirects.
    for (const d of ["1", "1", "1", "1"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=pin_updated/, { timeout: 10_000 });

    // Audit: exactly one staff.pin_set row, previous_pin_set === true, no raw PIN.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.pin_set");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    const payload = (audit.payload ?? {}) as Record<string, unknown>;
    expect(payload).toEqual({ previous_pin_set: true });
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("pin_hash");
    expect(payload).not.toHaveProperty("authorizing_staff_id");
    // Defense-in-depth: the raw PIN string must NEVER appear anywhere in
    // the payload JSON.
    expect(JSON.stringify(payload)).not.toContain("1111");

    // entity_id is Sam's id.
    expect(audit.entity_id).toBe("10000000-0000-0000-0000-000000000003");
  });

  test("(b) Set PIN for a fresh staff (null pin_hash) writes audit with previous_pin_set: false", async ({
    page,
  }) => {
    // Insert a brand-new staff row with pin_hash: null. The
    // (pin_hash | user_id) CHECK constraint requires at least one of the
    // two — create a one-off auth user just for this test (the seeded
    // owner@ / manager@ users are already linked to Maya / Jordan, so the
    // `staff_user_id_unique` constraint forbids re-using them).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Reuse an existing test auth user if present (e.g., from a previous
    // run); otherwise mint one. Either way the resulting id satisfies the
    // unique constraint because we use the same email each time.
    const TEST_EMAIL = "lana-test@tangnails.dev";
    let testUserId: string;
    try {
      const existing = await getAuthUserByEmail(TEST_EMAIL);
      testUserId = existing.id;
    } catch {
      const { data: created, error: createErr } = await c.auth.admin.createUser({
        email: TEST_EMAIL,
        password: "tang-nails-test",
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        throw new Error(`Lana auth user create failed: ${createErr?.message}`);
      }
      testUserId = created.user.id;
    }

    // Clean up any prior Lana row left over from previous runs (the seed
    // cleanup deletes non-seed rows but the unique constraint on user_id
    // still bites if a stale row is somehow present).
    await c.from("staff").delete().eq("user_id", testUserId);

    const { error: insErr } = await c.from("staff").insert({
      id: LANA_ID,
      user_id: testUserId,
      display_name: "Lana Test",
      role: "technician",
      pin_hash: null,
      color_token: "--avatar-teal",
      active: true,
    });
    if (insErr) throw new Error(`Lana insert failed: ${insErr.message}`);

    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${LANA_ID}`);

    // PIN row shows "No PIN set"; button label is "Set PIN".
    const pinRow = page.locator("[data-slot='edit-panel-pin-row']");
    await expect(pinRow).toContainText("No PIN set");
    await expect(pinRow).toContainText("Required to log in");
    const pinBtn = page.locator("[data-slot='edit-panel-pin-button']");
    await expect(pinBtn).toHaveText("Set PIN");
    await expect(pinBtn).toBeEnabled();

    // Open the modal — title says "Set PIN — Lana Test".
    await pinBtn.click();
    const modal = page.locator("[data-slot='change-pin-modal']");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-mode", "set");
    await expect(page.locator("[data-slot='change-pin-title']")).toHaveText("Set PIN — Lana Test");

    // Enter then confirm 2 2 2 2.
    for (const d of ["2", "2", "2", "2"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    await expect(modal).toHaveAttribute("data-phase", "confirm");
    for (const d of ["2", "2", "2", "2"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=pin_updated/, { timeout: 10_000 });

    // Audit: previous_pin_set === false for the freshly-set PIN.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.pin_set");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    const payload = (audit.payload ?? {}) as Record<string, unknown>;
    expect(payload).toEqual({ previous_pin_set: false });
    expect(JSON.stringify(payload)).not.toContain("2222");
    expect(audit.entity_id).toBe(LANA_ID);
  });

  test("(c) PIN mismatch resets buffers, returns to enter phase, writes no audit row", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?selected=10000000-0000-0000-0000-000000000003");

    await page.locator("[data-slot='edit-panel-pin-button']").click();
    const modal = page.locator("[data-slot='change-pin-modal']");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-phase", "enter");

    // Enter 1 2 3 4.
    for (const d of ["1", "2", "3", "4"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    await expect(modal).toHaveAttribute("data-phase", "confirm");

    // Confirm with 5 6 7 8 (mismatch).
    for (const d of ["5", "6", "7", "8"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // Error appears, modal returns to enter phase.
    await expect(page.getByText("PINs didn't match. Try again.")).toBeVisible();
    await expect(modal).toHaveAttribute("data-phase", "enter");

    // The modal stayed open (no submission); URL has not changed to a toast.
    expect(page.url()).not.toContain("toast=pin_updated");

    // No staff.pin_set audit row was written.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.pin_set");
    expect(rows).toHaveLength(0);
  });
});

test.describe("US5: deactivate, reactivate, remove", () => {
  let supabaseUp = false;
  let auditCursor = "";

  // Sam Chen — seeded technician, safe to deactivate / remove without
  // tripping the last-owner trigger.
  const SAM_ID = "10000000-0000-0000-0000-000000000003";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US5 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await resetStaffToSeed();
  });

  test("(a) deactivate Sam: confirm dialog copy, badge flip, audit row + reactivate restores", async ({
    page,
  }) => {
    await signInAsMaya(page);

    // 023 § US4 — the show-inactive Switch is gone. Click the "All" filter
    // chip so Sam's row stays visible after the deactivation.
    await page.locator("[data-slot='staff-filter-chip'][data-filter='all']").click();

    // Select Sam.
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    // Click Deactivate — confirm dialog appears with the correct copy.
    const deactivateBtn = page.locator("[data-slot='danger-zone-deactivate']");
    await expect(deactivateBtn).toBeEnabled();
    await deactivateBtn.click();

    const dialog = page.locator("[data-slot='confirm-dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-variant", "deactivate");
    await expect(page.locator("[data-slot='confirm-dialog-title']")).toContainText(
      "Deactivate Sam Chen?"
    );
    await expect(page.locator("[data-slot='confirm-dialog-body']")).toContainText(
      "won't be able to log in"
    );
    // Per Clarifications Q2 — no appointment-count warning line (i.e. no
    // "X appointments scheduled" string). The body's own copy DOES mention
    // "appointments and history are unaffected", so we look for the
    // count-warning pattern specifically.
    await expect(page.locator("[data-slot='confirm-dialog-body']")).not.toContainText(
      /\d+\s+appointment/
    );
    await expect(page.locator("[data-slot='confirm-dialog-body']")).not.toContainText("scheduled");

    // Click the destructive Deactivate CTA inside the dialog (in the
    // deactivate-variant form). Disambiguate from the footer button.
    await page
      .locator(
        "[data-slot='confirm-dialog-form'][data-variant='deactivate'] [data-slot='confirm-dialog-submit']"
      )
      .click();

    await page.waitForURL(
      /\/settings\/staff\?selected=.+&toast=staff_deactivated&name=Sam%20Chen/,
      { timeout: 10_000 }
    );

    // Audit: one staff.deactivated row with empty payload.
    let auditRows = await getAuditLogRowsSince(auditCursor, "staff.deactivated");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].payload).toEqual({});
    expect(auditRows[0].entity_id).toBe(SAM_ID);

    // 023 § US4 — click the All filter chip again so Sam's now-inactive
    // row is visible (localStorage persists across the redirect but a fresh
    // render may re-read the chip selection — re-clicking is idempotent).
    const allChip = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    if ((await allChip.getAttribute("data-selected")) !== "true") {
      await allChip.click();
    }

    // Sam's row still visible; the status dot conveys inactive (US5 row
    // redesign — no literal "Active"/"Inactive" text in the row). Assert via
    // the row's `data-active="false"` attribute instead of text. Panel Active
    // switch is off; footer button is now Reactivate (not Deactivate).
    const samRow = page.locator(`[data-slot='staff-table'] [data-staff-id='${SAM_ID}']`);
    await expect(samRow).toBeVisible();
    await expect(samRow).toHaveAttribute("data-active", "false");
    await expect(page.locator("[data-slot='danger-zone-reactivate']")).toBeVisible();
    await expect(page.locator("[data-slot='danger-zone-deactivate']")).toHaveCount(0);

    // Click Reactivate (single-click; no confirm dialog).
    await page.locator("[data-slot='danger-zone-reactivate']").click();
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=changes_saved/, {
      timeout: 10_000,
    });

    // Audit: one staff.reactivated row.
    auditRows = await getAuditLogRowsSince(auditCursor, "staff.reactivated");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].payload).toEqual({});
    expect(auditRows[0].entity_id).toBe(SAM_ID);

    // Row is Active again (`data-active="true"`); the panel re-shows
    // the Deactivate button.
    await expect(samRow).toHaveAttribute("data-active", "true");
    await expect(page.locator("[data-slot='danger-zone-deactivate']")).toBeVisible();
  });

  test("(b) remove Sam: confirm dialog copy, row gone, panel returns to empty state, audit snapshots name + role", async ({
    page,
  }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    // Click Remove — dialog appears with the correct copy.
    const removeBtn = page.locator("[data-slot='danger-zone-remove']");
    await expect(removeBtn).toBeEnabled();
    await removeBtn.click();

    const dialog = page.locator("[data-slot='confirm-dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-variant", "remove");
    await expect(page.locator("[data-slot='confirm-dialog-title']")).toContainText(
      "Remove Sam Chen?"
    );
    await expect(page.locator("[data-slot='confirm-dialog-body']")).toContainText(
      "removed from the staff roster"
    );

    // Submit the destructive Remove CTA.
    await page
      .locator(
        "[data-slot='confirm-dialog-form'][data-variant='remove'] [data-slot='confirm-dialog-submit']"
      )
      .click();

    // Redirect carries no ?selected= — the row is gone, panel returns to
    // empty state.
    await page.waitForURL(/\/settings\/staff\?toast=staff_removed&name=Sam%20Chen/, {
      timeout: 10_000,
    });
    expect(page.url()).not.toContain("selected=");

    // Sam's row is no longer in the table.
    await expect(page.locator(`[data-slot='staff-table'] [data-staff-id='${SAM_ID}']`)).toHaveCount(
      0
    );

    // Panel returns to the empty state.
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();

    // Audit: one staff.removed row with display_name_at_removal +
    // role_at_removal snapshotted.
    const auditRows = await getAuditLogRowsSince(auditCursor, "staff.removed");
    expect(auditRows).toHaveLength(1);
    const payload = (auditRows[0].payload ?? {}) as Record<string, unknown>;
    expect(payload).toEqual({
      display_name_at_removal: "Sam Chen",
      role_at_removal: "technician",
    });
    expect(payload).not.toHaveProperty("authorizing_staff_id");
    expect(auditRows[0].entity_id).toBe(SAM_ID);
  });

  test("(c) cancel inside the deactivate dialog closes it with no mutation", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto(`/settings/staff?selected=${SAM_ID}`);

    // Open the dialog.
    await page.locator("[data-slot='danger-zone-deactivate']").click();
    const dialog = page.locator("[data-slot='confirm-dialog']");
    await expect(dialog).toBeVisible();

    // Click Cancel — dialog closes, URL unchanged.
    const urlBefore = page.url();
    await page.locator("[data-slot='confirm-dialog-cancel']").click();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);

    // No audit row was written.
    const auditRows = await getAuditLogRowsSince(auditCursor, "staff.deactivated");
    expect(auditRows).toHaveLength(0);

    // Sam's row is still active in the table; footer still shows Deactivate.
    // US5 row redesign — no literal "Active" text; assert via `data-active`.
    const samRow = page.locator(`[data-slot='staff-table'] [data-staff-id='${SAM_ID}']`);
    await expect(samRow).toHaveAttribute("data-active", "true");
    await expect(page.locator("[data-slot='danger-zone-deactivate']")).toBeVisible();
  });
});

// ── US6: restrict who can manage staff ──────────────────────────────────
//
// Three negative-path scenarios that exercise the auth gate (layout) and the
// permission matrix (server actions). The matrix tests (T012) already cover
// the unit-level behavior; these e2e specs validate the full end-to-end
// chain: route gate → UI disabled state → banner → server-side rejection +
// zero audit rows.

// Sign in as Sam (technician). Sam has user_id: null in the seed so the
// sign-in flow uses the device user (owner@tangnails.dev) and then picks Sam
// at /select-staff with PIN 9999. The dashboard redirect after PIN entry
// makes /settings/staff the target of a later page.goto().
async function signInAsSam(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fdashboard");
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Sam Chen/ }).click();
  await page.waitForURL(/selectedTileId=/);
  // Sam's PIN is 9999.
  for (const d of ["9", "9", "9", "9"]) {
    await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  await page.waitForURL(/\/dashboard($|\?)/, { timeout: 10_000 });
}

// Sign in as Jordan (manager). Jordan is linked to manager@tangnails.dev in
// the seed; PIN 5678.
async function signInAsJordan(page: import("@playwright/test").Page) {
  await page.goto("/login?next=%2Fsettings%2Fstaff");
  await page.locator("#signin-email").fill("manager@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await page.waitForURL(/selectedTileId=/);
  for (const d of ["5", "6", "7", "8"]) {
    await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
  }
  await page.waitForURL(/\/settings\/staff(\?|$)/, { timeout: 10_000 });
}

test.describe("US6: restrict who can manage staff", () => {
  let supabaseUp = false;
  let auditCursor = "";

  // Maya's seeded id — fixed in the seed file.
  const MAYA_ID = "10000000-0000-0000-0000-000000000001";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US6 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await resetStaffToSeed();
  });

  test("(a) technician PIN session → /settings/staff redirects to /dashboard with no flash", async ({
    page,
  }) => {
    await signInAsSam(page);
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // Now try to reach /settings/staff. The layout's role gate calls
    // redirect('/dashboard') before any data fetch — Sam never sees the
    // staff table.
    await page.goto("/settings/staff");
    await page.waitForURL(/\/dashboard($|\?)/, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // "No flash" assertion: the staff table never rendered. Because the
    // server redirected before `{children}` mounted, the table data-slot is
    // absent on the resulting page.
    await expect(page.locator("[data-slot='staff-table']")).toHaveCount(0);
  });

  test("(b) manager opens Maya's row → all controls disabled, banner visible", async ({ page }) => {
    await signInAsJordan(page);

    // Open Maya (the owner) via the ?selected= URL — the layout has already
    // gated and we're on /settings/staff.
    await page.goto(`/settings/staff?selected=${MAYA_ID}`);

    const panel = page.locator("[data-slot='staff-edit-panel']");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-staff-id", MAYA_ID);

    // The inline banner from T055 is rendered above the form.
    const banner = page.locator("[data-slot='edit-panel-manager-owner-banner']");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Only owners can edit owner accounts.");

    // Every interactive control's `disabled` attribute is true. We assert
    // each individually rather than via a CSS selector so a regression on
    // any single control is reported by name.
    await expect(page.locator("[data-slot='edit-panel-name-input']")).toBeDisabled();
    await expect(page.locator("[data-slot='edit-panel-role-select']")).toBeDisabled();
    await expect(page.locator("[data-slot='edit-panel-active-switch']")).toBeDisabled();
    await expect(page.locator("[data-slot='edit-panel-pin-button']")).toBeDisabled();
    await expect(page.locator("[data-slot='edit-panel-save']")).toBeDisabled();
    // Maya is active, so the lifecycle button is the Deactivate variant.
    await expect(page.locator("[data-slot='danger-zone-deactivate']")).toBeDisabled();
    await expect(page.locator("[data-slot='danger-zone-remove']")).toBeDisabled();
  });

  test("(c) manager bypass POST against Maya → forbidden_target + zero audit rows", async ({
    page,
  }) => {
    await signInAsJordan(page);
    await page.goto(`/settings/staff?selected=${MAYA_ID}`);

    // Sanity: zero audit rows so far for staff.updated.
    let auditRows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(auditRows).toHaveLength(0);

    // Server Action endpoint URLs aren't documented as stable, so we
    // bypass the UI disabled state by stripping `disabled` attrs in the DOM
    // then submitting the form. The Server Action runs server-side and the
    // matrix rejects with PermissionError('forbidden_target') → redirect.
    // This is the equivalent of a hand-crafted POST: it forces the request
    // through the same Server Action endpoint the form normally targets,
    // proving the server enforces the gate (not the UI).
    await page.evaluate(() => {
      const form = document.querySelector(
        "[data-slot='staff-edit-panel']"
      ) as HTMLFormElement | null;
      if (!form) throw new Error("staff edit panel form not found");
      // Strip disabled on every form control so the browser includes them
      // in the submitted FormData. Also override the name input value to
      // simulate the "manager edits owner's display_name" attack.
      form.querySelectorAll("[disabled]").forEach((el) => {
        (el as HTMLElement).removeAttribute("disabled");
      });
      const nameInput = form.querySelector(
        "[data-slot='edit-panel-name-input']"
      ) as HTMLInputElement | null;
      if (nameInput) nameInput.value = "Hacked";
      // Native HTMLFormElement.submit() bypasses React's form action — we
      // want React's Server Action wiring, so use requestSubmit() with the
      // Save button (also recently un-disabled).
      const saveBtn = form.querySelector(
        "[data-slot='edit-panel-save']"
      ) as HTMLButtonElement | null;
      if (saveBtn) form.requestSubmit(saveBtn);
      else form.requestSubmit();
    });

    // The Server Action redirects with `?error=forbidden_target`.
    await page.waitForURL(/\/settings\/staff\?.*error=forbidden_target/, {
      timeout: 10_000,
    });
    expect(page.url()).toContain("error=forbidden_target");

    // Zero `staff.updated` audit rows. The matrix threw before recordAudit
    // ran, so no row exists.
    auditRows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(auditRows).toHaveLength(0);

    // Defense in depth: Maya's display_name in the DB is still "Maya Patel".
    const maya = await getStaffByDisplayName("Maya Patel");
    expect(maya.id).toBe(MAYA_ID);
  });
});

// ── US7: toasts ──────────────────────────────────────────────────────────
//
// The Server Actions in US2–US5 already exercise the URL → toast bridge
// end-to-end (each waits for `?toast=…` in the URL). This describe block
// asserts the *bridge itself*: navigating directly to `?toast=…` URLs fires
// the matching Sonner toast and the params are stripped on next render.
// That keeps each variant under tens of ms instead of re-running the full
// wizard / panel flow.
//
// Sonner default `expand={false}` means only one toast is visible at a time.
// The stacking test verifies two rapid navigations leave at most one toast
// on-screen — the second replaces the first.

test.describe("US7: toasts", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US7 staff specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await resetStaffToSeed();
  });

  test("(a) ?toast=staff_added&name=… fires success toast and clears params", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?toast=staff_added&name=Maya%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Maya Chen added to the roster");

    // Params are stripped after the bridge fires.
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(b) ?toast=changes_saved fires 'Changes saved'", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?toast=changes_saved");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Changes saved");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(c) ?toast=pin_updated fires 'PIN updated'", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?toast=pin_updated");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("PIN updated");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(d) ?toast=staff_deactivated&name=… fires '{name} deactivated'", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?toast=staff_deactivated&name=Sam%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Sam Chen deactivated");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(e) ?toast=staff_removed&name=… fires '{name} removed'", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?toast=staff_removed&name=Sam%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Sam Chen removed");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(f) ?error=forbidden_target fires destructive toast", async ({ page }) => {
    await signInAsMaya(page);
    await page.goto("/settings/staff?error=forbidden_target");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Only owners can edit owner accounts.");
    // Destructive variant — Sonner stamps the toast with type=error.
    await expect(toast).toHaveAttribute("data-type", "error");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(g) two rapid toasts: only one is visible at a time (no stacking)", async ({ page }) => {
    await signInAsMaya(page);

    // First navigation.
    await page.goto("/settings/staff?toast=changes_saved");
    // Wait for the first toast to appear so the bridge has actually fired.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({
      timeout: 5_000,
    });

    // Second navigation within ~100 ms of the first toast becoming visible.
    await page.goto("/settings/staff?toast=pin_updated");
    await expect(page.locator("[data-sonner-toast]").first()).toContainText("PIN updated", {
      timeout: 5_000,
    });

    // Only one Sonner toast on-screen at any sampled moment. Sonner's default
    // `expand={false}` collapses additional toasts under the front one but
    // they still mount as DOM nodes — assert via the visible state, not raw
    // count, so we don't fight the collapsed-stack behavior.
    const toasts = page.locator("[data-sonner-toast][data-visible='true']");
    await expect(toasts).toHaveCount(1);
  });
});
