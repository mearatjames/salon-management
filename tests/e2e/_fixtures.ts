// Playwright worker-scoped fixtures for Tang Nails E2E tests.
//
// Background — issue #33: the existing pattern is `resetStaffToSeed()` in
// every beforeEach, which restores the three seeded staff (Maya / Jordan /
// Sam) to a canonical state. That pattern forces `workers: 1` in
// `playwright.config.ts` because two workers running tests that mutate
// staff state would race on the shared seed rows.
//
// This file introduces a worker-scoped fixture that provisions its OWN
// isolated staff trio per worker — distinct UUIDs, distinct display names
// (suffixed with `[wN]`), distinct auth.users rows. Each worker's tests
// only ever touch their worker's trio. Two workers can therefore run
// staff-mutating specs in parallel without colliding.
//
// IMPORTANT: this PR ships the fixture infrastructure ONLY. No existing
// spec is migrated and `playwright.config.ts` still pins `workers: 1`.
// The migration of the 8 Category A specs (staff, onboarding, auth,
// staff-payout-exemptions, staff-add-wizard, staff-mobile,
// staff-panel-structure, staff-roster-chrome) plus the workers-flip is
// a follow-up PR.
//
// Naming choice — distinctive names ("Test Owner [w0]"), NOT a Maya/Jordan/
// Sam suffix. The 29 Category B specs use selectors like
// `getByRole("button", { name: /Maya Patel/ })` and a "Maya Patel [w0]"
// suffix would multi-match under Playwright's strict mode. Distinct names
// keep Category B unmodified — they continue to click the seeded Maya tile
// while Category A clicks the fixture's tile.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test as base, expect, type Page } from "@playwright/test";

// --------------------------------------------------------------------------
// Service-role client. Same pattern as `_db.ts`'s internal client(): cached
// per worker so we don't open a new connection per fixture call.
// --------------------------------------------------------------------------
let cached: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "tests/e2e/_fixtures.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (typically in .env.local)"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// --------------------------------------------------------------------------
// PIN hashes — precomputed bcryptjs.hashSync(pin, 11). Identical to the
// hashes in `supabase/seed.sql` so the fixture's "1234"/"5678"/"9999" PINs
// match the values the rest of the suite already knows. Reusing across
// workers is safe because each worker has its own staff rows; the hash
// alone reveals nothing.
// --------------------------------------------------------------------------
const PIN_HASHES: Record<string, string> = {
  "1234": "$2b$11$ocPxZYLxI9q3whaThAf44eqadcklBHovq4KGJcGQ2VjlZkoGD66x.",
  "5678": "$2b$11$ixukE2AGjrZs3diU3DJbk.ee1XcDBdkg.GlRUABhzcHX.20ELBPiq",
  "9999": "$2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W",
};

// Shared password for fixture auth.users — matches the seeded operators
// (`tang-nails-dev`). The /login form uses email + password to start a
// device session before /select-staff offers the PIN keypad.
const FIXTURE_PASSWORD = "tang-nails-dev";

// --------------------------------------------------------------------------
// UUID scheme — every fixture-owned id is `f0000000-...`. The 4th block
// encodes the worker index (hex, 4 digits) so a single `LIKE` predicate
// can scope teardown to the worker:
//
//   staff:         f0000000-0000-0000-<wHex>-00000000000<role>
//   auth.users:    f0000000-1111-0000-<wHex>-00000000000<role>
//
// `role`: 1=owner, 2=manager, 3=technician. Tech has user_id=null (mirrors
// the seeded Sam pattern), so the auth.users layout only covers owner/
// manager.
// --------------------------------------------------------------------------
function workerHex(workerIndex: number): string {
  return workerIndex.toString(16).padStart(4, "0");
}
function staffId(workerIndex: number, role: 1 | 2 | 3): string {
  return `f0000000-0000-0000-${workerHex(workerIndex)}-00000000000${role}`;
}
function authUserId(workerIndex: number, role: 1 | 2): string {
  return `f0000000-1111-0000-${workerHex(workerIndex)}-00000000000${role}`;
}

// --------------------------------------------------------------------------
// Public types — what specs receive when they declare `staffFixture` in
// their test arguments.
// --------------------------------------------------------------------------
export type StaffFixtureMember = {
  id: string;
  displayName: string;
  role: "owner" | "manager" | "technician";
  pin: string;
  userId: string | null;
  email: string | null;
  password: string | null;
};

