// Vitest contract test for the audit writer extension in
// `lib/auth/audit.ts`. Asserts the `AuditAction` union accepts the six new
// staff verbs and that `recordAudit` writes one row per call with the
// documented entity_type ("staff") and payload shape (no
// `authorizing_staff_id` in any payload — the manager-PIN override is gone
// per Clarifications Q1).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordAudit, type AuditAction } from "@/lib/auth/audit";

// Mock the service-role client — every test sets up its own insert spy.
vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

const NEW_STAFF_ACTIONS: AuditAction[] = [
  "staff.added",
  "staff.updated",
  "staff.pin_set",
  "staff.deactivated",
  "staff.reactivated",
  "staff.removed",
];

const LEGACY_AUTH_ACTIONS: AuditAction[] = [
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

describe("recordAudit — staff verbs (006-staff-management)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(NEW_STAFF_ACTIONS)(
    "accepts and inserts one row for %s with entity_type='staff'",
    async (action) => {
      const { insertSpy, fromSpy } = mockClient(async () => ({ error: null }));

      await recordAudit(action, "device-1", "staff-target-1", { foo: "bar" });

      expect(fromSpy).toHaveBeenCalledWith("audit_log");
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(row.action).toBe(action);
      expect(row.entity_type).toBe("staff");
      expect(row.actor_user_id).toBe("device-1");
      expect(row.acting_as_staff_id).toBe("staff-target-1");
      expect(row.entity_id).toBe("staff-target-1");
      expect(row.payload).toEqual({ foo: "bar" });
    }
  );

  it.each(LEGACY_AUTH_ACTIONS)(
    "keeps entity_type='auth' for legacy verb %s (back-compat)",
    async (action) => {
      const { insertSpy } = mockClient(async () => ({ error: null }));

      await recordAudit(action, "device-1", "staff-1", { method: "password" });

      const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(row.action).toBe(action);
      expect(row.entity_type).toBe("auth");
    }
  );

  it("never includes `authorizing_staff_id` in any payload it writes", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    // Even if a caller (incorrectly) passes the key, the writer must not
    // strip-or-pass-through to the row column; only `payload` could carry it.
    // We test the documented shape: payload is whatever the caller passed,
    // and we assert no `authorizing_staff_id` key sneaks in via the writer.
    await recordAudit("staff.updated", "device-1", "staff-1", {
      changes: { display_name: ["A", "B"] },
      before: { display_name: "A" },
      after: { display_name: "B" },
    });

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    const payload = row.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("authorizing_staff_id");
    expect(row).not.toHaveProperty("authorizing_staff_id");
  });

  it("writes exactly one row per recordAudit call (no batching, no retries)", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    await recordAudit("staff.added", "device-1", "new-staff-1", {
      display_name: "Maya Chen",
      role: "technician",
      color_token: "--avatar-green",
      pin_set: true,
    });
    await recordAudit("staff.deactivated", "device-1", "staff-2", {});
    await recordAudit("staff.removed", "device-1", "staff-3", {
      display_name_at_removal: "Bob",
      role_at_removal: "front_desk",
    });

    expect(insertSpy).toHaveBeenCalledTimes(3);
  });

  it("defaults payload to {} when none provided", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));
    await recordAudit("staff.reactivated", "device-1", "staff-1");
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.payload).toEqual({});
  });
});
