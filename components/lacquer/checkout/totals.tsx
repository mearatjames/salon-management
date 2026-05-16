// Totals — three-row block: subtotal, tax, total. Tabular numerals on
// every dollar value (Constitution Principle I). Server-renderable; no
// state of its own — the parent re-derives from `computeTotals` (lib/pos/cart).
//
// FR-020: tax is always 0 in this phase. The row is kept in the layout so
// when a later phase activates it the spacing doesn't jump.

export type TotalsProps = {
  subtotalCents: number;
  taxCents: 0 | number;
  totalCents: number;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Totals({ subtotalCents, taxCents, totalCents }: TotalsProps) {
  return (
    <div className="checkout-totals" data-slot="checkout-totals">
      <div className="checkout-total-row">
        <span style={{ color: "var(--muted-foreground)" }}>Subtotal</span>
        <span
          className="checkout-total-amount tnum"
          data-slot="checkout-subtotal-amount"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmt(subtotalCents)}
        </span>
      </div>
      <div className="checkout-total-row">
        <span style={{ color: "var(--muted-foreground)" }}>Tax</span>
        <span
          className="checkout-total-amount tnum"
          data-slot="checkout-tax-amount"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmt(taxCents)}
        </span>
      </div>
      <div className="checkout-total-row is-grand">
        <span>Total</span>
        <span
          className="checkout-total-amount tnum"
          data-slot="checkout-total-amount"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {fmt(totalCents)}
        </span>
      </div>
    </div>
  );
}
