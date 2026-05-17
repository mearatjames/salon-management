// Pure aggregation helpers for the end-of-day cash count.
//
// Consumed by both `lib/end-of-day/cash-count.ts` (the server-only query
// layer) and `components/lacquer/eod/*` (the cash-list UI). Kept
// dependency-free so the same module can be unit-tested without spinning
// up Supabase or the Next runtime.
//
// Refund convention: cash refunds are surfaced as synthetic `CashRow`s
// whose `amountCents` is NEGATIVE and `kind === "refund"`. The current
// `payments.kind` enum only contains `'payment'`, so refunds don't
// materialise from the DB today — but `expectedCentsFromRows` is written
// to handle them so the helper stays correct when the refund flow lands.

export type TechBadge = {
  /** Stable identifier from the staff table; powers React keys. */
  id: string;
  /** 1–2 char initials drawn into the avatar circle (e.g. "JA"). */
  initials: string;
  /** Lacquer color token (e.g. "rose-500") that tints the badge background. */
  colorToken: string;
};

export type CashRow = {
  /** Underlying payment id (or refund id when refunds materialise). */
  id: string;
  /** Local-time-rendered processing instant. */
  processedAt: Date;
  /** 'payment' for sales; 'refund' for the synthetic refund row. */
  kind: "payment" | "refund";
  /** Client display name. Falls back to "Walk-in" when no client is attached. */
  client: string;
  /**
   * Pre-formatted services summary string ("Gel manicure", "A + B",
   * "A +2"). The row component renders this verbatim — formatting lives
   * in `formatServicesSummary` so the query layer and the UI agree.
   */
  services: string;
  /** Assigned technicians for the underlying ticket; 0..N. */
  techs: TechBadge[];
  /**
   * Signed cents. Payment rows are positive; refund rows are negative.
   * `expectedCentsFromRows` sums the signed values directly.
   */
  amountCents: number;
  /** Tip in cents (always non-negative; 0 today since tip_cents is 0). */
  tipCents: number;
};

/**
 * Sums the (signed) `amountCents` of every row. Refund rows carry a
 * negative `amountCents`, so a simple sum yields `sales - refunds`.
 * Returns 0 for an empty input.
 */
export function expectedCentsFromRows(rows: readonly CashRow[]): number {
  let total = 0;
  for (const row of rows) {
    total += row.amountCents;
  }
  return total;
}

/**
 * Formats a list of service names for the cash-row meta line:
 *   - []                  → ""
 *   - ["A"]               → "A"
 *   - ["A", "B"]          → "A + B"
 *   - ["A", "B", "C"]     → "A +2"
 *   - ["A", "B", "C", "D"] → "A +3"
 *
 * Mirrors the prototype's truncation rule from
 * `design-system/prototypes/transaction/EndOfDay.jsx` so the page matches
 * the design without bespoke per-row logic.
 */
export function formatServicesSummary(serviceNames: readonly string[]): string {
  if (serviceNames.length === 0) return "";
  if (serviceNames.length === 1) return serviceNames[0]!;
  if (serviceNames.length === 2) return `${serviceNames[0]} + ${serviceNames[1]}`;
  return `${serviceNames[0]} +${serviceNames.length - 1}`;
}
