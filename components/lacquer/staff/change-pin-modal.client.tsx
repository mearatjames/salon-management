"use client";

// ChangePinModal — shadcn `Dialog` wrapping a 2-step Enter → Confirm PIN
// flow that embeds <NumericKeypad>. Used by the edit panel's "Set PIN" /
// "Change" button (label flips on `target.pin_set`).
//
// State machine:
//   phase "enter"   : keypad fills enterBuf, auto-advances to "confirm" on
//                     the 4th digit (no submit button).
//   phase "confirm" : keypad fills confirmBuf. On the 4th digit:
//                       - match  → submit FormData to setStaffPin
//                       - mismatch → flash error, reset both buffers,
//                         return to "enter".
//
// FR-036 + ui.contract.md § Dialog strings:
//   - Backdrop click / Cancel button closes with no state change
//     (handleOpenChange resets every piece of state on close, identical
//     pattern to add-staff-wizard.client.tsx).
//   - Title: "Set PIN" or "Change PIN" (mode prop). The staff name lives
//     in the description, not the title, so a long name never overflows
//     the dialog header.
//
// Submit happens server-side via the Server Action: we render a hidden
// <form action={setStaffPin}> containing the matched FormData and call
// requestSubmit() once both buffers match. The action redirects with
// `?selected=…&toast=pin_updated`; the page re-renders and (US7) the
// toaster fires.

import { useCallback, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NumericKeypad } from "@/components/lacquer/numeric-keypad.client";
import { FormPendingSignal } from "@/components/lacquer/form-pending-signal";
import { Spinner } from "@/components/ui/spinner";
import { setStaffPin } from "@/app/(studio)/settings/staff/actions";
import {
  pinKeypadInit,
  pinKeypadSubmit,
  type PinKeypadState,
} from "@/lib/auth/pin-keypad";

export type ChangePinModalMode = "set" | "change";

export type ChangePinModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  staffId: string;
  staffName: string;
  /** "set" → unset → set; "change" → already-set → change. Drives the title + button label. */
  mode: ChangePinModalMode;
};

export function ChangePinModal({
  open,
  onOpenChange,
  staffId,
  staffName,
  mode,
}: ChangePinModalProps) {
  const [pinState, setPinState] = useState<PinKeypadState>(() => pinKeypadInit());
  const [submitting, setSubmitting] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const submittingRef = useRef(false);

  // Reset every piece of state synchronously when the modal closes so a
  // re-open lands on phase "enter" with empty buffers. Doing it in the
  // event handler (not a useEffect) avoids a cascading re-render — same
  // pattern as add-staff-wizard.client.tsx (Phase 4 lesson learned).
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setPinState(pinKeypadInit());
        submittingRef.current = false;
        setSubmitting(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const handleKeypadSubmit = useCallback(
    (digits: string) => {
      const { state: next, effect } = pinKeypadSubmit(pinState, digits);
      setPinState(next);
      if (effect?.kind === "submit") {
        // Match — fire the Server Action. Guard against double-submit while
        // the keypad's microtask callback drains. The NumericKeypad refs
        // the latest `onSubmit` internally, so re-binding this callback per
        // `pinState` change is safe (no listener churn).
        if (submittingRef.current) return;
        submittingRef.current = true;
        queueMicrotask(() => {
          formRef.current?.requestSubmit();
        });
      }
    },
    [pinState]
  );

  // The staff name is intentionally NOT in the title — a long name pushes
  // into the close button and overflows the header. It stays in the
  // description below, which wraps freely.
  const title = mode === "change" ? "Change PIN" : "Set PIN";
  const description =
    pinState.phase === "enter"
      ? `Enter a new 4-digit PIN for ${staffName}.`
      : "Enter the same PIN again to confirm.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-slot="change-pin-modal" data-mode={mode} data-phase={pinState.phase}>
        <DialogHeader>
          <DialogTitle data-slot="change-pin-title">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div
          data-slot="change-pin-body"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-4)",
            padding: "var(--space-4) 0",
            position: "relative",
          }}
        >
          {submitting ? (
            <div
              data-slot="change-pin-processing"
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
              }}
            >
              <Spinner size={16} strokeWidth={2} aria-hidden="true" />
              <span>Saving…</span>
            </div>
          ) : null}
          <div
            style={{
              opacity: submitting ? 0.5 : 1,
              pointerEvents: submitting ? "none" : undefined,
              transition: "opacity 150ms var(--ease-out)",
            }}
          >
            <NumericKeypad
              step={pinState.phase}
              errorMessage={pinState.error}
              onSubmit={handleKeypadSubmit}
              onCancel={handleClose}
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={handleClose}
            data-slot="change-pin-cancel"
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "transparent",
              color: "var(--muted-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </DialogFooter>

        {/* Hidden form that posts to setStaffPin. Rendered always so the
            keypad confirm handler can call requestSubmit() once both
            buffers match. The raw PIN crosses the wire here (HTTPS-only
            in production); it is hashed by the Server Action before any
            DB write and is never recorded in audit.
            FormPendingSignal lifts the form's pending state so the modal
            body can show a processing indicator while the action runs. */}
        <form
          ref={formRef}
          action={setStaffPin}
          data-slot="change-pin-form"
          style={{ display: "none" }}
        >
          <input type="hidden" name="staff_id" value={staffId} />
          <input type="hidden" name="pin" value={pinState.enterBuf} />
          <FormPendingSignal onPendingChange={setSubmitting} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
