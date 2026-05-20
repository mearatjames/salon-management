// lib/report/window.ts
// -----------------------------------------------------------------------------
// Pure period-window resolution for the Report page.
//
// `parseReportPeriodParams` sanitises the raw `?period=&offset=` search params
// into a safe `{ granularity, offset }` pair; `resolveReportWindow` turns that
// pair into a fully-described `ReportWindow` — UTC bounds, `isCurrent`, and the
// human labels the header renders.
//
// Timezone math is delegated to the offset-aware helpers in
// `lib/time/period-windows.ts` (the constitution mandates one `lib/time/*`
// surface — `semiMonthlyWindowAt` is new there for this feature). Label
// construction is feature presentation, so it lives here.
//
// See data-model.md §4 and contracts/report-read-model.md § C4.

import { dayWindowAt, semiMonthlyWindowAt, weekWindowAt } from "@/lib/time/period-windows";

export type ReportGranularity = "day" | "week" | "semi";

export type ReportWindow = {
  readonly granularity: ReportGranularity;
  /** 0 = current period, clamped ≤ 0 (forward stepping is forbidden). */
  readonly offset: number;
  /** Inclusive UTC start of the period. */
  readonly start: Date;
  /** Exclusive UTC end of the period (start of the next period). */
  readonly end: Date;
  /** `true` iff `offset === 0` — disables the "next" arrow. */
  readonly isCurrent: boolean;
  /** Header label, e.g. `"Today"`, `"Last week"`, `"This pay period"`. */
  readonly label: string;
  /** Date-range label, e.g. `"May 16, 2026"` or `"May 1 – 15, 2026"`. */
  readonly rangeLabel: string;
};

const GRANULARITIES: readonly ReportGranularity[] = ["day", "week", "semi"];

/**
 * Sanitises the raw `?period=&offset=` search params (contract C1/C4):
 *  - invalid / missing `period` → `"day"` (the default granularity);
 *  - non-numeric / non-integer `offset` → `0`;
 *  - positive `offset` clamps to `0` (forward stepping forbidden).
 */
export function parseReportPeriodParams(raw: { period?: string; offset?: string }): {
  granularity: ReportGranularity;
  offset: number;
} {
  const granularity: ReportGranularity = GRANULARITIES.includes(raw.period as ReportGranularity)
    ? (raw.period as ReportGranularity)
    : "day";

  let offset = 0;
  if (raw.offset !== undefined && raw.offset !== "") {
    const parsed = Number(raw.offset);
    if (Number.isInteger(parsed)) {
      offset = Math.min(0, parsed);
    }
  }

  return { granularity, offset };
}

// ── Label helpers ──────────────────────────────────────────────────────────

// The window's bounds are UTC instants for local midnights. We format their
// salon-local calendar parts with Intl in the salon tz.
function partsInTz(tz: string, instant: Date): { month: string; day: number; year: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return { month: map.month ?? "", day: Number(map.day ?? "1"), year: Number(map.year ?? "1970") };
}

// Short month name in the salon tz, e.g. "May".
function shortMonth(tz: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(instant);
}

// `end` is the exclusive start of the next period; the period's last day is the
// instant one millisecond before it.
function lastInstant(end: Date): Date {
  return new Date(end.getTime() - 1);
}

function dayLabel(tz: string, start: Date): string {
  const p = partsInTz(tz, start);
  return `${p.month} ${p.day}, ${p.year}`;
}

// "May 11 – 17, 2026" — the year shows once, at the end; the month repeats only
// when the range straddles two months ("Apr 27 – May 3, 2026").
function rangeBetween(tz: string, start: Date, end: Date): string {
  const last = lastInstant(end);
  const startP = partsInTz(tz, start);
  const lastP = partsInTz(tz, last);
  const startMonth = shortMonth(tz, start);
  const endMonth = shortMonth(tz, last);
  const startStr = `${startMonth} ${startP.day}`;
  // Within one month the trailing month name is redundant ("May 11 – 17").
  const endStr = startMonth === endMonth ? `${lastP.day}` : `${endMonth} ${lastP.day}`;
  return `${startStr} – ${endStr}, ${lastP.year}`;
}

function weekLabel(offset: number): string {
  if (offset === 0) return "This week";
  if (offset === -1) return "Last week";
  return `${-offset} weeks ago`;
}

function semiLabel(offset: number): string {
  if (offset === 0) return "This pay period";
  if (offset === -1) return "Last pay period";
  return `${-offset} pay periods ago`;
}

/**
 * Resolves a `(granularity, offset)` pair into a full `ReportWindow` for the
 * salon timezone `tz` relative to `now`. `offset` is clamped to ≤ 0 — forward
 * stepping past the current period is forbidden (data-model.md §4).
 */
export function resolveReportWindow(
  tz: string,
  granularity: ReportGranularity,
  offset: number,
  now: Date
): ReportWindow {
  const safeOffset = Math.min(0, offset);

  let start: Date;
  let end: Date;
  let label: string;
  let rangeLabel: string;

  if (granularity === "day") {
    [start, end] = dayWindowAt(tz, now, safeOffset);
    rangeLabel = dayLabel(tz, start);
    if (safeOffset === 0) label = "Today";
    else if (safeOffset === -1) label = "Yesterday";
    else label = rangeLabel;
  } else if (granularity === "week") {
    [start, end] = weekWindowAt(tz, now, safeOffset);
    label = weekLabel(safeOffset);
    rangeLabel = rangeBetween(tz, start, end);
  } else {
    [start, end] = semiMonthlyWindowAt(tz, now, safeOffset);
    label = semiLabel(safeOffset);
    rangeLabel = rangeBetween(tz, start, end);
  }

  return {
    granularity,
    offset: safeOffset,
    start,
    end,
    isCurrent: safeOffset === 0,
    label,
    rangeLabel,
  };
}
