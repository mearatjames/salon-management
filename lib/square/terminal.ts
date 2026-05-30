// lib/square/terminal.ts
//
// Server-only wrapper around the Square Terminal/Devices API surface used
// by feature 015 (Square Terminal Card Payment).
//
// Exports:
//   - listDevices()               — used by Settings → Square (US1)
//   - createCheckout({...})       — pushes a payment prompt to a terminal (US2)
//   - getCheckout(checkoutId)     — polling read of a terminal checkout (US2)
//   - cancelCheckout(checkoutId)  — operator cancel from waiting screen (US3)
//
// All four route through `getSquareClient(accessToken)`; the access token
// comes from `readDecryptedTokens()` per call (cheap — single RPC). The
// SDK handles auth, retries, and rate limit headers.
//
// Side effect of `listDevices()`: UPSERTs into `public.square_devices`
// (insert new rows with `friendly_name = providedName`; update
// `last_seen_at` on existing rows). Keeps the local DB synchronized with
// Square's view of the paired devices so the Settings UI can render
// quickly without round-tripping Square on every page load.
//
// Idempotency contract (research R1): `createCheckout` MUST pass the
// deterministic `${ticketId}:${paymentId}` as the Square SDK's
// `idempotencyKey`. Retrying the same paymentId returns the same
// checkout; retrying a fresh paymentId yields a brand-new attempt.

import { createHash } from "node:crypto";

import { getSquareClient } from "@/lib/square/client";
import { readDecryptedTokens } from "@/lib/square/oauth";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

/**
 * Deterministic Square `idempotency_key` derived from `(ticketId, paymentId)`.
 *
 * Square's docs say `terminals.createCheckout` caps idempotency_key at 64
 * chars, but live sandbox rejected a 64-char key — empirically the limit is
 * stricter than documented. We SHA-256 the canonical `${ticketId}:${paymentId}`
 * input and emit the first 32 hex chars (128 bits of entropy — far beyond
 * what's needed for our scale; collision is astronomically unlikely).
 *
 * Same input ⇒ same key (retries dedupe correctly); fresh `paymentId` per
 * attempt ⇒ fresh key (per-attempt-row contract FR-015 holds). Constitution
 * Principle III's "deterministic from ticket_id + payment_id" is preserved
 * by the hash — only the on-wire representation changes.
 */
export function buildIdempotencyKey(ticketId: string, paymentId: string): string {
  return createHash("sha256").update(`${ticketId}:${paymentId}`).digest("hex").slice(0, 32);
}

/**
 * Deterministic Square `idempotency_key` for a refund, derived from
 * `(originalPaymentId, refundPaymentId)` per Constitution Principle III
 * (contracts/square-refund.contract.md).
 *
 * Same canonical input ⇒ same key, so a retried `refundPayment` network
 * call (same refund-leg row) dedupes at Square; a fresh refund-leg row
 * yields a brand-new key. We SHA-256 the canonical
 * `${originalPaymentId}:refund:${refundPaymentId}` and emit the first 45
 * hex chars — comfortably under Square's documented refund idempotency
 * cap while preserving the deterministic key form.
 */
export function buildRefundIdempotencyKey(
  originalPaymentId: string,
  refundPaymentId: string
): string {
  return createHash("sha256")
    .update(`${originalPaymentId}:refund:${refundPaymentId}`)
    .digest("hex")
    .slice(0, 45);
}

export type TerminalDevice = {
  squareDeviceId: string;
  providedName: string;
  status: string;
};

// ---------------------------------------------------------------------
// Domain status union — the application's vocabulary. Maps from Square's
// raw status strings (PENDING|IN_PROGRESS|COMPLETED|CANCELED|CANCEL_REQUESTED).
// Domain consumers (webhook handler, polling endpoint, action) MUST NOT
// depend on Square's exact string casing.
// ---------------------------------------------------------------------

export type TerminalCheckoutDomainStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "canceled"
  | "cancel_requested";

const SQUARE_STATUS_MAP: Record<string, TerminalCheckoutDomainStatus> = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELED: "canceled",
  CANCEL_REQUESTED: "cancel_requested",
};

function mapSquareStatus(s: string | undefined): TerminalCheckoutDomainStatus {
  if (!s) return "pending";
  return SQUARE_STATUS_MAP[s] ?? "pending";
}

// ---------------------------------------------------------------------
// createCheckout — push a payment prompt to a paired Square Terminal.
// ---------------------------------------------------------------------

export type CreateCheckoutInput = {
  ticketId: string;
  paymentId: string;
  amountCents: number;
  deviceId: string;
  referenceId: string;
  /**
   * Feature 051 (US1 single-tender itemized branch): when set, the SDK
   * request sends `checkout.orderId` and OMITS `checkout.amountMoney`.
   * Square renders the line items + discounts from the referenced Order
   * on the terminal screen, the dashboard, and the receipts. When
   * absent (today's split-tender + cash-only-card path), the request
   * falls back to `checkout.amountMoney` exactly as before.
   */
  orderId?: string;
};

