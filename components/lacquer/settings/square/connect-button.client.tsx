"use client";

// Connect Square button — client wrapper that invokes the
// `connectSquareStart` Server Action and then redirects via
// `window.location.assign(url)` so Square's hosted OAuth page can take over
// the tab. The action returns the authorize URL (we cannot `redirect()`
// from a Server Action to an external origin in Next 16 cleanly — the
// browser must do the navigation).

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { connectSquareStart } from "@/app/(studio)/settings/square/actions";

export function ConnectButton() {
  const [pending, startTransition] = useTransition();

  const handleClick = (): void => {
    startTransition(async () => {
      try {
        const { authorizationUrl } = await connectSquareStart();
        window.location.assign(authorizationUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not start Square sign-in.";
        toast.error(msg);
      }
    });
  };

  return (
    <Button onClick={handleClick} loading={pending} data-testid="square-connect-button">
      {pending ? "Opening Square…" : "Connect Square"}
    </Button>
  );
}
