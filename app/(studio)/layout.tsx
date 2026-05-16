import "@/styles/studio.css";
import "@/styles/dashboard.css";

import type { ReactNode } from "react";

import { Sparkles } from "lucide-react";
import Script from "next/script";

import { OperatorChip } from "@/components/lacquer/operator-chip";
import { OperatorMenu } from "@/components/lacquer/operator-menu";
import { ReconnectingBanner } from "@/components/lacquer/reconnecting-banner";
import { StudioSidebar } from "@/components/lacquer/sidebar/studio-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { getStudioSessionOrDegraded } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Pre-paint script — sets the collapsed attribute on <html> from localStorage
// BEFORE first paint so the grid renders at the right width with no flash.
// Body is a self-contained build-time literal: no user-supplied content.
const SIDEBAR_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem("tn:studio:sidebar-collapsed")==="1";document.documentElement.setAttribute("data-studio-sidebar-collapsed",v?"true":"false");}catch(e){document.documentElement.setAttribute("data-studio-sidebar-collapsed","false");}})();`;

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
      <Script id="studio-sidebar-init" strategy="beforeInteractive">
        {SIDEBAR_INIT_SCRIPT}
      </Script>
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
