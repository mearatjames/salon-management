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
//     - Applies to: radio group (All services / Selected services) — feature
//       049 (T015). When "Selected services" is chosen, a chip-picker
//       renders below with one toggleable chip per service line in the
//       current cart. Save is disabled while no chip is picked + an inline
//       hint ("Pick at least one service.") is shown.
//   - Footer: Cancel + "Add discount" (primary)
//
// Validation:
//   - Save is disabled while:
//     - flat: amount ≤ 0 OR non-numeric
//     - percent: amount ∉ [1, 100] OR non-integer
//     - scope === "selected" AND no chip picked
//     - the in-flight `onSave` is pending
//
// Amount semantics passed to `onSave`:
//   - flat:   value = round(dollars * 100) → integer cents (positive)
//   - percent: value = integer percent (1..100)
//
// Scope semantics passed to `onSave`:
//   - scope === "all" → targetLineIds: null (today's default)
//   - scope === "selected" → targetLineIds: string[] (≥ 1, dedupe-preserved
//     in the order of `serviceLines`)
//
// The caller (checkout-screen.client.tsx) wraps `addDiscountLine` and
// closes the sheet on success. This component itself doesn't know about
// the action.

import { useMemo, useState } from "react";

import { X } from "lucide-react";

type Shape = "flat" | "percent";

type Scope = "all" | "selected";

export type DiscountSheetServiceLine = {
  /** ticket_items.id (persisted) OR clientLineId (ephemeral) — both surface as `line.id`. */
  id: string;
  name: string;
  unitPriceCents: number;
  priceUnconfirmed: boolean;
};

export type DiscountSheetOnSavePayload = {
  shape: Shape;
  /** Integer cents for flat; integer percent (1..100) for percent. */
  value: number;
  /** Empty string is passed through as `undefined` so the caller's optional
   *  field reflects "operator did not enter a note." */
  note: string | undefined;
  /**
   * Feature 049 (T015). `null` = applies to every service line on the
   * ticket (today's default — backward-compatible). Non-null = explicit
   * list of service-line ids the discount targets (deduped, non-empty).
   */
  targetLineIds: string[] | null;
};

export type DiscountSheetProps = {
  /**
   * Feature 049 (T015). Service lines in the current cart — the source
   * for the "Applies to" chip-picker. Order matches the order chips are
   * rendered + the order ids appear in the saved `targetLineIds` array.
   */
  serviceLines: ReadonlyArray<DiscountSheetServiceLine>;
  /**
   * Feature 049 (T015). Add mode: undefined. Edit mode (US3 / T032):
   * existing discount row snapshot — the sheet prefills shape/value/note/
   * scope from this prop. T015 ships the prop for type-shape completeness;
   * the prefill is wired in T032.
   *
   * NOTE: edit-mode prefill from `initial` lands in US3 (T032). The
   * sheet currently accepts and ignores this prop so callers can wire it
   * without a follow-up signature change.
   */
  initial?: {
    shape: Shape;
    value: number;
    note: string | null;
    targetLineIds: string[] | null;
  };
  onSave: (payload: DiscountSheetOnSavePayload) => Promise<void>;
  onCancel: () => void;
};

