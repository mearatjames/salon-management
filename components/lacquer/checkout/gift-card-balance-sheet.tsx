"use client";

// GiftCardBalanceSheet — renders the gift-card lookup result after the
// operator submitted a GAN. Driven by the `LookupGiftCardResult`
// discriminated union returned by the `lookupGiftCard` Server Action,
// plus an optional `remainingOwedCents` so the `found` state can split
// into full-vs-partial sub-states:
//
//   - `found` + balance >= remainingOwed → "$X available on this card"
//                                          + Redeem CTA (covers ticket).
//   - `found` + balance <  remainingOwed → "$X available · ticket needs $Y
//                                          · split needed" + Redeem
//                                          available CTA (US3 / T051).
//   - `zero_balance`  → "$0 available — pick a different method"; redeem disabled.
//   - `not_redeemable`→ "This gift card is {state} and can't be redeemed".
//   - `not_found`     → "Gift card not found — re-enter the number".
//
// Visual: adapted from the muted-rose accent strip in
// `design-system/prototypes/transaction/FlowSingle.jsx:230–235`. Last4
// mask shown ("Card ending in 1234"). Tabular numerals on the balance.
//
// Design system: token-only styling, Lucide icons (1.5px stroke), sentence
// case copy, no emoji, tabular numerals on currency.

import { AlertCircle, Gift } from "lucide-react";

import type { LookupGiftCardResult } from "@/app/(studio)/checkout/actions";

