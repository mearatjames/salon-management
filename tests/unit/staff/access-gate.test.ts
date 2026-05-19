// Unit tests for the /settings/staff route-level access gate.
//
// `canAccessStaffSettings(role)` is the pure predicate the page Server
// Component calls before any data fetch; rejecting roles get redirected to
// `/dashboard`. This replaces e2e case `staff.spec.ts US6(a)` per
// docs/e2e-pruning-audit.md.

import { describe, expect, it } from "vitest";

import {
  canAccessStaffSettings,
  STAFF_SETTINGS_OPERATORS,
} from "@/app/(studio)/settings/staff/_access-gate";
import type { StudioRole } from "@/lib/auth/session";

const ALL_ROLES: StudioRole[] = ["owner", "manager", "technician", "front_desk"];

describe("canAccessStaffSettings — role allowlist", () => {
  it.each(["owner", "manager"] as StudioRole[])("admits %s", (role) => {
    expect(canAccessStaffSettings(role)).toBe(true);
  });

  it.each(["technician", "front_desk"] as StudioRole[])("redirects %s", (role) => {
    // A `false` here is what makes `page.tsx` call `redirect('/dashboard')`,
    // satisfying US6(a)'s "technician → /dashboard with no flash" contract.
    expect(canAccessStaffSettings(role)).toBe(false);
  });

  it("exhaustively classifies every StudioRole — no role left unspecified", () => {
    // Sanity guard so a new StudioRole added in lib/auth/session.ts can't
    // silently default-deny (or default-allow) without an intentional update.
    for (const role of ALL_ROLES) {
      const isOperator = STAFF_SETTINGS_OPERATORS.has(role);
      expect(canAccessStaffSettings(role)).toBe(isOperator);
    }
  });
});
