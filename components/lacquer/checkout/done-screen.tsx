// DoneScreen — terminal-state surface (FR-023). Rendered when
// `tickets.status === 'paid'`. Shows "Charged $X", a payment summary
// line, and a three-action row (Dashboard / New transaction / Switch
// staff).
//
// "New transaction" is a `<Link href="/checkout">` — the paramless
// `/checkout` page (`app/(studio)/checkout/page.tsx`) renders a fresh
// ephemeral in-memory draft cart directly. No ticket is created up front;
// nothing is persisted until "Take cash".
//
// Server Component — `SwitchStaffButton` is a client component rendered
// as a child, so the surface itself needs no client JS.

import Link from "next/link";
import { Check, LayoutDashboard, Plus } from "lucide-react";

import { SwitchStaffButton } from "@/components/lacquer/switch-staff-button";
import { VoidConfirmDialog } from "@/components/lacquer/checkout/void-confirm-dialog";

export type DoneScreenProps = {
  chargedCents: number;
  /**
   * Payment method that closed the ticket. Drives the "Paid by …" line.
   * Defaults to "cash" for backwards-compatibility with the original
   * cash-only callsite; the Square flows pass "card" / "gift".
   */
  method?: "cash" | "card" | "gift";
  /**
   * Tip captured on the Square Terminal, in cents. Card / gift only —
   * cash tips aren't reported to the salon, so the cash callsite passes
   * `null` and the detail line stays a bare "Paid by cash".
   */
  tipCents?: number | null;
  /** Tip as a whole-number percent of the pre-tip amount. Card / gift only. */
  tipPercent?: number | null;
  /** Masked last-4 of the card / gift card, when known (`•••• 4242`). */
  last4?: string | null;
  /** Square payment / terminal-checkout reference id — Square-settled only. */
  reference?: string | null;
  /**
   * Feature 052 (US1) — when present, render the owner/manager "Void sale"
   * affordance + confirmation dialog. The parent (the `/checkout/[ticketId]`
   * page) computes eligibility server-side: viewer role ∈ {owner, manager}
   * AND the ticket is same-day paid (salon-local `closed_at`) AND not
   * already reversed. `null`/omitted → no affordance (technicians,
   * prior-day sales, already-reversed tickets).
   */
  voidAffordance?: { ticketId: string; chargedCents: number } | null;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const METHOD_LABEL: Record<NonNullable<DoneScreenProps["method"]>, string> = {
  cash: "Paid by cash",
  card: "Paid by card",
  gift: "Paid by gift card",
};

export function DoneScreen({
  chargedCents,
  method = "cash",
  tipCents = null,
  tipPercent = null,
  last4 = null,
  reference = null,
  voidAffordance = null,
}: DoneScreenProps) {
  // Card + gift settle on the Square Terminal, which collects the tip and
  // returns a payment reference; cash is handled in-app with no tip line.
  const isSquareSettled = method === "card" || method === "gift";

  let detailLine = METHOD_LABEL[method];
  if (isSquareSettled) {
    if (last4) detailLine += ` •••• ${last4}`;
    if (tipCents != null) {
      detailLine += ` · tip ${fmt(tipCents)}`;
      if (tipPercent != null) detailLine += ` (${tipPercent}%)`;
    }
  }

  return (
    <div className="checkout-done" data-slot="done-screen">
      <span aria-hidden="true" className="checkout-done-check">
        <Check size={24} strokeWidth={1.5} />
      </span>
      <div>
        <div className="checkout-done-amount" data-slot="done-charged-amount">
          {fmt(chargedCents)}
        </div>
        <div className="checkout-done-detail" data-slot="done-method-line">
          {detailLine}
        </div>
        {reference && (
          <div className="checkout-done-reference" data-slot="done-reference-line">
            Square ref {reference}
          </div>
        )}
      </div>
      <div className="checkout-done-actions" data-slot="done-actions">
        <Link
          href="/dashboard"
          data-slot="dashboard-button"
          prefetch={false}
          className="checkout-done-action checkout-done-action--secondary"
        >
          <LayoutDashboard size={16} strokeWidth={1.5} aria-hidden="true" />
          Dashboard
        </Link>
        <Link
          href="/checkout"
          data-slot="new-transaction-button"
          prefetch={false}
          className="checkout-done-action checkout-done-action--primary"
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          New transaction
        </Link>
        <SwitchStaffButton />
      </div>
      {voidAffordance && (
        <div className="checkout-done-void" data-slot="done-void">
          <VoidConfirmDialog
            ticketId={voidAffordance.ticketId}
            chargedCents={voidAffordance.chargedCents}
          />
        </div>
      )}
    </div>
  );
}
