"use client";

// PinPad — the 12-key (3×4) PIN keypad island for the select-staff modal.
//
// 044-select-staff-redesign US1 (T010). Layout (research R4, FR-013):
//
//     1   2   3
//     4   5   6
//     7   8   9
//   Clear 0  ⌫
//
// PinPad owns NO buffer — it just emits key events. The PIN-entry modal owns
// the buffer and the 4-position indicator. `onDigit` / `onClear` /
// `onBackspace` are the only outputs.
//
// A `window` keydown listener (mounted for the component's lifetime) maps
// physical keys: `0–9` → `onDigit`, `Backspace` → `onBackspace`. The modal
// mounts PinPad only while it is open, so the listener is live exactly while
// the modal is open. `Escape` is deliberately NOT bound — the Radix `Dialog`
// handles Escape-to-close (FR-014 / FR-018). Keydowns carrying meta/ctrl/alt
// are ignored so OS / browser shortcuts pass through.
//
// Reference: `components/lacquer/numeric-keypad.client.tsx` — same callback +
// keydown-listener idiom, but PinPad has BOTH a Clear key AND a Backspace key
// (12 keys, not 11) and owns no buffer at all.
//
// All visuals trace to the shared `.keypad*` classes in `styles/keypad.css`
// — the same stylesheet `numeric-keypad.client.tsx` uses, so the login
// keypad and the staff-settings Set/Change-PIN keypad render identically
// (Constitution Principle I — FR-026).

import { useEffect, useRef } from "react";

import { Delete } from "lucide-react";

const DIGIT_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type PinPadProps = {
  /** Emitted when a digit key (1–9, 0) is pressed or typed. */
  onDigit: (digit: string) => void;
  /** Emitted when the Clear key is pressed. */
  onClear: () => void;
  /** Emitted when the Backspace key is pressed or typed. */
  onBackspace: () => void;
};

export function PinPad({ onDigit, onClear, onBackspace }: PinPadProps) {
  // Keep the latest callbacks in refs so the keydown effect binds once for
  // the component's lifetime rather than re-binding on every render. Written
  // in an effect to satisfy no-ref-writes-during-render.
  const onDigitRef = useRef(onDigit);
  const onBackspaceRef = useRef(onBackspace);
  useEffect(() => {
    onDigitRef.current = onDigit;
    onBackspaceRef.current = onBackspace;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Let OS / browser shortcuts through untouched.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((DIGIT_KEYS as readonly string[]).includes(event.key)) {
        event.preventDefault();
        onDigitRef.current(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        onBackspaceRef.current();
      }
      // Escape is intentionally left to the Radix Dialog.
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="keypad" role="group" aria-label="PIN keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button
          key={d}
          type="button"
          className="keypad-key"
          aria-label={`Digit ${d}`}
          onClick={() => onDigit(d)}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        className="keypad-key keypad-key--dim"
        aria-label="Clear"
        onClick={onClear}
      >
        Clear
      </button>
      <button
        type="button"
        className="keypad-key"
        aria-label="Digit 0"
        onClick={() => onDigit("0")}
      >
        0
      </button>
      <button
        type="button"
        className="keypad-key keypad-key--dim"
        aria-label="Backspace"
        onClick={onBackspace}
      >
        <Delete size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
