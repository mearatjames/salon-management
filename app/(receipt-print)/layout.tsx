// Receipt-print route-group layout. Sits at the SAME depth as
// `app/(studio)/layout.tsx` so the printable receipt route is rendered
// WITHOUT the studio chrome (sidebar + topbar). This is the App Router
// idiom for "break out of a parent shell" — co-locate the route inside
// a sibling route group whose layout is bare.
//
// The matching URL is `/checkout/[ticketId]/receipt` (route groups in
// parentheses are not part of the URL — see Next.js App Router docs).
// Per research.md § R4 — printable receipt must not render any chrome
// (FR-024, FR-025).

import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function ReceiptPrintLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
