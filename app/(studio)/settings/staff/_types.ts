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
  /** Issue #129 — `user_id !== null` distinguishes a logged-in staff member
   *  (app-user) from a kiosk-only tech (PIN-only). The Edit panel's
   *  DangerZone uses this to pick the right "Remove from roster" ceremony:
   *  owner-only rich confirm + auth-user delete for app-users, single
   *  confirm + soft-delete for PIN-only. The page Server Component derives
   *  it from `staff.user_id IS NOT NULL`. */
  is_app_user: boolean;
  /** Issue #129 — surfaced in the app-user confirm dialog so the operator
   *  can verify which account they're about to delete. Null when the staff
   *  row has no associated email (PIN-only). */
  email: string | null;
  /** 023-staff-payout-exemptions: tech keeps full payout on card-paid services. */
  card_fee_exempt: boolean;
  /** 023-staff-payout-exemptions: per-staff supply-deduction posture. */
  supply_mode: StaffSupplyMode;
  /** 023-staff-payout-exemptions: when `supply_mode === 'partial'`, the
   *  supply_type ids exempted from deduction. Always `[]` in other modes
   *  (DB CHECK constraint `staff_supply_except_empty_unless_partial_chk`). */
  supply_except: readonly string[];
  /** 047-payroll-page § US5: share of service income the tech keeps, stored
   *  as a 0–1 fraction (`numeric(5,4)`). The Payroll ledger applies it to
   *  commissionable income. */
  service_commission_pct: number;
  /** 047-payroll-page § US5: share of the tech's card tips they keep, stored
   *  as a 0–1 fraction. */
  tip_split_pct: number;
  /** 047-payroll-page § US5: the dollar amount paid each period by physical
   *  check as W-2 wage, stored as integer cents. */
  check_portion_cents: number;
};
