// RefundEntry — feature 052 (US2). The owner/manager "Refund" affordance
// shared by all three refund entry points (dashboard feed, receipt drawer,
// End-of-Day cash list). One surface, three entry points (D6).
//
// On click it loads the ticket's refundable payments + their live remaining
// via the `getRefundableTicket` server action, then opens the
// `RefundCompositionSheet`. Keeping the load behind the click means the
// feed/EOD server components only have to thread a `ticketId` (+ the viewer's
// role for the affordance gate) — they don't pre-project a full receipt model
// per row.
//
// The button only renders for owner/manager (`canRefund`). The server action
// re-checks the role (Principle II); this governs affordance visibility.

"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { getRefundableTicket, type RefundableTicket } from "@/app/(studio)/transactions/actions";
import { RefundCompositionSheet } from "@/components/lacquer/transactions/refund-composition-sheet";

export type RefundEntryProps = {
  /** The `tickets.id` to refund. */
  ticketId: string;
  /** Resolved upstream: viewer role ∈ {owner, manager}. When false the
   *  affordance is omitted entirely (technicians see nothing). */
  canRefund: boolean;
  /** Visual variant — `feed` is a compact ghost button; `drawer` is a full
   *  footer action. Defaults to `feed`. */
  variant?: "feed" | "drawer";
};

export function RefundEntry({ ticketId, canRefund, variant = "feed" }: RefundEntryProps) {
  const [ticket, setTicket] = useState<RefundableTicket | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canRefund) return null;

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

  const className = variant === "drawer" ? "tp-d-refund-trigger" : "tx-feed-refund-trigger";

  return (
    <>
      <button
        type="button"
        className={className}
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
