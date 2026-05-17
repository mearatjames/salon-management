"use client";

// CashCount — the right-side island of the End-of-Day Cash page.
//
// Owns the numpad buffer (the typed-so-far string) and derives the
// comparison state locally. The CRITICAL architectural decision: the
// numpad MUST NOT trigger any server round-trip per keystroke. Comparison
// state ("match" / "short" / "over") is pure math on the local string,
// which is what lets us hit SC-002 (150 ms keystroke responsiveness).
// The only server call is `closeCashDrawerAction(...)` on submit.
//
// US2 scope: the island (a) renders a notes textarea when there's a
// non-zero diff, (b) tightens `canSubmit` to require a non-empty trimmed
// note when there's a diff, (c) renders the transient EXPECTED_CHANGED
// banner above its own chrome when the server rejects a stale submit,
// and (d) wires the typed `notes` value into the action call.
//
// US3 scope (this revision): the numpad reducer has been extracted to
// `./numpad-reduce.ts` (no `"use client"`, pure helper, Vitest-testable).
// It now also handles the `"clear"` key — used by the new Clear text-
// link surfaced in the eyebrow row (visible only when `counted !== ""`).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { NumpadButtons, type NumpadKey } from "@/components/lacquer/eod/numpad-buttons";
import { numpadReduce, type NumpadState } from "@/components/lacquer/eod/numpad-reduce";
import { closeCashDrawerAction } from "@/app/(studio)/end-of-day/actions";

export type CashCountProps = {
  expectedCents: number;
};

