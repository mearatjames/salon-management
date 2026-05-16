"use client";

// DiscardChangesDialog — confirmation prompt that fires when the operator
// tries to close the drawer (backdrop / Escape / Cancel) while the form has
// unsaved edits. Per `contracts/ui.contract.md § 2`, only `*-dirty` states
// route through this overlay; `*-clean` states close silently.
//
// The dialog is intentionally minimal: title + body + two buttons. The
// parent (drawer.client.tsx) owns the open state and the post-discard
// behavior — this island just renders the chrome and forwards the two
// outcomes via `onCancel` / `onDiscard`.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DiscardChangesDialogProps = {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Cancel — returns to the dirty drawer with the draft preserved. */
  onCancel: () => void;
  /** Discard — drops the draft and closes the drawer. */
  onDiscard: () => void;
};

export function DiscardChangesDialog({ open, onCancel, onDiscard }: DiscardChangesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // shadcn Dialog routes backdrop + Escape through onOpenChange(false).
        // Treat either as Cancel so the operator never accidentally loses a
        // draft from a stray Escape press.
        if (!next) onCancel();
      }}
    >
      <DialogContent data-slot="discard-changes-dialog">
        <DialogHeader>
          <DialogTitle data-slot="discard-changes-title">Discard changes?</DialogTitle>
          <DialogDescription data-slot="discard-changes-body">
            You have unsaved changes. Discard them?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            data-slot="discard-changes-cancel"
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
          <button
            type="button"
            onClick={onDiscard}
            data-slot="discard-changes-confirm"
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "var(--destructive)",
              color: "var(--destructive-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity var(--duration-fast) var(--ease-out)",
            }}
          >
            Discard
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
