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

import { createClient } from "@supabase/supabase-js";

import {
  getAuditLogRowsSince,
  getAuthUserByEmail,
  getStaffByDisplayName,
  newAuditCursor,
} from "./_db";
import { test, expect, signInAs, type StaffFixture } from "./_fixtures";

function workerHex(workerIndex: number): string {
  return workerIndex.toString(16).padStart(4, "0");
}

function inactiveIrisId(fixture: StaffFixture): string {
  return `f0000000-0000-0000-${workerHex(fixture.workerIndex)}-000000000099`;
}

function inactiveIrisName(fixture: StaffFixture): string {
  return `Inactive Iris [w${fixture.workerIndex}]`;
}

// Per-worker inserted inactive row used by US1(d) and similar scenarios.
// Cleaned up by `staffFixture.deleteExtras()` in the next `beforeEach`.
async function insertInactiveSeed(fixture: StaffFixture): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = inactiveIrisId(fixture);
  // The `staff` CHECK requires pin_hash IS NOT NULL OR user_id IS NOT NULL.
  // Provide a dummy bcrypt-shaped hash so the constraint is satisfied; this
  // row is never logged in with, only used to verify the inactive-row UI.
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

// Local convenience wrapper around `signInAs(page, fixture, member)` — keeps
// the per-test sign-in lines terse. The manager/tech variants were pruned
// alongside the US6 block (see docs/e2e-pruning-audit.md § staff.spec.ts);
// the remaining specs all sign in as the owner.
function signInAsOwner(
  page: import("@playwright/test").Page,
  fixture: StaffFixture,
  nextPath = "/settings/staff"
) {
  return signInAs(page, fixture, fixture.owner, { nextPath });
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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    // Reclaim any worker-namespaced extras (e.g. inactive Iris) left over
    // from prior tests so the chip-count assertions below aren't polluted.
    await staffFixture.deleteExtras();
  });

  test("(a) owner reaches /settings/staff and sees the fixture trio in role-priority order", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    expect(new URL(page.url()).pathname).toBe("/settings/staff");

    // At least 6 rows visible (3 seeded staff + this worker's fixture trio).
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    expect(await rows.count()).toBeGreaterThanOrEqual(6);

    // Order within this worker's namespace: owner → manager → technician.
    const names = await rows.allTextContents();
    const joined = names.join(" | ");
    const ownerIdx = joined.indexOf(staffFixture.owner.displayName);
    const managerIdx = joined.indexOf(staffFixture.manager.displayName);
    const techIdx = joined.indexOf(staffFixture.tech.displayName);
    expect(ownerIdx).toBeGreaterThan(-1);
    expect(managerIdx).toBeGreaterThan(ownerIdx);
    expect(techIdx).toBeGreaterThan(managerIdx);

    // Chip counts come from the global roster so they're ≥ 6 active /
    // ≥ 6 total / ≥ 0 inactive when seed + fixture rows are present.
    // Inactive count is left unasserted because parallel workers may have
    // their own inactive extras live during this test (their fixture's
    // `deleteExtras` only sweeps the worker's namespace).
    const activeChip = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const allChip = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const activeCount = Number(
      (await activeChip.locator("[data-slot='staff-filter-chip-count']").textContent()) ?? "0"
    );
    const allCount = Number(
      (await allChip.locator("[data-slot='staff-filter-chip-count']").textContent()) ?? "0"
    );
    expect(activeCount).toBeGreaterThanOrEqual(6);
    expect(allCount).toBeGreaterThanOrEqual(6);

    // Right panel renders the empty-state heading.
    await expect(page.locator("[data-slot='staff-empty-state']")).toContainText(
      "Select a staff member"
    );
  });

  // US1(b) search narrows roster → moved to `tests/unit/staff/filter.test.ts`
  //   (filterStaff already exhaustively unit-tested — lines 49-119).
  // US1(c) empty-search copy → deleted; trivial static-text assertion.

  test("(d) Filter chips reveal an inactive row when present", async ({ page, staffFixture }) => {
    // Add an inactive row scoped to this worker so the Inactive filter has
    // something visible to flip to. Cleaned up by `staffFixture.deleteExtras()`
    // in the next beforeEach.
    const irisId = await insertInactiveSeed(staffFixture);

    await signInAsOwner(page, staffFixture);

    // Default filter is "Active": Iris is NOT shown. The active rows include
    // (at least) seed (3) + fixture trio (3) = 6.
    const rows = page.locator("[data-slot='staff-table'] [data-staff-id]");
    const irisRow = page.locator(`[data-slot='staff-table'] [data-staff-id='${irisId}']`);
    expect(await rows.count()).toBeGreaterThanOrEqual(6);
    await expect(irisRow).toHaveCount(0);

    const allChip = page.locator("[data-slot='staff-filter-chip'][data-filter='all']");
    const activeChip = page.locator("[data-slot='staff-filter-chip'][data-filter='active']");
    const inactiveChip = page.locator("[data-slot='staff-filter-chip'][data-filter='inactive']");
    // Inactive chip count ≥ 1 (this worker's Iris); other workers may have
    // their own inactive extras in parallel runs.
    const inactiveCount = Number(
      (await inactiveChip.locator("[data-slot='staff-filter-chip-count']").textContent()) ?? "0"
    );
    expect(inactiveCount).toBeGreaterThanOrEqual(1);

    // Click All — Iris becomes visible alongside the active rows.
    await allChip.click();
    await expect(irisRow).toBeVisible();

    // Back to Active — Iris disappears again.
    await activeChip.click();
    await expect(irisRow).toHaveCount(0);
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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await staffFixture.reset();
    // The wizard happy-path creates a worker-suffixed staff row; cleanup here
    // keeps the table tidy across re-runs.
    await staffFixture.deleteExtras();
  });

  test("(a) wizard happy path: add a worker-scoped staff with PIN, audit + row + toast URL", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);

    // Suffix the new staff's display_name with `[wN]` so
    // `staffFixture.deleteExtras()` (run by the next beforeEach) cleans the
    // row up under workers > 1.
    const newName = `Maya Chen [w${staffFixture.workerIndex}]`;
    const encodedName = encodeURIComponent(newName);

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
    await page.locator("[data-slot='wizard-name-input']").fill(newName);
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
    await page.waitForURL(
      new RegExp(`/settings/staff\\?selected=.+&toast=staff_added&name=${encodedName}`),
      { timeout: 10_000 }
    );

    // After the server-action redirect the page re-renders and the wizard
    // tears down (open state resets to false). New row visible in table.
    await expect(
      page.locator("[data-slot='staff-table'] [data-staff-id]").filter({ hasText: newName })
    ).toHaveCount(1);

    // Audit row check — exactly one `staff.added` with the expected payload.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.added");
    expect(rows).toHaveLength(1);
    const audit = rows[0];
    const payload = (audit.payload ?? {}) as Record<string, unknown>;
    expect(payload).toMatchObject({
      display_name: newName,
      role: "technician",
      color_token: "--avatar-green",
      pin_set: true,
    });
    // Raw PIN must NEVER appear in the payload.
    expect(JSON.stringify(payload)).not.toContain("1984");
    expect(payload).not.toHaveProperty("pin");
    expect(payload).not.toHaveProperty("authorizing_staff_id");

    // entity_id matches the new row's id.
    const newRow = await getStaffByDisplayName(newName);
    expect(audit.entity_id).toBe(newRow.id);
  });

  // US2(b) PIN mismatch resets buffer → moved to
  //   `tests/unit/staff/pin-keypad-state.test.ts` (reducer drives both the
  //   wizard and change-pin modal — same state machine, single test file).
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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await staffFixture.reset();
  });

  test("(a) selecting a row opens the edit panel and toggles ?selected= URL", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);

    // Initially the panel shows the empty state — no row is selected.
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();

    // The row is a <Link href="?selected=<id>"> — verify the href is correct,
    // then navigate. (Direct `click()` is brittle here: the sticky right-column
    // panel + grid layout intercepts pointer events at default Playwright
    // viewports. The link's `href` is the user-observable behavior we care
    // about — clicking it is what would fire a navigation.)
    const samRow = page.locator(
      `[data-slot='staff-table'] [data-staff-id='${staffFixture.tech.id}']`
    );
    await expect(samRow).toHaveAttribute(
      "href",
      new RegExp(`/settings/staff\\?selected=${staffFixture.tech.id}`)
    );

    // Activate via the keyboard (Enter on a focused link triggers
    // navigation reliably, regardless of pointer-event intercepts).
    await samRow.focus();
    await samRow.press("Enter");
    await page.waitForURL(/\/settings\/staff\?selected=.+/);

    const panel = page.locator("[data-slot='staff-edit-panel']");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-staff-id", staffFixture.tech.id);

    // The currently-selected row's href now toggles back to the bare path
    // — per FR-018, re-activating it deselects.
    await expect(samRow).toHaveAttribute("href", /^\/settings\/staff$/);
    await samRow.focus();
    await samRow.press("Enter");
    await page.waitForURL(/\/settings\/staff(\?.*)?$/);
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();
  });

  // US3(b) header preview live update    → moved to `tests/unit/staff/save-gate.test.ts`
  //   (`previewName` helper now backs the JSX).
  // US3(c) Save button enable conditions → moved to `tests/unit/staff/save-gate.test.ts`
  //   (`canSaveDraft` helper now backs the button's disabled gate).

  test("(d) Save persists the change, toast URL appears, table reflects new name, audit row has diff-aware payload", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    const techName = staffFixture.tech.displayName;
    const draftName = `${techName} EDITED`;
    const nameInput = page.locator("[data-slot='edit-panel-name-input']");
    await nameInput.fill(draftName);

    const saveBtn = page.locator("[data-slot='edit-panel-save']");
    await saveBtn.click();

    // After the click, `SubmitButton` disables itself and sets `aria-busy`
    // while the Server Action is in flight. Race-tolerant: `Promise.allSettled`
    // so a fast local server that redirects before the retry window expires
    // does not fail the suite — the unit tests back the pending-state logic.
    await Promise.allSettled([
      expect(saveBtn).toBeDisabled({ timeout: 2000 }),
      expect(saveBtn).toHaveAttribute("aria-busy", "true", { timeout: 2000 }),
    ]);

    // Server Action redirects back with ?selected=…&toast=changes_saved.
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=changes_saved/, {
      timeout: 10_000,
    });

    // Table row reflects the new name on next paint.
    await expect(
      page.locator(`[data-slot='staff-table'] [data-staff-id='${staffFixture.tech.id}']`)
    ).toContainText(draftName);

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
    expect(payload.before).toMatchObject({ display_name: techName });
    expect(payload.after).toMatchObject({ display_name: draftName });
    // No authorizing_staff_id key (override removed per Clarifications Q1).
    expect(payload).not.toHaveProperty("authorizing_staff_id");
  });

  // US3(e) draft discard on row switch → moved to `tests/unit/staff/save-gate.test.ts`
  //   (`draftFromTarget` returns a fresh non-dirty state for the new target,
  //   matching the `key={target.id}` remount semantics).

  test("(f) owner can save edits to their own record despite the disabled role select (#112)", async ({
    page,
    staffFixture,
  }) => {
    // Regression for #112. Editing your own staff record: the role select
    // is (correctly) disabled for a self-edit — you can't change your own
    // role — but a disabled <select> is omitted from the submitted
    // FormData. `updateStaff` then saw no `role`, rejected the entire save
    // with `invalid_role`, and (because the toaster had no mapping for that
    // code) failed completely silently — display name and every other field
    // on the form silently failed to persist. `updateStaff` now falls back
    // to the stored role when the field is absent, so a self-edit of the
    // other fields still saves.
    await signInAsOwner(page, staffFixture);
    await page.goto(`/settings/staff?selected=${staffFixture.owner.id}`);

    // The role select stays disabled — that's the expected self-edit rule.
    await expect(page.locator("[data-slot='edit-panel-role-select']")).toBeDisabled();

    const ownerName = staffFixture.owner.displayName;
    const draftName = `${ownerName} EDITED`;
    await page.locator("[data-slot='edit-panel-name-input']").fill(draftName);

    await page.locator("[data-slot='edit-panel-save']").click();

    // The save now succeeds: the redirect carries ?toast=changes_saved.
    // Before the fix it redirected to ?error=invalid_role and nothing
    // persisted.
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=changes_saved/, {
      timeout: 10_000,
    });

    // Table row reflects the new name on next paint.
    await expect(
      page.locator(`[data-slot='staff-table'] [data-staff-id='${staffFixture.owner.id}']`)
    ).toContainText(draftName);

    // Audit: exactly the display_name change persisted — `role` was carried
    // through unchanged, so it does not appear in `changes`.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(rows).toHaveLength(1);
    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    expect(payload.changes as readonly string[]).toEqual(["display_name"]);
    expect(payload.after).toMatchObject({ display_name: draftName });
  });
});

