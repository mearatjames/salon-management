"use client";

// PaymentTiles — 2×2 grid of payment methods (cash | card | gift | split).
// Adapted from `design-system/prototypes/transaction/components.jsx`
// § PaymentTiles. For v1 only `cash` is enabled (FR-017); the other three
// render with `aria-disabled="true"` and a Lacquer tooltip "Coming soon".
//
// The active method is highlighted with the primary ring; disabled tiles
// are visually muted but remain in the IA so the operator can see what
// will come later.

import { Banknote, CreditCard, Gift, SplitSquareHorizontal } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PaymentMethod = "cash" | "card" | "gift" | "split";

export type PaymentTilesProps = {
  /** The currently selected method, or null when nothing is picked. */
  value: PaymentMethod | null;
  /** Fires only when an enabled tile is tapped (currently only "cash"). */
  onChange: (method: PaymentMethod) => void;
};

type TileSpec = {
  id: PaymentMethod;
  label: string;
  icon: typeof Banknote;
  enabled: boolean;
};

const TILES: ReadonlyArray<TileSpec> = [
  { id: "cash", label: "Cash", icon: Banknote, enabled: true },
  { id: "card", label: "Card", icon: CreditCard, enabled: false },
  { id: "gift", label: "Gift", icon: Gift, enabled: false },
  { id: "split", label: "Split", icon: SplitSquareHorizontal, enabled: false },
];

function tileStyle(active: boolean, enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-1)",
    padding: "var(--space-3)",
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

export function PaymentTiles({ value, onChange }: PaymentTilesProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="checkout-payment-tiles"
        data-slot="payment-tiles"
        role="radiogroup"
        aria-label="Payment method"
      >
        {TILES.map((t) => {
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
                onClick={() => onChange(t.id)}
                style={tileStyle(active, true)}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                {t.label}
              </button>
            );
          }

          // Disabled: render the tile but wrap in a tooltip explaining why.
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
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
