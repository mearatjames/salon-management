// DoneScreen — terminal-state surface (FR-023). Rendered when
// `tickets.status === 'paid'`. Shows "Charged $X" + a "New sale" link.
//
// The "New sale" button is a `<Link href="/checkout">` — `/checkout` is the
// cart-building entry point (ephemeral cart, no eager ticket create). A
// fresh ticket row is materialized only when the operator commits a
// payment on the next sale.
//
// Server Component — no client JS needed.

import Link from "next/link";
import { Check } from "lucide-react";

export type DoneScreenProps = {
  chargedCents: number;
  /**
   * Payment method that closed the ticket. Drives the "Paid by …" line.
   * Defaults to "cash" for backwards-compatibility with the original
   * cash-only callsite; the card flow (015 Square Terminal) passes "card".
   */
  method?: "cash" | "card";
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const METHOD_LABEL: Record<NonNullable<DoneScreenProps["method"]>, string> = {
  cash: "Paid by cash",
  card: "Paid by card",
};

export function DoneScreen({ chargedCents, method = "cash" }: DoneScreenProps) {
  return (
    <div className="checkout-done" data-slot="done-screen">
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-12)",
          height: "var(--space-12)",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in oklch, var(--success) 14%, transparent)",
          color: "var(--success)",
        }}
      >
        <Check size={24} strokeWidth={1.5} />
      </span>
      <div>
        <div className="checkout-done-amount" data-slot="done-charged-amount">
          {fmt(chargedCents)}
        </div>
        <div
          style={{
            marginTop: "var(--space-2)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
          data-slot="done-method-line"
        >
          {METHOD_LABEL[method]}
        </div>
      </div>
      <Link
        href="/checkout"
        data-slot="new-sale-button"
        prefetch={false}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: "var(--space-10)",
          padding: "0 var(--space-5)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "none",
          marginTop: "var(--space-2)",
        }}
      >
        New sale
      </Link>
    </div>
  );
}
