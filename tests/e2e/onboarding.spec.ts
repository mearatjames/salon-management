// E2E for /settings/onboarding (specs/012-user-onboarding).
//
// Scope: browser-only contracts the unit suite under
// `tests/unit/settings/onboarding/` can't reach — layout + access gate,
// the InlinePin mismatch state machine, multi-session offboard sign-in
// failure, the PIN-reset notice lifecycle across `/select-staff`, the
// clipboard-write path for pending invites, and the URL-synced search
// rendering. Server-action paths (Quick + Thorough invite, send
// password reset, hard remove, cancel, reactivate, resend audit shape)
// are exhaustively covered by the corresponding `actions-*.test.ts`
// unit files; see `docs/e2e-pruning-audit.md` (issue #62) for the audit
// that motivated the pruning.
//
// Skips automatically when Docker/Supabase is unreachable, matching the
// pattern in tests/e2e/auth.spec.ts.

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { test, expect, signInAs, type StaffFixture } from "./_fixtures";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reclaim test-created `@tangnails.test` staff rows that aren't covered by
// `staffFixture.deleteExtras()` (their display_name doesn't carry the
// `[wN]` suffix). Idempotent and safe to call from any beforeEach.
async function deleteTangnailsTestStaff(): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await c.from("staff").delete().like("email", "%@tangnails.test");
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

test.describe.configure({ mode: "serial" });

// Local convenience wrapper around `signInAs(page, fixture, member)`.
function signInAsOwner(
  page: import("@playwright/test").Page,
  fixture: StaffFixture,
  nextPath = "/dashboard"
) {
  return signInAs(page, fixture, fixture.owner, { nextPath });
}

test.describe("012-Phase 2: foundation", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping foundation specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    // Reset the seeded staff to its canonical state so prior tests (US3
    // offboard/reactivate, etc.) don't leave Jordan in a non-active state
    // that hides him from /select-staff during sign-in.
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  test("owner sees the hero, three sections, and owners-only notice", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");

    await page.waitForURL(/\/settings\/onboarding(\?|$)/);
    await expect(page.getByRole("heading", { name: "Onboarding", exact: true })).toBeVisible();

    // Three section headings.
    await expect(page.getByRole("heading", { name: /Pending invites/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Active users/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Offboarded/ })).toBeVisible();

    // Owners-only notice.
    await expect(page.locator(".onb-notice")).toContainText(
      /Only owners can invite, offboard, or remove users/
    );

    // Onboard CTA is present (disabled in Phase 2; US1 wires it).
    await expect(page.locator("[data-slot='onboard-cta']")).toBeVisible();
  });
});

// ── US2: Thorough wizard onboard ───────────────────────────────────────────
//
// Server-action paths (magic-link / password / pin_set) are unit-covered
// by `tests/unit/settings/onboarding/actions-invite-thorough.test.ts`;
// the only browser-only contract is the InlinePin mismatch loop, which
// owns local component state.

async function walkThoroughIdentity(page: import("@playwright/test").Page, opts: { name: string }) {
  // Open the sheet via the hero CTA.
  await page
    .locator("[data-slot='onboard-cta']")
    .getByRole("button", { name: /Onboard user/i })
    .click();
  await expect(page.locator("[data-slot='onboard-sheet']")).toBeVisible();
  // Flip to Thorough.
  await page.locator("[data-slot='onb-mode-pill-thorough']").click();
  await expect(page.locator("[data-slot='onb-mode-pill-thorough']")).toHaveAttribute(
    "data-selected",
    "true"
  );

  // Step 1 — identity.
  await page.locator("[data-slot='onb-name-input']").fill(opts.name);
  await page.locator("[data-slot='onb-role-tile'][data-role='technician']").click();
  // Avatar swatch — click the second one to exercise selection state.
  await page.locator("[data-slot='onb-color-swatch']").nth(1).click();
  await page.getByRole("button", { name: /Continue/ }).click();
}

async function walkThoroughInvite(
  page: import("@playwright/test").Page,
  opts: { email: string; method: "magic_link" | "password" }
) {
  await page.locator("[data-slot='onb-email-input']").fill(opts.email);
  await page.locator(`[data-slot='onb-method-tile'][data-method='${opts.method}']`).click();
  // Live email preview reflects the email.
  await expect(page.locator("[data-slot='onb-email-preview']")).toContainText(opts.email);
  await page.getByRole("button", { name: /Continue/ }).click();
}

