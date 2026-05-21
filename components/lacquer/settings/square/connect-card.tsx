// components/lacquer/settings/square/connect-card.tsx
//
// Server Component — the top card on /settings/square. Two states:
//
//   - unconnected → "Connect Square" CTA + sandbox/production hint.
//   - connected   → "Connected to {merchant_name}" header + Disconnect CTA.
//
// The Connect button calls `connectSquareStart()` (Server Action) and
// hands the returned URL to `window.location.assign(...)` — that wrapper
// lives in `connect-button.client.tsx`. The Disconnect dialog lives in
// `app/(studio)/settings/square/square-settings.client.tsx` (T023).
//
// All visual values resolve to Lacquer tokens (no raw hex / off-scale
// spacing). Icons come from lucide-react at 1.5px stroke.

import { CreditCard, Link2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { ConnectButton } from "./connect-button.client";
import { DisconnectButton } from "./disconnect-button.client";

export type ConnectCardProps = {
  connected: boolean;
  merchantName: string | null;
  environment: "sandbox" | "production";
};

export function ConnectCard({ connected, merchantName, environment }: ConnectCardProps) {
  return (
    <Card>
      <CardContent
        style={{
          padding: "var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "var(--space-10)",
              height: "var(--space-10)",
              borderRadius: "var(--radius-md)",
              background: "var(--muted)",
              color: "var(--foreground)",
            }}
          >
            <CreditCard size={20} strokeWidth={1.5} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                color: "var(--foreground)",
                letterSpacing: "var(--tracking-snug)",
              }}
            >
              {connected ? `Connected to ${merchantName ?? "Square"}` : "Connect Square"}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
              }}
            >
              {connected
                ? "Tang Nails Studio can accept card payments through your paired Square Terminals."
                : "Sign in to your Square account to pair terminals and start taking card payments."}
            </p>
          </div>
        </div>

        {!connected && (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--muted-foreground)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <Link2 size={16} strokeWidth={1.5} aria-hidden="true" />
            {environment === "production"
              ? "Production Square account."
              : "Sandbox environment — safe to test with."}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          {connected ? <DisconnectButton /> : <ConnectButton />}
        </div>
      </CardContent>
    </Card>
  );
}
