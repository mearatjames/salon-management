// Write-only audit-log helper. The single point of truth for every auth,
// staff-management, and catalog event this app emits. Uses the service-role
// Supabase client because `audit_log` has no INSERT policy for
// `authenticated` (by design).
//
// Failure mode: if the insert throws (DB outage, RLS misconfiguration,
// etc.), the error is logged and swallowed. An audit-write blip MUST NOT
// block a legitimate sign-in, staff-management mutation, or catalog edit.
// The append-only retention contract guarantees nothing is ever lost beyond
// transient inserts.
//
// `entity_type` is derived from the action verb's prefix via
// `deriveEntityType` — `service.*` → `"service"`, `ticket.*` → `"ticket"`,
// `payment.*` → `"payment"`, the six staff-mutation verbs → `"staff"`,
// everything else (sign-in / sign-out / PIN-fail / switch) → `"auth"`. The
// prefix dispatch keeps the helper closed against future feature additions
// (the next feature's verbs route correctly without editing this set as
// long as they follow the same `<entity>.<verb>` shape).
//
// `actingAsStaffId` is a 5th optional argument that lets `service.*` (and
// any future entity-type) call sites pass an operator id distinct from the
// `entityId` (the affected row). When omitted, it falls back to `entityId`
// for backward compatibility with the existing `staff.*` and auth call
// sites — there the staff being mutated IS the actor (or both are null
// for device-level events).

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";

export type AuditAction =
  // From feature 003 (entity_type "auth")
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  // Added by feature 010 (entity_type "auth")
  | "device.password_reset"
  // Added by feature 006 (entity_type "staff")
  | "staff.added"
  | "staff.updated"
  | "staff.pin_set"
  | "staff.deactivated"
  | "staff.reactivated"
  | "staff.removed"
  // Added by feature 008 (entity_type "service")
  | "service.added"
  | "service.updated"
  | "service.archived"
  | "service.restored"
  // Added by feature 011 (entity_type "ticket" / "payment")
  | "ticket.created"
  | "ticket.line_added"
  | "ticket.line_removed"
  | "ticket.line_tech_assigned"
  | "ticket.discarded"
  | "payment.captured"
  // Added by feature 012 (entity_type "user")
  | "user.invited"
  | "user.invite_resent"
  | "user.invite_cancelled"
  | "user.offboarded"
  | "user.reactivated"
  | "user.removed"
  | "user.pin_reset";

export function deriveEntityType(
  action: AuditAction
): "service" | "ticket" | "payment" | "staff" | "auth" | "user" {
  if (action.startsWith("user.")) return "user";
  if (action.startsWith("ticket.")) return "ticket";
  if (action.startsWith("payment.")) return "payment";
  if (action.startsWith("service.")) return "service";
  if (
    action === "staff.added" ||
    action === "staff.updated" ||
    action === "staff.pin_set" ||
    action === "staff.deactivated" ||
    action === "staff.reactivated" ||
    action === "staff.removed"
  ) {
    return "staff";
  }
  return "auth";
}

export async function recordAudit(
  action: AuditAction,
  deviceUserId: string | null,
  entityId: string | null = null,
  payload: Record<string, unknown> = {},
  actingAsStaffId?: string | null
): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    // Back-compat: when the 5th arg is omitted, mirror `entityId` into
    // `acting_as_staff_id`. This matches every existing `staff.*` and auth
    // call site where the staff being mutated IS the actor (or both are
    // null for device-level events).
    const actingAs = actingAsStaffId === undefined ? entityId : actingAsStaffId;
    await supabase.from("audit_log").insert({
      action,
      actor_user_id: deviceUserId,
      acting_as_staff_id: actingAs,
      entity_type: deriveEntityType(action),
      entity_id: entityId,
      payload: payload as Json,
    });
  } catch (err) {
    // Intentional: audit must not block legitimate mutations. Failures are
    // logged via console.error and swallowed.
    console.error("audit insert failed", err);
  }
}

// Back-compat aliases — removed in the next auth-touching feature.
// Feature 003's call sites (login/select-staff/middleware/(studio)/actions)
// import `recordAuth` and `AuthAction`; keep these working while we migrate.
export const recordAuth = recordAudit;
export type AuthAction = AuditAction;
