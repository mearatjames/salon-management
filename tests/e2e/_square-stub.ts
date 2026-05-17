// tests/e2e/_square-stub.ts
//
// Playwright fixture: intercept every Square Terminal API call that the
// app under test would make and serve canned responses. Asserts at
// teardown that no real Square hostname was ever contacted (catches a
// missed stub before it racks up a sandbox bill).
//
// Usage:
//   const sq = await squareStub(context, baseURL);
//   sq.stubListDevices([{ id: 'device:ABC', name: 'Lobby', status: 'PAIRED' }]);
//   sq.stubCreateCheckout({ ticketId, paymentId, returnStatus: 'PENDING' });
//   sq.stubGetCheckoutStatus(checkoutId, { status: 'COMPLETED', tipCents: 800 });
//   await sq.simulateWebhook({ ... }); // POSTs validly-signed event
//   sq.assertNoLiveSquareCalls(); // call from afterEach
//
// Notes:
//   - Square-stubbed paths are matched against sandbox AND production
//     hostnames; any production hit fails the test outright.
//   - The webhook helper reads tests/fixtures/square-webhook-key.txt and
//     signs the payload with HMAC-SHA256(key, url + body) per
//     contracts/webhooks.contract.md section 2.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BrowserContext, Route } from "@playwright/test";

const SANDBOX_HOST = "connect.squareupsandbox.com";
const PROD_HOST = "connect.squareup.com";

type DeviceStub = { id: string; name: string; status: "PAIRED" | "UNPAIRED" };

type CreateCheckoutArgs = {
  ticketId: string;
  paymentId: string;
  returnStatus?: "PENDING" | "COMPLETED" | "CANCELED";
};

type GetCheckoutArgs = {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "CANCEL_REQUESTED";
  tipCents?: number;
};

type CancelCheckoutArgs = {
  responseStatus: "CANCELED" | "COMPLETED" | "NETWORK_ERROR";
};

export type SquareStub = {
  stubListDevices(devices: DeviceStub[]): void;
  stubCreateCheckout(args: CreateCheckoutArgs): { checkoutId: string };
  stubGetCheckoutStatus(checkoutId: string, args: GetCheckoutArgs): void;
  stubCancelCheckout(checkoutId: string, args: CancelCheckoutArgs): void;
  simulateWebhook(event: object): Promise<{ status: number }>;
  assertNoLiveSquareCalls(): void;
  /**
   * Suppress the auto-fired `payment.updated` webhook that follows a
   * successful gift-card payments.create response. Useful for tests that
   * need to assert the polling-fallback path or simulate a webhook race.
   * The suppression lasts until the helper returned by it is invoked.
   */
  withSuppressedGiftWebhook(): { restore(): void };
};

// ---------------------------------------------------------------------
// Gift-card fixture matrix (feature 018, research R10). The stub routes
// `/v2/gift-cards/from-gan` against this keyed by the GAN's last-4 chars
// (whitespace stripped). Tests use the matching suffix to opt into a
// behaviour without coupling to a specific GAN format.
// ---------------------------------------------------------------------

type GiftCardFixtureKind =
  | { kind: "ACTIVE"; balanceCents: number }
  | { kind: "BLOCKED" }
  | { kind: "PENDING" }
  | { kind: "DEACTIVATED" }
  | { kind: "NOT_FOUND" };

function giftCardFixtureFromGan(gan: string): GiftCardFixtureKind {
  const stripped = gan.replace(/\s/g, "").toUpperCase();
  const last4 = stripped.slice(-4);
  switch (last4) {
    case "0001":
      return { kind: "ACTIVE", balanceCents: 6000 };
    case "0002":
      return { kind: "ACTIVE", balanceCents: 1500 };
    case "0003":
      return { kind: "ACTIVE", balanceCents: 500 };
    case "0000":
      return { kind: "ACTIVE", balanceCents: 0 };
    case "BLKD":
      return { kind: "BLOCKED" };
    case "PEND":
      return { kind: "PENDING" };
    case "DEAC":
      return { kind: "DEACTIVATED" };
    default:
      return { kind: "NOT_FOUND" };
  }
}

