"use client";

// UpdatePrompt — tells the operator when a newer deploy is live.
//
// iOS / iPadOS home-screen apps don't reload when brought back to the
// foreground: the suspended page resumes with its old JavaScript, so a
// front-desk iPad can run a stale build for days. This island compares the
// build ID baked into its bundle (`lib/build-id.ts`) with the one
// `/api/version` reports and, on a mismatch, shows a persistent toast with a
// Refresh action. It never reloads on its own — a reload mid-checkout would
// drop the ticket in progress.
//
// When it checks:
//   - every time the app returns to the foreground (`visibilitychange`),
//   - every 5 min while visible, for an iPad that never leaves the screen.
// Once a mismatch is found the interval stops fetching; a dismissed toast
// comes back the next time the app returns to the foreground.
//
// Fetch failures are ignored — offline is <ReconnectingBanner />'s job.

import { useEffect } from "react";
import { toast } from "sonner";

import { BUILD_ID } from "@/lib/build-id";

const CHECK_INTERVAL_MS = 5 * 60_000;
const TOAST_ID = "app-update";

function showPrompt() {
  toast("A new version of Tang Nails is ready.", {
    id: TOAST_ID,
    description: "Refresh when you're between clients.",
    duration: Infinity,
    action: { label: "Refresh", onClick: () => window.location.reload() },
  });
}

export function UpdatePrompt() {
  useEffect(() => {
    let cancelled = false;
    let stale = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      if (stale) {
        showPrompt();
        return;
      }
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { buildId?: unknown };
        if (cancelled) return;
        if (typeof body.buildId === "string" && body.buildId !== BUILD_ID) {
          stale = true;
          showPrompt();
        }
      } catch {
        // Offline, signed out (proxy redirect → HTML), or mid-deploy — try
        // again on the next check.
      }
    }

    // No check on mount: a fresh load is already running the latest build.
    const interval = setInterval(() => {
      if (!stale) check();
    }, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return null;
}