const NOTE_MAX = 80;

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function DiscountSheet({
  serviceLines,
  // Feature 049 (T032 / US3) — edit-mode prefill. When `initial` is
  // present, all four pieces of state (shape, amount, note, scope) seed
  // from the existing row so the operator can adjust just the field
  // they're changing. Add mode (no `initial`) keeps the default-empty
  // behavior. The contract says NOT to re-validate `initial.targetLineIds`
  // against the live `serviceLines` here — if a target id has gone
  // missing from the cart (out-of-band mutation while the sheet is open),
  // the server rejects on save with `scope_target_unknown` and the
  // caller surfaces an inline banner. Preemptive unpicking would hide
  // the discrepancy from the operator.
  initial,
  onSave,
  onCancel,
}: DiscountSheetProps) {
  const isEdit = initial != null;
  const [shape, setShape] = useState<Shape>(initial?.shape ?? "flat");
  // Working amount as a raw string so the operator can clear-and-retype
  // freely (matches the PriceSheet's input model). In edit mode, seed
  // from `initial.value` translated to the input convention: flat values
  // are stored as integer cents and rendered as dollars; percent values
  // are stored as integer percents and rendered as-is.
  const [amount, setAmount] = useState<string>(() => {
    if (!initial) return "";
    if (initial.shape === "flat") return (initial.value / 100).toString();
    return initial.value.toString();
  });
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [pending, setPending] = useState(false);

  // Feature 049 (T015) — scope state. Default "all" preserves today's
  // behavior (FR-005 / SC-005). Switching to "selected" reveals the chip
  // picker; switching back to "all" keeps the chip selections so a
  // ping-pong doesn't lose work. Edit mode (T032): seed from
  // `initial.targetLineIds` — null → "all" with empty picks; non-null →
  // "selected" with each id picked.
  const [scope, setScope] = useState<Scope>(() => {
    if (initial?.targetLineIds != null) return "selected";
    return "all";
  });
  // Map<lineId, picked>. Lines that aren't in this map are treated as
  // not-picked. Driven from `serviceLines` so a re-render with an updated
  // cart doesn't lose user intent.
  const [pickedById, setPickedById] = useState<Record<string, boolean>>(() => {
    const seeded: Record<string, boolean> = {};
    if (initial?.targetLineIds != null) {
      for (const id of initial.targetLineIds) seeded[id] = true;
    }
    return seeded;
  });

  // Insertion-order list of currently-picked ids. Deduped by Map semantics.
  const pickedIds = useMemo(() => {
    const ids: string[] = [];
    for (const line of serviceLines) {
      if (pickedById[line.id]) ids.push(line.id);
    }
    return ids;
  }, [serviceLines, pickedById]);

  // Parse-on-demand. `parseFloat("")` returns NaN; the boolean checks
  // below treat NaN as invalid for both shapes.
  const numericValue = parseFloat(amount);
  const amountValid = (() => {
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

  // FR-013 Save-disabled matrix. Scope=selected with 0 picks blocks save
  // and surfaces the inline hint.
  const scopeValid = scope === "all" || pickedIds.length >= 1;
  const saveDisabled = !amountValid || !scopeValid || pending;
  const showEmptyScopeHint = scope === "selected" && pickedIds.length === 0;

  function onSubmit() {
    if (saveDisabled) return;
    setPending(true);
    const value = shape === "flat" ? Math.round(numericValue * 100) : Math.trunc(numericValue);
    const noteOrUndef = note.trim() === "" ? undefined : note.trim();
    const targetLineIds = scope === "all" ? null : pickedIds;
    onSave({ shape, value, note: noteOrUndef, targetLineIds })
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

  function pickScope(next: Scope) {
    if (next === scope) return;
    setScope(next);
  }

  function toggleChip(lineId: string) {
    setPickedById((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  }

  return (
    <div
      className="tx-sheet-backdrop"
      data-slot="discount-sheet"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Edit discount" : "Add discount"}
    >
      <div className="tx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tx-sheet-h">
          <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>
            {isEdit ? "Edit discount" : "Add discount"}
          </div>
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

          {/* Feature 049 (T015) — Applies-to scope picker. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div
              style={{
                fontSize: "var(--text-xs)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                fontWeight: 500,
                color: "var(--muted-foreground)",
              }}
            >
              Applies to
            </div>
            <div
              role="radiogroup"
              aria-label="Applies to"
              style={{
                display: "flex",
                gap: "var(--space-2)",
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={scope === "all"}
                data-slot="discount-sheet-scope-all"
                data-active={scope === "all" ? "true" : "false"}
                onClick={() => pickScope("all")}
                style={{
                  flex: "1 1 0",
                  padding: "var(--space-2) var(--space-3)",
                  background:
                    scope === "all"
                      ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                      : "var(--card)",
                  border: scope === "all" ? "1px solid var(--primary)" : "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: scope === "all" ? "var(--primary)" : "var(--foreground)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                All services in this sale
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "selected"}
                data-slot="discount-sheet-scope-selected"
                data-active={scope === "selected" ? "true" : "false"}
                onClick={() => pickScope("selected")}
                style={{
                  flex: "1 1 0",
                  padding: "var(--space-2) var(--space-3)",
                  background:
                    scope === "selected"
                      ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                      : "var(--card)",
                  border:
                    scope === "selected" ? "1px solid var(--primary)" : "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: scope === "selected" ? "var(--primary)" : "var(--foreground)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Selected services
              </button>
            </div>

            {scope === "selected" ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                }}
              >
                {serviceLines.map((line) => {
                  const picked = !!pickedById[line.id];
                  return (
                    <button
                      key={line.id}
                      type="button"
                      role="checkbox"
                      aria-checked={picked}
                      data-slot="discount-sheet-scope-chip"
                      data-line-id={line.id}
                      data-picked={picked ? "true" : "false"}
                      onClick={() => toggleChip(line.id)}
                      style={{
                        padding: "var(--space-2) var(--space-3)",
                        background: picked
                          ? "color-mix(in oklch, var(--primary) 10%, transparent)"
                          : "var(--card)",
                        border: picked ? "1px solid var(--primary)" : "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: picked ? "var(--primary)" : "var(--foreground)",
                        fontSize: "var(--text-sm)",
                        fontWeight: 500,
                        cursor: "pointer",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {line.name} {fmtDollars(line.unitPriceCents)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {showEmptyScopeHint ? (
              <div
                data-slot="discount-sheet-scope-hint"
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--muted-foreground)",
                }}
              >
                Pick at least one service.
              </div>
            ) : null}
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
            {isEdit ? "Save changes" : "Add discount"}
          </button>
        </div>
      </div>
    </div>
  );
}
