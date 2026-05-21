// Checkout [ticketId] loading.tsx — rendered by Next.js while the
// server-side data fetch for `app/(studio)/checkout/[ticketId]/page.tsx`
// is in flight (ticket row, items, staff, services, Square, salon-settings
// all fetched in parallel).
//
// The `[ticketId]` route renders the same `.checkout-shell` chrome as the
// paramless `/checkout` entry — both wrap `<CheckoutScreen>`. This skeleton
// is structurally identical; it delegates to the shared CheckoutLoadingSkeleton.

import { CheckoutLoadingSkeleton } from "@/components/lacquer/checkout/checkout-loading-skeleton";

export default function CheckoutTicketLoading() {
  return <CheckoutLoadingSkeleton />;
}
