// Field-shape validators for staff Server Actions. Each function returns
// the cleaned value on success or throws `ValidationError` with one of the
// stable `error_code` strings documented in server-actions.contract.md §
// Error codes. The Server Action prelude catches `ValidationError` and
// redirects with `?error=<code>`.
//
// Permission-matrix concerns (role-set scope, target-shape) live in
// `permissions.ts`; this file is purely shape/format validation.

import type { StudioRole } from "@/lib/auth/session";

import type { StaffSupplyMode } from "./_types";

export type ValidationErrorCode =
  | "name_too_short"
  | "invalid_role"
  | "invalid_color"
  | "invalid_pin_shape"
  // 023-staff-payout-exemptions
  | "invalid_supply_mode"
  | "invalid_supply_except_shape"
  // 047-payroll-page § US5 — per-tech payroll rate fields.
  | "invalid_commission_pct"
  | "invalid_tip_split_pct"
  | "invalid_check_portion";

export class ValidationError extends Error {
  readonly code: ValidationErrorCode;
  constructor(code: ValidationErrorCode, message?: string) {
    super(message ?? `validation: ${code}`);
    this.name = "ValidationError";
    this.code = code;
  }
}

const VALID_ROLES: ReadonlySet<StudioRole> = new Set([
  "owner",
  "manager",
  "technician",
  "front_desk",
]);

const VALID_COLOR_TOKENS: ReadonlySet<string> = new Set([
  "--avatar-rose",
  "--avatar-blue",
  "--avatar-green",
  "--avatar-amber",
  "--avatar-purple",
  "--avatar-teal",
  "--avatar-orange",
  "--avatar-slate",
]);

const PIN_SHAPE = /^\d{4}$/;

/**
 * Trim whitespace and require at least 2 non-whitespace characters. Returns
 * the trimmed value.
 */
export function validateDisplayName(input: string): string {
  const trimmed = (input ?? "").trim();
  if (trimmed.length < 2) {
    throw new ValidationError("name_too_short");
  }
  return trimmed;
}

/** Return the role if it's one of the four; otherwise throw. */
export function validateRole(input: string): StudioRole {
  if (!VALID_ROLES.has(input as StudioRole)) {
    throw new ValidationError("invalid_role");
  }
  return input as StudioRole;
}

/** Return the color token if it's one of the 8 `--avatar-*`; otherwise throw. */
export function validateColor(input: string): string {
  if (!VALID_COLOR_TOKENS.has(input)) {
    throw new ValidationError("invalid_color");
  }
  return input;
}

/** Return the PIN if it matches `/^\d{4}$/`; otherwise throw. */
export function validatePinShape(input: string): string {
  if (!PIN_SHAPE.test(input ?? "")) {
    throw new ValidationError("invalid_pin_shape");
  }
  return input;
}

// ── 023-staff-payout-exemptions ─────────────────────────────────────────

const VALID_SUPPLY_MODES: ReadonlySet<StaffSupplyMode> = new Set(["apply", "partial", "exempt"]);

/**
 * Return the supply-mode literal if it's one of the three; otherwise throw
 * `ValidationError("invalid_supply_mode")`. Case-sensitive — the UI submits
 * the literal value from a ToggleGroup so spelling/casing is fixed by the
 * source markup.
 */
export function validateSupplyMode(input: string): StaffSupplyMode {
  if (!VALID_SUPPLY_MODES.has(input as StaffSupplyMode)) {
    throw new ValidationError("invalid_supply_mode");
  }
  return input as StaffSupplyMode;
}

/** Hard cap on the supply_except array — keeps audit payloads bounded and
 *  matches the 64-entry limit documented in data-model.md § 3.2. */
const SUPPLY_EXCEPT_MAX = 64;

/**
 * When the saved supply mode is not `partial`, the persisted `supply_except`
 * MUST be empty — this mirrors the DB CHECK constraint and keeps the audit
 * diff in lockstep with what actually gets written. Used by the `updateStaff`
 * action after validation so the proposed snapshot reflects the wipe before
 * `buildChanges` runs.
 */
export function clearSupplyExceptIfWiped(
  mode: StaffSupplyMode,
  except: readonly string[]
): readonly string[] {
  return mode === "partial" ? except : [];
}

/**
 * Clean a raw `supply_except` array from FormData into the persisted shape.
 *   - Throws `invalid_supply_except_shape` if `raw` is not an array.
 *   - Drops non-string entries silently.
 *   - Trims whitespace on each entry.
 *   - Dedupes via Set (`Array.from(new Set(…))`).
 *   - Filters against `allowedIds` (FR-012 stale-tab defense — unknown ids
 *     silently dropped rather than surfaced as an error).
 *   - Truncates silently at the 64-entry cap.
 */
export function validateSupplyExcept(
  raw: readonly string[],
  allowedIds: ReadonlySet<string>
): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("invalid_supply_except_shape");
  }
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    if (!allowedIds.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
    if (cleaned.length >= SUPPLY_EXCEPT_MAX) break;
  }
  return cleaned;
}

// ── 047-payroll-page § US5 — per-tech payroll rates ──────────────────────
//
// The staff edit panel gains three payroll fields. The UI submits
// human-friendly values (percentages 0–100, dollars); the validators below
// convert them to the storage shape and reject anything out of range or
// non-numeric. Permission scoping (owner-only) lives in `permissions.ts` and
// `actions.ts` — this file is purely shape/format validation per the module
// contract above.

/**
 * Parse a strict decimal number from a raw FormData string. Returns the
 * finite number on success or `null` for anything that is not a plain decimal
 * literal — empty/whitespace, `NaN`/`Infinity`, currency/grouping symbols, or
 * exponent notation. Stricter than `Number()` so `"1e2"`, `"1,000"`, `"$10"`
 * and `"  "` all fail rather than silently coercing.
 */
function parseStrictDecimal(input: string): number | null {
  const trimmed = (input ?? "").trim();
  // Plain decimal: optional sign, digits, optional fractional part. No
  // exponent, no thousands separators, no currency symbols.
  if (!/^-?\d*\.?\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Validate one of the two percentage rate fields (`service_commission_pct`,
 * `tip_split_pct`). The UI submits a 0–100 percentage; this returns the value
 * as a 0–1 fraction for storage (`numeric(5,4)`). Rejects non-numeric input
 * and values outside the 0–100 range with the caller-supplied error code.
 */
export function validatePercentField(
  input: string,
  code: Extract<ValidationErrorCode, "invalid_commission_pct" | "invalid_tip_split_pct">
): number {
  const value = parseStrictDecimal(input);
  if (value === null || value < 0 || value > 100) {
    throw new ValidationError(code);
  }
  return value / 100;
}

/**
 * Validate the check-portion field. The UI submits a dollars amount; this
 * returns the value as non-negative integer cents (rounded to the nearest
 * cent). Rejects non-numeric input and negative amounts with
 * `invalid_check_portion`.
 */
export function validateCheckPortionDollars(input: string): number {
  const dollars = parseStrictDecimal(input);
  if (dollars === null || dollars < 0) {
    throw new ValidationError("invalid_check_portion");
  }
  return Math.round(dollars * 100);
}
