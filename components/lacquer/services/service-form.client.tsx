"use client";

// ServiceForm — the field stack inside the services drawer. Renders the
// fields in the order documented in FR-011:
//
//   name → category (with auto-complete) → duration → price branch
//   → color swatches → taxable toggle → variable_price toggle
//
// The "price" field swaps to a From / To / note row when `variable_price`
// is on. Inline validation hints surface per-field via a try/catch against
// the existing validators in `_validation.ts` — that way the UI hints stay
// in sync with what the Server Action will accept.
//
// State is fully controlled: the parent (drawer.client.tsx) owns the draft
// and passes both `draft` and `onChange(patch)`. The `baseline` prop is
// `null` in Add mode and the saved snapshot in Edit mode — this island
// doesn't compare them directly; the drawer derives `isDirty` from them.
//
// Honors `disabled: boolean` for US6 (technician / front-desk view).

import { useMemo, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeductionsSection } from "@/components/lacquer/services/deductions-section.client";
import {
  ValidationError,
  validateBoundDollars,
  validateBoundsConsistency,
  validateCardFeeCustomDollars,
  validateCategory,
  validateDurationMin,
  validateFixedPriceDollars,
  validateName,
  validateSupplyAmountDollars,
  validateSupplyLabel,
} from "@/app/(studio)/services/_validation";
import type {
  AvatarColorToken,
  CardFeeMode,
  ServiceAssignment,
  ServiceDraftBaseline,
} from "@/app/(studio)/services/_types";

// Working-state shape for the panel's draft. Strings on every numeric
// field so the input value can mirror what the user typed without losing
// trailing zeroes or partial decimals; the Server Action re-validates on
// submit.
//
// 021-services-deductions (data-model.md § 2.2): the draft buffer extends
// with `card_fee_mode` + `card_fee_custom_dollars` (US2) and
// `supply_on` + `supply_amount_dollars` + `supply_label` (US3). The custom
// buffer is preserved across mode flips per FR-014 — the typed value
// survives a flip to default/exempt and re-appears if the operator flips
// back to custom. Same buffer rule for supply (FR-021): the dollars + label
// strings survive off→on→off cycles. The Server Action ignores
// `card_fee_custom` when mode != custom (T016) and the supply fields when
// `supply_on=""`; the dirty-detector mirrors the same rule client-side.
export type ServiceDraft = {
  name: string;
  category: string;
  duration_min: string;
  price: string;
  color_token: AvatarColorToken;
  taxable: boolean;
  variable_price: boolean;
  price_from: string;
  price_to: string;
  variable_price_note: string;
  assignments: ServiceAssignment[];
  // 021-services-deductions card-fee fields.
  card_fee_mode: CardFeeMode;
  /** Empty string = unset; "0", "4", "4.50". Preserved across mode flips. */
  card_fee_custom_dollars: string;
  // 021-services-deductions supply fields.
  supply_on: boolean;
  /** Empty string = unset; "5", "5.00", "5.50". Preserved across toggle off. */
  supply_amount_dollars: string;
  /** Free-text label. Preserved across toggle off (FR-021). */
  supply_label: string;
};

export const SERVICE_COLOR_OPTIONS: ReadonlyArray<{ token: AvatarColorToken; label: string }> = [
  { token: "--avatar-rose", label: "Rose" },
  { token: "--avatar-blue", label: "Blue" },
  { token: "--avatar-green", label: "Green" },
  { token: "--avatar-amber", label: "Amber" },
  { token: "--avatar-purple", label: "Purple" },
  { token: "--avatar-teal", label: "Teal" },
  { token: "--avatar-orange", label: "Orange" },
  { token: "--avatar-slate", label: "Slate" },
];

