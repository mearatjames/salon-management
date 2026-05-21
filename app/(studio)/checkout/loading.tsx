// Checkout loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/checkout/page.tsx` is in flight (staff, services,
// Square, salon-settings all fetched in parallel).
//
// Mirrors the live page's `.checkout-shell` chrome so the layout does not
// shift when real content arrives: the `.checkout-header` band, the
// `.checkout-tech-band` row, and the two-column `.checkout-body` (catalog
// column on the left, cart/summary column on the right).
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "./checkout.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function CheckoutLoading() {
  return (
    <div className="checkout-shell" aria-hidden="true">
      {/* Header band — title on the left, action buttons on the right */}
      <div className="checkout-header">
        <Skeleton width={160} height={22} radius="var(--radius-md)" />
        <div className="checkout-header-actions">
          <Skeleton width={72} height={32} radius="var(--radius-sm)" />
          <Skeleton width={72} height={32} radius="var(--radius-sm)" />
        </div>
      </div>

      {/* Tech-assignment band — full-width avatar row */}
      <div className="checkout-tech-band">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={40} height={40} radius="var(--radius-full)" />
          ))}
        </div>
      </div>

      {/* Two-column body */}
      <div className="checkout-body">
        {/* LEFT: service catalog column */}
        <section className="checkout-catalog" aria-label="Service catalog">
          {/* Search input */}
          <Skeleton width="100%" height={36} radius="var(--radius-xs)" />
          {/* Category chip row */}
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width={80} height={28} radius="var(--radius-full)" />
            ))}
          </div>
          {/* Service tile grid */}
          <div className="checkout-catalog-grid">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                  padding: "var(--space-4)",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <Skeleton width="70%" height={14} radius="var(--radius-md)" />
                <Skeleton width="45%" height={12} radius="var(--radius-md)" />
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT: cart/summary column */}
        <section className="checkout-cart" aria-label="Cart">
          {/* Cart header label */}
          <Skeleton width={40} height={12} radius="var(--radius-md)" />

          {/* Cart line list placeholder */}
          <div className="checkout-cart-lines">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={48} radius="var(--radius-md)" />
            ))}
          </div>

          {/* Totals block */}
          <div className="checkout-totals">
            <div className="checkout-total-row">
              <Skeleton width={72} height={14} radius="var(--radius-md)" />
              <Skeleton width={56} height={14} radius="var(--radius-md)" />
            </div>
            <div className="checkout-total-row is-grand">
              <Skeleton width={56} height={20} radius="var(--radius-md)" />
              <Skeleton width={64} height={20} radius="var(--radius-md)" />
            </div>
          </div>

          {/* Payment tile row — 4 tiles */}
          <div className="checkout-payment-tiles">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={56} radius="var(--radius-md)" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
