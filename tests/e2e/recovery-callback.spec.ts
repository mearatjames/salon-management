// E2E for `/auth/recovery-callback` — the implicit-flow landing page that
// completes an admin-initiated password reset (issue #126).
//
// Background: `sendUserPasswordReset` (Settings → Onboarding → "Send password
// reset") delivers the recovery link through a dedicated *implicit-flow*
// client, because the link is opened in the TARGET's browser, not the
// owner's. A PKCE link's code verifier lives in the owner's browser, so the
// admin reset path was completely non-functional before this fix — every
// recipient landed on `/login?error=oauth_failed`.
//
// This spec mints a real recovery link via the Supabase admin API
// (`generateLink` — the same non-Mailpit approach `set-pin.spec.ts` uses for
// invite links) and follows it in a clean page, asserting the user reaches
// the `/reset-password` form and can set a new password — the round-trip
// that used to fail.
//
// The spec provisions + tears down its OWN throwaway auth user (no `staff`
// row needed — the callback only needs a valid auth user), with a unique
// email per run, so it neither mutates shared tables nor races other
// workers. It imports `test`/`expect` from `@playwright/test` directly.
//
// IMPORTANT: `/auth/recovery-callback` must be in Supabase's
// `additional_redirect_urls` (supabase/config.toml — and the hosted
// preview/prod dashboards). A `config.toml` change needs
// `supabase stop && supabase start` to take effect; `supabase db reset`
// alone does not reload GoTrue's auth config.
//
// Skips automatically when Docker/Supabase is unreachable.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { test, expect } from "@playwright/test";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://127.0.0.1:3000";

// Provisioned-user password (≥ 8 chars — Supabase + `updatePassword` both
// enforce that minimum) and the distinct value the test sets via the form.
const PROVISION_PASSWORD = "recovery-e2e-pw";
const NEW_PASSWORD = "recovery-e2e-new-pw";

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

// Service-role client for provisioning + teardown. Same pattern as
// `_db.ts` / `set-pin.spec.ts`.
let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "tests/e2e/recovery-callback.spec.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }
  cachedAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

// Auth users this spec created — torn down in afterAll.
const provisionedUserIds: string[] = [];

/** Create a throwaway confirmed auth user and return its email + id. */
async function provisionRecoveryUser(): Promise<{ email: string; userId: string }> {
  const c = admin();
  const email = `recovery.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@recovery.e2e.test`;
  const { data, error } = await c.auth.admin.createUser({
    email,
    password: PROVISION_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `recovery-callback spec: createUser failed: ${error?.message ?? "no user returned"}`
    );
  }
  provisionedUserIds.push(data.user.id);
  return { email, userId: data.user.id };
}

/**
 * Mint a real recovery link for `email` via the Supabase admin API. The
 * resulting verify link uses the implicit flow (tokens land in the URL hash)
 * and carries `redirect_to` = `/auth/recovery-callback` — exactly the link
 * shape `sendUserPasswordReset` produces.
 */
async function generateRecoveryLink(email: string): Promise<string> {
  const c = admin();
  const { data, error } = await c.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${BASE_URL}/auth/recovery-callback` },
  });
  if (error || !data.properties?.action_link) {
    throw new Error(
      `recovery-callback spec: generateLink failed: ${error?.message ?? "no action_link"}`
    );
  }
  return data.properties.action_link;
}

test.describe.serial("admin password reset: /auth/recovery-callback", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping recovery-callback specs (Docker unavailable)."
      );
    }
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    const c = admin();
    for (const id of provisionedUserIds.splice(0)) {
      const { error } = await c.auth.admin.deleteUser(id);
      if (error && !/not found/i.test(error.message)) {
        throw new Error(`recovery-callback spec: teardown deleteUser failed: ${error.message}`);
      }
    }
  });

  test("recovery link completes at /reset-password and a new password can be set", async ({
    page,
  }) => {
    const { email } = await provisionRecoveryUser();
    const recoveryLink = await generateRecoveryLink(email);

    // Follow the link. Supabase's /auth/v1/verify completes the OTP and
    // redirects to `/auth/recovery-callback` with the session tokens in the
    // URL hash; the client page hands them to `completeRecovery`, which
    // establishes the cookie session and forwards to `/reset-password`.
    await page.goto(recoveryLink);
    await page.waitForURL(/\/reset-password($|\?)/, { timeout: 20_000 });

    // The fix: we land on the new-password FORM, not the expired card and
    // not `/login?error=oauth_failed`.
    await expect(page).not.toHaveURL(/error=/);
    await expect(page.locator("#reset-password")).toBeVisible();

    // Set a new password — succeeding here proves the recovery session is
    // real (`updateUser` requires an authenticated session).
    await page.locator("#reset-password").fill(NEW_PASSWORD);
    await page.locator("#reset-confirm").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForURL(/\/select-staff($|\?)/, { timeout: 15_000 });
  });

  test("opening /auth/recovery-callback with no token lands on the recovery-expired surface", async ({
    page,
  }) => {
    // No hash → no tokens → the callback page bounces to the recovery-specific
    // expired surface (NOT the generic `/login?error=oauth_failed`).
    await page.goto("/auth/recovery-callback");
    await page.waitForURL(/\/reset-password\?error=expired/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();
  });
});
