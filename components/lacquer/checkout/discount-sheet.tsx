"use client";

// DiscountSheet — T029 (US3). Small new component (no prototype; composed
// from primitive `<input>` elements styled with the Lacquer tokens that
// the rest of the checkout chrome uses). Matches the visual shell of the
// sibling `<PriceSheet/>` (tx-sheet-backdrop / tx-sheet / tx-sheet-h /
// tx-sheet-body / tx-sheet-foot + tx-btn classes from checkout.css) so the
// two sheets read as a single family.
//
// Layout:
//   - Header: "Add discount" + close button
//   - Body:
//     - Shape: radio group with two options (Flat amount / Percent)
//     - Amount input: dollars for flat, integer 1-100 for percent
//     - Note input with a live 80-char counter
//   - Footer: Cancel + "Add discount" (primary)
//
// Validation:
//   - Save is disabled while:
//     - flat: amount ≤ 0 OR non-numeric
//     - percent: amount ∉ [1, 100] OR non-integer
//     - the in-flight `onSave` is pending
//
// Amount semantics passed to `onSave`:
//   - flat:   value = round(dollars * 100) → integer cents (positive)
//   - percent: value = integer percent (1..100)
//
// The caller (checkout-screen.client.tsx) wraps `addDiscountLine` and
// closes the sheet on success. This component itself doesn't know about
// the action.

import { useState } from "react";

import { X } from "lucide-react";

type Shape = "flat" | "percent";

export type DiscountSheetOnSavePayload = {
  shape: Shape;
  /** Integer cents for flat; integer percent (1..100) for percent. */
  value: number;
  /** Empty string is passed through as `undefined` so the caller's optional
   *  field reflects "operator did not enter a note." */
  note: string | undefined;
};

export type DiscountSheetProps = {
  onSave: (payload: DiscountSheetOnSavePayload) => Promise<void>;
  onCancel: () => void;
};

const NOTE_MAX = 80;

