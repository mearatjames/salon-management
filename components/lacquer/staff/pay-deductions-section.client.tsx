"use client";

// PayDeductionsSection — the new "Pay & deductions" section inside the
// staff edit panel (specs/023-staff-payout-exemptions).
//
// US1 shipped the Card processing fee row. US2 (this commit) appends the
// Supply deductions row + per-type picker + empty/warning states. US3 will
// append the summary sentence + front-desk hint. The component is mounted
// once by `<EditPanel>` and re-keyed alongside it on every row switch (so
// drafts are discarded per FR-022).
//
// The Switch UX for Card fee is "Card processing fee ON / OFF" — ON = "fee
// applies" = `card_fee_exempt === false`. Flipping the switch OFF sets
// `cardFeeExempt = true`. The hidden input mirrors the legacy `name="active"`
// pattern in `edit-panel.client.tsx` so the `updateStaff` Server Action picks
// up the value as `formData.get('card_fee_exempt') === 'on'`.
//
// Supply deductions: a shadcn ToggleGroup with three options (`apply` |
// `partial` | `exempt`). When `partial` is selected the per-type picker
// renders. `setSupplyMode(next)` MUST NOT clear `draft.supplyExcept` per
// Clarify Q4 (draft preservation — switching to Apply all + back to Some
// restores the prior ticks without a save round-trip). The save action
// wipes the persisted set server-side when the saved mode is not 'partial'
// (handled in `updateStaff` per T016).

import Link from "next/link";
import { CreditCard, Info, Package } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDefaultCardFeeLabel } from "@/lib/services/card-fee-default";
import { formatFrontDeskHint, formatSummary } from "@/app/(studio)/settings/staff/_summary";

import type { RosterStaff, StaffSupplyMode } from "@/app/(studio)/settings/staff/_types";
import type { SupplyCatalogForStaff } from "@/app/(studio)/settings/staff/_supply-catalog";

export type PayDeductionsDraft = {
  cardFeeExempt: boolean;
  supplyMode: StaffSupplyMode;
  /** Set of supply_type ids the operator wants exempted. Lives in draft
   *  state even when mode !== 'partial' so switching Some → Apply all → Some
   *  restores ticks per Clarify Q4. The save action clears the persisted
   *  set server-side when the saved mode is not 'partial' (T016). */
  supplyExcept: readonly string[];
};

export type PayDeductionsSectionProps = {
  /** The persisted staff row. US3 reads `target.display_name` for the
   *  first-name interpolation in the summary sentence + `target.role` for
   *  the front-desk hint precedence rule. */
  target: Pick<RosterStaff, "id" | "display_name" | "role">;
  /** Supply-types catalog scoped to this staff. Iterated by the per-type
   *  picker; pre-filtered server-side to non-archived + currently-exempted
   *  ids (Clarify Q3) and ordered by name. */
  supplyCatalog: SupplyCatalogForStaff;
  draft: PayDeductionsDraft;
  onDraftChange: (next: Partial<PayDeductionsDraft>) => void;
  /** Mirrors `!perms.canEditAnyField` from EditPanel — disables every control
   *  in the section when the operator can't edit any field of this target. */
  disabled?: boolean;
};

function supplyModeSubtitle(mode: StaffSupplyMode, firstName: string): string {
  switch (mode) {
    case "apply":
      return "Per-service supply cost deducted from payout when configured.";
    case "partial":
      return `Apply most supply costs, but exempt ${firstName} from specific types.`;
    case "exempt":
      return "Exempt — no supply costs ever deducted, on any service.";
  }
}