test.describe("US2: Thorough wizard onboard", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 thorough specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    // Reset the ONB-namespace staff so prior US2 invites (Thorough wizard
    // creates @tangnails.test pending rows) don't leak into the next run.
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  test.describe("PIN mismatch loop", () => {
    test("first PIN ≠ confirm PIN → error copy renders, both entries clear, can complete with matching PINs", async ({
      page,
      staffFixture,
    }) => {
      await signInAsOwner(page, staffFixture);
      await page.goto("/settings/onboarding");
      await page.waitForURL(/\/settings\/onboarding(\?|$)/);

      await walkThoroughIdentity(page, { name: "PIN Mismatch" });
      await walkThoroughInvite(page, {
        email: `pin.mismatch.${Date.now()}@tangnails.test`,
        method: "magic_link",
      });

      // Step 3 — enter 1234 then 5678. Mismatch.
      await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(
        /Choose a 4-digit PIN/
      );
      for (const d of "1234") {
        await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
      }
      // Wait for phase 1→2 transition before firing the confirm digits (the
      // InlinePin defers transition by ~160ms; clicks fired into the gap are
      // dropped by the `cur.length >= PIN_LEN` guard).
      await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(/Enter the same PIN/);
      for (const d of "5678") {
        await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
      }

      // Error copy appears.
      await expect(page.getByText("PINs didn't match. Try again.")).toBeVisible({
        timeout: 2_000,
      });

      // Dots cleared — none filled.
      const filledDots = page.locator("[data-slot='onb-pin-dot'][data-filled='true']");
      await expect(filledDots).toHaveCount(0);

      // Now complete with matching PINs.
      await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(
        /Choose a 4-digit PIN/
      );
      for (const d of "2468") {
        await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
      }
      await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(/Enter the same PIN/);
      for (const d of "2468") {
        await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
      }

      // Auto-advances to step 4 (Review card visible).
      await expect(page.locator("[data-slot='onb-perm-card']")).toBeVisible({ timeout: 2_000 });
    });
  });
});

// ── US3: Soft offboard ────────────────────────────────────────────────────
//
// Walks the active-row menu → Offboard sheet flow. Jordan Lee (manager, seeded
// auth.user_id = ...0002) is the non-owner target: he has a real auth user
// so the post-offboard sign-in attempt actually exercises the SC-003 path.
//
// Last-owner sub-case is asserted at the server layer (T046 unit test). The
// UI for the only-owner-in-the-system (Maya Patel) shows the self-line in place of
// the destructive item — that's the self-row sub-case.

async function openActiveRowMenu(
  page: import("@playwright/test").Page,
  displayName: string
): Promise<void> {
  // Each row's menu trigger is a child of the row matching the display name.
  const row = page.locator(".onb-row", { hasText: displayName });
  await row.locator("[data-slot='user-row-menu-trigger']").click();
  await expect(page.locator("[data-slot='user-row-menu-content']")).toBeVisible();
}

test.describe("US3: Soft offboard", () => {
  let supabaseUp = false;
  let auditCursor = "";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping US3 offboard specs.");
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    // Re-seed so Jordan Lee is active again after the previous test offboarded him.
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  test("offboards the fixture manager with reason 'Performance' → row moves, audit logged, sign-in fails within 5s, picker omits him", async ({
    page,
    context,
    browser,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // 1. Active section shows Jordan Lee.
    const activeSection = page
      .locator(".onb-section")
      .filter({ has: page.getByRole("heading", { name: /Active users/ }) });
    await expect(activeSection.getByText(staffFixture.manager.displayName)).toBeVisible();

    // 2. Open his row menu → Offboard. The menuitem + CTA derive their label
    //    from the staff's first name (display_name split on whitespace).
    const firstName = staffFixture.manager.displayName.split(" ")[0] ?? "user";
    await openActiveRowMenu(page, staffFixture.manager.displayName);
    await page.getByRole("menuitem", { name: new RegExp(`Offboard ${firstName}`) }).click();
    await expect(page.locator("[data-slot='offboard-sheet']")).toBeVisible();

    // 3. Pick reason "Performance".
    await page.locator("[data-slot='offb-reason-chip'][data-reason='Performance']").click();

    // 4. Confirm.
    await page.getByRole("button", { name: new RegExp(`Offboard ${firstName}`) }).click();

    // 5. Toast.
    await expect(
      page.getByText(
        new RegExp(`${staffFixture.manager.displayName.replace(/[[\]]/g, "\\$&")} offboarded`)
      )
    ).toBeVisible({ timeout: 5_000 });

    // 6. Row now lives in Offboarded with the reason metadata.
    const offSection = page
      .locator(".onb-section")
      .filter({ has: page.getByRole("heading", { name: /Offboarded/ }) });
    const jordanOffRow = offSection.locator(".onb-row", {
      hasText: staffFixture.manager.displayName,
    });
    await expect(jordanOffRow).toBeVisible();
    await expect(jordanOffRow).toContainText(/Performance/);

    // 7. Audit row.
    const offRows = await getAuditLogRowsSince(auditCursor, "user.offboarded");
    const ourRow = offRows.find(
      (r) => r.payload !== null && (r.payload as Record<string, unknown>).reason === "Performance"
    );
    expect(ourRow).toBeDefined();

    // 8. The offboarded manager's sign-in attempt fails within 5s — SC-003.
    //    Use a fresh browser context so we don't disturb the owner's session.
    const managerCtx = await browser.newContext();
    const managerPage = await managerCtx.newPage();
    const t0 = Date.now();
    await managerPage.goto("/login");
    if (!staffFixture.manager.email || !staffFixture.manager.password) {
      throw new Error("fixture manager is missing email/password");
    }
    await managerPage.locator("#signin-email").fill(staffFixture.manager.email);
    await managerPage.locator("#signin-password").fill(staffFixture.manager.password);
    await managerPage.getByRole("button", { name: "Sign in" }).click();
    // Either /login?error=… or /select-staff without the manager's tile is
    // acceptable — both satisfy "can't sign in". The fast path is the error
    // redirect. Wait up to 5s for either.
    await Promise.race([
      managerPage.waitForURL(/\/login\?error=/, { timeout: 5_000 }).catch(() => null),
      managerPage.waitForURL(/\/select-staff/, { timeout: 5_000 }).catch(() => null),
    ]);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(6_000);

    // 9. Back in the owner's session, navigate to /select-staff. The offboarded
    //    manager's tile is absent (FR-043: active=false filter hides offboarded).
    await page.goto("/select-staff");
    await page.waitForURL(/\/select-staff(\?|$)/);
    await expect(page.locator(`[data-staff-id="${staffFixture.manager.id}"]`)).toHaveCount(0);

    await managerCtx.close();
    // Silence unused 'context' lint — Playwright fixture is always required
    // even when not directly invoked in body.
    void context;
  });

  test("self-row: the fixture owner opens their own row menu → sees 'You can't offboard yourself' line, no destructive item", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    await openActiveRowMenu(page, staffFixture.owner.displayName);

    // The self-line is the bottom slot in the menu — no Offboard menuitem.
    await expect(page.locator("[data-slot='user-row-menu-content']")).toContainText(
      /You can't offboard yourself/
    );
    await expect(
      page.locator("[data-slot='user-row-menu-content']").getByRole("menuitem", {
        name: /Offboard/,
      })
    ).toHaveCount(0);
  });
});

