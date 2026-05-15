// Sign and verify the `acting_as_staff_id` operator cookie.
//
// Compact JWT (HS256) over a 32-byte secret read from
// `process.env.ACTING_AS_COOKIE_SECRET`. The secret is read lazily, on every
// call, so test code can swap it via `process.env` without restarting the
// module loader.
//
// See `specs/003-login-flow/contracts/cookie.contract.md` for the wire format.

import { errors as joseErrors, jwtVerify, SignJWT } from "jose";

export type OperatorCookiePayload = {
  sid: string;
  iat: number;
};

export class OperatorCookieInvalidError extends Error {
  constructor(message = "operator cookie failed verification") {
    super(message);
    this.name = "OperatorCookieInvalidError";
  }
}

export class OperatorCookieExpiredError extends Error {
  constructor(message = "operator cookie expired") {
    super(message);
    this.name = "OperatorCookieExpiredError";
  }
}

// 12 hours, in seconds — must match the cookie Max-Age set by `submitPin`.
const COOKIE_TTL_SECONDS = 43_200;

function secretKey(): Uint8Array {
  const raw = process.env.ACTING_AS_COOKIE_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "ACTING_AS_COOKIE_SECRET is not set or is too short (must be a base64-encoded 32-byte secret)"
    );
  }
  // Force a fresh Uint8Array so jose's `instanceof` check passes even when
  // the test environment (jsdom) hands us a different Uint8Array constructor.
  return new Uint8Array(new TextEncoder().encode(raw));
}

export async function signOperatorCookie(payload: OperatorCookiePayload): Promise<string> {
  if (typeof payload.sid !== "string" || payload.sid.length === 0) {
    throw new Error("signOperatorCookie: sid must be a non-empty string");
  }
  if (!Number.isInteger(payload.iat) || payload.iat <= 0) {
    throw new Error("signOperatorCookie: iat must be a positive integer (unix seconds)");
  }
  return await new SignJWT({ sid: payload.sid, iat: payload.iat })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(secretKey());
}

export async function verifyOperatorCookie(value: string): Promise<OperatorCookiePayload> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(value, secretKey(), { algorithms: ["HS256"] });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      throw new OperatorCookieInvalidError(`invalid operator cookie: ${err.code ?? err.message}`);
    }
    throw new OperatorCookieInvalidError("invalid operator cookie");
  }

  const sid = payload.sid;
  const iat = payload.iat;
  if (typeof sid !== "string" || sid.length === 0) {
    throw new OperatorCookieInvalidError("operator cookie missing or invalid 'sid' claim");
  }
  if (typeof iat !== "number" || !Number.isFinite(iat)) {
    throw new OperatorCookieInvalidError("operator cookie missing or invalid 'iat' claim");
  }

  const now = Math.floor(Date.now() / 1000);
  if (iat + COOKIE_TTL_SECONDS < now) {
    throw new OperatorCookieExpiredError(
      `operator cookie expired (iat=${iat}, now=${now}, ttl=${COOKIE_TTL_SECONDS}s)`
    );
  }

  return { sid, iat };
}
