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
//
// Feature 049-per-service-discount additions:
//   - `id` is now required on every CartItem. The id is either the
//     persisted `ticket_items.id` (server side / persisted-mode client)
//     or the client-generated `clientLineId` (ephemeral draft mode).
//   - `discountTargetIds?: readonly string[] | null` lets a discount line
//     scope itself to a subset of service lines on the same ticket.
//     `null`/omitted = "applies to all services" (today's default,
//     backward-compatible). Non-null = scoped to those ids.
//   - `computeTotals` now partitions discount lines into scoped + all-
//     services and applies them in the FR-009 order:
//        1. scoped first, each against Σ(targeted service prices)
//        2. all-services next, against (serviceSubtotal + Σ scoped.amount)
//     so a 10% all-services percent stacked on top of a scoped flat
//     applies to the post-scoped subtotal (the operator's mental model).
//   - Scoped flat discounts cap at `-targetedSubtotal` (FR-004) — an
//     operator can't drive a single service negative via a flat scoped
//     discount that overshoots its targeted subtotal.
//   - A scoped discount whose `discountTargetIds` references services no
//     longer in the live cart silently drops the missing ids from its
//     targetedSubtotal sum. The caller's cleanup-then-recompute order
//     (US3 — remove the target service → recompute) is what guarantees an
//     empty-target discount has already been removed before the helper
//     runs in production; the drop-missing fallback is the safety net.

export type CartItem = {
  /**
   * Stable identifier for this line. Either a persisted `ticket_items.id`
   * uuid (server / persisted-mode client) or a client-generated
   * `clientLineId` (ephemeral draft mode). Required so a scoped discount
   * line's `discountTargetIds` can resolve against this list.
   */
  id: string;
  kind: "service" | "discount";
  unitPriceCents: number;
  qty: number;
  priceUnconfirmed: boolean;
  /** Whole-percent value (1..100) for percent-shape discounts; null for
   *  flat discounts and for service lines. Mirrors `ticket_items.discount_pct`. */
  discountPct?: number | null;
  /**
   * Per-service discount scope (feature 049). `null`/`undefined` = applies
   * to every service line on the ticket (today's default — backward-
   * compatible). Non-null = list of service-line ids this discount
   * targets. Service rows ignore this field; only discount rows read it.
   */
  discountTargetIds?: readonly string[] | null;
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
  /**
   * Resolved per-line display amount keyed by `CartItem.id`. Service rows
   * map to `unitPriceCents * qty`; discount rows map to the post-stacking
   * negative contribution (FR-009 — scoped against the targeted subtotal,
   * all-services against the post-scoped service subtotal).
   *
   * Surfaced so display surfaces (cart row, bill snapshot, draft resolver)
   * don't duplicate the kernel's math. Without this map, three call sites
   * re-derived FR-009 stacking and the duplication produced two visible
   * defects on PR #137 — fixed in 992fbe9 and feb846a, then deduped here.
   *
   * Lookup pattern at the caller: `totals.lineAmountsById.get(line.id)`.
   * The map always carries an entry for every item passed in (no fallback
   * needed for known-good ids; the `?? line.unitPriceCents * line.qty`
   * fallback is defensive for callers that pass an id absent from the
   * items slice).
   */
  lineAmountsById: ReadonlyMap<string, number>;
};

export function computeTotals(items: CartItem[]): CartTotals {
  // Service subtotal — only confirmed service lines contribute.
  const serviceSubtotalCents = items
    .filter((i) => i.kind === "service" && !i.priceUnconfirmed)
    .reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0);

  // Build a quick id → service-line price lookup so scoped discounts can
  // compute their targeted subtotal in O(n). Only confirmed service rows
  // count — an unconfirmed service line is invisible to the subtotal AND
  // invisible to any scoped discount that happens to target it.
  const servicePriceById = new Map<string, number>();
  for (const i of items) {
    if (i.kind === "service" && !i.priceUnconfirmed) {
      servicePriceById.set(i.id, i.unitPriceCents * i.qty);
    }
  }

  // Partition discount lines: scoped (discountTargetIds != null) vs.
  // all-services (null/omitted). Order within each partition follows the
  // array's order — operators see their discounts in insertion order in
  // the cart, and the math is order-independent within a partition.
  const scopedDiscounts: CartItem[] = [];
  const allServicesDiscounts: CartItem[] = [];
  for (const i of items) {
    if (i.kind !== "discount") continue;
    if (i.discountTargetIds != null) scopedDiscounts.push(i);
    else allServicesDiscounts.push(i);
  }

  // Per-line resolved amount, populated as we compute. Service rows ship
  // `unitPriceCents * qty` verbatim (their "amount" is just their price);
  // discount rows ship the FR-009 post-stacking negative contribution.
  // Callers read from this map instead of re-deriving the math.
  const lineAmountsById = new Map<string, number>();
  for (const i of items) {
    if (i.kind === "service") lineAmountsById.set(i.id, i.unitPriceCents * i.qty);
  }

  // PASS 1 — scoped discounts. Each scoped row's amount is computed
  // against the sum of its targeted services' prices. Percent:
  // -round(pct × targetedSubtotal / 100). Flat: caps at -targetedSubtotal
  // (FR-004 — flat scoped can't drive the targeted services negative).
  let scopedAmountSum = 0;
  for (const d of scopedDiscounts) {
    const targetedSubtotal = (d.discountTargetIds ?? []).reduce(
      (sum, id) => sum + (servicePriceById.get(id) ?? 0),
      0
    );
    let amount: number;
    if (d.discountPct != null) {
      amount = -Math.round((d.discountPct * targetedSubtotal) / 100);
    } else {
      // Flat — `unitPriceCents` is already negative (or zero). Cap at the
      // targeted subtotal so an overshoot floors at the scope, not at zero.
      // e.g. $80 flat scoped to a $60 service → caps at -6000.
      amount = Math.max(d.unitPriceCents * d.qty, -targetedSubtotal);
    }
    lineAmountsById.set(d.id, amount);
    scopedAmountSum += amount;
  }

  // PASS 2 — all-services discounts. Percent rows recompute against the
  // POST-SCOPED service subtotal (serviceSubtotal + scopedAmountSum),
  // per FR-009's "scoped first, then all-services" stacking order. Flat
  // rows ship `unitPriceCents` verbatim (already negative).
  const postScopedServiceSubtotal = serviceSubtotalCents + scopedAmountSum;
  let allServicesAmountSum = 0;
  for (const d of allServicesDiscounts) {
    let amount: number;
    if (d.discountPct != null) {
      amount = -Math.round((d.discountPct * postScopedServiceSubtotal) / 100);
    } else {
      amount = d.unitPriceCents * d.qty;
    }
    lineAmountsById.set(d.id, amount);
    allServicesAmountSum += amount;
  }

  const discountTotalCents = scopedAmountSum + allServicesAmountSum;
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
    lineAmountsById,
  };
}
