// Field-shape validators for the services-catalog Server Actions. Each
// function returns the cleaned value on success or throws `ValidationError`
// with one of the stable error codes documented in
// `contracts/server-actions.contract.md § 6`. The Server Action prelude
// catches `ValidationError` and redirects with `?error=<code>`.
//
// Permission-matrix concerns live in `permissions.ts`; this file is purely
// shape/format validation.

import type { CardFeeMode } from "./_types";

export type ValidationErrorCode =
  | "name_too_short"
  | "category_required"
  | "invalid_duration"
  | "invalid_price"
  | "invalid_bound"
  | "bounds_inverted"
  | "invalid_color"
  | "invalid_override"
  | "not_found"
  // 021-services-deductions
  | "invalid_card_fee_mode"
  | "invalid_card_fee_custom"
  | "card_fee_custom_too_large"
  | "invalid_supply_amount"
  | "supply_amount_too_large"
  // 022-supply-types-catalog (services-side: picker submits supply_type_id)
  | "invalid_supply_type"
  // 022-supply-types-catalog (policy-side: catalog actions share this class)
  | "name_too_long"
  | "name_taken"
  | "type_not_found"
  | "type_in_use"
  | "type_already_active"
  | "type_already_archived"
  | "type_archived";

export class ValidationError extends Error {
  readonly code: ValidationErrorCode;
  constructor(code: ValidationErrorCode, message?: string) {
    super(message ?? `validation: ${code}`);
    this.name = "ValidationError";
    this.code = code;
  }
}

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

// Matches `xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx` (case-insensitive). We
// accept the broad v4-ish shape since gen_random_uuid() output matches.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Non-negative decimal with ≤ 2 fractional digits. Disallows leading `+`,
// scientific notation, multiple dots, or a lone dot.
const NON_NEG_DOLLARS = /^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/;

// Positive integer (whole minutes).
const POS_INT = /^\d+$/;

function readString(input: unknown): string {
  if (input === undefined || input === null) return "";
  return String(input);
}

/**
 * Trim whitespace and require at least 2 non-whitespace characters.
 * Returns the trimmed value.
 */
export function validateName(input: string): string {
  const trimmed = readString(input).trim();
  if (trimmed.length < 2) {
    throw new ValidationError("name_too_short");
  }
  return trimmed;
}

/** Trim whitespace and require at least one character. Returns the trimmed value. */
export function validateCategory(input: string): string {
  const trimmed = readString(input).trim();
  if (trimmed.length < 1) {
    throw new ValidationError("category_required");
  }
  return trimmed;
}

/** Positive integer minutes. */
export function validateDurationMin(input: string): number {
  const raw = readString(input).trim();
  if (!POS_INT.test(raw)) {
    throw new ValidationError("invalid_duration");
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("invalid_duration");
  }
  return n;
}

/**
 * Convert a non-negative decimal-dollars string with ≤ 2 fractional digits
 * to integer cents. Used for the fixed-price field.
 */
export function validateFixedPriceDollars(input: string): number {
  const raw = readString(input).trim();
  if (!NON_NEG_DOLLARS.test(raw)) {
    throw new ValidationError("invalid_price");
  }
  // Multiply via string padding to avoid float drift (45.50 * 100 → 4549.999…).
  const [dollarsPart, centsPartRaw = ""] = raw.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0");
  const cents = parseInt(centsPart || "0", 10);
  const result = dollars * 100 + cents;
  if (!Number.isFinite(result) || result < 0) {
    throw new ValidationError("invalid_price");
  }
  return result;
}

/**
 * Same shape as `validateFixedPriceDollars` but allows empty input → null.
 * Used for the variable-price bounds.
 */
export function validateBoundDollars(input: string): number | null {
  const raw = readString(input).trim();
  if (raw.length === 0) return null;
  if (!NON_NEG_DOLLARS.test(raw)) {
    throw new ValidationError("invalid_bound");
  }
  const [dollarsPart, centsPartRaw = ""] = raw.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0");
  const cents = parseInt(centsPart || "0", 10);
  const result = dollars * 100 + cents;
  if (!Number.isFinite(result) || result < 0) {
    throw new ValidationError("invalid_bound");
  }
  return result;
}

/**
 * When both bounds are set, `to >= from`. Either bound nullable is fine.
 */