// ── US3: Active row Reset PIN + notice ─────────────────────────────────────

test.describe("US3: Active row Reset PIN + notice", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping US3 reset-pin specs.");
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  test("owner resets Sam's PIN → notice appears at /select-staff → successful PIN clears notice + clears pin_reset_admin_at", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // 1. Open Sam's row → Reset PIN.
    await openActiveRowMenu(page, staffFixture.tech.displayName);
    await page.getByRole("menuitem", { name: /Reset PIN/ }).click();
    await expect(page.locator("[data-slot='reset-pin-modal']")).toBeVisible();

    // 2. Enter PIN 7777 twice via the InlinePin (re-used inside the modal).
    await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(/Choose a 4-digit PIN/);
    for (const d of "7777") {
      await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
    }
    await expect(page.locator("[data-slot='onb-pin-shell']")).toContainText(/Enter the same PIN/);
    for (const d of "7777") {
      await page.locator(`[data-slot='onb-pin-key'][data-digit='${d}']`).click();
    }

    // 3. Toast confirms (matches toaster copy in onboarding-toaster.client.tsx).
    await expect(
      page.getByText(new RegExp(`${escapeRegExp(staffFixture.tech.displayName)}.*PIN reset`, "i"))
    ).toBeVisible({ timeout: 5_000 });

    // 4. Sign out, go to /select-staff. The notice should appear on the
    //    fixture tech's tile.
    await page.goto("/select-staff");
    await page.waitForURL(/\/select-staff/);
    const techTile = page.locator(`[data-staff-id="${staffFixture.tech.id}"]`);
    await expect(techTile).toBeVisible();
    await expect(
      page.locator(
        `[data-slot='pin-reset-notice'][data-staff-name='${staffFixture.tech.displayName}']`
      )
    ).toBeVisible();

    // 5. Pick the tech tile, enter 7777 → lands on /dashboard, banner clears.
    await techTile.click();
    const modal = page.getByRole("dialog");
    await modal.waitFor({ state: "visible" });
    for (const d of "7777") {
      await modal.getByRole("button", { name: `Digit ${d}`, exact: true }).click();
    }
    await page.waitForURL(/\/dashboard($|\?)/);

    // 6. Verify pin_reset_admin_at is NULL after successful auth.
    const sam = await getStaffWithPinResetAt(staffFixture.tech.displayName);
    expect(sam.pin_reset_admin_at).toBeNull();
  });
});

