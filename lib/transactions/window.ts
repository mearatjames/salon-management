// lib/transactions/window.ts
// -----------------------------------------------------------------------------
// Pure period-window resolution for the Transactions page.
//
// `parsePeriodParams` sanitises the raw `?period=&offset=` search params into a
// safe `{ granularity, offset }` pair; `resolveWindow` turns that pair into a
// fully-described `PeriodWindow` — UTC bounds, `isCurrent`, and the human
// labels the header renders.
//
// Timezone math is delegated to the offset-aware helpers in
// `lib/time/period-windows.ts` (the constitution mandates one `lib/time/*`
// surface). Label construction is feature presentation, so it lives here, not
// there (research R2).
//
// See contracts/transactions-read-model.md § C3 and data-model.md § 3.

import { dayWindowAt, monthWindowAt, weekWindowAt } from "@/lib/time/period-windows";

export type PeriodGranularity = "today" | "week" | "month";

export type PeriodWindow = {
  readonly granularity: PeriodGranularity;
  /** 0 = current period, clamped ≤ 0 (forward stepping is forbidden). */
  readonly offset: number;
  /** Inclusive UTC start of the period. */
  readonly start: Date;
  /** Exclusive UTC end of the period (start of the next period). */
  readonly end: Date;
  /** `true` iff `offset === 0`. */
  readonly isCurrent: boolean;
  /** Header label, e.g. `"This week"`, `"Last week"`, `"Week of May 5"`. */
  readonly label: string;
  /** Date-range label, e.g. `"May 12, 2026"` or `"May 5 – 11, 2026"`. */
  readonly rangeLabel: string;
};

const GRANULARITIES: readonly PeriodGranularity[] = ["today", "week", "month"];

/**
 * Sanitises the raw `?period=&offset=` search params (contract C1/C3):
 *  - invalid / missing `period` → `"week"`;
 *  - non-numeric / non-integer `offset` → `0`;
 *  - positive `offset` clamps to `0` (forward stepping forbidden).
 */
export function parsePeriodParams(raw: { period?: string; offset?: string }): {
  granularity: PeriodGranularity;
  offset: number;
} {
  const granularity: PeriodGranularity = GRANULARITIES.includes(raw.period as PeriodGranularity)
    ? (raw.period as PeriodGranularity)
    : "week";

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

function dayLabel(tz: string, start: Date): { label: string; rangeLabel: string } {
  const p = partsInTz(tz, start);
  const formatted = `${p.month} ${p.day}, ${p.year}`;
  return { label: formatted, rangeLabel: formatted };
}

function weekLabels(
  tz: string,
  start: Date,
  end: Date,
  offset: number
): { label: string; rangeLabel: string } {
  const startP = partsInTz(tz, start);
  const lastP = partsInTz(tz, lastInstant(end));

  let label: string;
  if (offset === 0) label = "This week";
  else if (offset === -1) label = "Last week";
  else label = `Week of ${shortMonth(tz, start)} ${startP.day}`;

  // Range: "Apr 27 – May 3, 2026"; the year shows once, at the end.
  const startStr = `${shortMonth(tz, start)} ${startP.day}`;
  const endStr = `${shortMonth(tz, lastInstant(end))} ${lastP.day}`;
  const rangeLabel = `${startStr} – ${endStr}, ${lastP.year}`;

  return { label, rangeLabel };
}

function monthLabels(
  tz: string,
  start: Date,
  offset: number
): { label: string; rangeLabel: string } {
  const p = partsInTz(tz, start);
  const monthYear = `${p.month} ${p.year}`;

  let label: string;
  if (offset === 0) label = "This month";
  else if (offset === -1) label = "Last month";
  else label = monthYear;

  return { label, rangeLabel: monthYear };
}

/**
 * Resolves a `(granularity, offset)` pair into a full `PeriodWindow` for the
 * salon timezone `tz` relative to `now`. `offset` is clamped to ≤ 0 — forward
 * stepping past the current period is forbidden (data-model.md § 4).
 */
export function resolveWindow(
  tz: string,
  granularity: PeriodGranularity,
  offset: number,
  now: Date
): PeriodWindow {
  const safeOffset = Math.min(0, offset);

  let start: Date;
  let end: Date;
  let label: string;
  let rangeLabel: string;

  if (granularity === "today") {
    [start, end] = dayWindowAt(tz, now, safeOffset);
    if (safeOffset === 0) {
      label = "Today";
      ({ rangeLabel } = dayLabel(tz, start));
    } else if (safeOffset === -1) {
      label = "Yesterday";
      ({ rangeLabel } = dayLabel(tz, start));
    } else {
      ({ label, rangeLabel } = dayLabel(tz, start));
    }
  } else if (granularity === "week") {
    [start, end] = weekWindowAt(tz, now, safeOffset);
    ({ label, rangeLabel } = weekLabels(tz, start, end, safeOffset));
  } else {
    [start, end] = monthWindowAt(tz, now, safeOffset);
    ({ label, rangeLabel } = monthLabels(tz, start, safeOffset));
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
