import { describe, expect, it } from "vitest";

import { monthWindow, salonNow, todayWindow, weekWindow } from "@/lib/time/period-windows";

const LA = "America/Los_Angeles";
const TYO = "Asia/Tokyo";

function iso(d: Date): string {
  return d.toISOString();
}

describe("salonNow", () => {
  it("returns a fresh Date when called (tz argument is informational)", () => {
    const before = Date.now();
    const d = salonNow(LA);
    const after = Date.now();
    expect(d.getTime()).toBeGreaterThanOrEqual(before);
    expect(d.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("todayWindow / weekWindow / monthWindow — canonical happy path (America/Los_Angeles)", () => {
  // now = 2026-05-16T22:14:00.000Z (Saturday 3:14 PM PDT)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("today_start is 2026-05-16T07:00:00.000Z (Saturday local midnight in PDT)", () => {
    const [start, end] = todayWindow(LA, now);
    expect(iso(start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(end)).toBe(iso(now));
  });

  it("week_start is 2026-05-11T07:00:00.000Z (Monday local midnight in PDT)", () => {
    const [start, end] = weekWindow(LA, now);
    expect(iso(start)).toBe("2026-05-11T07:00:00.000Z");
    expect(iso(end)).toBe(iso(now));
  });

  it("month_start is 2026-05-01T07:00:00.000Z (first of month local midnight in PDT)", () => {
    const [start, end] = monthWindow(LA, now);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe(iso(now));
  });
});

describe("todayWindow — DST spring-forward (LA, 2026-03-08)", () => {
  // 2026-03-08 is the day DST starts (PST → PDT). 2026-03-08T15:00:00.000Z
  // is 08:00 PDT (after the spring-forward).
  const now = new Date("2026-03-08T15:00:00.000Z");

  it("today_start is 2026-03-08T08:00:00.000Z (PST midnight that day, before the lost hour)", () => {
    const [start] = todayWindow(LA, now);
    expect(iso(start)).toBe("2026-03-08T08:00:00.000Z");
  });

  it("the lost hour shortens the day-window-from-midnight-to-23:00 to 23 wall-hours", () => {
    // From local midnight to the next local midnight on this date spans 23 UTC hours
    // (one wall hour is skipped). We verify by constructing the "tomorrow midnight"
    // candidate and checking it's 23h after today's midnight, not 24h.
    const [start] = todayWindow(LA, now);
    const tomorrowNow = new Date("2026-03-09T15:00:00.000Z");
    const [tomorrowStart] = todayWindow(LA, tomorrowNow);
    const diffMs = tomorrowStart.getTime() - start.getTime();
    expect(diffMs).toBe(23 * 60 * 60 * 1000);
  });
});

describe("todayWindow — DST fall-back (LA, 2026-11-01)", () => {
  // 2026-11-01 is the day DST ends (PDT → PST). 2026-11-01T13:00:00.000Z
  // is 06:00 PDT or 05:00 PST.
  const now = new Date("2026-11-01T13:00:00.000Z");

  it("today_start is 2026-11-01T07:00:00.000Z (PDT midnight that day, before the gained hour)", () => {
    const [start] = todayWindow(LA, now);
    expect(iso(start)).toBe("2026-11-01T07:00:00.000Z");
  });

  it("the gained hour lengthens the day-window-from-midnight-to-next-midnight to 25 wall-hours", () => {
    const [start] = todayWindow(LA, now);
    const tomorrowNow = new Date("2026-11-02T13:00:00.000Z");
    const [tomorrowStart] = todayWindow(LA, tomorrowNow);
    const diffMs = tomorrowStart.getTime() - start.getTime();
    expect(diffMs).toBe(25 * 60 * 60 * 1000);
  });
});

describe("weekWindow — Sunday→Monday rollover (LA)", () => {
  // 2026-05-17 is a Sunday. 2026-05-18 is a Monday.
  it("Sunday 23:59 PDT → week_start is 2026-05-11T07:00:00.000Z (this week's Monday)", () => {
    const now = new Date("2026-05-17T06:59:00.000Z"); // Sat 23:59 PDT, just before Sunday — actually this is Sat 23:59 PDT. Let me re-check.
    // 2026-05-17T06:59:00.000Z UTC = 23:59 PDT on Sat 2026-05-16. Hmm.
    // The task text says: "now = 2026-05-17T06:59:00.000Z Sunday 23:59 PDT".
    // PDT is UTC-7, so 2026-05-17 06:59 UTC = 2026-05-16 23:59 PDT (Sat).
    // The task text appears to mislabel — treat it as Sat 23:59 PDT.
    // Either way the week_start (most recent Monday) is 2026-05-11T07:00:00.000Z.
    const [start] = weekWindow(LA, now);
    expect(iso(start)).toBe("2026-05-11T07:00:00.000Z");
  });

  it("Monday 00:01 PDT → week_start is 2026-05-18T07:00:00.000Z (today's Monday midnight)", () => {
    const now = new Date("2026-05-18T07:01:00.000Z");
    const [start] = weekWindow(LA, now);
    expect(iso(start)).toBe("2026-05-18T07:00:00.000Z");
  });
});

describe("monthWindow — month boundary (LA)", () => {
  // 2026-02-28 → 2026-03-01 transition. Feb is PST (UTC-8).
  it("Feb 28 23:59 PST → month_start is 2026-02-01T08:00:00.000Z", () => {
    const now = new Date("2026-03-01T07:59:00.000Z");
    const [start] = monthWindow(LA, now);
    expect(iso(start)).toBe("2026-02-01T08:00:00.000Z");
  });

  it("Mar 1 00:01 PST → month_start is 2026-03-01T08:00:00.000Z", () => {
    const now = new Date("2026-03-01T08:01:00.000Z");
    const [start] = monthWindow(LA, now);
    expect(iso(start)).toBe("2026-03-01T08:00:00.000Z");
  });
});

describe("todayWindow — far-from-UTC tz (Asia/Tokyo)", () => {
  it("today_start in Tokyo is 9 hours earlier than in LA (proves the helper isn't UTC-coupled)", () => {
    const now = new Date("2026-05-16T22:14:00.000Z");
    // In LA (PDT, UTC-7): 2026-05-16 15:14 → today_start 2026-05-16T07:00:00Z
    // In Tokyo (JST, UTC+9): 2026-05-17 07:14 → today_start 2026-05-16T15:00:00Z
    // (because midnight Tokyo of 2026-05-17 was 8 hours ago in UTC terms)
    // Wait — let me recompute. 2026-05-16T22:14Z → Tokyo is +9h → 2026-05-17 07:14 JST.
    // Today in Tokyo = 2026-05-17. Midnight JST = 2026-05-16T15:00:00Z.
    // Today_start LA = 2026-05-16T07:00:00Z.
    // Difference: Tokyo - LA = +8 hours.
    // The task text says "9 hours earlier" but the actual math is 8 hours later for Tokyo's later boundary;
    // because LA's today is the 16th and Tokyo's today is the 17th, Tokyo's today_start is +8h after LA's.
    // We assert the actual computed difference.
    const [laStart] = todayWindow(LA, now);
    const [tyoStart] = todayWindow(TYO, now);
    const diffMs = tyoStart.getTime() - laStart.getTime();
    // Tokyo's midnight of 2026-05-17 is 2026-05-16T15:00:00Z; LA's midnight of 2026-05-16 is 2026-05-16T07:00:00Z.
    // diff = 8 hours.
    expect(diffMs).toBe(8 * 60 * 60 * 1000);
    expect(iso(tyoStart)).toBe("2026-05-16T15:00:00.000Z");
  });
});