export type StaffFixture = {
  workerIndex: number;
  owner: StaffFixtureMember;
  manager: StaffFixtureMember;
  tech: StaffFixtureMember;
  /**
   * Re-apply canonical state to this worker's trio (active, no offboard,
   * default lifecycle and payout columns). Equivalent of
   * `resetStaffToSeed()` but scoped to this worker only.
   */
  reset(): Promise<void>;
  /**
   * Delete any rows in this worker's namespace that aren't part of the
   * canonical trio — for specs that create extra staff (e.g. the Add
   * Wizard scenario) and want a clean baseline next test.
   */
  deleteExtras(): Promise<void>;
};

// --------------------------------------------------------------------------
// Fixture provisioning
// --------------------------------------------------------------------------
function buildMembers(workerIndex: number): {
  owner: StaffFixtureMember;
  manager: StaffFixtureMember;
  tech: StaffFixtureMember;
} {
  const w = workerIndex;
  return {
    owner: {
      id: staffId(w, 1),
      displayName: `Test Owner [w${w}]`,
      role: "owner",
      pin: "1234",
      userId: authUserId(w, 1),
      email: `owner-w${w}@e2e.test`,
      password: FIXTURE_PASSWORD,
    },
    manager: {
      id: staffId(w, 2),
      displayName: `Test Manager [w${w}]`,
      role: "manager",
      pin: "5678",
      userId: authUserId(w, 2),
      email: `manager-w${w}@e2e.test`,
      password: FIXTURE_PASSWORD,
    },
    tech: {
      id: staffId(w, 3),
      displayName: `Test Tech [w${w}]`,
      role: "technician",
      pin: "9999",
      userId: null,
      email: null,
      password: null,
    },
  };
}

async function ensureAuthUsers(members: ReadonlyArray<StaffFixtureMember>): Promise<void> {
  const c = client();
  for (const m of members) {
    if (!m.userId || !m.email || !m.password) continue;
    const existing = await c.auth.admin.getUserById(m.userId);
    if (existing.data.user) continue;
    const { error } = await c.auth.admin.createUser({
      // The admin API accepts a custom id so the row aligns with our
      // deterministic UUID scheme.
      id: m.userId,
      email: m.email,
      password: m.password,
      email_confirm: true,
    } as Parameters<typeof c.auth.admin.createUser>[0]);
    if (error && !/already (registered|exists)/i.test(error.message)) {
      throw new Error(`fixture auth user create failed for ${m.email}: ${error.message}`);
    }
  }
}

async function upsertStaffTrio(members: ReadonlyArray<StaffFixtureMember>): Promise<void> {
  const c = client();
  const rows = members.map((m) => ({
    id: m.id,
    user_id: m.userId,
    display_name: m.displayName,
    role: m.role,
    pin_hash: PIN_HASHES[m.pin],
    color_token:
      m.role === "owner"
        ? "--avatar-rose"
        : m.role === "manager"
          ? "--avatar-amber"
          : "--avatar-purple",
    active: true,
    removed_at: null,
    state: "active" as const,
    email: m.email,
    invited_at: null,
    invited_by: null,
    invite_method: null,
    offboarded_at: null,
    offboarded_by: null,
    offboard_reason: null,
    last_sign_in_at: null,
    pin_reset_admin_at: null,
    card_fee_exempt: false,
    supply_mode: "apply" as const,
    supply_except: [] as string[],
  }));
  const { error } = await c.from("staff").upsert(rows, { onConflict: "id" });
  if (error) {
    throw new Error(`fixture staff upsert failed (w${members[0].id}): ${error.message}`);
  }
}

// Worker namespace is encoded in BOTH the UUID 4th block AND the
// `[wN]` suffix on `display_name`. We filter on display_name because
// PostgREST's `like`/`ilike` operators only accept text columns; trying
// `like("id", "f0000000-...%")` against the UUID-typed `id` column errors
// with "operator does not exist: uuid ~~ unknown".
function workerDisplayNamePattern(workerIndex: number): string {
  // Matches any display_name ending in `[wN]` for this worker, e.g.
  // "Test Owner [w0]", "Test Manager [w0]", or any extra rows a spec
  // created with the same suffix convention.
  return `% [w${workerIndex}]%`;
}

