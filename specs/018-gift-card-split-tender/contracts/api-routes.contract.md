# Contract — API Routes

**Feature**: 018-gift-card-split-tender · **Plan**: [../plan.md](../plan.md) · **Webhooks**: [./webhooks.contract.md](./webhooks.contract.md)

---

## 1. `GET /api/square/payment/[paymentId]` (NEW — gift-card polling fallback)

**Purpose**: The polling endpoint the cart hits as a backup if the `payment.updated` Realtime channel misses an event. Mirrors the shape of `/api/square/terminal-checkout/[id]` from feature 015 — returns local DB state only (no live Square call). Used by the gift-card waiting micro-state in the cart island.

**Auth**: Studio session required (`requireStudioSession()`). Anonymous and kiosk requests are rejected with 401.

**Path params**:
- `paymentId` (uuid) — the local `payments.id` of the in-flight gift-card leg.

**Response (200)**:

```ts
type GiftPaymentStateResponse = {
  paymentId: string;
  ticketId: string;
  method: "gift";
  status: "draft" | "pending" | "succeeded" | "failed";
  amountCents: number;
  squareGiftCardPaymentId: string | null;
  giftCardLast4Mask: string | null;             // from joined gift_cards.last4_mask
  failureReason: string | null;                  // populated when status='failed'
  processedAt: string | null;                    // ISO timestamp; populated on succeeded/failed
};
```

**Response (404)**:
- Body: `{ok: false, error: 'payment_not_found'}` — caller should stop polling.

**Response (400)**:
- Body: `{ok: false, error: 'wrong_method'}` — caller passed a non-gift payment id; should switch to the terminal-checkout polling endpoint.

**Polling cadence**: client polls at 5s intervals (matches the existing terminal-checkout polling cadence — sub-second perceived latency is satisfied by the Realtime channel; the poll is the fallback for missed Realtime events). The client stops polling when `status in ('succeeded', 'failed')`.

**Behaviour notes**:
- Unlike the terminal-checkout endpoint, this route does **not** perform any lazy expiration. Gift-card payments settle synchronously at Square; if a `'pending'` row sits longer than expected, it indicates a genuine webhook delivery problem (not an abandoned customer interaction) — the operator's recourse is to remove the leg via `removeDraftLeg` (no — that won't work on a pending row; the operator's recourse is to wait for the webhook or the operator removes the leg via a future "force-fail" path). For v1, a stuck pending gift-card leg requires operator escalation. Document this in the operator runbook.

---

## 2. `POST /api/webhooks/square` (MODIFY)

**Purpose**: The shared webhook landing pad for all Square events. This route already exists from feature 015 handling `terminal.checkout.updated`. This feature extends the event-dispatch switch to also route `payment.updated`.

**Auth**: Square HMAC SHA-256 signature header `x-square-hmacsha256-signature`, verified against `SQUARE_WEBHOOK_SIGNATURE_KEY` (same as feature 015).

**Body**: Raw Square webhook envelope (JSON). Parsed via `parseEvent(rawBody)` from `lib/square/webhooks.ts`.

**Dispatcher** (the only change to this route):

```ts
switch (event.type) {
  case "terminal.checkout.updated":
    return handleTerminalCheckoutUpdated(event);
  case "payment.updated":
    return handlePaymentUpdated(event);            // NEW
  default:
    return { ok: true, ignored: true, reason: `unsupported_event_type_${event.type}` };
}
```

See [webhooks.contract.md](./webhooks.contract.md) for the `handlePaymentUpdated` handler contract.

**Response codes**: unchanged from feature 015.

---

## 3. Unchanged routes (referenced for context)

- `GET /api/square/terminal-checkout/[id]` — terminal polling endpoint from feature 015. Used by card legs in this feature too; unchanged.
- `GET /api/square/refresh-token` — daily Vercel Cron from feature 015. Unchanged.
- `GET /api/(studio)/settings/square/callback` — OAuth callback from feature 015. Unchanged.

---

## 4. No new cron entries

This feature adds zero new cron entries. The only existing cron (`/api/square/refresh-token`, daily) is unchanged. Gift-card settlements are event-driven (webhook + polling fallback) — there is nothing to sweep.
