"use client";

// VariablePricePlaceholderDialog — opened by an unconfirmed-price line's
// price control (FR-016). In this phase there is no price-entry surface;
// the dialog only explains that variable pricing lands in the next
// US-bundle. Body copy is calm, second-person, sentence case (Lacquer
// content fundamentals).
//
// Built on the shared shadcn `Dialog` primitive so the radii / shadows /
// animation curves match the rest of the studio. Two actions: "Remove
// from cart" (re-uses the line's existing remove callback) and "Keep for
// now" (closes the dialog without changing the cart).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type VariablePricePlaceholderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Service name for the dialog title — e.g. "Nail art". */
  serviceName: string;
  /** Fires when the operator chooses to remove the line from the cart. */
  onRemove: () => void;
};

export function VariablePricePlaceholderDialog({
  open,
  onOpenChange,
  serviceName,
  onRemove,
}: VariablePricePlaceholderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="variable-price-dialog">
        <DialogHeader>
          <DialogTitle>Variable pricing isn’t available yet</DialogTitle>
          <DialogDescription>
            “{serviceName}” has a variable price. Setting a custom amount lands in the next release
            — for now, remove it from the cart or leave it for reference.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            data-slot="variable-price-keep-button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--space-8)",
              padding: "0 var(--space-3)",
              background: "var(--secondary)",
              color: "var(--secondary-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Keep for now
          </button>
          <button
            type="button"
            onClick={() => {
              onRemove();
              onOpenChange(false);
            }}
            data-slot="variable-price-remove-button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--space-8)",
              padding: "0 var(--space-3)",
              background: "var(--destructive)",
              color: "var(--destructive-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Remove from cart
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
