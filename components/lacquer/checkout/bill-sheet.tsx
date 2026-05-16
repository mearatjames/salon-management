"use client";

// BillSheet — T037 (US4). Adapted 1:1 from
// `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet`.
//
// Restaurant-style "drop the bill" preview that opens as a sheet overlay
// (same family chrome as PriceSheet / DiscountSheet — uses the shared
// `.tx-sheet-backdrop` + a wider `.tx-bill-sheet` variant). The root of
// the bill document carries the `lacquer-bill-doc` class; the print CSS
// in `checkout.css` targets that class to hide the rest of the chrome
// under `@media print`.
//
// Snapshot semantics (research.md § R14): the `snapshot` prop is a frozen
// JS object captured at sheet-open time. Cart edits underneath the sheet
// do NOT mutate it. Closing + re-opening from the cart triggers the
// parent to capture a fresh snapshot.
//
// Adaptations from the prototype:
//   - Money: prototype uses dollars; we receive cents and format with
//     `(cents / 100).toFixed(2)`.
//   - Items list supports BOTH kind='service' and kind='discount' rows.
//     Discount rows render with the `--destructive` color on the amount
//     column and an optional `note` line under the name.
//   - Subtotal/total are read from `snapshot.serviceSubtotalCents` /
//     `snapshot.totalCents` — NOT derived from `lines.reduce(...)`. The
//     prototype's untyped reduce sums prices over the whole array; that
//     would double-count discount rows in our world.
//   - Gratuity baseline is `serviceSubtotalCents` (pre-discount), per the
//     spec's Edge Case "Suggested-gratuity baseline on the bill" —
//     restaurant convention is to tip on the gross service amount, not
//     the discounted total.
//   - The "lacquersalon.co" website footer line from the prototype is
//     dropped — not in the salon-info settings keys.
//   - Tax row stays for visual consistency with the prototype, hardcoded
//     to $0.00 / 0.00% (phase 2's `tax_cents` stays 0).
//   - Check # is derived from the last 4 chars of `snapshot.capturedAt`
//     ISO timestamp — purely decorative.
//
// All visuals trace to tokens in `styles/tokens.css`; the new classes
// (`tx-bill-*`) are added to `checkout.css`.

import { ChevronLeft, Mail, Printer, X } from "lucide-react";

export type BillSnapshotLine = {
  id: string;
  kind: "service" | "discount";
  name: string;
  unitPriceCents: number;
  qty: number;
  note: string | null;
  discountPct: number | null;
};

export type BillSnapshot = {
  lines: BillSnapshotLine[];
  serviceSubtotalCents: number;
  discountTotalCents: number;
  totalCents: number;
  capturedAt: string;
};

export type BillSheetProps = {
  snapshot: BillSnapshot;
  salonInfo: { name: string; address: string; phone: string };
  techName: string | null;
  guestLabel: string;
  onClose: () => void;
  onPrint: () => void;
  onEmail: () => void;
};

