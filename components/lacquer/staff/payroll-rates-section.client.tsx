"use client";

// PayrollRatesSection — the "Payroll rates" section inside the staff edit
// panel (specs/047-payroll-page § US5).
//
// Three per-tech payroll fields the Payroll page uses to compute earnings:
//   - Service commission % — share of service income the tech keeps.
//   - Tip split %          — share of their card tips the tech keeps.
//   - Check portion        — dollars paid each period by physical check.
//
// Storage shapes differ from the UI:
//   - The two percentages are stored as 0–1 fractions; the UI shows the
//     0–100 value (a stored 0.65 displays "65"). Hidden inputs submit the
//     0–100 value verbatim — `updateStaff` divides by 100 server-side.
//   - The check portion is stored as integer cents; the UI is a dollars
//     input. The hidden input submits dollars — `updateStaff` rounds to
//     cents server-side.
//
// OWNER-ONLY (FR-002/FR-033): editing these fields is restricted to owners.
// When `canEdit` is false the inputs render read-only and NO hidden inputs
// are emitted, so a manager's FormData never carries the rate fields and the
// server diff records no change. The server `update_payroll_rates` matrix
// call is the trust boundary that catches a hand-crafted manager POST.
//
// Mirrors <PayDeductionsSection>'s structure: a card section with its own
// eyebrow header and a stack of flush `.staff-panel-row` rows.

import { Banknote, Info, Percent, Receipt } from "lucide-react";

import { Input } from "@/components/ui/input";

import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";

export type PayrollRatesDraft = {
  /** Stored 0–1 fraction. The UI renders `pct × 100`. */
  serviceCommissionPct: number;
  /** Stored 0–1 fraction. The UI renders `pct × 100`. */
  tipSplitPct: number;
  /** Stored integer cents. The UI renders `cents / 100` dollars. */
  checkPortionCents: number;
};

export type PayrollRatesSectionProps = {
  target: Pick<RosterStaff, "id" | "display_name">;
  draft: PayrollRatesDraft;
  onDraftChange: (next: Partial<PayrollRatesDraft>) => void;
  /** Owner-only — false for a manager. Renders the inputs read-only and
   *  suppresses the hidden form inputs when false. */
  canEdit: boolean;
};

// Format a stored 0–1 fraction as a 0–100 UI string. Drops trailing zeros so
// 0.65 → "65", 0.125 → "12.5".
function fractionToPercentValue(fraction: number): string {
  const pct = fraction * 100;
  return Number.isFinite(pct) ? String(Number(pct.toFixed(4))) : "";
}

// Parse a 0–100 UI string back to a stored 0–1 fraction. Empty / non-numeric
// input parks at 0 in the draft; server-side validation is the trust boundary.
function percentValueToFraction(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n / 100 : 0;
}

// Format stored integer cents as a dollars UI string.
function centsToDollarsValue(cents: number): string {
  return Number.isFinite(cents) ? String(Number((cents / 100).toFixed(2))) : "";
}

