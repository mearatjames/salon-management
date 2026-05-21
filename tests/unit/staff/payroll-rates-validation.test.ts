// Vitest contract test for the per-tech payroll-rate validators in
// `app/(studio)/settings/staff/_validation.ts` (047-payroll-page § US5).
//
// Per the US5 design spec the staff edit panel gains three payroll fields:
//   - service_commission_pct — a 0–100 PERCENT in the UI, stored as a 0–1
//     fraction (numeric(5,4)); the validator divides the UI value by 100.
//   - tip_split_pct — same: 0–100 in the UI, stored as a 0–1 fraction.
//   - check_portion_cents — a dollars input in the UI, stored as integer
//     cents ≥ 0.
//
// `validatePercentField` accepts the raw UI string (the form submits the
// 0–100 number) and returns the 0–1 fraction. `validateCheckPortionDollars`
// accepts the raw dollars string and returns integer cents.
//
// Test-first per Constitution IV — landed BEFORE the validators are added so
// the failing red phase exists before the implementation.

import { describe, expect, it } from "vitest";

import {
  ValidationError,
  validateCheckPortionDollars,
  validatePercentField,
} from "@/app/(studio)/settings/staff/_validation";

describe("validatePercentField", () => {
  it("accepts 0 and returns the 0 fraction", () => {
    expect(validatePercentField("0", "invalid_commission_pct")).toBe(0);
  });

  it("accepts 100 and returns the 1 fraction (upper bound)", () => {
    expect(validatePercentField("100", "invalid_commission_pct")).toBe(1);
  });

  it("divides the 0–100 UI value by 100 into a 0–1 fraction", () => {
    expect(validatePercentField("65", "invalid_commission_pct")).toBeCloseTo(0.65, 6);
    expect(validatePercentField("85", "invalid_tip_split_pct")).toBeCloseTo(0.85, 6);
  });

  it("accepts a fractional UI percentage", () => {
    expect(validatePercentField("12.5", "invalid_commission_pct")).toBeCloseTo(0.125, 6);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(validatePercentField("  50  ", "invalid_commission_pct")).toBeCloseTo(0.5, 6);
  });

  it.each(["-1", "-0.01", "100.01", "101", "250"])(
    "rejects %j as out of the 0–100 range",
    (input) => {
      try {
        validatePercentField(input, "invalid_commission_pct");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_commission_pct");
      }
    }
  );

  it.each(["", "  ", "abc", "12%", "1,000", "NaN", "Infinity", "1e2"])(
    "rejects %j as non-numeric",
    (input) => {
      try {
        validatePercentField(input, "invalid_tip_split_pct");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_tip_split_pct");
      }
    }
  );

  it("surfaces the caller-supplied error code", () => {
    try {
      validatePercentField("999", "invalid_tip_split_pct");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ValidationError).code).toBe("invalid_tip_split_pct");
    }
  });
});

describe("validateCheckPortionDollars", () => {
  it("accepts 0 dollars and returns 0 cents", () => {
    expect(validateCheckPortionDollars("0")).toBe(0);
  });

  it("converts a whole-dollar amount to integer cents", () => {
    expect(validateCheckPortionDollars("250")).toBe(25000);
  });

  it("converts a fractional-dollar amount to integer cents", () => {
    expect(validateCheckPortionDollars("12.34")).toBe(1234);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(validateCheckPortionDollars("  40  ")).toBe(4000);
  });

  it("rounds a sub-cent fraction to the nearest cent", () => {
    // 1.236 dollars → 123.6 cents → rounds up to 124.
    expect(validateCheckPortionDollars("1.236")).toBe(124);
    // 1.234 dollars → 123.4 cents → rounds down to 123.
    expect(validateCheckPortionDollars("1.234")).toBe(123);
  });

  it.each(["-1", "-0.01", "-100"])("rejects negative amount %j", (input) => {
    try {
      validateCheckPortionDollars(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("invalid_check_portion");
    }
  });

  it.each(["", "  ", "abc", "$10", "1,000", "NaN", "Infinity"])(
    "rejects non-numeric amount %j",
    (input) => {
      try {
        validateCheckPortionDollars(input);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe("invalid_check_portion");
      }
    }
  );
});
