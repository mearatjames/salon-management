"use client";

// TechPayAction — the pay-action card on the tech-detail screen (US3).
//
// Two states, driven by the tech's ledger row:
//   - PENDING — payment-method tabs (cash / Zelle / check) + a mark-paid
//     button. Clicking it calls the `recordPayout` Server Action.
//   - PAID — a receipt (method · paid-on · recorded-by) + an Undo button
//     that calls `undoPayout`.
// A failed action surfaces its message in an inline banner; on success the
// Server Action's `revalidatePath` refreshes the RSC tree (state badge,
// ledger, KPIs) and `router.refresh()` re-renders this island.
//
// Rendered ONLY for an eligible tech in an OPEN period — the detail page does
// not mount it for a `no_work` tech or a closed period (the route is the
// boundary; the `recordPayout` action re-checks both server-side anyway).
//
// Client Component — it owns the method-draft state and a `useTransition`
// pending flag. Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx`
// (`PulseDetailScreen`'s `.pp-detail-pay-card` block). Lucide icons at 1.5px
// stroke; every value traces to a `styles/payroll.css` / `styles/tokens.css`
// token (Constitution Principle I).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, FileText, RefreshCcw, Smartphone } from "lucide-react";

import { formatCurrency } from "@/lib/dashboard/format";
import type { PayrollLedgerRow } from "@/lib/payroll/aggregate";
import { formatPaidOn } from "@/lib/payroll/format";
import { recordPayout, undoPayout } from "@/app/(studio)/payroll/actions";
import { Spinner } from "@/components/ui/spinner";

type Method = "cash" | "zelle" | "check";

const METHODS: ReadonlyArray<{ value: Method; label: string; icon: typeof Banknote }> = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "zelle", label: "Zelle", icon: Smartphone },
  { value: "check", label: "Check", icon: FileText },
];

export type TechPayActionProps = {
  /** The pay period's id — the `recordPayout` / `undoPayout` target. */
  payPeriodId: string;
  /** The tech's ledger row — drives the paid/pending split and the figures. */
  row: PayrollLedgerRow;
  /** The pay-date label, e.g. "Tue, Jun 2" — shown in the pending helper line. */
  payDateLabel: string;
};

function methodLabel(method: Method | null): string {
  if (!method) return "";
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

export function TechPayAction({ payPeriodId, row, payDateLabel }: TechPayActionProps) {
  const router = useRouter();
  const [methodDraft, setMethodDraft] = useState<Method>("cash");
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPaid = row.state === "paid";
  const firstName = row.displayName.split(" ")[0];

  const onMarkPaid = () => {
    if (pending) return;
    setBanner(null);
    startTransition(async () => {
      const result = await recordPayout({
        payPeriodId,
        staffId: row.staffId,
        method: methodDraft,
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      setBanner(result.message);
    });
  };

  const onUndo = () => {
    if (pending) return;
    setBanner(null);
    startTransition(async () => {
      const result = await undoPayout({ payPeriodId, staffId: row.staffId });
      if (result.ok) {
        router.refresh();
        return;
      }
      setBanner(result.message);
    });
  };

  return (
    <div className="pp-detail-card pp-detail-pay-card" data-slot="tech-pay-action">
      {banner !== null && (
        <div role="status" className="pp-pay-banner" data-slot="pay-action-banner">
          {banner}
        </div>
      )}

      {isPaid ? (
        <>
          <div className="pl-paid-receipt" data-slot="pay-receipt">
            <div className="ico">
              <Check size={16} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div className="pl-paid-receipt-t">
              <div className="pl-paid-receipt-title">
                Paid via {methodLabel(row.payout?.method ?? null)} on{" "}
                {formatPaidOn(row.payout?.paidOn ?? null)}
              </div>
              <div className="pl-paid-receipt-sub">
                {row.payout?.recordedByName
                  ? `Recorded by ${row.payout.recordedByName}`
                  : "Recorded payout"}{" "}
                · {formatCurrency(row.cashPaymentCents / 100)} cash
              </div>
            </div>
          </div>
          <button
            type="button"
            className="pp-pay-undo"
            data-slot="undo-payout"
            disabled={pending}
            onClick={onUndo}
          >
            {pending ? (
              <Spinner size={16} strokeWidth={2} />
            ) : (
              <RefreshCcw size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
            {pending ? "Undoing…" : "Undo payout"}
          </button>
        </>
      ) : (
        <>
          <div className="pl-section-title">Pay {firstName}</div>
          <div className="pl-method-tabs" data-slot="pay-method-tabs" role="group">
            {METHODS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={`pl-method${methodDraft === value ? " on" : ""}`}
                data-slot="pay-method"
                data-method={value}
                aria-pressed={methodDraft === value}
                disabled={pending}
                onClick={() => setMethodDraft(value)}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pp-pay-cta"
            data-slot="mark-paid"
            disabled={pending}
            onClick={onMarkPaid}
          >
            {pending ? (
              <Spinner size={16} strokeWidth={2} />
            ) : (
              <Check size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
            {pending
              ? "Recording…"
              : `Mark ${formatCurrency(row.cashPaymentCents / 100)} paid by ${methodLabel(methodDraft)}`}
          </button>
          <div className="pp-detail-pay-foot">
            Pay date is <b>{payDateLabel}</b>. This records an immutable payout you can undo while
            the period is open.
          </div>
        </>
      )}
    </div>
  );
}
