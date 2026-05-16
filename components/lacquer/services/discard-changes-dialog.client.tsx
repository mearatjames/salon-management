"use client";

// DiscardChangesDialog — confirmation prompt that fires when the operator
// tries to close the drawer (backdrop / Escape / Cancel) while the form has
// unsaved edits. Per `contracts/ui.contract.md § 2`, only `*-dirty` states
// route through this overlay; `*-clean` states close silently.
//
// Mirrors the Warning variant in `design-system/preview/confirm.html`:
// 304px card, 24px padding, `--radius-xl` shell, `--shadow-md`, with a 36×36
// warning-tinted icon badge (Lucide TriangleAlert, size 20 per Tang Nails
// icon scale) above the title + description + actions (secondary Cancel +
// destructive Discard — Discard is destructive even though the icon badge
// tone is warning, since losing draft data is irreversible).

import { TriangleAlert } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type DiscardChangesDialogProps = {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Cancel — returns to the dirty drawer with the draft preserved. */
  onCancel: () => void;
  /** Discard — drops the draft and closes the drawer. */
  onDiscard: () => void;
};

// Confirm-shell style overrides the shadcn DialogContent defaults
// (max-w-sm, p-4, gap-4) to match the 304/24/16 spec exactly.
const SHELL_CLASSNAME =
  "!w-[304px] !max-w-[304px] !p-6 !gap-0 !rounded-[var(--radius-xl)] !bg-[var(--card)] !ring-0 !border !border-[var(--border)] !shadow-[var(--shadow-md)]";

const BUTTON_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  height: "32px",
  padding: "0 var(--space-3)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  border: "1px solid transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "all var(--duration-fast) var(--ease-out)",
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
      <DialogContent
        data-slot="discard-changes-dialog"
        className={SHELL_CLASSNAME}
        showCloseButton={false}
      >
        {/* Icon badge — warning variant per confirm.html § Warning */}
        <div
          aria-hidden="true"
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "var(--radius-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--space-4)",
            flexShrink: 0,
            background: "color-mix(in oklch, var(--warning) 18%, transparent)",
            color: "var(--amber-500)",
          }}
        >
          <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>

        <DialogTitle
          data-slot="discard-changes-title"
          className="!font-sans"
          style={{
            fontSize: "var(--text-md)",
            fontWeight: 600,
            lineHeight: "var(--leading-snug)",
            marginBottom: "6px",
            color: "var(--foreground)",
          }}
        >
          Discard changes?
        </DialogTitle>
        <DialogDescription
          data-slot="discard-changes-body"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            lineHeight: "var(--leading-normal)",
            textWrap: "pretty",
          }}
        >
          You have unsaved changes. Discard them?
        </DialogDescription>

        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginTop: "var(--space-5)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            data-slot="discard-changes-cancel"
            style={{
              ...BUTTON_BASE,
              background: "var(--secondary)",
              color: "var(--secondary-foreground)",
              borderColor: "var(--border)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--secondary)")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            data-slot="discard-changes-confirm"
            style={{
              ...BUTTON_BASE,
              background: "var(--destructive)",
              color: "var(--destructive-foreground)",
            }}
          >
            Discard
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
