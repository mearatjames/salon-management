import { describe, expect, it } from "vitest";

import { parseReportPeriodParams, resolveReportWindow } from "@/lib/report/window";

const LA = "America/Los_Angeles";

function iso(d: Date): string {
  return d.toISOString();
}

// ─── parseReportPeriodParams — search-param sanitisation ─────────────────────

describe("parseReportPeriodParams — granularity sanitisation", () => {
  it("missing period → day (the default granularity)", () => {
    expect(parseReportPeriodParams({}).granularity).toBe("day");
  });

  it("invalid period string → day", () => {
    expect(parseReportPeriodParams({ period: "month" }).granularity).toBe("day");
    expect(parseReportPeriodParams({ period: "garbage" }).granularity).toBe("day");
    expect(parseReportPeriodParams({ period: "" }).granularity).toBe("day");
  });

  it("each valid period is preserved", () => {
    expect(parseReportPeriodParams({ period: "day" }).granularity).toBe("day");
    expect(parseReportPeriodParams({ period: "week" }).granularity).toBe("week");
    expect(parseReportPeriodParams({ period: "semi" }).granularity).toBe("semi");
  });
});

describe("parseReportPeriodParams — offset sanitisation", () => {
  it("missing offset → 0", () => {
    expect(parseReportPeriodParams({}).offset).toBe(0);
  });

  it("empty-string offset → 0", () => {
    expect(parseReportPeriodParams({ offset: "" }).offset).toBe(0);
  });

  it("non-integer offset → 0", () => {
    expect(parseReportPeriodParams({ offset: "-1.5" }).offset).toBe(0);
    expect(parseReportPeriodParams({ offset: "abc" }).offset).toBe(0);
    expect(parseReportPeriodParams({ offset: "NaN" }).offset).toBe(0);
  });

  it("positive offset clamps to 0 (forward stepping forbidden)", () => {
    expect(parseReportPeriodParams({ offset: "1" }).offset).toBe(0);
    expect(parseReportPeriodParams({ offset: "12" }).offset).toBe(0);
  });

  it("a negative integer offset is preserved", () => {
    expect(parseReportPeriodParams({ offset: "-1" }).offset).toBe(-1);
    expect(parseReportPeriodParams({ offset: "-7" }).offset).toBe(-7);
  });
});

// ─── resolveReportWindow — day ───────────────────────────────────────────────

describe("resolveReportWindow — day granularity", () => {
  // now = 2026-05-16T22:14:00.000Z (Saturday 3:14 PM PDT)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 → the full current day, isCurrent true, label Today", () => {
    const w = resolveReportWindow(LA, "day", 0, now);
    expect(iso(w.start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-17T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("Today");
    expect(w.rangeLabel).toBe("May 16, 2026");
  });

  it("offset -1 → the previous day, isCurrent false, label Yesterday", () => {
    const w = resolveReportWindow(LA, "day", -1, now);
    expect(iso(w.start)).toBe("2026-05-15T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-16T07:00:00.000Z");
    expect(w.isCurrent).toBe(false);
    expect(w.label).toBe("Yesterday");
    expect(w.rangeLabel).toBe("May 15, 2026");
  });

  it("offset -2 → two days back, label is the date itself", () => {
    const w = resolveReportWindow(LA, "day", -2, now);
    expect(iso(w.start)).toBe("2026-05-14T07:00:00.000Z");
    expect(w.label).toBe("May 14, 2026");
    expect(w.rangeLabel).toBe("May 14, 2026");
  });

  it("a positive offset is clamped to 0", () => {
    const w = resolveReportWindow(LA, "day", 3, now);
    expect(w.offset).toBe(0);
    expect(w.isCurrent).toBe(true);
  });
});

// ─── resolveReportWindow — week ──────────────────────────────────────────────

describe("resolveReportWindow — week granularity", () => {
  // now in the week of Mon 2026-05-11.
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 → the full current week, label This week", () => {
    const w = resolveReportWindow(LA, "week", 0, now);
    expect(iso(w.start)).toBe("2026-05-11T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-18T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("This week");
    expect(w.rangeLabel).toBe("May 11 – 17, 2026");
  });

  it("offset -1 → the previous week, label Last week", () => {
    const w = resolveReportWindow(LA, "week", -1, now);
    expect(iso(w.start)).toBe("2026-05-04T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-11T07:00:00.000Z");
    expect(w.label).toBe("Last week");
    expect(w.rangeLabel).toBe("May 4 – 10, 2026");
  });

  it("offset -2 → two weeks back", () => {
    const w = resolveReportWindow(LA, "week", -2, now);
    expect(iso(w.start)).toBe("2026-04-27T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-04T07:00:00.000Z");
    expect(w.rangeLabel).toBe("Apr 27 – May 3, 2026");
  });
});

// ─── resolveReportWindow — semi-monthly ──────────────────────────────────────

describe("resolveReportWindow — semi-monthly granularity", () => {
  it("offset 0, first half-month → [1st, 16th), label This pay period", () => {
    const now = new Date("2026-05-12T20:00:00.000Z"); // May 12
    const w = resolveReportWindow(LA, "semi", 0, now);
    expect(iso(w.start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-16T07:00:00.000Z");
    expect(w.isCurrent).toBe(true);
    expect(w.label).toBe("This pay period");
    expect(w.rangeLabel).toBe("May 1 – 15, 2026");
  });

  it("offset 0, second half-month → [16th, end-of-month]", () => {
    const now = new Date("2026-05-20T20:00:00.000Z"); // May 20
    const w = resolveReportWindow(LA, "semi", 0, now);
    expect(iso(w.start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-06-01T07:00:00.000Z");
    expect(w.rangeLabel).toBe("May 16 – 31, 2026");
  });

  it("offset -1 → the previous pay period, label Last pay period", () => {
    const now = new Date("2026-05-20T20:00:00.000Z"); // 2nd half of May
    const w = resolveReportWindow(LA, "semi", -1, now);
    expect(iso(w.start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(w.end)).toBe("2026-05-16T07:00:00.000Z");
    expect(w.label).toBe("Last pay period");
    expect(w.rangeLabel).toBe("May 1 – 15, 2026");
  });

  it("a 28-day February's second half spans Feb 16 – 28", () => {
    const now = new Date("2026-02-20T20:00:00.000Z"); // Feb 20
    const w = resolveReportWindow(LA, "semi", 0, now);
    expect(iso(w.start)).toBe("2026-02-16T08:00:00.000Z");
    expect(iso(w.end)).toBe("2026-03-01T08:00:00.000Z");
    expect(w.rangeLabel).toBe("Feb 16 – 28, 2026");
  });
});
