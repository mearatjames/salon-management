// lib/square/gift-cards.ts
//
// Server-only wrapper around Square's gift-card APIs used by feature 018
// (Gift Card Redemption & Split-Tender Checkout).
//
// Exports:
//   - retrieveGiftCardFromGAN(gan)              — Square `client.giftCards.getFromGan`
//                                                  + UPSERT into public.gift_cards;
//                                                  returns the discriminated-union
//                                                  `LookupResult` per research R3.
//   - createGiftCardPayment({...})              — Square `client.payments.create`
//                                                  with deterministic idempotency
//                                                  per Constitution III.
//   - getPayment(squarePaymentId)               — polling fallback for the gift-card
//                                                  waiting screen.
//
// Last-4 mask derivation lives in this module — both lookup and payment-row
// audit paths read it from here so the format ('1234') is single-source.
//
// SERVER-ONLY. NEVER import from a client component — the Square SDK pulls
// in Node-only modules and would leak the access token at runtime. The
// existing `tests/unit/square/client-import-graph.test.ts` enforces this.

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getSquareClient } from "@/lib/square/client";
import { readDecryptedTokens } from "@/lib/square/oauth";
import { buildIdempotencyKey } from "@/lib/square/terminal";

import { SquareGiftCardLookupFailedError } from "@/app/(studio)/checkout/_errors";

// ---------------------------------------------------------------------
// Discriminated-union result for retrieveGiftCardFromGAN (research R3).
// ---------------------------------------------------------------------

export type LookupResult =
  | {
      kind: "found";
      /** Local DB UUID of the cached `gift_cards` row. */
      giftCardId: string;
      /** Square's `gift_card.id` (e.g. `gftc_0001`). Required by `payments.create.sourceId`. */
      squareGiftCardId: string;
      last4Mask: string;
      balanceCents: number;
      state: "ACTIVE";
    }
  | {
      kind: "zero_balance";
      giftCardId: string;
      squareGiftCardId: string;
      last4Mask: string;
      balanceCents: 0;
      state: "ACTIVE";
    }
  | {
      kind: "not_redeemable";
      giftCardId: string;
      squareGiftCardId: string;
      last4Mask: string;
      state: "PENDING" | "BLOCKED" | "DEACTIVATED";
    }
  | { kind: "not_found" };

/**
 * Derive a 4-digit mask from a GAN. Whitespace stripped first so input
 * shaped like `'6000 1234 5678 0001'` produces `'0001'` reliably.
 */
export function last4MaskFromGAN(gan: string): string {
  return gan.replace(/\s/g, "").slice(-4);
}

// ---------------------------------------------------------------------
// retrieveGiftCardFromGAN — lookup + cached-row UPSERT.
// ---------------------------------------------------------------------

type SquareGiftCardErrorShape = {
  statusCode?: number;
  body?: {
    errors?: Array<{ category?: string; code?: string; detail?: string }>;
  };
};

/**
 * Maps Square's error response to a `not_found` outcome. Returns true
 * when the SDK error is a documented 404 / INVALID_REQUEST_ERROR with
 * NOT_FOUND. All other 4xx/5xx fall through to a thrown
 * `SquareGiftCardLookupFailedError`.
 */
function isSquareGiftCardNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as SquareGiftCardErrorShape;
  if (e.statusCode === 404) return true;
  const errors = e.body?.errors ?? [];
  return errors.some((item) => item.code === "NOT_FOUND");
}

/**
 * Look up a Square gift card by GAN. On any kind except `'not_found'`,
 * UPSERTs into `public.gift_cards` so subsequent lookups (and the
 * audit/lookup path) can join against the cached row.
 *
 * Behaviour per research.md § R3:
 *   - 200 + ACTIVE + balance > 0      → kind: 'found'
 *   - 200 + ACTIVE + balance = 0      → kind: 'zero_balance'
 *   - 200 + PENDING/BLOCKED/DEACTIVATED → kind: 'not_redeemable'
 *   - 404 / NOT_FOUND                 → kind: 'not_found'
 *   - any other 4xx/5xx               → throws SquareGiftCardLookupFailedError
 */
