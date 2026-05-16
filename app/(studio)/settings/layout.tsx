// Settings shell layout — wraps every `/settings/*` route with the auth gate
// (owner or manager only) and the horizontal tab bar (General · Staff ·
// Notifications · Billing). Per routes.contract.md § Auth gate.

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { TabBar } from "@/components/lacquer/settings/tab-bar";
import { requireStudioSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const SETTINGS_OPERATORS = new Set(["owner", "manager"]);

export default async function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  // `requireStudioSession()` throws `AuthRedirectError` (which middleware
  // catches and turns into a redirect). After it returns we have an
  // authenticated operator — check their role for the settings gate.
  const viewer = await requireStudioSession();

  if (!SETTINGS_OPERATORS.has(viewer.staff.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="settings-shell">
      <div className="settings-content">
        <TabBar />
        {children}
      </div>
    </div>
  );
}
