# Contract — Webhooks

**Feature**: 018-gift-card-split-tender · **Plan**: [../plan.md](../plan.md) · **Data model**: [../data-model.md](../data-model.md) · **Research**: [../research.md](../research.md)

This document is the contract for the extension to `lib/square/webhooks.ts` and the route handler at `app/api/webhooks/square/route.ts`. The terminal-checkout handler from feature 015 is unchanged.

---

## 1. Event-type dispatch

The route handler dispatches by Square's `event.type` field after signature verification + parsing succeed:

```ts
switch (event.type) {
  case "terminal.checkout.updated":
    return handleTerminalCheckoutUpdated(event);   // feature 015 — unchanged
  case "payment.updated":
    return handlePaymentUpdated(event);            // NEW (this feature)
  default:
    return { ok: true, ignored: true, reason: `unsupported_event_type_${event.type}` };
}
```

Signature verification, raw-body normalization, and the 401 response on signature failure are unchanged from feature 015.

---

## 2. `payment.updated` event shape

```ts
type SquarePaymentUpdatedEvent = {
  type: "payment.updated";
  merchant_id: string;
  data: {
    type: "payment";
    id: string;
    object: {
      payment: {
        id: string;                                  // Square Payment id
        status: "APPROVED" | "COMPLETED" | "CANCELED" | "FAILED";
        source_type: "CARD" | "GIFT_CARD" | "WALLET" | ...;
        amount_money?:   { amount: number | bigint; currency: string };
        tip_money?:      { amount: number | bigint; currency: string };
        reference_id?:   string;                     // we set this to ticket_id
        // Gift-card-specific:
        gift_card_details?: {
          gan_source?:   string;
          state?:        "ACTIVE" | "PENDING" | "BLOCKED" | "DEACTIVATED";
          balance_money?: { amount: number | bigint };
        };
        source_id?:      string;                     // gift_card_id for gift payments
      };
    };
  };
};
```

---

## 3. `handlePaymentUpdated` handler

```ts
export async function handlePaymentUpdated(
  event: SquareWebhookEvent
): Promise<HandlerResult>;
```

**Steps**:

1. Narrow `event.type === "payment.updated"`; else return `{ok: true, ignored: true, reason: 'unsupported_event_type'}`.
2. **Merchant-id check** — defense-in-depth, same shape as the terminal handler. Throw `MerchantMismatchError` on mismatch → caller returns 401.
3. Extract `payment = event.data.object.payment`. If absent, return `{ok: true, ignored: true, reason: 'malformed_payment'}`.
4. **Source-type guard**: if `payment.source_type !== 'GIFT_CARD'`, return `{ok: true, ignored: true, reason: 'non_gift_card_payment'}`. (Card-on-terminal payments flow through `terminal.checkout.updated`; we don't double-process them here.)
5. **Status routing** — map Square's payment status to a domain transition:

   | Square `status` | Action |
   |-----------------|--------|
   | `APPROVED`, `PENDING` | noop, return `{ok: true, ignored: true, reason: 'noop_status_<status>'}` |
   | `COMPLETED` | RPC: `pos_record_gift_payment(payment_id, 'succeeded', ...)` |
   | `CANCELED`, `FAILED` | RPC: `pos_record_gift_payment(payment_id, 'failed', ...)` with `failure_reason` |
   | other | `{ok: true, ignored: true, reason: 'unknown_status_<status>'}` |

6. **Lookup the local payment row** by `square_gift_card_payment_id = payment.id`. If not found, return `{ok: true, ignored: true, reason: 'unknown_gift_card_payment'}` and log a warn (helps diagnose stray events).
7. **Call the RPC** with the resolved domain status, the source gift_card_id, the raw payload (persisted to `payments.raw`), and the `failure_reason` (mapped from Square's error codes when status is `CANCELED` or `FAILED`).
8. Return `{ok: true}` on success.

---

## 4. Idempotency invariants

Three layers, in order of activation:

1. **Application-level**: the RPC's `status='pending'` predicate (in `pos_record_gift_payment` per [data-model § 6.d](../data-model.md#6d-pos_record_gift_payment)) makes a replayed `COMPLETED` event find a non-`'pending'` row and return `(ticket_id, false)` with no further writes.
2. **Database-level**: the unique partial index `payments_unique_succeeded_gift_card_payment_idx` ([data-model § 5.b](../data-model.md#5b-gift-card-webhook-idempotency-backstop)) makes any application bug that bypasses (1) fail with `23505` instead of creating a duplicate succeeded row.
3. **Audit-level**: every RPC invocation that does write also inserts an audit row, so a replay that does noop also writes no audit row — the audit history mirrors the actual state transitions, not the webhook arrivals.

---

## 5. Response codes

| Outcome | HTTP status | Body |
|---------|-------------|------|
| Signature missing/invalid | 401 | `{ok: false, error: 'invalid_signature'}` |
| Merchant mismatch | 401 | `{ok: false, error: 'merchant_mismatch'}` |
| Successfully processed (or successfully noop / ignored) | 200 | `{ok: true}` or `{ok: true, ignored: true, reason: ...}` |
| Unhandled internal error during RPC dispatch | 500 | `{ok: false, error: <message>}` — triggers Square's retry mechanism |

The "Square's retry on 5xx" behaviour is what makes the temporary database unavailability case eventually consistent. Our application is idempotent under retry per § 4 above.

---

## 6. Compatibility with the existing terminal handler

The existing `handleTerminalCheckoutUpdated` handler from feature 015 is untouched. The new dispatcher in the route handler is the only edit to `route.ts`. The two handlers share no state — they each take a typed event and a service-role client. Tests for the terminal handler from feature 015 remain valid; new tests in `tests/unit/square/webhook-payment-updated.test.ts` cover the new handler in isolation.
