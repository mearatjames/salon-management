// Shared TZ-aware fixture helpers for e2e specs that need to seed paid
// tickets at LA-local instants.
//
// Extracted from `dashboard.spec.ts` (PR #6 of the e2e pruning audit). The
// helpers cover three concerns specs hit repeatedly:
//   1. Finding "LA-today-midnight as a UTC instant" so seeded `closed_at`
//      / `processed_at` timestamps stay inside today's salon window even
//      when CI runs within an hour of LA midnight (UTC hosts cross LA
//      midnight at ~07:00–08:00 UTC).
//   2. Doing calendar arithmetic in the salon TZ (parts of "now", shifting
//      days across month/year boundaries, building a UTC instant from
//      local wall-clock parts with DST correction).
//   3. Producing a deterministic per-slot seed plan that distinguishes
//      Today / Week / Month / Last-week / Last-month for tile assertions.

export const SALON_TZ = "America/Los_Angeles";

// LA-today-midnight as a UTC instant. Subtracts the local hours/minutes/
// seconds elapsed since midnight from `now`.
export function laTodayMidnightUtcMs(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const partVal = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed =
    partVal("hour") * 3_600_000 + partVal("minute") * 60_000 + partVal("second") * 1000;
  return now.getTime() - elapsed;
}

// Read the LA wall-clock parts of a UTC instant. Mirrors the inline helper
// in `lib/time/period-windows.ts`. Weekday is Mon=0…Sun=6.
export function laParts(now: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayOrder: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayOrder[get("weekday")] ?? 0,
  };
}

// Build a UTC instant from local-wall-clock parts in the salon TZ.
// Two-pass DST-correction technique mirrors `utcFromLocalParts` in
// `lib/time/period-windows.ts`.
export function utcFromLaWall(year: number, month: number, day: number, hour: number): Date {
  const candidateMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  const off = (instant: Date): number => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: SALON_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(instant);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
    const h = get("hour") === "24" ? "00" : get("hour");
    const local = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(h),
      Number(get("minute")),
      Number(get("second"))
    );
    return local - instant.getTime();
  };
  const o1 = off(new Date(candidateMs));
  const correctedMs = candidateMs - o1;
  const o2 = off(new Date(correctedMs));
  return new Date(candidateMs - o2);
}

// Shift an LA-local Y/M/D by `days` and return the new tuple. Treats the
// local date as UTC for the shift — safe because we only need a stable
// Y/M/D, not a particular wall-clock hour.
export function shiftDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

export type Slot = "today" | "thisWeek" | "thisMonth" | "lastWeek" | "lastMonth";

export type SeedPlan = {
  // Map from slot → UTC instant when that ticket should be `closed_at`.
  // A null value means "skip this slot in the current calendar branch".
  instants: Record<Slot, Date | null>;
  // Which slots end up inside each window. Derived from `instants` against
  // the same window boundaries the dashboard query uses.
  inToday: Slot[];
  inWeek: Slot[];
  inMonth: Slot[];
};