export function PayDeductionsSection({
  target,
  supplyCatalog,
  draft,
  onDraftChange,
  disabled,
}: PayDeductionsSectionProps) {
  const firstName = target.display_name.split(" ")[0] ?? target.display_name;
  const cardFeeSubtitle = draft.cardFeeExempt
    ? "Exempt — card fee never deducted from payout."
    : `Standard ${formatDefaultCardFeeLabel()} deducted on card-paid services.`;
  const supplyRowSubtitle = supplyModeSubtitle(draft.supplyMode, firstName);

  return (
    <section className="pay-deductions-section" data-slot="pay-deductions-section">
      <div className="pay-deductions-section-header">
        <h3 className="pay-deductions-section-title">Pay &amp; deductions</h3>
      </div>

      {/* Card processing fee row — flush, leading icon, switch on the right. */}
      <div className="staff-panel-row" data-slot="pay-deductions-card-fee-row">
        <span className="staff-panel-row-icon" aria-hidden="true">
          <CreditCard size={16} strokeWidth={1.5} />
        </span>
        <div className="staff-panel-row-text">
          <label htmlFor="pay-deductions-card-fee" className="staff-panel-row-label">
            Card processing fee
          </label>
          <p className="staff-panel-row-subtitle">{cardFeeSubtitle}</p>
        </div>
        <Switch
          id="pay-deductions-card-fee"
          data-slot="pay-deductions-card-fee-switch"
          // ON = fee applies; OFF = exempt. Inverted from the underlying
          // `card_fee_exempt` boolean so the visible UX matches the label.
          checked={!draft.cardFeeExempt}
          onCheckedChange={(next: boolean) => onDraftChange({ cardFeeExempt: !next })}
          disabled={disabled}
          aria-label="Card processing fee"
        />
      </div>

      {/* Hidden input — the updateStaff action reads
        `formData.get('card_fee_exempt') === 'on'`. */}
      <input type="hidden" name="card_fee_exempt" value={draft.cardFeeExempt ? "on" : ""} />

      {/* Supply deductions row — flush, leading icon, segmented control inline
        on the right (wraps below on narrow widths per canonical prototype).
        Border-bottom: present in apply/exempt (where supply row IS the last
        row); absent in partial (the picker zone below has its own border-top
        and supplies the visual break — canonical line 563). */}
      <div
        className={`staff-panel-row staff-panel-row--wrap ${
          draft.supplyMode === "partial" ? "staff-panel-row--last" : ""
        }`}
        data-slot="pay-deductions-supply-row"
      >
        <span className="staff-panel-row-icon" aria-hidden="true">
          <Package size={16} strokeWidth={1.5} />
        </span>
        <div className="staff-panel-row-text">
          <span className="staff-panel-row-label">Supply deductions</span>
          <p className="staff-panel-row-subtitle">{supplyRowSubtitle}</p>
        </div>
        <ToggleGroup
          type="single"
          value={draft.supplyMode}
          onValueChange={(next: string) => {
            // shadcn's ToggleGroup with `type="single"` fires with empty
            // string on deselect; guard against that. Per Clarify Q4 this
            // MUST NOT clear `draft.supplyExcept` — only the save action's
            // submitted FormData wipes them server-side when saved mode ≠ partial.
            if (next === "apply" || next === "partial" || next === "exempt") {
              onDraftChange({ supplyMode: next });
            }
          }}
          disabled={disabled}
          className="pay-deductions-segmented"
          data-slot="pay-deductions-supply-mode-toggle"
        >
          <ToggleGroupItem
            value="apply"
            data-value="apply"
            aria-label="Apply all supply deductions"
          >
            Apply all
          </ToggleGroupItem>
          <ToggleGroupItem
            value="partial"
            data-value="partial"
            aria-label="Some supply types exempt"
          >
            Some
          </ToggleGroupItem>
          <ToggleGroupItem
            value="exempt"
            data-value="exempt"
            aria-label="Exempt from all supply deductions"
          >
            Exempt
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Hidden input for supply_mode — single value; the action reads it via
        `formData.get('supply_mode')`. */}
      <input type="hidden" name="supply_mode" value={draft.supplyMode} />

      {/* ── Per-type picker (US2) ────────────────────────────────────────
        Renders only when the current draft mode is 'partial'. The picker
        itself owns the empty-catalog row and the "no types ticked" warning
        hint. Multiple hidden `supply_except` inputs are emitted regardless
        of mode (one per ticked id); the server wipes the set when saved
        mode ≠ partial so leftover ticks from a draft round-trip never
        persist. */}
      {draft.supplyMode === "partial" ? (
        <div className="pay-deductions-picker-zone" data-slot="pay-deductions-picker-zone">
          <div className="pay-deductions-picker-eyebrow">
            Exempt {firstName} from these supply types
          </div>
          <div className="pay-deductions-picker" data-slot="pay-deductions-picker">
            {supplyCatalog.types.length === 0 ? (
              <div className="pay-deductions-picker-empty" data-slot="pay-deductions-picker-empty">
                No supply types defined yet. Add some on the{" "}
                <Link href="/services">Services page</Link> first.
              </div>
            ) : (
              <>
                {supplyCatalog.types.map((type) => {
                  const isTicked = draft.supplyExcept.includes(type.id);
                  const serviceWord = type.service_count === 1 ? "service" : "services";
                  const usageHint =
                    type.service_count === 0
                      ? "Unused — no services reference this type yet."
                      : `${type.service_count} ${serviceWord} · typically $${(
                          (type.sample_amount_cents ?? 0) / 100
                        ).toFixed(2)} per ticket`;
                  return (
                    <label
                      key={type.id}
                      htmlFor={`pay-deductions-picker-${type.id}`}
                      className="pay-deductions-picker-row"
                      data-slot="pay-deductions-picker-row"
                      data-name={type.name}
                      data-checked={isTicked ? "true" : "false"}
                    >
                      <Checkbox
                        id={`pay-deductions-picker-${type.id}`}
                        data-slot="pay-deductions-picker-checkbox"
                        checked={isTicked}
                        onCheckedChange={(checked) => {
                          // Radix Checkbox can emit `"indeterminate"` — we
                          // only care about boolean transitions here.
                          const isCheckedBool = checked === true;
                          const next = isCheckedBool
                            ? [...draft.supplyExcept, type.id]
                            : draft.supplyExcept.filter((id) => id !== type.id);
                          onDraftChange({ supplyExcept: next });
                        }}
                        disabled={disabled}
                        aria-label={type.name}
                      />
                      <div className="pay-deductions-picker-row-text">
                        <span className="pay-deductions-picker-row-name">
                          {type.name}
                          {type.archived ? (
                            <span className="staff-archived-pill" data-slot="staff-archived-pill">
                              Archived
                            </span>
                          ) : null}
                        </span>
                        <span className="pay-deductions-picker-row-hint">{usageHint}</span>
                      </div>
                      {isTicked ? (
                        <span
                          className="pay-deductions-picker-row-exempt-pill"
                          data-slot="pay-deductions-picker-row-exempt-pill"
                        >
                          Exempt
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </>
            )}
          </div>
          {draft.supplyExcept.length === 0 && supplyCatalog.types.length > 0 ? (
            <p className="pay-deductions-picker-hint" data-slot="pay-deductions-picker-hint">
              No supply types selected — all costs will be deducted normally until you tick at least
              one.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Hidden inputs for supply_except — one per ticked id. The action
        reads `formData.getAll('supply_except')`. Emit unconditionally so a
        save with mode=partial + 0 ticks submits an empty list (the action
        validates against the canonical allowed-ids set per FR-012). */}
      {draft.supplyExcept.map((id) => (
        <input key={id} type="hidden" name="supply_except" value={id} />
      ))}

      {/* ── US3 summary sentence + front-desk hint ───────────────────────
        Rendered as `.section-note` per canonical staff-components.jsx:
        muted bg + top border + leading Info icon + body text. Front-desk
        hint takes precedence when role is front_desk AND no exemptions are
        configured. */}
      {(() => {
        const noExemptions =
          !draft.cardFeeExempt && draft.supplyMode === "apply" && draft.supplyExcept.length === 0;

        if (target.role === "front_desk" && noExemptions) {
          return (
            <div className="pay-deductions-section-note" data-slot="pay-deductions-front-desk-hint">
              <Info
                size={13}
                strokeWidth={1.5}
                aria-hidden="true"
                className="pay-deductions-section-note-icon"
              />
              <span>{formatFrontDeskHint()}</span>
            </div>
          );
        }

        const exemptedTypeNames = draft.supplyExcept
          .map((id) => supplyCatalog.types.find((t) => t.id === id)?.name)
          .filter((n): n is string => Boolean(n));

        const summary = formatSummary({
          firstName,
          cardExempt: draft.cardFeeExempt,
          supplyMode: draft.supplyMode,
          exemptedTypeNames,
        });

        if (!summary) return null;
        return (
          <div className="pay-deductions-section-note" data-slot="pay-deductions-summary">
            <Info
              size={13}
              strokeWidth={1.5}
              aria-hidden="true"
              className="pay-deductions-section-note-icon"
            />
            <span>{summary}</span>
          </div>
        );
      })()}
    </section>
  );
}
