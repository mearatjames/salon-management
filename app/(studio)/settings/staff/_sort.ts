// Roster sort comparator — pure, used by both the server (mirrors the SQL
// `ORDER BY` shape from data-model.md § 6 invariant 8) and the client
// filter island (so client-side filtering preserves the canonical order).
//
// role_priority: owner=0, manager=1, technician=2, front_desk=3.
// Secondary: display_name case-insensitive ASC.

import type { StudioRole } from "@/lib/auth/session";

import type { RosterStaff } from "./_types";

export type { RosterStaff };

export const ROLE_PRIORITY: Record<StudioRole, number> = {
  owner: 0,
  manager: 1,
  technician: 2,
  front_desk: 3,
};

export function compareStaff(a: RosterStaff, b: RosterStaff): number {
  const pa = ROLE_PRIORITY[a.role];
  const pb = ROLE_PRIORITY[b.role];
  if (pa !== pb) return pa - pb;
  const na = a.display_name.toLowerCase();
  const nb = b.display_name.toLowerCase();
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

/** Non-mutating sort. */
export function sortStaff(rows: readonly RosterStaff[]): RosterStaff[] {
  return [...rows].sort(compareStaff);
}
