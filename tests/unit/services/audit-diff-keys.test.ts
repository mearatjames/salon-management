// Vitest contract test for the audit-diff machinery in
// `app/(studio)/services/actions.ts`. Asserts that `SERVICE_DIFF_KEYS`
// covers the 10 existing 008 columns + the 4 new 021 deduction columns,
// and that `buildChanges` emits deduction keys only when their before/after
// values actually differ (FR-030).
//
// Per `contracts/audit-payload.contract.md § 5` — written tests-first;
// fails until T016 ships the constant + helper exports.

import { describe, expect, it } from "vitest";

import { SERVICE_DIFF_KEYS, buildChanges } from "@/app/(studio)/services/_audit-diff";

describe("SERVICE_DIFF_KEYS", () => {
  it("contains exactly the 14 expected keys (10 from 008 + 4 from 021)", () => {
    const expected = new Set<string>([
      // 10 existing 008 keys (read straight from the constant's prior shape).
      "name",
      "category",
      "duration_min",
      "price_cents",
      "color_token",
      "taxable",
      "variable_price",
      "price_from_cents",
      "price_to_cents",
      "variable_price_note",
      // 4 new from 021.
      "card_fee_mode",
      "card_fee_custom_cents",
      "supply_amount_cents",
      "supply_label",
    ]);
    expect(new Set(SERVICE_DIFF_KEYS)).toEqual(expected);
    expect(SERVICE_DIFF_KEYS.length).toBe(expected.size);
  });
});

describe("buildChanges (deduction key coverage)", () => {
  // Baseline snapshot — every field is set to a stable, distinguishable value
  // so we can compare specific keys without TypeScript complaining about
  // missing fields on the snapshot shape. Cast to `any` only at the call
  // site (the helper accepts `ServiceDiffSnapshot`).
  const baseSnapshot = {
    name: "Gel manicure",
    category: "Manicure",
    duration_min: 60,
    price_cents: 5000,
    color_token: "--avatar-rose",
    taxable: true,
    variable_price: false,
    price_from_cents: null,
    price_to_cents: null,
    variable_price_note: null,
    card_fee_mode: "default" as const,
    card_fee_custom_cents: null,
    supply_amount_cents: null,
    supply_label: null,
  };

  it("emits deduction keys only when they differ", () => {
    const before = { ...baseSnapshot };
    const after = {
      ...baseSnapshot,
      card_fee_mode: "custom" as const,
      card_fee_custom_cents: 450,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.card_fee_mode).toEqual(["default", "custom"]);
    expect(changes.card_fee_custom_cents).toEqual([null, 450]);
    expect(changes.supply_amount_cents).toBeUndefined();
    expect(changes.supply_label).toBeUndefined();
  });

  it("does not emit unchanged keys (FR-030)", () => {
    const before = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_label: "Chrome",
    };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_label: "Chrome",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.card_fee_mode).toBeUndefined();
    expect(changes.card_fee_custom_cents).toBeUndefined();
    expect(changes.supply_amount_cents).toBeUndefined();
    expect(changes.supply_label).toBeUndefined();
  });

  it("emits supply keys when toggling on", () => {
    const before = { ...baseSnapshot };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_label: "Chrome",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.supply_amount_cents).toEqual([null, 500]);
    expect(changes.supply_label).toEqual([null, "Chrome"]);
  });

  it("emits card_fee_mode when flipping to exempt", () => {
    const before = { ...baseSnapshot };
    const after = {
      ...baseSnapshot,
      card_fee_mode: "exempt" as const,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.card_fee_mode).toEqual(["default", "exempt"]);
    expect(changes.card_fee_custom_cents).toBeUndefined();
  });
});
