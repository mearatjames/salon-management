# Phase 0 — Research: Square Terminal Card Payment

This document records the decisions that pin down "how" before any code is written. Each entry follows the **Decision / Rationale / Alternatives** format from the plan template.

---

## R1 — Idempotency key for `terminals.createCheckout` and the consequence for retry semantics

**Decision**: Every call to `terminals.createCheckout` passes `idempotency_key = "${ticket_id}:${payment_id}"`, where `payment_id` is the UUID of the just-inserted `payments` row for that attempt. A retry after a `failed` Payment row INSERTs a new `payments` row, so the next call's `payment_id` is different and Square treats it as a brand-new checkout.

**Rationale**: This formula is named verbatim in `docs/system-design.md` § Square integration details ("Terminal checkouts: `${ticket_id}:${payment_id}` (one per `payments` row)") and Constitution Principle III. With per-attempt rows (spec FR-015 clarification), the key is naturally unique per attempt without an explicit attempt counter, so:
- Replaying our own `createCheckout` call (e.g., network blip between us and Square mid-request) returns Square's prior response for that exact attempt, not a duplicate checkout.
- Retrying after a failure (Q1 in clarifications: "one row per attempt") produces a different `payment_id` and therefore a different idempotency key, which Square correctly treats as a new checkout.

**Alternatives considered**:
- `${ticket_id}` alone: rejected — couples the key to the ticket, so a retry would be deduped by Square as the prior failed attempt, and we would never get a second chance to charge.
- `${payment_id}` alone (no ticket prefix): rejected — fine technically, but the ticket prefix is more useful in Square's dashboard for human reconciliation of "this checkout belongs to ticket X."
- An explicit `${ticket_id}:${payment_id}:${attempt_count}` suffix: rejected — adds state that the per-attempt-row design already encodes; YAGNI.

---

## R2 — Cancel-vs-success race resolution (FR-016a)

**Decision**: The Payment row's `status` column is the source of truth, and the "Square wins" rule (spec clarification Q2) is enforced in SQL with a permissive update predicate:

```sql
UPDATE payments
   SET status = 'succeeded',
       tip_cents = $new_tip,
       raw = $raw_payload,
       processed_at = now()
 WHERE square_terminal_checkout_id = $checkout_id
   AND status IN ('pending')
RETURNING id, ticket_id;
```

When front desk taps **Cancel and pick a different method**, we call `terminals.cancelCheckout` on Square but **do not** locally mark the row anything other than `pending` until Square confirms. If Square's response (or webhook) says the cancel succeeded → we transition the row to `failed` (`failure_reason = 'cancelled_by_operator'`). If Square's response (or webhook) says the customer paid first → we transition the row to `succeeded` per the predicate above. Either way, the row only leaves `pending` on Square's confirmation, so the predicate naturally lets the succeeded-after-cancel race resolve to `succeeded`.

**Rationale**: spec FR-016a names Square as authoritative; the simplest possible enforcement is to never short-circuit the local row out of `pending` before Square confirms. This avoids a state-machine library and keeps the rule reviewable in one SQL statement.

**Alternatives considered**:
- A `cancel_requested_at timestamptz` column with a status-machine layer that resolves `cancel_requested + succeeded → succeeded` and `cancel_requested + failed_cancellation → failed`: rejected — adds a column and logic that the predicate-based approach captures implicitly. The column would be invisible to the UI (front desk sees the row stay "Waiting" until Square confirms either way, which is the correct UX anyway).
- Optimistic local cancel (`status = 'failed'` immediately on cancel tap, before Square confirms): rejected — breaks Square-wins because a late `SUCCEEDED` webhook would then have to revert `failed → succeeded`, contradicting the "failed rows are never mutated back" rule from clarification Q1.

---

## R3 — Pgcrypto encryption-at-rest plumbing for OAuth tokens

**Decision**: Encrypt `square_oauth.access_token_encrypted` and `square_oauth.refresh_token_encrypted` as `bytea` via `pgp_sym_encrypt(plaintext, current_setting('app.square_oauth_key'))`. The plaintext key lives in Supabase Vault (a project-level encrypted secret store). At the start of every Server Action that needs to read or write Square tokens, `lib/square/oauth.ts` issues:

```sql
SELECT set_config('app.square_oauth_key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1), true);
```

`set_config(..., true)` makes the GUC **local to the transaction**, so the key is never persisted in a session-wide setting and never leaks across requests. Decryption SQL (also in the migration) is a thin wrapper that reads the GUC:

```sql
CREATE OR REPLACE FUNCTION public.decrypt_square_token(ciphertext bytea)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT pgp_sym_decrypt(ciphertext, current_setting('app.square_oauth_key'))::text;
$$;
```

