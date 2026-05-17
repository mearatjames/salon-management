// E2E for feature 020-past-cash-counts.
//
// User Story 1 (this file): a manager/owner can browse the closed
// cash-drawer history list, sees variance color rules per FR-002, can
// tap a row to open the detail page, and can reach the list via a link
// on `/end-of-day`. A technician hitting `/end-of-day/history` is
// silently redirected to `/dashboard`.
//
// US2 and US3 are added by their respective phase tasks (T024, T028).
//
// Same Supabase-reachability probe as the rest of the suite — skip when
// the local Supabase is unreachable. This spec is shipped during US1
// implementation but will not be runnable in sandbox envs without local
// Supabase; CI will pick it up.

import { expect, test } from "@playwright/test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Deterministic seed UUIDs scoped to this spec (parallel-safe — distinct
// from the `40000000-…` block in `supabase/seed.sql`).
const SEED_SESSIONS = {
  clean: "41000000-0000-0000-0000-000000000001",
  over: "41000000-0000-0000-0000-000000000002",
  short: "41000000-0000-0000-0000-000000000003",
} as const;

const OWNER_STAFF_ID = "10000000-0000-0000-0000-000000000001";
const MANAGER_STAFF_ID = "10000000-0000-0000-0000-000000000002";

async function wipeSpecSessions(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("cash_drawer_sessions")
    .delete()
    .in("id", [SEED_SESSIONS.clean, SEED_SESSIONS.over, SEED_SESSIONS.short]);
}

// Insert three closed sessions on three distinct historic business days.
// One clean ($0 variance), one over (+$3.50), one short (−$2.00).
async function seedThreeClosedSessions(): Promise<void> {
  const admin = adminClient();

  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(`${todayLocal}T12:00:00Z`);

  function daysAgo(n: number): string {
    const d = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
  function tsAt(day: string, hour: number): string {
    return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();
  }

  const rows = [
    {
      id: SEED_SESSIONS.clean,
      business_day: daysAgo(7),
      opening_cents: 10000,
      expected_cents: 12500,
      counted_cents: 22500,
      variance_cents: 0,
      notes: null,
      opened_by_staff_id: OWNER_STAFF_ID,
      closed_by_staff_id: OWNER_STAFF_ID,
      opened_at: tsAt(daysAgo(7), 9),
      closed_at: tsAt(daysAgo(7), 19),
    },
    {
      id: SEED_SESSIONS.over,
      business_day: daysAgo(3),
      opening_cents: 10000,
      expected_cents: 15000,
      counted_cents: 25350,
      variance_cents: 350,
      notes: "Customer tipped extra in cash.",
      opened_by_staff_id: MANAGER_STAFF_ID,
      closed_by_staff_id: MANAGER_STAFF_ID,
      opened_at: tsAt(daysAgo(3), 9),
      closed_at: tsAt(daysAgo(3), 19),
    },
    {
      id: SEED_SESSIONS.short,
      business_day: daysAgo(1),
      opening_cents: 10000,
      expected_cents: 11000,
      counted_cents: 20800,
      variance_cents: -200,
      notes: "Drawer was off at open.",
      opened_by_staff_id: OWNER_STAFF_ID,
      closed_by_staff_id: OWNER_STAFF_ID,
      opened_at: tsAt(daysAgo(1), 9),
      closed_at: tsAt(daysAgo(1), 19),
    },
  ];

  const { error } = await admin.from("cash_drawer_sessions").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`seedThreeClosedSessions failed: ${error.message}`);
}

