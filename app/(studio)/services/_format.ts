// Price-label formatter for the catalog row + drawer preview.
// Per `contracts/ui.contract.md § 3` and `research.md § R1`:
//
//   fixed price:  $45  /  $45.50  /  $0
//   variable:
//     neither bound  → "Variable"
//     only `from`    → "From $20"
//     both bounds    → "$20 – $60"  (en dash; equal bounds rendered as the same range)
//     only `to`      → "Variable"   (defensive — UI requires `from` before `to`)

import type { CatalogService } from "./_types";

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
