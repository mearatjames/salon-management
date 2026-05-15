import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatCurrency,
  formatPercent,
  formatServiceLabel,
  paymentMixWidths,
} from "@/lib/dashboard/format";
import type { Service, TxLineItem } from "@/lib/dashboard/mock-data";

const SERVICES: readonly Service[] = [
  { id: "a", name: "A", cat: "Manicure", time: 30, price: 10 },
  { id: "b", name: "B", cat: "Manicure", time: 30, price: 10 },
  { id: "c", name: "C", cat: "Manicure", time: 30, price: 10 },
  { id: "d", name: "D", cat: "Manicure", time: 30, price: 10 },
];

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

describe("formatServiceLabel", () => {
  it("joins 1-2 items with a comma", () => {
    const items: TxLineItem[] = [
      { id: "a", qty: 1 },
      { id: "b", qty: 1 },
    ];
    expect(formatServiceLabel(items, SERVICES)).toBe("A, B");
  });

  it("uses '+N more' shortener for 3+ items", () => {
    const items: TxLineItem[] = [
      { id: "a", qty: 1 },
      { id: "b", qty: 1 },
      { id: "c", qty: 1 },
    ];
    expect(formatServiceLabel(items, SERVICES)).toBe("A +2 more");
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