export type CreateCheckoutResult = {
  squareTerminalCheckoutId: string;
  status: TerminalCheckoutDomainStatus;
};

/**
 * Push a card-payment prompt to the named Square Terminal device.
 *
 * Idempotency: the Square SDK is called with `idempotencyKey =
 * "${ticketId}:${paymentId}"`. Square dedupes by this key for 24h, so a
 * retried network call (same paymentId) returns the same checkout. A
 * fresh attempt (new paymentId after a failed row) yields a brand-new
 * checkout — see per-attempt-row contract FR-015.
 *
 * The Square SDK throws on non-2xx responses; the caller (the server
 * action) must catch and translate to `SquareCheckoutCreateFailedError`.
 */
export async function createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("createCheckout: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);

  const idempotencyKey = buildIdempotencyKey(input.ticketId, input.paymentId);

  // The SDK accepts a typed CreateTerminalCheckoutRequest. We construct it
  // manually so the test-mocked fake gets a stable arg shape.
  //
  // Feature 051 (US1) — when `orderId` is set we additionally send
  // `checkout.orderId` so Square renders the referenced Order's line
  // items + discounts on the terminal + receipts (instead of the
  // legacy "Custom amount" row). The Square v44 SDK still requires
  // `amountMoney` even on the orderId branch (Square cross-checks it
  // against the Order's grand total), so we send the cart total in
  // both branches and only the `orderId` key differs.
  const checkout: Record<string, unknown> = {
    referenceId: input.referenceId,
    deviceOptions: { deviceId: input.deviceId },
    amountMoney: {
      amount: BigInt(input.amountCents),
      currency: "USD",
    },
  };
  if (input.orderId) {
    checkout.orderId = input.orderId;
  }
  const response = (await client.terminal.checkouts.create({
    idempotencyKey,
    // SDK typing accepts the discriminated shape; tests assert on it directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkout: checkout as any,
  })) as unknown as { checkout?: { id?: string; status?: string } };

  const checkoutId = response.checkout?.id;
  if (!checkoutId) {
    throw new Error("createCheckout: Square response missing checkout.id");
  }

  return {
    squareTerminalCheckoutId: checkoutId,
    status: mapSquareStatus(response.checkout?.status),
  };
}

// ---------------------------------------------------------------------
// getCheckout — read a terminal checkout's current state from Square.
// Used by the cancel-race path (US3); the polling endpoint reads local
// DB state per research R5, NOT this call.
// ---------------------------------------------------------------------

export type GetCheckoutResult = {
  squareTerminalCheckoutId: string;
  status: TerminalCheckoutDomainStatus;
  tipCents: number | null;
  squarePaymentId: string | null;
};

export async function getCheckout(checkoutId: string): Promise<GetCheckoutResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("getCheckout: Square not connected");
  }
  const client = getSquareClient(connection.accessToken);
  const response = (await client.terminal.checkouts.get({ checkoutId })) as unknown as {
    checkout?: {
      id?: string;
      status?: string;
      tip_money?: { amount?: number | bigint };
      tipMoney?: { amount?: number | bigint };
      payment_ids?: string[];
      paymentIds?: string[];
    };
  };

  const c = response.checkout ?? {};
  const tipRaw = c.tip_money?.amount ?? c.tipMoney?.amount;
  const tipCents =
    tipRaw == null ? null : typeof tipRaw === "bigint" ? Number(tipRaw) : Number(tipRaw);
  const paymentIds = c.payment_ids ?? c.paymentIds ?? [];
  const squarePaymentId = paymentIds[0] ?? null;
  // A buyer-entered tip lands on the Payment, not the checkout (see
  // getPaymentTipCents). Order-linked checkouts (feature 051) never echo it
  // onto checkout.tip_money, so fall back to the Payment when it's absent.
  const resolvedTipCents =
    tipCents == null && squarePaymentId != null
      ? await getPaymentTipCents(squarePaymentId)
      : tipCents;
  return {
    squareTerminalCheckoutId: c.id ?? checkoutId,
    status: mapSquareStatus(c.status),
    tipCents: resolvedTipCents,
    squarePaymentId,
  };
}

/**
 * Fetch the buyer-entered tip recorded on a Square Payment, in cents.
 *
 * A tip the buyer adds on the Terminal lands on the Payment object
 * (`payment.tip_money`), NOT on the TerminalCheckout — Square only sets
 * `checkout.tip_money` for a developer-supplied fixed tip when tipping is
 * disabled. Order-linked checkouts (feature 051) never echo the buyer tip
 * onto the checkout, so the completion paths fall back to this read so the
 * recorded `tip_cents` matches what the card was charged (Constitution III).
 *
 * Best-effort: returns `null` (never throws) so a tip-read failure can't
 * block settling the payment. `null` means "no tip information available";
 * the caller keeps whatever tip it already had (typically 0).
 */