export async function retrieveGiftCardFromGAN(gan: string): Promise<LookupResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("retrieveGiftCardFromGAN: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);
  const last4Mask = last4MaskFromGAN(gan);

  let response: { giftCard?: unknown } | null = null;
  try {
    const raw = await client.giftCards.getFromGan({ gan });
    // The SDK wraps responses in HttpResponsePromise — the resolved value
    // is the typed response body directly.
    response = raw as unknown as { giftCard?: unknown };
  } catch (err) {
    if (isSquareGiftCardNotFound(err)) {
      return { kind: "not_found" };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SquareGiftCardLookupFailedError(
      "could not reach Square to look up the gift card",
      message
    );
  }

  const giftCard = response?.giftCard as
    | {
        id?: string;
        state?: string;
        balanceMoney?: { amount?: number | bigint };
      }
    | undefined;
  if (!giftCard?.id || !giftCard.state) {
    // Empty / malformed response — treat as not_found per the contract's
    // permissive fall-through. Square's documented behaviour is to return
    // 404 for unknown GANs, but defensive handling keeps the UI predictable.
    return { kind: "not_found" };
  }

  const squareGiftCardId = giftCard.id;
  const stateRaw = giftCard.state;
  const balanceRaw = giftCard.balanceMoney?.amount;
  const balanceCents =
    balanceRaw == null
      ? 0
      : typeof balanceRaw === "bigint"
        ? Number(balanceRaw)
        : Number(balanceRaw);

  // UPSERT the cached row. State is constrained to the 4 documented
  // values; anything else is coerced to 'PENDING' so the table's check
  // constraint is honoured (defensive — Square's docs don't list other
  // states).
  const state: "ACTIVE" | "PENDING" | "BLOCKED" | "DEACTIVATED" =
    stateRaw === "ACTIVE" ||
    stateRaw === "PENDING" ||
    stateRaw === "BLOCKED" ||
    stateRaw === "DEACTIVATED"
      ? (stateRaw as "ACTIVE" | "PENDING" | "BLOCKED" | "DEACTIVATED")
      : "PENDING";

  const supabase = createSupabaseServiceRoleClient();
  const { data: upserted, error: upsertErr } = await supabase
    .from("gift_cards")
    .upsert(
      {
        square_gift_card_id: squareGiftCardId,
        last4_mask: last4Mask,
        balance_cents_cached: Math.max(0, balanceCents),
        state,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "square_gift_card_id" }
    )
    .select("id")
    .single();
  if (upsertErr || !upserted) {
    throw new Error(
      `retrieveGiftCardFromGAN: gift_cards upsert failed: ${upsertErr?.message ?? "no row"}`
    );
  }

  const giftCardId = upserted.id;

  if (state === "ACTIVE") {
    if (balanceCents > 0) {
      return {
        kind: "found",
        giftCardId,
        squareGiftCardId,
        last4Mask,
        balanceCents,
        state: "ACTIVE",
      };
    }
    return {
      kind: "zero_balance",
      giftCardId,
      squareGiftCardId,
      last4Mask,
      balanceCents: 0,
      state: "ACTIVE",
    };
  }
  return { kind: "not_redeemable", giftCardId, squareGiftCardId, last4Mask, state };
}

// ---------------------------------------------------------------------
// createGiftCardPayment — push a gift-card charge to Square Payments API.
// ---------------------------------------------------------------------

export type CreateGiftCardPaymentInput = {
  ticketId: string;
  paymentId: string;
  amountCents: number;
  /** The Square gift-card id (`gftc_...`), NOT the local DB UUID. */
  squareGiftCardId: string;
  referenceId: string;
};

export type CreateGiftCardPaymentResult = {
  squareGiftCardPaymentId: string;
  status: "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
};

/**
 * Create a Square Payment with `source_type = GIFT_CARD`. The Square id
 * passed as `sourceId` is the gift card's Square id (NOT the GAN).
 *
 * Idempotency: `idempotencyKey = buildIdempotencyKey(ticketId, paymentId)`
 * per Constitution III. Retried calls with the same (ticketId, paymentId)
 * dedupe at Square; a fresh paymentId yields a brand-new charge.
 *
 * The SDK throws on non-2xx — the caller (the server action) translates
 * to `SquareGiftCardPaymentFailedError`.
 */
export async function createGiftCardPayment(
  input: CreateGiftCardPaymentInput
): Promise<CreateGiftCardPaymentResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("createGiftCardPayment: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);
  const idempotencyKey = buildIdempotencyKey(input.ticketId, input.paymentId);

  const response = (await client.payments.create({
    idempotencyKey,
    sourceId: input.squareGiftCardId,
    amountMoney: {
      amount: BigInt(input.amountCents),
      currency: "USD",
    },
    tipMoney: {
      amount: BigInt(0),
      currency: "USD",
    },
    referenceId: input.referenceId,
  })) as unknown as { payment?: { id?: string; status?: string } };

  const squarePaymentId = response.payment?.id;
  if (!squarePaymentId) {
    throw new Error("createGiftCardPayment: Square response missing payment.id");
  }

  const status = (response.payment?.status ?? "PENDING") as CreateGiftCardPaymentResult["status"];
  return {
    squareGiftCardPaymentId: squarePaymentId,
    status,
  };
}

// ---------------------------------------------------------------------
// getPayment — read a Square Payment by id (polling fallback).
// ---------------------------------------------------------------------

export type GetPaymentResult = {
  squarePaymentId: string;
  status: "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
  sourceType: string | null;
  giftCardId: string | null;
};

/**
 * Read a Square Payment by its Square id. Used by the polling fallback
 * for the gift-card waiting screen when the `payment.updated` webhook is
 * delayed.
 *
 * Implementation note: this thin wrapper exposes only the fields the
 * polling code path consumes — status, source type, and the gift card's
 * Square id when applicable.
 */
export async function getPayment(squarePaymentId: string): Promise<GetPaymentResult> {
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("getPayment: Square not connected");
  }

  const client = getSquareClient(connection.accessToken);
  const response = (await client.payments.get({ paymentId: squarePaymentId })) as unknown as {
    payment?: {
      id?: string;
      status?: string;
      source_type?: string;
      sourceType?: string;
      gift_card_details?: { gift_card_id?: string };
      giftCardDetails?: { giftCardId?: string };
    };
  };

  const p = response.payment ?? {};
  const status = (p.status ?? "PENDING") as GetPaymentResult["status"];
  const sourceType = p.source_type ?? p.sourceType ?? null;
  const giftCardId = p.gift_card_details?.gift_card_id ?? p.giftCardDetails?.giftCardId ?? null;

  return {
    squarePaymentId: p.id ?? squarePaymentId,
    status,
    sourceType,
    giftCardId,
  };
}
