// Vitest + Supabase fixture: exercises the `staff_assert_owner_present_trg`
// trigger from `supabase/migrations/0002_staff_management.sql`. The trigger
// guarantees at least one active, non-removed owner remains on the roster.
//
// This test talks to the LOCAL Supabase (via the service-role client) — it is
// a "unit test" by location but requires the migration to be applied. The
// test self-isolates by creating throwaway staff rows in a `beforeEach` and
// cleaning them up in `afterEach`, never touching the seeded rows.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const haveSupabase = Boolean(url && key);

// Skip the entire suite if Supabase env vars are missing — CI may not have
// them. The orchestrator runs `supabase db reset` before this in T008/T009.
const describeIfSupabase = haveSupabase ? describe : describe.skip;

describeIfSupabase("staff_assert_owner_present trigger", () => {
  let supabase: SupabaseClient;
  const createdIds: string[] = [];

  beforeAll(() => {
    supabase = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  beforeEach(() => {
    createdIds.length = 0;
  });

  afterEach(async () => {
    // Soft-clean: hard-delete by id. The trigger fires BEFORE DELETE, so we
    // must ensure no row we delete would leave zero owners. Since the seed
    // already has an active owner (Maya), our test rows never block this.
    if (createdIds.length === 0) return;
    await supabase.from("staff").delete().in("id", createdIds);
  });

  afterAll(async () => {
    // Defensive: nothing — afterEach handled it.
  });

  async function insertOwner(
    displayName: string,
    overrides: { active?: boolean; removed_at?: string | null } = {}
  ): Promise<string> {
    const { data, error } = await supabase
      .from("staff")
      .insert({
        display_name: displayName,
        role: "owner",
        color_token: "--avatar-rose",
        active: overrides.active ?? true,
        removed_at: overrides.removed_at ?? null,
        pin_hash: "$2b$11$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert owner failed: ${error.message}`);
    createdIds.push(data!.id);
    return data!.id as string;
  }

  it("allows demoting a non-last owner (a second owner exists)", async () => {
    // Seed has Maya (owner). Add a second owner; demote the second; should
    // succeed because Maya remains.
    const secondOwnerId = await insertOwner("Trigger Test Owner Two");

    const { error } = await supabase
      .from("staff")
      .update({ role: "manager" })
      .eq("id", secondOwnerId);

    expect(error).toBeNull();
  });

  it("rejects demoting the last active non-removed owner", async () => {
    // Snapshot the existing active-owner population, demote them all except
    // the one we just inserted, then try to demote that one. Easier: ensure
    // ONLY one active owner exists, then attempt to demote it.

    // Step 1: count currently-active non-removed owners.
    const { data: ownersBefore, error: readErr } = await supabase
      .from("staff")
      .select("id")
      .eq("role", "owner")
      .eq("active", true)
      .is("removed_at", null);
    if (readErr) throw readErr;

    // Step 2: temporarily mark every existing active owner inactive EXCEPT
    // none — instead, insert a fresh owner and demote each pre-existing owner
    // one by one until only the fresh one remains. But that itself would hit
    // the trigger! Smarter: insert a fresh owner first so we go to N+1, then
    // demote N pre-existing ones leaving just the fresh one. Then attempt to
    // demote the fresh one → must fail.

    const freshOwnerId = await insertOwner("Trigger Test Last Owner");

    // Demote every pre-existing active owner. Each step leaves at least the
    // fresh one + remaining originals, so the trigger doesn't fire.
    for (const row of ownersBefore ?? []) {
      const { error: demoteErr } = await supabase
        .from("staff")
        .update({ role: "manager" })
        .eq("id", row.id);
      expect(demoteErr).toBeNull();
    }

    try {
      // Step 3: attempt to demote the now-last owner — must fail.
      const { error: lastErr } = await supabase
        .from("staff")
        .update({ role: "manager" })
        .eq("id", freshOwnerId);

      expect(lastErr).not.toBeNull();
      // Postgres errcode 23514 = check_violation (the trigger raises with this).
      // PostgREST surfaces it as `code: "23514"`. Either string or text form
      // is acceptable; assert structurally.
      expect(
        lastErr?.code === "23514" || /staff_assert_owner_present/i.test(lastErr?.message ?? "")
      ).toBe(true);
    } finally {
      // Restore the pre-existing owners back to `owner` so the rest of the
      // test suite (and any subsequent dev work) sees the seed state.
      for (const row of ownersBefore ?? []) {
        await supabase.from("staff").update({ role: "owner" }).eq("id", row.id);
      }
    }
  });
});
