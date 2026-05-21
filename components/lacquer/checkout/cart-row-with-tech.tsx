"use client";

// CartRowWithTech — adapted from `design-system/prototypes/transaction/components.jsx`
// § CartRowWithTech.
//
// US3 (T038) wraps the chip in a Radix Popover so the operator can
// reassign tech for one line without changing the header pick or other
// lines (FR-013). Composition is unchanged otherwise — line name on top,
// snapshotted price + tech chip + (optional) "Set price" hint below; on
// the right, line total (tabular numerals) and a remove button.
//
// The popover content is a vertical list of active staff that mirrors
// `tech-avatar-row.tsx`'s post-pick chip visual so the two surfaces feel
// consistent. The currently-assigned staff item is marked aria-disabled +
// data-current="true" so the no-op tap is impossible (the disabled state
// guards both the click handler and screen-reader output).

import { useState } from "react";

import { ChevronDown, X, Edit3 } from "lucide-react";

import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type CartLineView = {
  /** May be a temp id during optimistic insert; the row is keyed by this. */
  id: string;
  /** US3 widening: `null` for discount rows (no underlying service). */
  serviceId: string | null;
  name: string;
  /** Negative for discount rows. */
  unitPriceCents: number;
  qty: number;
  /** Always false for discount rows. */
  priceUnconfirmed: boolean;
  /** US3 widening: `null` for discount rows (CHECK-enforced server-side). */
  assignedStaffId: string | null;
  /**
   * Variable-price metadata snapshotted from the source service at insert
   * time. Carries the bounds, the operator note, and any preset chips —
   * everything the `<PriceSheet/>` needs to render the context note and
   * the quick-pick row without a second round trip. `null` for lines
   * where the source service is fixed-price OR for rows whose tile data
   * is not in scope (e.g., the initial server-loaded items list, which
   * page.tsx hydrates from a partial select; the operator can still
   * override the price — the sheet just renders without preset chips
   * and uses the generic "Adjust price for this sale" context note).
   */
  serviceMeta?: {
    variable: boolean;
    priceFromCents: number | null;
    priceToCents: number | null;
    variableNote: string | null;
    presets: Array<{ label: string; price_cents: number }> | null;
  } | null;
  // ----------------------------------------------------------------------
  // US3 (T030/T031) additions for discount-row rendering.
  // ----------------------------------------------------------------------
  /** Row kind discriminator. Service rows render the existing tech-chip layout;
   *  discount rows render the negative-amount layout (no chip, no price edit). */
  kind: "service" | "discount";
  /** Operator-entered note (≤ 80 chars). Present on discount rows when the
   *  operator filled the note field; null otherwise. Always null on service rows. */
  note: string | null;
  /** Whole-percent value (1..100) for percent-shape discounts; null for flat
   *  discounts AND for all service rows. */
  discountPct: number | null;
};

type ActiveStaff = {
  id: string;
  display_name: string;
  color_token: string;
};

export type CartRowWithTechProps = {
  line: CartLineView;
  /** Lookup table: assignedStaffId → staff row (for the chip label/color). */
  staffById: Map<string, ActiveStaff>;
  onRemove: () => void;
  /** Opens the variable-price placeholder dialog (FR-016). */
  onEditPrice: () => void;
  /**
   * Per-line tech reassignment (FR-013). Called when the operator picks a
   * different staff from the chip popover. Receives the new staff id.
   * Optional so callers that don't yet wire it (back-compat) still compile;
   * when omitted, the popover behaves as a read-only preview of the roster.
   */
  onSetTech?: (staffId: string) => void;
};

