// Pure reducer for the two-phase PIN keypad sub-flow.
//
// Two consumers share this state machine:
//   - `add-staff-wizard.client.tsx` step 2 (US2)
//   - `change-pin-modal.client.tsx`            (US4)
//
// Both used to inline the same enter → confirm → match/mismatch logic in a
// React useCallback. Extracted here so the state machine is unit-testable
// without rendering React — mirrors the `numpad-reduce.ts` precedent shipped
// with the EOD cash-count keypad. Per docs/e2e-pruning-audit.md §
// staff.spec.ts US2(b)/US4(c), the unit tests replace e2e cases that drove
// the same transitions through a full browser session.
//
// Effect semantics:
//   - On `submit`-success (digits match in confirm phase) the reducer returns
//     `{ effect: "submit" }` so the caller can fire its hidden Server Action
//     form. The reducer itself stays pure — no side effects.

export type PinKeypadPhase = "enter" | "confirm";

export type PinKeypadState = {
  phase: PinKeypadPhase;
  enterBuf: string;
  error: string | null;
};

export type PinKeypadEffect = { kind: "submit"; digits: string };

export type PinKeypadResult = {
  state: PinKeypadState;
  effect: PinKeypadEffect | null;
};

export const PIN_MISMATCH_MESSAGE = "PINs didn't match. Try again.";

export function pinKeypadInit(): PinKeypadState {
  return { phase: "enter", enterBuf: "", error: null };
}

/** Step a digit submission through the keypad state machine.
 *
 * - In `enter` phase: stash `digits` as the buffer, advance to `confirm`,
 *   clear the error. No effect.
 * - In `confirm` phase with digits === enterBuf: stay in `confirm` phase
 *   (the modal/wizard tears down on the redirect); return a `submit` effect
 *   carrying the matched digits.
 * - In `confirm` phase with digits !== enterBuf: snap back to `enter`,
 *   clear the buffer, paint the mismatch error. No effect.
 */
export function pinKeypadSubmit(state: PinKeypadState, digits: string): PinKeypadResult {
  if (state.phase === "enter") {
    return {
      state: { phase: "confirm", enterBuf: digits, error: null },
      effect: null,
    };
  }
  if (digits === state.enterBuf) {
    return {
      state,
      effect: { kind: "submit", digits },
    };
  }
  return {
    state: { phase: "enter", enterBuf: "", error: PIN_MISMATCH_MESSAGE },
    effect: null,
  };
}
