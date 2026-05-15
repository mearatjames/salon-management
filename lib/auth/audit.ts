// Write-only audit-log helper. The single point of truth for every auth
// event this feature emits. Uses the service-role Supabase client because
// `audit_log` has no INSERT policy for `authenticated` (by design).
//
// Failure mode: if the insert throws (DB outage, RLS misconfiguration,
// etc.), the error is logged and swallowed. An audit-write blip MUST NOT
// block a legitimate sign-in. The append-only retention contract guarantees
// nothing is ever lost beyond transient inserts.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";

export type AuthAction =
  | "device.signed_in"
  | "device.signed_out"
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched";

export async function recordAuth(
  action: AuthAction,
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
      entity_type: "auth",
      entity_id: staffId,
      payload: payload as Json,
    });
  } catch (err) {
    // Intentional: audit must not block legitimate sign-ins. Failures are
    // logged via console.error and swallowed.
    console.error("audit insert failed", err);
  }
}