export async function getPaymentTipCents(paymentId: string): Promise<number | null> {
  const connection = await readDecryptedTokens();
  if (!connection) return null;
  const client = getSquareClient(connection.accessToken);
  try {
    const response = (await client.payments.get({ paymentId })) as unknown as {
      payment?: {
        tip_money?: { amount?: number | bigint };
        tipMoney?: { amount?: number | bigint };
      };
    };
    const tipRaw = response.payment?.tip_money?.amount ?? response.payment?.tipMoney?.amount;
    return tipRaw == null ? null : Number(tipRaw);
  } catch (err) {
    console.warn("square.terminal.getPaymentTipCents: SDK call failed", { paymentId, err });
    return null;
  }
}

// ---------------------------------------------------------------------
// cancelCheckout — operator pressed Cancel on the waiting screen.
// US3 wires this; US2 ships it for completeness.
// ---------------------------------------------------------------------

export type CancelCheckoutResult = {
  status: TerminalCheckoutDomainStatus;
  tipCents: number | null;
  squarePaymentId: string | null;
};

export async function cancelCheckout(checkoutId: string): Promise<CancelCheckoutResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("cancelCheckout: Square not connected");
  }
  const client = getSquareClient(connection.accessToken);
  const response = (await client.terminal.checkouts.cancel({ checkoutId })) as unknown as {
    checkout?: {
      status?: string;
      tip_money?: { amount?: number | bigint };
      tipMoney?: { amount?: number | bigint };
      payment_ids?: string[];
      paymentIds?: string[];
    };
  };
  const c = response.checkout ?? {};
  const tipRaw = c.tip_money?.amount ?? c.tipMoney?.amount;
  const tipCents =
    tipRaw == null ? null : typeof tipRaw === "bigint" ? Number(tipRaw) : Number(tipRaw);
  const paymentIds = c.payment_ids ?? c.paymentIds ?? [];
  const squarePaymentId = paymentIds[0] ?? null;
  // Cancel-race settle: when Square reports COMPLETED (the buyer paid before
  // the cancel landed), the buyer tip is on the Payment, not the checkout
  // (feature 051 order-linked). Fall back to the Payment when absent.
  const resolvedTipCents =
    tipCents == null && squarePaymentId != null
      ? await getPaymentTipCents(squarePaymentId)
      : tipCents;
  return {
    status: mapSquareStatus(c.status),
    tipCents: resolvedTipCents,
    squarePaymentId,
  };
}

/**
 * List Square Terminal devices paired with the salon's Square account, and
 * sync them into `public.square_devices` (UPSERT — preserve friendly_name
 * and is_default on existing rows; refresh `last_seen_at`).
 *
 * Returns the devices Square reported. If Square is unreachable or the
 * salon is not connected, returns an empty array (the Settings page falls
 * back to "no devices visible" copy).
 */
export async function listDevices(): Promise<TerminalDevice[]> {
  const connection = await readDecryptedTokens();
  if (!connection) return [];

  const client = getSquareClient(connection.accessToken);

  // The SDK's `devices.list` returns a `core.Page<Device>` — we iterate the
  // first page only (a salon has at most a handful of paired terminals).
  let squareDevices: Array<{
    id?: string;
    attributes: { name?: string | null };
    status?: { category?: string };
  }>;
  try {
    const page = await client.devices.list();
    // `Page` is iterable; for the small device count we just collect `.data`.
    // The SDK exposes `.data` as the raw items array on each page.
    const raw = (page as unknown as { data?: unknown[] }).data ?? [];
    squareDevices = raw as typeof squareDevices;
  } catch (err) {
    // Log but do not throw — the Settings page should still render with
    // whatever we already have in `square_devices`.
    console.warn("square.terminal.listDevices: SDK call failed", err);
    return [];
  }

  const devices: TerminalDevice[] = squareDevices
    .filter(
      (
        d
      ): d is {
        id: string;
        attributes: { name?: string | null };
        status?: { category?: string };
      } => typeof d.id === "string" && d.id.length > 0
    )
    .map((d) => ({
      squareDeviceId: d.id,
      providedName: d.attributes?.name ?? "Square Terminal",
      status: d.status?.category ?? "UNKNOWN",
    }));

  if (devices.length === 0) return [];

  const supabase = createSupabaseServiceRoleClient();
  const now = new Date().toISOString();

  // Read existing rows to know which ones already have a friendly_name set
  // (so we don't clobber it on UPSERT).
  const { data: existingRows } = await supabase
    .from("square_devices")
    .select("square_device_id, friendly_name");

  const existing = new Map<string, string>();
  for (const row of existingRows ?? []) {
    existing.set(row.square_device_id, row.friendly_name);
  }

  const rows = devices.map((d) => ({
    square_device_id: d.squareDeviceId,
    friendly_name: existing.get(d.squareDeviceId) ?? d.providedName,
    last_seen_at: now,
    updated_at: now,
  }));

  const { error: upsertErr } = await supabase
    .from("square_devices")
    .upsert(rows, { onConflict: "square_device_id" });

  if (upsertErr) {
    console.warn("square.terminal.listDevices: device upsert failed", upsertErr);
  }

  return devices;
}
