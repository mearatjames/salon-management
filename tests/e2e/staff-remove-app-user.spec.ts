// E2E for issue #129: Settings → Staff "Remove from roster" of an active
// app-user.
//
// Coverage:
//   - Owner removes an active app-user → row disappears AND the email is
//     immediately free to re-invite at Settings → Onboarding (regression
//     for the original bug: re-invite hit `email_exists`).
//   - Manager opens an app-user row → the Remove button is disabled with
//     the owner-only helper-text (the matrix gates `remove_app_user` to
//     owners; managers keep `remove_pin_only`).
//
// Test data:
//   We seed a fresh `@tangnails.test` auth user + staff row per test instead
//   of using the fixture's `manager` (which is the worker's app-user but
//   shared with other tests on this worker). This spec is the only writer
//   of `app-user-remove-${workerIndex}-${testId}@tangnails.test`, so
//   teardown is a single delete by email and never touches another spec's
//   state. Mirrors the test-data pattern in `tests/e2e/onboarding.spec.ts`
//   ("@tangnails.test" cleanup).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Local "exists?" probe — the `_db.ts` helper throws on not-found, which is
 *  exactly the case we want to assert here. Listing is fine for the test
 *  scope (single auth.users row per email). */
async function authUserIdForEmail(email: string): Promise<string | null> {
  const c = adminClient();
  const { data, error } = await c.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return user?.id ?? null;
}

/** Provision a fresh auth user + active app-user staff row. Returns the
 *  identifiers needed by the test. The display_name uses the worker's `[wN]`
 *  suffix so `staffFixture.deleteExtras()` reaps it on the next beforeEach
 *  if the test bails out mid-flight. */
async function provisionAppUser(
  fixture: StaffFixture,
  testTag: string
): Promise<{ staffId: string; email: string; displayName: string; userId: string }> {
  const c = adminClient();
  const email = `app-user-remove-${fixture.workerIndex}-${testTag}@tangnails.test`;
  const displayName = `Remove Target ${testTag} [w${fixture.workerIndex}]`;

  // Belt-and-suspenders: drop any stale rows from a prior failed run.
  await c.from("staff").delete().eq("email", email);
  const staleId = await authUserIdForEmail(email);
  if (staleId) {
    await c.auth.admin.deleteUser(staleId, false);
  }

  const { data: created, error: authErr } = await c.auth.admin.createUser({
    email,
    password: "tang-nails-dev",
    email_confirm: true,
  });
  if (authErr || !created.user) {
    throw new Error(`provisionAppUser: auth user create failed: ${authErr?.message ?? "no user"}`);
  }
  const userId = created.user.id;

  const { data: inserted, error: staffErr } = await c
    .from("staff")
    .insert({
      user_id: userId,
      display_name: displayName,
      email,
      role: "technician",
      color_token: "--avatar-iris",
      active: true,
      state: "active",
    })
    .select("id")
    .single();
  if (staffErr || !inserted) {
    throw new Error(`provisionAppUser: staff insert failed: ${staffErr?.message ?? "no row"}`);
  }
  return { staffId: inserted.id as string, email, displayName, userId };
}

/** Best-effort teardown: deletes both the staff row (by email) and any
 *  auth.users still owning the address. Tolerates "already gone" because the
 *  happy-path test ALSO frees the auth user. */
