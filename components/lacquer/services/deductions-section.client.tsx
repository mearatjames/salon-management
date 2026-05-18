"use client";

// DeductionsSection — the bordered card surface inside <ServiceForm> that
// houses the Card-fee row (US2) + the Supply row (US3 / this file) +
// the Net-to-tech preview (US4 / T036). Phase 5 ships the supply row;
// the preview block lands in Phase 6.
//
// Per `specs/021-services-deductions/contracts/ui.contract.md § 3`:
//   - Card-fee row: heading + Segmented(Default · $3, Custom, Exempt). When
//     mode = custom, a `$`-prefixed amount input + inline hints (empty /
//     >$50). When mode = exempt, a muted one-liner explainer.
//   - Supply row: heading + muted hint + right-aligned Switch. When toggle
//     is on, a 100px / 1fr grid with `$`-prefixed amount input + label
//     input. Inline hints + 8-char counter on the label.
//   - Hidden FormData inputs (`card_fee_mode`, conditionally
//     `card_fee_custom`, `supply_on`, conditionally `supply_amount` +
//     `supply_label`) wire the form submission.
//
// The Segmented control wraps the shadcn `RadioGroup` primitive (via
// `radix-ui`'s `RadioGroupPrimitive.Root` + `.Item`) restyled into the
// prototype's pill shape. We use the primitive directly rather than the
// vendored `RadioGroupItem` because the shadcn wrapper hardcodes
// `rounded-full size-4` styling for circular radios — incompatible with
// the pill layout. The a11y semantics (`role="radiogroup"`, `aria-checked`,
// roving tabindex, arrow-key navigation) come from Radix.
//
// FR-014 / FR-021 buffer-preservation rules:
//   - `card_fee_custom_dollars` is preserved across mode flips. When mode
//     != 'custom' the hidden FormData input is NOT rendered, so the Server
//     Action's parser writes `card_fee_custom_cents = null`.
//   - `supply_amount_dollars` and `supply_label` are preserved across
//     toggle off → on → off cycles. When the toggle is off the hidden
//     FormData inputs aren't rendered, so the Server Action writes
//     `supply_amount_cents = null` + `supply_label = null`.
// The dirty-detector in `<EditPanel>` follows the same rules — typed-but-
// unused values are not counted as dirty.

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useEffect, useId, useMemo, useRef } from "react";

import { Switch } from "@/components/ui/switch";
import {
  OWNER_ONLY_TOOLTIP_COPY,
  OwnerOnlyTooltip,
} from "@/components/lacquer/services/owner-only-tooltip";
import {
  ValidationError,
  validateCardFeeCustomDollars,
  validateSupplyAmountDollars,
  validateSupplyLabel,
} from "@/app/(studio)/services/_validation";
import {
  computeNetToTechCents,
  parseDollarsToCentsLenient,
  type NetToTechInput,
} from "@/app/(studio)/services/_deductions";
import { formatDollarsFromCents } from "@/app/(studio)/services/_format";
import type { CardFeeMode } from "@/app/(studio)/services/_types";
import { formatDefaultCardFeeLabel } from "@/lib/services/card-fee-default";

export type DeductionsSectionProps = {
  /** Current card-fee mode (segmented control's active value). */
  card_fee_mode: CardFeeMode;
  /** String buffer the operator typed into the custom amount input. */
  card_fee_custom_dollars: string;
  /** Supply-toggle on/off. */
  supply_on: boolean;
  /** String buffer for the supply amount input. */
  supply_amount_dollars: string;
  /** String buffer for the supply label input. */
  supply_label: string;
  /**
   * 021-US4 (T036): live preview inputs. The preview reads these
   * read-only — the section never edits the price fields. When
   * `variable_price` is true the preview uses `price_from_dollars` (FR-026);
   * otherwise the fixed-price field. Both arrive as dollar strings to match
   * the draft buffer shape; the lenient parser tolerates mid-typing input.
   */
  variable_price: boolean;
  price_dollars: string;
  price_from_dollars: string;
  onChange: (
    patch: Partial<{
      card_fee_mode: CardFeeMode;
      card_fee_custom_dollars: string;
      supply_on: boolean;
      supply_amount_dollars: string;
      supply_label: string;
    }>
  ) => void;
  /** US5 role gate. Default false. */
  disabled?: boolean;
};