// Produce a per-slot seed plan keyed off "now" in the salon TZ. Useful for
// any spec that wants to assert Today / Week / Month period switching:
//   - Slot `today`     → today noon LA (or now-30m if past noon)
//   - Slot `thisWeek`  → an LA-local instant inside this week but before
//                        today (null when today is Monday)
//   - Slot `thisMonth` → an LA-local instant inside this month but before
//                        this week (null when today is in week 1)
//   - Slot `lastWeek`  → last Tuesday 14:00 LA — outside Today + Week
//   - Slot `lastMonth` → 5th of last month 14:00 LA — outside all windows
//
// Each branch may yield null when the calendar doesn't support it; the
// `inToday` / `inWeek` / `inMonth` arrays are derived from what was
// actually seeded so the caller can compute expected aggregates without
// guessing.
export function buildSeedPlan(now: Date): SeedPlan {
  const t = laParts(now);

  // Slot 1 — today. Pick an instant safely in the past today: noon LA, or
  // if local time is already past noon, fall back to "now minus 30 minutes"
  // so the instant is guaranteed to be `<= now()` AND inside today's window.
  const todayNoonUtc = utcFromLaWall(t.year, t.month, t.day, 12);
  const todayInstant =
    todayNoonUtc.getTime() <= now.getTime() ? todayNoonUtc : new Date(now.getTime() - 30 * 60_000);

  // Slot 2 — in-this-week-not-today. Only valid when today's weekday > Mon,
  // because the week starts Monday in LA. Pin to Tuesday-of-this-week 14:00
  // when today is mid-or-late week; pin to Monday-of-this-week 14:00 when
  // today IS Tuesday (so the in-week ticket is strictly before today).
  // Returns null when today is Monday.
  let thisWeekInstant: Date | null = null;
  if (t.weekday >= 2) {
    // today is Wed–Sun → use Tuesday of this week
    const tueOff = t.weekday - 1;
    const tue = shiftDays(t.year, t.month, t.day, -tueOff);
    thisWeekInstant = utcFromLaWall(tue.year, tue.month, tue.day, 14);
  } else if (t.weekday === 1) {
    // today is Tuesday → use Monday of this week
    const mon = shiftDays(t.year, t.month, t.day, -1);
    thisWeekInstant = utcFromLaWall(mon.year, mon.month, mon.day, 14);
  }
  // weekday === 0 (Monday): leave null — no "in-week-but-not-today" exists.

  // Slot 3 — in-this-month-not-this-week. Pick the 5th of the current month
  // at 14:00 LA. Valid only when today's day-of-month is past the 7th (so
  // the 5th is strictly before this week's Monday).
  let thisMonthInstant: Date | null = null;
  if (t.day > 7) {
    thisMonthInstant = utcFromLaWall(t.year, t.month, 5, 14);
  }

  // Slot 4 — last-week negative control. last Tuesday at 14:00 LA. Always
  // valid (last week always existed); always strictly before this week's
  // Monday, hence outside the Week and Today windows.
  const lastTueOffset = t.weekday + 6;
  const lastTue = shiftDays(t.year, t.month, t.day, -lastTueOffset);
  const lastWeekInstant = utcFromLaWall(lastTue.year, lastTue.month, lastTue.day, 14);

  // Slot 5 — last-month negative control. 5th of last month at 14:00 LA.
  // shiftDays via the 1st handles wrap-around at January.
  const firstOfThisMonth = shiftDays(t.year, t.month, 1, 0);
  const dayInLastMonth = shiftDays(firstOfThisMonth.year, firstOfThisMonth.month, 1, -25);
  const lastMonthInstant = utcFromLaWall(dayInLastMonth.year, dayInLastMonth.month, 5, 14);

  const instants: Record<Slot, Date | null> = {
    today: todayInstant,
    thisWeek: thisWeekInstant,
    thisMonth: thisMonthInstant,
    lastWeek: lastWeekInstant,
    lastMonth: lastMonthInstant,
  };

  // Derive window membership from the actual seeded instants and current
  // `now`. Re-implementing window boundaries here so the plan is
  // independent of the Postgres query — if the helper's math is wrong the
  // caller's assertion will diverge from the page output.
  const todayStart = utcFromLaWall(t.year, t.month, t.day, 0);
  const mondayOffset = t.weekday;
  const mon = shiftDays(t.year, t.month, t.day, -mondayOffset);
  const weekStart = utcFromLaWall(mon.year, mon.month, mon.day, 0);
  const monthStart = utcFromLaWall(t.year, t.month, 1, 0);

  const inWindow = (instant: Date | null, start: Date): boolean =>
    instant !== null && instant.getTime() >= start.getTime() && instant.getTime() <= now.getTime();

  const slots: Slot[] = ["today", "thisWeek", "thisMonth", "lastWeek", "lastMonth"];
  const inToday = slots.filter((s) => inWindow(instants[s], todayStart));
  const inWeek = slots.filter((s) => inWindow(instants[s], weekStart));
  const inMonth = slots.filter((s) => inWindow(instants[s], monthStart));

  return { instants, inToday, inWeek, inMonth };
}
