// Vitest contract test for the permission matrix in
// `app/(studio)/settings/staff/permissions.ts`. Asserts every cell of the
// operator × target × action × modifier grid per permissions.contract.md.
// Organized by the decision tree's gate ordering — first failure wins.

import { describe, expect, it } from "vitest";

import {
  assertMutationAllowed,
  computeTargetPermissions,
  isMutationAllowed,
  PermissionError,
  roleOptionsFor,
  type StaffAction,
} from "@/app/(studio)/settings/staff/permissions";

import type { StudioRole } from "@/lib/auth/session";

const ALL_ROLES: StudioRole[] = ["owner", "manager", "technician", "front_desk"];
const ALL_ACTIONS: StaffAction[] = [
  "add",
  "update_name",
  "update_role",
  "update_color",
  "update_active",
  "set_pin",
  "deactivate",
  "reactivate",
  "remove",
];

function ctx(opts: {
  operatorRole: StudioRole;
  operatorId?: string;
  target: { role: StudioRole; active?: boolean; id?: string } | null;
  isLastOwner?: boolean;
}) {
  return {
    operator: { id: opts.operatorId ?? "op-1", role: opts.operatorRole },
    target: opts.target
      ? {
          id: opts.target.id ?? "tgt-1",
          role: opts.target.role,
          active: opts.target.active ?? true,
        }
      : null,
    isLastOwner: opts.isLastOwner ?? false,
  };
}

describe("permissions matrix — operator-role gate", () => {
  it.each(["technician", "front_desk"] as StudioRole[])(
    "rejects every action for operator role %s",
    (role) => {
      for (const action of ALL_ACTIONS) {
        const c = ctx({
          operatorRole: role,
          target: action === "add" ? null : { role: "technician" },
        });
        expect(() => assertMutationAllowed(c, action, "technician")).toThrow(PermissionError);
        expect(isMutationAllowed(c, action, "technician")).toBe(false);
      }
    }
  );
});

describe("permissions matrix — owner operator (no extra constraints)", () => {
  it("owner × any non-self target × any action → allowed (with valid newRole)", () => {
    for (const targetRole of ALL_ROLES) {
      for (const action of ALL_ACTIONS) {
        const c = ctx({
          operatorRole: "owner",
          target: action === "add" ? null : { role: targetRole, id: "tgt-different" },
        });
        // For role-mutating actions pick a valid newRole the operator can grant.
        const newRole: StudioRole | undefined =
          action === "add" || action === "update_role" ? "technician" : undefined;
        expect(() => assertMutationAllowed(c, action, newRole)).not.toThrow();
      }
    }
  });
});

describe("permissions matrix — manager × owner is read-only across all 9 actions", () => {
  it.each(ALL_ACTIONS)("manager attempts %s on an owner row → forbidden_target", (action) => {
    const c = ctx({
      operatorRole: "manager",
      target: action === "add" ? null : { role: "owner", id: "tgt-different" },
    });
    // The `add` action has no target, so manager-attempts-add-an-owner is
    // tested at the role-set scope gate (next describe). Skip here.
    if (action === "add") return;
    const newRole: StudioRole | undefined = action === "update_role" ? "manager" : undefined;
    try {
      assertMutationAllowed(c, action, newRole);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("forbidden_target");
    }
  });
});

describe("permissions matrix — manager × non-owner is allowed (with role-set scope)", () => {
  it.each(["manager", "technician", "front_desk"] as StudioRole[])(
    "manager updates a %s row → allowed across non-role-mutating actions",
    (targetRole) => {
      const c = ctx({ operatorRole: "manager", target: { role: targetRole, id: "tgt-different" } });
      for (const action of ["update_name", "update_color", "set_pin", "deactivate", "reactivate"] as StaffAction[]) {
        expect(() => assertMutationAllowed(c, action)).not.toThrow();
      }
    }
  );

  it("manager attempts update_role to 'owner' on a tech → invalid_role", () => {
    const c = ctx({ operatorRole: "manager", target: { role: "technician", id: "tgt-different" } });
    try {
      assertMutationAllowed(c, "update_role", "owner");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("invalid_role");
    }
  });

  it("manager attempts add with role='owner' → invalid_role", () => {
    const c = ctx({ operatorRole: "manager", target: null });
    try {
      assertMutationAllowed(c, "add", "owner");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("invalid_role");
    }
  });

  it("manager update_role to manager/technician/front_desk → allowed", () => {
    const c = ctx({ operatorRole: "manager", target: { role: "technician", id: "tgt-different" } });
    for (const newRole of ["manager", "technician", "front_desk"] as StudioRole[]) {
      expect(() => assertMutationAllowed(c, "update_role", newRole)).not.toThrow();
    }
  });
});

describe("permissions matrix — self-edit gate", () => {
  it("blocks update_role on self regardless of operator role", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "same",
      target: { role: "owner", id: "same" },
    });
    try {
      assertMutationAllowed(c, "update_role", "manager");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("self_edit_blocked");
    }
  });

  it("blocks update_active / deactivate / remove on self", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "same",
      target: { role: "owner", id: "same" },
    });
    for (const action of ["update_active", "deactivate", "remove"] as StaffAction[]) {
      try {
        assertMutationAllowed(c, action);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PermissionError);
        expect((err as PermissionError).code).toBe("self_edit_blocked");
      }
    }
  });

  it("allows rename / recolor / set_pin on self", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "same",
      target: { role: "owner", id: "same" },
    });
    for (const action of ["update_name", "update_color", "set_pin"] as StaffAction[]) {
      expect(() => assertMutationAllowed(c, action)).not.toThrow();
    }
  });
});

