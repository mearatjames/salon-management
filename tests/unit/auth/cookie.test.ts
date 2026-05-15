// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  signOperatorCookie,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";

import { TEST_ACTING_AS_COOKIE_SECRET, mintCookie, mintExpiredCookie } from "./_fixtures";

const SID = "10000000-0000-0000-0000-000000000001";

describe("lib/auth/cookie", () => {
  const originalSecret = process.env.ACTING_AS_COOKIE_SECRET;

  beforeEach(() => {
    process.env.ACTING_AS_COOKIE_SECRET = TEST_ACTING_AS_COOKIE_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.ACTING_AS_COOKIE_SECRET;
    } else {
      process.env.ACTING_AS_COOKIE_SECRET = originalSecret;
    }
  });

  it("round-trips a freshly signed cookie", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await signOperatorCookie({ sid: SID, iat });
    const payload = await verifyOperatorCookie(token);
    expect(payload.sid).toBe(SID);
    expect(payload.iat).toBe(iat);
  });

  it("rejects a tampered payload segment", async () => {
    const token = await mintCookie({ sid: SID });
    // Mutate the middle (payload) segment.
    const [header, payload, sig] = token.split(".");
    // Flip the last character of the payload (still base64url-ish).
    const flipped = payload.slice(0, -1) + (payload.endsWith("a") ? "b" : "a");
    const tampered = `${header}.${flipped}.${sig}`;
    await expect(verifyOperatorCookie(tampered)).rejects.toBeInstanceOf(OperatorCookieInvalidError);
  });

  it("rejects a tampered signature segment", async () => {
    const token = await mintCookie({ sid: SID });
    const [header, payload, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    const tampered = `${header}.${payload}.${flipped}`;
    await expect(verifyOperatorCookie(tampered)).rejects.toBeInstanceOf(OperatorCookieInvalidError);
  });

  it("rejects a cookie whose iat is more than 12h in the past", async () => {
    const token = await mintExpiredCookie({ sid: SID });
    await expect(verifyOperatorCookie(token)).rejects.toBeInstanceOf(OperatorCookieExpiredError);
  });

  it("rejects a cookie missing the iat claim", async () => {
    // Build a token by hand with no iat — use jose directly via the fixtures
    // module's secret to avoid the helper that always sets iat.
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(TEST_ACTING_AS_COOKIE_SECRET);
    const token = await new SignJWT({ sid: SID })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(key);
    await expect(verifyOperatorCookie(token)).rejects.toBeInstanceOf(OperatorCookieInvalidError);
  });

  it("throws when signing a payload with an empty sid", async () => {
    const iat = Math.floor(Date.now() / 1000);
    await expect(signOperatorCookie({ sid: "", iat })).rejects.toThrowError();
  });
});