function fmt(cents: number): string {
  // Negative amounts render as "-$X.XX" not "$-X.XX" — matches the cart
  // row convention in cart-row-with-tech.tsx.
  if (cents < 0) return `-$${(Math.abs(cents) / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

const TIP_SUGGESTIONS: ReadonlyArray<{ label: string; pct: number }> = [
  { label: "Good · 18%", pct: 0.18 },
  { label: "Great · 20%", pct: 0.2 },
  { label: "Generous · 25%", pct: 0.25 },
];

export function BillSheet({
  snapshot,
  salonInfo,
  techName,
  guestLabel,
  onClose,
  onPrint,
  onEmail,
}: BillSheetProps) {
  // Item count for empty-state branch.
  const hasItems = snapshot.lines.length > 0;
  const hasDiscount = snapshot.discountTotalCents !== 0;
  const totalBeforeTipCents = snapshot.totalCents; // tax stays 0 this phase.

  // Decorative "Check #" — last 4 chars of the capturedAt ISO timestamp.
  // The prototype hardcoded "0127"; we derive something unique-per-bill.
  const checkSuffix = snapshot.capturedAt.replace(/\D/g, "").slice(-4) || "0000";

  return (
    <div
      className="tx-sheet-backdrop"
      data-slot="bill-sheet"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Bill preview"
    >
      <div className="tx-bill-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tx-bill-sheet-h">
          <div>
            <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>Bill preview</div>
            <div
              style={{
                fontSize: "var(--text-xs)",
                marginTop: "var(--space-1)",
                color: "var(--muted-foreground)",
              }}
            >
              Print or email — payment not yet taken
            </div>
          </div>
          <button
            type="button"
            className="tx-stepper-btn"
            onClick={onClose}
            aria-label="Close bill preview"
            data-slot="bill-sheet-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-bill-doc-wrap">
          {/* The print CSS in checkout.css targets `.lacquer-bill-doc` to
              hide every other element on the page under @media print. */}
          <div className="lacquer-bill-doc tx-bill-doc" data-slot="bill-doc">
            <div className="tx-bill-mast" data-slot="bill-mast">
              <div className="logo">{salonInfo.name}</div>
              <div className="addr">
                {salonInfo.address}
                {salonInfo.address && salonInfo.phone ? <br /> : null}
                {salonInfo.phone}
              </div>
            </div>

            <div className="tx-bill-meta">
              <div>
                <span className="lbl">Guest</span>
                <span className="val">{guestLabel}</span>
              </div>
              <div>
                <span className="lbl">Tech</span>
                <span className="val">{techName ?? "—"}</span>
              </div>
              <div>
                <span className="lbl">Visit</span>
                <span className="val">Today</span>
              </div>
              <div>
                <span className="lbl">Check #</span>
                <span className="val tnum">{checkSuffix}</span>
              </div>
            </div>

            <div className="tx-bill-divider dashed" />

            <div className="tx-bill-items">
              {!hasItems ? (
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    textAlign: "center",
                    padding: "var(--space-2) 0",
                    color: "var(--muted-foreground)",
                  }}
                >
                  No items in this sale yet.
                </div>
              ) : (
                snapshot.lines.map((line) => {
                  const amountCents = line.unitPriceCents * line.qty;
                  const isDiscount = line.kind === "discount";
                  return (
                    <div
                      key={line.id}
                      className="tx-bill-row"
                      data-slot="bill-item"
                      data-line-kind={line.kind}
                    >
                      <span className="qty tnum">{isDiscount ? "" : line.qty || 1}</span>
                      <span className="nm">
                        <div>{line.name}</div>
                        {line.note ? (
                          <div
                            style={{
                              fontSize: "var(--text-xs)",
                              color: "var(--muted-foreground)",
                              marginTop: "var(--space-1)",
                            }}
                          >
                            {line.note}
                          </div>
                        ) : null}
                      </span>
                      <span
                        className="amt tnum"
                        style={isDiscount ? { color: "var(--destructive)" } : undefined}
                      >
                        {fmt(amountCents)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="tx-bill-divider" />

            <div className="tx-bill-totals">
              <div className="row">
                <span>Subtotal</span>
                <span className="tnum" data-slot="bill-subtotal">
                  {fmt(snapshot.serviceSubtotalCents)}
                </span>
              </div>
              {hasDiscount ? (
                <div className="row" data-slot="bill-discounts">
                  <span>Discounts</span>
                  <span className="tnum" style={{ color: "var(--destructive)" }}>
                    {fmt(snapshot.discountTotalCents)}
                  </span>
                </div>
              ) : null}
              <div className="row">
                <span>Tax (0.00%)</span>
                <span className="tnum">$0.00</span>
              </div>
              <div className="row total">
                <span>Total before tip</span>
                <span className="tnum" data-slot="bill-total">
                  {fmt(totalBeforeTipCents)}
                </span>
              </div>
            </div>

            {/* Gratuity block: render only when there's something to tip on
                (serviceSubtotalCents > 0). Computed against the PRE-discount
                service subtotal (restaurant convention; spec Edge Case
                "Suggested-gratuity baseline on the bill"). */}
            {snapshot.serviceSubtotalCents > 0 ? (
              <div className="tx-bill-tip-block">
                <div className="lbl">Suggested gratuity</div>
                {TIP_SUGGESTIONS.map((t) => {
                  const tipCents = Math.round(snapshot.serviceSubtotalCents * t.pct);
                  const allInCents = snapshot.totalCents + tipCents;
                  return (
                    <div key={t.label} className="tx-bill-tip-row" data-slot="bill-tip-row">
                      <span className="t">{t.label}</span>
                      <span style={{ color: "var(--muted-foreground)" }} className="tnum">
                        {fmt(tipCents)}
                      </span>
                      <span className="tnum">{fmt(allInCents)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="tx-bill-divider" />

            <div className="tx-bill-write">
              <div className="row">
                <span>Tip</span>
                <span className="line" />
              </div>
              <div className="row">
                <span>Total</span>
                <span className="line" />
              </div>
              <div className="row sig">
                <span>Signature</span>
                <span className="line wide" />
              </div>
            </div>

            <div className="tx-bill-foot">
              <div>Thank you.</div>
            </div>
          </div>
        </div>

        <div className="tx-bill-sheet-foot">
          <button
            type="button"
            className="tx-btn ghost"
            onClick={onClose}
            data-slot="bill-sheet-back"
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" /> Back to sale
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="tx-btn secondary"
            onClick={onEmail}
            data-slot="bill-sheet-email"
          >
            <Mail size={16} strokeWidth={1.5} aria-hidden="true" /> Email
          </button>
          <button type="button" className="tx-btn" onClick={onPrint} data-slot="bill-sheet-print">
            <Printer size={16} strokeWidth={1.5} aria-hidden="true" /> Print bill
          </button>
        </div>
      </div>
    </div>
  );
}
