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
};

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
  };
}
