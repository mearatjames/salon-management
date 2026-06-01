// Settings shell layout — wraps every `/settings/*` route with the studio
// auth gate (any authenticated operator) and the horizontal tab bar
// (Staff · Onboarding · Square).
//
// Restricted subroutes (Staff / Onboarding / Square) gate themselves inside
// their `page.tsx`, so the layout stays open to every authenticated role.
// Services lives at `/services` (top-level studio route reached from the
// sidebar) — not under Settings — and gates itself per feature
// 008-services-catalog.

import type { ReactNode } from "react";

import { TabBar } from "@/components/lacquer/settings/tab-bar";
import { requireStudioSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  // `requireStudioSession()` throws `AuthRedirectError` (which middleware
  // catches and turns into a redirect). The role check lives in each
  // restricted child page.
  await requireStudioSession();

  return (
    <div className="settings-shell">
      <TabBar />
      <div className="settings-content">{children}</div>
    </div>
  );
}
