"use client";

// AdjustmentsCard — the manual payout-adjustments surface on the tech-detail
// side rail (feature 053, US2).
//
// Two pieces in one island:
//   1. The lines list — one row per `AdjustmentLine` (signed amount, reason,
//      creator + timestamp, an "edited" marker), plus a running net-payout
//      summary and an "Add adjustment" trigger.
//   2. An `AdjustmentForm` inside a centered shadcn `Dialog` (mirrors
//      `close-period-dialog.client.tsx`) — an Add / Deduct toggle, a `$` amount
//      input, reason preset chips + a free-text input, a live before/after
//      net-payout preview, and Cancel / confirm. Confirm is disabled until the
//      amount is > 0 AND the reason is non-empty.
//
// Refresh model: this single, always-mounted component owns ONE `useTransition`
// and every Server-Action call (`addAdjustment` / `editAdjustment` /
// `deleteAdjustment`). On success it closes the dialog and `router.refresh()`es
// in place — the same best-effort pattern the rest of payroll uses
// (`TechPayAction`, `ClosePeriodDialog`). The `AdjustmentForm` is a controlled
// input collector that hands its values back via `onSubmit`.
//
// Read-only (a paid tech or a closed period) hides every write affordance —
// the Add trigger and the per-line edit/delete buttons — and shows a
// "Period closed" lock badge in the head; the lines + net-adjustment subtotal
// still list (frozen, folded into the net — no clawback, FR-012). The route +
// the actions + the RPC `payroll_assert_adjustable` guard are the real security
// boundary; this is an affordance gate (US3).
//
// FR-006: NO refund note / flag / banner anywhere. Every value traces to a
// `styles/payroll.css` / `styles/tokens.css` token (Constitution Principle I).
// Lucide icons at 1.5px stroke.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lock, Minus, Pencil, Plus, Trash2 } from "lucide-react";

import { formatCurrency } from "@/lib/dashboard/format";
import type { AdjustmentLine } from "@/lib/payroll/aggregate";
import { addAdjustment, deleteAdjustment, editAdjustment } from "@/app/(studio)/payroll/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// Reason preset chips — calm, specific salon copy (sentence case). Free-text
// stays available for anything off-list.
const REASON_PRESETS = [
  "Redo on the house",
  "Product charge",
  "Cash advance",
  "Correction",
] as const;

type Direction = "add" | "deduct";

export type AdjustmentsCardProps = {
  /** The open pay period's id — the `addAdjustment` target. */
  payPeriodId: string;
  /** The tech this card adjusts. */
  staffId: string;
  /** The tech's existing adjustment lines, in created order. */
  adjustments: readonly AdjustmentLine[];
  /** The tech's cash payment before adjustments (signed-base for the preview). */
  cashPaymentCents: number;
  /** Net payout after adjustments (cash + Σ adjustments). */
  netPayoutCents: number;
  /** A paid tech or a closed period — hide every write affordance. */
  readOnly: boolean;
};

