// Field-shape validators for the supply-types catalog Server Actions.
//
// Mirrors the convention from `app/(studio)/services/_validation.ts`:
// each function returns the cleaned value on success or throws
// `ValidationError` with one of the stable error codes documented in
// `contracts/server-actions.contract.md § 1`.
//
// Re-exports `ValidationError` from the services validator module so both
// surfaces share one error class — the action prelude can catch a single
// type regardless of which validator threw.

import { ValidationError } from "../../services/_validation";

export type SupplyTypeValidationErrorCode =
  | "name_too_short"
  | "name_too_long"
  | "name_taken"
  | "type_not_found"
  | "type_in_use"
  | "type_already_active"
  | "type_already_archived"
  | "type_archived";

export { ValidationError };

const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 64;

function readString(input: unknown): string {
  if (input === undefined || input === null) return "";
  return String(input);
}

/**
 * Trim whitespace, collapse internal whitespace runs to a single space,
 * and enforce length ∈ [2, 64]. Returns the display-form string (preserves
 * the operator's original casing). The case-insensitive uniqueness check
 * happens at the DB layer via `supply_types.name_canonical`.
 *
 * `name_taken` is NOT thrown by this validator — it's mapped from
 * Postgres `23505` on the partial unique index inside the actions.
 */
export function validateSupplyTypeName(input: string): string {
  const collapsed = readString(input).trim().replace(/\s+/g, " ");
  if (collapsed.length < NAME_MIN_LEN) {
    throw new ValidationError("name_too_short");
  }
  if (collapsed.length > NAME_MAX_LEN) {
    throw new ValidationError("name_too_long");
  }
  return collapsed;
}
