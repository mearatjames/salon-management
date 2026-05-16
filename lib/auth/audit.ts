// Write-only audit-log helper. The single point of truth for every auth + staff
// management event this app emits. Uses the service-role Supabase client
// because `audit_log` has no INSERT policy for `authenticated` (by design).
//
// Failure mode: if the insert throws (DB outage, RLS misconfiguration,
// etc.), the error is logged and swallowed. An audit-write blip MUST NOT
// block a legitimate sign-in or staff-management mutation. The append-only
// retention contract guarantees nothing is ever lost beyond transient inserts.
//
// Note: `entity_type` is derived from the action verb's prefix — `staff.*`
// verbs that mutate the roster get `"staff"`, all other (auth-flow) verbs
// retain `"auth"`. This keeps feature 003's call sites (`device.signed_in`,
// `staff.signed_in`, `staff.pin_failed`, `staff.switched`) unchanged while
// the six new feature-006 staff verbs route to the correct entity type.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";

export type AuditAction =
  // From feature 003 (kept verbatim — entity_type "auth")
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  // Added by feature 006 (entity_type "staff")
  | "staff.added"
  | "staff.updated"
  | "staff.pin_set"
  | "staff.deactivated"
  | "staff.reactivated"
  | "staff.removed";

// The six new verbs that target the staff roster as an entity. Everything else
// (sign-in / sign-out / PIN-fail / switch) is an auth-flow event.
const STAFF_ENTITY_ACTIONS = new Set<AuditAction>([
  "staff.added",
  "staff.updated",
  "staff.pin_set",
  "staff.deactivated",
  "staff.reactivated",
  "staff.removed",
]);

function deriveEntityType(action: AuditAction): "staff" | "auth" {
  return STAFF_ENTITY_ACTIONS.has(action) ? "staff" : "auth";
}

export async function recordAudit(
  action: AuditAction,
  deviceUserId: string | null,
  staffId: string | null = null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    await supabase.from("audit_log").insert({
      action,
      actor_user_id: deviceUserId,
      acting_as_staff_id: staffId,
      entity_type: deriveEntityType(action),
      entity_id: staffId,
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
