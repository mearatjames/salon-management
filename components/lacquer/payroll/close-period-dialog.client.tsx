"use client";

// ClosePeriodDialog — the Close-period control + its confirmation dialog (US4).
//
// Rendered in the Payroll header for an OPEN period when the viewer is an owner
// (the parent gates on role — a manager never mounts this). The flow:
//   1. The header button opens a shadcn Dialog.
//   2. The dialog calls `closePeriod({ confirmedUnpaid: false })`. If every
//      eligible tech is paid the action closes the period straight away and
//      this island refreshes. If unpaid eligible techs remain the action
//      returns `INVALID` with their names — the dialog then shows the named
//      warning and a second confirm that re-calls with `confirmedUnpaid: true`.
//   3. Closing is terminal: once closed the period renders read-only.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `Close period` header CTA) + the destructive-confirm pattern in
// `components/lacquer/services/archive-dialog.client.tsx`. The dialog surface
// uses `--radius-xl` (16). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { closePeriod } from "@/app/(studio)/payroll/actions";

export type ClosePeriodDialogProps = {
  /** The open pay period's id — the `closePeriod` target. */
  payPeriodId: string;
  /** The period label, e.g. "May 16 – 31, 2026" — shown in the dialog copy. */
  periodLabel: string;
};

// Override the shadcn DialogContent defaults to the 16-radius confirm shell.
const SHELL_CLASSNAME =
  "!w-[400px] !max-w-[400px] !p-6 !gap-0 !rounded-[var(--radius-xl)] " +
  "!bg-[var(--card)] !ring-0 !border !border-[var(--border)] !shadow-[var(--shadow-md)]";

export function ClosePeriodDialog({ payPeriodId, periodLabel }: ClosePeriodDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // The named-unpaid-techs warning text from a first INVALID response.
  const [unpaidWarning, setUnpaidWarning] = useState<string | null>(null);
  // A non-warning failure (FORBIDDEN / PERIOD_CLOSED / UNEXPECTED).
  const [banner, setBanner] = useState<string | null>(null);

  const reset = () => {
    setUnpaidWarning(null);
    setBanner(null);
  };

  // `confirmedUnpaid` is false on the first attempt, true once the owner has
  // acknowledged the unpaid-techs warning.
  const submit = (confirmedUnpaid: boolean) => {
    if (pending) return;
    setBanner(null);
    startTransition(async () => {
      const result = await closePeriod({ payPeriodId, confirmedUnpaid });
      if (result.ok) {
        setOpen(false);
        reset();
        router.refresh();
        return;
      }
      if (result.code === "INVALID" && !confirmedUnpaid) {
        // Unpaid eligible techs remain — surface the named warning + reconfirm.
        setUnpaidWarning(result.message);
        return;
      }
      setBanner(result.message);
    });
  };

  return (
    <>
      <button
        type="button"
        className="pr-btn-primary"
        data-slot="close-period-trigger"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
        Close period
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return; // never dismiss mid-request
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          data-slot="close-period-dialog"
          className={SHELL_CLASSNAME}
          showCloseButton={false}
        >
          <div className="pr-close-dialog">
            <div className="pr-close-icon" aria-hidden="true">
              <Lock size={20} strokeWidth={1.5} />
            </div>

            <DialogTitle className="pr-close-title !font-sans">
              {`Close ${periodLabel}?`}
            </DialogTitle>

            <DialogDescription className="pr-close-body">
              Closing freezes every technician&apos;s figures for this period — paid and unpaid
              alike. A closed period is read-only and cannot be reopened.
            </DialogDescription>

            {unpaidWarning !== null && (
              <div className="pr-close-unpaid" data-slot="close-unpaid-warning" role="alert">
                <div className="pr-close-unpaid-title">Unpaid technicians</div>
                <div className="pr-close-unpaid-names">{unpaidWarning}</div>
                <p className="pr-close-body" style={{ marginTop: "var(--space-1)" }}>
                  They will be frozen as unpaid. You can still hand over their cash off the books,
                  but the period record will show them unpaid.
                </p>
              </div>
            )}

            {banner !== null && (
              <div className="pr-close-banner" data-slot="close-period-banner" role="alert">
                {banner}
              </div>
            )}

            <div className="pr-close-actions">
              <button
                type="button"
                className="pr-close-btn ghost"
                data-slot="close-period-cancel"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pr-close-btn primary"
                data-slot="close-period-confirm"
                disabled={pending}
                onClick={() => submit(unpaidWarning !== null)}
              >
                <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                {pending ? "Closing…" : unpaidWarning !== null ? "Close anyway" : "Close period"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
