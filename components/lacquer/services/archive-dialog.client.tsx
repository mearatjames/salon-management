"use client";

// ArchiveDialog — destructive confirmation prompt for the "Archive service"
// bottom action in the Edit drawer. Mirrors the Destructive variant in
// `design-system/preview/confirm.html`: 304px card, 24px padding,
// `--radius-xl` shell, `--shadow-md`, with a 36×36 danger-tinted icon badge
// (Lucide Trash2, size 20 per Tang Nails icon scale) above the title +
// description + actions (ghost Cancel + destructive Archive).
//
// Title: `Archive {name}?`
// Body (verbatim per FR-025):
//   `{name} won't appear in booking pickers or the catalog list, but past
//    appointments that used it stay on record. You can restore it any time.`
//
// The Confirm button is a `<button type="submit">` nested inside a
// `<form action={archiveService}>` with a hidden `service_id` input — the
// dialog closes automatically on the post-action redirect.

import { Trash2 } from "lucide-react";

import { archiveService } from "@/app/(studio)/services/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type ArchiveDialogProps = {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Name of the service being archived — used in the title + body. */
  serviceName: string;
  /** UUID of the service — submitted as `service_id` to `archiveService`. */
  serviceId: string;
  /** Cancel — closes the dialog without firing the action. */
  onCancel: () => void;
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

export function ArchiveDialog({ open, serviceName, serviceId, onCancel }: ArchiveDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Backdrop + Escape route through onOpenChange(false). Treat either
        // as Cancel so the operator never accidentally archives via stray Esc.
        if (!next) onCancel();
      }}
    >
      <DialogContent
        data-slot="archive-dialog"
        data-name={serviceName}
        className={SHELL_CLASSNAME}
        showCloseButton={false}
      >
        {/* Icon badge — danger variant per confirm.html § Destructive */}
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
            background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
            color: "var(--destructive)",
          }}
        >
          <Trash2 size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>

        <DialogTitle
          data-slot="archive-dialog-title"
          className="!font-sans"
          style={{
            fontSize: "var(--text-md)",
            fontWeight: 600,
            lineHeight: "var(--leading-snug)",
            marginBottom: "6px",
            color: "var(--foreground)",
          }}
        >
          {`Archive ${serviceName}?`}
        </DialogTitle>
        <DialogDescription
          data-slot="archive-dialog-body"
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            lineHeight: "var(--leading-normal)",
            textWrap: "pretty",
          }}
        >
          {`${serviceName} won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time.`}
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
            data-slot="archive-dialog-cancel"
            style={{
              ...BUTTON_BASE,
              background: "transparent",
              color: "var(--foreground)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Cancel
          </button>
          {/* The destructive CTA lives inside its own <form> so it carries
              the right FormData payload + Server Action wiring. The dialog
              closes automatically on the post-action redirect (the parent
              drawer unmounts/re-renders with the new ?selected=&toast= URL). */}
          <form action={archiveService}>
            <input type="hidden" name="service_id" value={serviceId} />
            <button
              type="submit"
              data-slot="archive-dialog-confirm"
              style={{
                ...BUTTON_BASE,
                background: "var(--destructive)",
                color: "var(--destructive-foreground)",
              }}
            >
              {`Archive ${serviceName}`}
            </button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
