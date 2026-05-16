// Unit tests for `lib/onboarding/email-conflict.ts`.
//
// The email-conflict guard is the gate that prevents the Onboard sheet from
// silently shadowing an existing staff row when an owner re-uses an
// address. It returns one of three typed codes (or null) so the calling
// Server Action can map the case to the contract's `?error=` codes:
//   - active staff → `already_active`
//   - pending invite → `already_invited`
//   - soft-offboarded → `was_offboarded`
//   - no match → null (caller proceeds with invite)
//
// Hard-removed rows (`removed_at IS NOT NULL`, `email IS NULL` by
// anonymization contract) never match because the lookup filters them
// out — which is why re-inviting after Remove succeeds (FR-052).
//
// Constitution IV — auth-critical. Written before the module exists.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { checkEmailConflict } from "@/lib/onboarding/email-conflict";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

function mockMaybeSingle(returned: { state: string } | null) {
  const maybeSingle = vi.fn(async () => ({ data: returned, error: null }));
  const is = vi.fn(() => ({ maybeSingle }));
  const ilike = vi.fn(() => ({ is }));
  const select = vi.fn(() => ({ ilike }));
  const from = vi.fn(() => ({ select }));
  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from,
  });
  return { from, select, ilike, is, maybeSingle };
}

describe("checkEmailConflict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'already_active' when a row with state='active' exists", async () => {
    mockMaybeSingle({ state: "active" });
    await expect(checkEmailConflict("owner@tang.dev")).resolves.toBe("already_active");
  });

  it("returns 'already_invited' when a row with state='invited' exists", async () => {
    mockMaybeSingle({ state: "invited" });
    await expect(checkEmailConflict("pending@tang.dev")).resolves.toBe("already_invited");
  });

  it("returns 'was_offboarded' when a row with state='offboarded' exists", async () => {
    mockMaybeSingle({ state: "offboarded" });
    await expect(checkEmailConflict("leftus@tang.dev")).resolves.toBe("was_offboarded");
  });

  it("returns null when no row matches (e.g. fresh email or hard-removed)", async () => {
    mockMaybeSingle(null);
    await expect(checkEmailConflict("nobody@tang.dev")).resolves.toBeNull();
  });

  it("queries the staff table with a case-insensitive email filter scoped to removed_at IS NULL", async () => {
    const m = mockMaybeSingle(null);
    await checkEmailConflict("MIXEDCASE@Tang.Dev");
    expect(m.from).toHaveBeenCalledWith("staff");
    expect(m.select).toHaveBeenCalledWith("state");
    expect(m.ilike).toHaveBeenCalledWith("email", "MIXEDCASE@Tang.Dev");
    expect(m.is).toHaveBeenCalledWith("removed_at", null);
  });
});
