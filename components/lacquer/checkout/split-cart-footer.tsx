"use client";

// SplitCartFooter — replaces the default cart footer when the operator
// enters split-tender mode (feature 018, US2).
//
// Adapted from `design-system/prototypes/transaction/FlowSingle.jsx:220–266`
// (single-tender footer). The split mode swaps the PaymentTiles + single
// Charge button for:
//   - Running totals strip: "Paid $X of $Y · Owes $Z"
//   - Vertical list of `<PaymentLegRow/>` entries (one per leg).
//   - "Add leg" affordance: a small inline composer that takes an amount
//     and a method-tile pick, then calls `onComposeLeg(method, amountCents)`.
//   - "Exit split" affordance: visible only when no leg has succeeded yet.
//     Calls `onExitSplit()` — the parent wipes all drafts (one
//     `removeDraftLeg` per draft) and swaps the footer back to the default.
//
// Design system: token-only, tabular numerals on every numeric column.

import { useState } from "react";

import { Banknote, CreditCard, Gift, Plus } from "lucide-react";

import { PaymentLegRow, type PaymentLegRowView } from "./payment-leg-row";

function ComposerMethodGlyph({ method }: { method: "cash" | "card" | "gift" }) {
  // Same rationale as PaymentLegRow's MethodGlyph — conditional render
  // keeps each Lucide component reference stable across renders.
  if (method === "cash") return <Banknote size={20} strokeWidth={1.5} aria-hidden="true" />;
  if (method === "card") return <CreditCard size={20} strokeWidth={1.5} aria-hidden="true" />;
  return <Gift size={20} strokeWidth={1.5} aria-hidden="true" />;
}

