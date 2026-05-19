// Route-level access gate for /settings/staff.
//
// The Server Component `page.tsx` calls `canAccessStaffSettings(role)` after
// resolving the session and redirects to `/dashboard` for any operator the
// predicate rejects. Pulled out as a pure helper so the gate is unit-testable
// without booting the Next renderer — see `tests/unit/staff/access-gate.test.ts`.
//
// Per docs/e2e-pruning-audit.md § staff.spec.ts US6(a), this replaces the e2e
// case that walked a technician through the redirect. The permission matrix
// already covers what each role *cannot do once inside* the page; this gate
// covers who can reach the page in the first place.

import type { StudioRole } from "@/lib/auth/session";

export const STAFF_SETTINGS_OPERATORS: ReadonlySet<StudioRole> = new Set<StudioRole>([
  "owner",
  "manager",
]);

export function canAccessStaffSettings(role: StudioRole): boolean {
  return STAFF_SETTINGS_OPERATORS.has(role);
}