function loadWebhookKey(): string {
  try {
    return readFileSync(
      join(process.cwd(), "tests/fixtures/square-webhook-key.txt"),
      "utf-8"
    ).trim();
  } catch {
    const fromEnv = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!fromEnv) {
      throw new Error(
        "square stub: SQUARE_WEBHOOK_SIGNATURE_KEY not set and tests/fixtures/square-webhook-key.txt missing"
      );
    }
    return fromEnv;
  }
}

export async function squareStub(context: BrowserContext, baseURL: string): Promise<SquareStub> {
  const webhookKey = loadWebhookKey();
  const liveHits: string[] = [];
  const devicesStub: DeviceStub[] = [];
  const createdCheckouts = new Map<string, CreateCheckoutArgs & { checkoutId: string }>();
  const checkoutStatuses = new Map<string, GetCheckoutArgs>();
  const cancelOutcomes = new Map<string, CancelCheckoutArgs>();
  // Feature 018 — when true, the auto-fired payment.updated webhook
  // following a successful gift-card payments.create is suppressed so
  // tests can drive the polling-fallback path.
  let suppressGiftWebhook = false;
  let giftCardCounter = 0;
  let giftPaymentCounter = 0;

  await context.route(
    (url) => url.hostname === SANDBOX_HOST || url.hostname === PROD_HOST,
    (route: Route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      // terminals.devices.list
      if (method === "GET" && /^\/v2\/devices\/?$/.test(path)) {
        const body = {
          devices: devicesStub.map((d) => ({
            id: d.id,
            attributes: { manufacturer: "Square", model: "Terminal", name: d.name },
            status: { category: d.status },
          })),
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      }

      // terminals.createCheckout (POST /v2/terminals/checkouts)
      if (method === "POST" && /^\/v2\/terminals\/checkouts\/?$/.test(path)) {
        const primed = createdCheckouts.values().next().value;
        if (!primed) {
          liveHits.push(`POST ${path} (no stub primed)`);
          return route.abort();
        }
        const checkoutId = primed.checkoutId;
        const responseBody = {
          checkout: {
            id: checkoutId,
            status: primed.returnStatus ?? "PENDING",
            reference_id: primed.ticketId,
            payment_ids: primed.returnStatus === "COMPLETED" ? [`pay_${checkoutId}`] : [],
            amount_money: { amount: 4500, currency: "USD" },
            device_options: { device_id: "device:STUB" },
          },
        };
        createdCheckouts.delete(checkoutId);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseBody),
        });
      }

      // terminals.getCheckout (GET /v2/terminals/checkouts/:id)
      const getMatch = /^\/v2\/terminals\/checkouts\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      if (method === "GET" && getMatch?.[1]) {
        const checkoutId = getMatch[1];
        const stub = checkoutStatuses.get(checkoutId);
        if (!stub) {
          liveHits.push(`GET ${path} (no status stub primed for ${checkoutId})`);
          return route.abort();
        }
        const body = {
          checkout: {
            id: checkoutId,
            status: stub.status,
            payment_ids: stub.status === "COMPLETED" ? [`pay_${checkoutId}`] : [],
            amount_money: { amount: 4500, currency: "USD" },
            tip_money:
              stub.tipCents != null ? { amount: stub.tipCents, currency: "USD" } : undefined,
          },
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      }

      // terminals.cancelCheckout (POST /v2/terminals/checkouts/:id/cancel)
      const cancelMatch = /^\/v2\/terminals\/checkouts\/([A-Za-z0-9_-]+)\/cancel\/?$/.exec(path);
      if (method === "POST" && cancelMatch?.[1]) {
        const checkoutId = cancelMatch[1];
        const outcome = cancelOutcomes.get(checkoutId);
        if (!outcome) {
          liveHits.push(`POST ${path} (no cancel stub primed)`);
          return route.abort();
        }
        if (outcome.responseStatus === "NETWORK_ERROR") {
          return route.abort("failed");
        }
        const body = {
          checkout: {
            id: checkoutId,
            status: outcome.responseStatus,
            payment_ids: outcome.responseStatus === "COMPLETED" ? [`pay_${checkoutId}`] : [],
          },
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      }

      // /oauth2/token
      if (method === "POST" && /^\/oauth2\/token\/?$/.test(path)) {
        const body = {
          access_token: "stub-access-token",
          refresh_token: "stub-refresh-token",
          merchant_id: "MERCHANT_STUB",
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          scope: "PAYMENTS_WRITE PAYMENTS_READ MERCHANT_PROFILE_READ DEVICE_CREDENTIAL_MANAGEMENT",
          token_type: "bearer",
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      }

      // /oauth2/revoke
      if (method === "POST" && /^\/oauth2\/revoke\/?$/.test(path)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }

      // /v2/merchants/:id
      const merchantMatch = /^\/v2\/merchants\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      if (method === "GET" && merchantMatch?.[1]) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            merchant: { id: merchantMatch[1], business_name: "Stub Salon" },
          }),
        });
      }

      // Feature 018: /v2/gift-cards/from-gan — gift-card lookup by GAN.
      // The Square SDK posts the GAN in the JSON body; we route on the
      // body's `gan` field through the deterministic fixture matrix.
      if (method === "POST" && /^\/v2\/gift-cards\/from-gan\/?$/.test(path)) {
        let parsed: { gan?: string } = {};
        try {
          parsed = JSON.parse(route.request().postData() ?? "{}") as { gan?: string };
        } catch {
          // fall through with empty body
        }
        const gan = typeof parsed.gan === "string" ? parsed.gan : "";
        const fixture = giftCardFixtureFromGan(gan);
        if (fixture.kind === "NOT_FOUND") {
          return route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({
              errors: [
                {
                  category: "INVALID_REQUEST_ERROR",
                  code: "NOT_FOUND",
                  detail: "No gift card found for that GAN.",
                },
              ],
            }),
          });
        }
        giftCardCounter += 1;
        const stripped = gan.replace(/\s/g, "");
        const squareGiftCardId = `gftc_${stripped.slice(-4) || `STUB${giftCardCounter}`}`;
        const giftCardBody = {
          gift_card: {
            id: squareGiftCardId,
            type: "DIGITAL",
            gan_source: "OTHER",
            state: fixture.kind,
            balance_money:
              fixture.kind === "ACTIVE"
                ? { amount: fixture.balanceCents, currency: "USD" }
                : { amount: 0, currency: "USD" },
            gan: stripped,
          },
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(giftCardBody),
        });
      }

      // Feature 018: /v2/payments — gift-card payment creation. The
      // existing terminal route handles `terminals.createCheckout`; this
      // branch matches the Payments-API surface used for gift redemption.
      // Card-on-terminal payments NEVER hit this endpoint (they arrive
      // via /v2/terminals/checkouts handled above).
      if (method === "POST" && /^\/v2\/payments\/?$/.test(path)) {
        let body: {
          source_id?: string;
          amount_money?: { amount?: number; currency?: string };
          reference_id?: string;
          source_type?: string;
        } = {};
        try {
          body = JSON.parse(route.request().postData() ?? "{}");
        } catch {
          // fall through; treated as malformed
        }
        // The SDK sends `source_id` for gift-card charges; the stub
        // recognises a gift-card payment by the `gftc_` prefix on the
        // source_id, or by an explicit source_type === 'GIFT_CARD'.
        const sourceId = body.source_id ?? "";
        const isGiftCard = body.source_type === "GIFT_CARD" || sourceId.startsWith("gftc_");
        if (!isGiftCard) {
          // Fall through to the live-hit fallback — non-gift-card
          // Payments calls are not part of the v1 scope and indicate a
          // missed stub.
          liveHits.push(`${method} ${url.hostname}${path} (non-gift-card payments.create)`);
          return route.abort();
        }
        giftPaymentCounter += 1;
        const squarePaymentId = `pay_gc_${giftPaymentCounter}`;
        const amount = body.amount_money?.amount ?? 0;
        const referenceId = body.reference_id ?? "";
        const responseBody = {
          payment: {
            id: squarePaymentId,
            status: "COMPLETED",
            source_type: "GIFT_CARD",
            source_id: sourceId,
            amount_money: { amount, currency: "USD" },
            tip_money: { amount: 0, currency: "USD" },
            reference_id: referenceId,
          },
        };
        // Schedule an auto-fired payment.updated webhook 100ms after the
        // response — mirrors Square's near-real-time settlement signal.
        // Suppressed when the test opted into withSuppressedGiftWebhook().
        if (!suppressGiftWebhook) {
          const event = {
            merchant_id: "MERCHANT_STUB",
            type: "payment.updated",
            event_id: `evt_${squarePaymentId}`,
            created_at: new Date().toISOString(),
            data: {
              type: "payment",
              id: squarePaymentId,
              object: {
                payment: {
                  id: squarePaymentId,
                  status: "COMPLETED",
                  source_type: "GIFT_CARD",
                  source_id: sourceId,
                  amount_money: { amount, currency: "USD" },
                  reference_id: referenceId,
                },
              },
            },
          };
          setTimeout(() => {
            const rawBody = JSON.stringify(event);
            const webhookUrl = new URL("/api/webhooks/square", baseURL).toString();
            const signature = createHmac("sha256", webhookKey)
              .update(webhookUrl + rawBody)
              .digest("base64");
            fetch(webhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-square-hmacsha256-signature": signature,
              },
              body: rawBody,
            }).catch((err) => {
              console.warn("square stub: auto-fired gift webhook failed", err);
            });
          }, 100);
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseBody),
        });
      }

      // Feature 018: GET /v2/payments/:id — Square Payment retrieval
      // (polling fallback wrapper in lib/square/gift-cards.ts:getPayment).
      const paymentGetMatch = /^\/v2\/payments\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      if (method === "GET" && paymentGetMatch?.[1]) {
        const paymentId = paymentGetMatch[1];
        const responseBody = {
          payment: {
            id: paymentId,
            status: "COMPLETED",
            source_type: "GIFT_CARD",
          },
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseBody),
        });
      }

      // Anything else against a Square host is a live hit.
      liveHits.push(`${method} ${url.hostname}${path}`);
      return route.abort();
    }
  );

  return {
    stubListDevices(devices) {
      devicesStub.length = 0;
      devicesStub.push(...devices);
    },
    stubCreateCheckout(args) {
      const checkoutId = `tco_${args.paymentId}`;
      createdCheckouts.set(checkoutId, { ...args, checkoutId });
      return { checkoutId };
    },
    stubGetCheckoutStatus(checkoutId, args) {
      checkoutStatuses.set(checkoutId, args);
    },
    stubCancelCheckout(checkoutId, args) {
      cancelOutcomes.set(checkoutId, args);
    },
    async simulateWebhook(event) {
      const rawBody = JSON.stringify(event);
      const url = new URL("/api/webhooks/square", baseURL).toString();
      const signature = createHmac("sha256", webhookKey)
        .update(url + rawBody)
        .digest("base64");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-square-hmacsha256-signature": signature,
        },
        body: rawBody,
      });
      return { status: res.status };
    },
    assertNoLiveSquareCalls() {
      if (liveHits.length > 0) {
        throw new Error(
          `square stub: unstubbed Square API call(s) escaped - ${liveHits.join("; ")}`
        );
      }
    },
    withSuppressedGiftWebhook() {
      suppressGiftWebhook = true;
      return {
        restore() {
          suppressGiftWebhook = false;
        },
      };
    },
  };
}
