import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

export type NewTransactionCTAProps = {
  href?: string;
};

// Server component — primary header CTA. Renders a Next <Link> styled with
// `.tx-cta-primary` from `styles/dashboard.css`. Adapted from
// `design-system/prototypes/transaction/Landing.jsx:138-145` (the anchor
// swap, and the secondary "Charge a sale" sub-line dropped — the icon, the
// label, and the chevron now sit on one centered row). All color / radius /
// shadow / spacing resolves to tokens via the CSS class (Constitution
// Principle I). FR-008 / SC-002.
export function NewTransactionCTA({ href = "/checkout" }: NewTransactionCTAProps) {
  return (
    <Link href={href} className="tx-cta-primary" data-slot="new-transaction-cta">
      <span className="icon" aria-hidden="true">
        <Plus size={20} strokeWidth={1.5} />
      </span>
      <span>New transaction</span>
      <ChevronRight
        size={18}
        strokeWidth={1.5}
        style={{ marginLeft: "auto", opacity: 0.7 }}
        aria-hidden="true"
      />
    </Link>
  );
}
