// Vitest contract test for the Pay & deductions summary helper in
// `app/(studio)/settings/staff/_summary.ts`. Per spec US3 + Clarify Q3/Q4 the
// helper renders one of 5 posture variants (or null when no exemptions), plus
// a separate front-desk hint variant.
//
// Test-first per SC-007 traceability — lands BEFORE the implementation.

import { describe, expect, it } from "vitest";

import {
  formatCardFeeSubtitle,
  formatFrontDeskHint,
  formatSummary,
  formatSupplyModeSubtitle,
} from "@/app/(studio)/settings/staff/_summary";

describe("formatSummary", () => {
  it("returns null when no exemptions are in effect", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: false,
        supplyMode: "apply",
        exemptedTypeNames: [],
      })
    ).toBeNull();
  });

  it("card-exempt only → card-paid services copy", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: true,
        supplyMode: "apply",
        exemptedTypeNames: [],
      })
    ).toBe("Alex keeps the full payout on card-paid services — no card fee deducted.");
  });

  it("supply-exempt only → every service copy", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: false,
        supplyMode: "exempt",
        exemptedTypeNames: [],
      })
    ).toBe("Alex keeps the full payout on every service — no supply costs deducted.");
  });

  it("card-exempt + supply-exempt → every service + both deductions copy", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: true,
        supplyMode: "exempt",
        exemptedTypeNames: [],
      })
    ).toBe("Alex keeps the full payout on every service — no card fee or supply costs deducted.");
  });

  it("partial supply (1 type) → exempted from X supply costs", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: false,
        supplyMode: "partial",
        exemptedTypeNames: ["Chrome powder"],
      })
    ).toBe(
      "Alex keeps the full payout on every service and is exempted from chrome-powder supply costs."
    );
  });

  it("card-exempt + partial supply (2 types) → card-paid + chrome-powder and gelx-tips-gel", () => {
    expect(
      formatSummary({
        firstName: "Alex",
        cardExempt: true,
        supplyMode: "partial",
        exemptedTypeNames: ["Chrome powder", "GelX tips & gel"],
      })
    ).toBe(
      "Alex keeps the full payout on card-paid services and is exempted from chrome-powder and gelx-tips-gel supply costs."
    );
  });
});

describe("formatFrontDeskHint", () => {
  it("returns the front-desk hint copy", () => {
    expect(formatFrontDeskHint()).toBe(
      "Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets."
    );
  });
});

describe("formatCardFeeSubtitle", () => {
  it("non-exempt → 'Standard $3 deducted on card-paid services.'", () => {
    expect(formatCardFeeSubtitle(false)).toBe("Standard $3 deducted on card-paid services.");
  });

  it("exempt → 'Exempt — card fee never deducted from payout.'", () => {
    expect(formatCardFeeSubtitle(true)).toBe("Exempt — card fee never deducted from payout.");
  });
});

describe("formatSupplyModeSubtitle", () => {
  it("apply → 'Per-service supply cost deducted from payout when configured.'", () => {
    expect(formatSupplyModeSubtitle("apply", "Sam")).toBe(
      "Per-service supply cost deducted from payout when configured."
    );
  });

  it("partial → interpolates the first name", () => {
    expect(formatSupplyModeSubtitle("partial", "Sam")).toBe(
      "Apply most supply costs, but exempt Sam from specific types."
    );
  });

  it("exempt → 'Exempt — no supply costs ever deducted, on any service.'", () => {
    expect(formatSupplyModeSubtitle("exempt", "Sam")).toBe(
      "Exempt — no supply costs ever deducted, on any service."
    );
  });
});
