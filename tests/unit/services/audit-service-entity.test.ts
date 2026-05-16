// Vitest contract test for the audit writer extension landed by
// feature 008-services-catalog. Asserts the `AuditAction` union accepts
// the four new `service.*` verbs and that `recordAudit('service.<verb>', ...)`
// writes an `audit_log` row with `entity_type = 'service'` and the documented
// shape (`entity_id` = service uuid; `acting_as_staff_id` distinct from
// `entity_id` when supplied).
//
// Mirrors `tests/unit/staff/audit.test.ts` so the two files share the same
// mock idiom.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordAudit, type AuditAction } from "@/lib/auth/audit";

// Mock the service-role client — every test sets up its own insert spy.
vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

const NEW_SERVICE_ACTIONS: AuditAction[] = [
  "service.added",
  "service.updated",
  "service.archived",
  "service.restored",
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

describe("recordAudit — service verbs (008-services-catalog)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(NEW_SERVICE_ACTIONS)(
    "accepts and inserts one row for %s with entity_type='service'",
    async (action) => {
      const { insertSpy, fromSpy } = mockClient(async () => ({ error: null }));

      await recordAudit(action, "device-1", "service-target-1", { name: "Gel polish" });

      expect(fromSpy).toHaveBeenCalledWith("audit_log");
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(row.action).toBe(action);
      expect(row.entity_type).toBe("service");
      expect(row.actor_user_id).toBe("device-1");
      expect(row.entity_id).toBe("service-target-1");
      // Back-compat fallback: when the 5th arg is omitted, acting_as_staff_id
      // mirrors entity_id (matches the existing staff.* / auth call sites).
      expect(row.acting_as_staff_id).toBe("service-target-1");
      expect(row.payload).toEqual({ name: "Gel polish" });
    }
  );

  it("uses the 5th `actingAsStaffId` argument when supplied (service.* verbs)", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    // For service.* the entity_id is the services uuid, and the operator is a
    // separate staff uuid — these MUST be persisted as distinct columns.
    await recordAudit(
      "service.added",
      "device-1",
      "service-uuid-aaa",
      { name: "Gel polish" },
      "operator-staff-uuid-bbb"
    );

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.entity_id).toBe("service-uuid-aaa");
    expect(row.acting_as_staff_id).toBe("operator-staff-uuid-bbb");
    expect(row.entity_type).toBe("service");
  });

  it("preserves entity_type='staff' for staff.* mutations after the refactor", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    await recordAudit("staff.added", "device-1", "staff-uuid-zzz", { display_name: "Maya" });

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.entity_type).toBe("staff");
    expect(row.entity_id).toBe("staff-uuid-zzz");
    // Back-compat fallback for staff.* call sites that don't pass a 5th arg.
    expect(row.acting_as_staff_id).toBe("staff-uuid-zzz");
  });

  it("preserves entity_type='auth' for legacy auth-flow verbs", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    await recordAudit("device.signed_in", "device-1", null, { method: "password" });

    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.entity_type).toBe("auth");
    expect(row.entity_id).toBeNull();
    expect(row.acting_as_staff_id).toBeNull();
  });

  it("writes one row per call (no batching, no retries)", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));

    await recordAudit("service.added", "device-1", "svc-1", { name: "A" }, "op-1");
    await recordAudit("service.archived", "device-1", "svc-1", { name: "A" }, "op-1");
    await recordAudit("service.restored", "device-1", "svc-1", { name: "A" }, "op-1");

    expect(insertSpy).toHaveBeenCalledTimes(3);
  });

  it("defaults payload to {} when none provided", async () => {
    const { insertSpy } = mockClient(async () => ({ error: null }));
    await recordAudit("service.restored", "device-1", "svc-1");
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.payload).toEqual({});
  });

  it("does not re-throw when the underlying insert throws", async () => {
    mockClient(async () => {
      throw new Error("transient DB outage");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      recordAudit("service.updated", "device-1", "svc-1", { changes: {} }, "op-1")
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