/** Factory defaults per `research.md § R12` (Add-mode initial draft). */
export function makeDefaultDraft(): ServiceDraft {
  return {
    name: "",
    category: "Other",
    duration_min: "30",
    price: "",
    color_token: "--avatar-rose",
    taxable: false,
    variable_price: false,
    price_from: "",
    price_to: "",
    variable_price_note: "",
    assignments: [],
    card_fee_mode: "default",
    card_fee_custom_dollars: "",
    supply_on: false,
    supply_amount_dollars: "",
    supply_label: "",
  };
}

/** Hydrate a draft from a saved service baseline (Edit-mode initial draft). */
export function makeDraftFromBaseline(baseline: ServiceDraftBaseline): ServiceDraft {
  // Convert cents to dollars-string for the input fields. Mirrors the
  // formatter in `_format.ts` but yields the editable representation
  // (e.g. `45.50` not `$45.50`).
  const dollarsFromCents = (cents: number | null): string => {
    if (cents === null) return "";
    const dollars = Math.floor(cents / 100);
    const remainder = cents % 100;
    if (remainder === 0) return String(dollars);
    return `${dollars}.${String(remainder).padStart(2, "0")}`;
  };

  return {
    name: baseline.name,
    category: baseline.category,
    duration_min: String(baseline.duration_min),
    price: dollarsFromCents(baseline.price_cents),
    color_token: baseline.color_token,
    taxable: baseline.taxable,
    variable_price: baseline.variable_price,
    price_from: dollarsFromCents(baseline.price_from_cents),
    price_to: dollarsFromCents(baseline.price_to_cents),
    variable_price_note: baseline.variable_price_note ?? "",
    assignments: baseline.assignments,
    card_fee_mode: baseline.card_fee_mode,
    // When mode = custom, stringify the cents back to dollars so the
    // operator sees their saved value. When mode != custom, leave the
    // buffer empty — the row's `card_fee_custom_cents` is `null` per the
    // DB CHECK constraint anyway.
    card_fee_custom_dollars:
      baseline.card_fee_mode === "custom"
        ? dollarsFromCents(baseline.card_fee_custom_cents ?? 0)
        : "",
    // 021-services-deductions: supply state. `supply_on` is derived from
    // whether the row has a stored amount. When on, hydrate dollars +
    // label; when off, leave the buffer empty so the toggle-on default
    // fires the `'5.00'` pre-fill (FR-021).
    supply_on: baseline.supply_amount_cents !== null,
    supply_amount_dollars:
      baseline.supply_amount_cents !== null ? dollarsFromCents(baseline.supply_amount_cents) : "",
    supply_label: baseline.supply_amount_cents !== null ? (baseline.supply_label ?? "") : "",
  };
}

export type ServiceFormProps = {
  baseline: ServiceDraftBaseline | null;
  draft: ServiceDraft;
  onChange: (patch: Partial<ServiceDraft>) => void;
  /** Categories already in the catalog — drives the auto-complete popover. */
  categories: string[];
  /** Read-only mode (US6). */
  disabled?: boolean;
  /**
   * 021-services-deductions § Phase 3 (US1): when the form is mounted inside
   * `<EditPanel>` (two-pane layout), the panel owns the outer padding and
   * card surface. The form itself drops its outer chrome and only renders
   * the vertical field stack. Defaults to `false` so any remaining drawer
   * call site (none after T022) still receives the same layout.
   */
  inspectorChrome?: boolean;
};

/**
 * Pure-function check the drawer uses to decide whether Save should be
 * disabled. Mirrors the inline-hint logic inside <ServiceForm>: any field-
 * shape error OR an inverted-bounds error makes the draft un-saveable.
 *
 * Empty fields are NOT counted as errors here — the Server Action will
 * surface those on submit. We only catch issues that the operator can fix
 * inline by re-typing (bad decimal, inverted bounds).
 */
