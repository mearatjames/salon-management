"use client";

// EditForm — the client island for the Past Cash Counts edit affordance
// (feature 020, US2). Mounted on `/end-of-day/history/<sessionId>` when
// `?edit=1` is present in the URL (see T026).
//
// Mirrors the eyebrow + amount display + numpad + comparison + notes
// textarea pattern from `cash-count.client.tsx`. The differences are:
//   - The numpad buffer is PRE-FILLED with the existing counted_cents so
//     the operator can backspace + correct rather than start from zero.
//     `fresh: false` on the initial state so the first digit APPENDS
//     (per the spec's "edit, don't reset" intent).
//   - The CTA reads "Save changes" (primary) with a "Cancel" secondary
//     that navigates back to the read-only detail view.
//   - On submit we call `editCashDrawerAction` (not `closeCashDrawerAction`).
//   - The notes textarea is ALWAYS rendered (not conditional on diff) so
//     the operator can adjust the existing note even when the new count
//     happens to match expected. The "required when variance != 0" rule
//     is enforced via `canSubmit` and re-enforced by the RPC.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { NumpadButtons, type NumpadKey } from "@/components/lacquer/eod/numpad-buttons";
import { numpadReduce, type NumpadState } from "@/components/lacquer/eod/numpad-reduce";
import { editCashDrawerAction } from "@/app/(studio)/end-of-day/history/actions";
import { deriveComparison } from "@/lib/end-of-day/comparison";

export type EditFormProps = {
  sessionId: string;
  // The partial expected_cents stored on the row — the same value the
  // close screen used. NOT the effective total.
  expectedCents: number;
  // The opening float. Combined with expectedCents below to recompute
  // the EFFECTIVE expected total at close time.
  openingCents: number;
  initialCountedCents: number;
  initialNotes: string | null;
};

export function EditForm({
  sessionId,
  expectedCents,
  openingCents,
  initialCountedCents,
  initialNotes,
}: EditFormProps) {
  const router = useRouter();

  // Prefill the numpad buffer from the existing counted amount. `fresh:
  // false` so the next digit APPENDS rather than replaces (the operator
  // is correcting, not retyping from scratch).
  const [state, setState] = useState<NumpadState>({
    counted: (initialCountedCents / 100).toFixed(2),
    fresh: false,
  });
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { counted } = state;

  // IMPORTANT — variance math symmetry with the RPC:
  // `pos_edit_cash_drawer` recomputes variance as
  //   variance = counted - (opening + expected)
  // because `expected_cents` on the row is the PARTIAL expected (cash
  // payments only); the opening float was added inside the original
  // close RPC's variance computation. `deriveComparison(counted, x)`
  // returns `counted - x`, so we pass `(openingCents + expectedCents)`
  // as the second argument to keep the displayed comparison consistent
  // with the row's stored variance after save.
  const effectiveExpectedCents = openingCents + expectedCents;
  const cmp = deriveComparison(counted, effectiveExpectedCents);

  // Same close-screen rule (FR-012 carried forward): notes are required
  // only when the new variance is non-zero.
  const canSubmit = cmp.hasCounted && (!cmp.hasDiff || notes.trim().length > 0) && !pending;

  const press = (key: NumpadKey | "clear") => {
    if (banner !== null) setBanner(null);
    setState((prev) => numpadReduce(prev, key));
  };

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await editCashDrawerAction({
        sessionId,
        countedCents: cmp.countedCents,
        notes,
      });
      if (result.ok) {
        // Drop the `?edit=1` param and re-render against the new row.
        router.push(`/end-of-day/history/${sessionId}`);
        router.refresh();
        return;
      }
      setBanner(result.message);
    });
  };

  const cancel = () => {
    router.push(`/end-of-day/history/${sessionId}`);
  };

  return (
    <div className="eod-right" data-slot="eod-history-edit-form">
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="eyebrow">Edit your count</span>
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

      <div
        className={`eod-comparison ${cmp.state}`.trim()}
        data-slot="eod-comparison"
        data-state={cmp.state || "empty"}
      >
        <div className="eod-comp-row">
          <span className="eod-comp-lbl">Expected</span>
          <span className="eod-comp-num tnum">${(effectiveExpectedCents / 100).toFixed(2)}</span>
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

      {/* Notes textarea — always rendered for the edit form so an
          operator can adjust an existing note even when the new count
          matches. "Required" hint only renders when the new variance is
          non-zero. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <textarea
          data-slot="eod-note"
          className="eod-note"
          placeholder="What changed? (e.g. recount found $2 short, corrected miscount, found uncashed tip.)"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
        />
        {cmp.hasDiff && (
          <span
            style={{
              fontSize: 11,
              color: "var(--destructive)",
              fontWeight: 500,
            }}
          >
            Required to save
          </span>
        )}
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          data-slot="eod-save-cta"
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
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          data-slot="eod-cancel-cta"
          disabled={pending}
          onClick={cancel}
          style={{
            width: "100%",
            height: 40,
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "transparent",
            color: "var(--foreground)",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            fontWeight: 500,
            cursor: pending ? "not-allowed" : "pointer",
            transition: "background 150ms var(--ease-out)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
