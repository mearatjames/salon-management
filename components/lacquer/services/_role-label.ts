// Shared role label table for the services drawer's staff-assignment list.
// Mirrors the same map used by the staff feature so role chips render the
// same human label everywhere.

import type { StudioRole } from "@/lib/auth/session";

export const ROLE_LABEL: Record<StudioRole, string> = {
  owner: "Owner",
  manager: "Manager",
  technician: "Tech",
  front_desk: "Front desk",
};
