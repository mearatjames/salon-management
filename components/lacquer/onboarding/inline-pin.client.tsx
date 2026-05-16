"use client";

// InlinePin — two-pass 4-digit PIN entry rendered inline inside the
// Onboard sheet's step 3 (Thorough mode). Adapted from
// `design-system/prototypes/onboarding/OnboardSheet.jsx` `InlinePin`.
//
// State machine:
//   phase 1 (enter)   : digits fill `first`; on the 4th digit advance to
//                       phase 2 (clear dots, prompt "Re-enter PIN").
//   phase 2 (confirm) : digits fill `second`; on the 4th digit:
//                         - match    → onConfirmed(pin)
//                         - mismatch → error state (red dots flash ~600ms,
//                                       error copy renders), then reset to
//                                       phase 1 with both buffers cleared.
//
// Error copy is verbatim from the spec: "PINs didn't match. Try again."
//
// Keypad layout: 1 2 3 / 4 5 6 / 7 8 9 / [empty] 0 ⌫. The empty cell
// matches the prototype's `mini-keypad` 3×4 grid (no decimal cell).
//
// Token discipline: every value is driven from `styles/onboarding.css`
// `.onb-pin-*` rules. No inline hex / off-scale spacing.

import { Delete } from "lucide-react";
import { useCallback, useState } from "react";

const PIN_LEN = 4;
const MISMATCH_FLASH_MS = 600;
const ADVANCE_DELAY_MS = 160;

export type InlinePinProps = {
  recipientFirstName: string;
  /** Called with the matched 4-digit PIN. */
  onConfirmed: (pin: string) => void;
  /** Skip — they can set it on first login. */
  onSkip: () => void;
};

export function InlinePin({ recipientFirstName, onConfirmed, onSkip }: InlinePinProps) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [err, setErr] = useState("");

  const current = phase === 1 ? first : second;
  const filledCount = current.length;

  const handleDigit = useCallback(
    (d: string) => {
      setErr("");
      const cur = phase === 1 ? first : second;
      if (cur.length >= PIN_LEN) return;
      const next = cur + d;
      if (phase === 1) setFirst(next);
      else setSecond(next);

      if (next.length === PIN_LEN) {
        // Defer one tick so the 4th dot paints before we transition.
        setTimeout(() => {
          if (phase === 1) {
            setPhase(2);
          } else if (next === first) {
            onConfirmed(next);
          } else {
            setErr("PINs didn't match. Try again.");
            setFirst("");
            setSecond("");
            // Hold the red-dots flash for the configured duration, then
            // reset to phase 1 so the user can re-enter. The error copy
            // remains visible until the next keystroke.
            setTimeout(() => {
              setPhase(1);
            }, MISMATCH_FLASH_MS);
          }
        }, ADVANCE_DELAY_MS);
      }
    },
    [phase, first, second, onConfirmed]
  );

  const handleBackspace = useCallback(() => {
    setErr("");
    if (phase === 1) setFirst((p) => p.slice(0, -1));
    else setSecond((p) => p.slice(0, -1));
  }, [phase]);

  return (
    <div className="onb-pin-shell" data-slot="onb-pin-shell">
      <div className="onb-pin-prompt">
        {phase === 1
          ? `Choose a 4-digit PIN for ${recipientFirstName || "this user"}`
          : "Enter the same PIN again"}
      </div>

      <div
        className="onb-pin-dots"
        role="status"
        aria-label={`PIN entry ${filledCount} of ${PIN_LEN} digits`}
      >
        {Array.from({ length: PIN_LEN }, (_, i) => {
          const filled = i < filledCount;
          const isError = err !== "";
          return (
            <span
              key={i}
              className="onb-pin-dot"
              data-slot="onb-pin-dot"
              data-filled={filled ? "true" : "false"}
              data-error={isError ? "true" : "false"}
            />
          );
        })}
      </div>

      <div className="onb-pin-keys" role="group" aria-label="PIN keypad">
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((d) => (
          <button
            key={d}
            type="button"
            className="onb-pin-key"
            data-slot="onb-pin-key"
            data-digit={d}
            aria-label={`Digit ${d}`}
            onClick={() => handleDigit(d)}
          >
            {d}
          </button>
        ))}
        <span className="onb-pin-key-spacer" aria-hidden />
        <button
          type="button"
          className="onb-pin-key"
          data-slot="onb-pin-key"
          data-digit="0"
          aria-label="Digit 0"
          onClick={() => handleDigit("0")}
        >
          0
        </button>
        <button
          type="button"
          className="onb-pin-key onb-pin-key-fn"
          data-slot="onb-pin-key-backspace"
          aria-label="Delete last digit"
          onClick={handleBackspace}
        >
          <Delete size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div className="onb-pin-error-msg" role="alert" aria-live="polite">
        {err}
      </div>

      <button
        type="button"
        className="onb-btn onb-btn-ghost onb-btn-pin-skip"
        onClick={onSkip}
        data-slot="onb-pin-skip"
      >
        Skip — they can set it on first login
      </button>
    </div>
  );
}
