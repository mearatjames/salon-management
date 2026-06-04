// RefundEntry — feature 052 (US2). The owner/manager "Refund" affordance,
// rendered as the footer action inside the Transactions receipt drawer (the
// sole refund entry point — the dashboard feed + End-of-Day cash list controls
// were removed). The drawer gates rendering on `canEdit` (owner/manager within
// an open pay period), so this component just renders the button.
//
// On click it loads the ticket's refundable payments + their live remaining
// via the `getRefundableTicket` server action, then opens the
// `RefundCompositionSheet`. Keeping the load behind the click means the drawer
// only has to thread a `ticketId` — it doesn't pre-project a full receipt
// model. The server action re-checks the role (Principle II).

"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { getRefundableTicket, type RefundableTicket } from "@/app/(studio)/transactions/actions";
import { RefundCompositionSheet } from "@/components/lacquer/transactions/refund-composition-sheet";

export type RefundEntryProps = {
  /** The `tickets.id` to refund. */
  ticketId: string;
};

export function RefundEntry({ ticketId }: RefundEntryProps) {
  const [ticket, setTicket] = useState<RefundableTicket | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleOpen() {
    startTransition(async () => {
      try {
        const loaded = await getRefundableTicket(ticketId);
        setTicket(loaded);
        setOpen(true);
      } catch (err) {
        const name = (err as Error)?.name ?? "";
        if (name === "PermissionDeniedError") {
          toast.error("You need owner or manager access to issue a refund.");
          return;
        }
        if (name === "TicketOrLineNotFoundError") {
          toast.error("That sale couldn't be found. Refresh and try again.");
          return;
        }
        console.error("getRefundableTicket failed", { name, message: (err as Error)?.message });
        toast.error("Couldn't open the refund. Try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="tp-d-refund-trigger"
        data-slot="refund-entry-button"
        data-ticket-id={ticketId}
        disabled={pending}
        onClick={handleOpen}
        aria-label="Refund this sale"
      >
        <RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>Refund</span>
      </button>
      {ticket ? (
        <RefundCompositionSheet
          open={open}
          ticket={ticket}
          onClose={() => {
            setOpen(false);
            setTicket(null);
          }}
        />
      ) : null}
    </>
  );
}