test.describe("US4: set or change PIN", () => {
  let supabaseUp = false;
  let auditCursor = "";

  // Per-worker id + name for the no-PIN test staff inserted in test (b).
  // `staffFixture.deleteExtras()` in the next `beforeEach` reclaims it.
  function lanaId(fixture: StaffFixture): string {
    return `f0000000-0000-0000-${workerHex(fixture.workerIndex)}-000000000088`;
  }
  function lanaName(fixture: StaffFixture): string {
    return `Lana Test [w${fixture.workerIndex}]`;
  }

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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await staffFixture.reset();
    await staffFixture.deleteExtras();
  });

  test("(a) Change PIN for the fixture tech (existing pin_hash) writes audit with previous_pin_set: true and no raw PIN", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);

    // Select the fixture tech (PIN 9999).
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    // PIN row shows "4-digit PIN set"; button label is "Change".
    const pinRow = page.locator("[data-slot='edit-panel-pin-row']");
    await expect(pinRow).toContainText("4-digit PIN set");
    const pinBtn = page.locator("[data-slot='edit-panel-pin-button']");
    await expect(pinBtn).toHaveText("Change");
    await expect(pinBtn).toBeEnabled();

    // Open the modal — title is just "Change PIN" (the staff name lives in
    // the description, not the title, so a long name can't overflow).
    await pinBtn.click();
    const modal = page.locator("[data-slot='change-pin-modal']");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-mode", "change");
    await expect(page.locator("[data-slot='change-pin-title']")).toHaveText("Change PIN");

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

    // entity_id is the fixture tech's id.
    expect(audit.entity_id).toBe(staffFixture.tech.id);
  });

  test("(b) Set PIN for a fresh staff (null pin_hash) writes audit with previous_pin_set: false", async ({
    page,
    staffFixture,
  }) => {
    // Insert a brand-new staff row with pin_hash: null. The
    // (pin_hash | user_id) CHECK constraint requires at least one of the
    // two — mint a per-worker auth user for this test so we don't collide
    // with the fixture's owner/manager auth users or another worker's Lana.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const TEST_EMAIL = `lana-test-w${staffFixture.workerIndex}@e2e.test`;
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

    const newLanaId = lanaId(staffFixture);
    const newLanaName = lanaName(staffFixture);
    const { error: insErr } = await c.from("staff").insert({
      id: newLanaId,
      user_id: testUserId,
      display_name: newLanaName,
      role: "technician",
      pin_hash: null,
      color_token: "--avatar-teal",
      active: true,
    });
    if (insErr) throw new Error(`Lana insert failed: ${insErr.message}`);

    await signInAsOwner(page, staffFixture);
    await page.goto(`/settings/staff?selected=${newLanaId}`);

    // PIN row label is "No PIN · Required to log in"; the "Set PIN" copy
    // lives on the button (asserted below). The row text concatenates label
    // + button (no separator), so we assert each piece separately.
    const pinRow = page.locator("[data-slot='edit-panel-pin-row']");
    await expect(pinRow).toContainText("No PIN");
    await expect(pinRow).toContainText("Required to log in");
    const pinBtn = page.locator("[data-slot='edit-panel-pin-button']");
    await expect(pinBtn).toHaveText("Set PIN");
    await expect(pinBtn).toBeEnabled();

    // Open the modal — title is just "Set PIN" (the staff name lives in the
    // description, not the title, so a long name can't overflow).
    await pinBtn.click();
    const modal = page.locator("[data-slot='change-pin-modal']");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-mode", "set");
    await expect(page.locator("[data-slot='change-pin-title']")).toHaveText("Set PIN");

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
    expect(audit.entity_id).toBe(newLanaId);
  });

  // US4(c) PIN mismatch in change-pin modal → moved to
  //   `tests/unit/staff/pin-keypad-state.test.ts` (reducer drives both the
  //   wizard and modal — same state machine, single test file).
});

