"use client";

// KeypadKey — one key of the shared 12-key keypad, used by both the
// select-staff login keypad (`select-staff/pin-pad.tsx`) and the
// staff-settings Set / Change PIN keypad (`numeric-keypad.client.tsx`).
//
// Touch and pen presses fire `onPress` on `pointerdown`, NOT on `click`
// (issue #214). On iOS (Safari and Chrome alike — both are WebKit) a
// `click` is only synthesized for a clean single-finger tap, and two things
// routinely cancel it while typing a PIN fast:
//   1. The Radix Dialog's scroll lock (`react-remove-scroll`) calls
//      `preventDefault()` on every `touchmove` inside the non-scrollable
//      modal. A real fingertip jitters a pixel or two, and a cancelled
//      `touchmove` makes WebKit drop that tap's `click`.
//   2. Rolling taps overlap — the next finger lands before the previous one
//      lifts — and overlapping touches don't produce clicks either.
// `pointerdown` fires once per finger, in press order, before any movement,
// so neither can swallow it.
//
// Mouse presses and keyboard activation (Enter / Space on a focused key, or
// an assistive-tech activation) still go through `onClick`. A `click` that
// follows a touch `pointerdown` on the same key is the browser's synthesized
// duplicate and is skipped, so a tap never counts twice.

import { useRef, type ComponentProps } from "react";

// A synthesized click lands within a few hundred ms of its pointerdown; a
// generous window still can't swallow a deliberate second press.
const DUPLICATE_CLICK_WINDOW_MS = 1000;

export type KeypadKeyProps = Omit<
  ComponentProps<"button">,
  "type" | "onClick" | "onPointerDown"
> & {
  onPress: () => void;
};

export function KeypadKey({ onPress, ...props }: KeypadKeyProps) {
  // `performance.now()` of the last touch/pen press on this key, or null.
  const lastPointerPressRef = useRef<number | null>(null);

  return (
    <button
      type="button"
      {...props}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || event.button !== 0) return;
        lastPointerPressRef.current = performance.now();
        onPress();
      }}
      onClick={() => {
        const last = lastPointerPressRef.current;
        if (last !== null) {
          lastPointerPressRef.current = null;
          if (performance.now() - last < DUPLICATE_CLICK_WINDOW_MS) return;
        }
        onPress();
      }}
    />
  );
}
