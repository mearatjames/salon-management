"use client";

// UserRowMenu — the per-row action menu for /settings/onboarding.
//
// One component, three variants (kind = 'pending' | 'active' | 'offboarded'):
//   - `active`     — Phase 5 (US3): Edit in Staff / Reset PIN / Send
//                    password reset / Offboard (or self-line).
//   - `offboarded` — Phase 6 (US4): Reactivate (stub for US6) + Remove
//                    permanently (opens RemoveSheet).
//   - `pending`    — Phase 7 (US5): inline Resend + Copy link icons, plus
//                    ⋯ menu (Resend · Copy invite link · Cancel invite
//                    destructive). No confirm dialog for Cancel — the
//                    destructive label under a separator is sufficient
//                    deterrence for v1 (sheets feel heavy for a single
//                    click, and the action is reversible via re-invite).
//
// Built on shadcn DropdownMenu. The Reset PIN / Offboard / Remove modal+sheet
// open state lives inside this component per Strategy B (each menu owns its
// own modals — simpler than a page-level orchestrator).

import {
  Archive,
  Key,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cancelInvite,
  getInviteLink,
  reactivateUser,
  resendInvite,
  sendUserPasswordReset,
} from "@/app/(studio)/settings/onboarding/actions";

import { OffboardSheet, type OffboardSheetTarget } from "./offboard-sheet.client";
import { RemoveSheet, type RemoveSheetTarget } from "./remove-sheet.client";
import { ResetPinModal } from "./reset-pin-modal.client";

export type UserRowMenuKind = "pending" | "active" | "offboarded";

export type UserRowMenuTarget = OffboardSheetTarget & {
  is_you: boolean;
};

export type UserRowMenuProps = {
  kind: UserRowMenuKind;
  target: UserRowMenuTarget;
  /** True when the target is the only remaining active owner. */
  isLastOwner: boolean;
};

export function UserRowMenu({ kind, target, isLastOwner }: UserRowMenuProps) {
  if (kind === "pending") return <PendingMenu target={target} />;
  if (kind === "offboarded") return <OffboardedMenu target={target} isLastOwner={isLastOwner} />;
  return <ActiveMenu target={target} isLastOwner={isLastOwner} />;
}

function ActiveMenu({ target, isLastOwner }: { target: UserRowMenuTarget; isLastOwner: boolean }) {
  const [offboardOpen, setOffboardOpen] = useState(false);
  const [resetPinOpen, setResetPinOpen] = useState(false);
  const firstName = target.display_name.trim().split(" ")[0] || target.display_name;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="onb-row-menu-trigger"
            data-slot="user-row-menu-trigger"
            aria-label={`Open menu for ${target.display_name}`}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-slot="user-row-menu-content" className="onb-row-menu">
          <DropdownMenuItem asChild data-slot="user-row-menu-item-edit">
            <Link href={`/settings/staff?selected=${encodeURIComponent(target.id)}`}>
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Edit in Staff
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            data-slot="user-row-menu-item-reset-pin"
            onSelect={(e) => {
              e.preventDefault();
              setResetPinOpen(true);
            }}
          >
            <Key size={16} strokeWidth={1.5} aria-hidden />
            Reset PIN
          </DropdownMenuItem>

          <DropdownMenuItem
            asChild
            data-slot="user-row-menu-item-send-reset"
            onSelect={(e) => {
              // Issue #125: single-submission path. `asChild` composes the
              // menuitem props onto the <form> below, so `currentTarget`
              // IS the form. Calling `requestSubmit()` fires the action
              // exactly once whether the user clicks the inner button or
              // activates the menu via keyboard. preventDefault keeps the
              // menu open long enough for React to capture the action
              // before Radix's default close unmounts the form.
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }}
          >
            <form action={sendUserPasswordReset} className="onb-row-menu-form">
              <input type="hidden" name="staff_id" value={target.id} />
              <button
                type="button"
                className="onb-row-menu-form-btn"
                data-slot="user-row-menu-send-reset-btn"
              >
                <Send size={16} strokeWidth={1.5} aria-hidden />
                Send password reset
              </button>
            </form>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {target.is_you ? (
            <div className="onb-row-menu-self" data-slot="user-row-menu-self">
              You can&apos;t offboard yourself. Another owner has to do it.
            </div>
          ) : (
            <DropdownMenuItem
              data-slot="user-row-menu-item-offboard"
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                setOffboardOpen(true);
              }}
            >
              <Archive size={16} strokeWidth={1.5} aria-hidden />
              Offboard {firstName}…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <OffboardSheet
        open={offboardOpen}
        onOpenChange={setOffboardOpen}
        target={{
          id: target.id,
          display_name: target.display_name,
          email: target.email,
          role: target.role,
          color_token: target.color_token,
        }}
        isLastOwner={isLastOwner}
      />
      <ResetPinModal
        open={resetPinOpen}
        onOpenChange={setResetPinOpen}
        target={{ id: target.id, display_name: target.display_name }}
      />
    </>
  );
}