test.describe("US5: deactivate, reactivate, remove", () => {
  let supabaseUp = false;
  let auditCursor = "";

  // Fixture tech — safe to deactivate / remove without tripping the
  // last-owner trigger (fixture.owner stays active for this).

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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await staffFixture.reset();
  });

  test("(a) deactivate the fixture tech: confirm dialog copy, badge flip, audit row + reactivate restores", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);

    // 023 § US4 — the show-inactive Switch is gone. Click the "All" filter
    // chip so the tech row stays visible after the deactivation.
    await page.locator("[data-slot='staff-filter-chip'][data-filter='all']").click();

    // Select the tech.
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    const techName = staffFixture.tech.displayName;
    const encodedName = encodeURIComponent(techName);

    // Click Deactivate — confirm dialog appears with the correct copy.
    const deactivateBtn = page.locator("[data-slot='danger-zone-deactivate']");
    await expect(deactivateBtn).toBeEnabled();
    await deactivateBtn.click();

    const dialog = page.locator("[data-slot='confirm-dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-variant", "deactivate");
    await expect(page.locator("[data-slot='confirm-dialog-title']")).toContainText(
      `Deactivate ${techName}?`
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
      new RegExp(`/settings/staff\\?selected=.+&toast=staff_deactivated&name=${encodedName}`),
      { timeout: 10_000 }
    );

    // Audit: one staff.deactivated row with empty payload.
    let auditRows = await getAuditLogRowsSince(auditCursor, "staff.deactivated");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].payload).toEqual({});
    expect(auditRows[0].entity_id).toBe(staffFixture.tech.id);

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
    const samRow = page.locator(
      `[data-slot='staff-table'] [data-staff-id='${staffFixture.tech.id}']`
    );
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
    expect(auditRows[0].entity_id).toBe(staffFixture.tech.id);

    // Row is Active again (`data-active="true"`); the panel re-shows
    // the Deactivate button.
    await expect(samRow).toHaveAttribute("data-active", "true");
    await expect(page.locator("[data-slot='danger-zone-deactivate']")).toBeVisible();
  });

  test("(b) remove the fixture tech: confirm dialog copy, row gone, panel returns to empty state, audit snapshots name + role", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    const techName = staffFixture.tech.displayName;
    const encodedName = encodeURIComponent(techName);

    // Click Remove — dialog appears with the correct copy.
    const removeBtn = page.locator("[data-slot='danger-zone-remove']");
    await expect(removeBtn).toBeEnabled();
    await removeBtn.click();

    const dialog = page.locator("[data-slot='confirm-dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-variant", "remove");
    await expect(page.locator("[data-slot='confirm-dialog-title']")).toContainText(
      `Remove ${techName}?`
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
    await page.waitForURL(new RegExp(`/settings/staff\\?toast=staff_removed&name=${encodedName}`), {
      timeout: 10_000,
    });
    expect(page.url()).not.toContain("selected=");

    // The tech row is no longer in the table.
    await expect(
      page.locator(`[data-slot='staff-table'] [data-staff-id='${staffFixture.tech.id}']`)
    ).toHaveCount(0);

    // Panel returns to the empty state.
    await expect(page.locator("[data-slot='staff-empty-state']")).toBeVisible();

    // Audit: one staff.removed row with display_name_at_removal +
    // role_at_removal snapshotted. Issue #129 extends the payload with
    // `email_at_removal` (parity with `user.removed`); the fixture tech is
    // PIN-only, so it's null on this row.
    const auditRows = await getAuditLogRowsSince(auditCursor, "staff.removed");
    expect(auditRows).toHaveLength(1);
    const payload = (auditRows[0].payload ?? {}) as Record<string, unknown>;
    expect(payload).toEqual({
      display_name_at_removal: techName,
      email_at_removal: null,
      role_at_removal: "technician",
    });
    expect(payload).not.toHaveProperty("authorizing_staff_id");
    expect(auditRows[0].entity_id).toBe(staffFixture.tech.id);
  });

  // US5(c) cancel inside deactivate dialog → moved to
  //   `tests/unit/staff/confirm-dialog.test.tsx` (Cancel → onOpenChange(false);
  //   the destructive form stays unsubmitted, so no Server Action fires).
});

