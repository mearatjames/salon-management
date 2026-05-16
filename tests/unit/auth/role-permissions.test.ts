// Unit tests for `lib/auth/role-permissions.ts`.
//
// The role-permissions module is the single source of truth for the
// Onboard sheet's role tiles AND the Thorough wizard's "What this role
// can do" preview card. The test pins the exact strings so a future
// content edit can't silently shift the UI copy out from under the
// design system reviewer.
//
// Constitution IV: this test is written before the module exists.

import { describe, expect, it } from "vitest";

import type { StudioRole } from "@/lib/auth/session";

import {
  ROLE_PERMISSIONS,
  getRolePermissions,
  type RolePermissionDef,
} from "@/lib/auth/role-permissions";

const ALL_ROLES: StudioRole[] = ["owner", "manager", "technician", "front_desk"];

describe("ROLE_PERMISSIONS — shape", () => {
  it("includes every StudioRole as a key", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it.each(ALL_ROLES)("role %s has at least one grant", (role) => {
    expect(ROLE_PERMISSIONS[role].grants.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL_ROLES)("role %s has a non-empty label and summary", (role) => {
    const def = ROLE_PERMISSIONS[role];
    expect(def.label.length).toBeGreaterThan(0);
    expect(def.summary.length).toBeGreaterThan(0);
  });

  it("no string contains raw HTML tag characters", () => {
    // `&` is allowed (e.g. "Services & pricing"); we only forbid the
    // angle-bracket characters that could carry markup if these strings
    // are ever rendered into raw HTML.
    const re = /[<>]/;
    for (const role of ALL_ROLES) {
      const def = ROLE_PERMISSIONS[role];
      expect(re.test(def.label)).toBe(false);
      expect(re.test(def.summary)).toBe(false);
      for (const g of def.grants) {
        expect(re.test(g)).toBe(false);
      }
      for (const b of def.blocks) {
        expect(re.test(b)).toBe(false);
      }
    }
  });
});

describe("ROLE_PERMISSIONS — exact content snapshot", () => {
  const expected: Readonly<Record<StudioRole, RolePermissionDef>> = {
    owner: {
      label: "Owner",
      summary:
        "Full access. Can manage staff, billing, settings, and offboard anyone except themselves.",
      grants: [
        "Calendar, Clients, Checkout, Walk-in",
        "Services & pricing",
        "End of Day & Day Report",
        "Refunds & voids (no manager approval needed)",
        "Settings (Staff, Billing, Onboarding)",
      ],
      blocks: [],
    },
    manager: {
      label: "Manager",
      summary:
        "Day-to-day operations. Can approve refunds/voids inline. Cannot manage billing or onboard new users.",
      grants: [
        "Calendar, Clients, Checkout, Walk-in",
        "Services & pricing",
        "End of Day & Day Report",
        "Refunds & voids (authorizing manager)",
        "Settings → Staff (edit-only)",
      ],
      blocks: ["Billing & subscription", "Onboarding new users"],
    },
    technician: {
      label: "Tech",
      summary:
        "Performs services, takes payments. Most won't have email login — PIN only on shared iPad.",
      grants: [
        "Calendar (own column)",
        "Clients (read + notes)",
        "Checkout (their tickets)",
        "Walk-in (seat next)",
      ],
      blocks: ["Refunds & voids", "Services & pricing edits", "Any Settings tab"],
    },
    front_desk: {
      label: "Front desk",
      summary:
        "Books appointments, runs the kiosk, takes payments. No edit access to services or staff.",
      grants: [
        "Calendar (all techs)",
        "Clients",
        "Checkout (all tickets)",
        "Walk-in & kiosk pairing",
      ],
      blocks: ["Refunds & voids (manager required)", "Services & pricing", "Any Settings tab"],
    },
  };

  it.each(ALL_ROLES)("matches the canonical definition for %s", (role) => {
    // Compare via a structural clone so readonly array typing doesn't
    // interfere with toEqual's deep equality.
    expect({
      label: ROLE_PERMISSIONS[role].label,
      summary: ROLE_PERMISSIONS[role].summary,
      grants: [...ROLE_PERMISSIONS[role].grants],
      blocks: [...ROLE_PERMISSIONS[role].blocks],
    }).toEqual({
      label: expected[role].label,
      summary: expected[role].summary,
      grants: [...expected[role].grants],
      blocks: [...expected[role].blocks],
    });
  });
});

describe("getRolePermissions", () => {
  it.each(ALL_ROLES)("returns the matching definition for %s", (role) => {
    expect(getRolePermissions(role)).toBe(ROLE_PERMISSIONS[role]);
  });
});
