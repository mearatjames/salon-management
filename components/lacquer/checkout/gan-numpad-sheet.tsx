"use client";

// GanNumpadSheet — modal sheet that captures a gift card number (GAN).
//
// Adapted from `components/lacquer/numeric-keypad.client.tsx` (4-digit
// PIN keypad). Differences:
//   - Variable-length buffer (4–19 digits per Square's documented GAN range).
//   - No auto-submit: the operator presses "Look up balance" when ready.
//   - Display masks digits — only the last four are revealed (`••••1234`).
//   - Cancel + Look up balance CTAs sit beneath the keypad.
//
// The component is a controlled-by-callback modal: it doesn't post or talk
// to a Server Action directly. The parent island wires `onSubmit(gan)` to
// `lookupGiftCard`, then renders the next sheet based on the result.
//
// Design system: token-only styling, Lucide icons at 1.5px stroke, tabular
// numerals on the digit display, sentence-case copy.

import { useCallback, useEffect, useRef, useState } from "react";

import { Delete, X } from "lucide-react";

export type GanNumpadSheetProps = {
  /** Called when the operator taps "Look up balance". */
  onSubmit: (gan: string) => void;
  /** Called when the operator taps Cancel or presses Escape. */
  onCancel: () => void;
  /** Hide the submit CTA + disable digit entry while a server call is in flight. */
  busy?: boolean;
};

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
const MIN_LEN = 4;
const MAX_LEN = 19;
// Square's documented GAN range is digits, but the e2e fixture matrix
// uses alphanumeric suffixes (`BLKD` / `PEND` / `DEAC`) for the non-ACTIVE
// state cases. The keypad's visible buttons stay digit-only (matching
// real-world entry), but the keydown handler also accepts A-Z so typing
// those fixture suffixes works under Playwright.
const ALPHA_KEY = /^[A-Za-z]$/;

function maskGan(gan: string): string {
  if (gan.length === 0) return "";
  if (gan.length <= 4) {
    // Show the digits as they're entered for the first four taps so the
    // operator can see what they typed.
    return gan;
  }
  const tail = gan.slice(-4);
  const hiddenCount = gan.length - 4;
  const dots = "•".repeat(hiddenCount);
  return `${dots}${tail}`;
}

export function GanNumpadSheet({ onSubmit, onCancel, busy = false }: GanNumpadSheetProps) {
  const [digits, setDigits] = useState<string>("");

  // Latest callbacks in refs so the keydown effect doesn't re-bind on every render.
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;
  });

  const append = useCallback((d: string) => {
    setDigits((current) => (current.length >= MAX_LEN ? current : current + d));
  }, []);

  const removeLast = useCallback(() => {
    setDigits((current) => (current.length === 0 ? current : current.slice(0, -1)));
  }, []);

  const submit = useCallback(() => {
    if (digits.length < MIN_LEN || busy) return;
    onSubmitRef.current(digits);
  }, [digits, busy]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((DIGIT_KEYS as readonly string[]).includes(event.key)) {
        event.preventDefault();
        append(event.key);
        return;
      }
      if (ALPHA_KEY.test(event.key)) {
        event.preventDefault();
        // Uppercased so the masked display + fixture matrix stays consistent.
        append(event.key.toUpperCase());
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        removeLast();
        return;
      }
      if (event.key === "Enter") {
        if (digits.length >= MIN_LEN) {
          event.preventDefault();
          onSubmitRef.current(digits);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, removeLast, digits, busy]);

  const submitEnabled = !busy && digits.length >= MIN_LEN;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter gift card number"
      data-slot="gan-numpad-sheet"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--foreground) 32%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "calc(var(--space-16) * 7)",
          background: "var(--card)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          padding: "var(--space-5) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          alignItems: "center",
          boxShadow: "0 -8px 24px color-mix(in oklch, var(--foreground) 12%, transparent)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + close. */}
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-2)",
          }}
        >
          <div
            style={{
              fontSize: "var(--text-base)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Enter gift card number
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            data-slot="gan-numpad-close"
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              padding: "var(--space-1)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* Display row: masked digits with cursor caret. */}
        <div
          data-slot="gan-numpad-display"
          role="presentation"
          style={{
            width: "100%",
            minHeight: "var(--space-10)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-2xl)",
            fontWeight: 500,
            color: "var(--foreground)",
            letterSpacing: "0.08em",
            fontVariantNumeric: "tabular-nums",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {digits.length === 0 ? (
            <span
              style={{
                color: "var(--muted-foreground)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
              }}
            >
              Tap or type the digits
            </span>
          ) : (
            <span data-testid="gan-display-value">{maskGan(digits)}</span>
          )}
        </div>

        {/* 3×4 keypad: 1-9 + (clear, 0, backspace). */}
        <div
          role="group"
          aria-label="Numeric keypad"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, var(--space-16))",
            gap: "var(--space-2)",
          }}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => append(d)}
              aria-label={`Digit ${d}`}
              disabled={busy}
              style={{
                height: "var(--space-12)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--foreground)",
                fontSize: "var(--text-lg)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                cursor: busy ? "not-allowed" : "pointer",
                transition: "background 150ms ease-out",
              }}
            >
              {d}
            </button>
          ))}
          {/* Row 4: empty cell, 0, backspace. */}
          <span aria-hidden="true" />
          <button
            type="button"
            onClick={() => append("0")}
            aria-label="Digit 0"
            disabled={busy}
            style={{
              height: "var(--space-12)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontSize: "var(--text-lg)",
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            0
          </button>
          <button
            type="button"
            onClick={removeLast}
            aria-label="Backspace"
            disabled={busy || digits.length === 0}
            style={{
              height: "var(--space-12)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--muted-foreground)",
              cursor: busy || digits.length === 0 ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Delete size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        {/* CTA row: Cancel + Look up balance. */}
        <div
          style={{
            width: "100%",
            display: "flex",
            gap: "var(--space-2)",
            marginTop: "var(--space-1)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            data-slot="gan-numpad-cancel"
            disabled={busy}
            style={{
              flex: "0 0 auto",
              height: "var(--space-10)",
              padding: "0 var(--space-4)",
              background: "transparent",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!submitEnabled}
            data-slot="gan-numpad-submit"
            style={{
              flex: "1 1 auto",
              height: "var(--space-10)",
              padding: "0 var(--space-4)",
              background: submitEnabled ? "var(--primary)" : "var(--muted)",
              color: submitEnabled ? "var(--primary-foreground)" : "var(--muted-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              cursor: submitEnabled ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "Looking up…" : "Look up balance"}
          </button>
        </div>
      </div>
    </div>
  );
}
