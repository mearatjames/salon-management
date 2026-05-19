// tests/e2e/_square-server-stub.ts
//
// Tiny HTTP server that mimics Square's REST surface for the server-side
// fetches that the Next.js app makes:
//   - POST /oauth2/token          → token exchange (auth code OR refresh)
//   - POST /oauth2/revoke         → no-op success
//   - GET  /v2/merchants/:id      → merchant profile
//   - GET  /v2/devices            → device list (SDK shape)
//
// The Next.js dev server reads `SQUARE_API_BASE_URL=http://127.0.0.1:4567`
// from `.env.local` at boot, so every server-side Square call lands here
// instead of escaping to the real Square hosts.
//
// Browser-side Square interactions (the `/oauth2/authorize` redirect) are
// intercepted via Playwright's `context.route` in `_square-stub.ts`.
//
// === Singleton model (issue #41) ===
// One instance runs for the entire Playwright run, started by
// `tests/e2e/_global-setup.ts` and torn down by `_global-teardown.ts`.
// Worker processes can't reach the in-process control closures directly,
// so each spec gets a controls handle via `getStubControls()` that proxies
// every mutation through the `/__control/*` HTTP endpoints below. A
// cross-worker file lock (`acquireStubLock` / `releaseStubLock`) keeps
// only one Square-using spec file mutating stub state at a time, while
// non-Square specs run in parallel under `workers: 2`.

import { createHmac } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DeviceStub = {
  id: string;
  name: string;
  status: "PAIRED" | "UNPAIRED";
};

export type MerchantStub = {
  id: string;
  business_name: string;
};

export type CheckoutCreateStub = {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  tipCents?: number;
};

export type CheckoutGetStub = {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "CANCEL_REQUESTED";
  tipCents?: number;
};

export type CheckoutCancelStub = {
  responseStatus: "CANCELED" | "COMPLETED" | "NETWORK_ERROR";
  tipCents?: number;
};

/**
 * Controls returned by `getStubControls()` and used by spec files. Each
 * mutator is async because it round-trips through the singleton stub
 * server's `/__control/*` endpoints.
 */
export type ServerStubControls = {
  setMerchant(m: MerchantStub): Promise<void>;
  setDevices(devices: DeviceStub[]): Promise<void>;
  setTokenResponse(resp: TokenResponseShape | TokenErrorShape): Promise<void>;
  /** Prime the *next* POST /v2/terminals/checkouts response. */
  setNextCheckoutCreate(stub: CheckoutCreateStub | null): Promise<void>;
  /** Prime a GET /v2/terminals/checkouts/:id response for a specific id. */
  setCheckoutGet(checkoutId: string, stub: CheckoutGetStub | null): Promise<void>;
  /** Prime POST /v2/terminals/checkouts/:id/cancel. */
  setCheckoutCancel(checkoutId: string, stub: CheckoutCancelStub | null): Promise<void>;
  /** Inspect the last minted checkout id (server-side global). */
  lastCheckoutId(): Promise<string | null>;
  /** Feature 018 — base URL the gift-card auto-webhook POSTs back to. */
  setWebhookBaseUrl(url: string | null): Promise<void>;
  /** Feature 018 — suppress the auto-fired gift-card payment.updated webhook. */
  suppressGiftWebhook(): Promise<void>;
  /** Feature 018 — re-enable the auto-fired gift-card payment.updated webhook. */
  unsuppressGiftWebhook(): Promise<void>;
  reset(): Promise<void>;
  recordedCalls(): Promise<readonly RecordedCall[]>;
  /** No-op; the server lifecycle is owned by globalSetup/globalTeardown. */
  close(): Promise<void>;
};

/** Returned by `startSquareServerStub()` — what globalSetup holds. */
export type ServerHandle = {
  port: number;
  close(): Promise<void>;
};

export type TokenResponseShape = {
  access_token: string;
  refresh_token: string;
  merchant_id: string;
  expires_at: string;
  scope: string;
  token_type: "bearer";
};

export type TokenErrorShape = {
  status: number;
  body: object | string;
};

export type RecordedCall = {
  method: string;
  path: string;
};

