import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordAuth, type AuthAction } from "@/lib/auth/audit";

// Mock the service-role client module — every test sets up its own
// implementation of `from(...).insert(...)`.
vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

const ALL_ACTIONS: AuthAction[] = [
  "device.signed_in",
  "device.signed_out",
  "staff.signed_in",
  "staff.pin_failed",
  "staff.switched",
];

type InsertSpy = ReturnType<typeof vi.fn>;

function mockClient(insertImpl: (row: Record<string, unknown>) => Promise<{ error: unknown }>) {
  const insertSpy: InsertSpy = vi.fn(async (row: Record<string, unknown>) => insertImpl(row));
  const fromSpy = vi.fn(() => ({ insert: insertSpy }));
  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: fromSpy,
  });
  return { insertSpy, fromSpy };
}

describe("lib/auth/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts one row per call into audit_log with entity_type 'auth'", async () => {
    const { insertSpy, fromSpy } = mockClient(async () => ({ error: null }));

    await recordAuth("device.signed_in", "device-1", null, { method: "password" });

    expect(fromSpy).toHaveBeenCalledWith("audit_log");
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.action).toBe("device.signed_in");
    expect(row.entity_type).toBe("auth");
    expect(row.actor_user_id).toBe("device-1");
    expect(row.acting_as_staff_id).toBeNull();
    expect(row.entity_id).toBeNull();
    expect(row.payload).toEqual({ method: "password" });
  });

  it.each(ALL_ACTIONS)("writes an audit row for action %s", async (action) => {
    const { insertSpy } = mockClient(async () => ({ error: null }));
    const staffId =
      action === "device.signed_in" || action === "device.signed_out" ? null : "staff-xyz";

    await recordAuth(action, "device-1", staffId, { foo: "bar" });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.action).toBe(action);
    expect(row.entity_type).toBe("auth");
    expect(row.entity_id).toBe(staffId);
    expect(row.payload).toEqual({ foo: "bar" });
  });

  it("defaults payload to an empty object when none is provided", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));
    await recordAuth("staff.switched", "device-1", "staff-1");
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.payload).toEqual({});
  });

  it("does not re-throw when the underlying insert throws", async () => {
    mockClient(async () => {
      throw new Error("transient DB outage");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      recordAuth("staff.pin_failed", "device-1", "staff-1", { reason: "mismatch" })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
