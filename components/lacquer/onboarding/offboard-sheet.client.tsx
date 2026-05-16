"use client";

// OffboardSheet — soft offboard (reversible). Right-side shadcn Sheet.
// Adapted from `design-system/prototypes/onboarding/OffboardSheet.jsx`.
//
// The destructive button is always enabled (the sheet itself IS the
// confirmation). Reason is OPTIONAL — clicking the same chip twice clears
// it. Last-owner edge: when `isLastOwner` is true the destructive button is
// disabled and an inline alert appears at the top of the sheet body.
//
// Submit binds to `offboardUser`. On success the action redirects with
// `?toast=offboarded&name=…` — the OnboardingToaster fires the success
// toast and the row jumps to the Offboarded section on the same paint.

import { Archive, EyeOff, LogOut, RefreshCcw, Check as CheckIcon } from "lucide-react";
import { useCallback, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StaffAvatar } from "@/components/lacquer/staff/staff-avatar";
import { roleLabel } from "@/components/lacquer/staff/initials";
import { offboardUser } from "@/app/(studio)/settings/onboarding/actions";

import type { OffboardReason } from "@/app/(studio)/settings/onboarding/_types";

const REASONS: ReadonlyArray<OffboardReason> = [
  "Left the salon",
  "On extended leave",
  "Role change",
  "Performance",
  "Other",
];

export type OffboardSheetTarget = {
  id: string;
  display_name: string;
  email: string | null;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
};

export type OffboardSheetProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  target: OffboardSheetTarget;
  /** True when the target is the only remaining active owner. */
  isLastOwner: boolean;
};

export function OffboardSheet({ open, onOpenChange, target, isLastOwner }: OffboardSheetProps) {
  const [reason, setReason] = useState<OffboardReason | null>(null);

  const firstName = target.display_name.trim().split(" ")[0] || target.display_name;

  // Reset reason when the sheet closes so a re-open starts clean.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setReason(null);
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-slot="offboard-sheet"
        className="flex flex-col gap-0 p-0 sm:max-w-[480px]"
      >
        <SheetHeader className="onb-offb-header">
          <SheetTitle>Offboard {target.display_name}</SheetTitle>
          <SheetDescription className="sr-only">
            Revoke {firstName}&apos;s login, hide them from the picker, preserve their history.
            Reversible later.
          </SheetDescription>

          <div className="onb-offb-person-card" data-slot="offb-person-card">
            <StaffAvatar name={target.display_name} colorToken={target.color_token} size={40} />
            <div className="onb-offb-person-text">
              <div className="onb-offb-person-name">{target.display_name}</div>
              <div className="onb-offb-person-meta">
                {roleLabel(target.role)} · {target.email ?? "—"}
              </div>
            </div>
            <span className="onb-status onb-status-active">
              <span className="dot" aria-hidden />
              Active
            </span>
          </div>
        </SheetHeader>

        <form action={offboardUser} className="onb-offb-form">
          <input type="hidden" name="staff_id" value={target.id} />
          <input type="hidden" name="reason" value={reason ?? ""} />

          <div className="onb-offb-body">
            {isLastOwner && (
              <div className="onb-alert-last-owner" role="alert" data-slot="offb-last-owner-alert">
                Promote another owner first.
              </div>
            )}

            <section className="onb-offb-section">
              <div className="onb-offb-section-label">What happens</div>
              <ul className="onb-offb-checklist" role="list">
                <li className="onb-offb-checkrow" data-tone="revoke">
                  <span className="onb-offb-checkrow-icon" aria-hidden>
                    <LogOut size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-offb-checkrow-text">
                    <div className="onb-offb-checkrow-title">Email login revoked</div>
                    <div className="onb-offb-checkrow-sub">
                      Their email + password / magic link stops working immediately.
                    </div>
                  </div>
                </li>
                <li className="onb-offb-checkrow" data-tone="revoke">
                  <span className="onb-offb-checkrow-icon" aria-hidden>
                    <EyeOff size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-offb-checkrow-text">
                    <div className="onb-offb-checkrow-title">Hidden from the login picker</div>
                    <div className="onb-offb-checkrow-sub">
                      They won&apos;t appear on shared iPads. Their PIN is cleared.
                    </div>
                  </div>
                </li>
                <li className="onb-offb-checkrow" data-tone="keep">
                  <span className="onb-offb-checkrow-icon" aria-hidden>
                    <CheckIcon size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-offb-checkrow-text">
                    <div className="onb-offb-checkrow-title">History stays</div>
                    <div className="onb-offb-checkrow-sub">
                      Past appointments, payments, and tip splits are unchanged.
                    </div>
                  </div>
                </li>
                <li className="onb-offb-checkrow" data-tone="keep">
                  <span className="onb-offb-checkrow-icon" aria-hidden>
                    <RefreshCcw size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-offb-checkrow-text">
                    <div className="onb-offb-checkrow-title">Reversible</div>
                    <div className="onb-offb-checkrow-sub">
                      Reactivate from the Offboarded list — invite re-issued, PIN reset.
                    </div>
                  </div>
                </li>
              </ul>
            </section>

            <section className="onb-offb-section">
              <div className="onb-offb-section-label">
                Reason <span className="onb-offb-section-hint">(optional)</span>
              </div>
              <div className="onb-offb-reason-grid" role="radiogroup" aria-label="Offboard reason">
                {REASONS.map((r) => {
                  const selected = reason === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-slot="offb-reason-chip"
                      data-reason={r}
                      data-selected={selected ? "true" : "false"}
                      className="onb-offb-reason-chip"
                      onClick={() => setReason(selected ? null : r)}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              <div className="onb-form-hint">Logged in the audit trail. Only owners see it.</div>
            </section>
          </div>

          <div className="onb-sheet-footer">
            <button
              type="button"
              className="onb-btn onb-btn-outline"
              data-slot="offb-cancel"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="onb-btn onb-btn-destructive"
              data-slot="offb-confirm"
              disabled={isLastOwner}
              aria-disabled={isLastOwner}
            >
              <Archive size={16} strokeWidth={1.5} aria-hidden />
              Offboard {firstName}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
