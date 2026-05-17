// Webhook signature verification: tests/unit/square/webhook-signature.test.ts
//
// Covers all four cases from contracts/webhooks.contract.md § 2:
//   - valid signature returns true
//   - one-byte-changed body returns false
//   - missing header returns false
//   - wrong algorithm header returns false
//
// Square's documented algorithm is HMAC-SHA256(key, notification_url + raw_body)
// base64-encoded. The verifier uses constant-time comparison.

import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifySignature } from "@/lib/square/webhooks";

const SIGNING_KEY = "test-square-webhook-key-fixture-32-bytes-long-aaaaa";
const NOTIFICATION_URL = "https://app.tangnails.test/api/webhooks/square";
const RAW_BODY = '{"merchant_id":"M","type":"terminal.checkout.updated","event_id":"e1"}';

function signSha256(key: string, url: string, body: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(url + body)
    .digest("base64");
}

function signSha1(key: string, url: string, body: string): string {
  return crypto
    .createHmac("sha1", key)
    .update(url + body)
    .digest("base64");
}

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const sig = signSha256(SIGNING_KEY, NOTIFICATION_URL, RAW_BODY);
    expect(verifySignature(RAW_BODY, sig, SIGNING_KEY, NOTIFICATION_URL)).toBe(true);
  });

  it("returns false when a single body byte is changed", () => {
    const sig = signSha256(SIGNING_KEY, NOTIFICATION_URL, RAW_BODY);
    const tampered = RAW_BODY.replace('"e1"', '"e2"');
    expect(verifySignature(tampered, sig, SIGNING_KEY, NOTIFICATION_URL)).toBe(false);
  });

  it("returns false when the signature header is missing (null)", () => {
    expect(verifySignature(RAW_BODY, null, SIGNING_KEY, NOTIFICATION_URL)).toBe(false);
  });

  it("returns false for a signature computed with the wrong algorithm (sha1)", () => {
    const sigSha1 = signSha1(SIGNING_KEY, NOTIFICATION_URL, RAW_BODY);
    expect(verifySignature(RAW_BODY, sigSha1, SIGNING_KEY, NOTIFICATION_URL)).toBe(false);
  });
});
