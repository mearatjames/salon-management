"use client";

// SetPinForm — the client island for `/set-pin` (specs/048-invitee-self-set-pin
// US1). A no-PIN invitee, fresh off the password step, picks a 4-digit PIN
// here before landing on /select-staff.
//
// Composition:
//   • Wraps the shared <NumericKeypad> (components/lacquer/numeric-keypad.client.tsx)
//     — the same 3×4 keypad the staff-management Set/Change PIN modal uses.
//   • Drives a two-phase enter → confirm sub-flow via the pure reducer
//     `pinKeypadInit` / `pinKeypadSubmit` from `@/lib/auth/pin-keypad`.
//
// Behavior:
//   phase "enter"   — keypad fills a 4-digit buffer, auto-advances to
//                     "confirm" on the 4th digit (no submit button).
//   phase "confirm" — keypad fills the confirm buffer. On the 4th digit:
//                       - match    → requestSubmit() the hidden
//                                    <form action={setOwnPin}> carrying `pin`.
//                       - mismatch → the reducer flashes an inline error and
//                                    snaps back to "enter" — entirely
//                                    client-side, no server round trip.
//
// The raw PIN crosses the wire once (HTTPS in production); the Server
// Action hashes it before any DB write and never records it in audit.
//
// All visual values resolve to design-system tokens (the layout reuses the
// `.auth-*` classes from `styles/auth.css`, the keypad reuses `styles/keypad.css`).
// No new component library (Constitution I).

import { useCallback, useRef, useState } from "react";

import { setOwnPin } from "@/app/(auth)/set-pin/actions";
import { FormPendingSignal } from "@/components/lacquer/form-pending-signal";
import { NumericKeypad } from "@/components/lacquer/numeric-keypad.client";
import { pinKeypadInit, pinKeypadSubmit, type PinKeypadState } from "@/lib/auth/pin-keypad";

export function SetPinForm() {
  const [pinState, setPinState] = useState<PinKeypadState>(() => pinKeypadInit());
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const submittingRef = useRef(false);

  const handleKeypadSubmit = useCallback(
    (digits: string) => {
      const { state: next, effect } = pinKeypadSubmit(pinState, digits);
      setPinState(next);
      if (effect?.kind === "submit") {
        // Confirm match — fire the Server Action. Guard against a
        // double-submit while the keypad's microtask callback drains.
        if (submittingRef.current) return;
        submittingRef.current = true;
        queueMicrotask(() => {
          formRef.current?.requestSubmit();
        });
      }
    },
    [pinState]
  );

  const subtitle =
    pinState.phase === "enter"
      ? "Choose a 4-digit PIN — you'll use it to sign in each shift."
      : "Enter the same PIN again to confirm.";

  return (
    <div className="auth-view-pane" key="set-pin">
      <div className="auth-form-header">
        <h1 className="auth-form-title">Set your PIN</h1>
        <p className="auth-form-subtitle">{subtitle}</p>
      </div>

      <div
        className="auth-form-body"
        style={{
          alignItems: "center",
          opacity: submitting ? 0.5 : 1,
          pointerEvents: submitting ? "none" : undefined,
          transition: "opacity 150ms var(--ease-out)",
        }}
      >
        <NumericKeypad
          step={pinState.phase}
          errorMessage={pinState.error}
          onSubmit={handleKeypadSubmit}
        />
      </div>

      {/* Hidden form that posts the matched PIN to setOwnPin. Rendered
          always so the keypad confirm handler can call requestSubmit()
          once both buffers match. FormPendingSignal lifts the form's
          pending state so the keypad dims while the action runs. */}
      <form ref={formRef} action={setOwnPin} style={{ display: "none" }}>
        <input type="hidden" name="pin" value={pinState.enterBuf} />
        <FormPendingSignal onPendingChange={setSubmitting} />
      </form>
    </div>
  );
}
