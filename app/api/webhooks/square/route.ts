// app/api/webhooks/square/route.ts
//
// POST /api/webhooks/square — Square's `terminal.checkout.updated` events.
//
// Order of operations (contracts/webhooks.contract.md §§ 2, 3, 5):
//   1. Read raw body.
//   2. Verify HMAC-SHA256 signature against
//      `process.env.SQUARE_WEBHOOK_SIGNATURE_KEY`. 401 on miss/mismatch.
//   3. Parse JSON. 400 on parse failure.
//   4. Route via `handleTerminalCheckoutUpdated`.
//   5. Return 200 / 401 / 500 per the contract.
//
// Runtime: Node (Vercel default). The handler is sync-ish — webhook
// retries are Square's responsibility; we do not retry on our own.

import { NextResponse } from "next/server";

import {
  handlePaymentUpdated,
  handleTerminalCheckoutUpdated,
  MerchantMismatchError,
  parseEvent,
  verifySignature,
} from "@/lib/square/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    console.error("square.webhook: SQUARE_WEBHOOK_SIGNATURE_KEY not set");
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");

  if (signatureHeader === null) {
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  const notificationUrl = request.url;
  if (!verifySignature(rawBody, signatureHeader, signatureKey, notificationUrl)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  console.info("square.webhook: signature ok", {
    type: event.type,
    event_id: (event as { event_id?: string }).event_id,
    merchant_id: (event as { merchant_id?: string }).merchant_id,
  });

  try {
    // Event-type dispatch — feature 015 ships terminal.checkout.updated;
    // feature 018 adds payment.updated for gift-card legs. Any other
    // event type returns a 200 with an ignored flag so Square stops
    // retrying.
    let result;
    if (event.type === "terminal.checkout.updated") {
      result = await handleTerminalCheckoutUpdated(event);
    } else if (event.type === "payment.updated") {
      result = await handlePaymentUpdated(event);
    } else {
      return NextResponse.json(
        { ok: true, ignored: true, reason: `unsupported_event_type_${event.type}` },
        { status: 200 }
      );
    }

    if ("ignored" in result && result.ignored) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if (err instanceof MerchantMismatchError) {
      return NextResponse.json({ error: "merchant_mismatch" }, { status: 401 });
    }
    console.error("square.webhook: handler raised", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