// ── US6: restrict who can manage staff ──────────────────────────────────
//
// The US6 e2e block was pruned per docs/e2e-pruning-audit.md § staff.spec.ts:
//
//   - US6(a) technician redirect → moved to `tests/unit/staff/access-gate.test.ts`
//     (`canAccessStaffSettings` predicate; the redirect call site in page.tsx
//     is a one-liner around it).
//   - US6(b) manager × owner disabled controls → deleted; the permission
//     matrix in `tests/unit/staff/permissions.test.ts:85-103, 346-360` already
//     enumerates every (manager, owner, action) cell.
//   - US6(c) manager DOM-bypass POST → deleted; the server-side rejection +
//     audit-skip are covered by the same permission-matrix unit tests plus
//     `tests/unit/staff/audit.test.ts`.

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

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
  });

  test("(a) ?toast=staff_added&name=… fires success toast and clears params", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?toast=staff_added&name=Maya%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Maya Chen added to the roster");

    // Params are stripped after the bridge fires.
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(b) ?toast=changes_saved fires 'Changes saved'", async ({ page, staffFixture }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?toast=changes_saved");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Changes saved");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(c) ?toast=pin_updated fires 'PIN updated'", async ({ page, staffFixture }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?toast=pin_updated");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("PIN updated");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(d) ?toast=staff_deactivated&name=… fires '{name} deactivated'", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?toast=staff_deactivated&name=Sam%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Sam Chen deactivated");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(e) ?toast=staff_removed&name=… fires '{name} removed'", async ({ page, staffFixture }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?toast=staff_removed&name=Sam%20Chen");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Sam Chen removed");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(f) ?error=forbidden_target fires destructive toast", async ({ page, staffFixture }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/staff?error=forbidden_target");

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Only owners can edit owner accounts.");
    // Destructive variant — Sonner stamps the toast with type=error.
    await expect(toast).toHaveAttribute("data-type", "error");
    await expect.poll(() => new URL(page.url()).search).toBe("");
  });

  test("(g) two rapid toasts: only one is visible at a time (no stacking)", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);

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
