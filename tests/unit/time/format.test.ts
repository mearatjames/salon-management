import { describe, expect, it } from "vitest";

import { formatSubtitle, formatTime } from "@/lib/time/format";

const LA = "America/Los_Angeles";
const TYO = "Asia/Tokyo";

describe("formatSubtitle", () => {
  it("returns 'Saturday, May 16' for 2026-05-16T22:14Z in America/Los_Angeles", () => {
    const d = new Date("2026-05-16T22:14:00.000Z");
    expect(formatSubtitle(d, LA)).toBe("Saturday, May 16");
  });

  it("returns 'Sunday, May 17' for the same instant in Asia/Tokyo (proves the TZ arg is honored)", () => {
    const d = new Date("2026-05-16T22:14:00.000Z");
    expect(formatSubtitle(d, TYO)).toBe("Sunday, May 17");
  });
});

describe("formatTime", () => {
  it("returns '3:14 PM' for 2026-05-16T22:14Z in America/Los_Angeles", () => {
    const d = new Date("2026-05-16T22:14:00.000Z");
    expect(formatTime(d, LA)).toBe("3:14 PM");
  });

  it("returns '5:00 PM' for the previous-day instant 2026-05-16T00:00Z in America/Los_Angeles", () => {
    const d = new Date("2026-05-16T00:00:00.000Z");
    expect(formatTime(d, LA)).toBe("5:00 PM");
  });
});