async function signInAsStaff(
  page: import("@playwright/test").Page,
  who: "maya" | "jordan",
  next = "/end-of-day/history"
): Promise<void> {
  const encodedNext = encodeURIComponent(next);
  await page.goto(`/login?next=${encodedNext}`);
  const email = who === "maya" ? "owner@tangnails.dev" : "manager@tangnails.dev";
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  const tile = who === "maya" ? /Maya Patel/ : /Jordan Lee/;
  await page.getByRole("button", { name: tile }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
}

// Technician needs PIN 9999 (per seed). Use a dedicated helper rather
// than branching the generic one.
async function signInAsSam(
  page: import("@playwright/test").Page,
  next = "/end-of-day/history"
): Promise<void> {
  const encodedNext = encodeURIComponent(next);
  await page.goto(`/login?next=${encodedNext}`);
  // Sam has no auth user — but the e2e seed gives every device session a
  // shared owner login. We sign in with owner's email then pick Sam's
  // tile on the operator step. PIN is 9999.
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Sam Chen/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 9" }).click();
  await page.getByRole("button", { name: "Digit 9" }).click();
  await page.getByRole("button", { name: "Digit 9" }).click();
  await page.getByRole("button", { name: "Digit 9" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("US1: review past cash counts", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 past-cash-counts specs."
      );
    }
    await wipeSpecSessions();
    await seedThreeClosedSessions();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await wipeSpecSessions();
  });

  test("list shows three rows newest-first with correct variance colors", async ({ page }) => {
    await signInAsStaff(page, "maya", "/end-of-day/history");
    await page.waitForURL(/\/end-of-day\/history(\?|$)/);

    const rows = page.locator("[data-slot='eod-history-row']");
    // At minimum the three we seeded — other sessions may exist; we
    // filter by our deterministic ids.
    const cleanRow = page.locator(
      `[data-slot='eod-history-row'][data-session-id='${SEED_SESSIONS.clean}']`
    );
    const overRow = page.locator(
      `[data-slot='eod-history-row'][data-session-id='${SEED_SESSIONS.over}']`
    );
    const shortRow = page.locator(
      `[data-slot='eod-history-row'][data-session-id='${SEED_SESSIONS.short}']`
    );

    await expect(cleanRow).toBeVisible();
    await expect(overRow).toBeVisible();
    await expect(shortRow).toBeVisible();

    // Variance state attributes per FR-002.
    await expect(cleanRow.locator("[data-slot='eod-history-variance']")).toHaveAttribute(
      "data-state",
      "zero"
    );
    await expect(overRow.locator("[data-slot='eod-history-variance']")).toHaveAttribute(
      "data-state",
      "over"
    );
    await expect(shortRow.locator("[data-slot='eod-history-variance']")).toHaveAttribute(
      "data-state",
      "short"
    );

    // business_day desc order: short (1d ago) → over (3d ago) → clean (7d ago).
    const orderedIds = await rows.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.sessionId)
    );
    const idxShort = orderedIds.indexOf(SEED_SESSIONS.short);
    const idxOver = orderedIds.indexOf(SEED_SESSIONS.over);
    const idxClean = orderedIds.indexOf(SEED_SESSIONS.clean);
    expect(idxShort).toBeGreaterThanOrEqual(0);
    expect(idxOver).toBeGreaterThan(idxShort);
    expect(idxClean).toBeGreaterThan(idxOver);
  });

  test("tapping a row opens the detail page with the right amounts + note", async ({ page }) => {
    await signInAsStaff(page, "maya", "/end-of-day/history");
    await page.waitForURL(/\/end-of-day\/history(\?|$)/);

    await page
      .locator(`[data-slot='eod-history-row'][data-session-id='${SEED_SESSIONS.short}']`)
      .click();
    await page.waitForURL(new RegExp(`/end-of-day/history/${SEED_SESSIONS.short}`));

    await expect(page.locator("[data-slot='eod-history-breakdown']")).toHaveAttribute(
      "data-state",
      "short"
    );
    await expect(page.locator("[data-slot='eod-history-diff']")).toContainText("−$2.00");
    await expect(page.locator("[data-slot='eod-history-note']")).toContainText(
      "Drawer was off at open."
    );
  });

  test("a session with no note shows the 'No note recorded' placeholder", async ({ page }) => {
    await signInAsStaff(page, "maya", `/end-of-day/history/${SEED_SESSIONS.clean}`);
    await page.waitForURL(new RegExp(`/end-of-day/history/${SEED_SESSIONS.clean}`));

    await expect(page.locator("[data-slot='eod-history-breakdown']")).toHaveAttribute(
      "data-state",
      "match"
    );
    await expect(page.locator("[data-slot='eod-history-diff']")).toContainText("Exact match");
    await expect(page.locator("[data-slot='eod-history-note-empty']")).toContainText(
      "No note recorded"
    );
  });

  test("technician hitting /end-of-day/history is redirected to /dashboard", async ({ page }) => {
    await signInAsSam(page, "/end-of-day/history");
    // Role gate kicks in on the page; ensure the URL ends on /dashboard.
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/dashboard(\?|$)/);
  });

  test("'View past counts' link on /end-of-day navigates to the list", async ({ page }) => {
    await signInAsStaff(page, "maya", "/end-of-day");
    await page.waitForURL(/\/end-of-day(\?|$)/);

    const link = page.locator("[data-slot='eod-history-link']");
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/end-of-day\/history(\?|$)/);
  });
});
