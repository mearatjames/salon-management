// lib/time/period-windows.ts
// -----------------------------------------------------------------------------
// Timezone-aware period boundary helpers for the dashboard's read model.
//
// The single source of truth for "what day / week / month is it in the salon's
// local time?" — the constitution mandates one `lib/time/*` helper as the only
// timezone surface (§ Security & Data Integrity Constraints).
//
// Implementation strategy: Intl.DateTimeFormat only (no date-fns-tz, no Temporal
// polyfill, no dayjs). The "two-step technique" handles DST correctly:
//   1. Read the local wall-clock parts of `now` in the target tz.
//   2. Pretend those parts are UTC, then ask Intl what the offset to UTC would
//      be at that pretend-UTC instant in the target tz. Subtracting that offset
//      gives the true UTC instant for "local midnight in the target tz".
//
// Pure functions — no Supabase, no React, no Node-only APIs.

export function salonNow(_tz: string): Date {
  return new Date();
}

// Returns the UTC instant corresponding to "local midnight in `tz` on the
// local date that contains `instant`" (i.e. the candidate local Y-M-D 00:00).
function localMidnightUtc(tz: string, instant: Date): Date {
  return localStartOfDayUtc(tz, instant, 0);
}

// Returns the UTC instant corresponding to "local midnight in `tz` on the
// local date `daysOffset` away from the local date that contains `instant`".
function localStartOfDayUtc(tz: string, instant: Date, daysOffset: number): Date {
  const parts = formatPartsInTz(tz, instant);
  let year = Number(parts.year);
  let month = Number(parts.month); // 1-12
  let day = Number(parts.day);

  if (daysOffset !== 0) {
    // Date math via UTC is safe — we only need a stable local Y/M/D, not a
    // particular wall-clock hour. Treat the local Y-M-D as UTC, shift, then
    // pull the new Y-M-D back out.
    const shifted = new Date(Date.UTC(year, month - 1, day));
    shifted.setUTCDate(shifted.getUTCDate() + daysOffset);
    year = shifted.getUTCFullYear();
    month = shifted.getUTCMonth() + 1;
    day = shifted.getUTCDate();
  }

  return utcFromLocalParts(tz, year, month, day, 0, 0, 0);
}

// Returns the UTC instant corresponding to "local midnight in `tz` on the
// first day of the local month that contains `instant`".
function localStartOfMonthUtc(tz: string, instant: Date): Date {
  const parts = formatPartsInTz(tz, instant);
  const year = Number(parts.year);
  const month = Number(parts.month); // 1-12
  return utcFromLocalParts(tz, year, month, 1, 0, 0, 0);
}

// Returns the UTC instant corresponding to "local midnight in `tz` on the
// most recent local Monday at or before the local date of `instant`".
function localStartOfWeekUtc(tz: string, instant: Date): Date {
  const parts = formatPartsInTz(tz, instant);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);

  // Compute weekday locally. We need the local weekday of the (year, month,
  // day) tuple; the simplest way is to use Intl.DateTimeFormat once more.
  // weekday=short returns "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun".
  // We construct a candidate UTC instant at local midnight, format it back in
  // the same tz, and read the resulting weekday.
  const candidateUtc = utcFromLocalParts(tz, year, month, day, 0, 0, 0);
  const weekdayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: tz,
  });
  const wd = weekdayFmt.format(candidateUtc);
  const orderFromMonday: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = orderFromMonday[wd] ?? 0;
  if (offset === 0) {
    return candidateUtc;
  }
  return localStartOfDayUtc(tz, instant, -offset);
}

// Build a UTC Date from a (year, month, day, h, m, s) tuple interpreted as
// LOCAL wall-clock time in `tz`. Uses the two-step technique to remain DST
// correct: build a "pretend UTC" Date with those parts, look up the actual
// offset to UTC at that instant in `tz`, then subtract the offset.
function utcFromLocalParts(
  tz: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number
): Date {
  // First pass: candidate is the instant Date.UTC(...) gives us.
  const candidateMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = tzOffsetMs(tz, new Date(candidateMs));
  // Second pass: re-ask using the corrected instant. This handles DST edges
  // where the first-pass offset and the second-pass offset disagree.
  const correctedMs = candidateMs - offsetMs;
  const offsetMs2 = tzOffsetMs(tz, new Date(correctedMs));
  return new Date(candidateMs - offsetMs2);
}

// Returns the offset (in ms) that must be subtracted from a UTC instant to
// reach the local wall-clock time in `tz` at that instant. E.g. for
// America/Los_Angeles in PDT (UTC-7), this returns -7 * 60 * 60 * 1000
// (negative because local time is "earlier" — UTC midnight is local 17:00 the
// previous day, so to go UTC → local you subtract -7h, i.e. add 7h… wait,
// let's be precise):
//
//   UTC 07:00  →  local (PDT) 00:00.  local - UTC = -7h.
//   So to convert local-wall-as-pseudo-UTC back to true UTC:
//     trueUtcMs = pseudoUtcMs - (local - UTC) = pseudoUtcMs - (-7h)
//                = pseudoUtcMs + 7h.
//   That matches the call site `candidateMs - offsetMs` where offsetMs is
//   `local - UTC` in ms.
function tzOffsetMs(tz: string, instant: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatPartsToRecord(fmt.formatToParts(instant));
  const localUtcLikeMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  // local - UTC, in milliseconds.
  return localUtcLikeMs - instant.getTime();
}

function formatPartsInTz(
  tz: string,
  instant: Date
): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatPartsToRecord(fmt.formatToParts(instant));
  return {
    year: parts.year ?? "1970",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: (parts.hour === "24" ? "00" : parts.hour) ?? "00",
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

function formatPartsToRecord(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      out[p.type] = p.value;
    }
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────

export function todayWindow(tz: string, now: Date): readonly [Date, Date] {
  return [localMidnightUtc(tz, now), now];
}

export function weekWindow(tz: string, now: Date): readonly [Date, Date] {
  return [localStartOfWeekUtc(tz, now), now];
}

export function monthWindow(tz: string, now: Date): readonly [Date, Date] {
  return [localStartOfMonthUtc(tz, now), now];
}
