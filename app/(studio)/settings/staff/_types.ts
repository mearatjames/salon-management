// Shared type for a single roster row in the Settings → Staff surface.
// The page Server Component selects this shape from the `staff` table
// (omitting `pin_hash`) and passes it through to the client filter island
// and every row Server Component.

import type { StudioRole } from "@/lib/auth/session";

/**
 * 023-staff-payout-exemptions § 2.1 — per-staff supply-deduction posture.
 *   - "apply": all supply costs deducted from payout (default).
 *   - "partial": deduct except for the types listed in `supply_except`.
 *   - "exempt": no supply costs deducted.
 */
export type StaffSupplyMode = "apply" | "partial" | "exempt";

export type RosterStaff = {
  id: string;
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  created_at: string;
  /** Derived in the page Server Component: `pin_hash !== null`. */
  pin_set: boolean;
  /** 023-staff-payout-exemptions: tech keeps full payout on card-paid services. */
  card_fee_exempt: boolean;
  /** 023-staff-payout-exemptions: per-staff supply-deduction posture. */
  supply_mode: StaffSupplyMode;
  /** 023-staff-payout-exemptions: when `supply_mode === 'partial'`, the
   *  supply_type ids exempted from deduction. Always `[]` in other modes
   *  (DB CHECK constraint `staff_supply_except_empty_unless_partial_chk`). */
  supply_except: readonly string[];
};
