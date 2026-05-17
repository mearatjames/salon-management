// Unit tests for the End-of-Day cash count numpad reducer.
//
// `numpadReduce(state, key)` is a pure helper colocated with
// `components/lacquer/eod/cash-count.client.tsx` — it lives in
// `numpad-reduce.ts` (no `"use client"` directive so Vitest can import it
// directly without pulling in the React-server boundary).
//
// US3 (T027) drives this reducer: digits append, `.` is once-only, the
// fraction cap is two digits, backspace pops, and Clear resets both the
// buffer and the `fresh` flag so the next digit replaces instead of
// appending. The `.tsx` suffix is here for parity with the test plan —
// the helper itself has zero JSX surface, so all assertions are
// data-only.

import { describe, expect, it } from "vitest";

import { numpadReduce } from "@/components/lacquer/eod/numpad-reduce";

describe("numpadReduce", () => {
  it("starts with the fresh flag — the first digit replaces the empty buffer", () => {
    const initial = { counted: "", fresh: true } as const;
    expect(numpadReduce(initial, "5")).toEqual({ counted: "5", fresh: false });
  });

  it("appends each digit 0-9 to a non-fresh, non-empty buffer", () => {
    const start = { counted: "1", fresh: false };
    const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
    for (const d of digits) {
      expect(numpadReduce(start, d)).toEqual({ counted: `1${d}`, fresh: false });
    }
  });

  it("'.' added once produces a '.'; a second '.' is a no-op", () => {
    const afterDot = numpadReduce({ counted: "5", fresh: false }, ".");
    expect(afterDot).toEqual({ counted: "5.", fresh: false });

    const secondDot = numpadReduce(afterDot, ".");
    expect(secondDot).toEqual(afterDot);
    // Identity check: a no-op returns the same state reference so React
    // bail-outs work (Object.is on useState setter input → no re-render).
    expect(secondDot).toBe(afterDot);
  });

  it("'.' on a fresh empty buffer becomes '0.'", () => {
    const fresh = { counted: "", fresh: true } as const;
    expect(numpadReduce(fresh, ".")).toEqual({ counted: "0.", fresh: false });
  });

  it("accepts two decimal digits after '.', then refuses a third (two-decimal cap)", () => {
    const s0 = { counted: "164.", fresh: false };
    const s1 = numpadReduce(s0, "5");
    expect(s1).toEqual({ counted: "164.5", fresh: false });
    const s2 = numpadReduce(s1, "0");
    expect(s2).toEqual({ counted: "164.50", fresh: false });
    const s3 = numpadReduce(s2, "9");
    // No-op — same reference returned so React bail-out triggers.
    expect(s3).toBe(s2);
  });

  it("backspace pops the last character", () => {
    const start = { counted: "123", fresh: false };
    const next = numpadReduce(start, "back");
    expect(next).toEqual({ counted: "12", fresh: false });
  });

  it("backspace down to empty re-arms the fresh flag", () => {
    const start = { counted: "1", fresh: false };
    const next = numpadReduce(start, "back");
    expect(next).toEqual({ counted: "", fresh: true });
  });

  it("Clear resets the buffer to '' and fresh to true", () => {
    const start = { counted: "164.50", fresh: false };
    const cleared = numpadReduce(start, "clear");
    expect(cleared).toEqual({ counted: "", fresh: true });
  });

  it("after Clear, the first digit replaces (does not append)", () => {
    // Stronger version of the previous case: simulate the full round trip
    // — buffer has content, user taps Clear, then taps a digit. The digit
    // must REPLACE the (empty) buffer rather than become its first char
    // via append semantics. The fresh-flag is what guarantees that.
    const start = { counted: "0", fresh: false };
    const cleared = numpadReduce(start, "clear");
    expect(cleared).toEqual({ counted: "", fresh: true });
    const next = numpadReduce(cleared, "5");
    expect(next).toEqual({ counted: "5", fresh: false });
  });

  it("after Clear, '.' starts a new '0.' (mirrors fresh-empty behaviour)", () => {
    const cleared = numpadReduce({ counted: "12", fresh: false }, "clear");
    const next = numpadReduce(cleared, ".");
    expect(next).toEqual({ counted: "0.", fresh: false });
  });
});
