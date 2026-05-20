// lib/transactions/format.ts
// -----------------------------------------------------------------------------
// Pure presentation helpers for the Transactions page. No timezone math, no
// Supabase, no React — every input is already a plain string. Importable on
// the client.
//
// Day keys are `YYYY-MM-DD` strings the server pre-computed via
// `salonDateString(tz, …)` — they carry no timezone, so the formatters here
// interpret them as plain calendar dates (parsed as UTC noon to dodge any
// host-locale DST edge).

/**
 * Renders a ticket UUID as its short display id: `#` followed by the last six
 * hex characters of the UUID, uppercased (research R4). Hyphens are stripped
 * before slicing so the six chars are always real hex digits. The raw UUID is
 * never shown to the operator; search matches this displayed form.
 */
export function formatTxId(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  return `#${hex.slice(-6).toUpperCase()}`;
}

// Parse a `YYYY-MM-DD` key into a UTC Date at noon — noon keeps the calendar
// date stable regardless of the host timezone when Intl formats it back.
function dayKeyToUtcNoon(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Renders a `YYYY-MM-DD` day key as a full date label, e.g. `"May 12, 2026"`.
 * The day is not zero-padded (`"January 3, 2026"`).
 */
export function formatDayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayKeyToUtcNoon(dayKey));
}

/**
 * Renders a `YYYY-MM-DD` day key relative to `todayKey`:
 *  - `"Today"` when it is the current day,
 *  - `"Yesterday"` for one day back,
 *  - `"N days ago"` for 2–6 days back,
 *  - the short weekday name (`"Mon"`) for 7+ days back.
 *
 * Both keys are salon-local dates the server produced, so the comparison is a
 * plain calendar-day diff.
 */
export function formatRelativeDay(dayKey: string, todayKey: string): string {
  const day = dayKeyToUtcNoon(dayKey);
  const today = dayKeyToUtcNoon(todayKey);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today.getTime() - day.getTime()) / dayMs);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(day);
}
