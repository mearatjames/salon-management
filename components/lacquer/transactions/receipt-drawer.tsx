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
import type { StudioRole } from "@/lib/auth/session";
import type { TransactionDetail } from "@/lib/transactions/aggregate";
import { formatDayLabel } from "@/lib/transactions/format";
import { MethodPill } from "@/components/lacquer/method-pill";
import { TechStack } from "@/components/lacquer/tech-stack";
import { ReceiptLineTechChip } from "@/components/lacquer/transactions/receipt-line-tech-chip";
import { RefundEntry } from "@/components/lacquer/transactions/refund-entry.client";

export type ReceiptDrawerProps = {
  /** The transaction to render the receipt for. */
  transaction: TransactionDetail;
  /** Staff roster, for resolving tech avatars / names. */
  staff: readonly Technician[];
  /**
   * Feature 050: the viewer's role. Owner + manager get the per-line
   * "Change" trigger (mode 2 of `<ReceiptLineTechChip>`); every other
   * role gets the read-only chip (mode 1). The server action is the
   * authority — this is defense-in-depth (Constitution Principle II).
   */
  viewerRole: StudioRole;
  /**
   * Feature 050: when true (the page resolved
   * `isPayPeriodFinalized(period) === true`), every per-line chip
   * renders mode 3 — Lock icon + tooltip; no Change trigger for any
   * role (FR-002, FR-004).
   */
  payPeriodFinalized: boolean;
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

// Feature 052: reversal-status badge label (sentence case, Principle I).
const REVERSAL_LABEL: Record<NonNullable<TransactionDetail["reversal"]>, string> = {
  void: "Voided",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

export function ReceiptDrawer({
  transaction,
  staff,
  viewerRole,
  payPeriodFinalized,
  onClose,
}: ReceiptDrawerProps) {
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

  // Feature 050: the canEdit gate is the drawer-level resolution of "is
  // this viewer + this period eligible to mutate the line's tech?" The
  // server action re-checks both (Principle II); this only controls
  // affordance visibility. Discount + product rows still skip the chip
  // entirely (the line's `kind` filter below preserves today's render).
  const canEdit = (viewerRole === "owner" || viewerRole === "manager") && !payPeriodFinalized;
  // The active-staff roster the picker lists — already pre-filtered to
  // `active=true` by `queryStaffRoster`.
  const activeStaff = staff.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    colorToken: member.colorToken,
  }));

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
            {transaction.reversal ? (
              <span
                className="tp-reversal-badge"
                data-slot="receipt-reversal-badge"
                data-reversal={transaction.reversal}
                style={{ marginTop: "var(--space-2)", display: "inline-flex" }}
              >
                {REVERSAL_LABEL[transaction.reversal]}
              </span>
            ) : null}
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
                // Feature 049 (T024): expose discount-row scope on the
                // drawer line so the printable receipt and the past-
                // transaction drawer carry the same selectors, and so
                // the `Applies to: <name>` sub-line can hang under the
                // standard `tp-d-line` meta strip. Legacy rows
                // (`targetNames == null`) render exactly as today.
                const scopeKind =
                  item.kind === "discount" && item.targetNames != null ? "selected" : "all";
                return (
                  <div
                    key={index}
                    className="tp-d-line"
                    data-slot="receipt-item"
                    data-kind={item.kind}
                    data-scope-kind={item.kind === "discount" ? scopeKind : undefined}
                  >
                    <div>
                      <div className="nm">{item.name}</div>
                      <div className="meta">
                        {item.category ? <span>{item.category}</span> : null}
                        {/* Feature 050: the per-line chip renders for service
                            rows in all three modes — read-only chip (mode 1),
                            chip + Change (mode 2), or chip + Lock (mode 3).
                            Discount + product rows still skip the chip
                            (today's behavior). For mode 2 we also render the
                            chip when the line is unassigned, so a placeholder
                            chip + Change trigger is available to fill the
                            attribution. */}
                        {item.kind === "service" && (tech || canEdit || payPeriodFinalized) ? (
                          <>
                            {item.category ? <span aria-hidden="true">·</span> : null}
                            <ReceiptLineTechChip
                              techId={item.techId}
                              techDisplayName={tech?.displayName ?? null}
                              techColorToken={tech?.colorToken ?? null}
                              lineId={item.lineId}
                              ticketId={transaction.id}
                              canEdit={canEdit}
                              payPeriodFinalized={payPeriodFinalized}
                              activeStaff={activeStaff}
                            />
                          </>
                        ) : null}
                        {item.qty > 1 ? <span>· qty {item.qty}</span> : null}
                      </div>
                      {item.kind === "discount" &&
                      item.targetNames != null &&
                      item.targetNames.length > 0 ? (
                        <div className="meta" data-slot="receipt-item-targets">
                          <span>Applies to: {item.targetNames.join(", ")}</span>
                        </div>
                      ) : null}
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
              {/* Feature 052: a reversed sale shows what was refunded and the
                  net it kept, beneath the original total. */}
              {transaction.reversal ? (
                <>
                  <div className="row">
                    <span className="k">Refunded</span>
                    <span data-slot="receipt-refunded">
                      −{formatCurrency(transaction.refundedCents / 100)}
                    </span>
                  </div>
                  <div className="row total">
                    <span>Net</span>
                    <span data-slot="receipt-net">
                      {formatCurrency(transaction.netTotalCents / 100)}
                    </span>
                  </div>
                </>
              ) : null}
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

          {/* Refund — feature 052 (US2). Owner/manager only, within the
              still-open pay period (`canEdit`). Hidden once the sale is fully
              reversed (void/refunded — nothing remains to refund); a
              partially-refunded sale keeps it so the remainder can be
              refunded. The shared RefundCompositionSheet + server RPC are the
              authority on the per-payment remainder. */}
          {canEdit && transaction.reversal !== "void" && transaction.reversal !== "refunded" ? (
            <div className="tp-d-section" data-slot="receipt-refund-section">
              <RefundEntry ticketId={transaction.id} />
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
