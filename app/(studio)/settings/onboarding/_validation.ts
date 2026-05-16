// Field-shape validators for onboarding server actions.
//
// Mirrors `app/(studio)/settings/staff/_validation.ts` — each function
// returns the cleaned value or throws `ValidationError` with one of the
// stable `code` strings the contract's `?error=invalid_*` codes are built
// from. Server-action preludes catch `ValidationError` and redirect with
// `?error=<code>`.
//
// The STAFF_COLORS palette is duplicated from staff `_validation.ts`
// rather than imported because the staff validator exports neither the
// constant nor the type; consolidate in a later refactor (013+).

import type { StudioRole } from "@/lib/auth/session";

import type { InviteMethod, OffboardReason } from "./_types";

export type ValidationErrorCode =
  | "invalid_name"
  | "invalid_email"
  | "invalid_role"
  | "invalid_color"
  | "invalid_pin_shape"
  | "invalid_reason"
  | "invalid_invite_method"
  | "invalid_mode";

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

// Duplicated from app/(studio)/settings/staff/_validation.ts —
// consolidate in a later refactor (the staff file doesn't currently
// export the constant).
export const STAFF_COLORS: readonly string[] = [
  "--avatar-rose",
  "--avatar-blue",
  "--avatar-green",
  "--avatar-amber",
  "--avatar-purple",
  "--avatar-teal",
  "--avatar-orange",
  "--avatar-slate",
] as const;

const VALID_COLOR_TOKENS: ReadonlySet<string> = new Set(STAFF_COLORS);

const PIN_SHAPE = /^\d{4}$/;

// RFC-5322 lite: one or more non-whitespace, then '@', then more
// non-whitespace, then '.', then more non-whitespace. Sufficient for
// invite emails (the real validation is Supabase's invite call, which
// will reject malformed addresses with a useful error).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_REASONS: ReadonlySet<string> = new Set<OffboardReason>([
  "Left the salon",
  "On extended leave",
  "Role change",
  "Performance",
  "Other",
]);

const VALID_INVITE_METHODS: ReadonlySet<InviteMethod> = new Set(["magic_link", "password"]);

const VALID_MODES: ReadonlySet<string> = new Set(["quick", "thorough"]);

export function validateDisplayName(input: string): string {
  const trimmed = (input ?? "").trim();
  if (trimmed.length < 2) {
    throw new ValidationError("invalid_name");
  }
  return trimmed;
}

export function validateEmail(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!EMAIL_SHAPE.test(trimmed)) {
    throw new ValidationError("invalid_email");
  }
  return trimmed;
}

export function validateRole(input: string): StudioRole {
  if (!VALID_ROLES.has(input as StudioRole)) {
    throw new ValidationError("invalid_role");
  }
  return input as StudioRole;
}

export function validateColor(input: string): string {
  if (!VALID_COLOR_TOKENS.has(input)) {
    throw new ValidationError("invalid_color");
  }
  return input;
}

export function validatePinShape(input: string): string {
  if (!PIN_SHAPE.test(input ?? "")) {
    throw new ValidationError("invalid_pin_shape");
  }
  return input;
}

/**
 * Returns the canonical reason string, or `null` when the input is empty
 * (treated as "no reason supplied" rather than a validation error — the
 * field is optional per the offboard sheet contract).
 */
export function validateReason(input: string): OffboardReason | null {
  const trimmed = (input ?? "").trim();
  if (trimmed === "") return null;
  if (!VALID_REASONS.has(trimmed)) {
    throw new ValidationError("invalid_reason");
  }
  return trimmed as OffboardReason;
}

export function validateInviteMethod(input: string): InviteMethod {
  if (!VALID_INVITE_METHODS.has(input as InviteMethod)) {
    throw new ValidationError("invalid_invite_method");
  }
  return input as InviteMethod;
}

export function validateMode(input: string): "quick" | "thorough" {
  if (!VALID_MODES.has(input)) {
    throw new ValidationError("invalid_mode");
  }
  return input as "quick" | "thorough";
}
