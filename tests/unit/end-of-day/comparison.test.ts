// Unit tests for `deriveComparison`.
//
// Extracted from `components/lacquer/eod/cash-count.client.tsx` into the
// pure module `lib/end-of-day/comparison.ts` (T010) so the cash-count
// island and the new edit-form island can share a single math source.
//
// Written BEFORE the extraction per Principle IV (Test-First for
// Critical Paths). T010 makes these pass.

import { describe, expect, it } from "vitest";

import { deriveComparison } from "@/lib/end-of-day/comparison";

describe("deriveComparison", () => {
  it("returns hasCounted=false / state='' for an empty counted string", () => {
    const r = deriveComparison("", 16450);
    expect(r.hasCounted).toBe(false);
    expect(r.state).toBe("");
    expect(r.countedCents).toBe(0);
    expect(r.diff).toBe(0);
    expect(r.isMatch).toBe(false);
    expect(r.isOver).toBe(false);
    expect(r.isShort).toBe(false);
    expect(r.hasDiff).toBe(false);
  });

  it("returns state='match' when counted equals expected", () => {
    const r = deriveComparison("164.50", 16450);
    expect(r.state).toBe("match");
    expect(r.diff).toBe(0);
    expect(r.isMatch).toBe(true);
    expect(r.hasDiff).toBe(false);
    expect(r.countedCents).toBe(16450);
  });

  it("returns state='over' / isOver=true / positive diff when counted > expected", () => {
    const r = deriveComparison("170.00", 16450);
    expect(r.state).toBe("over");
    expect(r.isOver).toBe(true);
    expect(r.isShort).toBe(false);
    expect(r.diff).toBeGreaterThan(0);
    expect(r.diff).toBe(550);
    expect(r.hasDiff).toBe(true);
  });

  it("returns state='short' / isShort=true / negative diff when counted < expected", () => {
    const r = deriveComparison("160.00", 16450);
    expect(r.state).toBe("short");
    expect(r.isShort).toBe(true);
    expect(r.isOver).toBe(false);
    expect(r.diff).toBeLessThan(0);
    expect(r.diff).toBe(-450);
    expect(r.hasDiff).toBe(true);
  });

  it("rounds floating-point multiplication so '114.99' maps to 11499 cents (no off-by-one)", () => {
    // Defends the Math.round(parseFloat(counted) * 100) rule —
    // parseFloat("114.99") * 100 yields 11498.999999999998 in IEEE 754.
    const r = deriveComparison("114.99", 11499);
    expect(r.countedCents).toBe(11499);
    expect(r.state).toBe("match");
    expect(r.diff).toBe(0);
  });
});
