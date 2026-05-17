// app/(studio)/settings/square/page.tsx
//
// Server Component — Settings → Square. Reads `square_oauth` + `square_devices`
// via the service-role client (the only authenticated read path is via
// `select to authenticated using (true)`, but pulling through service-role
// keeps the call shape consistent with the other settings pages that
// touch sensitive integration data). Refreshes `last_seen_at` only when
// the salon is connected.
//
// Renders:
//   - Optional ReconnectBanner (only when refresh_failed_at is set).
//   - ConnectCard (unconnected CTA or connected/disconnect controls).
//   - DeviceList  (only when connected).
//   - SquareSettingsToasts (query-param → sonner toaster bridge).

import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ConnectCard } from "@/components/lacquer/settings/square/connect-card";
import { DeviceList } from "@/components/lacquer/settings/square/device-list";
import { ReconnectBanner } from "@/components/lacquer/settings/square/reconnect-banner";
import { requireStudioSession, type StudioRole } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { listDevices } from "@/lib/square/terminal";

import { SquareSettingsToasts } from "./square-settings.client";

export const dynamic = "force-dynamic";

const SQUARE_SETTINGS_OPERATORS = new Set<StudioRole>(["owner", "manager"]);

export default async function SquareSettingsPage() {
  const viewer = await requireStudioSession();
  if (!SQUARE_SETTINGS_OPERATORS.has(viewer.staff.role)) {
    redirect("/dashboard");
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: oauthRow } = await supabase
    .from("square_oauth")
    .select("merchant_id, merchant_name, refresh_failed_at, connected_at")
    .eq("id", true)
    .maybeSingle();

  const connected = oauthRow !== null;
  const needsReconnect = connected && oauthRow.refresh_failed_at != null;

  // Refresh the device cache from Square only when connected. Errors are
  // swallowed inside `listDevices()` so a Square outage doesn't 500 the
  // page.
  if (connected) {
    await listDevices();
  }

  const { data: deviceRows } = await supabase
    .from("square_devices")
    .select("id, square_device_id, friendly_name, is_default, last_seen_at")
    .order("friendly_name", { ascending: true });

  const environment: "sandbox" | "production" =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "var(--space-6) 0",
      }}
      data-slot="square-settings-page"
    >
      <header>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--text-2xl)",
            lineHeight: "var(--leading-tight)",
            letterSpacing: "var(--tracking-snug)",
            color: "var(--foreground)",
            fontWeight: 600,
          }}
        >
          Square
        </h2>
        <p
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
          }}
        >
          Connect your Square account and manage paired terminals.
        </p>
      </header>
      {needsReconnect && <ReconnectBanner />}
      <ConnectCard
        connected={connected}
        merchantName={oauthRow?.merchant_name ?? null}
        environment={environment}
      />
      {connected && <DeviceList devices={deviceRows ?? []} />}
      <Suspense fallback={null}>
        <SquareSettingsToasts />
      </Suspense>
    </div>
  );
}
