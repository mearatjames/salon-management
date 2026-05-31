import { describe, expect, it } from "vitest";

import { formatExpiry, formatSubtitle, formatTime, salonDateString } from "@/lib/time/format";

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

describe("formatExpiry", () => {
  it("returns a long human date 'June 6, 2026' in America/Los_Angeles", () => {
    const d = new Date("2026-06-06T18:00:00.000Z");
    expect(formatExpiry(d, LA)).toBe("June 6, 2026");
  });

  it("honors the timezone arg — same instant near midnight rolls a day in Tokyo", () => {
    // 2026-06-06T23:30Z is 2026-06-06 16:30 PT but 2026-06-07 08:30 JST.
    const d = new Date("2026-06-06T23:30:00.000Z");
    expect(formatExpiry(d, LA)).toBe("June 6, 2026");
    expect(formatExpiry(d, TYO)).toBe("June 7, 2026");
  });
});

describe("salonDateString", () => {
  it("returns YYYY-MM-DD for the local date in America/Los_Angeles", () => {
    // 2026-05-17T22:14Z is 2026-05-17 15:14 PT — local day is the 17th.
    const d = new Date("2026-05-17T22:14:00.000Z");
    expect(salonDateString(LA, d)).toBe("2026-05-17");
  });

  it("honors the timezone arg — same instant rolls to next day in Tokyo", () => {
    // 2026-05-16T22:14Z is 2026-05-17 07:14 JST — local day is the 17th
    // in Tokyo but the 16th in Los Angeles.
    const d = new Date("2026-05-16T22:14:00.000Z");
    expect(salonDateString(LA, d)).toBe("2026-05-16");
    expect(salonDateString(TYO, d)).toBe("2026-05-17");
  });

  it("handles the previous-day rollover when UTC is already tomorrow", () => {
    // 2026-05-17T03:00Z is 2026-05-16 20:00 PT — still on the 16th
    // locally even though UTC has moved on to the 17th.
    const d = new Date("2026-05-17T03:00:00.000Z");
    expect(salonDateString(LA, d)).toBe("2026-05-16");
  });
});
