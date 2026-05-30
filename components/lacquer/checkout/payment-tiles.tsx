"use client";

// PaymentTiles — compact 4-across row of payment methods
// (card | cash | gift | split). Adapted from
// `design-system/prototypes/transaction/components.jsx` § PaymentTiles,
// laid out per FlowSingle's `.tx-paytiles.compact` — one short
// horizontal row, card first — which is the canonical checkout
// reference (issue #90).
//
// US2 (feature 015) enables the Card tile when `squareConnected &&
// devicesAvailable >= 1`. When disabled, the tooltip explains why
// (connect Square or pair a device). The method-aware charge button
// (cash → "Take cash", card → "Send to Square") lives in the cart
// footer next to "Receipt" — see `checkout-screen.client.tsx` (issue #98).

import { Banknote, CreditCard, Gift, SplitSquareHorizontal } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PaymentMethod = "cash" | "card" | "gift" | "split";

export type PaymentTilesProps = {
  /** The currently selected method, or null when nothing is picked. */
  value: PaymentMethod | null;
  /** Fires only when an enabled tile is tapped. */
  onChange: (method: PaymentMethod) => void;
  /** Whether the salon has an active Square OAuth connection (US2). */
  squareConnected?: boolean;
  /** How many paired terminal devices are visible (US2). */
  devicesAvailable?: number;
  /**
   * Feature 018 — fired in addition to onChange('gift') when the Gift tile
   * is tapped. Surfaces the parent's "open GAN entry sheet" callback so
   * the gift-card flow can begin in one tap.
   */
  onPickGift?: () => void;
  /**
   * Feature 018 — fired when the Split tile is tapped. Split mode is more
   * of an "enter split-tender composition mode" action than a method pick;
   * the parent uses this to swap the cart footer to the split layout.
   */
  onPickSplit?: () => void;
};

type TileSpec = {
  id: PaymentMethod;
  label: string;
  icon: typeof Banknote;
  enabled: boolean;
  disabledReason?: string;
};

function tileStyle(active: boolean, enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-1)",
    padding: "var(--space-2)",
    background: active ? "color-mix(in oklch, var(--primary) 8%, var(--card))" : "var(--card)",
    border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    color: enabled ? "var(--foreground)" : "var(--muted-foreground)",
    cursor: enabled ? "pointer" : "not-allowed",
    minHeight: "var(--space-12)",
    fontSize: "var(--text-xs)",
    fontWeight: 500,
    opacity: enabled ? 1 : 0.6,
  };
}

export function PaymentTiles({
  value,
  onChange,
  squareConnected = false,
  devicesAvailable = 0,
  onPickGift,
  onPickSplit,
}: PaymentTilesProps) {
  const cardEnabled = squareConnected && devicesAvailable >= 1;
  const cardDisabledReason = !squareConnected
    ? "Connect Square in settings to accept cards"
    : devicesAvailable < 1
      ? "No Square Terminal paired — pair one in the Square Dashboard"
      : undefined;

  // Feature 018: Gift uses the same OAuth as Card (gated by squareConnected
  // only — gift redemption is a Payments-API call, not a Terminal call, so
  // device count is irrelevant). Split has no upstream dependency — it
  // just composes legs locally.
  const giftEnabled = squareConnected;
  const giftDisabledReason = !squareConnected
    ? "Connect Square in settings to accept gift cards"
    : undefined;

  // Tile order follows FlowSingle's `PAYMENT_METHODS` — card first
  // (issue #90). Selectors are keyed on `data-method`, not position, so
  // the order is purely visual.
  const tiles: ReadonlyArray<TileSpec> = [
    {
      id: "card",
      label: "Card",
      icon: CreditCard,
      enabled: cardEnabled,
      disabledReason: cardDisabledReason,
    },
    { id: "cash", label: "Cash", icon: Banknote, enabled: true },
    {
      id: "gift",
      label: "Gift",
      icon: Gift,
      enabled: giftEnabled,
      disabledReason: giftDisabledReason,
    },
    {
      id: "split",
      label: "Split",
      icon: SplitSquareHorizontal,
      enabled: true,
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="checkout-payment-tiles"
        data-slot="payment-tiles"
        role="radiogroup"
        aria-label="Payment method"
      >
        {tiles.map((t) => {
          const Icon = t.icon;
          const active = value === t.id;

          if (t.enabled) {
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active ? "true" : "false"}
                data-slot="payment-tile"
                data-method={t.id}
                onClick={() => {
                  onChange(t.id);
                  // Feature 018: extra side-callbacks for Gift + Split so
                  // the parent can open the GAN entry sheet / switch the
                  // cart footer to split-tender mode in one tap.
                  if (t.id === "gift" && onPickGift) onPickGift();
                  if (t.id === "split" && onPickSplit) onPickSplit();
                }}
                style={tileStyle(active, true)}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                {t.label}
              </button>
            );
          }

          return (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked="false"
                  aria-disabled="true"
                  data-slot="payment-tile"
                  data-method={t.id}
                  data-disabled="true"
                  onClick={(e) => e.preventDefault()}
                  style={tileStyle(false, false)}
                >
                  <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                  {t.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t.disabledReason ?? "Coming soon"}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