const SEGMENT_OPTIONS: ReadonlyArray<{ value: CardFeeMode; label: string }> = [
  { value: "default", label: `Default · ${formatDefaultCardFeeLabel()}` },
  { value: "custom", label: "Custom" },
  { value: "exempt", label: "Exempt" },
];

const HINT_EMPTY = "Enter an amount up to $50.";
const HINT_TOO_LARGE = "Card fee can't exceed $50.";

// 021-services-deductions § 3.2 (Supply row inline-hint copy).
const SUPPLY_AMOUNT_HINT_INVALID = "Enter a positive amount up to $50, or turn Supply off.";
const SUPPLY_AMOUNT_HINT_TOO_LARGE = "Supply can't exceed $50.";
const SUPPLY_LABEL_HINT_EMPTY =
  "Add a short label so staff know what this covers, or turn Supply off.";
const SUPPLY_LABEL_HINT_TOO_LONG = "Label must be 64 characters or fewer.";

const SUPPLY_LABEL_MAX_LEN = 64;
const SUPPLY_LABEL_COUNTER_THRESHOLD = SUPPLY_LABEL_MAX_LEN - 8; // 56

const SUPPLY_AMOUNT_DEFAULT_DOLLARS = "5.00";
const SUPPLY_LABEL_PLACEHOLDER = "e.g. GelX tips & gel, Chrome powder, OPI bottle wear";

/**
 * Resolve the inline-hint message for the custom-amount input. Returns
 * `null` when the input is valid (and the hint stays hidden).
 *
 * Empty string surfaces the "enter an amount" hint immediately — the user
 * is in custom mode, they're expected to provide a value. Non-empty values
 * run through the same validator the Server Action uses, mapping its
 * codes to the documented copy.
 */
function resolveCardFeeCustomHint(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return HINT_EMPTY;
  try {
    validateCardFeeCustomDollars(trimmed);
    return null;
  } catch (err) {
    if (err instanceof ValidationError) {
      if (err.code === "card_fee_custom_too_large") return HINT_TOO_LARGE;
      // `invalid_card_fee_custom` covers bad shape (e.g. "4.5a", "-1").
      return HINT_EMPTY;
    }
    return HINT_EMPTY;
  }
}

/**
 * Resolve the inline-hint message for the supply-amount input. Returns
 * `null` when the input is valid (and the hint stays hidden).
 *
 * The validator throws `invalid_supply_amount` for empty / zero / negative
 * / non-numeric values and `supply_amount_too_large` for > $50. We map
 * both to the contract-mandated copy.
 */
function resolveSupplyAmountHint(raw: string): string | null {
  try {
    validateSupplyAmountDollars(raw);
    return null;
  } catch (err) {
    if (err instanceof ValidationError) {
      if (err.code === "supply_amount_too_large") return SUPPLY_AMOUNT_HINT_TOO_LARGE;
      return SUPPLY_AMOUNT_HINT_INVALID;
    }
    return SUPPLY_AMOUNT_HINT_INVALID;
  }
}

/**
 * Resolve the inline-hint message for the supply-label input. Returns
 * `null` when the input is valid (and the hint stays hidden).
 */
function resolveSupplyLabelHint(raw: string): string | null {
  try {
    validateSupplyLabel(raw);
    return null;
  } catch (err) {
    if (err instanceof ValidationError) {
      if (err.code === "supply_label_too_long") return SUPPLY_LABEL_HINT_TOO_LONG;
      return SUPPLY_LABEL_HINT_EMPTY;
    }
    return SUPPLY_LABEL_HINT_EMPTY;
  }
}

/**
 * Format `raw` to two decimals on blur. Empty / unparseable input stays as
 * the operator typed it (so the inline hint still fires). Mirrors the
 * prototype's `Math.round(Number(v) * 100) / 100` round-trip but as a
 * string operation so we avoid float drift on the boundary cases.
 */
function formatCardFeeOnBlur(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  // Same regex as `_validation.ts` NON_NEG_DOLLARS.
  if (!/^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/.test(trimmed)) return trimmed;
  const [dollarsPart, centsPartRaw = ""] = trimmed.split(".");
  const dollars = parseInt(dollarsPart || "0", 10);
  const centsPart = centsPartRaw.padEnd(2, "0").slice(0, 2);
  return `${dollars}.${centsPart}`;
}