const DEFAULT_TOKEN: TokenResponseShape = {
  access_token: "stub-access-token",
  refresh_token: "stub-refresh-token",
  merchant_id: "MERCHANT_STUB",
  // 30d out — plenty of headroom.
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  scope: "PAYMENTS_WRITE PAYMENTS_READ MERCHANT_PROFILE_READ DEVICE_CREDENTIAL_MANAGEMENT",
  token_type: "bearer",
};

const DEFAULT_MERCHANT: MerchantStub = {
  id: "MERCHANT_STUB",
  business_name: "Stub Salon",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: object | string): void {
  const out = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(out);
}

// Feature 018 — gift-card fixture matrix. Same shape as the browser-side
// stub in `_square-stub.ts`. The Square SDK posts the GAN in the JSON
// body of /v2/gift-cards/from-gan; the stub routes on the last-4 chars.
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
        "square server stub: SQUARE_WEBHOOK_SIGNATURE_KEY not set and tests/fixtures/square-webhook-key.txt missing"
      );
    }
    return fromEnv;
  }
}

export async function startSquareServerStub(port = 4567): Promise<ServerHandle> {
  let merchant: MerchantStub = { ...DEFAULT_MERCHANT };
  let devices: DeviceStub[] = [];
  let tokenResponse: TokenResponseShape | TokenErrorShape = { ...DEFAULT_TOKEN };
  let nextCheckoutCreate: CheckoutCreateStub | null = null;
  const checkoutGetStubs = new Map<string, CheckoutGetStub>();
  const checkoutCancelStubs = new Map<string, CheckoutCancelStub>();
  let lastMintedCheckoutId: string | null = null;
  let giftWebhookSuppressed = false;
  let webhookBaseUrl: string | null = null;
  let giftCardCounter = 0;
  let giftPaymentCounter = 0;
  const webhookKey = loadWebhookKey();
  const calls: RecordedCall[] = [];

  function resetState(): void {
    merchant = { ...DEFAULT_MERCHANT };
    devices = [];
    tokenResponse = { ...DEFAULT_TOKEN };
    nextCheckoutCreate = null;
    checkoutGetStubs.clear();
    checkoutCancelStubs.clear();
    lastMintedCheckoutId = null;
    giftWebhookSuppressed = false;
    webhookBaseUrl = null;
    giftCardCounter = 0;
    giftPaymentCounter = 0;
    calls.length = 0;
  }

  function ack(res: ServerResponse): void {
    json(res, 200, { ok: true });
  }

  async function handleControl(
    method: string,
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (!path.startsWith("/__control/")) return false;
    const op = path.slice("/__control/".length).replace(/\/$/, "");

    if (method === "GET" && op === "last-checkout-id") {
      json(res, 200, { id: lastMintedCheckoutId });
      return true;
    }
    if (method === "GET" && op === "recorded-calls") {
      json(res, 200, { calls });
      return true;
    }

    if (method !== "POST") {
      json(res, 405, { error: `method ${method} not allowed for ${path}` });
      return true;
    }

    const raw = await readBody(req);
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return true;
      }
    }

    switch (op) {
      case "merchant":
        merchant = body as unknown as MerchantStub;
        ack(res);
        return true;
      case "devices":
        devices = (body.devices as DeviceStub[] | undefined) ?? [];
        ack(res);
        return true;
      case "token-response":
        tokenResponse = body as unknown as TokenResponseShape | TokenErrorShape;
        ack(res);
        return true;
      case "next-checkout-create":
        nextCheckoutCreate = (body.stub as CheckoutCreateStub | null | undefined) ?? null;
        ack(res);
        return true;
      case "checkout-get": {
        const id = String(body.checkoutId ?? "");
        const stub = body.stub as CheckoutGetStub | null | undefined;
        if (stub === null || stub === undefined) checkoutGetStubs.delete(id);
        else checkoutGetStubs.set(id, stub);
        ack(res);
        return true;
      }
      case "checkout-cancel": {
        const id = String(body.checkoutId ?? "");
        const stub = body.stub as CheckoutCancelStub | null | undefined;
        if (stub === null || stub === undefined) checkoutCancelStubs.delete(id);
        else checkoutCancelStubs.set(id, stub);
        ack(res);
        return true;
      }
      case "webhook-base-url":
        webhookBaseUrl = (body.url as string | null | undefined) ?? null;
        ack(res);
        return true;
      case "suppress-gift-webhook":
        giftWebhookSuppressed = true;
        ack(res);
        return true;
      case "unsuppress-gift-webhook":
        giftWebhookSuppressed = false;
        ack(res);
        return true;
      case "reset":
        resetState();
        ack(res);
        return true;
      default:
        json(res, 404, { error: `unknown control op ${op}` });
        return true;
    }
  }

  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (await handleControl(method, path, req, res)) return;

    calls.push({ method, path });

    // POST /oauth2/token
    if (method === "POST" && path === "/oauth2/token") {
      await readBody(req); // consume
      if ("status" in tokenResponse) {
        return json(res, tokenResponse.status, tokenResponse.body);
      }
      return json(res, 200, tokenResponse);
    }

    // POST /oauth2/revoke
    if (method === "POST" && path === "/oauth2/revoke") {
      await readBody(req);
      return json(res, 200, { success: true });
    }

    // GET /v2/merchants/:id
    if (method === "GET" && /^\/v2\/merchants\/[^/]+$/.test(path)) {
      return json(res, 200, { merchant });
    }

    // GET /v2/devices  (SDK `client.devices.list()` shape)
    if (method === "GET" && /^\/v2\/devices\/?$/.test(path)) {
      return json(res, 200, {
        devices: devices.map((d) => ({
          id: d.id,
          attributes: { manufacturer: "Square", model: "Terminal", name: d.name },
          status: { category: d.status },
        })),
      });
    }

    // POST /v2/terminals/checkouts  (createCheckout)
    if (method === "POST" && /^\/v2\/terminals\/checkouts\/?$/.test(path)) {
      await readBody(req);
      const createStatus = nextCheckoutCreate?.status ?? "PENDING";
      const createTip = nextCheckoutCreate?.tipCents;
      const newCheckoutId = `tco_stub_${Math.random().toString(36).slice(2, 10)}`;
      lastMintedCheckoutId = newCheckoutId;
      const body = {
        checkout: {
          id: newCheckoutId,
          status: createStatus,
          payment_ids: createStatus === "COMPLETED" ? [`pay_${newCheckoutId}`] : [],
          amount_money: { amount: 4500, currency: "USD" },
          tip_money: createTip != null ? { amount: createTip, currency: "USD" } : undefined,
        },
      };
      nextCheckoutCreate = null;
      return json(res, 200, body);
    }

    // GET /v2/terminals/checkouts/:id  (getCheckout)
    const getMatch = /^\/v2\/terminals\/checkouts\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (method === "GET" && getMatch?.[1]) {
      const idForGet = getMatch[1];
      const getStub = checkoutGetStubs.get(idForGet);
      const getStatus = getStub?.status ?? "PENDING";
      const getTip = getStub?.tipCents;
      const body = {
        checkout: {
          id: idForGet,
          status: getStatus,
          payment_ids: getStatus === "COMPLETED" ? [`pay_${idForGet}`] : [],
          amount_money: { amount: 4500, currency: "USD" },
          tip_money: getTip != null ? { amount: getTip, currency: "USD" } : undefined,
        },
      };
      return json(res, 200, body);
    }

    // POST /v2/terminals/checkouts/:id/cancel
    const cancelMatch = /^\/v2\/terminals\/checkouts\/([A-Za-z0-9_-]+)\/cancel\/?$/.exec(path);
    if (method === "POST" && cancelMatch?.[1]) {
      await readBody(req);
      const idForCancel = cancelMatch[1];
      const cancelStub = checkoutCancelStubs.get(idForCancel);
      if (cancelStub?.responseStatus === "NETWORK_ERROR") {
        res.destroy();
        return;
      }
      const cancelStatus = cancelStub?.responseStatus ?? "CANCELED";
      const cancelTip = cancelStub?.tipCents;
      const body = {
        checkout: {
          id: idForCancel,
          status: cancelStatus,
          payment_ids: cancelStatus === "COMPLETED" ? [`pay_${idForCancel}`] : [],
          tip_money: cancelTip != null ? { amount: cancelTip, currency: "USD" } : undefined,
        },
      };
      return json(res, 200, body);
    }

    // Feature 018 - POST /v2/gift-cards/from-gan. Routes through the
    // deterministic fixture matrix keyed by the GAN's last-4 chars.
    if (method === "POST" && /^\/v2\/gift-cards\/from-gan\/?$/.test(path)) {
      const body = await readBody(req);
      let parsed: { gan?: string } = {};
      try {
        parsed = JSON.parse(body) as { gan?: string };
      } catch {
        // fall through with empty body
      }
      const gan = typeof parsed.gan === "string" ? parsed.gan : "";
      const fixture = giftCardFixtureFromGan(gan);
      if (fixture.kind === "NOT_FOUND") {
        return json(res, 404, {
          errors: [
            {
              category: "INVALID_REQUEST_ERROR",
              code: "NOT_FOUND",
              detail: "No gift card found for that GAN.",
            },
          ],
        });
      }
      giftCardCounter += 1;
      const stripped = gan.replace(/\s/g, "");
      const squareGiftCardId = `gftc_${stripped.slice(-4) || `STUB${giftCardCounter}`}`;
      return json(res, 200, {
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
      });
    }

    // Feature 018 - POST /v2/payments (gift-card charges only).
    if (method === "POST" && /^\/v2\/payments\/?$/.test(path)) {
      const body = await readBody(req);
      let parsed: {
        source_id?: string;
        amount_money?: { amount?: number; currency?: string };
        reference_id?: string;
        source_type?: string;
      } = {};
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        // fall through; treated as malformed
      }
      const sourceId = parsed.source_id ?? "";
      const isGiftCard = parsed.source_type === "GIFT_CARD" || sourceId.startsWith("gftc_");
      if (!isGiftCard) {
        return json(res, 400, {
          errors: [
            {
              category: "INVALID_REQUEST_ERROR",
              code: "INVALID_REQUEST_ERROR",
              detail: "non-gift-card payment not supported by stub",
            },
          ],
        });
      }
      giftPaymentCounter += 1;
      // Include a high-resolution timestamp in the id so multiple test runs
      // (which all share the same Supabase DB) don't collide on the
      // `square_gift_card_payment_id` column — the webhook handler looks up
      // payments rows by this id and `.maybeSingle()` throws on duplicates.
      const squarePaymentId = `pay_gc_${Date.now()}_${giftPaymentCounter}`;
      const amount = parsed.amount_money?.amount ?? 0;
      const referenceId = parsed.reference_id ?? "";
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
      // Auto-fire the settlement webhook after 100ms when a baseUrl was
      // provided by the test. Suppressible via suppressGiftWebhook().
      if (!giftWebhookSuppressed && webhookBaseUrl) {
        const evt = {
          merchant_id: merchant.id,
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
        const captured = webhookBaseUrl;
        setTimeout(() => {
          const rawBody = JSON.stringify(evt);
          const webhookUrl = new URL("/api/webhooks/square", captured).toString();
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
            console.warn("square server stub: auto-fired gift webhook failed", err);
          });
        }, 100);
      }
      return json(res, 200, responseBody);
    }

    // Feature 018 - GET /v2/payments/:id (polling fallback).
    const paymentGetMatch = /^\/v2\/payments\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (method === "GET" && paymentGetMatch?.[1]) {
      const paymentId = paymentGetMatch[1];
      return json(res, 200, {
        payment: {
          id: paymentId,
          status: "COMPLETED",
          source_type: "GIFT_CARD",
        },
      });
    }

    // Catch-all 404.
    return json(res, 404, { error: `unstubbed ${method} ${path}` });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Client-side controls — used by spec files. Each method round-trips through
