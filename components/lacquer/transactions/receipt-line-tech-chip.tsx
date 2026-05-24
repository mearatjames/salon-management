// ReceiptLineTechChip — feature 050. The per-line technician chip inside
// the receipt drawer. Replaces the inline `<span className="tp-d-tech-chip">`
// block from `receipt-drawer.tsx` and adds two new render branches:
//
//   - mode 1 (canEdit=false AND payPeriodFinalized=false) → today's chip
//     exactly. Plain chip, no trigger, no lock. Tech + front-desk + any
//     reader-only role lands here.
//   - mode 2 (canEdit=true) → chip + a "Change" ghost trigger that opens
//     a Radix Popover listing the active staff roster. Clicking an item
//     calls `reassignPaidLineTech` and on success calls `router.refresh()`
//     so the server parent re-renders with the new techId (the action's
//     `revalidatePath` invalidates the page cache; the refresh is what
//     triggers the re-fetch).
//   - mode 3 (payPeriodFinalized=true, any role) → chip with a leading
//     Lucide `Lock` icon and a Radix Tooltip ("Payouts for this pay
//     period have been finalized." — FR-004). No Change trigger.
//
// Composition: shadcn/ui primitives only — `<Popover>` and `<Tooltip>` from
// `components/ui/*`. Token-bound styling via `.tp-d-tech-chip*` classes in
// `styles/transactions.css` (Principle I); inline `var(--*)` is used only
// where it mirrors the existing cart-row pattern (the staff-picker rows
// inside the popover).
//
// Server-action error handling — typed errors propagate via the action's
// `.name` discriminator (Next.js Server Actions strip non-stack metadata
// across the client boundary). The catch block matches on `.name` and
// surfaces the spec-mandated copy via sonner. A generic fallback covers
// the database-write failure mode.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { reassignPaidLineTech } from "@/app/(studio)/transactions/actions";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ActiveStaffMember = {
  readonly id: string;
  readonly displayName: string;
  readonly colorToken: string;
};

export type ReceiptLineTechChipProps = {
  /** Current `assigned_staff_id`; null when the line is unassigned. */
  techId: string | null;
  /** Display name for the current assignee; null when unassigned (mode 2 still renders a placeholder + Change). */
  techDisplayName: string | null;
  /** Color token for the current assignee; null when unassigned. */
  techColorToken: string | null;
  /** `ticket_items.id` — passed to the server action. */
  lineId: string;
  /** `tickets.id` — passed to the server action for defensive verify. */
  ticketId: string;
  /** Resolved by the drawer's parent: viewerRole in {owner, manager} AND !payPeriodFinalized. */
  canEdit: boolean;
  /** When true, mode 3 renders (Lock + tooltip; no Change). */
  payPeriodFinalized: boolean;
  /** Active staff roster the Popover lists. Pre-filtered to active=true upstream. */
  activeStaff: ReadonlyArray<ActiveStaffMember>;
};

// The first name of a staff member, for the chip's display label.
function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? displayName;
}