function fmtMoney(cents: number): string {
  // US3: discount-row totals are negative; render as "-$X.XX" not "$-X.XX".
  if (cents < 0) return `-$${(Math.abs(cents) / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function CartRowWithTech({
  line,
  staffById,
  onRemove,
  onEditPrice,
  onSetTech,
}: CartRowWithTechProps) {
  // Controlled Popover state so the item-pick handler can dismiss the
  // overlay after firing `onSetTech` (Radix Content does NOT auto-close on
  // inner button clicks). Declared at the top of the component so the hook
  // order stays stable across the kind='service' vs kind='discount' branches
  // (react-hooks/rules-of-hooks).
  const [popoverOpen, setPopoverOpen] = useState(false);

  // ----------------------------------------------------------------------
  // US3 (T030): discount-row branch. Discount rows render WITHOUT the tech
  // chip, WITHOUT a price-edit button (setLinePrice throws on kind='discount'
  // — caught in Phase 3), and with the amount in the destructive token.
  // Remove is wired to the parent's `onRemove` callback (the parent picks
  // the right Server Action — `removeDiscountLine` for kind='discount',
  // `removeLine` for kind='service' — based on the line.kind it dispatched).
  // ----------------------------------------------------------------------
  if (line.kind === "discount") {
    const amountCents = line.unitPriceCents * line.qty;
    return (
      <div
        data-slot="cart-line"
        data-line-id={line.id}
        data-line-kind="discount"
        data-needs-price="false"
        className="checkout-line"
      >
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div
            className="checkout-line-name"
            data-slot="cart-line-name"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--destructive)",
            }}
          >
            {line.name}
          </div>
          {line.note ? (
            <div
              data-slot="cart-line-note"
              style={{
                marginTop: "var(--space-1)",
                fontSize: "var(--text-xs)",
                color: "var(--muted-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {line.note}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            data-slot="cart-line-price"
            style={{
              padding: "var(--space-1) var(--space-2)",
              color: "var(--destructive)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtMoney(amountCents)}
          </span>
          <button
            type="button"
            onClick={onRemove}
            data-slot="cart-line-remove"
            aria-label={`Remove ${line.name} from cart`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "var(--space-6)",
              height: "var(--space-6)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              color: "var(--muted-foreground)",
            }}
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // Service-row path (unchanged from US1/US2).
  const staff = line.assignedStaffId != null ? staffById.get(line.assignedStaffId) : undefined;
  const lineTotalCents = line.unitPriceCents * line.qty;
  const needsPrice = line.priceUnconfirmed;

  // Sort the staff roster by display_name for a stable popover order.
  // (The Map insertion order from the caller is not guaranteed alphabetical.)
  const roster: ActiveStaff[] = [];
  for (const s of staffById.values()) roster.push(s);
  roster.sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div
      data-slot="cart-line"
      data-line-id={line.id}
      data-line-kind="service"
      data-service-id={line.serviceId ?? undefined}
      data-needs-price={needsPrice ? "true" : "false"}
      className="checkout-line"
    >
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div
          className="checkout-line-name"
          data-slot="cart-line-name"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {line.name}
        </div>
        <div
          style={{
            marginTop: "var(--space-1)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            flexWrap: "wrap",
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
          }}
        >
          {staff ? (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-slot="cart-line-tech-chip"
                  data-staff-id={staff.id}
                  aria-label={`Tech: ${staff.display_name}. Tap to reassign.`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-1) var(--space-2)",
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-full)",
                    color: "var(--foreground)",
                    fontWeight: 500,
                    fontSize: "var(--text-xs)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: "var(--space-2)",
                      height: "var(--space-2)",
                      borderRadius: "var(--radius-full)",
                      background: `var(${staff.color_token})`,
                    }}
                  />
                  {staff.display_name}
                  <ChevronDown
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    style={{ marginLeft: "var(--space-1)", color: "var(--muted-foreground)" }}
                  />
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
                  {roster.map((candidate) => {
                    const isCurrent = candidate.id === line.assignedStaffId;
                    return (
                      <li key={candidate.id} style={{ margin: 0 }}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isCurrent}
                          aria-disabled={isCurrent || undefined}
                          data-slot="tech-popover-item"
                          data-staff-id={candidate.id}
                          data-current={isCurrent ? "true" : undefined}
                          onClick={(ev) => {
                            // No-op guard — the currently assigned tech is
                            // a "current pick" indicator, not a re-fire of
                            // the same write. The popover stays open so the
                            // operator can pick a different item.
                            if (isCurrent) {
                              ev.preventDefault();
                              ev.stopPropagation();
                              return;
                            }
                            onSetTech?.(candidate.id);
                            setPopoverOpen(false);
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
                            name={candidate.display_name}
                            colorToken={candidate.color_token}
                            size={24}
                          />
                          <span style={{ flex: "1 1 auto" }}>{candidate.display_name}</span>
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
          ) : null}
          {needsPrice ? (
            <span
              data-slot="cart-line-needs-price"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                color: "var(--primary)",
                fontWeight: 500,
              }}
            >
              <Edit3 size={16} strokeWidth={1.5} aria-hidden="true" />
              Set price
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button
          type="button"
          onClick={onEditPrice}
          data-slot="cart-line-price"
          className={"checkout-line-price-edit" + (needsPrice ? " is-unconfirmed" : "")}
          aria-label={needsPrice ? "Set price for this line" : "Edit price for this line"}
        >
          <Edit3 size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="checkout-line-price">{fmtMoney(lineTotalCents)}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          data-slot="cart-line-remove"
          aria-label={`Remove ${line.name} from cart`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "var(--space-6)",
            height: "var(--space-6)",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            color: "var(--muted-foreground)",
          }}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
