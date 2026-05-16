"use client";

// ResetPinModal — centered shadcn Dialog wrapping the two-pass `InlinePin`
// keypad. Used by the active row menu's "Reset PIN" item.
//
// The keypad's `onConfirmed(pin)` is the auto-submit trigger — there's no
// separate Save PIN footer button because InlinePin already auto-advances
// on the 4th matching digit. Submit fires `resetUserPin` server action with
// hidden `staff_id` + `pin` fields.
//
// Cancel + backdrop click resets every piece of state via handleOpenChange,
// matching the pattern in `change-pin-modal.client.tsx`.

import { useCallback, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resetUserPin } from "@/app/(studio)/settings/onboarding/actions";

import { InlinePin } from "./inline-pin.client";

export type ResetPinModalTarget = {
  id: string;
  display_name: string;
};

export type ResetPinModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  target: ResetPinModalTarget;
};

export function ResetPinModal({ open, onOpenChange, target }: ResetPinModalProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const pinRef = useRef<HTMLInputElement | null>(null);
  const [, setBumpKey] = useState(0); // remount InlinePin on reopen
  const submittingRef = useRef(false);

  const firstName = target.display_name.trim().split(" ")[0] || target.display_name;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        submittingRef.current = false;
        // Bump key so a re-open lands on a fresh InlinePin (phase 1, no buffers).
        setBumpKey((k) => k + 1);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleConfirmed = useCallback((pin: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (pinRef.current) pinRef.current.value = pin;
    // queueMicrotask defer keeps the keypad's final dot paint visible before
    // the form submission tears down the modal.
    queueMicrotask(() => formRef.current?.requestSubmit());
  }, []);

  const handleSkip = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-slot="reset-pin-modal" className="onb-reset-pin-shell">
        <DialogHeader>
          <DialogTitle>Reset PIN for {firstName}</DialogTitle>
          <DialogDescription>
            Choose a new 4-digit PIN. They&apos;ll see a notice on /select-staff to try the new PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="onb-reset-pin-body">
          <InlinePin
            recipientFirstName={firstName}
            onConfirmed={handleConfirmed}
            onSkip={handleSkip}
          />
        </div>

        <form ref={formRef} action={resetUserPin} className="onb-reset-pin-form">
          <input type="hidden" name="staff_id" value={target.id} />
          <input ref={pinRef} type="hidden" name="pin" defaultValue="" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