describe("permissions matrix — last-owner gate", () => {
  it("blocks demoting the last owner via update_role", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "op-A",
      target: { role: "owner", id: "tgt-B" },
      isLastOwner: true,
    });
    try {
      assertMutationAllowed(c, "update_role", "manager");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("last_owner");
    }
  });

  it("blocks deactivate/remove of the last owner", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "op-A",
      target: { role: "owner", id: "tgt-B" },
      isLastOwner: true,
    });
    for (const action of ["deactivate", "remove"] as StaffAction[]) {
      try {
        assertMutationAllowed(c, action);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PermissionError);
        expect((err as PermissionError).code).toBe("last_owner");
      }
    }
  });

  it("blocks update_active=false on the last owner", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "op-A",
      target: { role: "owner", active: true, id: "tgt-B" },
      isLastOwner: true,
    });
    try {
      assertMutationAllowed(c, "update_active");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("last_owner");
    }
  });

  it("allows non-reducing actions on the last owner (rename, recolor, set_pin, reactivate, update_role->owner)", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "op-A",
      target: { role: "owner", id: "tgt-B" },
      isLastOwner: true,
    });
    expect(() => assertMutationAllowed(c, "update_name")).not.toThrow();
    expect(() => assertMutationAllowed(c, "update_color")).not.toThrow();
    expect(() => assertMutationAllowed(c, "set_pin")).not.toThrow();
    expect(() => assertMutationAllowed(c, "reactivate")).not.toThrow();
    expect(() => assertMutationAllowed(c, "update_role", "owner")).not.toThrow();
  });
});

describe("permissions matrix — gate ordering: self-edit wins over last-owner", () => {
  it("last owner attempts to demote themselves → self_edit_blocked (not last_owner)", () => {
    const c = ctx({
      operatorRole: "owner",
      operatorId: "same",
      target: { role: "owner", id: "same" },
      isLastOwner: true,
    });
    try {
      assertMutationAllowed(c, "update_role", "manager");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      // Per permissions.contract.md § Examples — self gate fires first.
      expect((err as PermissionError).code).toBe("self_edit_blocked");
    }
  });
});

describe("roleOptionsFor", () => {
  it("owner sees all four roles", () => {
    expect(roleOptionsFor("owner")).toEqual(["owner", "manager", "technician", "front_desk"]);
  });

  it("manager sees no owner option", () => {
    expect(roleOptionsFor("manager")).toEqual(["manager", "technician", "front_desk"]);
  });

  it("technician/front_desk see empty options (they can't grant)", () => {
    expect(roleOptionsFor("technician")).toEqual([]);
    expect(roleOptionsFor("front_desk")).toEqual([]);
  });
});

describe("computeTargetPermissions", () => {
  it("manager × owner target → canEditAnyField=false, all sub-flags false", () => {
    const perms = computeTargetPermissions(
      ctx({ operatorRole: "manager", target: { role: "owner", id: "tgt" } })
    );
    expect(perms.canEditAnyField).toBe(false);
    expect(perms.canEditDisplayName).toBe(false);
    expect(perms.canEditRole).toBe(false);
    expect(perms.canEditColor).toBe(false);
    expect(perms.canToggleActive).toBe(false);
    expect(perms.canSetPin).toBe(false);
    expect(perms.canDeactivate).toBe(false);
    expect(perms.canReactivate).toBe(false);
    expect(perms.canRemove).toBe(false);
  });

  it("owner × self → name+color+pin allowed; role/active/remove blocked", () => {
    const perms = computeTargetPermissions(
      ctx({ operatorRole: "owner", operatorId: "same", target: { role: "owner", id: "same" } })
    );
    expect(perms.isSelf).toBe(true);
    expect(perms.canEditDisplayName).toBe(true);
    expect(perms.canEditColor).toBe(true);
    expect(perms.canSetPin).toBe(true);
    expect(perms.canEditRole).toBe(false);
    expect(perms.canToggleActive).toBe(false);
    expect(perms.canDeactivate).toBe(false);
    expect(perms.canRemove).toBe(false);
  });

  it("last owner (not self) → role/active/remove blocked; rename/recolor/set_pin allowed", () => {
    const perms = computeTargetPermissions(
      ctx({
        operatorRole: "owner",
        operatorId: "op-A",
        target: { role: "owner", id: "tgt-B" },
        isLastOwner: true,
      })
    );
    expect(perms.isLastOwner).toBe(true);
    expect(perms.canEditDisplayName).toBe(true);
    expect(perms.canEditColor).toBe(true);
    expect(perms.canSetPin).toBe(true);
    expect(perms.canEditRole).toBe(false);
    expect(perms.canToggleActive).toBe(false);
    expect(perms.canDeactivate).toBe(false);
    expect(perms.canRemove).toBe(false);
  });

  it("canDeactivate gates on target.active=true; canReactivate gates on target.active=false", () => {
    const activeTarget = computeTargetPermissions(
      ctx({ operatorRole: "owner", operatorId: "op-A", target: { role: "technician", id: "tgt", active: true } })
    );
    expect(activeTarget.canDeactivate).toBe(true);
    expect(activeTarget.canReactivate).toBe(false);

    const inactiveTarget = computeTargetPermissions(
      ctx({ operatorRole: "owner", operatorId: "op-A", target: { role: "technician", id: "tgt", active: false } })
    );
    expect(inactiveTarget.canDeactivate).toBe(false);
    expect(inactiveTarget.canReactivate).toBe(true);
  });
});
