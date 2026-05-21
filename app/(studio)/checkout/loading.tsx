// Checkout loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/checkout/page.tsx` is in flight (staff, services,
// Square, salon-settings all fetched in parallel).
//
// Delegates to the shared CheckoutLoadingSkeleton so the two checkout
// loading routes stay in sync from a single source of truth.

import { CheckoutLoadingSkeleton } from "@/components/lacquer/checkout/checkout-loading-skeleton";

export default function CheckoutLoading() {
  return <CheckoutLoadingSkeleton />;
}
