# Phase 1 — Contract: Server Actions

All actions follow the shared prelude documented in `specs/011-cash-sale-checkout/contracts/server-actions.md`:

1. `requireStudioSession()` — auth resolver; throws `AuthRedirectError` if no session.
2. Parse + validate args (per-action, with `zod`).
3. Load + status-check (refuse on terminal-status tickets where applicable).
4. Mutate via the service-role client (bypasses RLS; writes have no client policy).
5. Recompute / propagate state where needed.
6. `recordAudit(...)` with controlled-vocab verbs from `lib/auth/audit.ts`.
7. Return the typed result; no `redirect()` from inside actions (the client island reacts).

Typed error classes live in:
- `app/(studio)/checkout/_errors.ts` (extends the existing module with card-specific errors)
- `app/(studio)/settings/square/_errors.ts` (new)

---

## Settings actions (`app/(studio)/settings/square/actions.ts`)

### `connectSquareStart()`

```ts
async function connectSquareStart(): Promise<{ authorizationUrl: string }>;
```

**Behavior**
- Build the Square OAuth authorization URL using `SQUARE_APPLICATION_ID`, `SQUARE_ENVIRONMENT`, scopes (`PAYMENTS_WRITE PAYMENTS_READ MERCHANT_PROFILE_READ DEVICE_CREDENTIAL_MANAGEMENT`), and a redirect URI derived from the current request origin + `/settings/square/callback`.
- Generate a CSRF-resistant `state` value (signed JWT containing `{ csrf: nonce, returnTo: '/settings/square', issuedAt: now }`) and include it in the URL.
- Return the URL — the client island opens it in the current tab (`window.location.assign`).

**Errors**: none thrown in normal operation; the action is read-only.

**Audit**: none yet (the audit verb fires on the callback when the connection actually persists).

---

### `disconnectSquare()`

```ts
async function disconnectSquare(): Promise<{ ok: true }>;
```

**Behavior**
- Decrypt the stored refresh token via the GUC plumbing.
- Call Square's `oauth.revoke` endpoint (best-effort; if Square is unreachable, proceed anyway to honor the owner's intent).
- `DELETE FROM square_oauth` and `DELETE FROM square_devices` in one transaction.
- Audit verb: `integration.square_disconnected` (entity_type=`integration`, entity_id=`null`, payload: `{ merchant_id }`).
- Return `{ ok: true }`.

**Errors**
- `SquareNotConnectedError` — no `square_oauth` row exists. (Defensive; the UI should never call this when disconnected.)

---

### `renameDevice(deviceId, newName)`

```ts
async function renameDevice(deviceId: string, newName: string): Promise<{ ok: true }>;
```

**Behavior**
- Zod-validate `newName.trim().length` ∈ [1, 60]; reject otherwise.
- `UPDATE square_devices SET friendly_name = $1, updated_at = now() WHERE square_device_id = $2`.
- Audit verb: `integration.square_device_renamed` (entity_type=`integration`, entity_id=`deviceId` cast as text/uuid-shape; payload: `{ old_name, new_name, square_device_id }`).

**Errors**
- `InvalidDeviceNameError` — empty after trim, or > 60 chars.
- `DeviceNotFoundError` — `deviceId` does not exist in `square_devices`.

---

### `setDefaultDevice(deviceId | null)`

```ts
async function setDefaultDevice(deviceId: string | null): Promise<{ ok: true }>;
```

**Behavior** (single transaction)
- `UPDATE square_devices SET is_default = false WHERE is_default = true`.
- If `deviceId` is non-null: `UPDATE square_devices SET is_default = true WHERE square_device_id = $deviceId`.
- (If `deviceId` is null, only the clear runs — useful for "no default" state.)
- Audit verb: `integration.square_device_default_set` (entity_type=`integration`, payload: `{ previous_default_square_device_id, new_default_square_device_id }`).

**Errors**
- `DeviceNotFoundError` — `deviceId` is non-null but no matching row.

---

## OAuth callback route handler (`app/(studio)/settings/square/callback/route.ts`)

Not a Server Action — a route handler because it must accept the GET redirect from Square. But the body of the handler is server-side and behaves the same:

```ts
export async function GET(request: NextRequest): Promise<Response>;
```

**Behavior**
1. `requireStudioSession()`.
2. Validate `state` parameter (verify the signed JWT, check CSRF nonce, check freshness ≤ 10 min).
3. Read `code` query param.
4. POST to Square's `/oauth2/token` with `grant_type=authorization_code`, exchange for access + refresh tokens.
5. Fetch merchant profile (`/v2/merchants/me`) to populate `merchant_id` + `merchant_name`.
6. Inside one transaction: set the GUC, encrypt and INSERT into `square_oauth`, fetch device list and INSERT/UPSERT into `square_devices`.
7. Audit verb: `integration.square_connected` (payload: `{ merchant_id, merchant_name, scope }`).
8. Redirect to `/settings/square?connected=1`.

**Errors** (each produces a redirect with a flash query param, never an unhandled 500):
- Invalid/expired `state` → `/settings/square?error=invalid_state`.
- Square `/oauth2/token` returns 4xx/5xx → `/settings/square?error=oauth_exchange_failed`.
- Vault key missing → `/settings/square?error=vault_misconfigured` (logs an alert).

---

## Checkout actions (`app/(studio)/checkout/actions.ts` — additions)

### `sendCardToTerminal(ticketId, deviceId?)`

```ts
async function sendCardToTerminal(
  ticketId: string,
  deviceId?: string,  // optional override; defaults to the salon default device
): Promise<{ paymentId: string; squareTerminalCheckoutId: string }>;
```

