// Vitest contract test for the services catalog validators
// (`app/(studio)/services/_validation.ts`). Covers every validator
// and edge case from `specs/008-services-catalog/data-model.md § 4`.

import { describe, expect, it } from "vitest";

import {
  validateBoundDollars,
  validateBoundsConsistency,
  validateCardFeeCustomDollars,
  validateCardFeeMode,
  validateCategory,
  validateColor,
  validateDurationMin,
  validateFixedPriceDollars,
  validateName,
  validateOverrideMin,
  validateSupplyAmountDollars,
  validateUuid,
  ValidationError,
} from "@/app/(studio)/services/_validation";

describe("validateName", () => {
  it("trims and returns when length >= 2", () => {
    expect(validateName("  Gel  ")).toBe("Gel");
    expect(validateName("Aa")).toBe("Aa");
    expect(validateName("Manicúre")).toBe("Manicúre");
  });

  it("throws name_too_short for empty / whitespace-only / 1-char", () => {
    for (const bad of ["", "   ", "A", " A "]) {
      try {
        validateName(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("name_too_short");
      }
    }
  });
});

describe("validateCategory", () => {
  it("trims and returns when non-empty", () => {
    expect(validateCategory("  Manicure  ")).toBe("Manicure");
    expect(validateCategory("a")).toBe("a");
    // Mixed-case is preserved at the validator layer — the sort layer
    // collapses case for grouping.
    expect(validateCategory("MaNiCuRe")).toBe("MaNiCuRe");
  });

  it("throws category_required for empty / whitespace-only", () => {
    for (const bad of ["", "   ", "\t \n"]) {
      try {
        validateCategory(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("category_required");
      }
    }
  });
});

describe("validateDurationMin", () => {
  it("accepts a positive integer string", () => {
    expect(validateDurationMin("30")).toBe(30);
    expect(validateDurationMin("1")).toBe(1);
    expect(validateDurationMin(" 45 ")).toBe(45);
  });

  it("rejects 0, negative, non-integer, NaN", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "", "  ", "NaN"]) {
      try {
        validateDurationMin(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_duration");
      }
    }
  });
});

describe("validateFixedPriceDollars", () => {
  it("converts non-negative decimals (≤ 2 fractional) to cents", () => {
    expect(validateFixedPriceDollars("0")).toBe(0);
    expect(validateFixedPriceDollars("45")).toBe(4500);
    expect(validateFixedPriceDollars("45.5")).toBe(4550);
    expect(validateFixedPriceDollars("45.50")).toBe(4550);
    expect(validateFixedPriceDollars("0.99")).toBe(99);
    expect(validateFixedPriceDollars(" 10.00 ")).toBe(1000);
  });

  it("rejects negative, NaN, > 2 fractional, missing", () => {
    for (const bad of ["-1", "-0.01", "abc", "", "  ", "1.234", "1..2", ".", "."]) {
      try {
        validateFixedPriceDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_price");
      }
    }
  });
});

describe("validateBoundDollars", () => {
  it("returns null for empty / whitespace-only", () => {
    expect(validateBoundDollars("")).toBeNull();
    expect(validateBoundDollars("  ")).toBeNull();
    expect(validateBoundDollars(undefined as unknown as string)).toBeNull();
  });

  it("converts a non-negative decimal to cents", () => {
    expect(validateBoundDollars("20")).toBe(2000);
    expect(validateBoundDollars("0")).toBe(0);
    expect(validateBoundDollars("60.50")).toBe(6050);
  });

  it("throws invalid_bound for negative / NaN / > 2 fractional", () => {
    for (const bad of ["-1", "abc", "1.234"]) {
      try {
        validateBoundDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_bound");
      }
    }
  });
});

describe("validateBoundsConsistency", () => {
  it("accepts only-from, only-to, neither", () => {
    expect(() => validateBoundsConsistency(2000, null)).not.toThrow();
    expect(() => validateBoundsConsistency(null, 6000)).not.toThrow();
    expect(() => validateBoundsConsistency(null, null)).not.toThrow();
  });

  it("accepts both bounds when to >= from (incl. equal)", () => {
    expect(() => validateBoundsConsistency(2000, 6000)).not.toThrow();
    expect(() => validateBoundsConsistency(3000, 3000)).not.toThrow();
  });

  it("throws bounds_inverted when to < from", () => {
    try {
      validateBoundsConsistency(6000, 2000);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ValidationError).code).toBe("bounds_inverted");
    }
  });
});

