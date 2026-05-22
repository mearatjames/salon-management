// E2E for `/set-pin` — the new step a no-PIN invitee reaches after
// setting their password (specs/048-invitee-self-set-pin).
//
// US1 (this file's scope): a quick-mode invitee (no PIN, password method)
// accepts their invite, sets a password, is routed to `/set-pin`, chooses a
// PIN, lands on `/select-staff` visible on the roster, and pins in with the
// PIN they just chose. A `user.pin_set` audit row is written and carries no
// raw PIN.
//
// The spec mutates `staff` (it provisions and tears down its own invited
// row + auth user), so it imports `test`/`expect` from `_fixtures` and runs
// serial. It does NOT touch the worker's seeded trio.
//
// Skips automatically when Docker/Supabase is unreachable, matching the
// pattern in tests/e2e/auth.spec.ts and tests/e2e/onboarding.spec.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { test, expect } from "./_fixtures";

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

// Service-role client for provisioning + assertions. Same pattern as
// `_db.ts` / `_fixtures.ts`.
let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "tests/e2e/set-pin.spec.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }
  cachedAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

const INVITEE_TEST_EMAIL_SUFFIX = "@setpin.e2e.test";

// Provisioned-invitee handle.
type Invitee = {
  email: string;
  userId: string;
  staffId: string;
  displayName: string;
};

