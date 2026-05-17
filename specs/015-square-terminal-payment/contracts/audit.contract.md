# Phase 1 — Contract: Audit Log Extensions

This phase adds **seven** new `AuditAction` verbs and **one** new `entity_type` value to the existing `lib/auth/audit.ts` vocabulary.

---

## 1. New `AuditAction` verbs

```ts
// Added by feature 015 (entity_type "payment")
| "payment.failed"
| "payment.cancelled"
// Added by feature 015 (entity_type "integration")
| "integration.square_connected"
| "integration.square_disconnected"
| "integration.square_token_refreshed"
| "integration.square_device_renamed"
| "integration.square_device_default_set"
```

The existing `payment.captured` verb is **reused** for successful card payments (currently only emitted by `pos_take_cash` for the cash flow; the new RPC `pos_record_card_payment` emits it for successful card flows). No verb naming change is required.

---

## 2. `deriveEntityType` extension

The current dispatcher returns `"service" | "ticket" | "payment" | "staff" | "auth" | "user"`. This phase adds `"integration"`:

```ts
export function deriveEntityType(
  action: AuditAction
): "service" | "ticket" | "payment" | "staff" | "auth" | "user" | "integration" {
  if (action.startsWith("user.")) return "user";
  if (action.startsWith("ticket.")) return "ticket";
  if (action.startsWith("payment.")) return "payment";
  if (action.startsWith("service.")) return "service";
  if (action.startsWith("integration.")) return "integration";          // NEW
  // ... existing line.* / discount.* / bill.* / staff.* / auth fallthrough
}
```

Reason for the new prefix: see plan.md § Complexity Tracking — folding `square.*` under `auth` would muddy "who signed in" queries; `integration.*` cleanly carves out third-party-service events.

---

## 3. Per-verb payload contract

`audit_log.payload` is `jsonb`. Each new verb's payload shape is fixed by this contract so reporting/replay tooling (future) can rely on stable keys.

### `payment.failed`

```jsonc
{
  "ticket_id":         "<uuid>",
  "method":            "card",
  "amount_cents":      4500,
  "tip_cents":         0,                     // always 0 for failures
  "failure_reason":    "declined" | "device_offline" | "cancelled_by_operator" | "expired" | "unknown" | "square_unreachable",
  "square_payment_id": null
}
```

Emitted by `pos_record_card_payment` (webhook + polling expiration paths) and by `sendCardToTerminal` when the Square API call itself fails (the row is inserted then immediately marked `failed` with `failure_reason: 'square_unreachable'`).

### `payment.cancelled`

```jsonc
{
  "ticket_id":        "<uuid>",
  "payment_id":       "<uuid>",
  "resolved_status":  "cancelled" | "race_succeeded" | "still_pending"
}
```

Emitted by `cancelTerminalPayment` to capture operator intent independent of outcome. The corresponding `payment.failed` (for cancelled) or `payment.captured` (for race_succeeded) is emitted by the RPC.

### `integration.square_connected`

```jsonc
{
  "merchant_id":   "<square merchant id>",
  "merchant_name": "<friendly business name>",
  "scope":         "PAYMENTS_WRITE PAYMENTS_READ MERCHANT_PROFILE_READ DEVICE_CREDENTIAL_MANAGEMENT"
}
```

Emitted by the OAuth callback after a successful token exchange + initial device list fetch. `entity_id` is `null` (singleton — there is no per-row id for the connection itself).

### `integration.square_disconnected`

```jsonc
{
  "merchant_id": "<square merchant id>"
}
```

Emitted by `disconnectSquare`. `entity_id` is `null`.

### `integration.square_token_refreshed`

```jsonc
// success
{ "ok": true, "expires_at": "<iso8601>" }

// failure
{ "ok": false, "error": "<square error code string>" }
```

Emitted by the daily cron. `entity_id` is `null`.

### `integration.square_device_renamed`

```jsonc
{
  "square_device_id": "device:XXXX",
  "old_name":         "Front desk",
  "new_name":         "Back room"
}
```

Emitted by `renameDevice`. `entity_id` is the `square_devices.id` UUID.

### `integration.square_device_default_set`

```jsonc
{
  "previous_default_square_device_id": "device:XXXX" | null,
  "new_default_square_device_id":      "device:YYYY" | null
}
```

Emitted by `setDefaultDevice`. `entity_id` is the new default's `square_devices.id` (or `null` when clearing the default).

---

## 4. Actor + operator attribution

Every audit row records both `actor_user_id` (the `auth.uid()` of the signed-in device — already on the row, captured by `lib/auth/audit.ts`) and `acting_as_staff_id` (the operator's `staff.id`). This is Constitution Principle III's "device user AND operator" requirement.

For the webhook handler — which runs without a user session — `actor_user_id` is `null` and `acting_as_staff_id` is set to `payments.taken_by_staff_id` (the operator who initiated the card payment). This preserves the operator chain even when settlement happens asynchronously.

For the cron handler — which also runs without a session — both `actor_user_id` and `acting_as_staff_id` are `null` for the `integration.square_token_refreshed` row. This is acceptable because there is no user/operator behind a cron; the row's existence at the scheduled time is the audit signal.

---

## 5. Tests

Audit verb assertions live in the e2e tests using the existing cursor convention:

```ts
import { newAuditCursor, getAuditLogRowsSince } from './_db';

test('card payment success records payment.captured', async () => {
  const cursor = await newAuditCursor();
  // ... drive the UI through a successful card payment ...
  const rows = await getAuditLogRowsSince(cursor);
  expect(rows.find(r => r.action === 'payment.captured')).toBeDefined();
  expect(rows.find(r => r.action === 'payment.failed')).toBeUndefined();
});
```

Each user-story e2e spec includes the relevant audit assertions:
- `square-oauth.spec.ts`: `integration.square_connected`, `integration.square_device_renamed`, `integration.square_device_default_set`, `integration.square_disconnected`.
- `card-payment-happy.spec.ts`: `payment.captured` (exactly one), no `payment.failed`.
- `card-payment-cancel.spec.ts`: `payment.cancelled` (operator intent) + `payment.failed` (outcome) for the cancel path; `payment.failed` only (no `payment.cancelled`) for the decline path.
- `card-payment-race.spec.ts`: `payment.cancelled` (intent) + `payment.captured` (race outcome — Square wins).