export type SplitCartFooterProps = {
  ticketTotalCents: number;
  /** All non-failed legs on this ticket, in insertion order. */
  legs: PaymentLegRowView[];
  /** True while a leg activation is in flight (parent locks the footer). */
  busy?: boolean;
  /** Compose a new draft leg (amount in cents). */
  onComposeLeg: (method: "cash" | "card" | "gift", amountCents: number) => void;
  /** Remove an existing draft leg. */
  onRemoveDraft: (paymentId: string) => void;
  /** Wipe every draft and return to single-tender mode. */
  onExitSplit: () => void;
  /** Activation callbacks — forwarded to <PaymentLegRow/>. */
  onActivateCash: (paymentId: string) => void;
  onActivateCard: (paymentId: string) => void;
  onActivateGift: (paymentId: string) => void;
  /** Whether the Gift method is available (Square connected). */
  giftEnabled?: boolean;
  /** Whether the Card method is available (Square connected + paired device). */
  cardEnabled?: boolean;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseAmountInput(raw: string): number | null {
  // Accept either plain digits (treated as cents) or a "$X.YY" decimal —
  // we'll convert to cents either way. Returns null when the input is
  // empty / negative / malformed.
  const trimmed = raw.trim().replace(/^\$/, "");
  if (trimmed.length === 0) return null;
  const asFloat = Number.parseFloat(trimmed);
  if (!Number.isFinite(asFloat) || asFloat <= 0) return null;
  return Math.round(asFloat * 100);
}

export function SplitCartFooter({
  ticketTotalCents,
  legs,
  busy = false,
  onComposeLeg,
  onRemoveDraft,
  onExitSplit,
  onActivateCash,
  onActivateCard,
  onActivateGift,
  giftEnabled = true,
  cardEnabled = true,
}: SplitCartFooterProps) {
  // Composer state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerAmount, setComposerAmount] = useState<string>("");
  const [composerMethod, setComposerMethod] = useState<"cash" | "card" | "gift">("cash");

  // Totals — paid (succeeded only), owed (total - paid - reserved drafts/pending).
  // The "Owes" line shows what's left to allocate; drafts already count
  // against the remaining bucket so the operator can't compose too many.
  const paidCents = legs
    .filter((l) => l.status === "succeeded")
    .reduce((sum, l) => sum + l.amountCents, 0);
  const reservedCents = legs
    .filter((l) => l.status === "draft" || l.status === "pending")
    .reduce((sum, l) => sum + l.amountCents, 0);
  const owedCents = Math.max(0, ticketTotalCents - paidCents - reservedCents);

  const anyPending = legs.some((l) => l.status === "pending");
  const anySucceeded = legs.some((l) => l.status === "succeeded");
  const ticketLocked = busy || anyPending;
  const canExitSplit = !anySucceeded && !anyPending && !busy;

  function handleComposeSubmit() {
    const amountCents = parseAmountInput(composerAmount);
    if (amountCents == null) return;
    if (amountCents > owedCents) return;
    if (composerMethod === "card" && !cardEnabled) return;
    if (composerMethod === "gift" && !giftEnabled) return;
    onComposeLeg(composerMethod, amountCents);
    // Reset + close composer on submit. The parent will surface server
    // errors via the existing banner / toast paths.
    setComposerAmount("");
    setComposerOpen(false);
  }

  return (
    <div
      data-slot="split-cart-footer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-3) 0",
      }}
    >
      {/* Running totals strip — "Paid $X of $Y · Owes $Z". */}
      <div
        data-slot="split-totals"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--muted)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          color: "var(--foreground)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span data-slot="split-paid">
          Paid <strong style={{ fontWeight: 600 }}>{fmt(paidCents)}</strong> of{" "}
          <strong style={{ fontWeight: 600 }}>{fmt(ticketTotalCents)}</strong>
        </span>
        <span
          data-slot="split-owed"
          style={{
            color: owedCents === 0 ? "var(--primary)" : "var(--muted-foreground)",
            fontWeight: 500,
          }}
        >
          Owes <strong style={{ fontWeight: 600 }}>{fmt(owedCents)}</strong>
        </span>
      </div>

      {/* Leg list. */}
      <div
        data-slot="split-leg-list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {legs.length === 0 ? (
          <p
            data-slot="split-leg-empty"
            style={{
              margin: 0,
              padding: "var(--space-3) 0",
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              textAlign: "center",
            }}
          >
            Add a leg to start splitting the bill.
          </p>
        ) : (
          legs.map((leg) => (
            <PaymentLegRow
              key={leg.id}
              leg={leg}
              ticketLocked={ticketLocked}
              onActivateCash={onActivateCash}
              onActivateCard={onActivateCard}
              onActivateGift={onActivateGift}
              onRemoveDraft={onRemoveDraft}
            />
          ))
        )}
      </div>

      {/* Composer + Exit-split affordances. */}
      {composerOpen ? (
        <div
          data-slot="split-composer"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            padding: "var(--space-3)",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {/* Amount input. */}
          <label
            data-slot="split-composer-amount-label"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)",
              fontSize: "var(--text-xs)",
              color: "var(--muted-foreground)",
              fontWeight: 500,
            }}
          >
            Amount
            <input
              type="text"
              inputMode="decimal"
              data-slot="split-composer-amount"
              value={composerAmount}
              onChange={(e) => setComposerAmount(e.target.value)}
              placeholder={fmt(owedCents)}
              autoFocus
              style={{
                height: "var(--space-10)",
                padding: "0 var(--space-3)",
                background: "var(--background)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-base)",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </label>

          {/* Method tile picker. */}
          <div
            data-slot="split-composer-methods"
            role="radiogroup"
            aria-label="Leg payment method"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "var(--space-1)",
            }}
          >
            {(
              [
                { id: "cash", label: "Cash", enabled: true },
                { id: "card", label: "Card", enabled: cardEnabled },
                { id: "gift", label: "Gift", enabled: giftEnabled },
              ] as const
            ).map((m) => {
              const active = composerMethod === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active ? "true" : "false"}
                  data-slot="split-composer-method"
                  data-method={m.id}
                  disabled={!m.enabled}
                  onClick={() => setComposerMethod(m.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-2)",
                    background: active
                      ? "color-mix(in oklch, var(--primary) 8%, var(--card))"
                      : "var(--card)",
                    border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: m.enabled ? "var(--foreground)" : "var(--muted-foreground)",
                    fontSize: "var(--text-xs)",
                    fontWeight: 500,
                    cursor: m.enabled ? "pointer" : "not-allowed",
                    opacity: m.enabled ? 1 : 0.6,
                  }}
                >
                  <ComposerMethodGlyph method={m.id} />
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Composer actions. */}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              type="button"
              data-slot="split-composer-cancel"
              onClick={() => {
                setComposerAmount("");
                setComposerOpen(false);
              }}
              style={{
                flex: "0 0 auto",
                height: "var(--space-10)",
                padding: "0 var(--space-3)",
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-slot="split-composer-submit"
              onClick={handleComposeSubmit}
              disabled={
                busy ||
                parseAmountInput(composerAmount) == null ||
                (parseAmountInput(composerAmount) ?? 0) > owedCents
              }
              style={{
                flex: "1 1 auto",
                height: "var(--space-10)",
                padding: "0 var(--space-3)",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                cursor: "pointer",
                opacity:
                  busy ||
                  parseAmountInput(composerAmount) == null ||
                  (parseAmountInput(composerAmount) ?? 0) > owedCents
                    ? 0.5
                    : 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Add leg
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            data-slot="split-add-leg"
            onClick={() => setComposerOpen(true)}
            disabled={ticketLocked || owedCents === 0}
            style={{
              flex: "1 1 auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-1)",
              height: "var(--space-10)",
              padding: "0 var(--space-3)",
              background: "var(--card)",
              color: "var(--foreground)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: ticketLocked || owedCents === 0 ? "not-allowed" : "pointer",
              opacity: ticketLocked || owedCents === 0 ? 0.5 : 1,
            }}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Add leg
          </button>

          {canExitSplit ? (
            <button
              type="button"
              data-slot="split-exit"
              onClick={onExitSplit}
              style={{
                flex: "0 0 auto",
                height: "var(--space-10)",
                padding: "0 var(--space-3)",
                background: "transparent",
                color: "var(--muted-foreground)",
                border: "none",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Exit split
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
