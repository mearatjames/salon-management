// Roster filter helper — case-insensitive substring match on `display_name`,
// plus the show-inactive toggle. Pure, used by the client filter island.

import type { RosterStaff } from "./_types";

export type { RosterStaff };

export function filterStaff(
  rows: readonly RosterStaff[],
  query: string,
  showInactive: boolean
): RosterStaff[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (!showInactive && !row.active) return false;
    if (needle.length === 0) return true;
    return row.display_name.toLowerCase().includes(needle);
  });
}
