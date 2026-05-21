"use client";

// RemoveSheet — hard remove (irreversible, anonymizes). Right-side shadcn Sheet.
// Adapted from `design-system/prototypes/onboarding/RemoveSheet.jsx`.
//
// Three client-side gates mirror the server gates in `removeUser`:
//   1. ack_history checkbox
//   2. ack_irreversible checkbox
//   3. typed-name input === target.display_name (case-insensitive, trimmed)
//
// The destructive submit stays disabled until all three pass. The check is
// UX only — the server is the trust boundary and re-validates the same
// three gates in the same first-fail order (see actions.ts § removeUser).
//
// Last-owner edge mirrors OffboardSheet: when `isLastOwner` is true the
// destructive button is disabled and an inline alert appears at the top of
// the sheet body ("Promote another owner first.").

import { AlertTriangle, Ban, Check as CheckIcon, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { roleLabel } from "@/components/lacquer/staff/initials";
import { removeUser } from "@/app/(studio)/settings/onboarding/actions";

export type RemoveSheetTarget = {
  id: string;
  display_name: string;
  email: string | null;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
};

export type RemoveSheetProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  target: RemoveSheetTarget;
  /** True when the target is the only remaining active owner. */
  isLastOwner: boolean;
};

export function RemoveSheet({ open, onOpenChange, target, isLastOwner }: RemoveSheetProps) {
  const [ackHistory, setAckHistory] = useState(false);
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [typedName, setTypedName] = useState("");

  const typedOk = useMemo(
    () => typedName.trim().toLowerCase() === target.display_name.trim().toLowerCase(),
    [typedName, target.display_name]
  );

  const canRemove = ackHistory && ackIrreversible && typedOk && !isLastOwner;

  // Reset state when the sheet closes so a re-open starts clean.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setAckHistory(false);
        setAckIrreversible(false);
        setTypedName("");
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-slot="remove-sheet"
        className="onb-remove-sheet flex flex-col gap-0 p-0 sm:max-w-[480px]"
      >
        <SheetHeader className="onb-remove-header">
          <div className="onb-remove-eyebrow">
            <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />
            Permanently remove
          </div>
          <SheetTitle>Remove {target.display_name}</SheetTitle>
          <SheetDescription className="onb-remove-sub">
            This deletes their account and anonymizes their record. Past tickets stay in the books,
            but the name is replaced with &ldquo;Former staff&rdquo;.{" "}
            <strong className="onb-remove-strong">This can&apos;t be undone.</strong>
          </SheetDescription>

          <div className="onb-remove-person-card" data-slot="remove-person-card">
            <InitialsAvatar name={target.display_name} colorToken={target.color_token} size={40} />
            <div className="onb-remove-person-text">
              <div className="onb-remove-person-name">{target.display_name}</div>
              <div className="onb-remove-person-meta">
                {roleLabel(target.role)} · {target.email ?? "No email"}
              </div>
            </div>
            <span className="onb-status onb-status-offboard">
              <span className="dot" aria-hidden />
              Offboarded
            </span>
          </div>
        </SheetHeader>

        <form action={removeUser} className="onb-remove-form">
          <input type="hidden" name="staff_id" value={target.id} />
          <input
            type="hidden"
            name="ack_history"
            value={ackHistory ? "on" : ""}
            data-slot="remove-ack-history-hidden"
          />
          <input
            type="hidden"
            name="ack_irreversible"
            value={ackIrreversible ? "on" : ""}
            data-slot="remove-ack-irreversible-hidden"
          />
          <input
            type="hidden"
            name="confirm_name"
            value={typedName}
            data-slot="remove-confirm-name-hidden"
          />

          <div className="onb-remove-body">
            {isLastOwner && (
              <div
                className="onb-alert-last-owner"
                role="alert"
                data-slot="remove-last-owner-alert"
              >
                Promote another owner first.
              </div>
            )}

            <section className="onb-remove-section">
              <div className="onb-remove-section-label">What happens</div>
              <ul className="onb-remove-impact-list" role="list">
                <li className="onb-remove-impact-row" data-tone="danger">
                  <span className="onb-remove-impact-icon" aria-hidden>
                    <Trash2 size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-remove-impact-text">
                    <div className="onb-remove-impact-title">Account deleted</div>
                    <div className="onb-remove-impact-sub">
                      Their Supabase user is removed. Email becomes free to reuse.
                    </div>
                  </div>
                </li>
                <li className="onb-remove-impact-row" data-tone="danger">
                  <span className="onb-remove-impact-icon" aria-hidden>
                    <Ban size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-remove-impact-text">
                    <div className="onb-remove-impact-title">Staff record anonymized</div>
                    <div className="onb-remove-impact-sub">
                      Name and email replaced with &ldquo;Former staff&rdquo;. Avatar reset to
                      slate.
                    </div>
                  </div>
                </li>
                <li className="onb-remove-impact-row" data-tone="keep">
                  <span className="onb-remove-impact-icon" aria-hidden>
                    <CheckIcon size={16} strokeWidth={1.5} />
                  </span>
                  <div className="onb-remove-impact-text">
                    <div className="onb-remove-impact-title">Past tickets stay</div>
                    <div className="onb-remove-impact-sub">
                      Revenue, refunds, and tip allocations remain on the books — just unattributed.
                    </div>
                  </div>
                </li>
              </ul>
            </section>

            <section className="onb-remove-section">
              <div className="onb-remove-section-label">Acknowledge</div>
              <ul className="onb-remove-ack-list" role="list">
                <li>
                  <label
                    className="onb-remove-ack-row"
                    data-checked={ackHistory ? "true" : "false"}
                  >
                    <input
                      type="checkbox"
                      checked={ackHistory}
                      onChange={(e) => setAckHistory(e.target.checked)}
                      data-slot="remove-ack-history"
                      className="onb-remove-ack-checkbox"
                    />
                    <span className="onb-remove-ack-text">
                      I understand past tickets will be attributed to an anonymized &ldquo;Former
                      staff #N&rdquo; placeholder.
                    </span>
                  </label>
                </li>
                <li>
                  <label
                    className="onb-remove-ack-row"
                    data-checked={ackIrreversible ? "true" : "false"}
                  >
                    <input
                      type="checkbox"
                      checked={ackIrreversible}
                      onChange={(e) => setAckIrreversible(e.target.checked)}
                      data-slot="remove-ack-irreversible"
                      className="onb-remove-ack-checkbox"
                    />
                    <span className="onb-remove-ack-text">
                      I understand this can&apos;t be undone.
                    </span>
                  </label>
                </li>
              </ul>
            </section>

            <section className="onb-remove-section">
              <div className="onb-remove-section-label">
                To confirm, type <strong>{target.display_name}</strong> below
              </div>
              <input
                type="text"
                className="onb-remove-typed-name"
                data-slot="remove-typed-name"
                placeholder={target.display_name}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-state={typedName.length === 0 ? "empty" : typedOk ? "ok" : "bad"}
              />
            </section>
          </div>

          <div className="onb-sheet-footer">
            <button
              type="button"
              className="onb-btn onb-btn-outline"
              data-slot="remove-cancel"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="onb-btn onb-btn-destructive"
              data-slot="remove-confirm"
              disabled={!canRemove}
              aria-disabled={!canRemove}
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              Permanently remove
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
