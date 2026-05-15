import "@/styles/studio.css";
import "@/styles/dashboard.css";

import type { ReactNode } from "react";

import { Sparkles } from "lucide-react";

import { OperatorChip } from "@/components/lacquer/operator-chip";
import { OperatorMenu } from "@/components/lacquer/operator-menu";
import { ReconnectingBanner } from "@/components/lacquer/reconnecting-banner";
import { Toaster } from "@/components/ui/sonner";
import { getStudioSessionOrDegraded } from "@/lib/auth/session";

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
      <Toaster richColors closeButton position="top-center" />
    </>
  );
}
