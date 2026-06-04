"use client";

// StaffFab — mobile-only floating Action Button pinned to the lower-right.
// Phase 10 / US8 of feature 023-staff-payout-exemptions.
//
// Renders its own `<AddStaffWizard>` instance with independent open state.
// At ≥900px the FAB is `display: none` and the desktop "Add staff" header
// button (via `<AddStaffButton>`) is the only entry point; at <900px the
// header button collapses out (also via CSS) and the FAB takes over.
// Wiring two independent wizard instances is intentional — they cannot be
// both visible at the same time, so there is no risk of competing state,
// and avoiding lifted state keeps the page Server Component untouched.
//
// All visual values resolve to Lacquer tokens — the `.staff-fab` class in
// `styles/settings.css` carries the position, size, color, shadow, and
// hover transition; this file only owns the trigger gesture and the wizard
// instance.

import { useState } from "react";

import { Plus } from "lucide-react";

import { AddStaffWizard } from "@/components/lacquer/staff/add-staff-wizard.lazy";
import type { StudioRole } from "@/app/(studio)/settings/staff/permissions";

export type StaffFabProps = {
  /** Operator's role — forwarded to the wizard for `roleOptionsFor`. */
  operatorRole: StudioRole;
};

export function StaffFab({ operatorRole }: StaffFabProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="staff-fab"
        data-component="staff-fab"
        aria-label="Add staff"
        onClick={() => setOpen(true)}
      >
        <Plus size={24} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <AddStaffWizard operatorRole={operatorRole} open={open} onOpenChange={setOpen} />
    </>
  );
}
