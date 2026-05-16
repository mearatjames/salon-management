// Permission matrix for staff-management mutations. The trust boundary —
// every Server Action calls `assertMutationAllowed` before any DB write, and
// the edit-panel client island calls `computeTargetPermissions` to render
// `disabled` state. Pure functions, no I/O.
//
// Decision tree (first failure wins; see permissions.contract.md § Decision tree):
//   1. Operator-role gate (must be owner or manager)
//   2. Role-asymmetry gate (manager × owner → forbidden_target)
//   3. Role-set scope (newRole must be in roleOptionsFor(operator))
//   4. Self-edit gate (self cannot change own role/active/deactivate/remove)
//   5. Last-owner gate (cannot reduce active-owner count below 1)
//
// PermissionError carries a stable `code` string that Server Actions map
// directly to `?error=<code>` redirect params.

import type { StudioRole } from "@/lib/auth/session";

export type { StudioRole };

export type StaffAction =
  | "add"
  | "update_name"
  | "update_role"
  | "update_color"
  | "update_active"
  | "set_pin"
  | "deactivate"
  | "reactivate"
  | "remove";

export type PermissionContext = {
  operator: { id: string; role: StudioRole };
  /** null for `add` (no target row yet). */
  target: { id: string; role: StudioRole; active: boolean } | null;
  isLastOwner: boolean;
};

export type PermissionErrorCode =
  | "forbidden_target"
  | "self_edit_blocked"
  | "last_owner"
  | "invalid_role";

export class PermissionError extends Error {
  readonly code: PermissionErrorCode;
  constructor(code: PermissionErrorCode, message?: string) {
    super(message ?? `permission: ${code}`);
    this.name = "PermissionError";
    this.code = code;
  }
}

export type StaffTargetPermissions = {
  isSelf: boolean;
  isLastOwner: boolean;
  canEditAnyField: boolean;
  canEditDisplayName: boolean;
  canEditRole: boolean;
  canEditColor: boolean;
  canToggleActive: boolean;
  canSetPin: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
  canRemove: boolean;
};

const SETTINGS_OPERATORS: readonly StudioRole[] = ["owner", "manager"];

/**
 * Roles an operator is allowed to grant. Owners can grant any role;
 * managers cannot grant `owner`. Non-settings roles can grant nothing.
 */
export function roleOptionsFor(operatorRole: StudioRole): StudioRole[] {
  if (operatorRole === "owner") {
    return ["owner", "manager", "technician", "front_desk"];
  }
  if (operatorRole === "manager") {
    return ["manager", "technician", "front_desk"];
  }
  return [];
}

const SELF_BLOCKED_ACTIONS = new Set<StaffAction>([
  "update_role",
  "update_active",
  "deactivate",
  "remove",
]);

const ROLE_MUTATING_ACTIONS = new Set<StaffAction>(["add", "update_role"]);

/**
 * Throws `PermissionError` if the action is not allowed. Returns `void` on
 * success. Decision-tree order matches permissions.contract.md exactly — the
 * test asserts that self-edit fires before last-owner when both would block.
 */
export function assertMutationAllowed(
  ctx: PermissionContext,
  action: StaffAction,
  newRole?: StudioRole
): void {
  const { operator, target, isLastOwner } = ctx;

  // 1. Operator-role gate.
  if (!SETTINGS_OPERATORS.includes(operator.role)) {
    throw new PermissionError("forbidden_target");
  }

  // 2. Role-asymmetry gate: manager × owner → forbidden_target.
  if (target && operator.role === "manager" && target.role === "owner") {
    throw new PermissionError("forbidden_target");
  }

  // 3. Role-set scope: for role-mutating actions, newRole must be in scope.
  if (ROLE_MUTATING_ACTIONS.has(action)) {
    if (!newRole) {
      throw new PermissionError("invalid_role", "newRole required");
    }
    const allowed = roleOptionsFor(operator.role);
    if (!allowed.includes(newRole)) {
      throw new PermissionError("invalid_role");
    }
  }

  // 4. Self-edit gate (target.id === operator.id).
  if (target && target.id === operator.id && SELF_BLOCKED_ACTIONS.has(action)) {
    throw new PermissionError("self_edit_blocked");
  }

  // 5. Last-owner gate. Only fires when the action would reduce the active,
  //    non-removed owner count. Self-edit gate above already short-circuits
  //    self-on-self mutations of role/active.
  if (isLastOwner && target) {
    if (action === "update_role" && newRole && newRole !== "owner") {
      throw new PermissionError("last_owner");
    }
    if (action === "update_active") {
      // We can't know the new active value from the action alone — the Server
      // Action passes update_active only when the value flips. The reducing
      // case is when target was active (or last-owner means active owner).
      throw new PermissionError("last_owner");
    }
    if (action === "deactivate" || action === "remove") {
      throw new PermissionError("last_owner");
    }
  }
}

/** Non-throwing variant — true if the action is allowed. */
export function isMutationAllowed(
  ctx: PermissionContext,
  action: StaffAction,
  newRole?: StudioRole
): boolean {
  try {
    assertMutationAllowed(ctx, action, newRole);
    return true;
  } catch (err) {
    if (err instanceof PermissionError) return false;
    throw err;
  }
}

/**
 * Compose the full `StaffTargetPermissions` object for the edit panel. The
 * panel reads each `canX` flag directly to set `disabled` on the matching
 * control. Computed in the page Server Component and passed as a prop.
 */
export function computeTargetPermissions(ctx: PermissionContext): StaffTargetPermissions {
  const { operator, target, isLastOwner } = ctx;
  const isSelf = target?.id === operator.id;

  // The "manager × owner" axis collapses every per-field flag to false;
  // we expose it as canEditAnyField for the inline banner in the panel.
  const isManagerOnOwner = target && operator.role === "manager" && target.role === "owner";

  const canEditDisplayName = !isManagerOnOwner;
  const canEditColor = !isManagerOnOwner;
  const canSetPin = !isManagerOnOwner;

  // canEditRole: blocked by self / last-owner / manager×owner.
  // Note: we pick "technician" as a probe newRole to evaluate the role-set
  // gate; for owner operators we additionally allow "owner" (no demotion),
  // but the panel UI presents the role-select options scoped via
  // roleOptionsFor(operator.role) so the user can't pick out-of-scope.
  const canEditRole = !isSelf && !isLastOwner && !isManagerOnOwner;
  const canToggleActive = !isSelf && !isLastOwner && !isManagerOnOwner;
  const canRemove = !isSelf && !isLastOwner && !isManagerOnOwner;

  const canDeactivate = canToggleActive && (target?.active ?? false);
  const canReactivate = !isManagerOnOwner && !(target?.active ?? false) && target !== null;

  return {
    isSelf: Boolean(isSelf),
    isLastOwner,
    canEditAnyField: !isManagerOnOwner,
    canEditDisplayName,
    canEditRole,
    canEditColor,
    canToggleActive,
    canSetPin,
    canDeactivate,
    canReactivate,
    canRemove,
  };
}
