// lib/payroll/window.ts
// -----------------------------------------------------------------------------
// Pure pay-period resolution for the Payroll page.
//
// `resolvePayPeriod` turns a `(tz, now, offset)` triple into a fully-described
// `PayPeriodRef` — salon-local boundary dates, the pay date, status, and the
// human labels the header renders. Timezone math is delegated to the
// offset-aware `semiMonthlyWindowAt` helper in `lib/time/period-windows.ts`
// (the constitution mandates one `lib/time/*` surface); label construction is
// feature presentation, so it lives here.
//
// `parsePayrollParams` sanitises the raw `?offset=&filter=` search params into
// a safe `{ offset, filter }` pair. `offset` clamps to ≤ 0 — there are no
// future pay periods — mirroring `lib/report/window.ts`.
//
// See specs/047-payroll-page/data-model.md and contracts/read-model.md.

import { semiMonthlyWindowAt } from "@/lib/time/period-windows";

export type PayPeriodRef = {
  /** `null` until the `pay_periods` row is lazily created. */
  id: string | null;
  /** Salon-local inclusive start date, e.g. `"2026-05-16"`. */
  startsOn: string;
  /** Salon-local inclusive end date, e.g. `"2026-05-31"`. */
  endsOn: string;
  /** Pay date — `endsOn + 2 days`, e.g. `"2026-06-02"`. */
  payDate: string;
  status: "open" | "closed";
  /** Header label, e.g. `"May 16 – 31, 2026"`. */
  label: string;
  /** Compact label without the year, e.g. `"May 16 – 31"`. */
  shortLabel: string;
  /** 0 = current period, negative = past; never positive. */
  offset: number;
  /** `true` iff `offset === 0`. */
  isCurrent: boolean;
};

export type PayrollFilter = "all" | "to-pay" | "paid";

const FILTERS: readonly PayrollFilter[] = ["all", "to-pay", "paid"];

/**
 * Sanitises the raw `?offset=&filter=` search params:
 *  - non-numeric / non-integer / missing `offset` → `0`;
 *  - positive `offset` clamps to `0` (no future pay periods);
 *  - invalid / missing `filter` → `"all"`.
 */
export function parsePayrollParams(raw: { offset?: string; filter?: string }): {
  offset: number;
  filter: PayrollFilter;
} {
  let offset = 0;
  if (raw.offset !== undefined && raw.offset !== "") {
    const parsed = Number(raw.offset);
    if (Number.isInteger(parsed)) {
      offset = Math.min(0, parsed);
    }
  }

  const filter: PayrollFilter = FILTERS.includes(raw.filter as PayrollFilter)
    ? (raw.filter as PayrollFilter)
    : "all";

  return { offset, filter };
}

/**
 * Builds a `PayPeriodRef` from raw `pay_periods` columns (the History query
 * reads closed periods straight from the table rather than resolving them by
 * offset). The dates are plain "YYYY-MM-DD" salon-local calendar strings — the
 * label math is timezone-free UTC arithmetic on the calendar parts. `offset` is
 * left at `0` (History entries are addressed by their `id`, never by offset).
 */
export function payPeriodRefFromRow(row: {
  id: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
  status: "open" | "closed";
}): PayPeriodRef {
  const [, sm, sd] = row.startsOn.split("-").map(Number);
  const [, em, ed] = row.endsOn.split("-").map(Number);
  const [ey] = row.endsOn.split("-").map(Number);
  const startMonth = MONTHS_SHORT[(sm - 1 + 12) % 12];
  const endMonth = MONTHS_SHORT[(em - 1 + 12) % 12];
  const rangeBody =
    startMonth === endMonth
      ? `${startMonth} ${sd} – ${ed}`
      : `${startMonth} ${sd} – ${endMonth} ${ed}`;
  return {
    id: row.id,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    payDate: row.payDate,
    status: row.status,
    label: `${rangeBody}, ${ey}`,
    shortLabel: rangeBody,
    offset: 0,
    isCurrent: false,
  };
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ── Salon-local date helpers ────────────────────────────────────────────────

// The window's bounds are UTC instants for local midnights. We read their
// salon-local calendar parts with Intl in the salon tz.
function partsInTz(tz: string, instant: Date): { month: number; day: number; year: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    month: Number(map.month ?? "1"),
    day: Number(map.day ?? "1"),
    year: Number(map.year ?? "1970"),
  };
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "2026-05-16" — salon-local ISO date for a UTC instant at local midnight.
function isoDate(tz: string, instant: Date): string {
  const p = partsInTz(tz, instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// Add `days` calendar days to a "YYYY-MM-DD" string via UTC math (no tz needed —
// the input and output are both plain calendar dates).
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate()
  )}`;
}

/**
 * Resolves a `(tz, now, offset)` triple into a full `PayPeriodRef`. `offset` is
 * clamped to ≤ 0 — there are no future pay periods. The `id` is always `null`:
 * the caller pairs this read model with the lazily-created `pay_periods` row.
 * `status` defaults to `"open"`; callers overwrite it from the DB row when one
 * exists and is closed.
 */
export function resolvePayPeriod(tz: string, now: Date, offset: number): PayPeriodRef {
  const safeOffset = Math.min(0, offset);
  const [start, end] = semiMonthlyWindowAt(tz, now, safeOffset);
  const last = lastInstant(end);

  const startsOn = isoDate(tz, start);
  const endsOn = isoDate(tz, last);
  const payDate = addDays(endsOn, 2);

  const startMonth = shortMonth(tz, start);
  const endMonth = shortMonth(tz, last);
  const startP = partsInTz(tz, start);
  const lastP = partsInTz(tz, last);

  // Within one month the trailing month name is redundant ("May 16 – 31").
  const rangeBody =
    startMonth === endMonth
      ? `${startMonth} ${startP.day} – ${lastP.day}`
      : `${startMonth} ${startP.day} – ${endMonth} ${lastP.day}`;

  return {
    id: null,
    startsOn,
    endsOn,
    payDate,
    status: "open",
    label: `${rangeBody}, ${lastP.year}`,
    shortLabel: rangeBody,
    offset: safeOffset,
    isCurrent: safeOffset === 0,
  };
}
