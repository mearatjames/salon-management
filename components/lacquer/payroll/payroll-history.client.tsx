"use client";

// PayrollHistory — the History control + its closed-periods dialog (US4).
//
// Rendered in the Payroll header for everyone with page access (owners and
// managers — a manager can browse history, they just cannot close a period).
// The header button opens a shadcn Dialog listing every closed pay period
// newest-first; each row is a link to that period's read-only ledger
// (`/payroll?offset=…`). The period switcher reaches the most recent closed
// periods inline; this dialog is the full archive.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `History` header button). The dialog surface uses `--radius-xl` (16); every
// value traces to a `styles/payroll.css` / `styles/tokens.css` token
// (Constitution Principle I). Lucide icons at 1.5px stroke.

import { useState } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/dashboard/format";

/** One closed period, ready for the list — money pre-formatted upstream. */
export type PayrollHistoryItem = {
  /** Stable key + identity — the closed period's id. */
  id: string;
  /** Period label, e.g. "May 1 – 15, 2026". */
  label: string;
  /** Σ cash + check handed out for the period, in integer cents. */
  totalPaidCents: number;
  /** Display name of whoever closed the period. */
  closedByName: string;
  /** Closed-on label, e.g. "May 17" — pre-formatted by the server. */
  closedOnLabel: string;
  /** Href to the period's read-only ledger, e.g. "/payroll?offset=-1". */
  href: string;
};

export type PayrollHistoryProps = {
  items: readonly PayrollHistoryItem[];
};

const SHELL_CLASSNAME =
  "!w-[460px] !max-w-[460px] !p-6 !gap-0 !rounded-[var(--radius-xl)] " +
  "!bg-[var(--card)] !ring-0 !border !border-[var(--border)] !shadow-[var(--shadow-md)]";

export function PayrollHistory({ items }: PayrollHistoryProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="pr-btn-outline"
        data-slot="payroll-history-trigger"
        onClick={() => setOpen(true)}
      >
        <Archive size={16} strokeWidth={1.5} aria-hidden="true" />
        History
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-slot="payroll-history-dialog"
          className={SHELL_CLASSNAME}
          showCloseButton
        >
          <div className="pr-history">
            <div className="pr-history-head">
              <DialogTitle className="pr-history-title !font-sans">Payroll history</DialogTitle>
              <DialogDescription className="pr-history-sub">
                Closed pay periods, newest first. Open one to review its frozen figures.
              </DialogDescription>
            </div>

            {items.length === 0 ? (
              <div className="pr-history-empty" data-slot="payroll-history-empty">
                No periods have been closed yet.
              </div>
            ) : (
              <div className="pr-history-list" data-slot="payroll-history-list">
                {items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="pr-history-row"
                    data-slot="payroll-history-row"
                    data-period-id={item.id}
                    onClick={() => setOpen(false)}
                  >
                    <div className="pr-history-row-main">
                      <div className="pr-history-row-period">{item.label}</div>
                      <div className="pr-history-row-meta">
                        Closed by {item.closedByName} · {item.closedOnLabel}
                      </div>
                    </div>
                    <div className="pr-history-row-total">
                      <div className="pr-history-row-amount">
                        {formatCurrency(item.totalPaidCents / 100)}
                      </div>
                      <div className="pr-history-row-label">paid out</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
