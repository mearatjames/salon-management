"use client";

// DangerZone — destructive lifecycle actions for the staff edit panel.
// Composes Deactivate (or Reactivate, depending on `targetActive`) + Remove
// from roster inside a tinted container that is visually distinct from the
// neutral section cards in the panel.
//
// US6 (specs/023-staff-payout-exemptions) moved these buttons out of the
// previously-shared `<footer>` in `edit-panel.client.tsx` so the panel
// surface has ONE place where destructive actions live. The
// `data-destructive="true"` attribute on each button is the FR-028
// enforcement seam — the e2e in `staff-panel-structure.spec.ts` asserts no
// element carrying that attribute lives outside `[data-section="danger-zone"]`.
//
// Reactivate is single-click (no confirm dialog) per ui.contract.md § Dialog
// strings — only the destructive variants (Deactivate + Remove) gate behind
// a `<ConfirmDialog>`. The reactivate path renders a hidden sibling `<form>`
// whose id is referenced by the button's `form=` attribute so Submit fires
// the right Server Action without nesting forms (invalid HTML).
//
// Issue #129 — Remove now branches on target identity:
//
//   - PIN-only target (`targetIsAppUser === false`): the existing single
//     <ConfirmDialog>. No auth user / email at stake — the soft-delete is
//     enough.
//   - App-user target (`targetIsAppUser === true`): a richer
//     <RemoveAppUserDialog> matching Onboarding's `removeUser` ceremony.
//     The destructive submit deletes the Supabase auth user and anonymizes
//     the staff row so the email is freed for re-invite — same gravity as
//     the Onboarding flow, so the friction is matched.

