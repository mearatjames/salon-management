"use client";

// Tiny client island for /settings/square — handles the flash-toast hookup
// for `?connected=1` / `?error=<code>` query params. The Disconnect
// confirm dialog lives inside `disconnect-button.client.tsx` (rendered by
// the ConnectCard server component) so this island stays focused on the
// query-param → toast bridge.

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const ERROR_COPY: Record<string, string> = {
  invalid_state: "Square sign-in expired or was tampered with. Please try again.",
  oauth_exchange_failed: "Square did not finish signing you in. Please try again.",
  vault_misconfigured:
    "Square cannot be connected right now — the encryption key is missing. Contact support.",
};

export function SquareSettingsToasts() {
  const router = useRouter();
  const params = useSearchParams();
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    const key = connected ? `connected:${connected}` : error ? `error:${error}` : null;
    if (!key || firedFor.current === key) return;
    firedFor.current = key;

    if (connected) {
      toast.success("Square connected.");
    } else if (error) {
      toast.error(ERROR_COPY[error] ?? "Something went wrong with Square.");
    }

    // Strip the flash params from the URL so a hard reload doesn't repeat.
    const next = new URLSearchParams(params.toString());
    next.delete("connected");
    next.delete("error");
    const qs = next.toString();
    router.replace(qs ? `/settings/square?${qs}` : "/settings/square");
  }, [params, router]);

  return null;
}
