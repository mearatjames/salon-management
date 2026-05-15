"use client";

// PinKeypad — the only client component in the auth flow (research R8).
//
// Owns local digit-buffer state, paints filled/unfilled dots above a 3×4
// button grid (1-9, 0, Clear), and submits a hidden `<form action={submitPin}>`
// when the buffer reaches 4 digits. Keyboard input (numeric keys, Backspace,
// Enter) is wired via a `useEffect` `keydown` listener.
//
// The PIN itself is never rendered to the DOM — only the four dots fill in
// as digits are entered. The submitted form transmits the buffer as a single
// `pin` hidden input that the Server Action reads.

import { useCallback, useEffect, useRef, useState } from "react";

import { submitPin } from "@/app/(auth)/select-staff/actions";

export type PinKeypadProps = {
  staffId: string;
  next: string;
};

const PIN_LENGTH = 4;
const DIGIT_KEYS: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export function PinKeypad({ staffId, next }: PinKeypadProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);

  const submitForm = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    formRef.current?.requestSubmit();
  }, []);

  const append = useCallback(
    (d: string) => {
      setDigits((current) => {
        if (current.length >= PIN_LENGTH) return current;
        const next = [...current, d];
        if (next.length === PIN_LENGTH) {
          // Sync the hidden input synchronously before submitting, so the
          // FormData carries the full buffer regardless of React's render
          // timing.
          if (pinInputRef.current) {
            pinInputRef.current.value = next.join("");
          }
          // Defer submit to the next microtask so React commits the state.
          queueMicrotask(submitForm);
        }
        return next;
      });
    },
    [submitForm],
  );

  const removeLast = useCallback(() => {
    setDigits((current) => (current.length === 0 ? current : current.slice(0, -1)));
  }, []);

  const clearAll = useCallback(() => {
    setDigits([]);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (DIGIT_KEYS.includes(event.key)) {
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
        // Only submit if the buffer is full — otherwise it's a no-op.
        // The auto-submit path covers the common case; this is for users
        // who paste then press Enter.
        if (digits.length === PIN_LENGTH) {
          event.preventDefault();
          submitForm();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearAll();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, removeLast, submitForm, clearAll, digits.length]);

  const pinValue = digits.join("");

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
      <div className="auth-keypad-display" aria-label="PIN entry">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} data-filled={i < digits.length ? "true" : "false"} />
        ))}
      </div>

      <form
        ref={formRef}
        action={submitPin}
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        <input type="hidden" name="staffId" value={staffId} />
        <input
          type="hidden"
          name="pin"
          ref={pinInputRef}
          defaultValue={pinValue}
        />
        <input type="hidden" name="next" value={next} />

        <div className="auth-keypad" role="group" aria-label="PIN keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              className="auth-keypad-key"
              onClick={() => append(d)}
              aria-label={`Digit ${d}`}
            >
              {d}
            </button>
          ))}
          {/* Row 4: empty cell, 0, Clear — 3x4 grid, 11 buttons total. */}
          <span aria-hidden="true" />
          <button
            type="button"
            className="auth-keypad-key"
            onClick={() => append("0")}
            aria-label="Digit 0"
          >
            0
          </button>
          <button
            type="button"
            className="auth-keypad-key auth-keypad-clear"
            onClick={clearAll}
            aria-label="Clear"
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
}
