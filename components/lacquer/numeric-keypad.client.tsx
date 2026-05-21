"use client";

// NumericKeypad — callback-based PIN keypad client island. Two consumers:
//   1. Add staff wizard step 2 (Enter → Confirm sub-flow).
//   2. Set / Change PIN modal (Enter → Confirm sub-flow).
//
// Owns its own digit buffer + the on-screen 12-key 3×4 keypad + a
// `window.keydown` listener (digits, Backspace, Enter, Escape). When the
// buffer fills to `length` (4), the keypad calls `onSubmit(digits)`. The
// component does NOT own form state, does NOT import any Server Action,
// does NOT post.
//
// The keypad uses the shared `.keypad*` classes in `styles/keypad.css` —
// the same stylesheet the select-staff login keypad (`PinPad`) uses — so a
// staff member sees an identical keypad whether logging in or changing a PIN.
//
// Adapted from `components/lacquer/pin-keypad.tsx` (which auto-submits a
// form via the `submitPin` Server Action); that file is left untouched —
// this is the callback-based variant for the staff-management surfaces.

import { useCallback, useEffect, useRef, useState } from "react";

import { Delete } from "lucide-react";

export type NumericKeypadProps = {
  /** Buffer length. Currently only 4 is used. */
  length?: 4;
  /** Caption variant for the step header — "enter" or "confirm". */
  step: "enter" | "confirm";
  /** When set, the dot row paints in destructive color (PIN mismatch). */
  errorMessage?: string | null;
  /** Called when the buffer reaches `length`. Parent handles next step. */
  onSubmit: (digits: string) => void;
  /** Called when the user presses Escape or clicks Cancel. */
  onCancel?: () => void;
};

const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function NumericKeypad({
  length = 4,
  step,
  errorMessage = null,
  onSubmit,
  onCancel,
}: NumericKeypadProps) {
  const [digits, setDigits] = useState<string>("");

  // Reset the buffer when the step changes (e.g., parent flips to "confirm")
  // or an error arrives. Uses React's derived-state-from-props pattern:
  // track prior values in state, conditionally trigger a reset during render.
  // This avoids the cascading-render cost of useEffect + setState.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevStep, setPrevStep] = useState(step);
  const [prevError, setPrevError] = useState(errorMessage);
  if (prevStep !== step || prevError !== errorMessage) {
    setPrevStep(step);
    setPrevError(errorMessage);
    setDigits("");
  }

  // Latest onSubmit / onCancel in a ref so the keydown effect doesn't re-bind
  // on every render. Updated in an effect to satisfy no-ref-writes-during-render.
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;
  });

  const append = useCallback(
    (d: string) => {
      setDigits((current) => {
        if (current.length >= length) return current;
        const nextBuf = current + d;
        if (nextBuf.length === length) {
          // Defer the parent callback to the next microtask so React commits
          // the state first.
          queueMicrotask(() => onSubmitRef.current(nextBuf));
        }
        return nextBuf;
      });
    },
    [length]
  );

  const removeLast = useCallback(() => {
    setDigits((current) => (current.length === 0 ? current : current.slice(0, -1)));
  }, []);

  const clearAll = useCallback(() => {
    setDigits("");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((DIGIT_KEYS as readonly string[]).includes(event.key)) {
        event.preventDefault();
        append(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        removeLast();
        return;
      }
      if (event.key === "Enter") {
        if (digits.length === length) {
          event.preventDefault();
          queueMicrotask(() => onSubmitRef.current(digits));
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current?.();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, removeLast, digits, length]);

  const dotColor = errorMessage ? "var(--destructive)" : "var(--foreground)";
  const filledCount = digits.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        alignItems: "center",
        width: "100%",
      }}
    >
      {/* Step caption */}
      <div
        style={{
          fontSize: "var(--text-sm, 14px)",
          color: "var(--muted-foreground)",
          fontWeight: 500,
        }}
      >
        {step === "enter" ? "Enter PIN" : "Confirm PIN"}
      </div>

      {/* Dot row — visual buffer indicator */}
      <div
        role="img"
        aria-label={`PIN entry, ${filledCount}/${length}`}
        style={{
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "center",
          minHeight: "var(--space-6)",
        }}
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            data-filled={i < filledCount ? "true" : "false"}
            style={{
              width: "var(--space-3)",
              height: "var(--space-3)",
              borderRadius: "var(--radius-full)",
              background: i < filledCount ? dotColor : "transparent",
              border: `1.5px solid ${i < filledCount ? dotColor : "var(--border)"}`,
              transition: "background 150ms var(--ease-out, ease-out)",
            }}
          />
        ))}
      </div>

      {/* Error message slot — kept inline so layout doesn't jump */}
      {errorMessage ? (
        <div
          role="alert"
          style={{
            color: "var(--destructive)",
            fontSize: "var(--text-sm, 14px)",
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      {/* 12-key 3×4 keypad: 1-9, Clear, 0, Backspace. Uses the shared
          `.keypad*` classes from `styles/keypad.css` so this renders
          identically to the select-staff login keypad (`PinPad`). */}
      <div className="keypad" role="group" aria-label="PIN keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            className="keypad-key"
            onClick={() => append(d)}
            aria-label={`Digit ${d}`}
          >
            {d}
          </button>
        ))}
        {/* Row 4: Clear, 0, Backspace. */}
        <button
          type="button"
          className="keypad-key keypad-key--dim"
          onClick={clearAll}
          aria-label="Clear"
        >
          Clear
        </button>
        <button
          type="button"
          className="keypad-key"
          onClick={() => append("0")}
          aria-label="Digit 0"
        >
          0
        </button>
        <button
          type="button"
          className="keypad-key keypad-key--dim"
          onClick={removeLast}
          aria-label="Backspace"
        >
          <Delete size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
