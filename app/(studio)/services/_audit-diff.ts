// Audit-diff projection for the services-catalog Server Actions.
//
// Per `contracts/audit-payload.contract.md § 5`, every `service.updated`
// audit row carries a `payload.changes` map whose keys are exactly the
// mutable columns this module enumerates. Keeping the constant + the
// diff helper in a plain TS module (NOT a `"use server"` file) lets us
//   (a) import them from the contract test (`tests/unit/services/
//       audit-diff-keys.test.ts`), and
//   (b) re-export them from `actions.ts` without tripping the Next
//       "Server Actions must be async functions" rule (every named
//       export from a `"use server"` module is required to be an async
//       function — `SERVICE_DIFF_KEYS` and `buildChanges` are not).
//
// 021-services-deductions § Phase 3 root-cause fix: moved here from
// `actions.ts` where the previous T016 placement broke the Next build.

import type { CardFeeMode } from "./_types";

/**
 * The 14 mutable columns on `services` that participate in the
 * `changes` audit field. `active` is part of the snapshot but never
 * differs (archive/restore are separate verbs).
 */
export const SERVICE_DIFF_KEYS = [
  "name",
  "category",
  "duration_min",
  "price_cents",
  "color_token",
  "taxable",
  "variable_price",
  "price_from_cents",
  "price_to_cents",
  "variable_price_note",
  // 021-services-deductions
  "card_fee_mode",
  "card_fee_custom_cents",
  "supply_amount_cents",
  // 022-supply-types-catalog — swapped from "supply_label" to the FK.
  "supply_type_id",
] as const;

export type ServiceDiffSnapshot = {
  name: string;
  category: string;
  duration_min: number;
  price_cents: number;
  color_token: string;
  taxable: boolean;
  variable_price: boolean;
  price_from_cents: number | null;
  price_to_cents: number | null;
  variable_price_note: string | null;
  // 021-services-deductions
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  supply_amount_cents: number | null;
  // 022-supply-types-catalog
  supply_type_id: string | null;
};

/** Build the `changes` map for the audit payload — only fields whose value
 *  actually changed; each entry `[before, after]`. */
export function buildChanges(
  before: ServiceDiffSnapshot,
  after: ServiceDiffSnapshot
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of SERVICE_DIFF_KEYS) {
    if (before[key] !== after[key]) {
      changes[key] = [before[key], after[key]];
    }
  }
  return changes;
}
