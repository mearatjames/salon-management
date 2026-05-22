"use client";

// `/auth/invite-callback` — completes an accepted staff invite.
//
// Admin-generated invite links (`admin.inviteUserByEmail` / `generateLink`)
// return the session via the OAuth *implicit flow*: the access/refresh tokens
// arrive in the URL *hash fragment*, which the server never receives. So
// unlike `/auth/callback` (a server route handling the PKCE `?code=` flow),
// this has to be a client page — it reads the hash, hands the tokens to the
// `acceptInvite` server action, then routes onward.

import { useEffect, useRef } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";

import { acceptInvite } from "./actions";

// Expired or already-used invite links land back on the existing
// expired-invite surface, which already renders the "ask for a new link" copy.
const EXPIRED_PATH = "/reset-password?type=invite&error=expired";

export default function InviteCallbackPage() {
  const router = useRouter();
  // Strict Mode runs effects twice in dev; the guard keeps `acceptInvite`
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
      // No tokens — the page was reached without a valid invite link.
      router.replace("/login?error=oauth_failed");
      return;
    }

    // `?method=password` survives on the query string (the hash is appended
    // after it); it selects the password-setup vs. magic-link destination.
    const method = new URLSearchParams(window.location.search).get("method");

    acceptInvite(accessToken, refreshToken, method)
      .then((result) => router.replace(result.ok ? result.destination : EXPIRED_PATH))
      .catch(() => router.replace(EXPIRED_PATH));
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" strokeWidth={1.5} aria-hidden="true" />
        <span>Completing your invite…</span>
      </div>
    </main>
  );
}
