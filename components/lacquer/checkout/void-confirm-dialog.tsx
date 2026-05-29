// VoidConfirmDialog — feature 052 (US1). The owner/manager "Void sale"
// affordance on the paid DoneScreen plus its confirmation dialog.
//
// Renders a destructive-styled trigger button (`data-slot="void-sale-button"`)
// and a shadcn `AlertDialog` confirming the FULL same-day reversal. On
// confirm it calls the `voidSale` server action; on success the page is
// revalidated by the action and `router.refresh()` re-renders the parent
// (the ticket is now `void`, so the DoneScreen branch — and this affordance
// — drop away). Errors map `error.name` → a sonner toast, mirroring feature
// 050's `receipt-line-tech-chip.tsx` convention.
//
// Design system (Lacquer): tokens only — no raw hex / off-scale spacing.
// Lucide `RotateCcw` icon at 1.5px stroke. Sentence-case copy, tabular
// currency. The AlertDialog primitive supplies the 16px (rounded-2xl) sheet
// radius + 300ms ease-out animation.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { voidSale } from "@/app/(studio)/checkout/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type VoidConfirmDialogProps = {
  /** `tickets.id` — passed to the `voidSale` server action. */
  ticketId: string;
  /** The full charged total, in cents — surfaced in the confirm copy. */
  chargedCents: number;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function VoidConfirmDialog({ ticketId, chargedCents }: VoidConfirmDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      try {
        await voidSale({ ticketId });
        setOpen(false);
        toast.success(`Voided ${fmt(chargedCents)}. The sale was fully reversed.`);
        router.refresh();
      } catch (err) {
        const name = (err as Error)?.name ?? "";
        const message = (err as Error)?.message ?? "";
        switch (name) {
          case "PermissionDeniedError":
            toast.error("You need owner or manager access to void a sale.");
            return;
          case "VoidNotAllowedError":
            toast.error("This sale can't be voided — only same-day paid sales are eligible.");
            return;
          case "SquareRefundFailedError":
            toast.error("Square couldn't process the refund. The sale is unchanged.");
            return;
          default:
            console.error("voidSale failed", { name, message });
            toast.error("Couldn't void the sale. Try again.");
        }
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          data-slot="void-sale-button"
          className="tabular-nums"
        >
          <RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" />
          Void sale
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this sale?</AlertDialogTitle>
          <AlertDialogDescription>
            This fully reverses the <span className="tabular-nums">{fmt(chargedCents)}</span> sale
            and refunds every payment. You can only void a sale on the same day it was paid.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep sale</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            data-slot="void-confirm-button"
            loading={pending}
            onClick={handleConfirm}
          >
            Void sale
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
