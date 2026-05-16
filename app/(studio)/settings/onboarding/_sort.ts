// Onboarding roster binner + sorter. Pure function — covered by the
// E2E foundation smoke test (T029) and unit-testable in isolation if
// US7 adds search filtering.
//
// Sort rules (per FR-040..FR-044):
//   • pending  → DESC by invited_at (most recent at top)
//   • active   → role priority (owner → manager → front_desk → technician)
//                then display_name ASC
//   • offboarded → DESC by offboarded_at

import type { OnboardingUser } from "./_types";

type RoleOrder = "owner" | "manager" | "technician" | "front_desk";

const ROLE_PRIORITY: Record<RoleOrder, number> = {
  owner: 0,
  manager: 1,
  front_desk: 2,
  technician: 3,
};

export type RosterBuckets = {
  pending: OnboardingUser[];
  active: OnboardingUser[];
  offboarded: OnboardingUser[];
};

export function binAndSortRoster(
  rows: OnboardingUser[],
  viewerUserId: string | null
): RosterBuckets {
  const stamped = rows.map((r) => ({
    ...r,
    is_you: viewerUserId != null && r.user_id === viewerUserId,
  }));

  const pending = stamped
    .filter((r) => r.state === "invited")
    .sort((a, b) => (b.invited_at ?? "").localeCompare(a.invited_at ?? ""));

  const active = stamped
    .filter((r) => r.state === "active")
    .sort((a, b) => {
      const pa = ROLE_PRIORITY[a.role as RoleOrder] ?? 99;
      const pb = ROLE_PRIORITY[b.role as RoleOrder] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.display_name.localeCompare(b.display_name);
    });

  const offboarded = stamped
    .filter((r) => r.state === "offboarded")
    .sort((a, b) => (b.offboarded_at ?? "").localeCompare(a.offboarded_at ?? ""));

  return { pending, active, offboarded };
}
