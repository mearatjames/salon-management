// Pure cart math. The single source of truth for "what should subtotal /
// total / chargeEligible be given these lines" — used both by the client
// island (for instant-update of the cart-summary UI) and mirrored on the
// server by the action's totals-recompute path (`addServiceLine` /
// `removeLine` write `tickets.subtotal_cents` and `tickets.total_cents`
// using the same shape).
//
// The server is the authority; this helper exists so the client can show
// an instant total without waiting for the round-trip. `pos_take_cash`
// (data-model.md § 5) reads `tickets.total_cents` under row lock at charge
// time, so a stale client view can never short-charge a sale (R1).
//
// v1 invariants (relaxed in later phases):
//   - `taxCents` is always the literal 0 (FR-020; CHECK on `tickets.tax_cents`).
//   - A line with `priceUnconfirmed === true` (e.g. a variable-price service
//     whose final price has not been entered yet) does NOT contribute to
//     `subtotalCents`, AND its presence in the cart forces `chargeEligible`
//     to false (FR-015 / FR-016).

export type CartItem = {
  unitPriceCents: number;
  qty: number;
  priceUnconfirmed: boolean;
};

export type CartTotals = {
  subtotalCents: number;
  taxCents: 0;
  totalCents: number;
  chargeEligible: boolean;
};

export function computeTotals(items: CartItem[]): CartTotals {
  const subtotalCents = items
    .filter((i) => !i.priceUnconfirmed)
    .reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0);
  const taxCents = 0 as const;
  const totalCents = subtotalCents + taxCents;
  const chargeEligible = totalCents > 0 && items.every((i) => !i.priceUnconfirmed);
  return { subtotalCents, taxCents, totalCents, chargeEligible };
}
