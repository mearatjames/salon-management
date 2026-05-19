// E2E for the redesigned Add-staff wizard sheet (US7 of feature
// 023-staff-payout-exemptions). The wizard's existing state machine and
// `addStaff`/`setStaffPin` action calls are unchanged — only the chrome is
// re-skinned per research § R8:
//   - 420px right-side sheet shell
//   - three-pill header (Details / Set PIN / Done) with active highlight
//   - live preview card mirroring the in-progress draft
//   - sticky footer with Cancel + a per-step primary CTA
//
// Mirrors the Supabase-reachable / serial / per-test seed pattern from
// `tests/e2e/staff.spec.ts`.

import { test, expect, signInAs } from "./_fixtures";

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

test.describe.configure({ mode: "serial" });

test.describe("US7: Add-staff wizard sheet", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US7 add-wizard specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await staffFixture.deleteExtras();
  });

  test("(a) Add staff opens a right-side sheet at the wizard root", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    // Wizard not yet visible.
    await expect(page.locator("[data-slot='add-staff-wizard-sheet']")).toHaveCount(0);

    await page.locator("[data-slot='add-staff-button']").click();

    // Radix Sheet sets data-state="open" on the content element when open.
    const wizard = page.locator("[data-slot='add-staff-wizard-sheet'][data-state='open']");
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAttribute("data-side", "right");
  });

  test("(b) header shows three step pills with Details highlighted", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();
    await expect(
      page.locator("[data-slot='add-staff-wizard-sheet'][data-state='open']")
    ).toBeVisible();

    const pills = page.locator(".add-staff-wizard-pill");
    await expect(pills).toHaveCount(3);

    // Details pill is the active one on first open.
    const detailsPill = page.locator(".add-staff-wizard-pill[data-step='details']");
    await expect(detailsPill).toHaveAttribute("data-active", "true");
    await expect(detailsPill).toContainText("Details");

    // The other two pills are not active.
    await expect(page.locator(".add-staff-wizard-pill[data-step='set-pin']")).toHaveAttribute(
      "data-active",
      "false"
    );
    await expect(page.locator(".add-staff-wizard-pill[data-step='done']")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  test("(c) live preview card mirrors the in-progress draft", async ({ page, staffFixture }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();
    await expect(
      page.locator("[data-slot='add-staff-wizard-sheet'][data-state='open']")
    ).toBeVisible();

    const preview = page.locator("[data-slot='add-staff-wizard-preview']");
    await expect(preview).toBeVisible();

    // Type into the name field; preview updates in real time.
    await page.locator("[data-slot='wizard-name-input']").fill("Riley Ono");
    await expect(preview).toContainText("Riley Ono");
  });

  test("(d) footer shows Cancel + 'Next: set PIN' disabled until display_name non-empty", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();
    await expect(
      page.locator("[data-slot='add-staff-wizard-sheet'][data-state='open']")
    ).toBeVisible();

    const footer = page.locator("[data-slot='add-staff-wizard-footer']");
    await expect(footer).toBeVisible();

    const cancel = footer.locator("[data-slot='add-staff-wizard-footer-cancel']");
    await expect(cancel).toBeVisible();
    await expect(cancel).toContainText("Cancel");

    const primary = footer.locator("[data-slot='add-staff-wizard-footer-primary']");
    await expect(primary).toContainText("Next: set PIN");
    await expect(primary).toBeDisabled();

    // Length 1 still disabled.
    await page.locator("[data-slot='wizard-name-input']").fill("M");
    await expect(primary).toBeDisabled();

    // Length ≥ 2 enables it.
    await page.locator("[data-slot='wizard-name-input']").fill("Mo");
    await expect(primary).toBeEnabled();
  });

  test("(e) step 1 → step 2: pill highlights + PIN input renders + footer label updates", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();

    await page.locator("[data-slot='wizard-name-input']").fill("Step Two");
    const primary = page.locator("[data-slot='add-staff-wizard-footer-primary']");
    await primary.click();

    // Set-PIN pill is now active; Details is no longer active.
    await expect(page.locator(".add-staff-wizard-pill[data-step='set-pin']")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.locator(".add-staff-wizard-pill[data-step='details']")).toHaveAttribute(
      "data-active",
      "false"
    );

    // PIN keypad is rendered.
    await expect(page.locator("[data-slot='wizard-pin-step']")).toBeVisible();

    // Footer primary CTA updates to "Set PIN" (label drives off the active
    // step; the keypad still owns the actual submit gesture).
    await expect(primary).toContainText("Set PIN");
  });

  test("(f) step 2 → step 3: Done pill highlights + success state renders", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();

    // Suffix the created display_name with `[wN]` so `staffFixture.deleteExtras()`
    // (run in the next beforeEach) cleans the row up under workers > 1.
    const name = `Three Steps [w${staffFixture.workerIndex}]`;
    await page.locator("[data-slot='wizard-name-input']").fill(name);
    await page.locator("[data-slot='add-staff-wizard-footer-primary']").click();

    // Enter phase — tap 1 9 8 4.
    for (const d of ["1", "9", "8", "4"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    // Confirm phase — same digits.
    for (const d of ["1", "9", "8", "4"]) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // After confirm-match the wizard advances to step 3 (and the action
    // submits in the same microtask). The Done pill highlights.
    await expect(page.locator(".add-staff-wizard-pill[data-step='done']")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.locator("[data-slot='wizard-done-step']")).toBeVisible();
  });

  test("(g) cancel mid-wizard does not break the wizard; no partial-create (PIN-required)", async ({
    page,
    staffFixture,
  }) => {
    // FR-030 in the spec calls for "cancel mid-wizard leaves the partially-
    // created staff in the roster with a No PIN pill," but the underlying
    // `staff` CHECK requires `pin_hash IS NOT NULL OR user_id IS NOT NULL`,
    // so the wizard's `addStaff` only fires after confirm-PIN (see the
    // wizard's top-of-file PIN-required deviation note). The redesign keeps
    // that behavior unchanged per T059. We assert the closer: cancelling
    // mid-wizard cleanly tears down without leaving any staff row behind.
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.locator("[data-slot='add-staff-button']").click();

    const cancelName = `Will Cancel [w${staffFixture.workerIndex}]`;
    await page.locator("[data-slot='wizard-name-input']").fill(cancelName);
    await page.locator("[data-slot='add-staff-wizard-footer-primary']").click();
    await expect(page.locator("[data-slot='wizard-pin-step']")).toBeVisible();

    // Cancel from the footer.
    await page.locator("[data-slot='add-staff-wizard-footer-cancel']").click();

    // Sheet closes (Radix unmounts the content node), wizard root absent.
    await expect(page.locator("[data-slot='add-staff-wizard-sheet']")).toHaveCount(0);

    // No "Will Cancel" row in the roster — PIN-required guard means no row
    // was ever created.
    await expect(
      page.locator("[data-slot='staff-table'] [data-staff-id]").filter({ hasText: cancelName })
    ).toHaveCount(0);
  });
});
