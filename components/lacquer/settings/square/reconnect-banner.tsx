// components/lacquer/settings/square/reconnect-banner.tsx
//
// Server Component — shown only when `square_oauth.refresh_failed_at IS NOT
// NULL`. Calm, specific, second-person copy per the Lacquer content
// fundamentals. The CTA re-runs the OAuth flow via the same client wrapper
// the unconnected state uses (ConnectButton).
//
// All visual values resolve to tokens.

import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { ConnectButton } from "./connect-button.client";

export function ReconnectBanner() {
  return (
    <Card
      style={{
        borderColor: "var(--destructive)",
      }}
    >
      <CardContent
        style={{
          padding: "var(--space-5) var(--space-6)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "var(--space-8)",
            height: "var(--space-8)",
            color: "var(--destructive)",
          }}
        >
          <AlertTriangle size={20} strokeWidth={1.5} />
        </span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Square connection needs attention
          </h3>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted-foreground)" }}>
            The daily token refresh failed. Reconnect to keep accepting cards.
          </p>
        </div>
        <ConnectButton />
      </CardContent>
    </Card>
  );
}
