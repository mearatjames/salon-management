import { Wallet } from "lucide-react";
import { formatCurrency, paymentMixWidths } from "@/lib/dashboard/format";

export type PaymentMixCardProps = {
  byMethod: { card: number; cash: number; gift: number };
  total: number;
};

const METHODS = [
  { id: "card" as const, label: "Card" },
  { id: "cash" as const, label: "Cash" },
  { id: "gift" as const, label: "Gift card" },
];

// Server component — payment-mix tile inside the stat grid. Spans two columns
// in the parent grid (the parent owns the `gridColumn` style). Mirrors
// `design-system/prototypes/transaction/Landing.jsx` lines 72–101. FR-018:
// when `paymentMixWidths` reports `neutral === 100`, the bar renders as a
// single muted segment.
export function PaymentMixCard({ byMethod, total }: PaymentMixCardProps) {
  const widths = paymentMixWidths(byMethod, total);
  const isNeutral = widths.neutral === 100;

  return (
    <div className="tx-stat-card" data-slot="payment-mix-card" style={{ minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div className="lbl">Payment mix</div>
        <div style={{ color: "var(--muted-foreground)" }} aria-hidden="true">
          <Wallet size={14} strokeWidth={1.5} />
        </div>
      </div>
      <div className="tx-method-bar" style={{ marginTop: 4 }}>
        {isNeutral ? (
          <span style={{ width: "100%", background: "var(--muted)" }} />
        ) : (
          METHODS.map((m) => (
            <span key={m.id} className={m.id} style={{ width: `${widths[m.id]}%` }} />
          ))
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 6,
        }}
      >
        {METHODS.map((m) => (
          <div key={m.id} className="tx-method-row">
            <span className="nm">
              <span className={`dot ${m.id}`} />
              {m.label}
            </span>
            <span className="num tnum">{formatCurrency(byMethod[m.id])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