// Parse a dollars UI string back to stored integer cents.
function dollarsValueToCents(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function PayrollRatesSection({
  target,
  draft,
  onDraftChange,
  canEdit,
}: PayrollRatesSectionProps) {
  const firstName = target.display_name.split(" ")[0] ?? target.display_name;

  const commissionValue = fractionToPercentValue(draft.serviceCommissionPct);
  const tipSplitValue = fractionToPercentValue(draft.tipSplitPct);
  const checkPortionValue = centsToDollarsValue(draft.checkPortionCents);

  return (
    <section className="payroll-rates-section" data-slot="payroll-rates-section">
      <div className="payroll-rates-section-header">
        <h3 className="payroll-rates-section-title">Payroll rates</h3>
      </div>

      {/* Service commission % — flush row, leading icon, percent input. */}
      <div className="staff-panel-row" data-slot="payroll-rates-commission-row">
        <span className="staff-panel-row-icon" aria-hidden="true">
          <Percent size={16} strokeWidth={1.5} />
        </span>
        <div className="staff-panel-row-text">
          <label htmlFor="payroll-rates-commission" className="staff-panel-row-label">
            Service commission
          </label>
          <p className="staff-panel-row-subtitle">Share of service income {firstName} keeps.</p>
        </div>
        <div className="payroll-rates-input-wrap" data-suffix="%">
          <Input
            id="payroll-rates-commission"
            data-slot="payroll-rates-commission-input"
            className="payroll-rates-input tabular-nums"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={1}
            value={commissionValue}
            onChange={(e) =>
              onDraftChange({ serviceCommissionPct: percentValueToFraction(e.target.value) })
            }
            readOnly={!canEdit}
            disabled={!canEdit}
            aria-label="Service commission percentage"
          />
        </div>
      </div>

      {/* Tip split % — flush row, leading icon, percent input. */}
      <div className="staff-panel-row" data-slot="payroll-rates-tip-split-row">
        <span className="staff-panel-row-icon" aria-hidden="true">
          <Banknote size={16} strokeWidth={1.5} />
        </span>
        <div className="staff-panel-row-text">
          <label htmlFor="payroll-rates-tip-split" className="staff-panel-row-label">
            Tip split
          </label>
          <p className="staff-panel-row-subtitle">Share of card tips {firstName} keeps.</p>
        </div>
        <div className="payroll-rates-input-wrap" data-suffix="%">
          <Input
            id="payroll-rates-tip-split"
            data-slot="payroll-rates-tip-split-input"
            className="payroll-rates-input tabular-nums"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={1}
            value={tipSplitValue}
            onChange={(e) => onDraftChange({ tipSplitPct: percentValueToFraction(e.target.value) })}
            readOnly={!canEdit}
            disabled={!canEdit}
            aria-label="Tip split percentage"
          />
        </div>
      </div>

      {/* Check portion — flush row, leading icon, dollars input. Last row in
        the section card → border-bottom suppressed. */}
      <div
        className="staff-panel-row staff-panel-row--last"
        data-slot="payroll-rates-check-portion-row"
      >
        <span className="staff-panel-row-icon" aria-hidden="true">
          <Receipt size={16} strokeWidth={1.5} />
        </span>
        <div className="staff-panel-row-text">
          <label htmlFor="payroll-rates-check-portion" className="staff-panel-row-label">
            Check portion
          </label>
          <p className="staff-panel-row-subtitle">Amount paid each period by check as W-2 wage.</p>
        </div>
        <div className="payroll-rates-input-wrap" data-prefix="$">
          <Input
            id="payroll-rates-check-portion"
            data-slot="payroll-rates-check-portion-input"
            className="payroll-rates-input payroll-rates-input--money tabular-nums"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={checkPortionValue}
            onChange={(e) =>
              onDraftChange({ checkPortionCents: dollarsValueToCents(e.target.value) })
            }
            readOnly={!canEdit}
            disabled={!canEdit}
            aria-label="Check portion in dollars"
          />
        </div>
      </div>

      {/* Hidden inputs — emitted ONLY for an owner. The UI percentage (0–100)
        and dollars values are submitted verbatim; `updateStaff` converts them
        to the stored 0–1 fraction / integer cents. Suppressing them for a
        manager keeps the rate fields out of a manager's FormData entirely. */}
      {canEdit ? (
        <>
          <input type="hidden" name="service_commission_pct" value={commissionValue} />
          <input type="hidden" name="tip_split_pct" value={tipSplitValue} />
          <input type="hidden" name="check_portion_cents" value={checkPortionValue} />
        </>
      ) : (
        <div className="payroll-rates-section-note" data-slot="payroll-rates-owner-only-note">
          <Info
            size={13}
            strokeWidth={1.5}
            aria-hidden="true"
            className="payroll-rates-section-note-icon"
          />
          <span>Only owners can change payroll rates.</span>
        </div>
      )}
    </section>
  );
}
