"use client";

// AddStaffButton — small client island that pairs the "Add staff" CTA with
// the wizard sheet. The button + sheet share a single `open` state owned
// here so the click handler can flip it without lifting the wizard into
// the page Server Component.
//
// Per Phase 4 execution rule #4: the previous US1 stub button inside
// `staff-table.client.tsx` is replaced by this component (see
// `staff-table.client.tsx` — the stub is removed and this island is
// rendered alongside the "Show inactive" toggle).
//
// All visual values resolve to Lacquer tokens — kept in sync with the
// US1 stub button's styling so the visual chrome doesn't shift between
// stub and live state.

import { useState } from "react";

import { Plus } from "lucide-react";

import { AddStaffWizard } from "@/components/lacquer/staff/add-staff-wizard.lazy";
import type { StudioRole } from "@/app/(studio)/settings/staff/permissions";

export type AddStaffButtonProps = {
  /** Operator's role — forwarded to the wizard for `roleOptionsFor`. */
  operatorRole: StudioRole;
};

export function AddStaffButton({ operatorRole }: AddStaffButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-slot="add-staff-button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
          transition: "opacity 150ms var(--ease-out)",
        }}
      >
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        Add staff
      </button>
      <AddStaffWizard operatorRole={operatorRole} open={open} onOpenChange={setOpen} />
    </>
  );
}
