// lib/square/client.ts
//
// Server-only factory for the Square SDK client. The SDK ships a single
// `SquareClient` that wraps every Square API surface (terminals, payments,
// merchants, oauth, etc.); we construct one per call bound to a salon's
// access token.

import { SquareClient, SquareEnvironment } from "square";

/**
 * SERVER-ONLY. Constructs a SquareClient bound to a single salon's access
 * token. The salon's encrypted token is read from `square_oauth` and
 * decrypted via `public.decrypt_square_token` before being passed here.
 *
 * **DO NOT import this from a client component** (`*.client.tsx`). The
 * `square` SDK pulls in Node-only modules and embedding it in the browser
 * bundle would also leak the access token at runtime. The
 * `tests/unit/square/client-import-graph.test.ts` enforces this with a
 * static-import-graph scan and will fail CI if violated.
 *
 * @param accessToken Plaintext Square OAuth access token (already decrypted).
 * @returns A SquareClient pinned to the env's sandbox or production base URL.
 */
export function getSquareClient(accessToken: string): SquareClient {
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;
  // Test escape hatch: SQUARE_API_BASE_URL points the SDK at a local
  // Playwright-managed stub so server-side `client.devices.list()` (etc)
  // calls don't escape to the real Square hosts during e2e.
  if (process.env.SQUARE_API_BASE_URL) {
    return new SquareClient({
      token: accessToken,
      environment,
      baseUrl: process.env.SQUARE_API_BASE_URL,
    });
  }
  return new SquareClient({ token: accessToken, environment });
}
