// Vitest contract test for `formatPriceLabel` per ui.contract.md § 3 and
// research.md § R1.

import { describe, expect, it } from "vitest";

import { formatPriceLabel } from "@/app/(studio)/settings/services/_format";
import type { CatalogService } from "@/app/(studio)/settings/services/_types";

function svc(partial: Partial<CatalogService>): CatalogService {
  return {
    id: "id",
    name: "name",
    category: "Other",
    duration_min: 30,
    price_cents: 0,
    color_token: "--avatar-rose",
    taxable: true,
    active: true,
    variable_price: false,
    price_from_cents: null,
    price_to_cents: null,
    variable_price_note: null,
    assignment_count: 0,
    ...partial,
  };
}

describe("formatPriceLabel", () => {
  describe("fixed-price", () => {
    it("renders whole dollars without trailing zeros", () => {
      expect(formatPriceLabel(svc({ price_cents: 4500 }))).toBe("$45");
    });

    it("renders cents when non-zero", () => {
      expect(formatPriceLabel(svc({ price_cents: 4550 }))).toBe("$45.50");
      expect(formatPriceLabel(svc({ price_cents: 99 }))).toBe("$0.99");
    });

    it("renders $0 for zero", () => {
      expect(formatPriceLabel(svc({ price_cents: 0 }))).toBe("$0");
    });
  });

  describe("variable price", () => {
    it("renders 'Variable' when both bounds null (even though price_cents = 0)", () => {
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 0,
            price_from_cents: null,
            price_to_cents: null,
          })
        )
      ).toBe("Variable");
    });

    it("renders 'From $X' when only the from bound is set", () => {
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 2000,
            price_from_cents: 2000,
            price_to_cents: null,
          })
        )
      ).toBe("From $20");
    });

    it("renders just 'Variable' when only the to bound is set (no from)", () => {
      // Defensive — the UI is supposed to require `from` before `to`, but the
      // formatter should not render the dangling `to`. The spec only documents
      // "Variable / From $X / $X – $Y"; a lone `to` resolves to "Variable".
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 0,
            price_from_cents: null,
            price_to_cents: 6000,
          })
        )
      ).toBe("Variable");
    });

    it("renders the range when both bounds are set", () => {
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 2000,
            price_from_cents: 2000,
            price_to_cents: 6000,
          })
        )
      ).toBe("$20 – $60");
    });

    it("renders the range with equal bounds", () => {
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 3000,
            price_from_cents: 3000,
            price_to_cents: 3000,
          })
        )
      ).toBe("$30 – $30");
    });

    it("renders cents inside the range when needed", () => {
      expect(
        formatPriceLabel(
          svc({
            variable_price: true,
            price_cents: 2050,
            price_from_cents: 2050,
            price_to_cents: 6075,
          })
        )
      ).toBe("$20.50 – $60.75");
    });
  });
});
