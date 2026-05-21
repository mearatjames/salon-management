"use client";

// PriceSheet — adapted 1:1 from
// `design-system/prototypes/transaction/components.jsx::PriceSheet`.
//
// One sheet covers both US1 (auto-open after tile tap on a variable-
// priced service; `isOverride=false`) and US2 (operator-initiated price
// override on a confirmed cart row; `isOverride=true`). The only
// behavioural split is the Remove button visibility:
//   - !isOverride && priceUnconfirmed → Remove rendered (US1; FR-007)
//   - isOverride                       → Remove hidden (US2)
//
// The numpad starts collapsed; tapping the big-price button reveals it.
// The first numpad keypress replaces the current value (the fresh-edit
// affordance per FR-005). Cancel always just closes — never deletes the
// row (per the spec's clarification on Cancel semantics).
//
// All visuals are token-driven (Principle I — Design System Fidelity).
// Internal state holds a dollar string (matches the prototype's
// keystroke model); we convert dollars→cents at the boundary by
// rounding `parseFloat(val) * 100` so the parent's `onSave(cents)`
// callback can be passed verbatim to `setLinePrice({...,
// unitPriceCents})`.

import { useEffect, useRef, useState } from "react";

// `Delete` is Lucide's backspace-key glyph (the prototype calls it
// "Backspace"; Lucide's name for that shape is `Delete`).
import { Delete, Edit3, X } from "lucide-react";

export type PriceSheetPreset = { label: string; price_cents: number };

export type PriceSheetServiceMeta = {
  variable: boolean;
  priceFromCents: number | null;
  priceToCents: number | null;
  variableNote: string | null;
  presets: PriceSheetPreset[] | null;
};

export type PriceSheetProps = {
  /** Service line name, e.g. "Nail art". */
  name: string;
  /** Current saved price in cents — used to seed the working amount. */
  unitPriceCents: number;
  /** True when the line carries `price_unconfirmed=true` (US1 auto-open path). */
  priceUnconfirmed: boolean;
  /** True for US2 row-level override; false for US1 auto-open. Controls Remove visibility. */
  isOverride: boolean;
  /** Variable-pricing metadata from the source service. Drives the context
   *  note string ("Varies $X–$Y · {note}") and the optional preset chips. */
  serviceMeta: PriceSheetServiceMeta | null;
  /** Persist the chosen amount. Receives integer cents. */
  onSave: (unitPriceCents: number) => void;
  /** Close the sheet without writing. NEVER deletes the row. */
  onCancel: () => void;
  /** Optional remove handler. Only wired by the parent when
   *  `!isOverride && priceUnconfirmed`. */
  onRemove?: () => void;
};

// Convert cents → dollar display string. Whole dollars render without a
// decimal (matches the prototype's seed value); fractional cents render
// with two decimals so cents-precise typing surfaces cleanly.
function centsToDollarString(cents: number): string {
  if (cents <= 0) return "0";
  const dollars = cents / 100;
  return dollars % 1 === 0 ? String(dollars) : dollars.toFixed(2);
}

function presetMatches(workingDollars: number, presetCents: number): boolean {
  // Match the preset highlight only when the working amount equals the
  // preset's cents-exact value (the operator can move off the preset via
  // adjusters or numpad and we want the chip to deselect immediately).
  return Math.round(workingDollars * 100) === presetCents;
}

