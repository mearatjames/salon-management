// ReceiptView — printable paper receipt (FR-024, FR-025). Server Component.
//
// Rendered by `app/(receipt-print)/checkout/[ticketId]/receipt/page.tsx`,
// which lives in a sibling route group to `(studio)` so the studio
// chrome (sidebar + topbar) does not wrap it (see research.md § R4).
// The `@media print` block in `checkout.css` is defensive belt-and-
// suspenders against any future surface that accidentally inherits the
// studio shell, and also constrains the page to thermal-paper width.
//
// Lacquer tokens only; tabular numerals on every currency cell
// (Constitution Principle I). No icons in chrome — receipts are
// intentionally austere.

export type ReceiptViewProps = {
  ticket: {
    id: string;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    closed_at: string | null;
  };
  items: Array<{
    id: string;
    name_snapshot: string;
    unit_price_cents: number;
    qty: number;
    /**
     * Feature 049 (T023). Row discriminator. Discount rows render with
     * the `data-kind="discount"` slot marker; the printable receipt
     * shows an `Applies to: <name>` sub-line below scoped discount rows
     * (`targetNames` non-null). Default `"service"` when omitted so
     * legacy callers don't have to change shape.
     */
    kind?: "service" | "discount" | "product";
    /**
     * Feature 049 (T023). Non-null for scoped discount rows; null for
     * all-services discounts and non-discount rows.
     */
    targetNames?: readonly string[] | null;
  }>;
  payment: {
    id: string;
    method: "cash";
    amount_cents: number;
    processed_at: string;
  };
  salonName: string;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  // Server-rendered, so locale is deterministic. Sentence-case-friendly
  // format: "May 16, 2026, 2:15 PM".
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const tnumStyle = { fontVariantNumeric: "tabular-nums" as const };

export function ReceiptView({ ticket, items, payment, salonName }: ReceiptViewProps) {
  return (
    <div className="receipt-page" data-slot="receipt-page">
      {/* Salon header */}
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          paddingBottom: "var(--space-4)",
          borderBottom: "1px solid var(--border)",
          marginBottom: "var(--space-4)",
        }}
      >
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-wide)",
            fontWeight: 500,
          }}
          data-slot="receipt-eyebrow"
        >
          Receipt
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-xl)",
            lineHeight: "var(--leading-snug)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
          data-slot="receipt-salon-name"
        >
          {salonName}
        </h1>
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            ...tnumStyle,
          }}
          data-slot="receipt-timestamp"
        >
          {fmtDate(ticket.closed_at)}
        </div>
      </header>

      {/* Line items */}
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
        data-slot="receipt-items"
      >
        {items.map((item) => {
          const lineTotal = item.unit_price_cents * item.qty;
          // Feature 049 (T023): mark discount rows so the read surface
          // (and US2 e2e) can distinguish them, and emit the "Applies to:"
          // sub-line for scoped discounts. Legacy callers that don't pass
          // `kind` get the default `"service"` and render unchanged.
          const kind = item.kind ?? "service";
          const targetNames = item.targetNames ?? null;
          const scopeKind = kind === "discount" && targetNames != null ? "selected" : "all";
          return (
            <li
              key={item.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)",
                fontSize: "var(--text-sm)",
              }}
              data-slot="receipt-item"
              data-kind={kind}
              data-scope-kind={kind === "discount" ? scopeKind : undefined}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                }}
              >
                <span style={{ color: "var(--foreground)" }}>
                  {item.name_snapshot}
                  {item.qty > 1 ? (
                    <span
                      style={{
                        marginLeft: "var(--space-2)",
                        color: "var(--muted-foreground)",
                        ...tnumStyle,
                      }}
                    >
                      {item.qty} × {fmt(item.unit_price_cents)}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{ color: "var(--foreground)", fontWeight: 500, ...tnumStyle }}
                  data-slot="receipt-item-amount"
                >
                  {fmt(lineTotal)}
                </span>
              </div>
              {kind === "discount" && targetNames != null && targetNames.length > 0 ? (
                <div
                  data-slot="receipt-item-targets"
                  style={{
                    paddingLeft: "var(--space-3)",
                    fontSize: "var(--text-xs)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  Applies to: {targetNames.join(", ")}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Separator */}
      <hr
        style={{
          border: 0,
          borderTop: "1px solid var(--border)",
          margin: "var(--space-4) 0",
        }}
        aria-hidden="true"
      />

      {/* Subtotal / Tax / Total */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
        data-slot="receipt-totals"
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            fontSize: "var(--text-sm)",
          }}
        >
          <span style={{ color: "var(--muted-foreground)" }}>Subtotal</span>
          <span style={{ color: "var(--foreground)", ...tnumStyle }} data-slot="receipt-subtotal">
            {fmt(ticket.subtotal_cents)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            fontSize: "var(--text-sm)",
          }}
        >
          <span style={{ color: "var(--muted-foreground)" }}>Tax</span>
          <span style={{ color: "var(--foreground)", ...tnumStyle }} data-slot="receipt-tax">
            {fmt(ticket.tax_cents)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            fontSize: "var(--text-base)",
            fontWeight: 600,
            paddingTop: "var(--space-2)",
          }}
        >
          <span style={{ color: "var(--foreground)" }}>Total</span>
          <span style={{ color: "var(--foreground)", ...tnumStyle }} data-slot="receipt-total">
            {fmt(ticket.total_cents)}
          </span>
        </div>
      </div>

      {/* Separator */}
      <hr
        style={{
          border: 0,
          borderTop: "1px solid var(--border)",
          margin: "var(--space-4) 0",
        }}
        aria-hidden="true"
      />

      {/* Payment method */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: "var(--text-sm)",
        }}
        data-slot="receipt-payment"
      >
        <span style={{ color: "var(--foreground)" }}>Paid by cash</span>
        <span
          style={{ color: "var(--foreground)", fontWeight: 500, ...tnumStyle }}
          data-slot="receipt-payment-amount"
        >
          {fmt(payment.amount_cents)}
        </span>
      </div>

      {/* Footer */}
      <footer
        style={{
          marginTop: "var(--space-8)",
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--border)",
          textAlign: "center",
          fontSize: "var(--text-sm)",
          color: "var(--muted-foreground)",
        }}
        data-slot="receipt-footer"
      >
        Thank you.
      </footer>
    </div>
  );
}