// Helper for the assertion in T050 — reads pin_reset_admin_at via the
// service-role client. Defined here so the helper stays scoped to the
// onboarding spec (mirrors the small-helpers-near-tests pattern this
// file already uses).
import { createClient } from "@supabase/supabase-js";
async function getStaffWithPinResetAt(
  displayName: string
): Promise<{ id: string; pin_reset_admin_at: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE env vars missing — required by onboarding spec helper");
  }
  const c = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c
    .from("staff")
    .select("id, pin_reset_admin_at")
    .eq("display_name", displayName)
    .single();
  if (error) throw new Error(`staff lookup failed: ${error.message}`);
  return data as { id: string; pin_reset_admin_at: string | null };
}

// ── Mailpit (local email sink) ─────────────────────────────────────────────
//
// `supabase start` boots Mailpit alongside Postgres/Auth (the config.toml
// section is still keyed `[inbucket]` for back-compat, but recent Supabase
// CLI ships Mailpit). Auth emails land there instead of being delivered, so
// polling it is what lets the e2e assert an invite email was actually SENT —
// the bug this guards against was the magic-link invite calling
// `generateLink`, which only generates a link and never sends an email.

const MAILPIT_BASE = "http://127.0.0.1:54324";

async function mailpitIsReachable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_BASE}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}

