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

const fixed = (unitPriceCents: number, qty = 1): CartItem => ({
  kind: "service",
  unitPriceCents,
  qty,
  priceUnconfirmed: false,
});

const unconfirmed = (unitPriceCents: number = 0, qty = 1): CartItem => ({
  kind: "service",
  unitPriceCents,
  qty,
  priceUnconfirmed: true,
});

const flatDiscount = (valueCents: number): CartItem => ({
  kind: "discount",
  unitPriceCents: -valueCents,
  qty: 1,
  priceUnconfirmed: false,
  discountPct: null,
});

const percentDiscount = (pct: number): CartItem => ({
  kind: "discount",
  // The amount is recomputed by computeTotals against the service subtotal,
  // so the stored unit_price_cents on a fresh percent row is irrelevant
  // for the pure helper's math; seed with 0 to avoid implying a value.
  unitPriceCents: 0,
  qty: 1,
  priceUnconfirmed: false,
  discountPct: pct,
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
    });
  });

  it("sums a single fixed-price line and marks it eligible", () => {
    expect(computeTotals([fixed(2000)])).toEqual({
      serviceSubtotalCents: 2000,
      discountTotalCents: 0,
      subtotalCents: 2000,
      taxCents: 0,
      totalCents: 2000,
      chargeEligible: true,
    });
  });

  it("respects qty on a fixed-price line", () => {
    expect(computeTotals([fixed(1500, 3)])).toEqual({
      serviceSubtotalCents: 4500,
      discountTotalCents: 0,
      subtotalCents: 4500,
      taxCents: 0,
      totalCents: 4500,
      chargeEligible: true,
    });
  });

  it("sums two fixed-price lines", () => {
    expect(computeTotals([fixed(2000), fixed(1500)])).toEqual({
      serviceSubtotalCents: 3500,
      discountTotalCents: 0,
      subtotalCents: 3500,
      taxCents: 0,
      totalCents: 3500,
      chargeEligible: true,
    });
  });

  it("excludes unconfirmed lines from the subtotal and disables charge", () => {
    const result = computeTotals([fixed(2000), unconfirmed(9999)]);
    expect(result.subtotalCents).toBe(2000);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(2000);
    expect(result.chargeEligible).toBe(false);
  });

  it("keeps chargeEligible false when every line is unconfirmed", () => {
    const result = computeTotals([unconfirmed(2000), unconfirmed(1500)]);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.chargeEligible).toBe(false);
  });

  // -------- 013-cart-polish: discount-line math --------------------------

  it("subtracts a flat discount from the service subtotal", () => {
    // $20 service - $5 flat = $15
    const result = computeTotals([fixed(2000), flatDiscount(500)]);
    expect(result.subtotalCents).toBe(1500);
    expect(result.totalCents).toBe(1500);
    expect(result.chargeEligible).toBe(true);
  });

  it("computes a percent discount against the service subtotal", () => {
    // $20 service - 10% = $18
    const result = computeTotals([fixed(2000), percentDiscount(10)]);
    expect(result.subtotalCents).toBe(1800);
    expect(result.totalCents).toBe(1800);
    expect(result.chargeEligible).toBe(true);
  });

  it("floors an over-discount at $0 and disables charge", () => {
    // $20 service - $30 flat would be -$10; floor to $0.
    const result = computeTotals([fixed(2000), flatDiscount(3000)]);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.chargeEligible).toBe(false);
  });

  it("disables charge when an unconfirmed line is present even with a discount", () => {
    const result = computeTotals([fixed(2000), unconfirmed(), flatDiscount(500)]);
    expect(result.chargeEligible).toBe(false);
  });
});
