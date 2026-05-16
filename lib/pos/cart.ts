// Pure cart math. The single source of truth for "what should subtotal /
// total / chargeEligible be given these lines" — used both by the client
// island (for instant-update of the cart-summary UI) and mirrored on the
// server by the action's totals-recompute path (`addServiceLine` /
// `removeLine` / `setLinePrice` / `addDiscountLine` / `removeDiscountLine`
// write `tickets.subtotal_cents` and `tickets.total_cents` using the same
// shape).
//
// The server is the authority; this helper exists so the client can show
// an instant total without waiting for the round-trip. `pos_take_cash`
// (data-model.md § 5) reads `tickets.total_cents` under row lock at charge
// time, so a stale client view can never short-charge a sale (R1).
//
// v1 invariants:
//   - `taxCents` is always the literal 0 (FR-020; CHECK on `tickets.tax_cents`).
//   - A service line with `priceUnconfirmed === true` (e.g. a variable-
//     price service whose final price has not been entered yet) does NOT
//     contribute to `subtotalCents`, AND its presence in the cart forces
//     `chargeEligible` to false (FR-015 / FR-016).
//
// Feature 013-cart-polish additions:
//   - Discount lines (`kind === 'discount'`) carry a negative
//     `unitPriceCents`. Flat discounts ship that amount verbatim; percent
//     discounts (`discountPct != null`) are recomputed in this helper
//     against the live service subtotal so the client view never goes
//     stale when another service line is added/removed. The server's
//     `recomputeTicketTotals` does the same math on write so the
//     persisted `unit_price_cents` matches the displayed value.
//   - `subtotalCents` is floored at 0 — an over-discount displays as $0
//     and `chargeEligible` is false (FR-017).

export type CartItem = {
  kind: "service" | "discount";
  unitPriceCents: number;
  qty: number;
  priceUnconfirmed: boolean;
  /** Whole-percent value (1..100) for percent-shape discounts; null for
   *  flat discounts and for service lines. Mirrors `ticket_items.discount_pct`. */
  discountPct?: number | null;
};

export type CartTotals = {
  /** Pre-discount sum of confirmed service lines. Surfaced so the BillSheet
   *  can use it as the "Subtotal" line AND as the gratuity baseline (per the
   *  spec's "Suggested-gratuity baseline on the bill" edge case — tip on the
   *  gross service amount, restaurant convention). */
  serviceSubtotalCents: number;
  /** Sum of all discount lines (already negative or zero). */
  discountTotalCents: number;
  /** `max(0, serviceSubtotal + discountTotal)` — over-discounts floor to 0. */
  subtotalCents: number;
  taxCents: 0;
  totalCents: number;
  chargeEligible: boolean;
};

export function computeTotals(items: CartItem[]): CartTotals {
  // Service subtotal — only confirmed service lines contribute.
  const serviceSubtotalCents = items
    .filter((i) => i.kind === "service" && !i.priceUnconfirmed)
    .reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0);

  // Discount total — sum of all discount lines. Percent rows are recomputed
  // here against the live service subtotal so the client view stays in sync
  // with what the server's recomputeTicketTotals will write on the next
  // mutation.
  const discountTotalCents = items
    .filter((i) => i.kind === "discount")
    .reduce((sum, i) => {
      if (i.discountPct != null) {
        return sum - Math.round((i.discountPct * serviceSubtotalCents) / 100);
      }
      // Flat discount: unitPriceCents is already negative (or zero).
      return sum + i.unitPriceCents * i.qty;
    }, 0);

  const subtotalCents = Math.max(0, serviceSubtotalCents + discountTotalCents);
  const taxCents = 0 as const;
  const totalCents = subtotalCents + taxCents;
  const chargeEligible = totalCents > 0 && items.every((i) => !i.priceUnconfirmed);
  return {
    serviceSubtotalCents,
    discountTotalCents,
    subtotalCents,
    taxCents,
    totalCents,
    chargeEligible,
  };
}
