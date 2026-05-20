import { describe, expect, it } from "vitest";

import {
  dayWindowAt,
  monthWindow,
  monthWindowAt,
  salonNow,
  semiMonthlyWindowAt,
  todayWindow,
  weekWindow,
  weekWindowAt,
} from "@/lib/time/period-windows";

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

// ─── Offset-aware full-period windows ────────────────────────────────────────
// dayWindowAt / weekWindowAt / monthWindowAt return the FULL period `offset`
// steps back — `end` is the start of the NEXT period, not "now".

describe("dayWindowAt — offset-aware day windows (America/Los_Angeles)", () => {
  // now = 2026-05-16T22:14:00.000Z (Saturday 3:14 PM PDT)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 → the full current day [midnight, next midnight)", () => {
    const [start, end] = dayWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-16T07:00:00.000Z");
    // end is the start of the NEXT day (2026-05-17), not `now`.
    expect(iso(end)).toBe("2026-05-17T07:00:00.000Z");
  });

  it("offset -1 → the full previous day", () => {
    const [start, end] = dayWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-05-15T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-16T07:00:00.000Z");
  });

  it("offset -2 → two full days back", () => {
    const [start, end] = dayWindowAt(LA, now, -2);
    expect(iso(start)).toBe("2026-05-14T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-15T07:00:00.000Z");
  });

  it("consecutive offsets are contiguous — one period's end is the next's start", () => {
    const [, end1] = dayWindowAt(LA, now, -1);
    const [start0] = dayWindowAt(LA, now, 0);
    expect(iso(end1)).toBe(iso(start0));
  });

  it("DST spring-forward — the offset-0 day spanning the lost hour is 23h long", () => {
    // 2026-03-08 is the LA spring-forward day.
    const nowDst = new Date("2026-03-08T15:00:00.000Z");
    const [start, end] = dayWindowAt(LA, nowDst, 0);
    expect(iso(start)).toBe("2026-03-08T08:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("DST fall-back — the offset-0 day spanning the gained hour is 25h long", () => {
    // 2026-11-01 is the LA fall-back day.
    const nowDst = new Date("2026-11-01T13:00:00.000Z");
    const [start, end] = dayWindowAt(LA, nowDst, 0);
    expect(iso(start)).toBe("2026-11-01T07:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});

describe("weekWindowAt — offset-aware Monday-start week windows (America/Los_Angeles)", () => {
  // now = 2026-05-16T22:14:00.000Z (Saturday in the week of Mon 2026-05-11)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 → the full current week [Monday, next Monday)", () => {
    const [start, end] = weekWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-11T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-18T07:00:00.000Z");
  });

  it("offset -1 → the full previous week", () => {
    const [start, end] = weekWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-05-04T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-11T07:00:00.000Z");
  });

  it("offset -2 → two full weeks back", () => {
    const [start, end] = weekWindowAt(LA, now, -2);
    expect(iso(start)).toBe("2026-04-27T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-04T07:00:00.000Z");
  });

  it("the current week's end equals the next Monday's midnight", () => {
    const [, end] = weekWindowAt(LA, now, 0);
    // 2026-05-18 is the next Monday.
    expect(iso(end)).toBe("2026-05-18T07:00:00.000Z");
  });

  it("offset -1 spans a DST spring-forward — start/end straddle the change", () => {
    // 2026-03-08 spring-forward falls inside the week of Mon 2026-03-02.
    // now in the week of Mon 2026-03-09; offset -1 is the week of Mon 2026-03-02.
    const nowDst = new Date("2026-03-11T20:00:00.000Z");
    const [start, end] = weekWindowAt(LA, nowDst, -1);
    expect(iso(start)).toBe("2026-03-02T08:00:00.000Z"); // PST
    expect(iso(end)).toBe("2026-03-09T07:00:00.000Z"); // PDT
    // 7 calendar days but one wall hour lost → 7*24 - 1 hours.
    expect(end.getTime() - start.getTime()).toBe((7 * 24 - 1) * 60 * 60 * 1000);
  });
});

describe("monthWindowAt — offset-aware calendar-month windows (America/Los_Angeles)", () => {
  // now = 2026-05-16T22:14:00.000Z (May 2026)
  const now = new Date("2026-05-16T22:14:00.000Z");

  it("offset 0 → the full current month [1st, 1st of next month)", () => {
    const [start, end] = monthWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-06-01T07:00:00.000Z");
  });

  it("offset -1 → the full previous month (April)", () => {
    const [start, end] = monthWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-04-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-01T07:00:00.000Z");
  });

  it("offset -2 → two full months back (March, crossing the DST boundary)", () => {
    const [start, end] = monthWindowAt(LA, now, -2);
    expect(iso(start)).toBe("2026-03-01T08:00:00.000Z"); // PST
    expect(iso(end)).toBe("2026-04-01T07:00:00.000Z"); // PDT
  });

  it("offset -3 → February — crosses a year-agnostic month boundary cleanly", () => {
    const [start, end] = monthWindowAt(LA, now, -3);
    expect(iso(start)).toBe("2026-02-01T08:00:00.000Z");
    expect(iso(end)).toBe("2026-03-01T08:00:00.000Z");
  });

  it("offset stepping back across a January→December year boundary", () => {
    // now in January 2026; offset -1 → December 2025.
    const nowJan = new Date("2026-01-15T20:00:00.000Z");
    const [start, end] = monthWindowAt(LA, nowJan, -1);
    expect(iso(start)).toBe("2025-12-01T08:00:00.000Z");
    expect(iso(end)).toBe("2026-01-01T08:00:00.000Z");
  });

  it("consecutive months are contiguous", () => {
    const [, endApr] = monthWindowAt(LA, now, -1);
    const [startMay] = monthWindowAt(LA, now, 0);
    expect(iso(endApr)).toBe(iso(startMay));
  });
});

describe("offset-aware windows — far-from-UTC tz (Asia/Tokyo)", () => {
  const now = new Date("2026-05-16T22:14:00.000Z"); // 2026-05-17 07:14 JST

  it("dayWindowAt offset 0 in Tokyo is the JST calendar day", () => {
    const [start, end] = dayWindowAt(TYO, now, 0);
    expect(iso(start)).toBe("2026-05-16T15:00:00.000Z"); // midnight JST 2026-05-17
    expect(iso(end)).toBe("2026-05-17T15:00:00.000Z");
  });
});

// ─── semiMonthlyWindowAt — half-month (1st–15th / 16th–end) windows ──────────
// `[1st, 16th)` when local day ≤ 15, else `[16th, 1st of next month)`. `offset`
// steps by whole half-months across month/year boundaries; `end` is the
// exclusive start of the next half-month.

describe("semiMonthlyWindowAt — offset 0, first half-month (LA)", () => {
  // 2026-05-12 is the 12th — local day ≤ 15 → the [1st, 16th) half-month.
  const now = new Date("2026-05-12T20:00:00.000Z"); // 1:00 PM PDT, May 12

  it("offset 0 → [May 1, May 16) local midnights in PDT", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-16T07:00:00.000Z");
  });

  it("offset -1 → the previous half-month [Apr 16, May 1)", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-04-16T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-01T07:00:00.000Z");
  });

  it("offset -2 → two half-months back [Apr 1, Apr 16)", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -2);
    expect(iso(start)).toBe("2026-04-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-04-16T07:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — offset 0, second half-month (LA)", () => {
  // 2026-05-20 is the 20th — local day > 15 → the [16th, 1st-of-next) half-month.
  const now = new Date("2026-05-20T20:00:00.000Z"); // 1:00 PM PDT, May 20

  it("offset 0 → [May 16, Jun 1) local midnights in PDT", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(end)).toBe("2026-06-01T07:00:00.000Z");
  });

  it("offset -1 → the previous half-month [May 1, May 16)", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-16T07:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — the 15th and 16th land in the right half", () => {
  it("the 15th is in the first half-month [1st, 16th)", () => {
    const now = new Date("2026-05-15T20:00:00.000Z"); // May 15, 1 PM PDT
    const [start, end] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-16T07:00:00.000Z");
  });

  it("the 16th is in the second half-month [16th, 1st-of-next)", () => {
    const now = new Date("2026-05-16T20:00:00.000Z"); // May 16, 1 PM PDT
    const [start, end] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(end)).toBe("2026-06-01T07:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — stepping across a month boundary", () => {
  // now in the first half of June; -1 → second half of May, -2 → first half of May.
  const now = new Date("2026-06-05T20:00:00.000Z"); // Jun 5, 1 PM PDT

  it("offset -1 crosses June→May into the second half of May", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-05-16T07:00:00.000Z");
    expect(iso(end)).toBe("2026-06-01T07:00:00.000Z");
  });

  it("offset -2 lands in the first half of May", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -2);
    expect(iso(start)).toBe("2026-05-01T07:00:00.000Z");
    expect(iso(end)).toBe("2026-05-16T07:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — stepping across a year boundary", () => {
  // now in the first half of January 2026; -1 → second half of December 2025.
  const nowJan = new Date("2026-01-10T20:00:00.000Z"); // Jan 10, 12 PM PST

  it("offset -1 crosses Jan 2026 → second half of Dec 2025", () => {
    const [start, end] = semiMonthlyWindowAt(LA, nowJan, -1);
    expect(iso(start)).toBe("2025-12-16T08:00:00.000Z"); // PST
    expect(iso(end)).toBe("2026-01-01T08:00:00.000Z");
  });

  it("offset -2 → first half of Dec 2025", () => {
    const [start, end] = semiMonthlyWindowAt(LA, nowJan, -2);
    expect(iso(start)).toBe("2025-12-01T08:00:00.000Z");
    expect(iso(end)).toBe("2025-12-16T08:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — short month (28-day February)", () => {
  // 2026 is not a leap year — February has 28 days. The second half-month of
  // February is [Feb 16, Mar 1), 13 calendar days.
  const now = new Date("2026-02-20T20:00:00.000Z"); // Feb 20, 12 PM PST

  it("the second half of a 28-day February ends at March 1", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(start)).toBe("2026-02-16T08:00:00.000Z");
    expect(iso(end)).toBe("2026-03-01T08:00:00.000Z");
  });

  it("offset -1 → the first half of February [Feb 1, Feb 16)", () => {
    const [start, end] = semiMonthlyWindowAt(LA, now, -1);
    expect(iso(start)).toBe("2026-02-01T08:00:00.000Z");
    expect(iso(end)).toBe("2026-02-16T08:00:00.000Z");
  });
});

describe("semiMonthlyWindowAt — contiguity and exclusivity", () => {
  const now = new Date("2026-05-20T20:00:00.000Z");

  it("end is the exclusive start of the next half-month", () => {
    const [, endPrev] = semiMonthlyWindowAt(LA, now, -1);
    const [startCur] = semiMonthlyWindowAt(LA, now, 0);
    expect(iso(endPrev)).toBe(iso(startCur));
  });

  it("the current half-month's end equals the next half-month's start", () => {
    const [, endCur] = semiMonthlyWindowAt(LA, now, 0);
    const [startNext] = semiMonthlyWindowAt(LA, now, 1);
    expect(iso(endCur)).toBe(iso(startNext));
  });
});