async function teardownAppUser(email: string): Promise<void> {
  const c = adminClient();
  await c.from("staff").delete().eq("email", email);
  const remaining = await authUserIdForEmail(email);
  if (remaining) {
    await c.auth.admin.deleteUser(remaining, false);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("129: remove an active app-user from Settings → Staff", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping issue #129 specs.");
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await staffFixture.deleteExtras();
  });

  test("owner removes an active app-user → email is free to re-invite from Onboarding", async ({
    page,
    staffFixture,
  }) => {
    const target = await provisionAppUser(staffFixture, "happy");
    try {
      await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
      expect(new URL(page.url()).pathname).toBe("/settings/staff");

      // Open the target's edit panel.
      await page.locator(`[data-staff-id="${target.staffId}"]`).first().click();
      await page.waitForURL(/\/settings\/staff\?selected=/);

      // The danger-zone Remove button advertises its target kind so the
      // test can be precise about the branch under exercise.
      const removeButton = page.locator(
        "[data-slot='danger-zone-remove'][data-target-kind='app_user']"
      );
      await expect(removeButton).toBeVisible();
      await expect(removeButton).toBeEnabled();
      await removeButton.click();

      // The rich app-user dialog (vs the simple PIN-only one) — distinguish
      // by the dedicated slot id.
      const dialog = page.locator("[data-slot='remove-app-user-dialog']");
      await expect(dialog).toBeVisible();
      // Confirm submit is initially disabled (ack + typed-name both unset).
      const confirmBtn = dialog.locator("[data-slot='remove-app-user-confirm']");
      await expect(confirmBtn).toBeDisabled();

      // Tick the ack.
      await dialog.locator("[data-slot='remove-app-user-ack']").check();
      await expect(confirmBtn).toBeDisabled();

      // Type the matching display_name — case-insensitive trim is server-side
      // too, but we type the canonical casing here for clarity.
      await dialog.locator("[data-slot='remove-app-user-typed-name']").fill(target.displayName);
      await expect(confirmBtn).toBeEnabled();

      await Promise.all([
        page.waitForURL(/\/settings\/staff\?toast=staff_removed/),
        confirmBtn.click(),
      ]);

      // The row is gone from the active roster.
      await expect(page.locator(`[data-staff-id="${target.staffId}"]`).first()).not.toBeVisible();

      // DB state: staff row is anonymized, auth user is gone.
      const c = adminClient();
      const { data: dbRow } = await c
        .from("staff")
        .select("id, display_name, email, pin_hash, user_id, color_token, removed_at, active")
        .eq("id", target.staffId)
        .single();
      expect(dbRow).toBeTruthy();
      expect((dbRow!.display_name as string).startsWith("Former staff")).toBe(true);
      expect(dbRow!.email).toBeNull();
      expect(dbRow!.pin_hash).toBeNull();
      expect(dbRow!.user_id).toBeNull();
      expect(dbRow!.color_token).toBe("--avatar-slate");
      expect(typeof dbRow!.removed_at).toBe("string");
      expect(dbRow!.active).toBe(false);
      const authStillThere = await authUserIdForEmail(target.email);
      expect(authStillThere).toBeNull();

      // Re-invite the same email at /settings/onboarding — should succeed
      // (the auth user is gone + staff row is anonymized, so the partial
      // unique index `staff_email_lower_unique` no longer covers it).
      await page.goto("/settings/onboarding");
      const reinviteName = `Reinvite ${Date.now()} [w${staffFixture.workerIndex}]`;
      // Quick-invite via the Onboard CTA sheet — same pattern as
      // onboarding.spec.ts § US5 `quickInvite`.
      await page
        .locator("[data-slot='onboard-cta']")
        .getByRole("button", { name: /Onboard user/i })
        .click();
      await expect(page.locator("[data-slot='onboard-sheet']")).toBeVisible();
      await page.locator("[data-slot='onb-name-input']").fill(reinviteName);
      await page.locator("[data-slot='onb-email-input']").fill(target.email);
      await page.locator("[data-slot='onb-role-tile'][data-role='technician']").click();
      await Promise.all([
        page.waitForURL(/\/settings\/onboarding\?toast=invited/),
        page.getByRole("button", { name: /Send invite/i }).click(),
      ]);

      // Verify the new invite row landed and references a fresh staff.id.
      const { data: newInvite } = await adminClient()
        .from("staff")
        .select("id, email, state")
        .eq("email", target.email)
        .is("removed_at", null)
        .single();
      expect(newInvite).toBeTruthy();
      expect(newInvite!.email).toBe(target.email);
      expect(newInvite!.id).not.toBe(target.staffId);
      expect(newInvite!.state).toBe("invited");
    } finally {
      await teardownAppUser(target.email);
    }
  });

  test("manager opens an active app-user row → Remove from roster is disabled with owner-only helper text", async ({
    page,
    staffFixture,
  }) => {
    const target = await provisionAppUser(staffFixture, "manager-blocked");
    try {
      await signInAs(page, staffFixture, staffFixture.manager, {
        nextPath: "/settings/staff",
      });
      expect(new URL(page.url()).pathname).toBe("/settings/staff");

      await page.locator(`[data-staff-id="${target.staffId}"]`).first().click();
      await page.waitForURL(/\/settings\/staff\?selected=/);

      const removeButton = page.locator(
        "[data-slot='danger-zone-remove'][data-target-kind='app_user']"
      );
      await expect(removeButton).toBeVisible();
      await expect(removeButton).toBeDisabled();
      // The lifecycleTooltip helper renders the owner-only message rather
      // than the manager×owner fallback for this case.
      await expect(removeButton).toHaveAttribute("title", /Owners can remove app users/i);
    } finally {
      await teardownAppUser(target.email);
    }
  });
});
