"use client";

// `/auth/recovery-callback` — completes an admin-initiated password reset.
//
// `sendUserPasswordReset` (Settings → Onboarding) delivers the recovery link
// through the OAuth *implicit flow*: the access/refresh tokens arrive in the
// URL *hash fragment*, which the server never receives. So — like
// `/auth/invite-callback`, and unlike the PKCE `/auth/callback` route — this
// has to be a client page: it reads the hash, hands the tokens to the
// `completeRecovery` server action, then forwards to `/reset-password`.
//
// Why not `/auth/callback`: that route does a PKCE `exchangeCodeForSession`,
// whose code verifier lives in the *owner's* browser (they triggered the
// send). The target opens the link in a different browser with no verifier,
// so the exchange fails. The implicit flow carries everything in the hash, so
// it works regardless of which browser opens the link. See issue #126.

import { useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { completeRecovery } from "./actions";

// Expired, already-used, or malformed recovery links land on the
// recovery-specific expired surface, which renders the correct copy plus a
// "Request a new link" button.
const EXPIRED_PATH = "/reset-password?error=expired";

export default function RecoveryCallbackPage() {
  const router = useRouter();
  // Strict Mode runs effects twice in dev; the guard keeps `completeRecovery`
  // (which consumes a single-use token) from firing a second time.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    // Implicit-flow errors (expired/used link) come back in the hash too.
    if (hashParams.get("error")) {
      router.replace(EXPIRED_PATH);
      return;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!accessToken || !refreshToken) {
      // No tokens — the page was reached without a valid recovery link.
      router.replace(EXPIRED_PATH);
      return;
    }

    completeRecovery(accessToken, refreshToken)
      .then((result) => router.replace(result.ok ? "/reset-password" : EXPIRED_PATH))
      .catch(() => router.replace(EXPIRED_PATH));
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
        <span>Completing your password reset…</span>
      </div>
    </main>
  );
}
