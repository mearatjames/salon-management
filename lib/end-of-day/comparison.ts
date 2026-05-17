// Pure comparison helper for the End-of-Day cash count + edit surfaces.
//
// Extracted (verbatim, no behavior change) from
// `components/lacquer/eod/cash-count.client.tsx` per feature 020 task
// T010. Two callers consume it: the close-screen numpad island (feature
// 019) and the new edit-form island (feature 020). The math is pure on
// the typed-so-far string + the stable `expectedCents` integer, which
// is what lets us hit SC-002 (150 ms keystroke responsiveness) without
// a server round-trip per keystroke.
//
// Behavior MUST remain identical across the extraction — feature 019's
// e2e (`tests/e2e/end-of-day-cash.spec.ts`) is the regression authority.

export function deriveComparison(counted: string, expectedCents: number) {
  const hasCounted = counted !== "";
  // parseFloat("") === NaN; defensively coerce to 0. Multiplying by 100
  // then rounding pins the cents conversion to an integer — important
  // because JS floats can otherwise yield 11498.999… for "114.99".
  const countedCents = hasCounted ? Math.round(parseFloat(counted) * 100) : 0;
  const diff = hasCounted ? countedCents - expectedCents : 0;
  const isMatch = hasCounted && diff === 0;
  const isOver = hasCounted && diff > 0;
  const isShort = hasCounted && diff < 0;
  const hasDiff = hasCounted && diff !== 0;
  const state: "match" | "over" | "short" | "" = !hasCounted
    ? ""
    : isMatch
      ? "match"
      : isOver
        ? "over"
        : "short";
  return { hasCounted, countedCents, diff, isMatch, isOver, isShort, hasDiff, state };
}
