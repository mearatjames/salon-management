// Vitest unit suite for the pure cart-totals math used by the checkout
// screen's local view AND mirrored on the server (`tickets.total_cents`)
// after `addServiceLine` / `removeLine` recompute. The server is the
// authority — this helper exists so the client can show an instant total
// without waiting for the round-trip (Constitution Principle II is
// preserved because the action recomputes server-side before charge).
//
// Money-path coverage per Constitution Principle IV: empty cart, one
// fixed-price line, two fixed-price lines, mixed fixed + unconfirmed.

import { describe, expect, it } from "vitest";

import { computeTotals, type CartItem } from "@/lib/pos/cart";

const fixed = (unitPriceCents: number, qty = 1): CartItem => ({
  unitPriceCents,
  qty,
  priceUnconfirmed: false,
});

const unconfirmed = (unitPriceCents: number, qty = 1): CartItem => ({
  unitPriceCents,
  qty,
  priceUnconfirmed: true,
});

describe("computeTotals", () => {
  it("returns zero totals and ineligible for an empty cart", () => {
    expect(computeTotals([])).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      chargeEligible: false,
    });
  });

  it("sums a single fixed-price line and marks it eligible", () => {
    expect(computeTotals([fixed(2000)])).toEqual({
      subtotalCents: 2000,
      taxCents: 0,
      totalCents: 2000,
      chargeEligible: true,
    });
  });

  it("respects qty on a fixed-price line", () => {
    expect(computeTotals([fixed(1500, 3)])).toEqual({
      subtotalCents: 4500,
      taxCents: 0,
      totalCents: 4500,
      chargeEligible: true,
    });
  });

  it("sums two fixed-price lines", () => {
    expect(computeTotals([fixed(2000), fixed(1500)])).toEqual({
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
});