// A signed currency label, e.g. "+$12", "−$5". Whole-dollar via `formatCurrency`.
function signedCurrency(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${formatCurrency(Math.abs(cents) / 100)}`;
}

// A net-payout label that carries its own minus sign when negative.
function netCurrency(cents: number): string {
  if (cents < 0) return `−${formatCurrency(Math.abs(cents) / 100)}`;
  return formatCurrency(cents / 100);
}

type DialogMode = { kind: "add" } | { kind: "edit"; line: AdjustmentLine } | null;

// The values the form collects; the card turns them into the signed RPC call.
type AdjustmentValues = { amountCents: number; reason: string };

export function AdjustmentsCard({
  payPeriodId,
  staffId,
  adjustments,
  cashPaymentCents,
  netPayoutCents,
  readOnly,
}: AdjustmentsCardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<DialogMode>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // All three mutations run in THIS component's single transition; on success
  // close the dialog and refresh in place (best-effort, matching TechPayAction).
  const submit = (values: AdjustmentValues) => {
    if (pending) return;
    setBanner(null);
    startTransition(async () => {
      const result =
        mode?.kind === "edit"
          ? await editAdjustment({
              adjustmentId: mode.line.id,
              amountCents: values.amountCents,
              reason: values.reason,
            })
          : await addAdjustment({
              payPeriodId,
              staffId,
              amountCents: values.amountCents,
              reason: values.reason,
            });
      if (result.ok) {
        setMode(null);
        router.refresh();
        return;
      }
      setBanner(result.message);
    });
  };

  const onDelete = (line: AdjustmentLine) => {
    if (pending) return;
    setBanner(null);
    startTransition(async () => {
      await deleteAdjustment({ adjustmentId: line.id });
      // Whether or not the delete succeeded, refresh so the lines re-sync.
      router.refresh();
    });
  };

  return (
    <div className="pp-detail-card pp-adj-card" data-slot="adjustments-card">
      <div className="pp-adj-head">
        <div className="pl-section-title" style={{ marginBottom: 0 }}>
          Adjustments
        </div>
        {readOnly && (
          <span className="pp-adj-lock-badge" data-slot="adjustments-lock-badge">
            <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
            Period closed
          </span>
        )}
      </div>

      {adjustments.length === 0 ? (
        <div className="pp-adj-empty" data-slot="adjustments-empty">
          No adjustments this period.
        </div>
      ) : (
        <div className="pp-adj-list" data-slot="adjustments-list">
          {adjustments.map((line) => {
            const isAdd = line.amountCents >= 0;
            return (
              <div
                className="pp-adj-line"
                data-slot="adjustment-line"
                data-adj-id={line.id}
                key={line.id}
              >
                <div className="pp-adj-line-main">
                  <div className="pp-adj-line-reason">{line.reason}</div>
                  <div className="pp-adj-line-meta">
                    {line.createdByName ? `${line.createdByName} · ` : ""}
                    {line.createdAtLabel}
                    {line.edited ? " · edited" : ""}
                  </div>
                </div>
                <div className="pp-adj-line-r">
                  <span
                    className={`pp-adj-line-amount ${isAdd ? "add" : "deduct"}`}
                    data-slot="adjustment-amount"
                  >
                    {signedCurrency(line.amountCents)}
                  </span>
                  {!readOnly && (
                    <div className="pp-adj-line-actions">
                      <button
                        type="button"
                        className="pp-adj-icon-btn"
                        data-slot="adjustment-edit"
                        aria-label={`Edit ${line.reason}`}
                        disabled={pending}
                        onClick={() => {
                          setBanner(null);
                          setMode({ kind: "edit", line });
                        }}
                      >
                        <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="pp-adj-icon-btn"
                        data-slot="adjustment-delete"
                        aria-label={`Remove ${line.reason}`}
                        disabled={pending}
                        onClick={() => onDelete(line)}
                      >
                        <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adjustments.length > 0 && (
        <div className="pp-adj-net" data-slot="adjustments-net">
          <span className="pp-adj-net-l">Net payout</span>
          <span
            className={`pp-adj-net-v${netPayoutCents < 0 ? " negative" : ""}`}
            data-slot="adjustments-net-value"
          >
            {netCurrency(netPayoutCents)}
          </span>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          className="pp-adj-add-btn"
          data-slot="add-adjustment-trigger"
          disabled={pending}
          onClick={() => {
            setBanner(null);
            setMode({ kind: "add" });
          }}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          Add adjustment
        </button>
      )}

      <AdjustmentDialog
        mode={mode}
        cashPaymentCents={cashPaymentCents}
        banner={banner}
        pending={pending}
        onClose={() => {
          if (pending) return;
          setBanner(null);
          setMode(null);
        }}
        onSubmit={submit}
      />
    </div>
  );
}

// ─── The dialog + form ───────────────────────────────────────────────────────

const SHELL_CLASSNAME =
  "!w-[440px] !max-w-[440px] !p-6 !gap-0 !rounded-[var(--radius-xl)] " +
  "!bg-[var(--card)] !ring-0 !border !border-[var(--border)] !shadow-[var(--shadow-md)]";

function AdjustmentDialog({
  mode,
  cashPaymentCents,
  banner,
  pending,
  onClose,
  onSubmit,
}: {
  mode: DialogMode;
  cashPaymentCents: number;
  banner: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: AdjustmentValues) => void;
}) {
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        data-slot="adjustment-dialog"
        className={SHELL_CLASSNAME}
        showCloseButton={false}
      >
        {mode !== null && (
          <AdjustmentForm
            key={mode.kind === "edit" ? mode.line.id : "add"}
            mode={mode}
            cashPaymentCents={cashPaymentCents}
            banner={banner}
            pending={pending}
            onCancel={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentForm({
  mode,
  cashPaymentCents,
  banner,
  pending,
  onCancel,
  onSubmit,
}: {
  mode: Exclude<DialogMode, null>;
  cashPaymentCents: number;
  banner: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: AdjustmentValues) => void;
}) {
  const isEdit = mode.kind === "edit";
  const seed = isEdit ? mode.line : null;

  const [direction, setDirection] = useState<Direction>(
    seed && seed.amountCents < 0 ? "deduct" : "add"
  );
  // The amount as a free-text dollar string, e.g. "12.50".
  const [amountStr, setAmountStr] = useState<string>(
    seed ? (Math.abs(seed.amountCents) / 100).toString() : ""
  );
  const [reason, setReason] = useState<string>(seed ? seed.reason : "");

  // Parse the dollar string into integer cents. Invalid / empty → 0.
  const cents = useMemo(() => {
    const n = Number.parseFloat(amountStr);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [amountStr]);

  const signedCents = direction === "deduct" ? -cents : cents;
  const trimmedReason = reason.trim();
  const canSubmit = cents > 0 && trimmedReason.length > 0 && !pending;

  const beforeNet = cashPaymentCents;
  const afterNet = cashPaymentCents + signedCents;

  const handleConfirm = () => {
    if (!canSubmit) return;
    onSubmit({ amountCents: signedCents, reason: trimmedReason });
  };

  return (
    <div className="adj-form" data-slot="adjustment-form">
      <div className="adj-modal-head">
        <DialogTitle className="adj-modal-title !font-sans">
          {isEdit ? "Edit adjustment" : "Add adjustment"}
        </DialogTitle>
        <DialogDescription className="adj-modal-sub">
          Adjustments change this tech&apos;s net payout for the period. They can be edited or
          removed while the period is open.
        </DialogDescription>
      </div>

      {banner !== null && (
        <div className="adj-form-banner" data-slot="adjustment-form-banner" role="alert">
          {banner}
        </div>
      )}

      <div>
        <span className="adj-field-label">Direction</span>
        <div className="adj-dir" data-slot="adjustment-direction" role="group">
          <button
            type="button"
            className={`adj-dir-btn${direction === "add" ? " on-add" : ""}`}
            data-slot="direction-add"
            aria-pressed={direction === "add"}
            disabled={pending}
            onClick={() => setDirection("add")}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Add
          </button>
          <button
            type="button"
            className={`adj-dir-btn${direction === "deduct" ? " on-deduct" : ""}`}
            data-slot="direction-deduct"
            aria-pressed={direction === "deduct"}
            disabled={pending}
            onClick={() => setDirection("deduct")}
          >
            <Minus size={16} strokeWidth={1.5} aria-hidden="true" />
            Deduct
          </button>
        </div>
      </div>

      <div>
        <span className="adj-field-label">Amount</span>
        <div className="adj-amount">
          <span className="adj-amount-sign">$</span>
          <input
            className="adj-amount-input"
            data-slot="adjustment-amount-input"
            inputMode="decimal"
            placeholder="0.00"
            value={amountStr}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              // Allow only digits + a single decimal point.
              if (/^\d*\.?\d*$/.test(v)) setAmountStr(v);
            }}
          />
        </div>
      </div>

      <div>
        <span className="adj-field-label">Reason</span>
        <div className="adj-chips" data-slot="adjustment-reason-chips">
          {REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`adj-chip${reason === preset ? " on" : ""}`}
              data-slot="reason-chip"
              aria-pressed={reason === preset}
              disabled={pending}
              onClick={() => setReason(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          className="adj-reason-input"
          data-slot="adjustment-reason-input"
          placeholder="Or write your own reason"
          maxLength={80}
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="adj-preview" data-slot="adjustment-preview">
        <span className="adj-preview-l">Net payout</span>
        <span className="adj-preview-r">
          <span className="adj-preview-before">{netCurrency(beforeNet)}</span>
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
          <span
            className={`adj-preview-after${afterNet < 0 ? " negative" : ""}`}
            data-slot="adjustment-preview-after"
          >
            {netCurrency(afterNet)}
          </span>
        </span>
      </div>

      <div className="adj-form-actions">
        <button
          type="button"
          className="adj-form-btn ghost"
          data-slot="adjustment-cancel"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="adj-form-btn primary"
          data-slot="adjustment-confirm"
          disabled={!canSubmit}
          aria-busy={pending || undefined}
          onClick={handleConfirm}
        >
          {pending ? (
            <Spinner size={16} strokeWidth={2} />
          ) : (
            <Check size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add adjustment"}
        </button>
      </div>
    </div>
  );
}
