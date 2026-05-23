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
  // Issue #129 — `remove` is split into two actions distinguished by target
  // identity. `remove_pin_only` covers a kiosk-only tech (user_id IS NULL):
  // soft-delete the staff row, no auth-user impact, owner+manager allowed.
  // `remove_app_user` covers a logged-in staff member (user_id IS NOT NULL):
  // anonymize + delete auth user so the email is freed for re-invite,
  // owner-only (same gravity as `removeUser` on the Onboarding page).
  | "remove_pin_only"
  | "remove_app_user"
  // 023-staff-payout-exemptions: one label covers all three pay-deduction
  // fields (card_fee_exempt + supply_mode + supply_except) per Clarify Q1 +
  // research § R11. Not in SELF_BLOCKED_ACTIONS — operators may edit their
  // own pay-deduction settings; gated by the existing canEditAnyField matrix.
  | "update_pay_deductions"
  // 047-payroll-page § US5: one label covers all three per-tech payroll-rate
  // fields (service_commission_pct + tip_split_pct + check_portion_cents).
  // OWNER-ONLY per FR-002/FR-033 — a manager attempting to change a rate
  // field is rejected. Not in SELF_BLOCKED_ACTIONS — an owner may edit their
  // own rates.
  | "update_payroll_rates";

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
  | "invalid_role"
  // 047-payroll-page § US5: a non-owner attempted an owner-only action
  // (editing per-tech payroll rates). FR-002/FR-033.
  | "forbidden";

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
  /** Issue #129 — whether the "Remove from roster" control should be enabled.
   *  Computed against `remove_pin_only` (PIN-only target) or `remove_app_user`
   *  (app-user target) per `targetIsAppUser`. App-user removal is owner-only
   *  because it deletes the auth user and frees the email for re-invite —
   *  same gravity as Onboarding's `removeUser`. */
  canRemove: boolean;
  /** Issue #129 — used by the DangerZone UI to switch between the simple
   *  ConfirmDialog (PIN-only) and the rich type-name + ack dialog (app-user). */
  removeAction: "remove_pin_only" | "remove_app_user";
  /** 047-payroll-page § US5 — per-tech payroll rates are owner-only. The
   *  edit panel renders the rates section read-only when this is false. */
  canEditPayrollRates: boolean;
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
  "remove_pin_only",
  "remove_app_user",
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

  // 1b. Owner-only gate (047-payroll-page § US5). Editing per-tech payroll
  //     rates is restricted to owners — a manager (otherwise a valid settings
  //     operator) is rejected before any target evaluation. FR-002/FR-033.
  if (action === "update_payroll_rates" && operator.role !== "owner") {
    throw new PermissionError("forbidden");
  }

  // 1c. Owner-only gate (Issue #129). Removing an app-user from the staff
  //     roster anonymizes the row AND deletes the Supabase auth user so the
  //     email is freed for re-invite — same gravity as `removeUser` on the
  //     Onboarding page, which is owner-only. A manager keeps `remove_pin_only`
  //     for kiosk-only techs.
  if (action === "remove_app_user" && operator.role !== "owner") {
    throw new PermissionError("forbidden");
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
    if (action === "deactivate" || action === "remove_pin_only" || action === "remove_app_user") {
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
 *
 * Issue #129 — `targetIsAppUser` distinguishes a logged-in staff member
 * (`user_id IS NOT NULL`) from a kiosk-only tech. The two cases gate on
 * different matrix actions (`remove_app_user` vs `remove_pin_only`); the
 * `removeAction` field on the returned permissions tells the DangerZone UI
 * which confirm-dialog ceremony to render. Defaults to `false` so existing
 * call sites (and tests) don't have to thread the flag through.
 */
export function computeTargetPermissions(
  ctx: PermissionContext,
  targetIsAppUser = false
): StaffTargetPermissions {
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

  // Issue #129 — Remove gates on target identity. App-user removal also
  // requires owner role at the operator level (matches the matrix check in
  // assertMutationAllowed).
  const removeAction: "remove_pin_only" | "remove_app_user" = targetIsAppUser
    ? "remove_app_user"
    : "remove_pin_only";
  const canRemoveBase = !isSelf && !isLastOwner && !isManagerOnOwner;
  const canRemove = targetIsAppUser ? canRemoveBase && operator.role === "owner" : canRemoveBase;

  const canDeactivate = canToggleActive && (target?.active ?? false);
  const canReactivate = !isManagerOnOwner && !(target?.active ?? false) && target !== null;

  // 047-payroll-page § US5 — payroll rates are owner-only, independent of the
  // manager×owner axis (a manager can't edit them on ANY target).
  const canEditPayrollRates = operator.role === "owner" && !isManagerOnOwner;

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
    removeAction,
    canEditPayrollRates,
  };
}
