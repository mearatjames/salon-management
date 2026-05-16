// Settings shell layout — wraps every `/settings/*` route with the studio
// auth gate (any authenticated operator) and the horizontal tab bar
// (General · Staff · Services · Notifications · Billing).
//
// Per FR-029 (008-services-catalog) the Services subroute MUST be reachable
// by technicians and front-desk operators in read-only mode. Restricted
// subroutes (Staff / General / Billing / Notifications) gate themselves
// inside their `page.tsx` so the layout stays open to every authenticated
// role. The original owner/manager-only gate now lives in
// `app/(studio)/settings/staff/page.tsx`.

import type { ReactNode } from "react";

import { TabBar } from "@/components/lacquer/settings/tab-bar";
import { requireStudioSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  // `requireStudioSession()` throws `AuthRedirectError` (which middleware
  // catches and turns into a redirect). The role check now lives in each
  // restricted child page so the Services subroute can stay open per
  // 008-services-catalog FR-029.
  await requireStudioSession();

  return (
    <div className="settings-shell">
      <TabBar />
      <div className="settings-content">{children}</div>
    </div>
  );
}
