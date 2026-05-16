"use client";

// OnboardCtaSheet — tiny client island holding the hero "Onboard user"
// button + the sheet's open state. The parent page is an RSC; this island
// lets the button be interactive without converting the whole hero or page
// to a client component.

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { OnboardSheet } from "./onboard-sheet.client";

export function OnboardCtaSheet() {
  const [open, setOpen] = useState(false);
  return (
    <div data-slot="onboard-cta">
      <button
        type="button"
        className="onb-cta-btn"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <UserPlus size={16} strokeWidth={1.5} aria-hidden />
        Onboard user
      </button>
      <OnboardSheet open={open} onOpenChange={setOpen} />
    </div>
  );
}
