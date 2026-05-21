"use client";

import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

const POLL_INTERVAL_MS = 10_000;

export function ReconnectingBanner() {
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setDegraded(true);
          return;
        }
        const body = (await res.json()) as { ok?: boolean };
        if (cancelled) return;
        setDegraded(!body.ok);
      } catch {
        if (cancelled) return;
        setDegraded(true);
      }
    }

    // Don't pre-flag degraded on mount — wait for the first probe.
    probe();
    const interval = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!degraded) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="reconnecting-banner"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        background: "var(--muted)",
        color: "var(--muted-foreground)",
        borderRadius: "var(--radius-full)",
        padding: "var(--space-1) var(--space-3)",
        fontSize: "var(--text-sm)",
      }}
    >
      <Spinner size={16} />
      Reconnecting…
    </div>
  );
}
