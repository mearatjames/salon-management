// lib/time/format.ts
// -----------------------------------------------------------------------------
// Tiny tz-aware string formatters for the dashboard subtitle + last-sale time.
// Intl.DateTimeFormat only (no extra deps).

export function formatSubtitle(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

export function formatTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
}

/**
 * Long human-readable date (e.g. "June 6, 2026") for the staff-invite
 * email's inbox preview text (`{{ .Data.expires_human }}`). Formatted in
 * the salon's timezone so the calendar day matches the operator's locale
 * rather than UTC.
 */
export function formatExpiry(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  }).format(d);
}

/**
 * Returns a YYYY-MM-DD string for the local date that contains `date` in
 * the salon's timezone. Used by the End-of-Day close Server Action to
 * derive `p_business_day` from the operator's "now" — the date math is
 * intentionally local so a 23:59 PT close lands on the right calendar
 * day even when the server-side `new Date()` is already tomorrow in UTC.
 *
 * `en-CA` locale formats numerically as YYYY-MM-DD, which is also the
 * Postgres `date` literal shape, so the result can be passed through to
 * the RPC unparsed.
 */
export function salonDateString(tz: string, date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
