// Vitest contract test for the policy + services validators.
//
// Covers `contracts/server-actions.contract.md § 1, 2` validators:
//   - `validateSupplyTypeName` in `app/(studio)/settings/policy/_validation.ts`
//   - `validateSupplyTypeId` in `app/(studio)/services/_validation.ts`
//
// Tests written per Constitution IV (test-first for validators that
// gate audit-emitting Server Actions).

import { describe, expect, it } from "vitest";

import { validateSupplyTypeName } from "@/app/(studio)/settings/policy/_validation";
import { validateSupplyTypeId, ValidationError } from "@/app/(studio)/services/_validation";

describe("validateSupplyTypeName", () => {
  it("accepts canonical-shape names", () => {
    expect(validateSupplyTypeName("GelX")).toBe("GelX");
    expect(validateSupplyTypeName("GelX tips")).toBe("GelX tips");
    expect(validateSupplyTypeName("AB")).toBe("AB");
    expect(validateSupplyTypeName("a".repeat(64))).toBe("a".repeat(64));
  });

  it("trims and collapses internal whitespace, preserving case", () => {
    expect(validateSupplyTypeName("  GelX  tips  ")).toBe("GelX tips");
  });

  it("throws name_too_short for empty / whitespace-only / 1-char (post-trim)", () => {
    for (const bad of ["", " ", "A", "  A  "]) {
      try {
        validateSupplyTypeName(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("name_too_short");
      }
    }
  });

  it("throws name_too_long for > 64 chars (post-trim/collapse)", () => {
    try {
      validateSupplyTypeName("a".repeat(65));
      throw new Error("expected throw for 65-char name");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("name_too_long");
    }
  });
});

describe("validateSupplyTypeId", () => {
  it("accepts loose UUID shapes (8-4-4-4-12 hex)", () => {
    expect(validateSupplyTypeId("10000000-0000-0000-0000-000000000001")).toBe(
      "10000000-0000-0000-0000-000000000001"
    );
    expect(validateSupplyTypeId("a1f0b3a4-1234-4abc-89ab-1234567890ab")).toBe(
      "a1f0b3a4-1234-4abc-89ab-1234567890ab"
    );
  });

  it("throws invalid_supply_type for empty / malformed", () => {
    for (const bad of ["", "abc", "10000000-0000-0000-0000"]) {
      try {
        validateSupplyTypeId(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_supply_type");
      }
    }
  });
});
