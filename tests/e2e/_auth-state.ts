// Worker-scoped storageState provisioning for Tang Nails E2E tests.
//
// Background — issue #42: every spec previously ran the full sign-in
// ceremony (/login → email+password → /select-staff → tile click → 4
// PIN digits → wait for nav) before its first assertion. At ~12–15s
// per test × 289 tests, that ceremony dominated suite wall time.
//
// This helper performs the sign-in ONCE per worker per role, captures
// the resulting cookies + localStorage via `context.storageState()`,
// and writes the snapshot to `playwright/.auth/worker-<N>-<role>.json`.
// Specs then declare `test.use({ storageState: ({ authState }, use) =>
// use(authState.owner) })` and land already signed-in on first
// `page.goto(...)` — no `/login` round-trip per test.
//
// What gets persisted:
//   • Supabase device session cookies (`sb-*-auth-token`) — set by
//     `/login` server action after `signInWithPassword`.
//   • `acting_as_staff_id` cookie — signed JWT set by `submitPin` after
//     a valid PIN, 12-hour TTL. This is what the studio routes read to
//     identify the operator.
//
// Both are HTTP cookies (not localStorage), so the snapshot is small
// and stable across runs. The file is regenerated every worker startup,
// so cookie expiry isn't a concern in practice.

import fs from "node:fs";
import path from "node:path";

import { type Browser } from "@playwright/test";

import { type StaffFixture, type StaffFixtureMember } from "./_fixtures";

export type AuthStatePaths = {
  owner: string;
  manager: string;
  tech: string;
};

// Matches `playwright.config.ts` § `use.baseURL`. Hardcoded because
// worker-scoped fixtures can't read test-scoped `baseURL` directly.
const BASE_URL = "http://localhost:3000";

const AUTH_DIR = path.join(process.cwd(), "playwright", ".auth");

function authStatePath(workerIndex: number, role: keyof AuthStatePaths): string {
  return path.join(AUTH_DIR, `worker-${workerIndex}-${role}.json`);
}

/**
 * Provision storageState snapshots for all three roles in this worker's
 * staff trio. Returns the absolute paths to the JSON files; specs feed
 * these into the built-in `storageState` option via a `test.use(...)`
 * override.
 *
 * Idempotent within a single test run — files are regenerated every
 * call so a worker that restarts (e.g. after a fixture crash) gets
 * fresh cookies. We don't try to cache across runs; sign-in is cheap
 * (~3 seconds total for all three roles).
 */
export async function provisionAuthState(
  browser: Browser,
  fixture: StaffFixture
): Promise<AuthStatePaths> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const paths: AuthStatePaths = {
    owner: authStatePath(fixture.workerIndex, "owner"),
    manager: authStatePath(fixture.workerIndex, "manager"),
    tech: authStatePath(fixture.workerIndex, "tech"),
  };

  // Sign-in is serialized per worker (one context at a time). All three
  // roles share the same device user (`fixture.owner.email`); the
  // distinguishing step is which tile gets clicked at /select-staff.
  await signInOnce(browser, fixture.owner, fixture.owner, paths.owner);
  await signInOnce(browser, fixture.owner, fixture.manager, paths.manager);
  await signInOnce(browser, fixture.owner, fixture.tech, paths.tech);

  return paths;
}

async function signInOnce(
  browser: Browser,
  deviceOwner: StaffFixtureMember,
  asMember: StaffFixtureMember,
  outPath: string
): Promise<void> {
  if (!deviceOwner.email || !deviceOwner.password) {
    throw new Error("_auth-state: device owner missing email/password");
  }

  const ctx = await browser.newContext({ baseURL: BASE_URL });
  try {
    const page = await ctx.newPage();
    await page.goto("/login?next=/dashboard");
    await page.locator("#signin-email").fill(deviceOwner.email);
    await page.locator("#signin-password").fill(deviceOwner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/select-staff\?next=/);
    // [data-staff-id] is the stable identity set by
    // `components/lacquer/staff-tile.tsx` — name-based selectors would
    // need a regex around the role-label suffix.
    await page.locator(`[data-staff-id="${asMember.id}"]`).click();
    await page.waitForURL(/selectedTileId=/);
    for (const digit of asMember.pin) {
      await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
    }
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });
    await ctx.storageState({ path: outPath });
  } finally {
    await ctx.close();
  }
}
