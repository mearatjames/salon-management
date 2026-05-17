// Pure numpad reducer for the End-of-Day cash count buffer.
//
// Colocated with `cash-count.client.tsx` (the only consumer) but kept in
// a separate file with NO `"use client"` directive so Vitest can import
// the helper directly without React-Server-Component boundary noise.
//
// State shape: `{ counted: string; fresh: boolean }`.
//   - `counted` is the typed-so-far text — never holds a leading "$",
//     always parses cleanly with `parseFloat`. Empty string means "no
//     entry yet" and renders as the `0` placeholder in the display.
//   - `fresh` is the "next digit replaces the buffer" flag. True at
//     mount, after `clear`, and after backspacing down to empty. Once a
//     digit / `.` lands it flips to false and subsequent presses append.
//
// Rules (spec FR-004 + research.md R7):
//   1. Digit (`0`–`9`):
//      a. If `fresh` → replace the buffer with the digit, clear `fresh`.
//      b. Else if the buffer has a `.` AND already two chars follow it
//         → no-op (two-decimal cap).
//      c. Else append the digit.
//   2. `.`:
//      a. If the buffer already contains a `.` → no-op (decimal-once).
//      b. Else if the buffer is empty (or fresh-empty) → become `"0."`.
//      c. Else append the `.`.
//   3. `back` (backspace):
//      a. Pop the last character. If the result is empty, re-arm the
//         `fresh` flag so the next digit replaces (not appends).
//   4. `clear`:
//      a. Reset buffer to `""`, set `fresh = true`. Identical effective
//         result to backspacing every char, but reachable in one tap and
//         exposed in the eyebrow row when there's content to clear.
//
// CRITICAL: all no-op branches MUST return the same state reference so a
// `setState(prev => numpadReduce(prev, key))` call short-circuits React's
// bail-out via `Object.is` and avoids a re-render of the island.

import type { NumpadKey } from "@/components/lacquer/eod/numpad-buttons";

// `NumpadKey` from numpad-buttons doesn't include `"clear"` because the
// 3×4 grid itself never emits it — Clear is a separate text-link in the
// eyebrow row. But the reducer must accept it, so widen the key union
// here.
export type NumpadReduceKey = NumpadKey | "clear";

export type NumpadState = { counted: string; fresh: boolean };

export function numpadReduce(state: NumpadState, key: NumpadReduceKey): NumpadState {
  const { counted, fresh } = state;

  if (key === "clear") {
    if (counted === "" && fresh) return state;
    return { counted: "", fresh: true };
  }

  if (key === "back") {
    if (counted === "") return state;
    const next = counted.slice(0, -1);
    return { counted: next, fresh: next.length === 0 };
  }

  // Fresh-buffer rules: the next digit / dot REPLACES the placeholder
  // rather than appending to it. After Clear and at mount this is what
  // makes the first keystroke feel like a fresh entry.
  if (fresh) {
    if (key === ".") return { counted: "0.", fresh: false };
    return { counted: key, fresh: false };
  }

  if (key === ".") {
    if (counted.includes(".")) return state; // no-op: decimal-once.
    if (counted === "") return { counted: "0.", fresh: false };
    return { counted: counted + ".", fresh: false };
  }

  // Two-decimal cap: once the buffer has `.` and two digits trail it,
  // further digits are dropped.
  const dotIdx = counted.indexOf(".");
  if (dotIdx !== -1 && counted.length - dotIdx - 1 >= 2) return state;

  return { counted: counted + key, fresh: false };
}