export function hasFormErrors(draft: ServiceDraft): boolean {
  try {
    validateName(draft.name);
  } catch {
    return true;
  }
  try {
    validateCategory(draft.category);
  } catch {
    return true;
  }
  try {
    validateDurationMin(draft.duration_min);
  } catch {
    return true;
  }
  if (draft.variable_price) {
    let from: number | null;
    let to: number | null;
    try {
      from = validateBoundDollars(draft.price_from);
    } catch {
      return true;
    }
    try {
      to = validateBoundDollars(draft.price_to);
    } catch {
      return true;
    }
    try {
      validateBoundsConsistency(from, to);
    } catch {
      return true;
    }
  } else if (draft.price.trim().length > 0) {
    // Only validate the fixed-price field when the operator typed something;
    // empty is the Server Action's job to surface on submit.
    try {
      validateFixedPriceDollars(draft.price);
    } catch {
      return true;
    }
  }
  // 021-services-deductions: when mode = custom, the amount input is
  // required + bounded — empty / non-numeric / > $50 all disable Save.
  // Modes default + exempt have no companion input to validate.
  if (draft.card_fee_mode === "custom") {
    if (draft.card_fee_custom_dollars.trim().length === 0) return true;
    try {
      validateCardFeeCustomDollars(draft.card_fee_custom_dollars);
    } catch {
      return true;
    }
  }
  // 021-services-deductions: when supply is on, both inputs are required +
  // bounded. The validators throw for empty / zero / negative / > $50 on
  // the amount and empty-after-trim / > 64 chars on the label.
  if (draft.supply_on) {
    try {
      validateSupplyAmountDollars(draft.supply_amount_dollars);
    } catch {
      return true;
    }
    try {
      validateSupplyLabel(draft.supply_label);
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Run a validator and return the error message (or null if valid). Used
 * for inline hints — the Server Action re-validates on submit so this is
 * purely a UX affordance.
 */
function tryValidate(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof ValidationError) return err.code;
    return null;
  }
}

const ERROR_HINT: Record<string, string> = {
  name_too_short: "Name must be at least 2 characters.",
  category_required: "Pick or type a category.",
  invalid_duration: "Duration must be a positive number of minutes.",
  invalid_price: "Price must be a non-negative amount (e.g. 45 or 45.50).",
  invalid_bound: "Bound must be a non-negative amount (e.g. 20 or 20.00).",
  bounds_inverted: '"From" price can\'t be higher than "To" price.',
};

export function ServiceForm({
  baseline,
  draft,
  onChange,
  categories,
  disabled = false,
  inspectorChrome = false,
}: ServiceFormProps) {
  void baseline; // currently unused — panel derives dirty-state from baseline
  void inspectorChrome; // currently no per-mode chrome differences; reserved for Phase 4+
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);

  // Inline validation hints — recomputed cheaply on every render.
  const nameError = useMemo(() => tryValidate(() => validateName(draft.name)), [draft.name]);
  const categoryError = useMemo(
    () => tryValidate(() => validateCategory(draft.category)),
    [draft.category]
  );
  const durationError = useMemo(
    () => tryValidate(() => validateDurationMin(draft.duration_min)),
    [draft.duration_min]
  );
  const priceError = useMemo(() => {
    if (draft.variable_price) return null;
    if (draft.price.trim().length === 0) return null; // hint surfaces on submit
    return tryValidate(() => validateFixedPriceDollars(draft.price));
  }, [draft.variable_price, draft.price]);

  const fromError = useMemo(() => {
    if (!draft.variable_price) return null;
    if (draft.price_from.trim().length === 0) return null;
    return tryValidate(() => validateBoundDollars(draft.price_from));
  }, [draft.variable_price, draft.price_from]);
  const toError = useMemo(() => {
    if (!draft.variable_price) return null;
    if (draft.price_to.trim().length === 0) return null;
    return tryValidate(() => validateBoundDollars(draft.price_to));
  }, [draft.variable_price, draft.price_to]);
  const boundsError = useMemo(() => {
    if (!draft.variable_price) return null;
    if (fromError || toError) return null;
    return tryValidate(() => {
      const f = validateBoundDollars(draft.price_from);
      const t = validateBoundDollars(draft.price_to);
      validateBoundsConsistency(f, t);
    });
  }, [draft.variable_price, draft.price_from, draft.price_to, fromError, toError]);

  // Filter the category popover suggestions by what the user has typed so
  // far. Case-insensitive substring match.
  const categorySuggestions = useMemo(() => {
    const q = draft.category.trim().toLowerCase();
    if (q.length === 0) return categories;
    return categories.filter((c) => c.toLowerCase().includes(q) && c.toLowerCase() !== q);
  }, [draft.category, categories]);

  return (
    <div
      data-slot="service-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Name */}
      <div style={fieldStyle}>
        <label htmlFor="service-form-name" style={labelStyle}>
          Service name
        </label>
        <input
          id="service-form-name"
          name="name"
          type="text"
          data-slot="service-form-name-input"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          placeholder="e.g. Gel polish"
          style={{
            ...inputStyle,
            cursor: disabled ? "not-allowed" : "text",
            opacity: disabled ? 0.6 : 1,
          }}
        />
        {nameError ? (
          <span style={errorHintStyle} data-slot="service-form-name-hint">
            {ERROR_HINT[nameError] ?? nameError}
          </span>
        ) : null}
      </div>

      {/* Category (with auto-complete popover) */}
      <div style={fieldStyle}>
        <label htmlFor="service-form-category" style={labelStyle}>
          Category
        </label>
        <Popover open={categoryPopoverOpen && !disabled} onOpenChange={setCategoryPopoverOpen}>
          <PopoverTrigger asChild>
            <input
              id="service-form-category"
              name="category"
              type="text"
              data-slot="service-form-category-input"
              value={draft.category}
              onChange={(e) => {
                onChange({ category: e.target.value });
                if (!categoryPopoverOpen) setCategoryPopoverOpen(true);
              }}
              onFocus={() => {
                if (!disabled) setCategoryPopoverOpen(true);
              }}
              disabled={disabled}
              autoComplete="off"
              placeholder="Manicure, Pedicure, Add-on, …"
              style={{
                ...inputStyle,
                cursor: disabled ? "not-allowed" : "text",
                opacity: disabled ? 0.6 : 1,
              }}
            />
          </PopoverTrigger>
          {categorySuggestions.length > 0 ? (
            <PopoverContent
              align="start"
              data-slot="service-form-category-suggestions"
              onOpenAutoFocus={(e) => e.preventDefault()}
              style={{
                padding: "var(--space-1)",
                width: "var(--radix-popover-trigger-width)",
              }}
            >
              {categorySuggestions.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-slot="service-form-category-option"
                  data-value={c}
                  onClick={() => {
                    onChange({ category: c });
                    setCategoryPopoverOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    background: "transparent",
                    color: "var(--foreground)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "var(--text-sm)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {c}
                </button>
              ))}
            </PopoverContent>
          ) : null}
        </Popover>
        {categoryError ? (
          <span style={errorHintStyle}>{ERROR_HINT[categoryError] ?? categoryError}</span>
        ) : null}
      </div>

      {/* Duration */}
      <div style={fieldStyle}>
        <label htmlFor="service-form-duration" style={labelStyle}>
          Duration (minutes)
        </label>
        <input
          id="service-form-duration"
          name="duration_min"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          data-slot="service-form-duration-input"
          value={draft.duration_min}
          onChange={(e) => onChange({ duration_min: e.target.value })}
          disabled={disabled}
          placeholder="30"
          style={{
            ...inputStyle,
            fontVariantNumeric: "tabular-nums",
            cursor: disabled ? "not-allowed" : "text",
            opacity: disabled ? 0.6 : 1,
          }}
        />
        {durationError ? (
          <span style={errorHintStyle}>{ERROR_HINT[durationError] ?? durationError}</span>
        ) : null}
      </div>

      {/* Price branch — fixed price OR variable bounds + note */}
      {draft.variable_price ? (
        <div style={fieldStyle}>
          <span style={labelStyle}>Price range</span>
          <div className="service-variable-price-row">
            <div style={fieldStyle}>
              <label htmlFor="service-form-price-from" style={subLabelStyle}>
                From
              </label>
              <input
                id="service-form-price-from"
                name="price_from"
                type="text"
                inputMode="decimal"
                data-slot="service-form-price-from-input"
                value={draft.price_from}
                onChange={(e) => onChange({ price_from: e.target.value })}
                disabled={disabled}
                placeholder="20"
                style={{
                  ...inputStyle,
                  fontVariantNumeric: "tabular-nums",
                  cursor: disabled ? "not-allowed" : "text",
                  opacity: disabled ? 0.6 : 1,
                }}
              />
              {fromError ? (
                <span style={errorHintStyle}>{ERROR_HINT[fromError] ?? fromError}</span>
              ) : null}
            </div>
            <div style={fieldStyle}>
              <label htmlFor="service-form-price-to" style={subLabelStyle}>
                To
              </label>
              <input
                id="service-form-price-to"
                name="price_to"
                type="text"
                inputMode="decimal"
                data-slot="service-form-price-to-input"
                value={draft.price_to}
                onChange={(e) => onChange({ price_to: e.target.value })}
                disabled={disabled}
                placeholder="60"
                style={{
                  ...inputStyle,
                  fontVariantNumeric: "tabular-nums",
                  cursor: disabled ? "not-allowed" : "text",
                  opacity: disabled ? 0.6 : 1,
                }}
              />
              {toError ? (
                <span style={errorHintStyle}>{ERROR_HINT[toError] ?? toError}</span>
              ) : null}
            </div>
          </div>
          {boundsError ? (
            <span style={errorHintStyle}>{ERROR_HINT[boundsError] ?? boundsError}</span>
          ) : null}
          <div className="service-variable-price-note">
            <label htmlFor="service-form-price-note" style={subLabelStyle}>
              Note (optional)
            </label>
            <input
              id="service-form-price-note"
              name="variable_price_note"
              type="text"
              data-slot="service-form-price-note-input"
              value={draft.variable_price_note}
              onChange={(e) => onChange({ variable_price_note: e.target.value })}
              disabled={disabled}
              placeholder="Depends on design complexity"
              style={{
                ...inputStyle,
                marginTop: "var(--space-1)",
                cursor: disabled ? "not-allowed" : "text",
                opacity: disabled ? 0.6 : 1,
              }}
            />
          </div>
        </div>
      ) : (
        <div style={fieldStyle}>
          <label htmlFor="service-form-price" style={labelStyle}>
            Price ($)
          </label>
          <input
            id="service-form-price"
            name="price"
            type="text"
            inputMode="decimal"
            data-slot="service-form-price-input"
            value={draft.price}
            onChange={(e) => onChange({ price: e.target.value })}
            disabled={disabled}
            placeholder="45"
            style={{
              ...inputStyle,
              fontVariantNumeric: "tabular-nums",
              cursor: disabled ? "not-allowed" : "text",
              opacity: disabled ? 0.6 : 1,
            }}
          />
          {priceError ? (
            <span style={errorHintStyle}>{ERROR_HINT[priceError] ?? priceError}</span>
          ) : null}
        </div>
      )}

      {/* Color swatches — 8 `--avatar-*` radios */}
      <fieldset
        style={{
          ...fieldStyle,
          border: "none",
          padding: 0,
          margin: 0,
        }}
        disabled={disabled}
        data-slot="service-form-color-swatches"
      >
        <legend style={labelStyle}>Color</legend>
        <div
          role="radiogroup"
          aria-label="Service color"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          {SERVICE_COLOR_OPTIONS.map((opt) => {
            const checked = opt.token === draft.color_token;
            return (
              <label
                key={opt.token}
                title={opt.label}
                aria-label={opt.label}
                data-slot="service-color-swatch"
                data-color-token={opt.token}
                data-checked={checked ? "true" : "false"}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "var(--space-8)",
                  height: "var(--space-8)",
                  borderRadius: "var(--radius-full)",
                  background: `var(${opt.token})`,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  boxShadow: checked
                    ? `0 0 0 2px var(--background), 0 0 0 4px var(${opt.token})`
                    : "none",
                  transition: "box-shadow var(--duration-fast) var(--ease-out)",
                }}
              >
                <input
                  type="radio"
                  name="color_token"
                  value={opt.token}
                  checked={checked}
                  onChange={() => onChange({ color_token: opt.token })}
                  disabled={disabled}
                  aria-label={opt.label}
                  style={{
                    position: "absolute",
                    inset: 0,
                    opacity: 0,
                    margin: 0,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 021-services-deductions: Deductions section (card-fee row in US2;
          supply + preview in US3 / US4). Mounted immediately after Color
          per `data-model.md § 2.2`. */}
      <DeductionsSection
        card_fee_mode={draft.card_fee_mode}
        card_fee_custom_dollars={draft.card_fee_custom_dollars}
        supply_on={draft.supply_on}
        supply_amount_dollars={draft.supply_amount_dollars}
        supply_label={draft.supply_label}
        // 021-US4 (T036): live preview inputs. The deductions section needs
        // read-only access to the price draft to compute net-to-tech; the
        // section itself never edits these.
        variable_price={draft.variable_price}
        price_dollars={draft.price}
        price_from_dollars={draft.price_from}
        onChange={onChange}
        disabled={disabled}
      />

      {/* Taxable toggle */}
      <div
        style={{
          ...fieldStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <label htmlFor="service-form-taxable" style={labelStyle}>
          Taxable
        </label>
        <Switch
          id="service-form-taxable"
          data-slot="service-form-taxable-switch"
          checked={draft.taxable}
          onCheckedChange={(next: boolean) => onChange({ taxable: next })}
          disabled={disabled}
          aria-label="Taxable"
        />
        {/* FormData encodes via the hidden input: "on" when checked, omitted when off. */}
        <input type="hidden" name="taxable" value={draft.taxable ? "on" : ""} />
      </div>

      {/* Variable-price toggle */}
      <div
        style={{
          ...fieldStyle,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <label htmlFor="service-form-variable" style={labelStyle}>
          Variable price
        </label>
        <Switch
          id="service-form-variable"
          data-slot="service-form-variable-switch"
          checked={draft.variable_price}
          onCheckedChange={(next: boolean) => {
            // Toggling on  → clear the fixed-price field (it's about to be
            //               hidden and the Server Action would ignore it
            //               anyway, but a stale value would re-appear if
            //               the operator toggles back off).
            // Toggling off → clear the variable-only fields so the saved
            //               row matches the DB CHECK constraint (all three
            //               variable-only columns must be NULL when
            //               `variable_price = false`).
            if (next) {
              onChange({
                variable_price: true,
                price: "",
              });
            } else {
              // Also clear `price` — when the draft was hydrated from a
              // variable-price baseline, `price` mirrors the lower bound
              // (the DB stores `price_cents = price_from_cents ?? 0`), and
              // surfacing that as a "fixed price" suggestion would be
              // misleading. Force the operator to re-enter a deliberate
              // fixed price.
              onChange({
                variable_price: false,
                price: "",
                price_from: "",
                price_to: "",
                variable_price_note: "",
              });
            }
          }}
          disabled={disabled}
          aria-label="Variable price"
        />
        <input type="hidden" name="variable_price" value={draft.variable_price ? "on" : ""} />
      </div>
    </div>
  );
}

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-1)",
};

const labelStyle = {
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  color: "var(--foreground)",
};

const subLabelStyle = {
  fontSize: "var(--text-xs)",
  fontWeight: 500,
  color: "var(--muted-foreground)",
};

const inputStyle = {
  padding: "var(--space-2) var(--space-3)",
  background: "var(--card)",
  color: "var(--foreground)",
  border: "1px solid var(--input)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--text-sm)",
  outline: "none",
};

const errorHintStyle = {
  fontSize: "var(--text-xs)",
  color: "var(--destructive)",
};
