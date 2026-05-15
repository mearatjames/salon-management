import { describe, expect, it } from "vitest";

import {
  applyPeriodFactor,
  buildDashboardData,
  txAggregate,
  txTotals,
} from "@/lib/dashboard/aggregate";
import { STAFF, TAX_RATE, TX_HISTORY } from "@/lib/dashboard/mock-data";
import type { Transaction } from "@/lib/dashboard/mock-data";

const ONE_ITEM_TX: Transaction = {
  id: "single",
  time: "10:00 AM",
  client: "Test One",
  techs: ["maya"],
  items: [{ id: "classic-mani", qty: 1, price: 25 }],
  tipPct: 0.2,
  method: "card",
};

// Two-line transaction with an add-on whose price is overridden explicitly.
const MULTI_ITEM_TX: Transaction = {
  id: "multi",
  time: "11:00 AM",
  client: "Test Multi",
  techs: ["maya", "linh"],
  items: [
    { id: "classic-mani", qty: 1, price: 25 },
    { id: "addon-paraffin", qty: 1, price: 12 }, // override (not the default 10)
  ],
  tipPct: 0.18,
  method: "cash",
};

describe("txTotals", () => {
  it("computes totals for a single-item transaction", () => {
    const t = txTotals(ONE_ITEM_TX);
    expect(t.subtotal).toBeCloseTo(25, 5);
    expect(t.tip).toBeCloseTo(5, 5);
    expect(t.tax).toBeCloseTo((25 + 5) * TAX_RATE, 5);
    expect(t.total).toBeCloseTo(25 + 5 + (25 + 5) * TAX_RATE, 5);
    expect(t.services).toBe(1);
  });

  it("computes totals for a multi-item transaction with explicit price override", () => {
    const t = txTotals(MULTI_ITEM_TX);
    const subtotal = 25 + 12;
    const tip = subtotal * 0.18;
    const tax = (subtotal + tip) * TAX_RATE;
    expect(t.subtotal).toBeCloseTo(subtotal, 5);
    expect(t.tip).toBeCloseTo(tip, 5);
    expect(t.tax).toBeCloseTo(tax, 5);
    expect(t.total).toBeCloseTo(subtotal + tip + tax, 5);
    expect(t.services).toBe(2);
  });
});

describe("txAggregate", () => {
  it("upholds the totals invariant: byMethod sums approximately equal total", () => {
    const agg = txAggregate(TX_HISTORY);
    const sum = agg.byMethod.card + agg.byMethod.cash + agg.byMethod.gift;
    expect(sum).toBeCloseTo(agg.total, 5);
  });

  it("counts equals the list length", () => {
    expect(txAggregate(TX_HISTORY).count).toBe(TX_HISTORY.length);
  });
});

describe("applyPeriodFactor", () => {
  it("rounds count and services to integers for every period", () => {
    const base = txAggregate(TX_HISTORY);
    for (const period of ["today", "week", "month"] as const) {
      const s = applyPeriodFactor(base, period);
      expect(Number.isInteger(s.count)).toBe(true);
      expect(Number.isInteger(s.services)).toBe(true);
    }
  });

  it("short-circuits to all-zeroes when base.count === 0 (FR-018)", () => {
    const zeroBase = txAggregate([]);
    for (const period of ["today", "week", "month"] as const) {
      const s = applyPeriodFactor(zeroBase, period);
      expect(s.count).toBe(0);
      expect(s.services).toBe(0);
      expect(s.subtotal).toBe(0);
      expect(s.tip).toBe(0);
      expect(s.tax).toBe(0);
      expect(s.total).toBe(0);
      expect(s.byMethod).toEqual({ card: 0, cash: 0, gift: 0 });
      expect(s.avgServicesPerSale).toBe(0);
      expect(s.tipPctAvg).toBe(0);
    }
  });
});

describe("buildDashboardData", () => {
  const data = buildDashboardData();

  it("renders the static greeting strings", () => {
    expect(data.greeting.eyebrow).toBe("Lacquer Studio · Front desk");
    expect(data.greeting.title).toBe("Today at the salon");
    expect(data.greeting.subtitle.startsWith("Tuesday, May 12")).toBe(true);
  });

  it("precomputes all three summaries with integer counts from the prototype factor", () => {
    expect(data.summaries.today.count).toBe(17);
    expect(data.summaries.week.count).toBe(Math.round(17 * 6.4));
    expect(data.summaries.month.count).toBe(Math.round(17 * 27));
  });

  it("renders the 7 most-recent rows, newest first", () => {
    expect(data.recent.length).toBe(7);
    expect(data.recent[0].id).toBe("tx-0130");
    expect(data.recent[6].id).toBe("tx-0124");
  });

  it("always populates the static comparison strings (display gating is the page's job)", () => {
    expect(data.comparisons).toEqual({
      transactionsVsAvg: "+3 vs avg",
      revenueDelta: "+12%",
    });
  });

  it("ships exactly 4 quick actions and the full STAFF roster", () => {
    expect(data.quickActions.length).toBe(4);
    expect(data.staff.length).toBe(STAFF.length);
  });
});