If the GUC is not set, the function raises (constant: `42704 undefined_object` from `current_setting`) — verified by a unit test.

**Rationale**: Constitution § Secrets at Rest explicitly names this exact plumbing (`pgcrypto`, Supabase Vault, GUC `app.square_oauth_key`, exposed only to `lib/square/oauth.ts`). The transaction-scoped GUC matches Supabase's own pattern for tenant-isolated secret access and the system-design's intent.

**Alternatives considered**:
- Store tokens in plain text and rely on `bytea` + RLS: rejected — fails the "database dump alone does not expose them" requirement in spec FR-002 and the explicit Constitution rule.
- Use Vercel KV / external KMS: rejected — system-design explicitly chose Supabase Vault + pgcrypto to stay on the free tier (Constitution Principle V).
- Use a session-wide `SET app.square_oauth_key = ...` (not `set_config(..., true)`): rejected — `true` for `is_local` is mandatory; otherwise the key persists across queries on the same pooled connection and would be readable by any subsequent query.

---

## R4 — Webhook signature verification

**Decision**: `lib/square/webhooks.ts:verifySignature(rawBody, signatureHeader, signatureKey)`:

1. Read the raw request body (a `Buffer` / `Uint8Array`) — NOT a `JSON.parse(...)` + `JSON.stringify(...)` round-trip, because re-serialization can reorder keys or whitespace and break the HMAC.
2. Compute `HMAC_SHA256(signatureKey, notification_url + raw_body_bytes)`, where `notification_url` is the full HTTPS URL the webhook was POSTed to (e.g., `https://app.tangnails.com/api/webhooks/square` in prod, the cloudflared tunnel URL in dev).
3. Base64-encode the resulting digest.
4. Compare against `request.headers.get('x-square-hmacsha256-signature')` using a **constant-time** comparison (`crypto.timingSafeEqual` from Node's `crypto`).
5. Return `true` on match, `false` otherwise. The route handler returns HTTP 401 on `false` and never invokes any DB write.

Next.js App Router route handlers expose the raw body via `await request.text()` (or `request.arrayBuffer()`); we use `request.text()` to keep a `string` for both the HMAC input and the subsequent `JSON.parse`. The raw text is what HMACs against; the parsed object is what feeds the event router.

**Rationale**: Matches Square's documented webhook signature algorithm (Square v2 API). Constant-time comparison prevents the classic timing-attack class on HMAC verification.

**Alternatives considered**:
- Using `request.json()` and re-serializing: rejected — any whitespace/key-ordering difference between Square's serialization and Node's would cause every signature to fail.
- Using `crypto.createHmac(...).update(rawBody).digest('hex')` and a plain `===` compare: rejected — the `===` is timing-variable; constant-time is the standard for any HMAC compare on a public endpoint.
- Skipping the URL prefix: rejected — Square's algorithm requires `notification_url + body`. Omitting the URL would silently fail signature verification against legitimate webhooks.

---

## R5 — Polling endpoint shape and lazy 5-minute expiration

**Decision**: `GET /api/square/terminal-checkout/[paymentId]` returns the **local** `payments` row's current status, never a fresh Square API call. Shape:

```ts
type PollResponse =
  | { status: "pending"; pollAgainAfterMs: 5000 }
  | { status: "succeeded"; tipCents: number }
  | { status: "failed"; reason: "declined" | "device_offline" | "cancelled_by_operator" | "expired" | "unknown" };
```

If the row is `pending` AND `created_at < now() - interval '5 minutes'`, the handler first runs an UPDATE inside a single transaction to flip the row to `failed` with `failure_reason = 'expired'`, then returns the `failed` response. This is the "lazy expiration" referenced in spec FR-021a and Constitution § Scope Discipline (no background cron added).

If the row is `pending` AND not yet expired, the handler returns the `pending` response. The waiting screen on the client uses this as its 5-second poll fallback to the Realtime channel.

**Rationale**: The polling endpoint exists to back the Realtime channel for the rare case where the webhook is dropped or delayed. Returning local DB state (driven by the webhook handler) means the polling endpoint is consistent with the realtime channel — both see the same source of truth. Adding the expiration check here means it runs at most once per row (the next poll observes `failed` and doesn't re-update), keeps the work near the only user who cares (the front-desk staring at the waiting screen), and matches `docs/system-design.md` § Square integration details ("no server-side cron sweep in v1").

A late `SUCCEEDED` webhook for a row that the polling endpoint has already expired still wins per R2's predicate (the predicate is `status IN ('pending')`, but the webhook handler additionally checks for `status = 'failed' AND failure_reason = 'expired'` as a Square-wins escape hatch and forces the row to `succeeded` if so — see contracts/webhooks.contract.md).

**Alternatives considered**:
- Server-side cron sweep (every 1 minute): rejected — explicitly forbidden by system-design § Square integration details and by Constitution Principle V. Adds infrastructure for a problem that only matters while a user is watching.
- Polling endpoint makes a fresh Square `getCheckout` call: rejected — adds Square API load, race against the webhook handler, and changes the polling endpoint's purpose from "what does the local DB say" to "what does Square say," which is the wrong abstraction for the fallback role.
- Auto-expiration at a longer window (15 min, 30 min): rejected — the spec clarification chose 5 min specifically because it matches Square's own terminal checkout default timeout.

---

## R6 — Realtime channel scope

**Decision**: `lib/realtime/payments.ts` exposes `subscribe(ticketId, callback)` that opens a Supabase Realtime channel filtered to `payments.ticket_id = $ticketId` and `UPDATE` events only. The waiting screen subscribes on mount and unsubscribes on unmount, on cancel, and on advance to the Done screen (the unmount handler covers all three because the waiting screen is itself unmounted in each case). The callback receives the new row and merges its status into the local state; the React tree advances accordingly.

The subscription is scoped to:
- `event: 'UPDATE'` only (we never need to react to INSERTs in this phase — the insert that creates the `pending` row is already known by the action that returned to the client)
- `schema: 'public'`, `table: 'payments'`
- `filter: 'ticket_id=eq.${ticketId}'`

**Rationale**: This is the only Realtime channel in v1 by design (system-design § Files to create: Realtime is introduced for the cart/checkout phase, not earlier). Scoping by `ticket_id` plus `UPDATE` keeps the broadcast volume to a handful of events per ticket and avoids cross-tenant leakage concerns (there is only one tenant — the salon — but the principle still applies).

**Alternatives considered**:
- Broadcast on the whole `payments` table: rejected — every payment update would wake every client; phase 9 is the right time to widen scope.
- A custom postgres `LISTEN/NOTIFY` channel: rejected — Supabase Realtime is the convention; rolling our own would duplicate plumbing.
- Polling-only: rejected — see R5; polling is the fallback, not the primary path.

---

## R7 — Daily token-refresh cron

**Decision**: `GET /api/square/refresh-token` is a Vercel Cron route (entry in `vercel.json` with `"schedule": "0 4 * * *"` — daily at 4:00 AM in Vercel's UTC). It is protected by the standard Vercel Cron convention: the request includes `Authorization: Bearer ${CRON_SECRET}` and the handler returns 401 if the header is missing or wrong. The handler:

1. Reads the `square_oauth` row (decrypts via the GUC plumbing in R3).
2. If `access_token_expires_at < now() + interval '7 days'`, calls Square's OAuth `/oauth2/token` endpoint with `grant_type=refresh_token` and the decrypted refresh token.
3. On success: re-encrypts and persists the new access + refresh tokens, updates `access_token_expires_at`, writes `integration.square_token_refreshed` to audit_log.
4. On failure (network, revoked authorization): retries with exponential backoff (3 attempts, 1s/2s/4s). If all retries fail, writes `integration.square_token_refreshed` to audit_log with payload `{ "ok": false, "error": "..." }` AND sets `square_oauth.refresh_failed_at = now()`. The UI's reconnect banner reads `refresh_failed_at` to decide whether to show.

Square OAuth tokens have a 30-day access-token lifetime; a daily refresh with a 7-day buffer means the refresh succeeds well before expiry every day; if every refresh failed for a full week, the owner would see the reconnect banner and re-authorize.

**Rationale**: Matches the user's prompt ("Daily Vercel Cron refreshes the access token before expiry") and the system-design's documented setup. The 7-day buffer is the standard headroom for "if today's refresh fails and tomorrow's fails and the day after's fails, we still have a week to notice."

**Alternatives considered**:
- Refresh on-demand inside `lib/square/client.ts` (no cron): rejected — couples auth to every Square call, adds latency, and means the very first card payment of the day pays the refresh round-trip cost (~500ms).
- Hourly refresh: rejected — token-refresh has Square API rate limits; daily is well within them and matches the system-design.

---

## R8 — Square Sandbox developer setup

**Decision**: Quickstart documents the exact steps:

```bash
# 1. Run a cloudflared tunnel to expose localhost to Square
brew install cloudflared
cloudflared tunnel --url http://localhost:3000

# 2. Note the assigned https://xxx.trycloudflare.com URL — use it as the
#    Square Sandbox webhook target AND as the OAuth redirect URI.

# 3. In Square Developer Dashboard (sandbox):
#    - Set OAuth redirect URI to https://xxx.trycloudflare.com/settings/square/callback
#    - Subscribe to webhook event "terminal.checkout.updated"
#    - Set webhook notification URL to https://xxx.trycloudflare.com/api/webhooks/square
#    - Copy the webhook signature key into SQUARE_WEBHOOK_SIGNATURE_KEY in .env.local
#    - Copy the application id + secret into SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET
#    - Set SQUARE_ENVIRONMENT=sandbox
```

The cloudflared URL changes every restart of the tunnel; the quickstart documents that the developer must update Square's dashboard with the new URL on each tunnel restart. (Long-term, a per-developer named tunnel — `cloudflared tunnel route dns ...` — would stabilize the URL; out of scope for this phase.)

**Rationale**: Matches system-design § Square integration details ("Sandbox in dev: every developer uses Square Sandbox; webhooks tunneled with `cloudflared tunnel` (free) to `localhost:3000/api/webhooks/square`"). Cloudflared is free and works on macOS/Linux/Windows.

**Alternatives considered**:
- `ngrok` (paid for stable URLs): rejected — system-design chose cloudflared specifically for cost (Constitution Principle V).
- Local-only testing (no live Square calls): rejected — the e2e Square stub (R9) covers CI, but at least one developer's-machine end-to-end test against the real Square Sandbox is required before merging this phase. Quickstart documents that gate.

---

## R9 — E2E Square stub strategy

**Decision**: `tests/e2e/_square-stub.ts` is a Playwright fixture that:

1. Stubs the Square SDK's HTTP transport by intercepting `connect.squareupsandbox.com/v2/terminals/checkouts` and `connect.squareupsandbox.com/v2/terminals/checkouts/{id}` requests.
2. Provides helper methods invoked from within tests:
   - `stubCreateCheckout({ ticketId, paymentId, status: 'pending' })` — returns a synthetic checkout id.
   - `stubGetCheckoutStatus(checkoutId, { status: 'succeeded', tipCents })` — primes the next `getCheckout` to return that status.
   - `simulateWebhook(event)` — POSTs a validly-signed webhook payload to `/api/webhooks/square` from within the test (signed with `SQUARE_WEBHOOK_SIGNATURE_KEY` from `.env.test`).
3. Asserts at teardown that no test made a real call out to `connect.squareup.com` or `connect.squareupsandbox.com` (defense-in-depth).

The webhook signature key for the test environment is a deterministic constant (`tests/fixtures/square-webhook-key.txt`) loaded into `.env.test` so the stub can produce valid signatures.

**Rationale**: Keeps CI hermetic (no live Square dependencies, no flake from sandbox outages, no API rate-limit pressure). Asserting no real Square calls were made guards against a test accidentally bypassing the stub.

**Alternatives considered**:
- Run against the real Square Sandbox in CI: rejected — flake risk, rate limits, and CI cannot receive webhooks without a tunnel. Sandbox testing is part of the developer's local workflow per R8, not CI.
- Mock at the `lib/square/*.ts` wrapper level rather than the HTTP layer: rejected — would not test the SDK's serialization behavior; stubbing at the HTTP layer also implicitly tests our wrappers' SDK usage.

---

## R10 — Realtime subscription cleanup

**Decision**: The waiting-screen component's effect that opens the Realtime channel returns a cleanup function that calls `channel.unsubscribe()`. This effect's dep array includes the payment id; switching to a new payment id (e.g., on retry) tears down the old subscription and opens a new one. The cleanup ALSO runs on unmount, which covers cancel-to-picker, advance-to-Done, and navigation-away.

Additionally, the `lib/realtime/payments.ts:subscribe` helper returns an `unsubscribe()` function rather than a raw channel, so callers cannot accidentally hold onto a channel reference that bypasses cleanup. The helper documents this invariant in a JSDoc comment.

**Rationale**: Supabase Realtime channels are persistent until explicitly unsubscribed; an orphaned channel keeps a WebSocket connection open and can cause "two waiting screens, one terminal" UX bugs if two checkouts overlap. Forcing unsubscribe on every unmount path is the cheap, correct enforcement.

**Alternatives considered**:
- Global singleton channel that fans out to multiple ticket subscribers: rejected — adds complexity for no benefit at this scale (one waiting screen at a time in a single-salon app).
- Auto-unsubscribe after N seconds of idle: rejected — racy; explicit unsubscribe at the React effect boundary is simpler and correct.
