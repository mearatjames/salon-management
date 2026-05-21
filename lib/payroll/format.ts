// lib/payroll/format.ts
// -----------------------------------------------------------------------------
// Presentation helpers for the Payroll page — period labels and pay-date
// display. Pure string formatters; no I/O.
//
// The period range labels themselves (`"May 16 – 31, 2026"`) are already
// derived in `lib/payroll/window.ts` (`PayPeriodRef.label` / `.shortLabel`).
// This module adds the surrounding chrome copy: the "1st / 2nd half cycle"
// eyebrow and the weekday-stamped pay date.

import type { PayPeriodRef } from "@/lib/payroll/window";

// Parses a "YYYY-MM-DD" salon-local date string into a `Date` at UTC midnight —
// safe because we only ever read its calendar parts back with a fixed
// formatter, never an instant.
function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const PAY_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * The header eyebrow for a period — e.g. `"Payroll · 1st half cycle"`. The
 * half-cycle is the 1st when the period starts on day 1, otherwise the 2nd
 * (semi-monthly windows always start on the 1st or the 16th).
 */
export function formatPeriodEyebrow(period: PayPeriodRef): string {
  const startDay = Number(period.startsOn.split("-")[2] ?? "1");
  const half = startDay <= 15 ? "1st" : "2nd";
  return `Payroll · ${half} half cycle`;
}

/**
 * The pay date with its weekday — e.g. `"Tue, Jun 2"`. Used in the header
 * subtitle ("Pay date Tue, Jun 2").
 */
export function formatPayDate(period: PayPeriodRef): string {
  return PAY_DATE_FMT.format(dateFromIso(period.payDate));
}

/**
 * Just the weekday of the pay date — e.g. `"Tue"`. Kept separate for places
 * that already render the date and only need the day name.
 */
export function formatPayDateWeekday(period: PayPeriodRef): string {
  return WEEKDAY_FMT.format(dateFromIso(period.payDate));
}

/**
 * A short paid-on label for a payout receipt — e.g. `"May 20"`. `null` →
 * empty string (a `paid=false` frozen row has no paid date).
 */
export function formatPaidOn(paidOn: string | null): string {
  if (!paidOn) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dateFromIso(paidOn));
}

/**
 * A short closed-on label for a History row — e.g. `"May 17"`. The input is a
 * full ISO timestamp (`pay_periods.closed_at`); only its date is shown, read in
 * the salon timezone so the day matches the operator's wall clock. An empty /
 * missing value → empty string.
 */
export function formatClosedOn(closedAt: string, tz: string): string {
  if (!closedAt) return "";
  const instant = new Date(closedAt);
  if (Number.isNaN(instant.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(instant);
}