async function deleteExtras(workerIndex: number, trioIds: ReadonlyArray<string>): Promise<void> {
  const c = client();
  const inList = trioIds.map((id) => `"${id}"`).join(",");
  const { error } = await c
    .from("staff")
    .delete()
    .like("display_name", workerDisplayNamePattern(workerIndex))
    .not("id", "in", `(${inList})`);
  if (error) {
    throw new Error(`fixture extras cleanup failed (w${workerIndex}): ${error.message}`);
  }
}

async function teardownWorker(workerIndex: number, trioIds: ReadonlyArray<string>): Promise<void> {
  const c = client();
  // Delete the trio by id (small, deterministic) plus any extras still
  // matching the worker's display_name suffix.
  const { error: extrasErr } = await c
    .from("staff")
    .delete()
    .like("display_name", workerDisplayNamePattern(workerIndex));
  if (extrasErr) {
    throw new Error(
      `fixture staff teardown (extras) failed (w${workerIndex}): ${extrasErr.message}`
    );
  }
  const { error: trioErr } = await c.from("staff").delete().in("id", trioIds);
  if (trioErr) {
    throw new Error(`fixture staff teardown (trio) failed (w${workerIndex}): ${trioErr.message}`);
  }
  // Tear down auth.users by id. The admin API doesn't take a filter, so
  // we delete the two known role ids — "not found" is fine (already gone).
  for (const role of [1, 2] as const) {
    const id = authUserId(workerIndex, role);
    const { error } = await c.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(
        `fixture auth user teardown failed (w${workerIndex}, role ${role}): ${error.message}`
      );
    }
  }
}

// --------------------------------------------------------------------------
// Playwright fixture export — worker-scoped so provisioning happens once
// per worker, not per test. Spec files import `test` from this module
// instead of `@playwright/test` to opt into the fixture.
// --------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}, { staffFixture: StaffFixture }>({
  staffFixture: [
    async ({}, use, workerInfo) => {
      const members = buildMembers(workerInfo.workerIndex);
      const memberArray = [members.owner, members.manager, members.tech];
      await ensureAuthUsers(memberArray);
      await upsertStaffTrio(memberArray);
      const trioIds = memberArray.map((m) => m.id);

      const fixture: StaffFixture = {
        workerIndex: workerInfo.workerIndex,
        ...members,
        reset: () => upsertStaffTrio(memberArray),
        deleteExtras: () => deleteExtras(workerInfo.workerIndex, trioIds),
      };
      await use(fixture);
      await teardownWorker(workerInfo.workerIndex, trioIds);
    },
    { scope: "worker" },
  ],
});

export { expect };

// --------------------------------------------------------------------------
// Sign-in helper — replaces the per-spec `signInAsMaya` duplicates. Uses
// the fixture's owner email+password to start the device session, then
// picks `member`'s tile and enters their PIN.
//
// Pattern mirrors `tests/e2e/past-cash-counts.spec.ts § signInAsSam` —
// the device login is always via the owner credentials, then any member
// of the trio can be selected via the staff tile + PIN.
// --------------------------------------------------------------------------
export async function signInAs(
  page: Page,
  fixture: StaffFixture,
  member: StaffFixtureMember,
  opts: { nextPath?: string } = {}
): Promise<void> {
  const nextPath = opts.nextPath ?? "/dashboard";
  if (!fixture.owner.email || !fixture.owner.password) {
    throw new Error("signInAs: fixture.owner is missing email/password");
  }
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.locator("#signin-email").fill(fixture.owner.email);
  await page.locator("#signin-password").fill(fixture.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  // Use `[data-staff-id]` (set by `components/lacquer/staff-tile.tsx`)
  // for an unambiguous selector. The tile's computed accessible name
  // includes the role label (e.g. "Test Owner [w0] OWNER"), so a
  // name-based selector would need a regex; the data attribute is the
  // tile's stable identity regardless of display chrome.
  await page.locator(`[data-staff-id="${member.id}"]`).click();
  await page.waitForURL(/selectedTileId=/);
  for (const digit of member.pin) {
    await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  }
  await page.waitForURL(new RegExp(nextPath.replace(/\//g, "\\/") + "(\\?|$)"), {
    timeout: 10_000,
  });
}
