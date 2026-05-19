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
  it("contains exactly the 14 expected keys (10 from 008 + 3 from 021 + 1 from 022)", () => {
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
      // 3 from 021 still on the snapshot (supply_label was swapped in 022).
      "card_fee_mode",
      "card_fee_custom_cents",
      "supply_amount_cents",
      // 022-supply-types-catalog — swapped from supply_label.
      "supply_type_id",
    ]);
    expect(new Set(SERVICE_DIFF_KEYS)).toEqual(expected);
    expect(SERVICE_DIFF_KEYS.length).toBe(expected.size);
  });

  it("no longer contains the legacy supply_label key (022 migration)", () => {
    expect((SERVICE_DIFF_KEYS as readonly string[]).includes("supply_label")).toBe(false);
  });

  it("contains the supply_type_id key (022 migration)", () => {
    expect((SERVICE_DIFF_KEYS as readonly string[]).includes("supply_type_id")).toBe(true);
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
    supply_type_id: null,
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
    expect(changes.supply_type_id).toBeUndefined();
  });

  it("does not emit unchanged keys (FR-030)", () => {
    const before = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.card_fee_mode).toBeUndefined();
    expect(changes.card_fee_custom_cents).toBeUndefined();
    expect(changes.supply_amount_cents).toBeUndefined();
    expect(changes.supply_type_id).toBeUndefined();
  });

  it("emits supply keys when toggling on", () => {
    const before = { ...baseSnapshot };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.supply_amount_cents).toEqual([null, 500]);
    expect(changes.supply_type_id).toEqual([null, "10000000-0000-0000-0000-000000000001"]);
  });

  it("emits supply_type_id when swapping the catalog reference", () => {
    const before = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000002",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes.supply_type_id).toEqual([
      "10000000-0000-0000-0000-000000000001",
      "10000000-0000-0000-0000-000000000002",
    ]);
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

  // FR-030 selectivity, scenario from the legacy
  // `services-deductions.spec.ts § US5 (f)` e2e test. Pruning #61 removed
  // that browser-side audit-diff assertion; this unit test takes its place.
  it("supply-amount-only change emits exactly one diff key (FR-030, was e2e US5 (f))", () => {
    const before = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 750,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes).toEqual({ supply_amount_cents: [500, 750] });
  });

  // FR-030 inverse, scenario from the legacy
  // `services-deductions.spec.ts § US5 (g)` e2e test. A non-deduction edit
  // must NOT pull deduction keys into the diff just because they're in
  // `SERVICE_DIFF_KEYS`.
  it("price-only change emits price_cents and zero deduction keys (FR-030, was e2e US5 (g))", () => {
    const before = {
      ...baseSnapshot,
      price_cents: 2500,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    const after = {
      ...baseSnapshot,
      price_cents: 6000,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes).toEqual({ price_cents: [2500, 6000] });
    expect(changes.card_fee_mode).toBeUndefined();
    expect(changes.card_fee_custom_cents).toBeUndefined();
    expect(changes.supply_amount_cents).toBeUndefined();
    expect(changes.supply_type_id).toBeUndefined();
  });

  // The full US5 (e) audit row contract: supply toggled on emits both
  // supply_amount_cents and supply_type_id (and nothing else). Already
  // covered by "emits supply keys when toggling on" above — this case
  // additionally asserts no card-fee keys leak in.
  it("supply toggle-on emits supply_amount_cents + supply_type_id only (was e2e US5 (e))", () => {
    const before = { ...baseSnapshot };
    const after = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes).toEqual({
      supply_amount_cents: [null, 500],
      supply_type_id: [null, "10000000-0000-0000-0000-000000000001"],
    });
  });

  // Counterpart to the legacy US3 (d) "toggle supply off clears columns"
  // test. The diff must surface both supply keys flipping back to null so
  // downstream consumers see the full transition.
  it("supply toggle-off emits both supply keys nulling out (was e2e US3 (d))", () => {
    const before = {
      ...baseSnapshot,
      supply_amount_cents: 500,
      supply_type_id: "10000000-0000-0000-0000-000000000001",
    };
    const after = { ...baseSnapshot };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = buildChanges(before as any, after as any);
    expect(changes).toEqual({
      supply_amount_cents: [500, null],
      supply_type_id: ["10000000-0000-0000-0000-000000000001", null],
    });
  });
});
