// ReceiptDrawer — the right-side receipt detail drawer for the Transactions page.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (the `ReceiptDrawer` block). Renders a single `TransactionDetail`: a header
// (client, displayId, date + time), a meta section (assigned techs + cashier),
// an itemised line-item list, the subtotal/tip/total, a payment block, and a
// "sale completed" activity line.
//
// Scope (spec FR-014 / Out of Scope): NO tax row — tax is a reserved always-$0
// field in v1 and is never displayed. The payment block shows ONLY what the
// data model records (`method`, `amountCents`, `tipCents`) — no card last-four,
// auth codes, cash tendered/change, or gift codes. The prototype's
// Print / Email / Refund footer actions are out of scope and omitted.
//
// Dismissal (spec FR-015): the ✕ close control, a backdrop click, and the
// Escape key all call `onClose`. While the drawer is open the document body is
// scroll-locked. Both effects are torn down on unmount.
//
// Client Component (it owns the Escape listener + body scroll lock). All chrome
// lives in `styles/transactions.css` under `.tp-drawer*` / `.tp-d-*`. Numeric /
// currency values carry tabular numerals via the stylesheet (Constitution
// Principle I).

"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import type { Technician } from "@/lib/dashboard/aggregate";
import { formatCurrency } from "@/lib/dashboard/format";
import type { TransactionDetail } from "@/lib/transactions/aggregate";
import { formatDayLabel } from "@/lib/transactions/format";
import { MethodPill } from "@/components/lacquer/method-pill";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";
import { TechStack } from "@/components/lacquer/tech-stack";

export type ReceiptDrawerProps = {
  /** The transaction to render the receipt for. */
  transaction: TransactionDetail;
  /** Staff roster, for resolving tech avatars / names. */
  staff: readonly Technician[];
  /** Called for any of the three dismissal paths (✕, backdrop, Escape). */
  onClose: () => void;
};

// Human label for a payment-method marker — matches `<MethodPill>`'s wording.
const METHOD_LABEL: Record<TransactionDetail["method"], string> = {
  card: "Card",
  cash: "Cash",
  gift: "Gift card",
  split: "Split payment",
};

// The first name of a staff member, for the per-line tech chip.
function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] ?? displayName;
}

export function ReceiptDrawer({ transaction, staff, onClose }: ReceiptDrawerProps) {
  // Escape closes the drawer; the document body is scroll-locked while open.
  // Both are registered together and torn down on unmount so a remount for a
  // different transaction never leaks a listener or a stuck `overflow`.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const staffById = new Map(staff.map((member) => [member.id, member]));
  const dayLabel = formatDayLabel(transaction.dayKey);
  const cashier = transaction.cashierName ?? "Unknown";

  // The payment block shows one row per recorded payment. `deriveMethod`
  // already resolved the drawer-level marker; each line keeps its own method.
  const totalAmountCents = transaction.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const totalTipCents = transaction.payments.reduce((sum, p) => sum + p.tipCents, 0);

  return (
    <>
      <div
        className="tp-drawer-backdrop"
        data-slot="receipt-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="tp-drawer"
        role="dialog"
        aria-label="Receipt detail"
        data-slot="receipt-drawer"
        data-tx-id={transaction.id}
      >
        <div className="tp-drawer-h">
          <div>
            <div className="ttl">{transaction.client}</div>
            <div className="sub">
              {transaction.displayId} · {dayLabel} · {transaction.time}
            </div>
          </div>
          <button
            type="button"
            className="tp-drawer-close"
            onClick={onClose}
            aria-label="Close"
            data-slot="receipt-drawer-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="tp-drawer-body">
          {/* Meta — assigned techs + cashier */}
          <div className="tp-d-section">
            <div className="tp-d-meta">
              <span className="k">Techs</span>
              <span
                className="v"
                style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)" }}
                data-slot="receipt-techs"
              >
                {transaction.techIds.length > 0 ? (
                  <TechStack staff={staff} ids={transaction.techIds} size={20} />
                ) : (
                  "—"
                )}
              </span>
              <span className="k">Cashier</span>
              <span className="v" data-slot="receipt-cashier">
                {cashier}
              </span>
            </div>
          </div>

          {/* Line items */}
          <div className="tp-d-section">
            <div className="h">Items ({transaction.serviceCount})</div>
            <div data-slot="receipt-items">
              {transaction.items.map((item, index) => {
                const tech = item.techId ? staffById.get(item.techId) : undefined;
                return (
                  <div key={index} className="tp-d-line" data-slot="receipt-item">
                    <div>
                      <div className="nm">{item.name}</div>
                      <div className="meta">
                        {item.category ? <span>{item.category}</span> : null}
                        {item.category && tech ? <span aria-hidden="true">·</span> : null}
                        {tech ? (
                          <span className="tp-d-tech-chip">
                            <InitialsAvatar
                              name={tech.displayName}
                              colorToken={tech.colorToken}
                              size={14}
                            />{" "}
                            {firstName(tech.displayName)}
                          </span>
                        ) : null}
                        {item.qty > 1 ? <span>· qty {item.qty}</span> : null}
                      </div>
                    </div>
                    <div className="price">{formatCurrency(item.lineTotalCents / 100)}</div>
                  </div>
                );
              })}
            </div>
            <div className="tp-d-totals">
              <div className="row">
                <span className="k">Subtotal</span>
                <span data-slot="receipt-subtotal">
                  {formatCurrency(transaction.subtotalCents / 100)}
                </span>
              </div>
              <div className="row">
                <span className="k">Tip</span>
                <span data-slot="receipt-tip">{formatCurrency(transaction.tipCents / 100)}</span>
              </div>
              <div className="row total">
                <span>Total</span>
                <span data-slot="receipt-total">
                  {formatCurrency(transaction.totalCents / 100)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment — only what the data model records (method + amount +
              tip); no card last-four, auth codes, or cash tendered/change. */}
          <div className="tp-d-section">
            <div className="h">Payment</div>
            <div className="tp-d-pay" data-slot="receipt-payment">
              <div className="body">
                <div
                  className="lbl"
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
                >
                  <MethodPill method={transaction.method} />
                  <span data-slot="receipt-payment-method">{METHOD_LABEL[transaction.method]}</span>
                </div>
                {totalTipCents > 0 ? (
                  <div className="sub">Incl. {formatCurrency(totalTipCents / 100)} tip</div>
                ) : null}
              </div>
              <div className="amt" data-slot="receipt-payment-amount">
                {formatCurrency((totalAmountCents + totalTipCents) / 100)}
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="tp-d-section">
            <div className="h">Activity</div>
            <div className="tp-d-activity">
              <div className="row active">
                <span className="dot" />
                <div className="body">
                  <span data-slot="receipt-activity">
                    Sale completed by <b>{cashier}</b>
                  </span>
                  <div className="t">
                    {dayLabel} · {transaction.time}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
