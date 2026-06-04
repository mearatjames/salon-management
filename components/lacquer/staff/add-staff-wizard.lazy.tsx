"use client";

// Lazy entry point for the add-staff wizard (issue #204).
//
// The wizard (`add-staff-wizard.client.tsx`, ~617 lines) is imported by two
// call sites — `add-staff-button.client.tsx` (desktop header) and
// `staff-fab.client.tsx` (mobile FAB) — but only one renders per breakpoint,
// and neither is part of first paint. Both call sites render the wizard
// *always* (controlled by an `open` prop), so a bare `next/dynamic` import
// would still pull the chunk in on mount. This wrapper gates the dynamic
// mount on a first-open latch: nothing loads until the operator actually
// opens the wizard once, after which it stays mounted so Radix can play the
// close animation.

import { useState } from "react";

import dynamic from "next/dynamic";

import type { AddStaffWizardProps } from "@/components/lacquer/staff/add-staff-wizard.client";

const AddStaffWizardImpl = dynamic(
  () => import("@/components/lacquer/staff/add-staff-wizard.client").then((m) => m.AddStaffWizard),
  { ssr: false, loading: () => null }
);

export type { AddStaffWizardProps };

export function AddStaffWizard(props: AddStaffWizardProps) {
  // First-open latch. `open` flips to true on the operator's click; once it
  // has been true we keep the impl mounted so the close transition runs.
  // Adjusting state during render (not in an effect) is the React-blessed
  // way to derive this and keeps the no-setState-in-effect lint happy.
  const [hasOpened, setHasOpened] = useState(false);
  if (props.open && !hasOpened) {
    setHasOpened(true);
  }

  if (!hasOpened) return null;
  return <AddStaffWizardImpl {...props} />;
}
