// Vitest unit suite for the pure cart-totals math used by the checkout
// screen's local view AND mirrored on the server (`tickets.total_cents`)
// after `addServiceLine` / `removeLine` / `addDiscountLine` /
// `removeDiscountLine` / `setLinePrice` recompute. The server is the
// authority — this helper exists so the client can show an instant total
// without waiting for the round-trip (Constitution Principle II is
// preserved because the action recomputes server-side before charge).
//
// Money-path coverage per Constitution Principle IV: empty cart, one
// fixed-price line, two fixed-price lines, mixed fixed + unconfirmed,
// + (013-cart-polish) flat + percent discounts and the over-discount
// flooring case.
//
// Money-unit convention: every helper takes cents and returns cents,
// matching the data-model and what `computeTotals` emits. The quickstart
// uses shorthand like "$20" / "$5" in prose, but the call sites here pass
// cents (`fixed(2000)`, `flatDiscount(500)`) for symmetry with the existing
// phase-2 cases.

import { describe, expect, it } from "vitest";

import { computeTotals, type CartItem } from "@/lib/pos/cart";

const fixed = (id: string, unitPriceCents: number, qty = 1): CartItem => ({
  id,
  kind: "service",
  unitPriceCents,
  qty,
  priceUnconfirmed: false,
});

const unconfirmed = (id: string, unitPriceCents: number = 0, qty = 1): CartItem => ({
  id,
  kind: "service",
  unitPriceCents,
  qty,
  priceUnconfirmed: true,
});

const flatDiscount = (
  id: string,
  valueCents: number,
  targetIds: readonly string[] | null = null
): CartItem => ({
  id,
  kind: "discount",
  unitPriceCents: -valueCents,
  qty: 1,
  priceUnconfirmed: false,
  discountPct: null,
  discountTargetIds: targetIds,
});

const percentDiscount = (
  id: string,
  pct: number,
  targetIds: readonly string[] | null = null
): CartItem => ({
  id,
  kind: "discount",
  // The amount is recomputed by computeTotals against the service subtotal,
  // so the stored unit_price_cents on a fresh percent row is irrelevant
  // for the pure helper's math; seed with 0 to avoid implying a value.
  unitPriceCents: 0,
  qty: 1,
  priceUnconfirmed: false,
  discountPct: pct,
  discountTargetIds: targetIds,
});

