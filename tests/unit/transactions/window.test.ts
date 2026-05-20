import { describe, expect, it } from "vitest";

import { parsePeriodParams, resolveWindow } from "@/lib/transactions/window";

const LA = "America/Los_Angeles";

function iso(d: Date): string {
  return d.toISOString();
}

// ─── parsePeriodParams — sanitisation (contract C1/C3) ───────────────────────

describe("parsePeriodParams — period sanitisation", () => {
  it("missing period → week", () => {
    expect(parsePeriodParams({}).granularity).toBe("week");
  });

  it("undefined period → week", () => {
    expect(parsePeriodParams({ period: undefined }).granularity).toBe("week");
  });

  it("invalid period string → week", () => {
    expect(parsePeriodParams({ period: "decade" }).granularity).toBe("week");
    expect(parsePeriodParams({ period: "" }).granularity).toBe("week");
    expect(parsePeriodParams({ period: "WEEK" }).granularity).toBe("week");
  });

  it("valid periods pass through", () => {
    expect(parsePeriodParams({ period: "today" }).granularity).toBe("today");
    expect(parsePeriodParams({ period: "week" }).granularity).toBe("week");
    expect(parsePeriodParams({ period: "month" }).granularity).toBe("month");
  });
});

describe("parsePeriodParams — offset sanitisation", () => {
  it("missing offset → 0", () => {
    expect(parsePeriodParams({}).offset).toBe(0);
  });

  it("non-numeric offset → 0", () => {
    expect(parsePeriodParams({ offset: "abc" }).offset).toBe(0);
    expect(parsePeriodParams({ offset: "" }).offset).toBe(0);
  });

  it("non-integer offset → 0", () => {
    expect(parsePeriodParams({ offset: "-1.5" }).offset).toBe(0);
    expect(parsePeriodParams({ offset: "2.7" }).offset).toBe(0);
  });

  it("positive offset clamps to 0", () => {
    expect(parsePeriodParams({ offset: "1" }).offset).toBe(0);
    expect(parsePeriodParams({ offset: "99" }).offset).toBe(0);
  });

  it("negative integer offsets pass through", () => {
    expect(parsePeriodParams({ offset: "-1" }).offset).toBe(-1);
    expect(parsePeriodParams({ offset: "-12" }).offset).toBe(-12);
  });

  it("offset 0 passes through", () => {
    expect(parsePeriodParams({ offset: "0" }).offset).toBe(0);
  });
});

// ─── resolveWindow — bounds, isCurrent, labels ───────────────────────────────

describe("resolveWindow — week (America/Los_Angeles)", () => {
  // now = 2026-05-16T22:14:00.000Z (Saturday in the week of Mon 2026-05-11)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 — current week bounds + isCurrent true", () => {
    const w = resolveWindow(LA, "week", 0, now);
    expect(w.granularity).toBe("week");
    expect(w.offset).toBe(0);
    expect(iso(w.start)).toBe("2026-05-11T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-18T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("This week");
  });

  it("offset -1 — previous week, isCurrent false, label 'Last week'", () => {
    const w = resolveWindow(LA, "week", -1, now);
    expect(iso(w.start)).toBe("2026-05-04T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-11T07:00:00.000Z");
    expect(w.isCurrent).toBe(false);
    expect(w.label).toBe("Last week");
  });

  it("offset -2 — older week uses a 'Week of …' label", () => {
    const w = resolveWindow(LA, "week", -2, now);
    expect(iso(w.start)).toBe("2026-04-27T07:00:00.000Z");
    expect(w.isCurrent).toBe(false);
    expect(w.label).toBe("Week of Apr 27");
  });

  it("offset -2 — week rangeLabel spans the Monday→Sunday range", () => {
    const w = resolveWindow(LA, "week", -2, now);
    expect(w.rangeLabel).toBe("Apr 27 – May 3, 2026");
  });

  it("positive offset is clamped to 0 (forward stepping forbidden)", () => {
    const w = resolveWindow(LA, "week", 3, now);
    expect(w.offset).toBe(0);
    expect(w.isCurrent).toBe(true);
  });
});

describe("resolveWindow — today (America/Los_Angeles)", () => {
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 — current day, label 'Today'", () => {
    const w = resolveWindow(LA, "today", 0, now);
    expect(iso(w.start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-17T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("Today");
    expect(w.rangeLabel).toBe("May 16, 2026");
  });

  it("offset -1 — previous day, label 'Yesterday'", () => {
    const w = resolveWindow(LA, "today", -1, now);
    expect(iso(w.start)).toBe("2026-05-15T07:00:00.000Z");
    expect(w.isCurrent).toBe(false);
    expect(w.label).toBe("Yesterday");
    expect(w.rangeLabel).toBe("May 15, 2026");
  });

  it("offset -3 — older day uses the formatted date as the label", () => {
    const w = resolveWindow(LA, "today", -3, now);
    expect(iso(w.start)).toBe("2026-05-13T07:00:00.000Z");
    expect(w.label).toBe("May 13, 2026");
  });
});

describe("resolveWindow — month (America/Los_Angeles)", () => {
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 — current month, label 'This month'", () => {
    const w = resolveWindow(LA, "month", 0, now);
    expect(iso(w.start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-06-01T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("This month");
    expect(w.rangeLabel).toBe("May 2026");
  });

  it("offset -1 — previous month, label 'Last month'", () => {
    const w = resolveWindow(LA, "month", -1, now);
    expect(iso(w.start)).toBe("2026-04-01T07:00:00.000Z");
    expect(w.isCurrent).toBe(false);
    expect(w.label).toBe("Last month");
    expect(w.rangeLabel).toBe("April 2026");
  });

  it("offset -2 — older month uses 'Month Year' as the label", () => {
    const w = resolveWindow(LA, "month", -2, now);
    expect(iso(w.start)).toBe("2026-03-01T08:00:00.000Z");
    expect(w.label).toBe("March 2026");
    expect(w.rangeLabel).toBe("March 2026");
  });
});
