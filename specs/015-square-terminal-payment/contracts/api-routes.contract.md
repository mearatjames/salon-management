# Phase 1 — Contract: API Routes

Two new API routes in addition to the webhook handler (`/api/webhooks/square` — see [webhooks.contract.md](./webhooks.contract.md)):

1. `GET /api/square/terminal-checkout/[paymentId]` — polling fallback for the waiting screen.
2. `GET /api/square/refresh-token` — Vercel Cron daily token refresh.

---

## 1. `GET /api/square/terminal-checkout/[paymentId]`

File: `app/api/square/terminal-checkout/[id]/route.ts`

**Purpose**: When the Supabase Realtime channel is delayed or dropped, the waiting screen polls this endpoint every 5 seconds to learn the payment's current status. Returns local DB state (never a fresh Square API call — see research R5).

### Auth

Gated by `requireStudioSession()`. Returns 401 with no body if no studio session. (The waiting screen is itself behind the studio shell, so this is defense-in-depth — a logged-out tab cannot poll for payment state.)

### Path parameter

- `[id]` is the **payment row UUID** (`payments.id`), not the Square terminal checkout id. This keeps the URL stable across our own retries even if Square assigns a new checkout id per attempt.

### Response shape

```ts
type PollResponse =
  | { status: "pending";   pollAgainAfterMs: 5000 }
  | { status: "succeeded"; tipCents: number }
  | { status: "failed";    reason: "declined" | "device_offline" | "cancelled_by_operator" | "expired" | "unknown" };
```

- `pollAgainAfterMs: 5000` — the client honors this as a hint; future versions could vary it (e.g., back off after N polls).
- `tipCents` is the captured tip from `payments.tip_cents`.
- `reason` mirrors `payments.failure_reason`; the union is the documented vocabulary.

### Behavior

1. `requireStudioSession()`.
2. Load `payments` row by id. If not found → 404 `{ "error": "payment_not_found" }`.
3. If `payments.method != 'card'` → 400 `{ "error": "not_a_card_payment" }` (defensive; the waiting screen should not poll for non-card rows).
4. If `payments.status = 'pending'` AND `created_at < now() - interval '5 minutes'`:
   - In one transaction, call `pos_record_card_payment(payment_id, 'failed', 0, null, '{"kind":"polling_expired"}'::jsonb, 'expired')`.
   - This emits a `payment.failed` audit row.
   - Re-read the row.
5. Map the (possibly updated) row to the `PollResponse` shape and return as JSON with `Cache-Control: no-store`.

### Concurrency

Two simultaneous polls hitting the 5-minute boundary at the same moment is safe: the RPC's idempotency check (status != 'pending' is a no-op) means only the first poll's UPDATE persists; the second poll observes `failed` and returns the failed response. No double-write.

### Cost & rate

The endpoint is cheap (one indexed SELECT + at most one UPDATE on expiration). At 5-second poll cadence with at most one waiting screen open at a time, expected load is < 0.2 req/s. No rate limiting needed.

---

## 2. `GET /api/square/refresh-token`

File: `app/api/square/refresh-token/route.ts`

**Purpose**: Daily Vercel Cron entry that refreshes the Square access token before expiry. See research R7.

### Auth

Vercel Cron convention: the request includes `Authorization: Bearer ${CRON_SECRET}`. The handler returns 401 if missing or wrong. `CRON_SECRET` is added to `.env.example`; production sets it via `vercel env add CRON_SECRET production`.

```ts
function isAuthorizedCron(request: NextRequest): boolean {
  const header = request.headers.get('authorization');
  return header === `Bearer ${process.env.CRON_SECRET}`;
}
```

### Vercel cron entry (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/square/refresh-token", "schedule": "0 4 * * *" }
  ]
}
```

`0 4 * * *` — daily at 04:00 UTC (low-traffic window for a US-pacific salon).

### Behavior

1. Verify cron auth. If not authorized → 401, no body.
2. Read `square_oauth` row. If absent → 200 `{ "ok": true, "skipped": "not_connected" }` (the salon hasn't connected Square yet; nothing to refresh).
3. If `access_token_expires_at >= now() + interval '7 days'` → 200 `{ "ok": true, "skipped": "not_due" }` (the token is still good).
4. Otherwise, attempt refresh:
   - Decrypt the refresh token via the GUC.
   - POST to Square's `/oauth2/token` with `grant_type=refresh_token`.
   - On success: encrypt the new access + refresh tokens, UPDATE `square_oauth` (new tokens + new `access_token_expires_at` + `last_refreshed_at = now()` + `refresh_failed_at = null`). Audit verb: `integration.square_token_refreshed` with payload `{ "ok": true }`. Return 200 `{ "ok": true, "refreshed": true }`.
   - On failure: retry with exponential backoff (3 attempts, 1s/2s/4s). If all fail: UPDATE `square_oauth SET refresh_failed_at = now()`. Audit verb: `integration.square_token_refreshed` with payload `{ "ok": false, "error": "<square error code>" }`. Return 200 `{ "ok": false, "error": "<code>" }` (we return 200 so Vercel's cron does not retry — we've already retried internally; the next day's cron will try again).

### Why 200 even on failure

Vercel Cron treats non-2xx responses as failures and may alert. Since we already retried internally and persisted the failure state for the UI, the cron run itself "completed successfully" — the failure is a data state, not an infrastructure state.

### Server-side logging

- `info` on each invocation with the chosen branch (`not_connected` / `not_due` / `refreshed` / `failed`).
- `error` on each individual retry failure (with the Square error response attached).

### Tests

- Vitest unit on the auth check (wrong header, missing header, right header).
- Vitest unit on the "not due" branch (mocked `square_oauth` row with `expires_at = now() + 30d`).
- Vitest unit on the "refresh succeeded" branch (mocked Square HTTP response).
- Vitest unit on the "refresh failed 3x" branch (assertion: `refresh_failed_at` is set; audit row written with `ok: false`).
- No e2e for this route (cron-only).
