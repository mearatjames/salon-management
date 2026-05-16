import "@/styles/studio.css";
import "@/styles/dashboard.css";

import type { ReactNode } from "react";

import { Sparkles } from "lucide-react";

import { OperatorChip } from "@/components/lacquer/operator-chip";
import { OperatorMenu } from "@/components/lacquer/operator-menu";
import { ReconnectingBanner } from "@/components/lacquer/reconnecting-banner";
import { StudioSidebar } from "@/components/lacquer/sidebar/studio-sidebar";
import { SwitchStaffButton } from "@/components/lacquer/switch-staff-button";
import { Toaster } from "@/components/ui/sonner";
import { getStudioSessionOrDegraded } from "@/lib/auth/session";

// Sidebar pre-paint script — lives in `app/layout.tsx`. Next.js `<Script
// strategy="beforeInteractive">` is only supported in the root layout per the
// Next.js docs; placing it here caused a runtime crash on nested routes
// (e.g. /settings/staff).

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getStudioSessionOrDegraded();
  const degraded = "degraded" in session;

  const staff = degraded
    ? { display_name: "…", role: "technician", color_token: "--muted" }
    : {
        display_name: session.staff.display_name,
        role: session.staff.role,
        color_token: session.staff.color_token,
      };

  return (
    <>
      <div className="studio-shell">
        <aside className="studio-sidebar" aria-label="Studio navigation" id="studio-sidebar">
          <StudioSidebar staff={staff} degraded={degraded} />
        </aside>
        <header className="studio-topbar">
          <div className="studio-topbar-brand">
            <Sparkles size={20} strokeWidth={1.5} aria-hidden="true" />
            Tang Nails
          </div>
          <div className="studio-topbar-center">
            <ReconnectingBanner />
          </div>
          <div className="studio-topbar-right">
            <SwitchStaffButton />
            <span className="studio-topbar-sep" aria-hidden="true" />
            <OperatorMenu>
              <OperatorChip staff={staff} />
            </OperatorMenu>
          </div>
        </header>
        <main className="studio-main">{children}</main>
      </div>
      <Toaster richColors closeButton position="top-center" />
    </>
  );
}
