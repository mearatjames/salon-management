import { describe, expect, it } from "vitest";

import { parsePayrollParams, resolvePayPeriod } from "@/lib/payroll/window";

const LA = "America/Los_Angeles";

// ─── resolvePayPeriod — semi-monthly pay-period resolution ───────────────────

describe("resolvePayPeriod — current period (offset 0)", () => {
  it("second half-month → May 16 – 31, 2026, pay date June 2", () => {
    // now = 2026-05-20 (2nd half of May), salon-local
    const now = new Date("2026-05-20T20:00:00.000Z");
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.startsOn).toBe("2026-05-16");
    expect(p.endsOn).toBe("2026-05-31");
    expect(p.payDate).toBe("2026-06-02");
    expect(p.status).toBe("open");
    expect(p.offset).toBe(0);
    expect(p.isCurrent).toBe(true);
    expect(p.id).toBeNull();
  });

  it("first half-month → May 1 – 15, 2026, pay date May 17", () => {
    const now = new Date("2026-05-12T20:00:00.000Z"); // May 12
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.startsOn).toBe("2026-05-01");
    expect(p.endsOn).toBe("2026-05-15");
    expect(p.payDate).toBe("2026-05-17");
    expect(p.isCurrent).toBe(true);
  });
});

describe("resolvePayPeriod — past periods (negative offset)", () => {
  it("offset -1 from the 2nd half of May → May 1 – 15, 2026", () => {
    const now = new Date("2026-05-20T20:00:00.000Z");
    const p = resolvePayPeriod(LA, now, -1);
    expect(p.startsOn).toBe("2026-05-01");
    expect(p.endsOn).toBe("2026-05-15");
    expect(p.payDate).toBe("2026-05-17");
    expect(p.offset).toBe(-1);
    expect(p.isCurrent).toBe(false);
  });

  it("offset -1 from the 1st half of a month crosses the month boundary", () => {
    const now = new Date("2026-05-12T20:00:00.000Z"); // May 12, 1st half
    const p = resolvePayPeriod(LA, now, -1);
    expect(p.startsOn).toBe("2026-04-16");
    expect(p.endsOn).toBe("2026-04-30");
    // endsOn + 2 days = May 2
    expect(p.payDate).toBe("2026-05-02");
  });

  it("offset -2 steps two whole half-months back", () => {
    const now = new Date("2026-05-20T20:00:00.000Z"); // 2nd half of May
    const p = resolvePayPeriod(LA, now, -2);
    expect(p.startsOn).toBe("2026-04-16");
    expect(p.endsOn).toBe("2026-04-30");
  });
});

describe("resolvePayPeriod — pay date is endsOn + 2 days", () => {
  it("a 28-day February's second half ends Feb 28, pay date March 2", () => {
    const now = new Date("2026-02-20T20:00:00.000Z"); // Feb 20
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.startsOn).toBe("2026-02-16");
    expect(p.endsOn).toBe("2026-02-28");
    expect(p.payDate).toBe("2026-03-02");
  });

  it("a 31-day month's second half ends on the 31st, pay date is +2", () => {
    const now = new Date("2026-01-20T20:00:00.000Z"); // Jan 20
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.startsOn).toBe("2026-01-16");
    expect(p.endsOn).toBe("2026-01-31");
    expect(p.payDate).toBe("2026-02-02");
  });
});

// ─── resolvePayPeriod — labels ───────────────────────────────────────────────

describe("resolvePayPeriod — label and shortLabel", () => {
  it("within one month: full label carries the year, short label drops it", () => {
    const now = new Date("2026-05-20T20:00:00.000Z");
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.label).toBe("May 16 – 31, 2026");
    expect(p.shortLabel).toBe("May 16 – 31");
  });

  it("first-half label spans the 1st to the 15th", () => {
    const now = new Date("2026-05-12T20:00:00.000Z");
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.label).toBe("May 1 – 15, 2026");
    expect(p.shortLabel).toBe("May 1 – 15");
  });

  it("a 28-day February's second half labels through the 28th", () => {
    const now = new Date("2026-02-20T20:00:00.000Z");
    const p = resolvePayPeriod(LA, now, 0);
    expect(p.label).toBe("Feb 16 – 28, 2026");
    expect(p.shortLabel).toBe("Feb 16 – 28");
  });
});

// ─── parsePayrollParams — offset clamp + filter parsing ──────────────────────

describe("parsePayrollParams — offset sanitisation", () => {
  it("missing offset → 0", () => {
    expect(parsePayrollParams({}).offset).toBe(0);
  });

  it("empty-string offset → 0", () => {
    expect(parsePayrollParams({ offset: "" }).offset).toBe(0);
  });

  it("non-integer offset → 0", () => {
    expect(parsePayrollParams({ offset: "-1.5" }).offset).toBe(0);
    expect(parsePayrollParams({ offset: "abc" }).offset).toBe(0);
    expect(parsePayrollParams({ offset: "NaN" }).offset).toBe(0);
  });

  it("positive offset clamps to 0 (no future periods)", () => {
    expect(parsePayrollParams({ offset: "1" }).offset).toBe(0);
    expect(parsePayrollParams({ offset: "9" }).offset).toBe(0);
  });

  it("a negative integer offset is preserved", () => {
    expect(parsePayrollParams({ offset: "-1" }).offset).toBe(-1);
    expect(parsePayrollParams({ offset: "-6" }).offset).toBe(-6);
  });
});

describe("parsePayrollParams — filter parsing", () => {
  it("missing filter → all", () => {
    expect(parsePayrollParams({}).filter).toBe("all");
  });

  it("invalid filter → all", () => {
    expect(parsePayrollParams({ filter: "garbage" }).filter).toBe("all");
    expect(parsePayrollParams({ filter: "" }).filter).toBe("all");
  });

  it("each valid filter is preserved", () => {
    expect(parsePayrollParams({ filter: "all" }).filter).toBe("all");
    expect(parsePayrollParams({ filter: "to-pay" }).filter).toBe("to-pay");
    expect(parsePayrollParams({ filter: "paid" }).filter).toBe("paid");
  });
});
