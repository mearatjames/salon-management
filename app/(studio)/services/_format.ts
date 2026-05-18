// Price-label formatter for the catalog row + drawer preview.
// Per `contracts/ui.contract.md § 3` and `research.md § R1`:
//
//   fixed price:  $45  /  $45.50  /  $0
//   variable:
//     neither bound  → "Variable"
//     only `from`    → "From $20"
//     both bounds    → "$20 – $60"  (en dash; equal bounds rendered as the same range)
//     only `to`      → "Variable"   (defensive — UI requires `from` before `to`)

import type { CardFeeMode, CatalogService } from "./_types";

/**
 * Lacquer currency convention — whole dollars rendered without `.00`
 * (e.g. `$5`, `$45`); non-whole values render the two-decimal cents
 * (e.g. `$4.50`). Negative inputs prefix `-` (so the caller renders
 * `−$3` by lemma).
 *
 * Exported so the deductions section's Net-to-tech preview (US4) and the
 * chip helpers below share a single conversion path; the helper is pure +
 * importable from both client and server bundles.
 */
export function formatDollarsFromCents(cents: number): string {
  return formatDollars(cents);
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  if (remainder === 0) {
    return `${sign}$${dollars}`;
  }
  return `${sign}$${dollars}.${remainder.toString().padStart(2, "0")}`;
}

export function formatPriceLabel(
  service: Pick<
    CatalogService,
    "price_cents" | "variable_price" | "price_from_cents" | "price_to_cents"
  >
): string {
  if (!service.variable_price) {
    return formatDollars(service.price_cents);
  }
  const { price_from_cents: from, price_to_cents: to } = service;
  if (from === null && to === null) return "Variable";
  if (from !== null && to === null) return `From ${formatDollars(from)}`;
  if (from === null && to !== null) return "Variable";
  // both non-null
  return `${formatDollars(from as number)} – ${formatDollars(to as number)}`;
}

// ── 021-services-deductions chip helpers ───────────────────────────────

/**
 * Render the card-fee chip text:
 *   - `mode='default'` → `"$3 card fee"` (using `defaultCents`).
 *   - `mode='custom'`  → `"$X card fee"` (using `customCents`, defensive
 *      `?? 0` if the row is mid-edit).
 *   - `mode='exempt'`  → `null` (caller decides what to render — typically
 *      nothing on the row, or the muted "No fees" chip when supply is also
 *      off, per `contracts/ui.contract.md § 4.1`).
 */
export function formatCardFeeChipText(
  mode: CardFeeMode,
  customCents: number | null,
  defaultCents: number
): string | null {
  if (mode === "exempt") return null;
  const cents = mode === "custom" ? (customCents ?? 0) : defaultCents;
  return `${formatDollars(cents)} card fee`;
}

/**
 * Render the supply chip text — e.g. `"$5 GelX tips & gel"`. The caller
 * is responsible for skipping the chip entirely when supply is off.
 *
 * 022-supply-types-catalog: signature changed from `(amount, label)` to
 * `(amount, name)`. The `name` parameter is the catalog-resolved
 * `supply_types.name` value (formerly the row's free-text `supply_label`).
 * String in, string out, same render — callers now pass
 * `service.supply_type_name` instead of `service.supply_label`.
 */
export function formatSupplyChipText(amountCents: number, name: string): string {
  return `${formatDollars(amountCents)} ${name}`;
}
