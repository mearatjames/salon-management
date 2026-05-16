// Field-shape validators for staff Server Actions. Each function returns
// the cleaned value on success or throws `ValidationError` with one of the
// stable `error_code` strings documented in server-actions.contract.md §
// Error codes. The Server Action prelude catches `ValidationError` and
// redirects with `?error=<code>`.
//
// Permission-matrix concerns (role-set scope, target-shape) live in
// `permissions.ts`; this file is purely shape/format validation.

import type { StudioRole } from "@/lib/auth/session";

export type ValidationErrorCode =
  | "name_too_short"
  | "invalid_role"
  | "invalid_color"
  | "invalid_pin_shape";

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