// Snapshot what to render for the comparison block + the display border
// tint. All math is on the local `counted` string + the stable
// `expectedCents` prop — zero network involved.
function deriveComparison(counted: string, expectedCents: number) {
  const hasCounted = counted !== "";
  // parseFloat("") === NaN; defensively coerce to 0. Multiplying by 100
  // then rounding pins the cents conversion to an integer — important
  // because JS floats can otherwise yield 11499 for "114.99".
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

export function CashCount({ expectedCents }: CashCountProps) {
  const router = useRouter();
  const [state, setState] = useState<NumpadState>({ counted: "", fresh: true });
  const [notes, setNotes] = useState<string>("");
  // Transient banner state for the EXPECTED_CHANGED branch. Cleared on
  // the next non-error keystroke (the press handler wipes it).
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { counted } = state;

  const cmp = deriveComparison(counted, expectedCents);
  // US2 rule (spec FR-006): the close action accepts a match OR a
  // variance accompanied by a non-empty trimmed note.
  const canSubmit = cmp.hasCounted && (!cmp.hasDiff || notes.trim().length > 0) && !pending;

  // Accepts the wider `NumpadKey | "clear"` union so the eyebrow Clear
  // link and the 3×4 grid share a single dispatcher.
  const press = (key: NumpadKey | "clear") => {
    // Any keystroke after a stale-rejection banner clears the banner —
    // the operator is starting their recount.
    if (banner !== null) setBanner(null);
    setState((prev) => numpadReduce(prev, key));
  };

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await closeCashDrawerAction({
        countedCents: cmp.countedCents,
        expectedCents,
        notes,
      });
      if (result.ok) {
        // The server action already revalidated /end-of-day. Calling
        // `router.refresh()` makes the current view re-render against
        // the now-closed snapshot, swapping the island for the
        // <DoneScreen />.
        router.refresh();
        return;
      }
      // EXPECTED_CHANGED → set the recount banner with the exact spec
      // copy, then refresh so the page re-renders with the fresh
      // expected total (the right-side island will remount with the new
      // `expectedCents` prop and the banner state we just set).
      if (result.code === "EXPECTED_CHANGED") {
        setBanner("A new cash payment was recorded. Please recount the drawer.");
        router.refresh();
        return;
      }
      // ALREADY_CLOSED → another device just closed the day. Refresh so
      // the page renders the done screen.
      if (result.code === "ALREADY_CLOSED") {
        router.refresh();
        return;
      }
      // Other error codes (FORBIDDEN / BAD_INPUT / NOTE_REQUIRED /
      // UNEXPECTED): set the banner with the action's message so the
      // operator gets feedback. NOTE_REQUIRED is defence-in-depth —
      // `canSubmit` should already block this — but if the server
      // rejects we still surface a banner.
      setBanner(result.message);
    });
  };

  return (
    <div className="eod-right" data-slot="eod-cash-count">
      {/* Transient banner (EXPECTED_CHANGED + other action errors). Token-
          only warning tint. */}
      {banner !== null && (
        <div
          role="status"
          data-slot="eod-banner"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid color-mix(in oklch, var(--warning) 40%, var(--border))",
            background: "color-mix(in oklch, var(--warning) 10%, var(--card))",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          {banner}
        </div>
      )}

      {/* Eyebrow row — Clear link revealed when there's content to clear.
          Token-only styling (no raw hex); subtle text-link Lacquer pattern. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="eyebrow">Count your drawer</span>
        {counted !== "" && (
          <button
            type="button"
            data-slot="eod-clear"
            onClick={() => press("clear")}
            disabled={pending}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: pending ? "not-allowed" : "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
              transition: "color 150ms var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              if (!pending) e.currentTarget.style.color = "var(--foreground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Amount display — border tints by state via the .eod-display class. */}
      <div
        className={`eod-display ${cmp.state}`.trim()}
        data-slot="eod-display"
        data-state={cmp.state || "empty"}
      >
        <span className="eod-display-sym">$</span>
        <span className="eod-display-val tnum" data-slot="eod-display-val">
          {counted || "0"}
        </span>
      </div>

      <NumpadButtons onPress={press} disabled={pending} />

      {/* Comparison block. */}
      <div
        className={`eod-comparison ${cmp.state}`.trim()}
        data-slot="eod-comparison"
        data-state={cmp.state || "empty"}
      >
        <div className="eod-comp-row">
          <span className="eod-comp-lbl">Expected</span>
          <span className="eod-comp-num tnum">${(expectedCents / 100).toFixed(2)}</span>
        </div>
        <div className="eod-comp-row">
          <span className="eod-comp-lbl">Counted</span>
          <span className="eod-comp-num tnum">
            {cmp.hasCounted ? `$${(cmp.countedCents / 100).toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="eod-comp-divider" />
        <div className={`eod-comp-row eod-diff-row ${cmp.state}`.trim()}>
          <span className="eod-diff-lbl">
            {!cmp.hasCounted && (
              <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>Difference</span>
            )}
            {cmp.isMatch && (
              <span className="eod-diff-exact">
                <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                Exact match
              </span>
            )}
            {cmp.isOver && <span className="eod-diff-over">Over</span>}
            {cmp.isShort && <span className="eod-diff-short">Short</span>}
          </span>
          <span className="eod-diff-num tnum">
            {!cmp.hasCounted && <span style={{ color: "var(--muted-foreground)" }}>—</span>}
            {cmp.isOver && <span className="eod-diff-over">+${(cmp.diff / 100).toFixed(2)}</span>}
            {cmp.isShort && (
              <span className="eod-diff-short">−${(Math.abs(cmp.diff) / 100).toFixed(2)}</span>
            )}
          </span>
        </div>
      </div>

      {/* Discrepancy note — only when the count doesn't match. The
          destructive hint mirrors the prototype copy. */}
      {cmp.hasDiff && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <textarea
            data-slot="eod-note"
            className="eod-note"
            placeholder="What happened? (e.g. forgot to log a refund, customer tipped extra in cash, drawer was off at open.)"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending}
          />
          <span
            style={{
              fontSize: 11,
              color: "var(--destructive)",
              fontWeight: 500,
            }}
          >
            Required to close out
          </span>
        </div>
      )}

      {/* CTA — pinned to the bottom of the right column. */}
      <div style={{ marginTop: "auto" }}>
        <button
          type="button"
          data-slot="eod-close-cta"
          disabled={!canSubmit}
          onClick={submit}
          style={{
            width: "100%",
            height: 48,
            border: "1px solid transparent",
            borderRadius: 12,
            background: canSubmit ? "var(--primary)" : "var(--muted)",
            color: canSubmit ? "var(--primary-foreground)" : "var(--muted-foreground)",
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "background 150ms var(--ease-out)",
          }}
        >
          {pending ? "Closing…" : "Close Out Day"}
        </button>
      </div>
    </div>
  );
}
