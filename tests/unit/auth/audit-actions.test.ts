// Unit tests for the audit extension introduced in 012-user-onboarding.
//
// The audit module (`lib/auth/audit.ts`) gains seven `user.*` actions and
// `deriveEntityType` learns to dispatch them to the `"user"` entity type.
// Both must hold for the onboarding mutations to write correctly-typed
// audit rows; without the extension, every `user.invited` (etc.) row would
// fall through to the default `"auth"` bucket and forensic queries against
// `entity_type='user'` would return zero rows.
//
// Constitution IV (auth-critical): these tests are authored BEFORE the
// extension lands in `lib/auth/audit.ts` and MUST FAIL on first run.

import { describe, expect, it } from "vitest";

import {
  type AuditAction,
  // `deriveEntityType` is currently private to the module; this test forces
  // it to be exported so callers (and future tests) can assert dispatch
  // behavior directly.
  deriveEntityType,
} from "@/lib/auth/audit";

// Type-only check: every new literal must be assignable to AuditAction.
// If the union doesn't include them, this `const` is a compile error and
// the suite never even loads.
const NEW_USER_ACTIONS: AuditAction[] = [
  "user.invited",
  "user.invite_resent",
  "user.invite_cancelled",
  "user.offboarded",
  "user.reactivated",
  "user.removed",
  "user.pin_reset",
];

describe("audit — 012 user.* extension", () => {
  it.each(NEW_USER_ACTIONS)("treats %s as entity_type 'user'", (action) => {
    expect(deriveEntityType(action)).toBe("user");
  });

  it("preserves existing dispatch for staff.* actions", () => {
    expect(deriveEntityType("staff.added")).toBe("staff");
    expect(deriveEntityType("staff.removed")).toBe("staff");
  });

  it("preserves existing dispatch for service.* actions", () => {
    expect(deriveEntityType("service.added")).toBe("service");
  });

  it("preserves existing dispatch for device/auth actions", () => {
    expect(deriveEntityType("device.signed_in")).toBe("auth");
    expect(deriveEntityType("staff.pin_failed")).toBe("auth");
  });
});

// Feature 019 — cash_drawer.* extension. The close RPC writes a
// `cash_drawer.closed` audit row using the prefix dispatch added in T002;
// without the extension the row would fall through to entity_type='auth'
// and any forensic query against entity_type='cash_drawer' would miss it.
describe("audit — 019 cash_drawer.* extension", () => {
  it("treats cash_drawer.closed as entity_type 'cash_drawer'", () => {
    expect(deriveEntityType("cash_drawer.closed")).toBe("cash_drawer");
  });
});
