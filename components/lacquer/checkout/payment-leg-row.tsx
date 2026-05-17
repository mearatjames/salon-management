"use client";

// PaymentLegRow — one row inside the SplitCartFooter's leg list (feature 018).
//
// Each row renders a single payment leg:
//   - Method icon (Lucide Banknote / CreditCard / Gift, 1.5px stroke).
//   - Amount (tabular numerals, formatted "$X.XX").
//   - State badge: "Draft" | "Pending" | "Succeeded" | "Failed".
//   - Remove button (Lucide X, visible ONLY for draft legs).
//
// Behaviour:
//   - For draft legs, tapping the row body opens the method-appropriate
//     activation:
//       cash → calls `onActivateCash(paymentId)`
//       card → calls `onActivateCard(paymentId)` (which routes the parent
//              into CardWaiting via sendCardToTerminal({existingDraftId}))
//       gift → calls `onActivateGift(paymentId)` (parent opens GanNumpadSheet)
//   - For non-draft legs (pending/succeeded/failed), the row is informational
//     only; the tap is a no-op and the remove button is hidden.
//
// Design system: token-only styling, Lucide icons at 1.5px stroke,
// tabular numerals on the amount + tape-able row chrome at the 4/8/12px scale.

import { Banknote, CreditCard, Gift, X } from "lucide-react";

export type PaymentLegMethod = "cash" | "card" | "gift";
export type PaymentLegStatus = "draft" | "pending" | "succeeded" | "failed";

export type PaymentLegRowView = {
  id: string;
  method: PaymentLegMethod;
  amountCents: number;
  status: PaymentLegStatus;
  /** Optional last-4 mask (gift cards only). When present, rendered alongside the method label. */
  last4Mask?: string | null;
};

export type PaymentLegRowProps = {
  leg: PaymentLegRowView;
  /** True when any other leg on the ticket is in-flight; disables tap + remove. */
  ticketLocked?: boolean;
  /** Activation callbacks — only one fires per row, based on `leg.method`. */
  onActivateCash?: (paymentId: string) => void;
  onActivateCard?: (paymentId: string) => void;
  onActivateGift?: (paymentId: string) => void;
  onRemoveDraft?: (paymentId: string) => void;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function methodLabel(method: PaymentLegMethod): string {
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  return "Gift";
}

function statusLabel(status: PaymentLegStatus): string {
  if (status === "draft") return "Draft";
  if (status === "pending") return "Pending";
  if (status === "succeeded") return "Succeeded";
  return "Failed";
}

function statusBadgeStyle(status: PaymentLegStatus): React.CSSProperties {
  // Draft/pending sit on the muted track; succeeded reads as primary; failed
  // pulls in --destructive at low alpha so the failed state is unambiguous
  // without screaming.
  if (status === "succeeded") {
    return {
      background: "color-mix(in oklch, var(--primary) 14%, transparent)",
      color: "var(--primary)",
    };
  }
  if (status === "failed") {
    return {
      background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
      color: "var(--destructive)",
    };
  }
  if (status === "pending") {
    return {
      background: "color-mix(in oklch, var(--primary) 8%, transparent)",
      color: "var(--primary)",
    };
  }
  return {
    background: "var(--muted)",
    color: "var(--muted-foreground)",
  };
}

function MethodGlyph({ method }: { method: PaymentLegMethod }) {
  // Conditional render keeps the per-method Lucide component reference
  // stable across renders (eslint react-hooks/static-components requires
  // we don't recreate the component binding at call time).
  const style = { color: "var(--muted-foreground)", flex: "0 0 auto" } as const;
  if (method === "cash") {
    return <Banknote size={20} strokeWidth={1.5} aria-hidden="true" style={style} />;
  }
  if (method === "card") {
    return <CreditCard size={20} strokeWidth={1.5} aria-hidden="true" style={style} />;
  }
  return <Gift size={20} strokeWidth={1.5} aria-hidden="true" style={style} />;
}

export function PaymentLegRow({
  leg,
  ticketLocked = false,
  onActivateCash,
  onActivateCard,
  onActivateGift,
  onRemoveDraft,
}: PaymentLegRowProps) {
  const isDraft = leg.status === "draft";
  const tapEnabled = isDraft && !ticketLocked;

  function handleActivate() {
    if (!tapEnabled) return;
    if (leg.method === "cash" && onActivateCash) return onActivateCash(leg.id);
    if (leg.method === "card" && onActivateCard) return onActivateCard(leg.id);
    if (leg.method === "gift" && onActivateGift) return onActivateGift(leg.id);
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isDraft || ticketLocked || !onRemoveDraft) return;
    onRemoveDraft(leg.id);
  }

  return (
    <div
      data-slot="payment-leg-row"
      data-method={leg.method}
      data-status={leg.status}
      role={tapEnabled ? "button" : undefined}
      tabIndex={tapEnabled ? 0 : undefined}
      onClick={tapEnabled ? handleActivate : undefined}
      onKeyDown={
        tapEnabled
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        cursor: tapEnabled ? "pointer" : "default",
        opacity: ticketLocked && !isDraft ? 0.85 : 1,
      }}
    >
      <MethodGlyph method={leg.method} />

      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
        }}
      >
        <div
          data-slot="payment-leg-method"
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            color: "var(--foreground)",
          }}
        >
          {methodLabel(leg.method)}
          {leg.last4Mask ? (
            <span
              data-slot="payment-leg-mask"
              style={{
                marginLeft: "var(--space-2)",
                color: "var(--muted-foreground)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ••••{leg.last4Mask}
            </span>
          ) : null}
        </div>
        <span
          data-slot="payment-leg-status"
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            padding: "var(--space-1) var(--space-2)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-xs)",
            fontWeight: 500,
            ...statusBadgeStyle(leg.status),
          }}
        >
          {statusLabel(leg.status)}
        </span>
      </div>

      <div
        data-slot="payment-leg-amount"
        style={{
          flex: "0 0 auto",
          fontSize: "var(--text-base)",
          fontWeight: 600,
          color: "var(--foreground)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmt(leg.amountCents)}
      </div>

      {isDraft ? (
        <button
          type="button"
          data-slot="payment-leg-remove"
          onClick={handleRemove}
          aria-label={`Remove ${methodLabel(leg.method).toLowerCase()} draft leg`}
          disabled={ticketLocked}
          style={{
            appearance: "none",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-1)",
            color: "var(--muted-foreground)",
            cursor: ticketLocked ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
