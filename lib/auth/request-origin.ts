// Resolve the inbound request's origin (`<proto>://<host>`) from headers.
//
// Server Actions and Route Handlers that build absolute callback URLs
// (Supabase `redirectTo`, OAuth redirects) need the *deployment's* origin,
// which varies per environment — localhost in dev, the Vercel URL in
// preview/prod. Reading it from the request headers makes it correct on
// every deployment with zero env-var configuration: `NEXT_PUBLIC_SITE_URL`
// is not set on Vercel preview builds, so an env-var fallback silently
// resolves to `localhost` (issue: invite links pointed at localhost:3000).

import { headers } from "next/headers";

export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  // Some browsers send `origin` on form POSTs — prefer it verbatim.
  const origin = h.get("origin");
  if (origin) return origin;
  // Behind Vercel's proxy the forwarded host/proto carry the public URL;
  // fall back to the plain `host` for direct (local dev) requests.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