describe("validateColor", () => {
  const VALID = [
    "--avatar-rose",
    "--avatar-blue",
    "--avatar-green",
    "--avatar-amber",
    "--avatar-purple",
    "--avatar-teal",
    "--avatar-orange",
    "--avatar-slate",
  ];

  it.each(VALID)("accepts %s", (token) => {
    expect(validateColor(token)).toBe(token);
  });

  it("throws invalid_color for unknown tokens", () => {
    for (const bad of ["", "--avatar-unknown", "--accent-rose", "rose", "  "]) {
      try {
        validateColor(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_color");
      }
    }
  });
});

describe("validateOverrideMin", () => {
  it("returns null for empty / whitespace-only", () => {
    expect(validateOverrideMin("")).toBeNull();
    expect(validateOverrideMin("  ")).toBeNull();
    expect(validateOverrideMin(undefined as unknown as string)).toBeNull();
  });

  it("returns positive integer minutes", () => {
    expect(validateOverrideMin("30")).toBe(30);
    expect(validateOverrideMin(" 75 ")).toBe(75);
  });

  it("throws invalid_override for 0, negative, non-integer, NaN", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "NaN"]) {
      try {
        validateOverrideMin(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_override");
      }
    }
  });
});

// ── 021-services-deductions validators ──────────────────────────────────

describe("validateCardFeeMode", () => {
  it.each(["default", "custom", "exempt"] as const)("accepts %s", (mode) => {
    expect(validateCardFeeMode(mode)).toBe(mode);
  });

  it("rejects empty / unknown / wrong-case / padded values", () => {
    for (const bad of ["", "DEFAULT", "other", "  custom  ", "Default", "exemPt"]) {
      try {
        validateCardFeeMode(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_card_fee_mode");
      }
    }
  });
});

describe("validateCardFeeCustomDollars", () => {
  it("accepts zero (allowed for waived cards) and converts to 0 cents", () => {
    expect(validateCardFeeCustomDollars("0")).toBe(0);
    expect(validateCardFeeCustomDollars("0.00")).toBe(0);
  });

  it("converts non-negative decimals (≤ 2 fractional) up to $50 to cents", () => {
    expect(validateCardFeeCustomDollars("4")).toBe(400);
    expect(validateCardFeeCustomDollars("4.5")).toBe(450);
    expect(validateCardFeeCustomDollars("4.50")).toBe(450);
    expect(validateCardFeeCustomDollars("50")).toBe(5000);
    expect(validateCardFeeCustomDollars("50.00")).toBe(5000);
  });

  it("throws invalid_card_fee_custom for empty / negative / NaN / > 2 fractional", () => {
    for (const bad of ["", "-1", "abc", "4.501", "  ", "1.234"]) {
      try {
        validateCardFeeCustomDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_card_fee_custom");
      }
    }
  });

  it("throws card_fee_custom_too_large for > $50", () => {
    for (const bad of ["50.01", "60", "500"]) {
      try {
        validateCardFeeCustomDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("card_fee_custom_too_large");
      }
    }
  });
});

describe("validateSupplyAmountDollars", () => {
  it("accepts strictly positive amounts (0, $50] and converts to cents", () => {
    expect(validateSupplyAmountDollars("0.01")).toBe(1);
    expect(validateSupplyAmountDollars("5")).toBe(500);
    expect(validateSupplyAmountDollars("5.00")).toBe(500);
    expect(validateSupplyAmountDollars("50")).toBe(5000);
  });

  it("throws invalid_supply_amount for empty / zero / negative / NaN", () => {
    for (const bad of ["", "0", "0.0", "0.00", "-1", "abc", "  "]) {
      try {
        validateSupplyAmountDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("invalid_supply_amount");
      }
    }
  });

  it("throws supply_amount_too_large for > $50", () => {
    for (const bad of ["50.01", "60", "500"]) {
      try {
        validateSupplyAmountDollars(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("supply_amount_too_large");
      }
    }
  });
});

describe("validateUuid", () => {
  it("accepts a v4-shaped UUID", () => {
    const uuid = "a1f0b3a4-1234-4abc-89ab-1234567890ab";
    expect(validateUuid(uuid)).toBe(uuid);
  });

  it("throws not_found for malformed", () => {
    for (const bad of ["", "abc", "not-a-uuid", "a1f0b3a41234abc89ab1234567890ab"]) {
      try {
        validateUuid(bad);
        throw new Error(`expected throw for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect((err as ValidationError).code).toBe("not_found");
      }
    }
  });
});
