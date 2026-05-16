"use client";

// ArchiveDialog — destructive confirmation prompt for the "Archive service"
// bottom action in the Edit drawer. Composes shadcn `<Dialog>` with the
// Lucide `Archive` icon (Constitution I: icons via Lucide, 1.5 stroke).
//
// Title: `Archive {name}?`
// Body (verbatim per FR-025):
//   `{name} won't appear in booking pickers or the catalog list, but past
//    appointments that used it stay on record. You can restore it any time.`
// Buttons: Cancel + Archive
//
// The Confirm button is a `<button type="submit">` nested inside a
// `<form action={archiveService}>` with a hidden `service_id` input — the
// parent (`drawer.client.tsx`) wires the form so each archive submission
// carries its own FormData. Mirror of the pattern documented in
// `components/lacquer/staff/confirm-dialog.tsx`.

import { Archive } from "lucide-react";

import { archiveService } from "@/app/(studio)/settings/services/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      <DialogContent data-slot="archive-dialog" data-name={serviceName}>
        <DialogHeader>
          <DialogTitle data-slot="archive-dialog-title">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <Archive
                size={20}
                strokeWidth={1.5}
                aria-hidden="true"
                style={{ color: "var(--destructive)" }}
              />
              <span>{`Archive ${serviceName}?`}</span>
            </span>
          </DialogTitle>
          <DialogDescription data-slot="archive-dialog-body">
            {`${serviceName} won't appear in booking pickers or the catalog list, but past appointments that used it stay on record. You can restore it any time.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            data-slot="archive-dialog-cancel"
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
              Archive
            </button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