// Provision an `invited`-state staff row with `pin_hash = null` and a
// linked auth user, then return an invite verify link. Uses
// `admin.inviteUserByEmail` (the real password-invite path) so the spec
// exercises the genuine accept-invite handshake.
async function provisionInvitee(opts: {
  displayName: string;
  invitedBy: string;
}): Promise<{ invitee: Invitee; verifyLink: string }> {
  const c = admin();
  const email = `invitee.${Date.now()}.${Math.random().toString(36).slice(2, 8)}${INVITEE_TEST_EMAIL_SUFFIX}`;

  // `inviteUserByEmail` creates the unconfirmed auth user AND returns its
  // record. `redirectTo` carries `?method=password` so /auth/invite-callback
  // routes the invitee to the password-setup form (mirrors the real
  // password-method invite in lib/onboarding/invite.ts).
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3000";
  const { data: invited, error: inviteErr } = await c.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${baseUrl}/auth/invite-callback?method=password`,
  });
  if (inviteErr || !invited.user) {
    throw new Error(`set-pin spec: inviteUserByEmail failed: ${inviteErr?.message ?? "no user"}`);
  }
  const userId = invited.user.id;

  // Insert the invited staff row — quick mode: no PIN, password method.
  const { data: staffRow, error: staffErr } = await c
    .from("staff")
    .insert({
      user_id: userId,
      display_name: opts.displayName,
      email,
      role: "technician",
      color_token: "--avatar-teal",
      pin_hash: null,
      state: "invited",
      active: false,
      invited_at: new Date().toISOString(),
      invited_by: opts.invitedBy,
      invite_method: "password",
    })
    .select("id")
    .single();
  if (staffErr || !staffRow) {
    throw new Error(`set-pin spec: staff insert failed: ${staffErr?.message ?? "no row"}`);
  }

  // Generate the invite verify link directly (no Mailpit round-trip needed
  // — the link is deterministic). `generateLink` with type "invite" returns
  // a `/auth/v1/verify?...` link for the just-invited user.
  const { data: linkData, error: linkErr } = await c.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: `${baseUrl}/auth/invite-callback?method=password` },
  });
  if (linkErr || !linkData.properties?.action_link) {
    throw new Error(`set-pin spec: generateLink failed: ${linkErr?.message ?? "no link"}`);
  }

  return {
    invitee: { email, userId, staffId: staffRow.id as string, displayName: opts.displayName },
    verifyLink: linkData.properties.action_link,
  };
}

// Tear down any invitee rows + auth users this spec created.
async function cleanupInvitees(): Promise<void> {
  const c = admin();
  // Delete staff rows first (clears the FK reference), then the auth users.
  const { data: rows } = await c
    .from("staff")
    .select("user_id")
    .like("email", `%${INVITEE_TEST_EMAIL_SUFFIX}`);
  await c.from("staff").delete().like("email", `%${INVITEE_TEST_EMAIL_SUFFIX}`);
  for (const row of rows ?? []) {
    const uid = (row as { user_id: string | null }).user_id;
    if (!uid) continue;
    const { error } = await c.auth.admin.deleteUser(uid);
    if (error && !/not found/i.test(error.message)) {
      // Best-effort — a leftover auth user doesn't break later runs because
      // each invitee uses a fresh randomized email.
      console.warn(`set-pin spec cleanup: deleteUser(${uid}) failed: ${error.message}`);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.describe("US1: invitee without a PIN sets their own", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 set-pin specs (Docker unavailable)."
      );
      return;
    }
    await cleanupInvitees();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await cleanupInvitees();
  });

  test("(US1) accept invite → set password → /set-pin → choose PIN → /select-staff → pin in", async ({
    page,
    staffFixture,
  }) => {
    const auditCursor = newAuditCursor();

    // 1. Provision a no-PIN invited staff row + linked auth user, and get
    //    the invite verify link.
    const { invitee, verifyLink } = await provisionInvitee({
      displayName: `Set Pin Invitee ${Date.now()}`,
      invitedBy: staffFixture.owner.id,
    });

    // 2. Follow the invite link. Supabase's /auth/v1/verify completes the
    //    OTP and bounces to /auth/invite-callback (implicit flow — the
    //    session tokens arrive in the URL hash). The client callback page
    //    hands the tokens to `acceptInvite`, which routes a password-method
    //    invite to /reset-password?type=invite.
    await page.goto(verifyLink);
    await page.waitForURL(/\/reset-password\?type=invite/, { timeout: 20_000 });

    // 3. Set a password. The invite form posts a hidden `method=invite`,
    //    so `updatePassword` redirects to the new /set-pin step.
    const newPassword = "set-pin-e2e-password";
    await page.locator("#reset-password").fill(newPassword);
    await page.locator("#reset-confirm").fill(newPassword);
    await page.getByRole("button", { name: "Set password and continue" }).click();

    // 4. Land on /set-pin — the new step.
    await page.waitForURL(/\/set-pin($|\?)/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Set your PIN" })).toBeVisible();

    // 5. Enter the PIN. The keypad auto-advances enter → confirm on the 4th
    //    digit (no submit button).
    const chosenPin = "8351";
    for (const d of chosenPin) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    // Wait for the confirm phase before firing the confirm digits.
    await expect(page.getByText("Confirm PIN")).toBeVisible({ timeout: 3_000 });
    for (const d of chosenPin) {
      await page.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }

    // 6. A confirm match submits the PIN and lands on /select-staff.
    await page.waitForURL(/\/select-staff($|\?)/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/select-staff");

    // 7. The invitee's tile is on the roster (the accept-invite handshake
    //    flipped the staff row to `active`).
    const inviteeTile = page.locator(`[data-staff-id="${invitee.staffId}"]`);
    await expect(inviteeTile).toBeVisible();

    // 8. Pin in with the chosen PIN — the PIN the invitee just set works.
    await inviteeTile.click();
    const modal = page.getByRole("dialog");
    await modal.waitFor({ state: "visible" });
    for (const d of chosenPin) {
      await modal.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    // A correct PIN routes off /select-staff (to /dashboard, the default).
    await page.waitForURL(/\/dashboard($|\?)/, { timeout: 15_000 });

    // 9. A `user.pin_set` audit row was written for this invitee.
    const pinSetRows = await getAuditLogRowsSince(auditCursor, "user.pin_set", [invitee.staffId]);
    expect(pinSetRows.length).toBe(1);
    const row = pinSetRows[0];
    expect(row.actor_user_id).toBe(invitee.userId);
    expect(row.acting_as_staff_id).toBe(invitee.staffId);
    expect(row.entity_type).toBe("user");
    expect(row.entity_id).toBe(invitee.staffId);
    expect(row.payload).toEqual({ pin_set: true, actor: "self" });

    // 10. Constitution III — the raw PIN never appears anywhere in the
    //     audit row (payload, ids, or any column).
    expect(JSON.stringify(row)).not.toContain(chosenPin);
  });
});
