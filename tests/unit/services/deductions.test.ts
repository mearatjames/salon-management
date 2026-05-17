// Vitest contract test for the pure deduction derivations in
// `app/(studio)/services/_deductions.ts`.
//
// Per `specs/021-services-deductions/data-model.md § 2.3`:
//   - `effectiveCardFeeCents({ card_fee_mode, card_fee_custom_cents })`
//     resolves to a number (DEFAULT_CARD_FEE_CENTS, custom cents, or 0).
//   - `computeNetToTechCents({ service_price_cents, card_fee_mode,
//     card_fee_custom_cents, supply_amount_cents })` returns a clamped
//     `{ net_cents, card_fee_cents, supply_cents }` breakdown.
//
// Tests written first — fails until T012 ships the helpers.

import { describe, expect, it } from "vitest";

import { computeNetToTechCents, effectiveCardFeeCents } from "@/app/(studio)/services/_deductions";
import { DEFAULT_CARD_FEE_CENTS } from "@/lib/services/card-fee-default";

describe("effectiveCardFeeCents", () => {
  it("returns DEFAULT_CARD_FEE_CENTS for mode='default'", () => {
    expect(effectiveCardFeeCents({ card_fee_mode: "default", card_fee_custom_cents: null })).toBe(
      DEFAULT_CARD_FEE_CENTS
    );
    // Even with a stale custom-cents buffer the default mode ignores it.
    expect(effectiveCardFeeCents({ card_fee_mode: "default", card_fee_custom_cents: 999 })).toBe(
      DEFAULT_CARD_FEE_CENTS
    );
  });

  it("returns the custom cents for mode='custom'", () => {
    expect(effectiveCardFeeCents({ card_fee_mode: "custom", card_fee_custom_cents: 450 })).toBe(
      450
    );
    expect(effectiveCardFeeCents({ card_fee_mode: "custom", card_fee_custom_cents: 0 })).toBe(0);
  });

  it("defensively returns 0 for mode='custom' with null custom cents", () => {
    expect(effectiveCardFeeCents({ card_fee_mode: "custom", card_fee_custom_cents: null })).toBe(0);
  });

  it("returns 0 for mode='exempt'", () => {
    expect(effectiveCardFeeCents({ card_fee_mode: "exempt", card_fee_custom_cents: null })).toBe(0);
    // Stale custom buffer ignored.
    expect(effectiveCardFeeCents({ card_fee_mode: "exempt", card_fee_custom_cents: 999 })).toBe(0);
  });
});

describe("computeNetToTechCents", () => {
  it("classic case — default fee + supply", () => {
    const result = computeNetToTechCents({
      service_price_cents: 5000,
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
    });
    expect(result).toEqual({
      net_cents: 4200,
      card_fee_cents: 300,
      supply_cents: 500,
    });
  });

  it("exempt — only supply deducts", () => {
    const result = computeNetToTechCents({
      service_price_cents: 5000,
      card_fee_mode: "exempt",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
    });
    expect(result).toEqual({
      net_cents: 4500,
      card_fee_cents: 0,
      supply_cents: 500,
    });
  });

  it("supply off — only card fee deducts", () => {
    const result = computeNetToTechCents({
      service_price_cents: 5000,
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
    });
    expect(result).toEqual({
      net_cents: 4700,
      card_fee_cents: 300,
      supply_cents: 0,
    });
  });

  it("custom card fee — uses custom cents instead of default", () => {
    const result = computeNetToTechCents({
      service_price_cents: 5000,
      card_fee_mode: "custom",
      card_fee_custom_cents: 450,
      supply_amount_cents: 500,
    });
    expect(result).toEqual({
      net_cents: 4050,
      card_fee_cents: 450,
      supply_cents: 500,
    });
  });

  it("clamps to 0 when the breakdown would go negative", () => {
    const result = computeNetToTechCents({
      service_price_cents: 100,
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 500,
    });
    expect(result).toEqual({
      net_cents: 0,
      card_fee_cents: 300,
      supply_cents: 500,
    });
  });

  it("both deductions off — net equals price", () => {
    const result = computeNetToTechCents({
      service_price_cents: 5000,
      card_fee_mode: "exempt",
      card_fee_custom_cents: null,
      supply_amount_cents: null,
    });
    expect(result).toEqual({
      net_cents: 5000,
      card_fee_cents: 0,
      supply_cents: 0,
    });
  });

  it("zero price — clamps to 0 with raw deduction breakdown preserved", () => {
    const result = computeNetToTechCents({
      service_price_cents: 0,
      card_fee_mode: "default",
      card_fee_custom_cents: null,
      supply_amount_cents: 200,
    });
    expect(result.net_cents).toBe(0);
    expect(result.card_fee_cents).toBe(300);
    expect(result.supply_cents).toBe(200);
  });
});
