# Phase 1 — Contract: Square Webhooks

Endpoint: `POST /api/webhooks/square`
File: `app/api/webhooks/square/route.ts`
Runtime: Node.js (default Vercel Functions; default 300s timeout, ample headroom).

This contract specifies the handler's signature-verification rules, the event matrix it routes, the response codes it returns, and the idempotency invariants it MUST satisfy.

---

## 1. Request shape

Square sends JSON POSTs that look like:

```json
{
  "merchant_id": "MERCHANT123",
  "type": "terminal.checkout.updated",
  "event_id": "f3e7...uuid",
  "created_at": "2026-05-16T10:30:00Z",
  "data": {
    "type": "checkout",
    "id": "CHECKOUT_ID",
    "object": {
      "checkout": {
        "id": "CHECKOUT_ID",
        "status": "COMPLETED",
        "reference_id": "<our ticket_id>",
        "payment_ids": ["SQUARE_PAYMENT_ID"],
        "amount_money": { "amount": 4500, "currency": "USD" },
        "tip_money":    { "amount": 800,  "currency": "USD" },
        "device_options": { "device_id": "device:XXXX" },
        "created_at": "...",
        "updated_at": "..."
      }
    }
  }
}
```

Headers we care about:
- `x-square-hmacsha256-signature` — the HMAC-SHA256 of `notification_url + raw_body`, base64-encoded, using `SQUARE_WEBHOOK_SIGNATURE_KEY`.

---

## 2. Signature verification (MANDATORY)

The handler MUST verify the signature BEFORE parsing or branching on the body.

**Algorithm** (implemented in `lib/square/webhooks.ts:verifySignature`):

```text
input:  raw_body (string), signature_header (string), signature_key (string), notification_url (string)
compute: expected = base64( HMAC_SHA256( signature_key, notification_url + raw_body ) )
return:  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature_header))
```

**Required failure modes** (handler returns the listed status, never invokes any DB write):
- Missing `x-square-hmacsha256-signature` header → **401 Unauthorized**, body `{ "error": "missing_signature" }`.
- Header present but does not verify → **401 Unauthorized**, body `{ "error": "invalid_signature" }`.
- Body could not be read (rare; client disconnected mid-stream) → **400 Bad Request**.

**Invariants enforced by Vitest** (`tests/unit/square/webhook-signature.test.ts`):
- Valid signature → returns `true`.
- One-byte-changed body → returns `false`.
- Missing header → returns `false`.
- Wrong algorithm (e.g., `sha1`) → returns `false`.
- Constant-time compare exercised by inspection (we use `crypto.timingSafeEqual`).

**Notification URL caveat**: in local dev the `notification_url` is the cloudflared tunnel URL. The handler reads it from `request.url` (which Next.js populates with the public URL when proxied). For production this is the canonical `https://app.tangnails.com/api/webhooks/square`. For tests, the e2e Square stub signs with the test webhook URL.

---

## 3. Event matrix

We subscribe to **exactly one** webhook event in this phase: `terminal.checkout.updated`. All other event types received are acknowledged (200 OK) and ignored.

| Square `checkout.status` | Our action |
|---|---|
| `PENDING` | Acknowledge; no DB write (we already inserted the `pending` row when we created the checkout). Return 200. |
| `IN_PROGRESS` | Acknowledge; no DB write. Return 200. |
| `COMPLETED` | Look up payment by `square_terminal_checkout_id`; if found, call `pos_record_card_payment(payment_id, 'succeeded', tip_money.amount, payment_ids[0], raw, null)`. If not found (unknown checkout — see §5), log and return 200. |
| `CANCELED` (by the device or by our `cancelCheckout`) | Look up payment; call `pos_record_card_payment(payment_id, 'failed', 0, null, raw, 'cancelled_by_operator')`. Return 200. |
| `CANCEL_REQUESTED` | Acknowledge; no DB write (Square will follow with a terminal `CANCELED` or `COMPLETED`). Return 200. |

**Note on `cancelled_by_operator` vs other failure reasons**: at the webhook layer we cannot distinguish "the operator cancelled" from "the customer hit Cancel on the terminal" — both produce `CANCELED`. The application-level `cancelTerminalPayment` action overrides the failure_reason to `cancelled_by_operator` when it directly observes a `CANCELED` response; the webhook layer is the catch-all and uses the same reason. The audit log distinguishes intent: `payment.cancelled` from the action means "operator intended cancel"; absence of that verb plus a `payment.failed` with reason `cancelled_by_operator` means "customer or device cancelled."

---

## 4. Idempotency invariants (MUST satisfy)

1. **Replay safety**: Receiving the same `event_id` twice produces exactly one set of DB mutations. The `pos_record_card_payment` RPC short-circuits when the payment row's `status` is already `succeeded` or `failed` (with the documented `expired → succeeded` exception). The unique partial index `payments_unique_succeeded_terminal_checkout_idx` is the database-level backstop.
2. **Out-of-order delivery**: A `COMPLETED` followed by a stale `PENDING` does not revert the payment. Same `status='pending'` predicate enforces this — the `pending` event finds the row in `succeeded` and is a no-op.
3. **Square-wins**: A `COMPLETED` for a row previously expired by the polling endpoint (reason `expired`) settles the row to `succeeded` (the RPC's escape hatch — see data-model §4).
4. **Unknown checkout**: A webhook whose `square_terminal_checkout_id` does not match any local payment row is acknowledged (200) and logged at `info` level. This covers the case where Square retries a webhook after we've already disconnected, or for a checkout we never persisted (e.g., the action transaction rolled back after the Square call but before our INSERT — which our action does not do, but we are defensive).
5. **Cross-merchant**: We reject (return 401) any webhook whose `merchant_id` does not match our stored `square_oauth.merchant_id`. This is a defense-in-depth check against a misconfigured Square dashboard pointing at our endpoint.

---

## 5. Response codes summary

| Condition | Status | Body |
|---|---|---|
| Signature valid + event handled successfully | 200 | `{ "ok": true }` |
| Signature valid + event ignored (unsupported type, unknown checkout, stale status) | 200 | `{ "ok": true, "ignored": true }` |
| Signature missing | 401 | `{ "error": "missing_signature" }` |
| Signature invalid | 401 | `{ "error": "invalid_signature" }` |
| Merchant id mismatch | 401 | `{ "error": "merchant_mismatch" }` |
| Body parse failed (not JSON) | 400 | `{ "error": "invalid_body" }` |
| RPC raises unexpected error | 500 | `{ "error": "internal" }` — Square will retry, and the retry will be idempotent. |

We use 401 (not 403) for signature failures to match Square's documented expected behavior — Square interprets 401 as "we should not retry without operator action" while 5xx triggers automatic retries.

---

## 6. Server-side logging

- `info` on every signature-verified event arrival with: `{ event_id, type, merchant_id, checkout_id, status }`.
- `warn` on unknown-checkout webhooks (helps diagnose future "where did this come from" mysteries).
- `error` on RPC failures (with the full payload attached).

Logging is via `console.log/warn/error` (Vercel captures these). No PII is logged — only Square IDs and our internal IDs.

---

## 7. What this contract does NOT cover

- `payment.created` / `payment.updated` events (refunds, disputes) — phase 8.
- `terminal.refund.updated` — phase 8.
- `gift_card.*` events — out of scope; we redeem gift cards in phase 6 without subscribing to their webhooks.
- `oauth.authorization.revoked` — Square fires this if the merchant revokes our access from their Square dashboard. Out of scope for this phase; the daily token-refresh will fail and the reconnect banner will surface within 24h. (A future polish task could subscribe to this event and surface the banner immediately.)