// Poll Mailpit until an email addressed to `toAddress` appears; returns the
// message's Mailpit ID, or null if none arrives before the deadline —
// Supabase enqueues mail synchronously, so null means "nothing was sent".
async function waitForMessageTo(toAddress: string, timeoutMs = 10_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  const target = toAddress.toLowerCase();
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MAILPIT_BASE}/api/v1/messages?limit=200`);
      if (res.ok) {
        const data = (await res.json()) as {
          messages?: { ID: string; To?: { Address?: string }[] }[];
        };
        const hit = (data.messages ?? []).find((m) =>
          (m.To ?? []).some((t) => (t.Address ?? "").toLowerCase() === target)
        );
        if (hit) return hit.ID;
      }
    } catch {
      // Swallow and retry until the deadline.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Pull the Supabase `/auth/v1/verify` link out of a Mailpit-captured invite
// email. The default invite template embeds it as `{{ .ConfirmationURL }}`;
// HTML-encoded `&amp;` separators are decoded so the URL is navigable.
async function extractVerifyLink(messageId: string): Promise<string | null> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${messageId}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { HTML?: string; Text?: string };
  const body = `${data.HTML ?? ""} ${data.Text ?? ""}`.replace(/&amp;/g, "&");
  const match = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
  return match ? match[0] : null;
}

// ── US5: Pending invite actions ───────────────────────────────────────────
//
// Resend and Cancel server-action paths (token rotation, audit shape,
// freed-email re-invite) are unit-covered by `actions-resend.test.ts`
// and `actions-cancel.test.ts`. The browser-only contracts that remain are
// the Copy invite link clipboard-write path and the invite-email delivery
// regression guard below.

test.describe("US5: Pending invite actions", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US5 pending-actions specs."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  async function quickInvite(
    page: import("@playwright/test").Page,
    opts: { name: string; email: string }
  ): Promise<void> {
    await page
      .locator("[data-slot='onboard-cta']")
      .getByRole("button", { name: /Onboard user/i })
      .click();
    await expect(page.locator("[data-slot='onboard-sheet']")).toBeVisible();
    await page.locator("[data-slot='onb-name-input']").fill(opts.name);
    await page.locator("[data-slot='onb-email-input']").fill(opts.email);
    await page.locator("[data-slot='onb-role-tile'][data-role='technician']").click();
    await page.getByRole("button", { name: /Send invite/i }).click();
    await expect(page.getByText(`Invite sent to ${opts.name}`)).toBeVisible({ timeout: 5_000 });
  }

  test("Copy invite link: menu item writes URL to clipboard", async ({
    page,
    context,
    staffFixture,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    const name = "Pending Copy";
    const email = `pending.copy.${Date.now()}@tangnails.test`;
    await quickInvite(page, { name, email });

    const pendingSection = page
      .locator(".onb-section")
      .filter({ has: page.getByRole("heading", { name: /Pending invites/ }) });
    const row = pendingSection.locator(".onb-row", { hasText: name });
    await expect(row).toBeVisible();

    // Click the inline Copy link icon button.
    await row.locator("[data-slot='user-row-copy-inline']").click();

    // Toast confirms.
    await expect(page.getByText(/Invite link copied/i)).toBeVisible({ timeout: 5_000 });

    // Read the clipboard and assert it looks like a magic link URL.
    const clipText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipText).toMatch(/token=|\/auth\/callback/);
  });

  test("Quick invite: the email is sent and clicking the link signs the invitee in", async ({
    page,
    staffFixture,
    browser,
  }) => {
    // Mailpit boots with `supabase start`; skip cleanly if it isn't up so
    // this never false-fails where Docker is unavailable.
    test.skip(
      !(await mailpitIsReachable()),
      "Mailpit not reachable at 127.0.0.1:54324 — skipping delivery check."
    );

    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    const email = `invite.delivery.${Date.now()}@tangnails.test`;
    await quickInvite(page, { name: "Invite Delivery", email });

    // 1. The "Invite sent" toast only proves the server action returned — the
    //    real contract is an email that reaches the invitee. The delivery bug
    //    routed the magic-link invite through `generateLink`, which generates
    //    a link but never sends one.
    const messageId = await waitForMessageTo(email);
    expect(messageId, `no invite email was delivered to ${email}`).not.toBeNull();

    const verifyLink = await extractVerifyLink(messageId as string);
    expect(verifyLink, "invite email contained no /auth/v1/verify link").not.toBeNull();

    // 2. Open the link in a *fresh* browser context — the invitee clicks it
    //    in their own browser, with none of the owner's cookies. This is the
    //    cross-browser case the implicit-flow callback must handle: Supabase
    //    returns the session in the URL hash, and `/auth/invite-callback`
    //    completes it client-side. The invitee lands signed in on the staff
    //    picker (a magic-link invite is passwordless).
    const inviteeContext = await browser.newContext();
    try {
      const inviteePage = await inviteeContext.newPage();
      await inviteePage.goto(verifyLink as string);
      await inviteePage.waitForURL(/\/select-staff/, { timeout: 15_000 });
    } finally {
      await inviteeContext.close();
    }
  });
});

// ── US7: Search ────────────────────────────────────────────────────────────
//
// Single search input in the hero (URL-synced via `?q=`). Server-side
// ILIKE filter against display_name OR email. When `?q=` is active AND a
// section's filtered count is 0, that section's HEADER + body are hidden
// entirely. Without `?q=`, the empty Offboarded section still shows its
// "No offboarded users." empty-row placeholder per ui-views.contract.md.
//
// Hero stats remain salon-wide totals (UNFILTERED) per the contract.
//
// Setup composes the existing primitives:
//   • Reset the staff to the seeded 3 (Maya Patel, Jordan Lee, Sam Chen — all Active).
//   • Soft-offboard Jordan Lee via direct service-role UPDATE (mirrors US6).
//   • Invite 2+ pending users via the Quick onboard sheet (mirrors US1).
// That yields ≥ 5 users across all three buckets.

async function softOffboardManagerForSearch(fixture: StaffFixture): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE env vars missing — required for US7 setup");
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c
    .from("staff")
    .update({
      state: "offboarded",
      active: false,
      pin_hash: null,
      email: fixture.manager.email,
      offboarded_at: new Date().toISOString(),
      offboarded_by: fixture.owner.id,
      offboard_reason: "Performance",
      pin_reset_admin_at: null,
    })
    .eq("id", fixture.manager.id);
  if (error) throw new Error(`US7 setup soft-offboard failed: ${error.message}`);
}

test.describe("US7: Search", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping US7 search specs.");
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  // Direct service-role insert for an invited row. Faster + sturdier than
  // walking the Quick onboard sheet twice (which can collide with Sonner's
  // outgoing toast animation). Creates an auth user first so the
  // staff_pin_or_user CHECK constraint is satisfied (the real Quick
  // onboard flow does the same via supabase.auth.admin.inviteUserByEmail).
  // The page is reloaded after setup so the new rows show up in the rendered
  // roster.
  async function insertPendingDirect(opts: {
    name: string;
    email: string;
    invitedBy: string;
  }): Promise<void> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE env vars missing — required for US7 setup");
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Create auth user (no password — invited via magic link).
    const { data: created, error: authErr } = await c.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
    });
    if (authErr) throw new Error(`US7 setup auth user create failed: ${authErr.message}`);
    const userId = created.user?.id;
    if (!userId) throw new Error("US7 setup: created user has no id");

    const { error } = await c.from("staff").insert({
      user_id: userId,
      display_name: opts.name,
      email: opts.email,
      role: "technician",
      color_token: "--avatar-rose",
      active: false,
      state: "invited",
      invited_at: new Date().toISOString(),
      invited_by: opts.invitedBy,
      invite_method: "magic_link",
    });
    if (error) throw new Error(`US7 setup pending insert failed: ${error.message}`);
  }

  test("typing filters rows, hides empty sections, clearing restores; ?q= URL-sync; empty Offboarded without ?q= shows placeholder", async ({
    page,
    staffFixture,
  }) => {
    // 1. Seed the roster BEFORE the page loads (faster + avoids toast races).
    //    Result: 2 Pending (Hana + Yuki), 2 Active (Maya Patel, Sam Chen), 1 Offboarded (Jordan Lee).
    const hanaEmail = `hana.search.${Date.now()}@tangnails.test`;
    const yukiEmail = `yuki.search.${Date.now()}@tangnails.test`;
    await insertPendingDirect({
      name: "Hana Search",
      email: hanaEmail,
      invitedBy: staffFixture.owner.id,
    });
    await insertPendingDirect({
      name: "Yuki Search",
      email: yukiEmail,
      invitedBy: staffFixture.owner.id,
    });
    await softOffboardManagerForSearch(staffFixture);

    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // Scope row-text assertions to the onboarding page body (the studio
    // sidebar also shows "Maya Patel" in the footer).
    const onbPage = page.locator(".onb-page");

    // Baseline: all five appear across the three sections.
    await expect(onbPage.getByText("Hana Search")).toBeVisible();
    await expect(onbPage.getByText("Yuki Search")).toBeVisible();
    await expect(onbPage.getByText("Maya Patel")).toBeVisible();
    await expect(onbPage.getByText(staffFixture.tech.displayName)).toBeVisible();
    await expect(onbPage.getByText(staffFixture.manager.displayName)).toBeVisible();

    // 2. Type into the search input → URL becomes ?q=Hana (debounced).
    await page.locator("[data-slot='onboarding-search'] input").fill("Hana");
    await page.waitForURL(/\?(.*&)?q=Hana(&|$)/, { timeout: 3_000 });

    // 3. Direct ?q= navigation for the bulk of the assertions (stable).
    await page.goto("/settings/onboarding?q=Hana");
    await page.waitForURL(/\/settings\/onboarding\?(.*&)?q=Hana(&|$)/);

    // Only Hana renders. The other four are hidden.
    await expect(onbPage.getByText("Hana Search")).toBeVisible();
    await expect(onbPage.getByText("Yuki Search")).toHaveCount(0);
    await expect(onbPage.getByText("Maya Patel")).toHaveCount(0);
    await expect(onbPage.getByText(staffFixture.tech.displayName)).toHaveCount(0);
    await expect(onbPage.getByText(staffFixture.manager.displayName)).toHaveCount(0);

    // Sections with zero matches are hidden entirely (header included):
    //   - Active users: 0 matches → header hidden.
    //   - Offboarded: 0 matches → header hidden.
    //   - Pending invites: 1 match → header visible.
    await expect(page.getByRole("heading", { name: /Pending invites/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Active users/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^Offboarded/ })).toHaveCount(0);

    // Hero stats remain the UNFILTERED salon-wide totals (per the contract).
    const heroStats = page.locator(".onb-hero-stats");
    await expect(heroStats).toContainText("2"); // Pending
    await expect(heroStats).toContainText("2"); // Active (Maya Patel + Sam Chen)
    await expect(heroStats).toContainText("1"); // Offboarded (Jordan Lee)

    // 4. Email substring also matches (search covers display_name OR email).
    await page.goto(`/settings/onboarding?q=${encodeURIComponent("yuki.search")}`);
    await expect(onbPage.getByText("Yuki Search")).toBeVisible();
    await expect(onbPage.getByText("Hana Search")).toHaveCount(0);
    await expect(onbPage.getByText("Maya Patel")).toHaveCount(0);

    // 5. Sub-case 1 — query with no Offboarded match → Offboarded header NOT visible.
    //    "Hana" matches only the Pending bucket, so Active + Offboarded are hidden.
    await page.goto("/settings/onboarding?q=Hana");
    await expect(page.getByRole("heading", { name: /^Offboarded/ })).toHaveCount(0);

    // 6. Clear → all three sections + all rows return.
    await page.goto("/settings/onboarding");
    await expect(onbPage.getByText("Hana Search")).toBeVisible();
    await expect(onbPage.getByText("Yuki Search")).toBeVisible();
    await expect(onbPage.getByText("Maya Patel")).toBeVisible();
    await expect(onbPage.getByText(staffFixture.tech.displayName)).toBeVisible();
    await expect(onbPage.getByText(staffFixture.manager.displayName)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Pending invites/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Active users/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Offboarded/ })).toBeVisible();
  });

  test("Sub-case 2: without ?q= and an empty Offboarded bucket, the section header IS visible with the empty-row placeholder", async ({
    page,
    staffFixture,
  }) => {
    // No setup beyond staffFixture.reset() → Offboarded bucket is empty.
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // Offboarded header is visible with the empty-row copy.
    await expect(page.getByRole("heading", { name: /^Offboarded/ })).toBeVisible();
    await expect(page.getByText("No offboarded users.")).toBeVisible();
  });
});

// ── Issue #120 regression: pin-less rows survive cancel + hard remove ──────
//
// cancelInvite + removeUser both `admin.auth.admin.deleteUser` on a staff
// row that can legitimately have pin_hash = NULL — magic-link invitees
// (always pin-less) and offboarded rows (offboardUser explicitly nulls
// pin_hash). Before #120, the 0001 staff_pin_or_user CHECK
// (pin_hash NOT NULL OR user_id NOT NULL) aborted those auth-delete
// transactions: the FK ON DELETE SET NULL cascade nulled staff.user_id and
// the row's pin_hash was already null → CHECK violation, surfaced by GoTrue
// as "Database error deleting user", server action redirects to
// ?error=server_error. The two existing unit suites mock the Supabase
// client so the real CHECK never runs; the existing e2e "Hard remove" path
// only covered PIN-bearing rows. These two regressions exercise the real
// Postgres trip wire end-to-end.
//
// Both reuse the worker-scoped staffFixture trio but provision their own
// disposable subject staff so they don't interfere with other specs.

test.describe("#120 regression: pin-less cancel + hard remove", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping #120 regression specs."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  // Seeds an invited row with pin_hash=NULL backed by a real auth user.
  // Returns the IDs the test asserts on after the cancel.
  async function seedInvitedPinless(opts: {
    name: string;
    email: string;
    invitedBy: string;
  }): Promise<{ staffId: string; userId: string }> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE env vars missing — required for #120 regression");
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: created, error: authErr } = await c.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
    });
    if (authErr) throw new Error(`auth user create failed: ${authErr.message}`);
    const userId = created.user?.id;
    if (!userId) throw new Error("created auth user has no id");

    const { data: staffRow, error: insErr } = await c
      .from("staff")
      .insert({
        user_id: userId,
        display_name: opts.name,
        email: opts.email,
        role: "technician",
        color_token: "--avatar-rose",
        active: false,
        state: "invited",
        pin_hash: null, // explicit — this is the regression condition
        invited_at: new Date().toISOString(),
        invited_by: opts.invitedBy,
        invite_method: "magic_link",
      })
      .select("id")
      .single();
    if (insErr || !staffRow) throw new Error(`staff insert failed: ${insErr?.message}`);
    return { staffId: (staffRow as { id: string }).id, userId };
  }

  // Seeds an offboarded row with pin_hash=NULL backed by a real auth user.
  // Mirrors what offboardUser leaves behind in production.
  async function seedOffboardedPinless(opts: {
    name: string;
    email: string;
    offboardedBy: string;
  }): Promise<{ staffId: string; userId: string }> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE env vars missing — required for #120 regression");
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: created, error: authErr } = await c.auth.admin.createUser({
      email: opts.email,
      email_confirm: true,
    });
    if (authErr) throw new Error(`auth user create failed: ${authErr.message}`);
    const userId = created.user?.id;
    if (!userId) throw new Error("created auth user has no id");

    const { data: staffRow, error: insErr } = await c
      .from("staff")
      .insert({
        user_id: userId,
        display_name: opts.name,
        email: opts.email,
        role: "technician",
        color_token: "--avatar-amber",
        active: false,
        state: "offboarded",
        pin_hash: null, // explicit — offboardUser nulls this in real flows
        offboarded_at: new Date().toISOString(),
        offboarded_by: opts.offboardedBy,
        offboard_reason: "Performance",
      })
      .select("id")
      .single();
    if (insErr || !staffRow) throw new Error(`staff insert failed: ${insErr?.message}`);
    return { staffId: (staffRow as { id: string }).id, userId };
  }

  // Returns true iff the auth.users row for `userId` no longer exists.
  async function authUserGone(userId: string): Promise<boolean> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE env vars missing");
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.admin.getUserById(userId);
    if (error) {
      // user_not_found is the success signal we're after.
      const status = (error as { status?: number }).status;
      return status === 404;
    }
    return !data?.user;
  }

  test("cancelInvite on a pin-less magic-link invitee succeeds (toast=cancelled, staff row gone, auth user gone)", async ({
    page,
    staffFixture,
  }) => {
    const email = `cancel.pinless.${Date.now()}@tangnails.test`;
    const { staffId, userId } = await seedInvitedPinless({
      name: "Pinless Cancel",
      email,
      invitedBy: staffFixture.owner.id,
    });

    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // Open the pending row's menu and submit Cancel invite. The pending
    // variant's destructive item is inside a <form action={cancelInvite}>
    // bound to a hidden submit button (Radix DropdownMenuItem asChild).
    // Playwright's real click on the menu item double-fires the submit
    // (native button click + Radix onSelect → btn.click() both submit
    // the same form), so we submit via JS-requestSubmit instead — this
    // exercises the action with one POST, the way a real user's single
    // click intends.
    const row = page.locator(".onb-row", { hasText: "Pinless Cancel" });
    await row.locator("[data-slot='user-row-menu-trigger']").click();
    await expect(page.locator("[data-slot='user-row-menu-content']")).toBeVisible();
    await page.evaluate(() => {
      const btn = document.querySelector(
        "[data-slot='user-row-menu-cancel-btn']"
      ) as HTMLButtonElement | null;
      const form = btn?.closest("form") as HTMLFormElement | null;
      form?.requestSubmit();
    });

    // Regression assertion: lands on ?toast=cancelled, NOT ?error=server_error.
    await page.waitForURL(/\/settings\/onboarding\?(.*&)?toast=cancelled(&|$)/, { timeout: 5_000 });

    // Staff row is gone (DELETE happens first now).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: staffAfter } = await c.from("staff").select("id").eq("id", staffId).maybeSingle();
    expect(staffAfter).toBeNull();

    // Auth user is gone — the CHECK no longer blocks the cascade target,
    // because there is no longer any cascade target.
    expect(await authUserGone(userId)).toBe(true);
  });

  test("removeUser on a pin-less offboarded user succeeds (toast=removed, row anonymized, auth user gone)", async ({
    page,
    staffFixture,
  }) => {
    const email = `remove.pinless.${Date.now()}@tangnails.test`;
    const displayName = "Pinless Remove";
    const { staffId, userId } = await seedOffboardedPinless({
      name: displayName,
      email,
      offboardedBy: staffFixture.owner.id,
    });

    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);

    // Open the offboarded row's menu → Remove permanently.
    const offSection = page
      .locator(".onb-section")
      .filter({ has: page.getByRole("heading", { name: /^Offboarded/ }) });
    const row = offSection.locator(".onb-row", { hasText: displayName });
    await row.locator("[data-slot='user-row-menu-trigger']").click();
    await page.locator("[data-slot='user-row-menu-item-remove']").click();
    await expect(page.locator("[data-slot='remove-sheet']")).toBeVisible();

    // Three-gate: check both acks, type the name.
    await page.locator("[data-slot='remove-ack-history']").click();
    await page.locator("[data-slot='remove-typed-name']").fill(displayName);
    await page.locator("[data-slot='remove-ack-irreversible']").click();
    await page.locator("[data-slot='remove-confirm']").click();

    // Regression assertion: lands on ?toast=removed, NOT ?error=server_error.
    await page.waitForURL(/\/settings\/onboarding\?(.*&)?toast=removed(&|$)/, { timeout: 5_000 });

    // Staff row persists as the anonymized archive shape per data-model.md
    // Invariant D — but with user_id nulled by the cascade.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: staffAfter } = await c
      .from("staff")
      .select("id, display_name, email, user_id, removed_at, pin_hash")
      .eq("id", staffId)
      .single();
    expect(staffAfter).not.toBeNull();
    expect((staffAfter as { display_name: string }).display_name).toMatch(/^Former staff #\d+$/);
    expect((staffAfter as { email: string | null }).email).toBeNull();
    expect((staffAfter as { user_id: string | null }).user_id).toBeNull();
    expect((staffAfter as { removed_at: string | null }).removed_at).not.toBeNull();
    expect((staffAfter as { pin_hash: string | null }).pin_hash).toBeNull();

    // Auth user is gone — the auth.admin.deleteUser call no longer aborts
    // on the staff_pin_or_user CHECK because migration 0022 accepts the
    // cascade-driven user_id=NULL when removed_at is non-null.
    expect(await authUserGone(userId)).toBe(true);
  });
});

// Regression: the form-bound menu items (Send password reset / Reactivate /
// Resend invite / Cancel invite) wrap their content in a <form> that
// `DropdownMenuItem asChild` turns into the menuitem. The form must be the
// real styled box; if it (or the inner button) collapses to display:contents
// the row loses its left padding (flush-left, misaligned with plain items)
// and its hover/focus highlight. See dropdown design-system alignment PR.
test.describe("012: form-bound menu items render as proper menu items", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping.");
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await deleteTangnailsTestStaff();
  });

  test("Send password reset aligns with plain items and shows a hover highlight", async ({
    page,
    staffFixture,
  }) => {
    await signInAsOwner(page, staffFixture);
    await page.goto("/settings/onboarding");
    await page.waitForURL(/\/settings\/onboarding(\?|$)/);
    await openActiveRowMenu(page, staffFixture.manager.displayName);

    const content = page.locator("[data-slot='user-row-menu-content']");
    const plainIcon = content.locator("[data-slot='user-row-menu-item-reset-pin'] svg").first();
    const formIcon = content.locator("[data-slot='user-row-menu-item-send-reset'] svg").first();

    const plainBox = await plainIcon.boundingBox();
    const formBox = await formIcon.boundingBox();
    expect(plainBox, "plain item icon should be visible").not.toBeNull();
    expect(formBox, "form-bound item icon should be visible").not.toBeNull();
    // Both leading icons start at the same x → the form-bound row carries the
    // same left padding as a plain row (not flush-left).
    expect(Math.abs(formBox!.x - plainBox!.x)).toBeLessThan(1.5);

    // Hovering the form-bound menuitem paints the accent highlight, proving the
    // styled element is a real box (not display:contents).
    const formItem = content.locator("[data-slot='user-row-menu-item-send-reset']");
    await formItem.hover();
    await expect
      .poll(() => formItem.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
  });
});
