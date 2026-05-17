// Default card-fee constant for the services-catalog feature
// (`021-services-deductions`).
//
// Per `data-model.md § 2.4`:
//   - `DEFAULT_CARD_FEE_CENTS = 300` (the salon's house "$3 per card swipe"
//     fee that every service uses unless overridden via the per-service
//     `card_fee_mode` = `'custom'` or `'exempt'`).
//   - `formatDefaultCardFeeLabel()` returns the Lacquer currency
//     convention: whole dollars are rendered without `.00` (so `$3`, not
//     `$3.00`); non-whole dollars include two decimals.
//
// IMPORTANT: this module is importable from both client and server bundles
// — no `"use server"` or `"use client"` directive. The named constant is
// referenced by the panel preview (client) and by the audit-payload
// snapshot in Server Actions (server).

export const DEFAULT_CARD_FEE_CENTS = 300;

/**
 * Render the default card-fee amount as a Lacquer currency label.
 *
 * Whole dollars: `$3`. Non-whole dollars: `$3.50`.
 */
export function formatDefaultCardFeeLabel(): string {
  const dollars = DEFAULT_CARD_FEE_CENTS / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
