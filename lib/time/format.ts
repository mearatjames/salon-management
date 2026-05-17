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
