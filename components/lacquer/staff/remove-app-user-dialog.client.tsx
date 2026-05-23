"use client";

// RemoveAppUserDialog — rich confirm dialog for the app-user branch of
// Settings → Staff "Remove from roster" (issue #129). Mirrors the ceremony
// of Onboarding's <RemoveSheet>: an ack checkbox + a typed-name confirm
// gate the destructive submit, and the impact list spells out the
// consequences so the operator goes in eyes-open.
//
// Why two client-side gates (the server re-validates the same two):
//
//   - The destructive submit deletes the Supabase auth user, anonymizes
//     the staff row, and frees the email for re-invite. That's the same
//     gravity as Onboarding's `removeUser`, which uses two acks + a typed
//     name. The Staff-side cost is the same — keep the friction matched.
//   - The matching dialog ceremony on both pages also means the operator
//     learns one pattern, not two.
//
// PIN-only targets keep the existing single-confirm <ConfirmDialog> in
// `danger-zone.client.tsx` — no auth user / email to free, no anonymize.

import { AlertTriangle, Ban, Check as CheckIcon, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { removeStaff } from "@/app/(studio)/settings/staff/actions";
import { roleLabel } from "@/components/lacquer/staff/initials";

import type { StudioRole } from "@/lib/auth/session";

export type RemoveAppUserDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  target: {
    id: string;
    display_name: string;
    email: string | null;
    role: StudioRole;
    color_token: string;
  };
};

export function RemoveAppUserDialog({ open, onOpenChange, target }: RemoveAppUserDialogProps) {
  const [ack, setAck] = useState(false);
  const [typedName, setTypedName] = useState("");

  const typedOk = useMemo(
    () => typedName.trim().toLowerCase() === target.display_name.trim().toLowerCase(),
    [typedName, target.display_name]
  );

  const canSubmit = ack && typedOk;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setAck(false);
        setTypedName("");
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-slot="remove-app-user-dialog"
        data-target-id={target.id}
        className="onb-remove-sheet flex flex-col gap-0 p-0 sm:max-w-[480px]"
      >
        <DialogHeader className="onb-remove-header">
          <div className="onb-remove-eyebrow">
            <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />
            Permanently remove
          </div>
          <DialogTitle>Remove {target.display_name}</DialogTitle>
          <DialogDescription className="onb-remove-sub">
            This deletes their account, anonymizes their record as &ldquo;Former staff&rdquo;, and
            frees their email for future re-invite.{" "}
            <strong className="onb-remove-strong">This can&apos;t be undone.</strong>
          </DialogDescription>

          <div className="onb-remove-person-card" data-slot="remove-app-user-person-card">
            <InitialsAvatar name={target.display_name} colorToken={target.color_token} size={40} />
            <div className="onb-remove-person-text">
              <div className="onb-remove-person-name">{target.display_name}</div>
              <div className="onb-remove-person-meta">
                {roleLabel(target.role)} · {target.email ?? "No email"}
              </div>
            </div>
          </div>
        </DialogHeader>

        <form action={removeStaff} className="onb-remove-form">
          <input type="hidden" name="staff_id" value={target.id} />
          <input
            type="hidden"
            name="ack"
            value={ack ? "on" : ""}
            data-slot="remove-app-user-ack-hidden"
          />
          <input
            type="hidden"
            name="confirm_name"
            value={typedName}
            data-slot="remove-app-user-confirm-name-hidden"
          />

          <div className="onb-remove-body">
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
                      Their Supabase user is removed. Email becomes free to re-invite.
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
                  <label className="onb-remove-ack-row" data-checked={ack ? "true" : "false"}>
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      data-slot="remove-app-user-ack"
                      className="onb-remove-ack-checkbox"
                    />
                    <span className="onb-remove-ack-text">
                      I understand: their access is revoked, history is preserved as &ldquo;Former
                      staff #N&rdquo;, and their email is freed for future re-invite.
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
                data-slot="remove-app-user-typed-name"
                placeholder={target.display_name}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-state={typedName.length === 0 ? "empty" : typedOk ? "ok" : "bad"}
              />
            </section>
          </div>

          <DialogFooter className="onb-sheet-footer">
            <button
              type="button"
              className="onb-btn onb-btn-outline"
              data-slot="remove-app-user-cancel"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="onb-btn onb-btn-destructive"
              data-slot="remove-app-user-confirm"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              Remove from roster
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
