// Smoke test for the worker-scoped staff fixture (issue #33, PR 1).
//
// Verifies in isolation that:
//   1. The fixture provisions a 3-staff trio + 2 auth.users on first use.
//   2. The seeded staff (Maya/Jordan/Sam) are still present alongside the
//      fixture's staff — distinctive names mean no selector collision.
//   3. `signInAs(fixture.owner)` completes the login → /select-staff →
//      PIN flow and lands on /dashboard.
//   4. `fixture.reset()` returns mutated trio rows to canonical state.
//   5. `fixture.deleteExtras()` cleans up rows that share the worker's
//      namespace prefix but are not in the trio.
//
// This spec is a foundation gate for the migration PR that follows. It
// runs serially (single worker) so the smoke assertions are deterministic
// without depending on whether other specs land in another worker. The
// fixture itself is built to support workers > 1 — that's exercised once
// PR 2 lands.

import { createClient } from "@supabase/supabase-js";

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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("smoke spec: missing supabase env vars");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.describe.configure({ mode: "serial" });

test.describe("Worker-scoped staff fixture (smoke)", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping fixture smoke specs."
      );
    }
  });

  test("(a) fixture provisions staff trio + auth.users on first use", async ({ staffFixture }) => {
    const db = adminClient();

    const { data: rows, error } = await db
      .from("staff")
      .select("id, display_name, role, state, active, email, user_id")
      .in("id", [staffFixture.owner.id, staffFixture.manager.id, staffFixture.tech.id]);
    expect(error).toBeNull();
    expect(rows).toHaveLength(3);

    const owner = rows!.find((r) => r.id === staffFixture.owner.id)!;
    expect(owner.display_name).toBe(staffFixture.owner.displayName);
    expect(owner.role).toBe("owner");
    expect(owner.state).toBe("active");
    expect(owner.active).toBe(true);
    expect(owner.email).toBe(staffFixture.owner.email);
    expect(owner.user_id).toBe(staffFixture.owner.userId);

    const tech = rows!.find((r) => r.id === staffFixture.tech.id)!;
    expect(tech.user_id).toBeNull();
    expect(tech.email).toBeNull();

    const { data: ownerAuth } = await db.auth.admin.getUserById(staffFixture.owner.userId!);
    expect(ownerAuth.user?.email).toBe(staffFixture.owner.email);
  });

  test("(b) seeded staff remain — distinctive names mean no collision", async ({}) => {
    const db = adminClient();
    const { data, error } = await db
      .from("staff")
      .select("id, display_name")
      .in("id", [
        "10000000-0000-0000-0000-000000000001",
        "10000000-0000-0000-0000-000000000002",
        "10000000-0000-0000-0000-000000000003",
      ]);
    expect(error).toBeNull();
    expect(data).toHaveLength(3);

    const names = (data ?? []).map((r) => r.display_name).sort();
    expect(names).toEqual(["Jordan Lee", "Maya Patel", "Sam Chen"]);
  });

  test("(c) signInAs(fixture.owner) completes login → /dashboard", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/dashboard" });
    // Operator chip in the topbar reflects the worker fixture owner, not
    // the seeded Maya — distinguishes them visually.
    await expect(page.locator("[data-slot='operator-chip']")).toContainText(
      staffFixture.owner.displayName
    );
  });

  test("(d) fixture.reset() restores canonical state after mutation", async ({ staffFixture }) => {
    const db = adminClient();

    // Mutate the owner row: rename + flip to offboarded state.
    const { error: mutErr } = await db
      .from("staff")
      .update({
        display_name: "Mutated Name",
        state: "offboarded",
        offboarded_at: new Date().toISOString(),
        offboarded_by: staffFixture.owner.id,
        offboard_reason: "smoke-test",
      })
      .eq("id", staffFixture.owner.id);
    expect(mutErr).toBeNull();

    await staffFixture.reset();

    const { data: row } = await db
      .from("staff")
      .select("display_name, state, offboarded_at, offboard_reason")
      .eq("id", staffFixture.owner.id)
      .single();
    expect(row?.display_name).toBe(staffFixture.owner.displayName);
    expect(row?.state).toBe("active");
    expect(row?.offboarded_at).toBeNull();
    expect(row?.offboard_reason).toBeNull();
  });

  test("(e) fixture.deleteExtras() cleans namespace, preserves trio + seeded", async ({
    staffFixture,
  }) => {
    const db = adminClient();
    const w = staffFixture.workerIndex.toString(16).padStart(4, "0");

    // Insert an extra row inside the worker's namespace (id starts with
    // f0000000-0000-0000-<wHex>- but not in the trio).
    const extraId = `f0000000-0000-0000-${w}-000000000099`;
    const { error: insErr } = await db.from("staff").insert({
      id: extraId,
      user_id: null,
      display_name: `Test Extra [w${staffFixture.workerIndex}]`,
      role: "technician",
      pin_hash: "$2b$11$sWcIO2ja2W3yapUKh2haPeCOiYOHEPBui0AibaP8F6oHWLpxfPv9W",
      color_token: "--avatar-purple",
      active: true,
      state: "active",
      card_fee_exempt: false,
      supply_mode: "apply",
      supply_except: [],
    });
    expect(insErr).toBeNull();

    await staffFixture.deleteExtras();

    // Extra row gone.
    const { data: extraCheck } = await db.from("staff").select("id").eq("id", extraId);
    expect(extraCheck ?? []).toHaveLength(0);

    // Trio still present.
    const { data: trio } = await db
      .from("staff")
      .select("id")
      .in("id", [staffFixture.owner.id, staffFixture.manager.id, staffFixture.tech.id]);
    expect(trio).toHaveLength(3);

    // Seeded staff still present.
    const { data: seeded } = await db
      .from("staff")
      .select("id")
      .eq("id", "10000000-0000-0000-0000-000000000001");
    expect(seeded ?? []).toHaveLength(1);
  });
});

// Stabilise the test ordering — the assertions in (b), (d), and (e) read
// rows the fixture creates in (a). The fixture itself is worker-scoped so
// the rows exist for the full file regardless of test order, but keeping
// `mode: serial` (above) means failures are easier to diagnose.
//
// Type signature export so downstream specs (PR 2) can import the same
// fixture type without re-declaring it.
export type { StaffFixture };
