// Audit-diff projection for the staff Server Actions.
//
// Per `data-model.md § 2.3` + `research § R3`, every `staff.updated` audit
// row carries a `payload` of shape `{ before, after, changes }` where:
//   - `changes` is the ordered list of keys that actually changed
//   - `before` is the scoped projection of the pre-edit snapshot over those keys
//   - `after`  is the scoped projection of the post-edit snapshot over those keys
//
// Mirror of `app/(studio)/services/_audit-diff.ts` (021/022 features). Kept in
// a plain TS module (NOT `"use server"`) so the contract test can import the
// constant + helper directly, and `actions.ts` can re-export without tripping
// the Next "Server Actions must be async functions" rule.
//
// Array-equality for `supply_except` uses sorted-join (Set-equality per
// research § R3) so reordering the array — common with hidden inputs that
// preserve insertion order — does NOT register as a change.

import type { StudioRole } from "@/lib/auth/session";

import type { StaffSupplyMode } from "./_types";

/**
 * The 10 mutable columns on `staff` that participate in the `changes` audit
 * field. Order matches the canonical diff order asserted in the contract
 * test — display_name → role → color_token → active → card_fee_exempt →
 * supply_mode → supply_except → service_commission_pct → tip_split_pct →
 * check_portion_cents.
 */
export const STAFF_DIFF_KEYS = [
  "display_name",
  "role",
  "color_token",
  "active",
  // 023-staff-payout-exemptions
  "card_fee_exempt",
  "supply_mode",
  "supply_except",
  // 047-payroll-page § US5 — per-tech payroll rates. Stored values:
  // *_pct are 0–1 fractions; check_portion_cents is integer cents.
  "service_commission_pct",
  "tip_split_pct",
  "check_portion_cents",
] as const;

export type StaffSnapshotKey = (typeof STAFF_DIFF_KEYS)[number];

export type StaffSnapshot = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  // 023-staff-payout-exemptions
  card_fee_exempt: boolean;
  supply_mode: StaffSupplyMode;
  supply_except: readonly string[];
  // 047-payroll-page § US5 — per-tech payroll rates. *_pct are stored as
  // 0–1 fractions; check_portion_cents is integer cents.
  service_commission_pct: number;
  tip_split_pct: number;
  check_portion_cents: number;
};

export type StaffChanges = {
  /** Scoped projection over the changed keys only. */
  before: Partial<StaffSnapshot>;
  /** Scoped projection over the changed keys only. */
  after: Partial<StaffSnapshot>;
  /** Ordered list of changed keys, in `STAFF_DIFF_KEYS` order. */
  changes: readonly StaffSnapshotKey[];
};

/**
 * True when both arrays contain the same elements regardless of order.
 * Set-equality via sorted-join per research § R3 — keeps the audit clean
 * when the UI reorders ticked rows between renders.
 */
function arraysEqualUnordered(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

/**
 * Diff two snapshots over `STAFF_DIFF_KEYS`. `supply_except` uses
 * Set-equality; every other key uses strict `!==`. Returns scoped projections
 * (`before`/`after`) containing ONLY the changed keys, plus the ordered list
 * of changed keys in `STAFF_DIFF_KEYS` order.
 */
export function buildChanges(before: StaffSnapshot, after: StaffSnapshot): StaffChanges {
  const changes: StaffSnapshotKey[] = [];
  const beforeProj: Partial<StaffSnapshot> = {};
  const afterProj: Partial<StaffSnapshot> = {};

  for (const key of STAFF_DIFF_KEYS) {
    if (key === "supply_except") {
      if (!arraysEqualUnordered(before.supply_except, after.supply_except)) {
        changes.push(key);
        beforeProj.supply_except = before.supply_except;
        afterProj.supply_except = after.supply_except;
      }
      continue;
    }
    if (before[key] !== after[key]) {
      changes.push(key);
      // Narrow assignment via key-typed copy — TypeScript can't infer that
      // `beforeProj[key] = before[key]` is type-safe across the union, so we
      // route through `Record<string, unknown>`.
      (beforeProj as Record<string, unknown>)[key] = before[key];
      (afterProj as Record<string, unknown>)[key] = after[key];
    }
  }

  return { before: beforeProj, after: afterProj, changes };
}
