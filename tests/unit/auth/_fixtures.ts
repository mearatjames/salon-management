// Shared fixtures for the lib/auth/* test suites.
//
// Every cookie/session test that needs to mint a signed operator cookie
// imports `TEST_ACTING_AS_COOKIE_SECRET` from here and uses `mintCookie` /
// `mintExpiredCookie` so the same secret + signing flow is exercised across
// the whole suite. Tests set `process.env.ACTING_AS_COOKIE_SECRET` to this
// value (either via `vi.stubEnv` or by direct assignment in a beforeEach
// hook) so the implementation under test reads the same key.

import { SignJWT } from "jose";

// A fixed, public 32-byte base64 string — not a real production secret.
// Long enough to satisfy HS256's key-length sanity check.
export const TEST_ACTING_AS_COOKIE_SECRET = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmE=";

function secretKey(secret: string = TEST_ACTING_AS_COOKIE_SECRET): Uint8Array {
  // jsdom's TextEncoder occasionally returns a Uint8Array whose constructor
  // identity differs from the realm jose runs in, so we build a fresh
  // Uint8Array from the encoded bytes to guarantee the `instanceof` check
  // jose performs passes regardless of test environment.
  const encoded = new TextEncoder().encode(secret);
  return new Uint8Array(encoded);
}

export type MintCookieOpts = {
  sid: string;
  /** Offset (in seconds) added to "now" before signing. Default 0 (fresh). */
  iatOffsetSec?: number;
  /**
   * Override the signing secret. Defaults to `TEST_ACTING_AS_COOKIE_SECRET`.
   * The Playwright E2E suite passes the dev server's
   * `ACTING_AS_COOKIE_SECRET` so the minted cookie is verifiable by the
   * running Next.js process.
   */
  secret?: string;
};

/**
 * Mint a valid operator cookie against the test secret.
 *
 * Bypasses the implementation's input validation so tests can drive edge
 * cases (e.g., short / empty sids) without depending on
 * `signOperatorCookie`.
 */
export async function mintCookie({
  sid,
  iatOffsetSec = 0,
  secret,
}: MintCookieOpts): Promise<string> {
  const iat = Math.floor(Date.now() / 1000) + iatOffsetSec;
  return await new SignJWT({ sid, iat })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secretKey(secret));
}

/**
 * Mint an expired operator cookie — iat is 13 hours in the past, well beyond
 * the 12-hour Max-Age. Used to assert the verifier honors `iat + 43200 < now`.
 *
 * The optional `secret` override lets E2E specs mint a cookie that the
 * running dev server (which reads `process.env.ACTING_AS_COOKIE_SECRET`)
 * will accept as well-formed but expired.
 */
export async function mintExpiredCookie({
  sid,
  secret,
}: {
  sid: string;
  secret?: string;
}): Promise<string> {
  return await mintCookie({ sid, iatOffsetSec: -(13 * 3600), secret });
}