export type GiftCardBalanceSheetProps = {
  result: LookupGiftCardResult;
  onRedeem: () => void;
  onCancel: () => void;
  onReenter: () => void;
  /** Disable the Redeem CTA while the redeem call is in flight. */
  busy?: boolean;
  /**
   * US3 (T051): the ticket's remaining-owed amount in cents, used to
   * split the `found` state into full ("Redeem $40") vs partial
   * ("Redeem $15 available · split for $25"). When omitted, the sheet
   * falls back to the full-balance copy (US1 behaviour).
   */
  remainingOwedCents?: number;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function stateLabel(state: "PENDING" | "BLOCKED" | "DEACTIVATED"): string {
  switch (state) {
    case "PENDING":
      return "still pending activation";
    case "BLOCKED":
      return "blocked";
    case "DEACTIVATED":
      return "deactivated";
  }
}

export function GiftCardBalanceSheet({
  result,
  onRedeem,
  onCancel,
  onReenter,
  busy = false,
  remainingOwedCents,
}: GiftCardBalanceSheetProps) {
  // US3 (T051): derive a `partial` flag for the `found` state when the
  // gift balance won't cover the full remaining owed.
  const isPartial =
    result.kind === "found" &&
    typeof remainingOwedCents === "number" &&
    remainingOwedCents > 0 &&
    result.balanceCents < remainingOwedCents;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gift card balance"
      data-slot="gift-card-balance-sheet"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklch, var(--foreground) 32%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "calc(var(--space-16) * 6)",
          background: "var(--card)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          padding: "var(--space-6) var(--space-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
          boxShadow: "0 -8px 24px color-mix(in oklch, var(--foreground) 12%, transparent)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <BodyForResult
          result={result}
          remainingOwedCents={remainingOwedCents}
          isPartial={isPartial}
        />
        <ActionsForResult
          result={result}
          onRedeem={onRedeem}
          onCancel={onCancel}
          onReenter={onReenter}
          busy={busy}
          isPartial={isPartial}
        />
      </div>
    </div>
  );
}

function BodyForResult({
  result,
  remainingOwedCents,
  isPartial,
}: {
  result: LookupGiftCardResult;
  remainingOwedCents: number | undefined;
  isPartial: boolean;
}) {
  if (result.kind === "not_found") {
    return (
      <div
        data-slot="gift-card-balance-not-found"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          textAlign: "center",
          alignItems: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "var(--space-12)",
            height: "var(--space-12)",
            borderRadius: "var(--radius-full)",
            background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
            color: "var(--destructive)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertCircle size={24} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div
          style={{
            fontSize: "var(--text-lg)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          Gift card not found
        </div>
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
        >
          Re-enter the number and try again.
        </div>
      </div>
    );
  }

  if (result.kind === "not_redeemable") {
    return (
      <div
        data-slot="gift-card-balance-not-redeemable"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          textAlign: "center",
          alignItems: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "var(--space-12)",
            height: "var(--space-12)",
            borderRadius: "var(--radius-full)",
            background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
            color: "var(--destructive)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertCircle size={24} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div
          style={{
            fontSize: "var(--text-lg)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          This gift card is {stateLabel(result.state)}
        </div>
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Card ending in {result.last4Mask}. Pick a different method to charge.
        </div>
      </div>
    );
  }

  // found OR zero_balance — both have last4Mask + balanceCents.
  const balance = result.kind === "zero_balance" ? 0 : result.balanceCents;
  const dataSlot =
    result.kind === "zero_balance"
      ? "gift-card-balance-zero"
      : isPartial
        ? "gift-card-balance-partial"
        : "gift-card-balance-found";
  return (
    <div
      data-slot={dataSlot}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        textAlign: "center",
        alignItems: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "var(--space-12)",
          height: "var(--space-12)",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in oklch, var(--primary) 12%, transparent)",
          color: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Gift size={24} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div
        data-slot="gift-card-balance-amount"
        style={{
          fontSize: "var(--text-2xl)",
          fontWeight: 600,
          color: "var(--foreground)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "var(--tracking-snug)",
        }}
      >
        {fmt(balance)} available
      </div>
      <div
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--muted-foreground)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {isPartial && typeof remainingOwedCents === "number" ? (
          <>
            Ticket needs {fmt(remainingOwedCents)} · split needed · card ending in{" "}
            {result.last4Mask}
          </>
        ) : (
          <>
            Card ending in {result.last4Mask}
            {result.kind === "zero_balance" ? " · Pick a different method to charge." : ""}
          </>
        )}
      </div>
    </div>
  );
}

function ActionsForResult({
  result,
  onRedeem,
  onCancel,
  onReenter,
  busy,
  isPartial,
}: {
  result: LookupGiftCardResult;
  onRedeem: () => void;
  onCancel: () => void;
  onReenter: () => void;
  busy: boolean;
  isPartial: boolean;
}) {
  if (result.kind === "not_found") {
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          data-slot="gift-card-balance-cancel"
          style={ghostBtn()}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onReenter}
          data-slot="gift-card-balance-reenter"
          style={primaryBtn(true)}
        >
          Re-enter number
        </button>
      </div>
    );
  }

  if (result.kind === "not_redeemable" || result.kind === "zero_balance") {
    return (
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button
          type="button"
          onClick={onCancel}
          data-slot="gift-card-balance-cancel"
          style={primaryBtn(true)}
        >
          Pick a different method
        </button>
      </div>
    );
  }

  // found — full or partial. Partial uses "Redeem available" copy so the
  // operator knows the gift card won't close the ticket on its own
  // (SC-003: single tap on the partial CTA still kicks off the split).
  const redeemLabel = busy ? "Redeeming…" : isPartial ? "Redeem available" : "Redeem";
  return (
    <div style={{ display: "flex", gap: "var(--space-2)" }}>
      <button
        type="button"
        onClick={onCancel}
        data-slot="gift-card-balance-cancel"
        disabled={busy}
        style={ghostBtn()}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onRedeem}
        disabled={busy}
        data-slot="gift-card-balance-redeem"
        style={primaryBtn(!busy)}
      >
        {redeemLabel}
      </button>
    </div>
  );
}

function primaryBtn(enabled: boolean): React.CSSProperties {
  return {
    flex: "1 1 auto",
    height: "var(--space-10)",
    padding: "0 var(--space-4)",
    background: enabled ? "var(--primary)" : "var(--muted)",
    color: enabled ? "var(--primary-foreground)" : "var(--muted-foreground)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-base)",
    fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    flex: "0 0 auto",
    height: "var(--space-10)",
    padding: "0 var(--space-4)",
    background: "transparent",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}