import { useState } from "react";
import { Power, PowerOff, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/lacquer/staff/confirm-dialog";
import { FormPendingSignal } from "@/components/lacquer/form-pending-signal";
import { RemoveAppUserDialog } from "@/components/lacquer/staff/remove-app-user-dialog.client";
import { SubmitButton } from "@/components/lacquer/submit-button";
import { Spinner } from "@/components/ui/spinner";
import {
  deactivateStaff,
  reactivateStaff,
  removeStaff,
} from "@/app/(studio)/settings/staff/actions";

import type { StudioRole } from "@/lib/auth/session";

export type DangerZoneProps = {
  targetId: string;
  targetName: string;
  targetActive: boolean;
  /** Issue #129 — true when `staff.user_id IS NOT NULL`. Picks between the
   *  rich <RemoveAppUserDialog> and the simple <ConfirmDialog>. */
  targetIsAppUser: boolean;
  /** Issue #129 — shown in the rich dialog so the operator can verify the
   *  account they're about to delete. Null for PIN-only targets. */
  targetEmail: string | null;
  /** Issue #129 — fed to the rich dialog header. */
  targetRole: StudioRole;
  /** Issue #129 — fed to the rich dialog avatar. */
  targetColorToken: string;
  canDeactivate: boolean;
  canReactivate: boolean;
  canRemove: boolean;
  /** Issue #129 — sub-button helper text describing the consequence of
   *  Remove. Different copy for PIN-only vs app-user targets. */
  helperText: string;
  /** Tooltip strings resolved by the parent panel via `lifecycleTooltip()`
   *  (permission matrix → human reason). The parent owns the matrix so
   *  this component stays purely presentational. */
  tooltips: {
    deactivate: string;
    reactivate: string;
    remove: string;
  };
};

export function DangerZone({
  targetId,
  targetName,
  targetActive,
  targetIsAppUser,
  targetEmail,
  targetRole,
  targetColorToken,
  canDeactivate,
  canReactivate,
  canRemove,
  helperText,
  tooltips,
}: DangerZoneProps) {
  // Only one dialog can be open at a time, so a single
  // `confirmOpen: "deactivate" | "remove" | null` suffices.
  const [confirmOpen, setConfirmOpen] = useState<"deactivate" | "remove" | null>(null);
  const [reactivating, setReactivating] = useState(false);

  return (
    <section className="danger-zone" data-section="danger-zone" data-slot="staff-danger-zone">
      <div className="danger-zone-eyebrow">Danger zone</div>

      {targetActive ? (
        <button
          type="button"
          data-destructive="true"
          data-slot="danger-zone-deactivate"
          onClick={() => setConfirmOpen("deactivate")}
          disabled={!canDeactivate}
          title={tooltips.deactivate}
          className="danger-zone-button"
        >
          <PowerOff size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>Deactivate</span>
        </button>
      ) : (
        // Reactivate has no confirm dialog — single click per
        // ui.contract.md § Dialog strings. Sibling <form> below. The --safe
        // variant tints neutrally since reactivate isn't destructive.
        // Plain <button type="submit"> so the form= attribute binding works;
        // <SubmitButton> cannot see this form's pending state (not a child).
        <button
          type="submit"
          form="staff-reactivate-form"
          data-destructive="true"
          data-slot="danger-zone-reactivate"
          disabled={!canReactivate || reactivating}
          aria-busy={reactivating || undefined}
          title={tooltips.reactivate}
          className="danger-zone-button danger-zone-button--safe"
        >
          {reactivating ? (
            <>
              <Spinner size={16} strokeWidth={2} aria-hidden="true" />
              <span>Reactivating…</span>
            </>
          ) : (
            <>
              <Power size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>Reactivate</span>
            </>
          )}
        </button>
      )}
      <button
        type="button"
        data-destructive="true"
        data-slot="danger-zone-remove"
        data-target-kind={targetIsAppUser ? "app_user" : "pin_only"}
        onClick={() => setConfirmOpen("remove")}
        disabled={!canRemove}
        title={tooltips.remove}
        className="danger-zone-button danger-zone-button--last"
      >
        <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>Remove from roster</span>
      </button>
      <p
        className="danger-zone-helper"
        data-slot="danger-zone-remove-helper"
        data-target-kind={targetIsAppUser ? "app_user" : "pin_only"}
      >
        {helperText}
      </p>

      {/* Sibling <form> for the single-click Reactivate path. Rendered outside
        the parent's updateStaff form so we don't nest forms (invalid HTML).
        The Reactivate button above carries form="staff-reactivate-form" so
        its type=submit dispatches into THIS form. Display:none — the
        button-form binding works regardless of layout.
        FormPendingSignal lifts this form's pending state to `reactivating`
        so the sibling button above can show a spinner while the action runs. */}
      <form
        id="staff-reactivate-form"
        action={reactivateStaff}
        data-slot="staff-reactivate-form"
        style={{ display: "none" }}
      >
        <input type="hidden" name="staff_id" value={targetId} />
        <FormPendingSignal onPendingChange={setReactivating} />
      </form>

      <ConfirmDialog
        open={confirmOpen === "deactivate"}
        onOpenChange={(next) => setConfirmOpen(next ? "deactivate" : null)}
        variant="deactivate"
        name={targetName}
      >
        <form action={deactivateStaff} data-slot="confirm-dialog-form" data-variant="deactivate">
          <input type="hidden" name="staff_id" value={targetId} />
          <SubmitButton
            data-slot="confirm-dialog-submit"
            style={destructiveButtonStyle}
            pendingLabel="Deactivating…"
          >
            Deactivate
          </SubmitButton>
        </form>
      </ConfirmDialog>

      {/* Issue #129 — branch the Remove dialog on target identity. App-user
        targets see the rich ack + typed-name ceremony; PIN-only targets keep
        the existing single-confirm dialog. */}
      {targetIsAppUser ? (
        <RemoveAppUserDialog
          open={confirmOpen === "remove"}
          onOpenChange={(next) => setConfirmOpen(next ? "remove" : null)}
          target={{
            id: targetId,
            display_name: targetName,
            email: targetEmail,
            role: targetRole,
            color_token: targetColorToken,
          }}
        />
      ) : (
        <ConfirmDialog
          open={confirmOpen === "remove"}
          onOpenChange={(next) => setConfirmOpen(next ? "remove" : null)}
          variant="remove"
          name={targetName}
        >
          <form action={removeStaff} data-slot="confirm-dialog-form" data-variant="remove">
            <input type="hidden" name="staff_id" value={targetId} />
            <SubmitButton
              data-slot="confirm-dialog-submit"
              style={destructiveButtonStyle}
              pendingLabel="Removing…"
            >
              Remove from roster
            </SubmitButton>
          </form>
        </ConfirmDialog>
      )}
    </section>
  );
}

/** Destructive submit button shared by both ConfirmDialogs — same
 *  Constitution-mapped tokens as the legacy edit-panel implementation. */
const destructiveButtonStyle = {
  padding: "var(--space-2) var(--space-3)",
  background: "var(--destructive)",
  color: "var(--destructive-foreground)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 150ms var(--ease-out)",
} as const;