**Behavior** (single transaction except for the Square API call)
1. `requireStudioSession()`.
2. Load the ticket; refuse if `status != 'open'`.
3. Refuse if any ticket line is `price_unconfirmed = true` (re-uses the existing `TicketHasUnpricedItemsError`).
4. Refuse if `tickets.total_cents <= 0` (re-uses `TicketEmptyError`).
5. Refuse if `square_oauth` row is absent (`SquareNotConnectedError`).
6. Refuse if `square_oauth.refresh_failed_at IS NOT NULL` (`SquareReconnectRequiredError`).
7. Resolve `deviceId`: if argument is `null`, look up `is_default = true` in `square_devices`; if no default and exactly one device exists, use it; otherwise throw `TerminalDeviceRequiredError`.
8. `INSERT INTO payments (..., method='card', kind='payment', amount_cents=ticket_total, status='pending', taken_by_staff_id=operator)` and capture the new `payment_id`.
9. Call `lib/square/terminal.createCheckout({ ticketId, paymentId, amountCents: ticket_total, deviceId, referenceId: ticketId })`. On success: capture the returned `square_terminal_checkout_id` and UPDATE the payment row.
10. On Square API failure: UPDATE the payment row to `status='failed', failure_reason='square_unreachable'` in the same transaction (so we don't leave a phantom pending row that the polling endpoint would later expire). Throw `SquareCheckoutCreateFailedError`.
11. Audit verb: `payment.captured` is NOT emitted here (only on settlement). A new verb is not needed; the row's existence with `status='pending'` is the audit trace for "card payment initiated."
12. Return `{ paymentId, squareTerminalCheckoutId }`.

**Errors**
- `TicketNotOpenError`, `TicketHasUnpricedItemsError`, `TicketEmptyError` (existing).
- `SquareNotConnectedError`, `SquareReconnectRequiredError`, `TerminalDeviceRequiredError` (new).
- `SquareCheckoutCreateFailedError` (new) — payload includes Square's error code if any.

---

### `cancelTerminalPayment(paymentId)`

```ts
async function cancelTerminalPayment(paymentId: string): Promise<{ ok: true; resolvedStatus: 'cancelled' | 'race_succeeded' }>;
```

**Behavior**
1. `requireStudioSession()`.
2. Load the payment row; refuse if `method != 'card'` or `status != 'pending'`.
3. Call `lib/square/terminal.cancelCheckout(square_terminal_checkout_id)`.
4. Inspect Square's response:
   - If `checkout.status === 'CANCELED'`: call `pos_record_card_payment(paymentId, 'failed', 0, null, raw, 'cancelled_by_operator')`. Return `{ ok: true, resolvedStatus: 'cancelled' }`.
   - If `checkout.status === 'COMPLETED'`: call `pos_record_card_payment(paymentId, 'succeeded', tip_from_response, square_payment_id, raw, null)`. Return `{ ok: true, resolvedStatus: 'race_succeeded' }`. (This is the Square-wins race path.)
   - If Square is unreachable: do NOT mutate the row. Return `{ ok: false, resolvedStatus: 'still_pending' }` (subject to a typed error or a third union variant; final shape decided during implementation). The client polls or waits for the webhook to resolve.
5. Audit: the RPC writes either `payment.failed` or `payment.captured` (both are existing-or-new verbs).
6. Emit `payment.cancelled` (new verb) IN ADDITION when the operator initiated the cancel — payload: `{ payment_id, resolved_status }`. This separately captures intent (front desk pressed Cancel) distinct from outcome (Square decided).

**Errors**
- `PaymentNotFoundError`, `PaymentNotCancellableError` (new — covers method != 'card' or status != 'pending').

---

## Error class layout

```ts
// app/(studio)/settings/square/_errors.ts
export class SquareNotConnectedError extends Error { /* code: 'SQUARE_NOT_CONNECTED' */ }
export class SquareReconnectRequiredError extends Error { /* code: 'SQUARE_RECONNECT_REQUIRED' */ }
export class InvalidDeviceNameError extends Error { /* code: 'INVALID_DEVICE_NAME' */ }
export class DeviceNotFoundError extends Error { /* code: 'DEVICE_NOT_FOUND' */ }

// app/(studio)/checkout/_errors.ts (additions)
export class TerminalDeviceRequiredError extends Error { /* code: 'TERMINAL_DEVICE_REQUIRED' */ }
export class SquareCheckoutCreateFailedError extends Error { /* code: 'SQUARE_CHECKOUT_CREATE_FAILED' */ }
export class PaymentNotFoundError extends Error { /* code: 'PAYMENT_NOT_FOUND' */ }
export class PaymentNotCancellableError extends Error { /* code: 'PAYMENT_NOT_CANCELLABLE' */ }
```

All errors carry a stable `code` string (machine-readable) and a human-readable message that the UI can surface directly — matching the convention from `app/(studio)/checkout/_errors.ts`.

---

## Audit verb summary (from this contract)

| Action | Audit verb | Entity type |
|---|---|---|
| OAuth callback persists tokens | `integration.square_connected` | `integration` |
| `disconnectSquare()` | `integration.square_disconnected` | `integration` |
| `renameDevice()` | `integration.square_device_renamed` | `integration` |
| `setDefaultDevice()` | `integration.square_device_default_set` | `integration` |
| `sendCardToTerminal()` — initiated | (none — the pending row is the trace) | — |
| `cancelTerminalPayment()` — operator intent | `payment.cancelled` | `payment` |
| RPC settlement to `succeeded` | `payment.captured` (existing) | `payment` |
| RPC settlement to `failed` | `payment.failed` (new) | `payment` |
| Daily token refresh result | `integration.square_token_refreshed` | `integration` |
