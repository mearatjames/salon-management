// Unit tests for `lib/auth/sync-staff-email.ts` (#220).
//
// The helper copies the authenticated user's email onto the staff row linked
// by `user_id` when that row's email is NULL or differs case-insensitively,
// and must never throw (it runs inside every sign-in path).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { syncStaffEmailFromAuth } from "@/lib/auth/sync-staff-email";

type Row = { id: string; email: string | null };

function mockAdmin(opts: { rows?: Row[]; selectError?: unknown; updateError?: unknown }) {
  const selectEq = vi.fn();
  const selectIs = vi.fn(async () => ({ data: opts.rows ?? [], error: opts.selectError ?? null }));
  const updateEq = vi.fn(async () => ({ error: opts.updateError ?? null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const select = vi.fn(() => {
    const chain = {
      eq: selectEq.mockImplementation(() => chain),
      is: selectIs,
    };
    return chain;
  });
  const from = vi.fn(() => ({ select, update }));
  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from,
  });
  return { from, select, selectEq, selectIs, update, updateEq };
}

describe("syncStaffEmailFromAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("sets staff.email when the linked row has none", async () => {
    const admin = mockAdmin({ rows: [{ id: "s1", email: null }] });

    await syncStaffEmailFromAuth("user-1", "owner@example.com");

    expect(admin.selectEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(admin.selectIs).toHaveBeenCalledWith("removed_at", null);
    expect(admin.update).toHaveBeenCalledWith({ email: "owner@example.com" });
    expect(admin.updateEq).toHaveBeenCalledWith("id", "s1");
  });

  it("updates when the stored email differs (auth email changed)", async () => {
    const admin = mockAdmin({ rows: [{ id: "s1", email: "old@example.com" }] });

    await syncStaffEmailFromAuth("user-1", "new@example.com");

    expect(admin.update).toHaveBeenCalledWith({ email: "new@example.com" });
  });

  it("leaves a case-insensitively equal email untouched", async () => {
    const admin = mockAdmin({ rows: [{ id: "s1", email: "Owner@Example.com" }] });

    await syncStaffEmailFromAuth("user-1", "owner@example.com");

    expect(admin.update).not.toHaveBeenCalled();
  });

  it("no-ops without a user id or email", async () => {
    const admin = mockAdmin({ rows: [{ id: "s1", email: null }] });

    await syncStaffEmailFromAuth("user-1", null);
    await syncStaffEmailFromAuth(null, "owner@example.com");

    expect(admin.from).not.toHaveBeenCalled();
  });

  it("swallows a unique-email collision on update", async () => {
    mockAdmin({
      rows: [{ id: "s1", email: null }],
      updateError: { code: "23505", message: "staff_email_lower_unique" },
    });

    await expect(syncStaffEmailFromAuth("user-1", "taken@example.com")).resolves.toBeUndefined();
  });

  it("swallows a select failure", async () => {
    const admin = mockAdmin({ selectError: { message: "boom" } });

    await expect(syncStaffEmailFromAuth("user-1", "owner@example.com")).resolves.toBeUndefined();
    expect(admin.update).not.toHaveBeenCalled();
  });
});