export function ReceiptLineTechChip({
  techId,
  techDisplayName,
  techColorToken,
  lineId,
  ticketId,
  canEdit,
  payPeriodFinalized,
  activeStaff,
}: ReceiptLineTechChipProps) {
  const router = useRouter();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Mode 3 — finalized pay period locks the surface for every role. The
  // chip can only render with a tech assigned in mode 3 (a paid ticket
  // without a tech inside a finalized period is a degenerate state, but
  // the chip still safely renders without the avatar in that branch).
  if (payPeriodFinalized) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="tp-d-tech-chip"
              data-slot="receipt-line-tech-chip"
              data-staff-id={techId ?? ""}
              data-locked="true"
            >
              <span className="tp-d-tech-chip-lock" aria-hidden="true">
                <Lock size={14} strokeWidth={1.5} />
              </span>
              {techDisplayName && techColorToken ? (
                <>
                  <InitialsAvatar name={techDisplayName} colorToken={techColorToken} size={14} />{" "}
                  {firstName(techDisplayName)}
                </>
              ) : null}
            </span>
          </TooltipTrigger>
          <TooltipContent>Payouts for this pay period have been finalized.</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // The chip body — used by modes 1 and 2. When the line is unassigned,
  // the chip is a placeholder ("Unassigned") so mode 2's Change trigger
  // still has something to attach to.
  const chipBody =
    techDisplayName && techColorToken ? (
      <>
        <InitialsAvatar name={techDisplayName} colorToken={techColorToken} size={14} />{" "}
        {firstName(techDisplayName)}
      </>
    ) : (
      <span style={{ paddingLeft: "var(--space-1)" }}>Unassigned</span>
    );

  const chip = (
    <span
      className="tp-d-tech-chip"
      data-slot="receipt-line-tech-chip"
      data-staff-id={techId ?? ""}
    >
      {chipBody}
    </span>
  );

  // Mode 1 — read-only (technician / front-desk / any non-privileged
  // role). Today's chip exactly, no trigger.
  if (!canEdit) {
    return chip;
  }

  // Mode 2 — owner/manager + open pay period. Chip + Change trigger
  // wrapping a Popover.
  function handlePick(newStaffId: string) {
    setPopoverOpen(false);
    startTransition(async () => {
      try {
        await reassignPaidLineTech({
          ticketId,
          lineId,
          newAssignedStaffId: newStaffId,
        });
        router.refresh();
      } catch (err) {
        const name = (err as Error)?.name ?? "";
        const message = (err as Error)?.message ?? "";
        switch (name) {
          case "PermissionDeniedError":
            toast.error("You need owner or manager access to change a service line's tech.");
            return;
          case "TicketNotPaidError":
            toast.error("This ticket isn't paid; use the cart to change the tech instead.");
            return;
          case "PayPeriodFinalizedError":
            toast.error(
              "Payouts for this pay period have been finalized. The line can't be reassigned."
            );
            return;
          case "StaffNotActiveError":
            toast.error("That staff member is no longer active. Pick someone else.");
            return;
          case "TicketOrLineNotFoundError":
            toast.error("The ticket or line couldn't be found. Refresh and try again.");
            return;
          default:
            // Generic fallback (DB write failure, etc.).
            console.error("reassignPaidLineTech failed", { name, message });
            toast.error("Couldn't save the change. Try again.");
        }
      }
    });
  }

  return (
    <>
      {chip}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="tp-d-tech-chip-change"
            data-slot="receipt-line-tech-change"
            aria-label="Change tech for this line"
          >
            Change
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
          <ul
            role="listbox"
            aria-label="Reassign tech"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
            }}
          >
            {activeStaff.map((candidate) => {
              const isCurrent = candidate.id === techId;
              return (
                <li key={candidate.id} style={{ margin: 0 }}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    aria-disabled={isCurrent || undefined}
                    data-slot="receipt-line-tech-popover-item"
                    data-staff-id={candidate.id}
                    data-current={isCurrent ? "true" : undefined}
                    onClick={(ev) => {
                      // No-op guard — the currently assigned tech is a
                      // "current pick" indicator, not a re-fire of the
                      // same write. Mirrors the cart-row picker (FR-013
                      // no-op is also enforced server-side, so a stray
                      // click here is harmless either way — this gate
                      // just avoids a pointless round-trip + toast).
                      if (isCurrent) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                      }
                      handlePick(candidate.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      width: "100%",
                      padding: "var(--space-2) var(--space-2)",
                      background: isCurrent ? "var(--muted)" : "transparent",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: isCurrent ? "default" : "pointer",
                      color: isCurrent ? "var(--muted-foreground)" : "var(--foreground)",
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      textAlign: "left",
                      opacity: isCurrent ? 0.7 : 1,
                    }}
                  >
                    <InitialsAvatar
                      name={candidate.displayName}
                      colorToken={candidate.colorToken}
                      size={24}
                    />
                    <span style={{ flex: "1 1 auto" }}>{candidate.displayName}</span>
                    {isCurrent ? (
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          color: "var(--muted-foreground)",
                          fontWeight: 500,
                        }}
                      >
                        Current
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </>
  );
}