export function validateBoundsConsistency(fromCents: number | null, toCents: number | null): void {
  if (fromCents === null || toCents === null) return;
  if (toCents < fromCents) {
    throw new ValidationError("bounds_inverted");
  }
}

/** Return the color token if it's one of the 8 `--avatar-*`; otherwise throw. */
export function validateColor(input: string): string {
  const raw = readString(input);
  if (!VALID_COLOR_TOKENS.has(raw)) {
    throw new ValidationError("invalid_color");
  }
  return raw;
}

/**
 * Per-tech duration override: nullable; when present, positive integer
 * minutes.
 */
export function validateOverrideMin(input: string): number | null {
  const raw = readString(input).trim();
  if (raw.length === 0) return null;
  if (!POS_INT.test(raw)) {
    throw new ValidationError("invalid_override");
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("invalid_override");
  }
  return n;
}

/** UUID shape check. Throws `not_found` to feed the redirect's error param. */
export function validateUuid(input: string): string {
  const raw = readString(input).trim();
  if (!UUID_SHAPE.test(raw)) {
    throw new ValidationError("not_found");
  }
  return raw;
}

// ── 021-services-deductions ────────────────────────────────────────────

const VALID_CARD_FEE_MODES: ReadonlySet<CardFeeMode> = new Set(["default", "custom", "exempt"]);

/** Shared cents-from-dollars conversion (string-padding, no float math).
 *  Returns the integer cents value when `raw` matches `NON_NEG_DOLLARS`,
 *  else `null` (caller throws the appropriate code). */
function parseNonNegCents(raw: string): number | null {
  if (!NON_NEG_DOLLARS.test(raw)) return null;
  const [dollarsPart, centsPartRaw = ""] = raw.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0");
  const cents = parseInt(centsPart || "0", 10);
  const result = dollars * 100 + cents;
  if (!Number.isFinite(result) || result < 0) return null;
  return result;
}

/** $50 in cents — the per-service cap for both card-fee custom + supply. */
const DEDUCTION_MAX_CENTS = 5000;

/** Card-fee mode is one of `default` / `custom` / `exempt` (case-sensitive,
 *  no trim — the form posts a controlled value from the segmented control). */
export function validateCardFeeMode(input: string): CardFeeMode {
  // No trim, no case fold — the form is a radio group; an unexpected
  // shape means the FormData was tampered with.
  if (!VALID_CARD_FEE_MODES.has(input as CardFeeMode)) {
    throw new ValidationError("invalid_card_fee_mode");
  }
  return input as CardFeeMode;
}

/** Custom card-fee dollars: `[0, 50]` with ≤ 2 fractional digits. */
export function validateCardFeeCustomDollars(input: string): number {
  const raw = readString(input).trim();
  const cents = parseNonNegCents(raw);
  if (cents === null) {
    throw new ValidationError("invalid_card_fee_custom");
  }
  if (cents > DEDUCTION_MAX_CENTS) {
    throw new ValidationError("card_fee_custom_too_large");
  }
  return cents;
}

/** Supply amount dollars: strictly positive `(0, 50]` with ≤ 2 fractional digits. */
export function validateSupplyAmountDollars(input: string): number {
  const raw = readString(input).trim();
  const cents = parseNonNegCents(raw);
  if (cents === null || cents <= 0) {
    throw new ValidationError("invalid_supply_amount");
  }
  if (cents > DEDUCTION_MAX_CENTS) {
    throw new ValidationError("supply_amount_too_large");
  }
  return cents;
}

// ── 022-supply-types-catalog ────────────────────────────────────────────

/**
 * Supply type id (UUID-loose shape). The DB FK on
 * `services.supply_type_id` is the real identity check; this validator
 * just filters bogus form payloads early. Mirrors the loose 8-4-4-4-12
 * hex pattern used by `parseStaffAssignments` in `actions.ts`.
 */
export function validateSupplyTypeId(input: string): string {
  const trimmed = readString(input).trim();
  if (!UUID_SHAPE_LOOSE.test(trimmed)) {
    throw new ValidationError("invalid_supply_type");
  }
  return trimmed;
}

// Mirrors `UUID_SHAPE_LOOSE` in `actions.ts` (kept local here so the
// validator doesn't reach across the boundary into the action file).
const UUID_SHAPE_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