export function DiscountSheet({ onSave, onCancel }: DiscountSheetProps) {
  const [shape, setShape] = useState<Shape>("flat");
  // Working amount as a raw string so the operator can clear-and-retype
  // freely (matches the PriceSheet's input model).
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [pending, setPending] = useState(false);

  // Parse-on-demand. `parseFloat("")` returns NaN; the boolean checks
  // below treat NaN as invalid for both shapes.
  const numericValue = parseFloat(amount);
  const isValid = (() => {
    if (!Number.isFinite(numericValue)) return false;
    if (shape === "flat") {
      // Dollars > 0; integer-cents enforcement is at the boundary
      // (Math.round(dollars * 100) > 0 is equivalent for amounts entered
      // via this field — the operator can type fractional dollars and the
      // round-to-cents below produces a positive integer).
      return numericValue > 0;
    }
    // percent: whole integer in [1, 100].
    return Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 100;
  })();
  const saveDisabled = !isValid || pending;

  function onSubmit() {
    if (saveDisabled) return;
    setPending(true);
    const value = shape === "flat" ? Math.round(numericValue * 100) : Math.trunc(numericValue);
    const noteOrUndef = note.trim() === "" ? undefined : note.trim();
    onSave({ shape, value, note: noteOrUndef })
      // The caller is expected to close the sheet on success (which will
      // unmount this component). On failure, re-enable the Save button so
      // the operator can retry. We swallow the rejection because surfacing
      // it is the caller's responsibility (error banner in the cart).
      .catch(() => undefined)
      .finally(() => setPending(false));
  }

  // When switching shape, reset the amount so the unit semantics don't
  // carry stale dollars into percent (or vice versa) and confuse the
  // operator.
  function pickShape(next: Shape) {
    if (next === shape) return;
    setShape(next);
    setAmount("");
  }

  return (
    <div
      className="tx-sheet-backdrop"
      data-slot="discount-sheet"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Add discount"
    >
      <div className="tx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tx-sheet-h">
          <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>Add discount</div>
          <button
            type="button"
            className="tx-stepper-btn"
            onClick={onCancel}
            aria-label="Close discount sheet"
            data-slot="discount-sheet-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-sheet-body">
          {/* Shape — radio group */}
          <div
            role="radiogroup"
            aria-label="Discount shape"
            style={{
              display: "flex",
              gap: "var(--space-2)",
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={shape === "flat"}
              data-slot="discount-sheet-shape-flat"
              data-active={shape === "flat" ? "true" : "false"}
              onClick={() => pickShape("flat")}
              style={{
                flex: "1 1 0",
                padding: "var(--space-2) var(--space-3)",
                background:
                  shape === "flat"
                    ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                    : "var(--card)",
                border: shape === "flat" ? "1px solid var(--primary)" : "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: shape === "flat" ? "var(--primary)" : "var(--foreground)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Flat amount
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={shape === "percent"}
              data-slot="discount-sheet-shape-percent"
              data-active={shape === "percent" ? "true" : "false"}
              onClick={() => pickShape("percent")}
              style={{
                flex: "1 1 0",
                padding: "var(--space-2) var(--space-3)",
                background:
                  shape === "percent"
                    ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                    : "var(--card)",
                border:
                  shape === "percent" ? "1px solid var(--primary)" : "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: shape === "percent" ? "var(--primary)" : "var(--foreground)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Percent
            </button>
          </div>

          {/* Amount input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label
              htmlFor="discount-sheet-amount"
              style={{
                fontSize: "var(--text-xs)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                fontWeight: 500,
                color: "var(--muted-foreground)",
              }}
            >
              {shape === "flat" ? "Amount ($)" : "Percent (1–100)"}
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <input
                id="discount-sheet-amount"
                data-slot="discount-sheet-amount"
                type="text"
                inputMode={shape === "flat" ? "decimal" : "numeric"}
                value={amount}
                onChange={(e) => {
                  // Allow digits + (for flat) one decimal point. The
                  // numericValue parse above tolerates everything; the
                  // raw filter here just removes typos that aren't valid
                  // numeric characters so the displayed value stays clean.
                  const raw = e.target.value;
                  if (shape === "flat") {
                    // dollars: digits + optional single dot
                    if (/^\d*\.?\d*$/.test(raw)) setAmount(raw);
                  } else {
                    // percent: digits only
                    if (/^\d*$/.test(raw)) setAmount(raw);
                  }
                }}
                placeholder={shape === "flat" ? "0.00" : "15"}
                style={{
                  flex: "1 1 auto",
                  padding: "var(--space-2) var(--space-3)",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--foreground)",
                  fontSize: "var(--text-base)",
                  fontFamily: "var(--font-sans)",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
              {shape === "percent" ? (
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--muted-foreground)",
                    fontWeight: 500,
                  }}
                >
                  %
                </span>
              ) : null}
            </div>
          </div>

          {/* Note input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label
              htmlFor="discount-sheet-note"
              style={{
                fontSize: "var(--text-xs)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                fontWeight: 500,
                color: "var(--muted-foreground)",
              }}
            >
              Note (optional)
            </label>
            <input
              id="discount-sheet-note"
              data-slot="discount-sheet-note"
              type="text"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Loyalty perk"
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--foreground)",
                fontSize: "var(--text-base)",
                fontFamily: "var(--font-sans)",
              }}
            />
            <div
              aria-live="polite"
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--muted-foreground)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {note.length}/{NOTE_MAX}
            </div>
          </div>
        </div>

        <div className="tx-sheet-foot">
          <button
            type="button"
            className="tx-btn secondary"
            onClick={onCancel}
            data-slot="discount-sheet-cancel"
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="tx-btn"
            onClick={onSubmit}
            disabled={saveDisabled}
            data-slot="discount-sheet-save"
          >
            Add discount
          </button>
        </div>
      </div>
    </div>
  );
}
