// App-layer types for the services-catalog surface
// (per `specs/008-services-catalog/data-model.md § 3`).
//
// These types are the shape of the props passed from the page Server
// Component into the catalog list + drawer client islands, and the shape
// the Server Actions expect after validation. They do NOT mirror the
// generated Supabase `Row` shape verbatim — the page query joins in
// `assignment_count` and the helpers narrow `color_token` to the avatar
// palette so callers don't carry the `string` from the DB everywhere.

import type { StudioRole } from "@/lib/auth/session";

export type AvatarColorToken =
  | "--avatar-rose"
  | "--avatar-blue"
  | "--avatar-green"
  | "--avatar-amber"
  | "--avatar-purple"
  | "--avatar-teal"
  | "--avatar-orange"
  | "--avatar-slate";

// Row shape returned by the page's hot read query (used by the list).
export type CatalogService = {
  id: string;
  name: string;
  category: string;
  duration_min: number;
  price_cents: number;
  color_token: AvatarColorToken;
  taxable: boolean;
  active: boolean;
  variable_price: boolean;
  price_from_cents: number | null;
  price_to_cents: number | null;
  variable_price_note: string | null;
  // Aggregated server-side; assignment_count counts active, non-removed staff only.
  assignment_count: number;
};

// Per-tech assignment row inside the edit drawer's draft.
export type ServiceAssignment = {
  staff_id: string;
  duration_min_override: number | null;
};

// Full drawer baseline for an existing service (Edit mode).
export type ServiceDraftBaseline = CatalogService & {
  assignments: ServiceAssignment[];
};

// Active staff row used by the staff-assignment list. Mirrors the
// existing staff page's roster projection minus the PIN columns.
export type AssignableStaff = {
  id: string;
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: true;
};
