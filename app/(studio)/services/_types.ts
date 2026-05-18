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

// Per-service card-fee mode (021-services-deductions, data-model.md § 2.1).
//   - 'default': the salon-wide $3 card fee applies on card payments.
//   - 'custom':  a per-service override in `card_fee_custom_cents` applies.
//   - 'exempt':  no card fee is ever charged for this service.
export type CardFeeMode = "default" | "custom" | "exempt";

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
  // 021-services-deductions: per-service deduction metadata. The pair
  // `(card_fee_mode, card_fee_custom_cents)` is constrained at the DB
  // layer to either `('custom', int)` or `(<other>, null)`; the pair
  // `(supply_amount_cents, supply_label)` is both-or-neither.
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  supply_amount_cents: number | null;
  supply_label: string | null;
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
