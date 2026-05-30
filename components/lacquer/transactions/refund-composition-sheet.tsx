// RefundCompositionSheet — feature 052 (US2). The refund surface shared by
// the dashboard feed, the receipt drawer, and the End-of-Day cash list.
//
// A shadcn `Sheet` (16px radius — `rounded-2xl`) listing the ticket's
// succeeded ORIGINAL payments. Each payment gets a refund-amount input
// bounded by its live remaining (original − Σ succeeded refunds, resolved
// server-side by `getRefundableTicket`). Client-side validation mirrors the
// server backstop:
//   - each line ≤ its displayed remaining,
//   - total > 0,
//   - submit is DISABLED with an explanatory message otherwise.
// The server (`refundTicket`) re-validates everything (Constitution
// Principle II); this only governs affordance state.
//
// Currency renders with tabular numerals (`.tnum`, Principle I). Errors map
// `error.name` → a sonner toast (the convention from feature 050's
// `receipt-line-tech-chip.tsx`).

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { refundTicket, type RefundableTicket } from "@/app/(studio)/transactions/actions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Cent-precise currency for the refund sheet — the per-payment remaining and
// total drive a cent-bounded input, so they must show cents (a whole-dollar
// formatter would render $12.50 remaining as "$13" and misstate the bound).
function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const METHOD_LABEL: Record<RefundableTicket["payments"][number]["method"], string> = {
  card: "Card",
  cash: "Cash",
  gift: "Gift card",
};

export type RefundCompositionSheetProps = {
  /** When true the sheet is mounted/open. */
  open: boolean;
  /** The refundable ticket — payments + their live remaining. */
  ticket: RefundableTicket;
  /** Called on any dismissal (overlay, Escape, close, success). */
  onClose: () => void;
};

// Parse a dollar-string input to integer cents. Returns 0 for blank / invalid
// (treated as "no amount on this line"). Rounds to the nearest cent so a stray
// third decimal can't smuggle sub-cent precision past the integer guard.
function dollarsToCents(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function RefundCompositionSheet({ open, ticket, onClose }: RefundCompositionSheetProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Per-payment input strings, keyed by payment id. Blank = no refund on
  // that line.
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const lines = useMemo(
    () =>
      ticket.payments.map((p) => {
        const cents = dollarsToCents(amounts[p.id] ?? "");
        return {
          payment: p,
          cents,
          // A line is invalid only when it's positive AND exceeds remaining.
          // A blank / zero line is simply "not refunding this payment".
          overRemaining: cents > p.remainingCents,
        };
      }),
    [ticket.payments, amounts]
  );

  const totalCents = lines.reduce((sum, l) => sum + l.cents, 0);
  const anyOver = lines.some((l) => l.overRemaining);
  const canSubmit = totalCents > 0 && !anyOver && !pending;

  // The explanatory message under the footer when submit is disabled.
  const disabledReason = anyOver
    ? "A refund amount can't exceed the payment's remaining balance."
    : totalCents === 0
      ? "Enter an amount to refund."
      : null;

  function setAmount(paymentId: string, value: string) {
    setAmounts((prev) => ({ ...prev, [paymentId]: value }));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const payload = lines
      .filter((l) => l.cents > 0)
      .map((l) => ({ originalPaymentId: l.payment.id, amountCents: l.cents }));
    startTransition(async () => {
      try {
        await refundTicket({ ticketId: ticket.ticketId, lines: payload });
        toast.success("Refund issued.");
        setAmounts({});
        router.refresh();
        onClose();
      } catch (err) {
        const name = (err as Error)?.name ?? "";
        switch (name) {
          case "PermissionDeniedError":
            toast.error("You need owner or manager access to issue a refund.");
            return;
          case "RefundExceedsRemainingError":
            toast.error("A refund amount exceeds the payment's remaining balance.");
            return;
          case "PaymentNotOnTicketError":
            toast.error("That payment isn't part of this sale. Refresh and try again.");
            return;
          case "SquareRefundFailedError":
            toast.error("Square couldn't process the refund. The sale is unchanged.");
            return;
          default:
            console.error("refundTicket failed", { name, message: (err as Error)?.message });
            toast.error("Couldn't issue the refund. Try again.");
        }
      }
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="rounded-l-2xl sm:max-w-md"
        data-slot="refund-composition-sheet"
      >
        <SheetHeader>
          <SheetTitle>Refund sale {ticket.displayId}</SheetTitle>
          <SheetDescription>
            Refund part or all of a payment. Each amount can&apos;t exceed what&apos;s left on that
            payment.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4">
          {ticket.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">This sale has no refundable payments.</p>
          ) : (
            ticket.payments.map((p) => {
              const remainingDollars = (p.remainingCents / 100).toFixed(2);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  data-slot="refund-payment-row"
                  data-payment-id={p.id}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">
                      {METHOD_LABEL[p.method]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="tnum">{usd(p.remainingCents)}</span> left of{" "}
                      <span className="tnum">{usd(p.amountCents)}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">$</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={remainingDollars}
                      step="0.01"
                      placeholder="0.00"
                      className="tnum w-24 text-right"
                      aria-label={`Refund amount for the ${METHOD_LABEL[p.method].toLowerCase()} payment`}
                      data-slot="refund-amount-input"
                      data-payment-id={p.id}
                      value={amounts[p.id] ?? ""}
                      onChange={(e) => setAmount(p.id, e.target.value)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <SheetFooter>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total refund</span>
            <span className="tnum font-medium text-foreground" data-slot="refund-total">
              {usd(totalCents)}
            </span>
          </div>
          {disabledReason ? (
            <p className="text-xs text-muted-foreground" data-slot="refund-disabled-reason">
              {disabledReason}
            </p>
          ) : null}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-slot="refund-submit-button"
          >
            {pending ? "Issuing refund…" : "Issue refund"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
