// Vitest contract test for `validateSupplyMode` in
// `app/(studio)/settings/staff/_validation.ts`. Per data-model.md § 3.1 the
// validator accepts the three literal strings of `StaffSupplyMode` and throws
// `ValidationError("invalid_supply_mode")` for anything else.
//
// Test-first per SC-007 traceability — landed BEFORE the implementation so the
// failing red phase exists before the validator is added.

import { describe, expect, it } from "vitest";

import { ValidationError, validateSupplyMode } from "@/app/(studio)/settings/staff/_validation";

describe("validateSupplyMode", () => {
  it.each(["apply", "partial", "exempt"] as const)("accepts %s and returns it verbatim", (mode) => {
    expect(validateSupplyMode(mode)).toBe(mode);
  });

  it.each([
    "Apply", // case-sensitive
    "APPLY",
    "partial ", // trailing whitespace not trimmed
    "applyall", // legacy spelling
    "none",
    "",
  ])("rejects %j with invalid_supply_mode", (input) => {
    try {
      validateSupplyMode(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("invalid_supply_mode");
    }
  });
});
