"use client";

// MethodPickerPopover — second-leg method picker for the partial-gift
// auto-split flow (feature 018 / US3 / T052).
//
// Opens automatically after `redeemGiftCardWholeTicket` returns
// `{kind: 'partial_split', nextLegAmountCents}`. The operator picks a
// method (Cash / Card / Gift) for the remainder; the parent client
// island handles the actual `composeDraftLeg` + `activate*Draft` calls
// so the picker stays presentational.
//
// Dismissal (tap-outside or Cancel) closes the popover without writing
// any second draft — the cart's "Owes $Y" state remains visible via the
// regular `<SplitCartFooter/>`, where the operator can compose the
// second leg manually through the Add-leg affordance.
//
// Design system: token-only styling, Lucide icons (1.5px stroke), sentence
// case copy, no emoji, tabular numerals on currency.

import { Banknote, CreditCard, Gift } from "lucide-react";

export type MethodPickerMethod = "cash" | "card" | "gift";

export type MethodPickerPopoverProps = {
  /** The remaining-owed amount the second leg must cover, in cents. */
  amountCents: number;
  /** Operator picked a method — parent runs compose + activate. */
  onPick: (method: MethodPickerMethod) => void;
  /** Operator dismissed (tap-outside / Cancel) — close without composing. */
  onCancel: () => void;
  /** True while a downstream call is in flight; disables all tiles. */
  busy?: boolean;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type Tile = {
  method: MethodPickerMethod;
  label: string;
  icon: typeof Banknote;
};

const TILES: ReadonlyArray<Tile> = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "card", label: "Card", icon: CreditCard },
  { method: "gift", label: "Gift", icon: Gift },
];

export function MethodPickerPopover({
  amountCents,
  onPick,
  onCancel,
  busy = false,
}: MethodPickerPopoverProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a method for the remainder"
      data-slot="method-picker-popover"
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
        if (e.target === e.currentTarget && !busy) onCancel();
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Pick a method for the remainder
          </div>
          <div
            data-slot="method-picker-amount"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Owes {fmt(amountCents)}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "var(--space-2)",
          }}
        >
          {TILES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.method}
                type="button"
                onClick={() => onPick(t.method)}
                disabled={busy}
                data-slot="method-picker-tile"
                data-method={t.method}
                style={tileStyle(busy)}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          data-slot="method-picker-cancel"
          style={ghostBtn(busy)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function tileStyle(busy: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-1)",
    height: "var(--space-16)",
    padding: "var(--space-2)",
    background: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}

function ghostBtn(busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: "var(--space-10)",
    padding: "0 var(--space-4)",
    background: "transparent",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}