export function DeductionsSection({
  card_fee_mode,
  card_fee_custom_dollars,
  supply_on,
  supply_amount_dollars,
  supply_label,
  variable_price,
  price_dollars,
  price_from_dollars,
  onChange,
  disabled = false,
}: DeductionsSectionProps) {
  const hintId = useId();
  const customInputId = useId();
  const supplyToggleId = useId();
  const supplyAmountId = useId();
  const supplyLabelId = useId();
  const supplyAmountHintId = useId();
  const supplyLabelHintId = useId();
  const supplyLabelCounterId = useId();

  const customHint = useMemo(() => {
    if (card_fee_mode !== "custom") return null;
    return resolveCardFeeCustomHint(card_fee_custom_dollars);
  }, [card_fee_mode, card_fee_custom_dollars]);

  const supplyAmountHint = useMemo(() => {
    if (!supply_on) return null;
    return resolveSupplyAmountHint(supply_amount_dollars);
  }, [supply_on, supply_amount_dollars]);

  const supplyLabelHint = useMemo(() => {
    if (!supply_on) return null;
    return resolveSupplyLabelHint(supply_label);
  }, [supply_on, supply_label]);

  // 021 / FR-018 / FR-021: on toggle off → on, pre-fill the amount input
  // with `'5.00'` ONLY when the buffer is currently empty (so re-toggling
  // on after a typed value preserves it), and move focus to the label
  // input. We watch the toggle transition via a ref + effect so the
  // pre-fill + focus only fires once per off→on flip.
  const supplyLabelRef = useRef<HTMLInputElement | null>(null);
  const prevSupplyOnRef = useRef(supply_on);
  useEffect(() => {
    const prev = prevSupplyOnRef.current;
    prevSupplyOnRef.current = supply_on;
    if (prev === supply_on) return;
    if (!supply_on) return; // off→? — only act on off→on
    if (disabled) return;
    // Pre-fill the amount only when empty (FR-021 buffer rule).
    if (supply_amount_dollars.trim().length === 0) {
      onChange({ supply_amount_dollars: SUPPLY_AMOUNT_DEFAULT_DOLLARS });
    }
    // Move focus to the label input on the next paint so the just-mounted
    // input exists in the DOM.
    requestAnimationFrame(() => {
      supplyLabelRef.current?.focus();
    });
    // We intentionally only react to `supply_on` flips — including
    // `supply_amount_dollars` here would re-fire the focus jump whenever
    // the user edits the amount after toggling on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supply_on]);

  // Live character counter visibility — only show when within 8 chars of
  // the 64-char limit (FR-018, ui.contract § 3.2).
  const supplyLabelLength = supply_label.length;
  const showCounter = supplyLabelLength >= SUPPLY_LABEL_COUNTER_THRESHOLD;
  const counterRemaining = SUPPLY_LABEL_MAX_LEN - supplyLabelLength;
  // Render "N left" when in-limit, "N over" when over (Save is already
  // disabled by then so the over case is mostly a courtesy).
  const counterText =
    counterRemaining >= 0 ? `${counterRemaining} left` : `${Math.abs(counterRemaining)} over`;

  // 021-US4 (T036): Net-to-tech preview. The input memo collapses every
  // draft field the preview cares about into the typed `NetToTechInput`
  // shape that `computeNetToTechCents` expects. The result memo runs the
  // pure helper. Two layers so a price-only keystroke skips the math
  // helper's call frame when memoisation cache hits.
  const previewInput: NetToTechInput = useMemo(() => {
    const rawPrice = variable_price ? price_from_dollars : price_dollars;
    return {
      service_price_cents: parseDollarsToCentsLenient(rawPrice),
      card_fee_mode,
      card_fee_custom_cents:
        card_fee_mode === "custom" ? parseDollarsToCentsLenient(card_fee_custom_dollars) : null,
      supply_amount_cents: supply_on ? parseDollarsToCentsLenient(supply_amount_dollars) : null,
    };
  }, [
    variable_price,
    price_dollars,
    price_from_dollars,
    card_fee_mode,
    card_fee_custom_dollars,
    supply_on,
    supply_amount_dollars,
  ]);
  const { net_cents, card_fee_cents, supply_cents } = useMemo(
    () => computeNetToTechCents(previewInput),
    [previewInput]
  );

  // Raw service-line uses the parsed price (so the breakdown matches what
  // the math used, not whatever string is mid-typing). Supply label falls
  // back to "supply" when typed-but-empty (mirrors the prototype, FR-027).
  const previewServiceCents = previewInput.service_price_cents;
  const supplyLabelDisplay = supply_label.trim() || "supply";

  return (
    <section
      data-slot="services-deductions-section"
      className="deductions-section"
      aria-label="Deductions"
    >
      <div className="deductions-card-fee-row" data-slot="deductions-card-fee-row">
        <div className="deductions-card-fee-row__header">
          <span className="deductions-section__heading">Card fee</span>
          <span className="deductions-section__hint">when paid by card or gift card</span>
        </div>

        {/* Segmented control — Radix RadioGroup styled into the prototype's
            pill shape. Each Item is a button-like radio with roving
            tabindex.

            021-services-deductions / US5 (T039): when `disabled` is true
            the root carries `aria-disabled="true"` (ui.contract.md § 5),
            each option drops out of the tab order (`tabIndex={-1}`), and
            the whole group is wrapped in `<OwnerOnlyTooltip>` so hover /
            focus surfaces the shared role-gate copy. We intentionally do
            NOT pass `disabled` to the radix Items themselves — the Items
            need to remain pointer/focus targets so the tooltip trigger
            (an inline-block <span> sibling of the radix internals) gets
            the events. The `aria-disabled` flag carries the semantics. */}
        <OwnerOnlyTooltip disabled={disabled} displayMode="block">
          <RadioGroupPrimitive.Root
            className="segmented"
            data-slot="deductions-card-fee-segmented"
            value={card_fee_mode}
            onValueChange={(next) => {
              if (disabled) return;
              // Radix passes back the string value of the selected Item; cast
              // to CardFeeMode since the option set is exhaustive.
              onChange({ card_fee_mode: next as CardFeeMode });
            }}
            aria-label="Card fee mode"
            aria-disabled={disabled ? "true" : undefined}
            style={disabled ? { pointerEvents: "none" as const, opacity: 0.5 } : undefined}
          >
            {SEGMENT_OPTIONS.map((opt) => {
              const active = opt.value === card_fee_mode;
              return (
                <RadioGroupPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className={
                    active ? "segmented__option segmented__option--active" : "segmented__option"
                  }
                  data-slot="deductions-card-fee-option"
                  data-value={opt.value}
                  aria-disabled={disabled ? "true" : undefined}
                  aria-label={`${opt.label}${disabled ? ` — ${OWNER_ONLY_TOOLTIP_COPY}` : ""}`}
                  tabIndex={disabled ? -1 : undefined}
                >
                  {opt.label}
                </RadioGroupPrimitive.Item>
              );
            })}
          </RadioGroupPrimitive.Root>
        </OwnerOnlyTooltip>

        {/* Hidden FormData input for `card_fee_mode` — always submitted. */}
        <input type="hidden" name="card_fee_mode" value={card_fee_mode} />

        {/* Custom amount input — only rendered when mode = 'custom'.
            US5 (T039): when disabled, the input keeps the native `disabled`
            attribute (no pointer events) and the surrounding wrap gets the
            tooltip. The hint label sits OUTSIDE the tooltip wrap so it
            stays plain text for the operator. */}
        {card_fee_mode === "custom" ? (
          <div className="deductions-card-fee-row__custom">
            <span className="deductions-card-fee-row__custom-prefix" aria-hidden="true">
              Deduct $
            </span>
            <OwnerOnlyTooltip disabled={disabled}>
              <input
                id={customInputId}
                type="text"
                inputMode="decimal"
                data-slot="deductions-card-fee-custom-input"
                className="deductions-card-fee-row__custom-input"
                value={card_fee_custom_dollars}
                onChange={(e) => {
                  if (disabled) return;
                  onChange({ card_fee_custom_dollars: e.target.value });
                }}
                onBlur={(e) => {
                  if (disabled) return;
                  const next = formatCardFeeOnBlur(e.target.value);
                  if (next !== card_fee_custom_dollars) {
                    onChange({ card_fee_custom_dollars: next });
                  }
                }}
                disabled={disabled}
                aria-label={
                  disabled
                    ? `Custom card fee amount — ${OWNER_ONLY_TOOLTIP_COPY}`
                    : "Custom card fee amount"
                }
                aria-describedby={customHint ? hintId : undefined}
                aria-invalid={customHint !== null}
                placeholder="0.00"
              />
            </OwnerOnlyTooltip>
            <span className="deductions-section__hint">per service when paid by card</span>
            {/* Hidden FormData input for the custom amount — only present
                when mode = 'custom' so the Server Action writes
                `card_fee_custom_cents = null` on flips to default/exempt. */}
            <input type="hidden" name="card_fee_custom" value={card_fee_custom_dollars} />
          </div>
        ) : null}

        {/* Exempt explainer — only rendered when mode = 'exempt'. */}
        {card_fee_mode === "exempt" ? (
          <p
            className="deductions-section__explainer"
            data-slot="deductions-card-fee-exempt-explainer"
          >
            Card fee never applies, regardless of payment method.
          </p>
        ) : null}

        {/* Inline validation hint for the custom-amount input. */}
        {customHint ? (
          <span
            id={hintId}
            className="deductions-card-fee-row__hint--error"
            data-slot="deductions-card-fee-custom-hint"
            role="alert"
          >
            {customHint}
          </span>
        ) : null}
      </div>

      {/* ── Supply row (US3 / T031) ─────────────────────────────────── */}
      <div className="deductions-supply-row" data-slot="deductions-supply-row">
        <div className="deductions-supply-row__header">
          <div className="deductions-supply-row__title">
            <label
              htmlFor={supplyToggleId}
              className="deductions-section__heading"
              data-slot="deductions-supply-heading"
            >
              Supply deduction
            </label>
            <span className="deductions-section__hint">any payment method</span>
          </div>
          <OwnerOnlyTooltip disabled={disabled}>
            <Switch
              id={supplyToggleId}
              data-slot="deductions-supply-toggle"
              checked={supply_on}
              onCheckedChange={(next: boolean) => {
                if (disabled) return;
                onChange({ supply_on: next });
              }}
              disabled={disabled}
              // 021-US5 (T039): expose `aria-disabled` per ui.contract.md § 5
              // so the spec assertion `toHaveAttribute("aria-disabled", "true")`
              // succeeds even though Radix sets the native `disabled` attribute
              // separately. Both convey the same semantic but the contract
              // mandates `aria-disabled` for screen-reader explicitness.
              aria-disabled={disabled ? "true" : undefined}
              aria-label={
                disabled ? `Supply deduction — ${OWNER_ONLY_TOOLTIP_COPY}` : "Supply deduction"
              }
            />
          </OwnerOnlyTooltip>
        </div>

        {/* Hidden FormData input for supply_on. When off, value is "" so the
            Server Action sees `formData.get("supply_on") !== "on"` and
            writes `supply_amount_cents = null` + `supply_label = null`. */}
        <input type="hidden" name="supply_on" value={supply_on ? "on" : ""} />

        {supply_on ? (
          <>
            <div className="deductions-supply-row__inputs" data-slot="deductions-supply-inputs">
              <div className="deductions-supply-row__amount-wrap">
                <span
                  className="deductions-card-fee-row__custom-prefix"
                  aria-hidden="true"
                  data-slot="deductions-supply-amount-prefix"
                >
                  $
                </span>
                {/* US5 (T039): wrap disabled supply inputs in the shared
                    role-gate tooltip. The wrapper is transparent for
                    owners/managers. */}
                <OwnerOnlyTooltip disabled={disabled}>
                  <input
                    id={supplyAmountId}
                    type="text"
                    inputMode="decimal"
                    data-slot="deductions-supply-amount-input"
                    className="deductions-supply-row__amount-input"
                    value={supply_amount_dollars}
                    onChange={(e) => {
                      if (disabled) return;
                      onChange({ supply_amount_dollars: e.target.value });
                    }}
                    onBlur={(e) => {
                      if (disabled) return;
                      const next = formatCardFeeOnBlur(e.target.value);
                      if (next !== supply_amount_dollars) {
                        onChange({ supply_amount_dollars: next });
                      }
                    }}
                    disabled={disabled}
                    aria-label={
                      disabled ? `Supply amount — ${OWNER_ONLY_TOOLTIP_COPY}` : "Supply amount"
                    }
                    aria-describedby={supplyAmountHint ? supplyAmountHintId : undefined}
                    aria-invalid={supplyAmountHint !== null}
                    placeholder="0.00"
                  />
                </OwnerOnlyTooltip>
              </div>
              <div className="deductions-supply-row__label-wrap">
                <OwnerOnlyTooltip disabled={disabled}>
                  <input
                    ref={supplyLabelRef}
                    id={supplyLabelId}
                    type="text"
                    data-slot="deductions-supply-label-input"
                    className="deductions-supply-row__label-input"
                    value={supply_label}
                    onChange={(e) => {
                      if (disabled) return;
                      onChange({ supply_label: e.target.value });
                    }}
                    disabled={disabled}
                    aria-label={
                      disabled ? `Supply label — ${OWNER_ONLY_TOOLTIP_COPY}` : "Supply label"
                    }
                    aria-describedby={
                      [
                        supplyLabelHint ? supplyLabelHintId : null,
                        showCounter ? supplyLabelCounterId : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    aria-invalid={supplyLabelHint !== null}
                    placeholder={SUPPLY_LABEL_PLACEHOLDER}
                  />
                </OwnerOnlyTooltip>
                {showCounter ? (
                  <span
                    id={supplyLabelCounterId}
                    className="deductions-supply-row__char-count"
                    data-slot="deductions-supply-label-counter"
                  >
                    {counterText}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Hidden FormData inputs for the supply amount + label —
                only rendered when toggle is on so the Server Action clears
                the columns on toggle off. */}
            <input type="hidden" name="supply_amount" value={supply_amount_dollars} />
            <input type="hidden" name="supply_label" value={supply_label} />

            {supplyAmountHint ? (
              <span
                id={supplyAmountHintId}
                className="deductions-card-fee-row__hint--error"
                data-slot="deductions-supply-amount-hint"
                role="alert"
              >
                {supplyAmountHint}
              </span>
            ) : null}
            {supplyLabelHint ? (
              <span
                id={supplyLabelHintId}
                className="deductions-card-fee-row__hint--error"
                data-slot="deductions-supply-label-hint"
                role="alert"
              >
                {supplyLabelHint}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── Net-to-tech preview (US4 / T036) ─────────────────────────────
          Pure presentation. Re-renders on every relevant draft keystroke
          via the `previewInput` memo above. NEVER role-gated — the
          preview is read-only and useful even when the operator can't
          save (FR-029). */}
      <div
        className="deductions-net-to-tech"
        data-slot="deductions-net-to-tech"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Net to tech preview"
      >
        <div className="deductions-net-to-tech__primary">
          <div
            className="deductions-net-to-tech__headline"
            data-slot="deductions-net-to-tech-headline"
          >
            Net to tech (card)
          </div>
          <div className="deductions-net-to-tech__amount" data-slot="deductions-net-to-tech-amount">
            {formatDollarsFromCents(net_cents)}
          </div>
        </div>
        <div
          className="deductions-net-to-tech__breakdown"
          data-slot="deductions-net-to-tech-breakdown"
        >
          {/* Service line — always rendered, even when price is 0 and the
              operator hasn't typed anything yet. FR-027. */}
          <div
            className="deductions-net-to-tech__breakdown-line deductions-net-to-tech__breakdown-line--service"
            data-slot="deductions-net-to-tech-line"
            data-kind="service"
          >
            {formatDollarsFromCents(previewServiceCents)}{" "}
            <span className="deductions-net-to-tech__breakdown-suffix">service</span>
          </div>
          {/* Card-fee line — omitted entirely when mode = 'exempt' so the
              operator sees the line drop, not a `−$0`. FR-027. */}
          {card_fee_mode !== "exempt" ? (
            <div
              className="deductions-net-to-tech__breakdown-line deductions-net-to-tech__breakdown-line--card-fee"
              data-slot="deductions-net-to-tech-line"
              data-kind="card-fee"
            >
              −{formatDollarsFromCents(card_fee_cents)}{" "}
              <span className="deductions-net-to-tech__breakdown-suffix">card fee</span>
            </div>
          ) : null}
          {/* Supply line — omitted entirely when Supply is off. The raw
              amount is shown even when the math clamped the net to $0 so
              the operator can see why. */}
          {supply_on ? (
            <div
              className="deductions-net-to-tech__breakdown-line deductions-net-to-tech__breakdown-line--supply"
              data-slot="deductions-net-to-tech-line"
              data-kind="supply"
            >
              −{formatDollarsFromCents(supply_cents)}{" "}
              <span className="deductions-net-to-tech__breakdown-suffix">{supplyLabelDisplay}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
