// Unit tests for the pure aggregation helpers consumed by both the
// `loadCashCount` query layer and the cash-list UI.
//
// Written BEFORE the implementation per Principle IV (Test-First for
// Critical Paths). The implementation in `lib/end-of-day/aggregate.ts`
// (T009) makes these pass.
//
// Helpers under test:
//   - expectedCentsFromRows(rows): sums payment-row amounts, subtracts
//     refund-row amounts. Refund rows carry NEGATIVE `amountCents` and
//     `kind === "refund"`; payment rows carry POSITIVE `amountCents` and
//     `kind === "payment"`. The helper is method-agnostic — it trusts the
//     caller to have already filtered the rows to "cash, today".
//   - formatServicesSummary(serviceNames): 0 → "", 1 → name,
//     2 → "a + b", 3+ → "a +N" where N = remaining count.

import { describe, expect, it } from "vitest";

import {
  type CashRow,
  expectedCentsFromRows,
  formatServicesSummary,
} from "@/lib/end-of-day/aggregate";

function makeRow(overrides: Partial<CashRow> = {}): CashRow {
  return {
    id: overrides.id ?? "row-1",
    processedAt: overrides.processedAt ?? new Date("2026-05-17T15:00:00.000Z"),
    kind: overrides.kind ?? "payment",
    client: overrides.client ?? "Jane Doe",
    services: overrides.services ?? "Gel manicure",
    techs: overrides.techs ?? [],
    amountCents: overrides.amountCents ?? 4500,
    tipCents: overrides.tipCents ?? 0,
  };
}

describe("expectedCentsFromRows", () => {
  it("returns 0 for an empty day", () => {
    expect(expectedCentsFromRows([])).toBe(0);
  });

  it("sums positive payment rows when there are no refunds", () => {
    const rows: CashRow[] = [
      makeRow({ id: "a", amountCents: 4500 }),
      makeRow({ id: "b", amountCents: 8500 }),
      makeRow({ id: "c", amountCents: 1200 }),
    ];
    expect(expectedCentsFromRows(rows)).toBe(4500 + 8500 + 1200);
  });

  it("subtracts refund rows (which carry negative amountCents)", () => {
    const rows: CashRow[] = [
      makeRow({ id: "p1", kind: "payment", amountCents: 4500 }),
      makeRow({ id: "p2", kind: "payment", amountCents: 8500 }),
      // Refund row: synthetic, negative amount, kind='refund'.
      makeRow({ id: "r1", kind: "refund", amountCents: -2000 }),
    ];
    // Sum: 4500 + 8500 + (-2000) = 11000.
    expect(expectedCentsFromRows(rows)).toBe(4500 + 8500 - 2000);
  });
});

describe("CashRow row contract — refund rows carry kind 'refund' and a negative amount", () => {
  it("rejects no requirement on payment rows but documents the refund convention", () => {
    const refund = makeRow({ kind: "refund", amountCents: -1500 });
    // Sanity check on the convention used by expectedCentsFromRows so the
    // contract is asserted somewhere in the suite.
    expect(refund.kind).toBe("refund");
    expect(refund.amountCents).toBeLessThan(0);
  });
});

describe("formatServicesSummary", () => {
  it("returns an empty string for zero services", () => {
    expect(formatServicesSummary([])).toBe("");
  });

  it("returns the single service name for one service", () => {
    expect(formatServicesSummary(["Gel manicure"])).toBe("Gel manicure");
  });

  it("joins two services with ' + '", () => {
    expect(formatServicesSummary(["Gel manicure", "Pedicure"])).toBe("Gel manicure + Pedicure");
  });

  it("formats three services as 'first +2'", () => {
    expect(formatServicesSummary(["Gel manicure", "Pedicure", "Polish change"])).toBe(
      "Gel manicure +2"
    );
  });

  it("formats five services as 'first +4'", () => {
    expect(formatServicesSummary(["A", "B", "C", "D", "E"])).toBe("A +4");
  });
});