function OffboardedMenu({
  target,
  isLastOwner,
}: {
  target: UserRowMenuTarget;
  isLastOwner: boolean;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);

  const removeTarget: RemoveSheetTarget = {
    id: target.id,
    display_name: target.display_name,
    email: target.email,
    role: target.role,
    color_token: target.color_token,
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="onb-row-menu-trigger"
            data-slot="user-row-menu-trigger"
            aria-label={`Open menu for ${target.display_name}`}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-slot="user-row-menu-content" className="onb-row-menu">
          {/* Reactivate — form-bound submit, mirrors the active variant's
              "Send password reset" pattern. Triggers reactivateUser, which
              rotates a fresh magic-link and flips state offboarded→invited. */}
          <DropdownMenuItem
            asChild
            data-slot="user-row-menu-item-reactivate"
            onSelect={(e) => {
              // Issue #125: single-submission path — see the matching
              // comment in `Send password reset` above.
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }}
          >
            <form action={reactivateUser} className="onb-row-menu-form">
              <input type="hidden" name="staff_id" value={target.id} />
              <button
                type="button"
                className="onb-row-menu-form-btn"
                data-slot="user-row-menu-reactivate-btn"
              >
                <RefreshCcw size={16} strokeWidth={1.5} aria-hidden />
                Reactivate
              </button>
            </form>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            data-slot="user-row-menu-item-remove"
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setRemoveOpen(true);
            }}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Remove permanently…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveSheet
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        target={removeTarget}
        isLastOwner={isLastOwner}
      />
    </>
  );
}

// ── Pending variant (US5) ───────────────────────────────────────────────────
//
// Two inline icon buttons (Resend, Copy link) + a ⋯ menu (Resend, Copy
// invite link, separator, Cancel invite destructive). The inline icons
// duplicate the menu items by design — the icons are the most-used
// affordance per the design-system prototype, and the menu still surfaces
// every action for discoverability and keyboard parity.
//
// Resend submits a small <form action={resendInvite}> via a hidden button —
// same form-bound submit pattern the active variant uses for "Send password
// reset" so the action runs server-side and benefits from the same redirect
// + revalidate + audit pipeline.
//
// Copy link calls `getInviteLink(target.id)` imperatively (server action
// invocable from a click handler), then `navigator.clipboard.writeText` +
// sonner toast. NOTE: per the contract, generateLink rotates the prior
// token as a side-effect — this is documented as the UX caveat in
// quickstart.md.
//
// Cancel submits a form bound to `cancelInvite`. No confirm dialog: the
// destructive label + position under a separator is sufficient deterrence
// for v1; the action is reversible via re-invite.

function PendingMenu({ target }: { target: UserRowMenuTarget }) {
  async function handleCopyLink(): Promise<void> {
    try {
      const result = await getInviteLink(target.id);
      if ("error" in result) {
        toast.error("Couldn't copy the invite link. Try again in a moment.");
        return;
      }
      await navigator.clipboard.writeText(result.link);
      toast.success("Invite link copied");
    } catch (err) {
      console.error("PendingMenu: copy link failed", err);
      toast.error("Couldn't copy the invite link. Try again in a moment.");
    }
  }

  return (
    <div className="onb-row-pending-actions" data-slot="user-row-pending-actions">
      {/* Inline Resend icon — its own form so it's keyboard-reachable
          independently of the ⋯ menu. */}
      <form action={resendInvite} className="onb-row-inline-form">
        <input type="hidden" name="staff_id" value={target.id} />
        <button
          type="submit"
          className="onb-row-inline-btn"
          data-slot="user-row-resend-inline"
          aria-label={`Resend invite to ${target.display_name}`}
          title="Resend invite"
        >
          <RefreshCcw size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </form>

      {/* Inline Copy link icon — imperative server-action call. */}
      <button
        type="button"
        className="onb-row-inline-btn"
        data-slot="user-row-copy-inline"
        aria-label={`Copy invite link for ${target.display_name}`}
        title="Copy invite link"
        onClick={handleCopyLink}
      >
        <LinkIcon size={16} strokeWidth={1.5} aria-hidden />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="onb-row-menu-trigger"
            data-slot="user-row-menu-trigger"
            aria-label={`Open menu for ${target.display_name}`}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-slot="user-row-menu-content" className="onb-row-menu">
          {/* Resend invite — same form-bound submit pattern. */}
          <DropdownMenuItem
            asChild
            data-slot="user-row-menu-item-resend"
            onSelect={(e) => {
              // Issue #125: single-submission path — see Active variant.
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }}
          >
            <form action={resendInvite} className="onb-row-menu-form">
              <input type="hidden" name="staff_id" value={target.id} />
              <button
                type="button"
                className="onb-row-menu-form-btn"
                data-slot="user-row-menu-resend-btn"
              >
                <RefreshCcw size={16} strokeWidth={1.5} aria-hidden />
                Resend invite
              </button>
            </form>
          </DropdownMenuItem>

          {/* Copy invite link — imperative server-action call. */}
          <DropdownMenuItem
            data-slot="user-row-menu-item-copy-link"
            onSelect={(e) => {
              e.preventDefault();
              void handleCopyLink();
            }}
          >
            <LinkIcon size={16} strokeWidth={1.5} aria-hidden />
            Copy invite link
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Cancel invite — destructive. No confirm dialog (see header). */}
          <DropdownMenuItem
            asChild
            data-slot="user-row-menu-item-cancel"
            variant="destructive"
            onSelect={(e) => {
              // Issue #125: single-submission path — see Active variant.
              e.preventDefault();
              (e.currentTarget as HTMLFormElement).requestSubmit();
            }}
          >
            <form action={cancelInvite} className="onb-row-menu-form">
              <input type="hidden" name="staff_id" value={target.id} />
              <button
                type="button"
                className="onb-row-menu-form-btn"
                data-slot="user-row-menu-cancel-btn"
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                Cancel invite
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
