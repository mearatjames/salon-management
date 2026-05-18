// Pure deduction derivations for the services-catalog surface
// (`021-services-deductions`).
//
// Per `data-model.md § 2.3`:
//   - `effectiveCardFeeCents` collapses `(card_fee_mode, card_fee_custom_cents)`
//     into a single cents number the caller can subtract from a price.
//   - `computeNetToTechCents` returns `{ net_cents, card_fee_cents,
//     supply_cents }` where `net_cents` is clamped at `0` (a service can
//     never owe the salon money — the panel preview just shows `$0`
//     alongside the raw breakdown).
//
// Both functions are pure: no I/O, no formatting. The panel preview (client
// island) and the Server Action audit-payload builder both consume them, so
// the file is importable from either bundle — no `"use server"` /
// `"use client"` directive.

import { DEFAULT_CARD_FEE_CENTS } from "@/lib/services/card-fee-default";
import type { CardFeeMode } from "./_types";

// Same shape as `NON_NEG_DOLLARS` in `_validation.ts` — kept inline (rather
// than exported across modules) so this helper has zero validator coupling.
// Net-to-tech preview re-runs on every keystroke, so a regex check is the
// hot path — keeping it local avoids a cross-file import in a render loop.
const NON_NEG_DOLLARS_RE = /^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/;

/**
 * Lenient dollars→cents parser for the **client-side preview only**. Empty,
 * mid-typing partials (e.g. `"4."`), or otherwise unparseable input return
 * `0` instead of throwing. The Server Action runs strict validation at save
 * time (see `_validation.ts`), so an in-flight `"4."` showing the preview as
 * if the value were `$0` is the right trade-off — it avoids the alternative
 * of throwing and tearing down the preview tree mid-type.
 */
export function parseDollarsToCentsLenient(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 0;
  if (!NON_NEG_DOLLARS_RE.test(trimmed)) return 0;
  const [dollarsPart, centsPartRaw = ""] = trimmed.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0");
  const cents = parseInt(centsPart || "0", 10);
  const result = dollars * 100 + cents;
  if (!Number.isFinite(result) || result < 0) return 0;
  return result;
}

export type EffectiveCardFeeInput = {
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
};

/**
 * Resolve the per-service card-fee amount in cents.
 *
 * - `mode='default'` → `DEFAULT_CARD_FEE_CENTS` (the salon-wide $3 floor).
 * - `mode='custom'`  → the stored `card_fee_custom_cents` (defensive `?? 0`
 *   in case the row is mid-edit and the column is transiently null).
 * - `mode='exempt'`  → `0` so callers can subtract unconditionally.
 */
export function effectiveCardFeeCents(input: EffectiveCardFeeInput): number {
  if (input.card_fee_mode === "exempt") return 0;
  if (input.card_fee_mode === "custom") return input.card_fee_custom_cents ?? 0;
  return DEFAULT_CARD_FEE_CENTS;
}

export type NetToTechInput = {
  service_price_cents: number;
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  /** `null` when Supply is off; positive cents when on. */
  supply_amount_cents: number | null;
};

export type NetToTechResult = {
  /** `max(0, price - card_fee - supply)` — never negative. */
  net_cents: number;
  /** Raw card-fee amount (already resolved per mode). 0 for exempt. */
  card_fee_cents: number;
  /** Raw supply amount. 0 when Supply is off. */
  supply_cents: number;
};

/**
 * Compute the technician's net (post-deduction) take in cents alongside
 * the raw breakdown lines the panel preview renders.
 *
 * Clamping rule: when `card_fee + supply > price`, `net_cents` is `0` but
 * the breakdown lines still reflect the raw amounts so the operator can
 * see why the net is zero.
 */
export function computeNetToTechCents(input: NetToTechInput): NetToTechResult {
  const card_fee_cents = effectiveCardFeeCents({
    card_fee_mode: input.card_fee_mode,
    card_fee_custom_cents: input.card_fee_custom_cents,
  });
  const supply_cents = input.supply_amount_cents ?? 0;
  const net_cents = Math.max(0, input.service_price_cents - card_fee_cents - supply_cents);
  return { net_cents, card_fee_cents, supply_cents };
}
