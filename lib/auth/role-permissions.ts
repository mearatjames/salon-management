// Role permissions catalogue — single source of truth for the
// /settings/onboarding role tiles AND the Thorough wizard's
// "What this role can do" preview card.
//
// Strings are lifted verbatim from
// design-system/prototypes/onboarding/data.jsx and pinned by
// `tests/unit/auth/role-permissions.test.ts`. Any UI copy edit must
// happen here and pass through the snapshot test, which gives the
// design-system reviewer a stable diff target.

import type { StudioRole } from "@/lib/auth/session";

export type RolePermissionDef = {
  readonly label: string;
  readonly summary: string;
  readonly grants: readonly string[];
  readonly blocks: readonly string[];
};

export const ROLE_PERMISSIONS: Readonly<Record<StudioRole, RolePermissionDef>> = {
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

export function getRolePermissions(role: StudioRole): RolePermissionDef {
  return ROLE_PERMISSIONS[role];
}
