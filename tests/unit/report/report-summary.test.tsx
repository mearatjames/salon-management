import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ReportSummary } from "@/components/lacquer/report/report-summary";
import type { ReportTotals } from "@/lib/report/aggregate";

afterEach(() => {
  cleanup();
});

function totals(over: Partial<ReportTotals> = {}): ReportTotals {
  return {
    technicianCount: 2,
    transactionCount: 5,
    serviceCount: 8,
    grossCents: 120_000,
    cardFeeCents: 600,
    supplyCents: 500,
    totalDeductionsCents: 1_100,
    commissionableCents: 118_900,
    cardTipsCents: 2_200,
    discountsCents: 0,
    ...over,
  };
}

describe("<ReportSummary> discounts segment (issue #139)", () => {
  it("does NOT render the discounts segment when discountsCents = 0", () => {
    render(<ReportSummary totals={totals({ discountsCents: 0 })} />);
    expect(screen.queryByTestId("discounts-given")).toBeNull();
    // The fallback also checks by data-slot, mirroring the e2e selector.
    expect(document.querySelector('[data-slot="discounts-given"]')).toBeNull();
  });

  it("renders the discounts segment with a formatted dollar amount when > 0", () => {
    render(<ReportSummary totals={totals({ discountsCents: 12_000 })} />);
    const seg = document.querySelector('[data-slot="discounts-given"]');
    expect(seg).not.toBeNull();
    expect(seg?.textContent).toBe("$120 discounted");
  });

  it("the Gross revenue number is unchanged regardless of discounts (FR-018)", () => {
    const { rerender } = render(<ReportSummary totals={totals({ discountsCents: 0 })} />);
    const grossBefore = document.querySelector(".dr-stat .dr-stat-v")?.textContent;
    rerender(<ReportSummary totals={totals({ discountsCents: 50_000 })} />);
    const grossAfter = document.querySelector(".dr-stat .dr-stat-v")?.textContent;
    expect(grossAfter).toBe(grossBefore);
  });
});
