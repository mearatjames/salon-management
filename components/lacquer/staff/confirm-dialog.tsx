"use client";

// ConfirmDialog — shadcn `Dialog` wrapper for destructive Deactivate / Remove
// confirmations on a staff row. Used by `edit-panel.client.tsx`'s footer
// links.
//
// **Deviation from task text**: the contract labels this a Server-Component
// wrapper, but shadcn `Dialog`'s `open` / `onOpenChange` are React state
// callbacks; the parent (`edit-panel.client.tsx`) owns the open state and the
// dialog is mounted on the client. Marking it `"use client"` keeps the
// type contract honest (event handler props are not serializable across the
// RSC boundary in Next 16). The wrapper itself has no internal state — it
// only renders the right strings per variant and slots the caller's `<form>`
// as the destructive CTA's submit container.
//
// Strings are the single source of truth from ui.contract.md § Dialog
// strings:
//   - Deactivate: title "Deactivate {name}?", body "{name} won't be able to
//     log in until you reactivate them. Their appointments and history are
//     unaffected.", CTA "Deactivate"
//   - Remove:     title "Remove {name}?", body "{name} will be removed from
//     the staff roster and won't appear on the login screen. Their
//     appointment history stays on record.", CTA "Remove"
//
// **No appointment-count warning** — per Clarifications Q2 the deferred
// appointment-count line is not rendered.
//
// The destructive CTA must use the `--destructive` / `--destructive-
// foreground` tokens (Constitution Principle I). Callers render their own
// submit button inside the slotted `<form>` so each action gets its own
// FormData payload and Server Action wiring — see the call sites in
// edit-panel.client.tsx.

import type { ReactNode } from "react";
import { PowerOff, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmDialogVariant = "deactivate" | "remove";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  variant: ConfirmDialogVariant;
  name: string;
  /** The caller's form (with its own Server Action + hidden inputs + submit). */
  children: ReactNode;
  /** Optional cancel handler — defaults to closing the dialog. */
  onCancel?: () => void;
};

type VariantCopy = {
  title: string;
  body: string;
  icon: typeof PowerOff;
};

function copyFor(variant: ConfirmDialogVariant, name: string): VariantCopy {
  if (variant === "deactivate") {
    return {
      title: `Deactivate ${name}?`,
      body: `${name} won't be able to log in until you reactivate them. Their appointments and history are unaffected.`,
      icon: PowerOff,
    };
  }
  return {
    title: `Remove ${name}?`,
    body: `${name} will be removed from the staff roster and won't appear on the login screen. Their appointment history stays on record.`,
    icon: Trash2,
  };
}

export function ConfirmDialog({
  open,
  onOpenChange,
  variant,
  name,
  children,
  onCancel,
}: ConfirmDialogProps) {
  const { title, body, icon: Icon } = copyFor(variant, name);

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="confirm-dialog" data-variant={variant} data-name={name}>
        <DialogHeader>
          <DialogTitle data-slot="confirm-dialog-title">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <Icon
                size={20}
                strokeWidth={1.5}
                aria-hidden="true"
                style={{ color: "var(--destructive)" }}
              />
              <span>{title}</span>
            </span>
          </DialogTitle>
          <DialogDescription data-slot="confirm-dialog-body">{body}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <button
            type="button"
            onClick={handleCancel}
            data-slot="confirm-dialog-cancel"
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "transparent",
              color: "var(--muted-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {/* The caller's <form action={…}> contains the destructive submit
              button. We render it as a sibling of the Cancel button so the
              dialog footer keeps the standard two-button layout. */}
          {children}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
