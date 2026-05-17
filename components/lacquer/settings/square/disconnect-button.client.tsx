"use client";

// Disconnect Square button — opens a confirm Dialog (radix-ui via shadcn)
// and on confirm invokes the `disconnectSquare()` Server Action. On
// success, the page revalidates server-side (revalidatePath in the action)
// and the Settings Square view flips back to the unconnected card.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { disconnectSquare } from "@/app/(studio)/settings/square/actions";

export function DisconnectButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = (): void => {
    startTransition(async () => {
      try {
        await disconnectSquare();
        toast.success("Square disconnected.");
        setOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not disconnect Square.";
        toast.error(msg);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="square-disconnect-button">
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect Square?</DialogTitle>
          <DialogDescription>
            Tang Nails will stop accepting card payments until you reconnect. Cash payments are
            unaffected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
            data-testid="square-disconnect-confirm"
          >
            {pending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
