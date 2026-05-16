// Field-shape validators for the services-catalog Server Actions. Each
// function returns the cleaned value on success or throws `ValidationError`
// with one of the stable error codes documented in
// `contracts/server-actions.contract.md § 6`. The Server Action prelude
// catches `ValidationError` and redirects with `?error=<code>`.
//
// Permission-matrix concerns live in `permissions.ts`; this file is purely
// shape/format validation.

export type ValidationErrorCode =
  | "name_too_short"
  | "category_required"
  | "invalid_duration"
  | "invalid_price"
  | "invalid_bound"
  | "bounds_inverted"
  | "invalid_color"
  | "invalid_override"
  | "not_found";

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