export function PriceSheet({
  name,
  unitPriceCents,
  priceUnconfirmed,
  isOverride,
  serviceMeta,
  onSave,
  onCancel,
  onRemove,
}: PriceSheetProps) {
  // Working amount lives as a dollar string (matches the prototype's
  // numpad model). When the row is unconfirmed (seed price typically 0),
  // start blank-ish so the operator's first input replaces cleanly.
  const initialDollars = unitPriceCents > 0 ? centsToDollarString(unitPriceCents) : "0";
  const [val, setVal] = useState<string>(initialDollars);
  const [pad, setPad] = useState(false); // numpad collapsed by default
  const [fresh, setFresh] = useState(true); // next keypress replaces value

  const numericVal = parseFloat(val) || 0;
  const cents = Math.round(numericVal * 100);
  const presets = serviceMeta?.presets ?? [];
  const isVariable = !!serviceMeta?.variable;
  const showRemove = !isOverride && priceUnconfirmed && typeof onRemove === "function";

  // Context-note string. For a variable service: "Varies $X–$Y · {note}"
  // when both bounds are present; falls back to "Varies $X · {note}" or
  // "Set the price for this sale" when bounds are partial/missing.
  // For a confirmed-line override: "Adjust price for this sale".
  function contextNote(): string {
    if (!isVariable) return "Adjust price for this sale";
    const fromDollars =
      serviceMeta?.priceFromCents != null ? serviceMeta.priceFromCents / 100 : null;
    const toDollars = serviceMeta?.priceToCents != null ? serviceMeta.priceToCents / 100 : null;
    const noteSuffix = serviceMeta?.variableNote ? ` · ${serviceMeta.variableNote}` : "";
    if (fromDollars != null && toDollars != null) {
      return `Varies $${fromDollars}–$${toDollars}${noteSuffix}`;
    }
    if (fromDollars != null) {
      return `From $${fromDollars}${noteSuffix}`;
    }
    return `Set the price for this sale${noteSuffix}`;
  }

  function adjust(deltaDollars: number) {
    const next = Math.max(0, numericVal + deltaDollars);
    // Format integer dollars without trailing ".00" to match the prototype.
    setVal(next % 1 === 0 ? String(next) : next.toFixed(2));
    setFresh(false);
  }

  function setPreset(priceCents: number) {
    const dollars = priceCents / 100;
    setVal(dollars % 1 === 0 ? String(dollars) : dollars.toFixed(2));
    setFresh(true); // next keypress replaces, matching the prototype
  }

  function openPad() {
    setPad(true);
    setFresh(true);
  }

  function press(k: string) {
    if (k === "back") {
      setVal((cur) => (cur.length > 0 ? cur.slice(0, -1) : ""));
      setFresh(false);
      return;
    }
    if (fresh) {
      if (k === ".") {
        setVal("0.");
        setFresh(false);
        return;
      }
      setVal(k);
      setFresh(false);
      return;
    }
    if (k === "." && val.includes(".")) return;
    if (k === "." && val === "") {
      setVal("0.");
      return;
    }
    setVal(val + k);
  }

  function clearAll() {
    setVal("");
    setFresh(true);
  }

  // Physical-keyboard support. The sheet invites the operator to "type new
  // amount" — bind a window keydown listener while the numpad is open so
  // digits / "." / Backspace work without tapping the on-screen keys (Enter
  // saves, Escape cancels). The handler is read through a ref, written in an
  // effect (no ref writes during render), so the listener binds once per open.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
        return;
      }
      if (event.key === ".") {
        event.preventDefault();
        press(".");
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        press("back");
        return;
      }
      if (event.key === "Enter") {
        if (cents > 0) {
          event.preventDefault();
          onSave(cents);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
  });

  useEffect(() => {
    if (!pad) return;
    function onKeyDown(event: KeyboardEvent) {
      keyHandlerRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pad]);

  return (
    <div
      className="tx-sheet-backdrop"
      data-slot="price-sheet"
      data-is-override={isOverride ? "true" : "false"}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Set price"
    >
      <div className="tx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tx-sheet-h">
          <div>
            <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>{name}</div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                marginTop: "var(--space-1)",
                color: "var(--muted-foreground)",
              }}
            >
              {contextNote()}
            </div>
          </div>
          <button
            type="button"
            className="tx-stepper-btn"
            onClick={onCancel}
            aria-label="Close price sheet"
            data-slot="price-sheet-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-sheet-body">
          <button
            type="button"
            onClick={openPad}
            className="tx-bigprice-btn"
            title="Tap to type a different amount"
            data-slot="price-sheet-bigprice"
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>${val || "0"}</span>
            <span className="tx-bigprice-edit">
              <Edit3 size={16} strokeWidth={1.5} aria-hidden="true" />
              {pad ? "Typing…" : "Tap to type"}
            </span>
          </button>

          {!pad ? (
            <div
              className="tx-quickadj"
              data-slot="price-sheet-quickadj"
              style={{ display: "flex" }}
            >
              <button
                type="button"
                data-slot="price-sheet-adjust-minus-10"
                onClick={() => adjust(-10)}
              >
                −$10
              </button>
              <button
                type="button"
                data-slot="price-sheet-adjust-minus-5"
                onClick={() => adjust(-5)}
              >
                −$5
              </button>
              <button type="button" data-slot="price-sheet-adjust-plus-5" onClick={() => adjust(5)}>
                +$5
              </button>
              <button
                type="button"
                data-slot="price-sheet-adjust-plus-10"
                onClick={() => adjust(10)}
              >
                +$10
              </button>
              <button
                type="button"
                data-slot="price-sheet-adjust-plus-20"
                onClick={() => adjust(20)}
              >
                +$20
              </button>
            </div>
          ) : null}

          {presets.length > 0 && !pad ? (
            <div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-wide)",
                  fontWeight: 500,
                  marginBottom: "var(--space-2)",
                  color: "var(--muted-foreground)",
                }}
              >
                Quick picks
              </div>
              <div className="tx-presets" data-slot="price-sheet-presets">
                {presets.map((p) => {
                  const active = presetMatches(numericVal, p.price_cents);
                  const priceDollars = p.price_cents / 100;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      data-slot="price-sheet-preset"
                      data-active={active ? "true" : "false"}
                      className={"tx-preset" + (active ? " active" : "")}
                      onClick={() => setPreset(p.price_cents)}
                    >
                      <span className="lbl">{p.label}</span>
                      <span className="pr">
                        $
                        {priceDollars % 1 === 0 ? priceDollars.toFixed(0) : priceDollars.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {pad ? (
            <div className="tx-pad-pop">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "var(--space-2)",
                }}
              >
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    textTransform: "uppercase",
                    letterSpacing: "var(--tracking-wide)",
                    fontWeight: 500,
                    color: "var(--muted-foreground)",
                  }}
                >
                  {fresh ? "Type new amount" : "Editing amount"}
                </div>
                <button
                  type="button"
                  className="tx-link"
                  onClick={clearAll}
                  data-slot="price-sheet-clear"
                >
                  Clear
                </button>
              </div>
              <div className="tx-numpad" data-slot="price-sheet-numpad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="tx-numkey"
                    data-key={String(n)}
                    onClick={() => press(String(n))}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  className="tx-numkey fn"
                  data-key="."
                  onClick={() => press(".")}
                >
                  .
                </button>
                <button type="button" className="tx-numkey" data-key="0" onClick={() => press("0")}>
                  0
                </button>
                <button
                  type="button"
                  className="tx-numkey fn"
                  data-key="back"
                  aria-label="Backspace"
                  onClick={() => press("back")}
                >
                  <Delete size={20} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="tx-sheet-foot">
          {showRemove ? (
            <button
              type="button"
              className="tx-btn ghost"
              onClick={onRemove}
              data-slot="price-sheet-remove"
              style={{ marginRight: "auto", color: "var(--destructive)" }}
            >
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="tx-btn secondary"
            onClick={onCancel}
            data-slot="price-sheet-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="tx-btn"
            disabled={cents <= 0}
            data-slot="price-sheet-save"
            onClick={() => onSave(cents)}
          >
            Set ${numericVal % 1 ? numericVal.toFixed(2) : numericVal.toFixed(0)}
          </button>
        </div>
      </div>
    </div>
  );
}
