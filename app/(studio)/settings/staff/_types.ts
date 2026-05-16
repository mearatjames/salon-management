// Shared type for a single roster row in the Settings → Staff surface.
// The page Server Component selects this shape from the `staff` table
// (omitting `pin_hash`) and passes it through to the client filter island
// and every row Server Component.

import type { StudioRole } from "@/lib/auth/session";

export type RosterStaff = {
  id: string;
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  created_at: string;
  /** Derived in the page Server Component: `pin_hash !== null`. */
  pin_set: boolean;
};
