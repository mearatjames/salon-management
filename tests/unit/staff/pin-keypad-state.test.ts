// Unit tests for the two-phase PIN keypad reducer.
//
// Replaces e2e cases per docs/e2e-pruning-audit.md:
//   - US2(b) wizard PIN mismatch resets buffer and shows error
//   - US4(c) change-pin modal PIN mismatch returns to enter phase, no submit
//
// Both call sites (`add-staff-wizard.client.tsx` step 2 and
// `change-pin-modal.client.tsx`) share the same reducer; covering the
// transitions once here means the e2e suite no longer has to drive a full
// browser through every mismatch path.

import { describe, expect, it } from "vitest";

import {
  PIN_MISMATCH_MESSAGE,
  pinKeypadInit,
  pinKeypadSubmit,
} from "@/lib/auth/pin-keypad";

describe("pinKeypadInit", () => {
  it("starts in the enter phase with an empty buffer and no error", () => {
    expect(pinKeypadInit()).toEqual({ phase: "enter", enterBuf: "", error: null });
  });
});

describe("pinKeypadSubmit — enter phase", () => {
  it("stashes the digits as enterBuf and advances to confirm", () => {
    const result = pinKeypadSubmit(pinKeypadInit(), "1984");
    expect(result.state).toEqual({ phase: "confirm", enterBuf: "1984", error: null });
    expect(result.effect).toBeNull();
  });

  it("clears any stale error that was painted by a previous mismatch", () => {
    // Simulate: mismatch left us back at "enter" with an error visible.
    // The next first-digit submit should clear it.
    const afterMismatch = {
      phase: "enter" as const,
      enterBuf: "",
      error: PIN_MISMATCH_MESSAGE,
    };
    const result = pinKeypadSubmit(afterMismatch, "2222");
    expect(result.state.error).toBeNull();
    expect(result.state.phase).toBe("confirm");
    expect(result.state.enterBuf).toBe("2222");
  });
});

describe("pinKeypadSubmit — confirm phase, matching digits", () => {
  it("preserves state and emits a submit effect carrying the matched digits", () => {
    const entered = pinKeypadSubmit(pinKeypadInit(), "1984");
    const confirmed = pinKeypadSubmit(entered.state, "1984");

    // State is preserved — the modal/wizard tears down on the redirect, so
    // the reducer leaves phase = "confirm" and enterBuf intact.
    expect(confirmed.state.phase).toBe("confirm");
    expect(confirmed.state.enterBuf).toBe("1984");
    expect(confirmed.state.error).toBeNull();

    // Effect tells the caller to fire the hidden Server Action form.
    expect(confirmed.effect).toEqual({ kind: "submit", digits: "1984" });
  });
});

describe("pinKeypadSubmit — confirm phase, mismatched digits (US2(b) + US4(c))", () => {
  it("snaps back to enter phase, clears the buffer, paints the mismatch error", () => {
    const entered = pinKeypadSubmit(pinKeypadInit(), "1111");
    const mismatched = pinKeypadSubmit(entered.state, "2222");

    expect(mismatched.state.phase).toBe("enter");
    expect(mismatched.state.enterBuf).toBe("");
    expect(mismatched.state.error).toBe(PIN_MISMATCH_MESSAGE);
  });

  it("does not emit a submit effect on mismatch", () => {
    const entered = pinKeypadSubmit(pinKeypadInit(), "1234");
    const mismatched = pinKeypadSubmit(entered.state, "5678");

    expect(mismatched.effect).toBeNull();
  });

  it("recovers cleanly: after mismatch the next enter advances to confirm again", () => {
    const entered = pinKeypadSubmit(pinKeypadInit(), "1111");
    const mismatched = pinKeypadSubmit(entered.state, "2222");
    const reentered = pinKeypadSubmit(mismatched.state, "3333");

    expect(reentered.state).toEqual({ phase: "confirm", enterBuf: "3333", error: null });
    expect(reentered.effect).toBeNull();
  });
});

describe("pinKeypadSubmit — purity", () => {
  it("does not mutate the input state", () => {
    const initial = pinKeypadInit();
    const snapshot = { ...initial };
    pinKeypadSubmit(initial, "1234");
    expect(initial).toEqual(snapshot);
  });
});
