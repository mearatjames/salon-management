// Pay & deductions summary helper for the staff edit panel.
//
// Per spec US3 + Clarify Q3/Q4, the summary line spells out the tech's
// current exemption posture in plain language. There are 5 posture variants
// + a "no exemptions" case that returns null. A separate `formatFrontDeskHint`
// covers the muted hint shown when the role is `front_desk` and no exemptions
// are configured.
//
// Pure function — no I/O, no React, no side effects. Imported by the section
// client component (`pay-deductions-section.client.tsx`) which decides
// between the summary, the front-desk hint, and nothing based on draft state.

import { formatDefaultCardFeeLabel } from "@/lib/services/card-fee-default";

import type { StaffSupplyMode } from "./_types";

export type SummaryInput = {
  firstName: string;
  cardExempt: boolean;
  supplyMode: StaffSupplyMode;
  /** Display names of the exempted supply types — only used when
   *  `supplyMode === 'partial'`. */
  exemptedTypeNames: readonly string[];
};

/**
 * Lowercase + hyphenate a supply-type display name for the summary copy.
 *   - "Chrome powder"      → "chrome-powder"
 *   - "GelX tips & gel"    → "gelx-tips-gel"
 *   - "Cat-eye gel"        → "cat-eye-gel"
 *   - "  Already  Hyphen " → "already-hyphen"
 *
 * Strategy: lowercase, drop characters that aren't alphanumeric or hyphen,
 * collapse runs of whitespace/hyphens into a single hyphen, trim leading/
 * trailing hyphens.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Join names with English rules: 1 → "x"; 2 → "x and y"; 3+ → "x, y and z". */
function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1];
  return `${head} and ${tail}`;
}

/**
 * Render the Pay & deductions summary line for a given posture. Returns
 * null when no exemptions are in effect (caller decides between this and
 * the front-desk hint).
 */
export function formatSummary({
  firstName,
  cardExempt,
  supplyMode,
  exemptedTypeNames,
}: SummaryInput): string | null {
  if (supplyMode === "partial") {
    // Partial mode is the only one that names types in the summary.
    const slugified = exemptedTypeNames.filter((n) => n.length > 0).map(slugify);
    const list = joinNames(slugified);
    const cardPart = cardExempt ? "card-paid services" : "every service";
    return `${firstName} keeps the full payout on ${cardPart} and is exempted from ${list} supply costs.`;
  }

  if (supplyMode === "exempt") {
    if (cardExempt) {
      return `${firstName} keeps the full payout on every service — no card fee or supply costs deducted.`;
    }
    return `${firstName} keeps the full payout on every service — no supply costs deducted.`;
  }

  // supplyMode === 'apply'
  if (cardExempt) {
    return `${firstName} keeps the full payout on card-paid services — no card fee deducted.`;
  }

  // No exemptions in effect.
  return null;
}

/**
 * Render the Card processing fee row subtitle. The "Standard $X deducted…"
 * variant uses the shared `formatDefaultCardFeeLabel()` so the currency copy
 * stays in lockstep with the services catalog.
 */
export function formatCardFeeSubtitle(cardExempt: boolean): string {
  return cardExempt
    ? "Exempt — card fee never deducted from payout."
    : `Standard ${formatDefaultCardFeeLabel()} deducted on card-paid services.`;
}

/**
 * Render the Supply deductions row subtitle for the given mode. The `partial`
 * variant names the operator's first name so the copy reads naturally inline.
 */
export function formatSupplyModeSubtitle(mode: StaffSupplyMode, firstName: string): string {
  switch (mode) {
    case "apply":
      return "Per-service supply cost deducted from payout when configured.";
    case "partial":
      return `Apply most supply costs, but exempt ${firstName} from specific types.`;
    case "exempt":
      return "Exempt — no supply costs ever deducted, on any service.";
  }
}

/**
 * Muted hint shown for front-desk staff with no exemptions configured.
 * Per Clarify Q4 the front-desk role normally doesn't take services, so the
 * pay-deduction settings don't materially affect their payouts — but they
 * can still cover service tickets occasionally, so the section stays
 * configurable.
 */
export function formatFrontDeskHint(): string {
  // No `firstName` parameter — the v1 hint is role-generic. If a future copy
  // variant personalizes the line, add the parameter back at the call sites.
  return "Front desk staff don't take services, so these settings normally don't affect their payouts. Configure if they occasionally cover service tickets.";
}