describe("computeTotals", () => {
  it("returns zero totals and ineligible for an empty cart", () => {
    expect(computeTotals([])).toEqual({
      serviceSubtotalCents: 0,
      discountTotalCents: 0,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      chargeEligible: false,
      lineAmountsById: new Map(),
    });
  });

  it("sums a single fixed-price line and marks it eligible", () => {
    expect(computeTotals([fixed("svc-1", 2000)])).toEqual({
      serviceSubtotalCents: 2000,
      discountTotalCents: 0,
      subtotalCents: 2000,
      taxCents: 0,
      totalCents: 2000,
      chargeEligible: true,
      lineAmountsById: new Map([["svc-1", 2000]]),
    });
  });

  it("respects qty on a fixed-price line", () => {
    expect(computeTotals([fixed("svc-1", 1500, 3)])).toEqual({
      serviceSubtotalCents: 4500,
      discountTotalCents: 0,
      subtotalCents: 4500,
      taxCents: 0,
      totalCents: 4500,
      chargeEligible: true,
      lineAmountsById: new Map([["svc-1", 4500]]),
    });
  });

  it("sums two fixed-price lines", () => {
    expect(computeTotals([fixed("svc-1", 2000), fixed("svc-2", 1500)])).toEqual({
      serviceSubtotalCents: 3500,
      discountTotalCents: 0,
      subtotalCents: 3500,
      taxCents: 0,
      totalCents: 3500,
      chargeEligible: true,
      lineAmountsById: new Map([
        ["svc-1", 2000],
        ["svc-2", 1500],
      ]),
    });
  });

  it("excludes unconfirmed lines from the subtotal and disables charge", () => {
    const result = computeTotals([fixed("svc-1", 2000), unconfirmed("svc-2", 9999)]);
    expect(result.subtotalCents).toBe(2000);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(2000);
    expect(result.chargeEligible).toBe(false);
  });

  it("keeps chargeEligible false when every line is unconfirmed", () => {
    const result = computeTotals([unconfirmed("svc-1", 2000), unconfirmed("svc-2", 1500)]);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.chargeEligible).toBe(false);
  });

  // -------- 013-cart-polish: discount-line math --------------------------

  it("subtracts a flat discount from the service subtotal", () => {
    // $20 service - $5 flat = $15
    const result = computeTotals([fixed("svc-1", 2000), flatDiscount("disc-1", 500)]);
    expect(result.subtotalCents).toBe(1500);
    expect(result.totalCents).toBe(1500);
    expect(result.chargeEligible).toBe(true);
  });

  it("computes a percent discount against the service subtotal", () => {
    // $20 service - 10% = $18
    const result = computeTotals([fixed("svc-1", 2000), percentDiscount("disc-1", 10)]);
    expect(result.subtotalCents).toBe(1800);
    expect(result.totalCents).toBe(1800);
    expect(result.chargeEligible).toBe(true);
  });

  it("floors an over-discount at $0 and disables charge", () => {
    // $20 service - $30 flat would be -$10; floor to $0.
    const result = computeTotals([fixed("svc-1", 2000), flatDiscount("disc-1", 3000)]);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.chargeEligible).toBe(false);
  });

  it("disables charge when an unconfirmed line is present even with a discount", () => {
    const result = computeTotals([
      fixed("svc-1", 2000),
      unconfirmed("svc-2"),
      flatDiscount("disc-1", 500),
    ]);
    expect(result.chargeEligible).toBe(false);
  });

  // -------- 049-per-service-discount: scoped discount math ---------------

  it("(049 a) scoped percent — discount applies only to its targeted services", () => {
    // $40 Manicure + $60 Pedicure; 50% percent discount scoped to Pedicure
    // only. Targeted subtotal = 6000. Discount amount = -round(50 * 6000 /
    // 100) = -3000. serviceSubtotal stays 10000; subtotal = 10000 - 3000 =
    // 7000.
    const result = computeTotals([
      fixed("svc-mani", 4000),
      fixed("svc-pedi", 6000),
      percentDiscount("disc-1", 50, ["svc-pedi"]),
    ]);
    expect(result.serviceSubtotalCents).toBe(10000);
    expect(result.discountTotalCents).toBe(-3000);
    expect(result.subtotalCents).toBe(7000);
    expect(result.totalCents).toBe(7000);
    expect(result.chargeEligible).toBe(true);
    // The scoped percent's per-line amount reflects the targeted $60
    // subtotal, NOT the full $100 cart. Display surfaces (cart row,
    // bill snapshot, draft resolver) read this map directly.
    expect(result.lineAmountsById.get("disc-1")).toBe(-3000);
  });

  it("(049 b) scoped flat caps at the targeted subtotal (FR-004)", () => {
    // $40 Manicure + $60 Pedicure; $80 flat discount scoped to Pedicure
    // only. Targeted subtotal = 6000. Flat amount caps at -6000 (not -8000).
    // serviceSubtotal = 10000; subtotal = 10000 - 6000 = 4000.
    const result = computeTotals([
      fixed("svc-mani", 4000),
      fixed("svc-pedi", 6000),
      flatDiscount("disc-1", 8000, ["svc-pedi"]),
    ]);
    expect(result.serviceSubtotalCents).toBe(10000);
    expect(result.discountTotalCents).toBe(-6000);
    expect(result.subtotalCents).toBe(4000);
    expect(result.totalCents).toBe(4000);
    expect(result.chargeEligible).toBe(true);
  });

  it("(049 c) FR-009 stacking — scoped applied first, then all-services percent against post-scoped subtotal", () => {
    // $40 Manicure + $60 Pedicure; $10 flat scoped to Pedicure, then 10%
    // all-services. Scoped first: targeted = 6000, amount = -1000. Post-
    // scoped service subtotal for the all-services percent = 10000 + (-1000)
    // = 9000. Percent amount = -round(10 * 9000 / 100) = -900.
    // discountTotal = -1900; subtotal = 10000 - 1900 = 8100.
    const result = computeTotals([
      fixed("svc-mani", 4000),
      fixed("svc-pedi", 6000),
      flatDiscount("disc-scoped", 1000, ["svc-pedi"]),
      percentDiscount("disc-all", 10),
    ]);
    expect(result.serviceSubtotalCents).toBe(10000);
    expect(result.discountTotalCents).toBe(-1900);
    expect(result.subtotalCents).toBe(8100);
    expect(result.totalCents).toBe(8100);
    expect(result.chargeEligible).toBe(true);
    // Per-line amounts mirror the FR-009 stacking: scoped flat -1000
    // against the $60 target, all-services percent -900 against the
    // post-scoped $90 service subtotal. Service rows echo their gross.
    // Display surfaces read these values directly — no re-derivation.
    expect(result.lineAmountsById).toEqual(
      new Map([
        ["svc-mani", 4000],
        ["svc-pedi", 6000],
        ["disc-scoped", -1000],
        ["disc-all", -900],
      ])
    );
  });

  it("(049 d) over-discount on scope still floors subtotalCents at $0 (FR-015)", () => {
    // $40 Manicure + $60 Pedicure; $80 flat scoped to Pedicure (caps at
    // -6000), $50 flat scoped to Manicure (caps at -4000). Combined
    // discountTotal = -10000. subtotal = max(0, 10000 - 10000) = 0.
    // Add one more all-services flat $5 to push it negative — still floors
    // to 0 and chargeEligible becomes false.
    const result = computeTotals([
      fixed("svc-mani", 4000),
      fixed("svc-pedi", 6000),
      flatDiscount("disc-pedi", 8000, ["svc-pedi"]),
      flatDiscount("disc-mani", 5000, ["svc-mani"]),
      flatDiscount("disc-all", 500),
    ]);
    expect(result.serviceSubtotalCents).toBe(10000);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.chargeEligible).toBe(false);
  });

  it("(049) drops targets that no longer exist in the live cart (cleanup-then-recompute safety net)", () => {
    // $40 Manicure; a scoped discount targeting a removed service id.
    // targetedSubtotal = 0 → amount = 0; subtotal = 4000 unchanged.
    const result = computeTotals([
      fixed("svc-mani", 4000),
      percentDiscount("disc-1", 50, ["svc-gone"]),
    ]);
    expect(result.serviceSubtotalCents).toBe(4000);
    expect(result.discountTotalCents).toBe(0);
    expect(result.subtotalCents).toBe(4000);
  });

  // -------- 049-per-service-discount US3: target-removal recompute --------

  it("(049 US3 AS-2) target-removal recompute — 50% scoped to [svc-1, svc-2], svc-2 missing → applies to svc-1 only", () => {
    // Initial cart: svc-1 $100 + svc-2 $200 + 50% scoped to both → -150.
    // subtotal 300 - 150 = 150.
    const before = computeTotals([
      fixed("svc-1", 10000),
      fixed("svc-2", 20000),
      percentDiscount("disc-1", 50, ["svc-1", "svc-2"]),
    ]);
    expect(before.discountTotalCents).toBe(-15000);
    expect(before.subtotalCents).toBe(15000);

    // Simulate caller removing svc-2 from the cart items array (the row's
    // discountTargetIds still references svc-2 — but the helper drops the
    // missing target from the targetedSubtotal sum). Targeted subtotal =
    // 10000; -round(50 * 10000 / 100) = -5000. subtotal = 10000 - 5000 = 5000.
    const after = computeTotals([
      fixed("svc-1", 10000),
      percentDiscount("disc-1", 50, ["svc-1", "svc-2"]),
    ]);
    expect(after.serviceSubtotalCents).toBe(10000);
    expect(after.discountTotalCents).toBe(-5000);
    expect(after.subtotalCents).toBe(5000);
  });

  it("(049 US3) auto-removal precursor — scoped flat with NO live targets contributes 0 (cap pins at -targetedSubtotal=0)", () => {
    // A scoped flat $5 whose only target id is missing from items. The
    // contract: scoped flat caps at -targetedSubtotal; since
    // targetedSubtotal = 0, the amount = max(-500, -0) = 0 — NOT -500.
    // This precursor proves the helper does the right thing when the
    // caller's auto-removal cleanup happens to leave an orphan visible to
    // computeTotals (e.g. an in-flight edge state).
    const result = computeTotals([
      fixed("svc-mani", 4000),
      flatDiscount("disc-orphan", 500, ["svc-gone"]),
    ]);
    expect(result.serviceSubtotalCents).toBe(4000);
    expect(result.discountTotalCents).toBe(0);
    expect(result.subtotalCents).toBe(4000);
  });

  it("(049 US3 FR-011) adding a new service line does NOT mutate any existing scoped discount's targets", () => {
    // Start with a scoped discount on svc-1 only. Add svc-2 to the items
    // array WITHOUT touching the discount row's `discountTargetIds`. The
    // discount must continue to compute against svc-1 alone, ignoring svc-2.
    const scopedDisc = percentDiscount("disc-1", 50, ["svc-1"]);
    const initial = [fixed("svc-1", 4000), scopedDisc];
    const before = computeTotals(initial);
    // 50% of 4000 = 2000. subtotal = 4000 - 2000 = 2000.
    expect(before.discountTotalCents).toBe(-2000);
    expect(before.subtotalCents).toBe(2000);

    // Pass-by-reference safety: assert the original row's targets are
    // untouched after the first compute (FR-011 — no auto-include).
    expect(scopedDisc.discountTargetIds).toEqual(["svc-1"]);

    // Add svc-2 (caller mutation simulating "operator picks another
    // service"). The discount's `discountTargetIds` is unchanged — only
    // svc-1 contributes to the scoped discount's math.
    const after = computeTotals([fixed("svc-1", 4000), fixed("svc-2", 6000), scopedDisc]);
    expect(after.serviceSubtotalCents).toBe(10000);
    // discount still applies to svc-1 only: -2000. subtotal = 10000 - 2000 = 8000.
    expect(after.discountTotalCents).toBe(-2000);
    expect(after.subtotalCents).toBe(8000);
    // And the row itself MUST not be mutated by computeTotals.
    expect(scopedDisc.discountTargetIds).toEqual(["svc-1"]);
  });
});
