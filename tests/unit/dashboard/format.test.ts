import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatCurrency,
  formatPercent,
  formatServiceLabel,
  paymentMixWidths,
} from "@/lib/dashboard/format";

describe("formatCurrency", () => {
  it("renders integer dollar amounts with comma thousands", () => {
    expect(formatCurrency(1240)).toBe("$1,240");
  });

  it("renders zero as $0", () => {
    expect(formatCurrency(0)).toBe("$0");
  });
});

describe("formatPercent", () => {
  it("rounds 0.184 down to 18%", () => {
    expect(formatPercent(0.184)).toBe("18%");
  });

  it("rounds 0.185 up to 19%", () => {
    expect(formatPercent(0.185)).toBe("19%");
  });
});

describe("formatCount", () => {
  it("renders an integer count without decimals", () => {
    expect(formatCount(12)).toBe("12");
  });
});

describe("formatServiceLabel (new (names: readonly string[]) signature)", () => {
  it("(a) zero names → empty string", () => {
    expect(formatServiceLabel([])).toBe("");
  });

  it("(b) one name → that name", () => {
    expect(formatServiceLabel(["A"])).toBe("A");
  });

  it("(c) two names → 'A, B'", () => {
    expect(formatServiceLabel(["A", "B"])).toBe("A, B");
  });

  it("(d) three names → 'A, +2 more'", () => {
    expect(formatServiceLabel(["A", "B", "C"])).toBe("A, +2 more");
  });

  it("(e) five names → 'A, +4 more'", () => {
    expect(formatServiceLabel(["A", "B", "C", "D", "E"])).toBe("A, +4 more");
  });
});

describe("paymentMixWidths", () => {
  it("returns percentages summing to 100 for a happy path", () => {
    const widths = paymentMixWidths({ card: 60, cash: 30, gift: 10 }, 100);
    expect(widths).toEqual({ card: 60, cash: 30, gift: 10, neutral: 0 });
  });

  it("returns the neutral=100 branch when total is zero (FR-018)", () => {
    expect(paymentMixWidths({ card: 0, cash: 0, gift: 0 }, 0)).toEqual({
      card: 0,
      cash: 0,
      gift: 0,
      neutral: 100,
    });
  });
});