// the singleton stub server via HTTP.
// ---------------------------------------------------------------------------

const DEFAULT_STUB_BASE = "http://127.0.0.1:4567";

async function controlPost(baseUrl: string, op: string, body: object = {}): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`stub control POST ${op} failed: ${res.status} ${await res.text()}`);
  }
}

async function controlGet<T>(baseUrl: string, op: string): Promise<T> {
  const res = await fetch(`${baseUrl}/__control/${op}`);
  if (!res.ok) {
    throw new Error(`stub control GET ${op} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function getStubControls(baseUrl: string = DEFAULT_STUB_BASE): ServerStubControls {
  return {
    async setMerchant(m) {
      await controlPost(baseUrl, "merchant", m);
    },
    async setDevices(devices) {
      await controlPost(baseUrl, "devices", { devices });
    },
    async setTokenResponse(resp) {
      await controlPost(baseUrl, "token-response", resp);
    },
    async setNextCheckoutCreate(stub) {
      await controlPost(baseUrl, "next-checkout-create", { stub });
    },
    async setCheckoutGet(checkoutId, stub) {
      await controlPost(baseUrl, "checkout-get", { checkoutId, stub });
    },
    async setCheckoutCancel(checkoutId, stub) {
      await controlPost(baseUrl, "checkout-cancel", { checkoutId, stub });
    },
    async lastCheckoutId() {
      const { id } = await controlGet<{ id: string | null }>(baseUrl, "last-checkout-id");
      return id;
    },
    async setWebhookBaseUrl(url) {
      await controlPost(baseUrl, "webhook-base-url", { url });
    },
    async suppressGiftWebhook() {
      await controlPost(baseUrl, "suppress-gift-webhook");
    },
    async unsuppressGiftWebhook() {
      await controlPost(baseUrl, "unsuppress-gift-webhook");
    },
    async reset() {
      await controlPost(baseUrl, "reset");
    },
    async recordedCalls() {
      const { calls } = await controlGet<{ calls: RecordedCall[] }>(baseUrl, "recorded-calls");
      return calls;
    },
    async close() {
      // Server lifecycle owned by globalSetup/globalTeardown.
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-worker file lock — serializes Square-using spec files across the
// worker pool so two specs don't race on shared stub response state.
// ---------------------------------------------------------------------------

const LOCK_PATH = join(tmpdir(), "tang-nails-square-stub.lock");
const STALE_LOCK_MS = 15 * 60 * 1000;

export async function acquireStubLock(timeoutMs = 300_000, pollMs = 100): Promise<void> {
  const startAt = Date.now();
  while (true) {
    try {
      const fd = openSync(LOCK_PATH, "wx");
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const raw = readFileSync(LOCK_PATH, "utf-8");
        const lines = raw.split("\n");
        const stampedAt = Number(lines[1]);
        if (Number.isFinite(stampedAt) && Date.now() - stampedAt > STALE_LOCK_MS) {
          unlinkSync(LOCK_PATH);
          continue;
        }
      } catch {
        // race with holder; retry
      }
      if (Date.now() - startAt > timeoutMs) {
        throw new Error(`acquireStubLock: timed out after ${timeoutMs}ms waiting for ${LOCK_PATH}`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

export function releaseStubLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // already gone — fine
  }
}

/** Called by globalSetup to clear any lock left behind by a crashed worker. */
export function clearStubLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // not present — fine
  }
}

// ---------------------------------------------------------------------------
// Ticket-state lock — separate from the Square stub lock above. Held by
// specs that delete + restore the today-paid-tickets seed (`dashboard.spec`
// and `end-of-day-cash.spec`) so their wipes don't race each other when
// `workers > 1`. Checkout-creating specs don't need this lock because they
// only INSERT new tickets — never delete the seed — so they can't drive a
// dashboard read below the expected seed count.
// ---------------------------------------------------------------------------

const TICKET_LOCK_PATH = join(tmpdir(), "tang-nails-ticket-state.lock");

export async function acquireTicketStateLock(timeoutMs = 300_000, pollMs = 100): Promise<void> {
  const startAt = Date.now();
  while (true) {
    try {
      const fd = openSync(TICKET_LOCK_PATH, "wx");
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const raw = readFileSync(TICKET_LOCK_PATH, "utf-8");
        const lines = raw.split("\n");
        const stampedAt = Number(lines[1]);
        if (Number.isFinite(stampedAt) && Date.now() - stampedAt > STALE_LOCK_MS) {
          unlinkSync(TICKET_LOCK_PATH);
          continue;
        }
      } catch {
        // race with holder; retry
      }
      if (Date.now() - startAt > timeoutMs) {
        throw new Error(
          `acquireTicketStateLock: timed out after ${timeoutMs}ms waiting for ${TICKET_LOCK_PATH}`
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

export function releaseTicketStateLock(): void {
  try {
    unlinkSync(TICKET_LOCK_PATH);
  } catch {
    // already gone — fine
  }
}

export function clearTicketStateLock(): void {
  try {
    unlinkSync(TICKET_LOCK_PATH);
  } catch {
    // not present — fine
  }
}
