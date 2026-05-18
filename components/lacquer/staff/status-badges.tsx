// StatusBadges — pure render component for the staff edit panel header.
//
// US3 (specs/023-staff-payout-exemptions) replaces the US1/US2 inline minimal
// badge spans in `edit-panel.client.tsx` with this single component. Renders:
//   - Always-on Active / Inactive chip (tinted via --success / --muted-foreground)
//   - Conditional Card-fee exempt chip (warning tint, US1)
//   - Conditional Supply-exempt chip (secondary tint, US2)
//   - Conditional Partial supply exemption chip (secondary tint, US2)
//
// Pure component — no hooks, no side effects, no draft access. The caller
// (EditPanel) passes draft state so the badges update live before save per
// FR-016. Lucide icons sized 14 / 1.5px stroke per Constitution I § Icons.

import { Check, Layers, Power, Shield } from "lucide-react";

import type { StaffSupplyMode } from "@/app/(studio)/settings/staff/_types";

export type StatusBadgesProps = {
  active: boolean;
  cardFeeExempt: boolean;
  supplyMode: StaffSupplyMode;
};

export function StatusBadges({ active, cardFeeExempt, supplyMode }: StatusBadgesProps) {
  return (
    <div className="staff-status-badges" data-slot="staff-status-badges">
      <span
        className={
          active
            ? "staff-status-badge staff-status-badge--active"
            : "staff-status-badge staff-status-badge--inactive"
        }
        data-slot="staff-status-badge-active"
      >
        {active ? (
          <Check size={14} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Power size={14} strokeWidth={1.5} aria-hidden="true" />
        )}
        {active ? "Active" : "Inactive"}
      </span>
      {cardFeeExempt ? (
        <span
          className="staff-status-badge staff-status-badge--card-fee-exempt"
          data-slot="staff-status-badge-card-fee-exempt"
        >
          <Shield size={14} strokeWidth={1.5} aria-hidden="true" />
          Card-fee exempt
        </span>
      ) : null}
      {supplyMode === "exempt" ? (
        <span
          className="staff-status-badge staff-status-badge--supply-exempt"
          data-slot="staff-status-badge-supply-exempt"
        >
          <Layers size={14} strokeWidth={1.5} aria-hidden="true" />
          Supply-exempt
        </span>
      ) : null}
      {supplyMode === "partial" ? (
        <span
          className="staff-status-badge staff-status-badge--partial-supply"
          data-slot="staff-status-badge-partial-supply"
        >
          <Layers size={14} strokeWidth={1.5} aria-hidden="true" />
          Partial supply exemption
        </span>
      ) : null}
    </div>
  );
}
