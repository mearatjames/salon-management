import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

export type NewTransactionCTAProps = {
  href?: string;
  sub?: string;
};

// Server component — primary header CTA. Renders a Next <Link> styled with
// `.tx-cta-primary` from `styles/dashboard.css`. The internal markup mirrors
// `design-system/prototypes/transaction/Landing.jsx:138-145` verbatim modulo
// the anchor swap. All color / radius / shadow / spacing resolves to tokens
// via the CSS class (Constitution Principle I). FR-008 / SC-002.
export function NewTransactionCTA({
  href = "/checkout",
  sub = "Charge a sale",
}: NewTransactionCTAProps) {
  return (
    <Link href={href} className="tx-cta-primary" data-slot="new-transaction-cta">
      <span className="icon" aria-hidden="true">
        <Plus size={20} strokeWidth={1.5} />
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
        }}
      >
        <span>New transaction</span>
        <span className="sub">{sub}</span>
      </span>
      <ChevronRight
        size={18}
        strokeWidth={1.5}
        style={{ marginLeft: "auto", opacity: 0.7 }}
        aria-hidden="true"
      />
    </Link>
  );
}
