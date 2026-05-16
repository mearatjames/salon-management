# Audit Contract — Login Redesign

Extends
[`specs/003-login-flow/contracts/audit.contract.md`](../../003-login-flow/contracts/audit.contract.md).
Adds **one** controlled-vocabulary action; describes the
two-row sequence produced by a successful password reset.

## `AuditAction` union — extension

Single addition to the existing union in
[`lib/auth/audit.ts`](../../../lib/auth/audit.ts):

```ts
export type AuditAction =
  | "device.signed_in"
  | "device.signed_out"
  | "device.password_reset"   // ← NEW
  | /* …staff.*, service.*… */;
```

`deriveEntityType()` requires no edit: it falls through to
`return "auth"` for any action prefixed `device.`, so
`device.password_reset` automatically receives
`entity_type: "auth"`.

## Row shape — `device.password_reset`

| Column | Value |
|---|---|
| `id` | `bigint` PK, auto-assigned. |
| `created_at` | `timestamptz`, default `now()`. |
| `actor_user_id` | `auth.uid()` of the Supabase user whose password was reset. Set from the session established by the PKCE exchange in `/auth/callback`. Never null on the success path. |
| `acting_as_staff_id` | `null`. The reset flow runs before the operator-PIN gate; no operator is established yet. The `deriveEntityType` back-compat default would mirror `entityId`, but our call passes the 5th arg explicitly as `null` (the helper accepts the override). |
| `action` | `"device.password_reset"`. |
| `entity_type` | `"auth"` (derived). |
| `entity_id` | `null`. |
| `payload` | `{ "method": "recovery" }`. Stable shape; never carries the new password or any token. |

## Lifecycle — full reset flow audit trace

A complete reset (email request → email link clicked → new
password set) produces **two** `audit_log` rows in order:

| # | Source code | `action` | `payload` |
|---|---|---|---|
| 1 | `app/auth/callback/route.ts` — written immediately after `exchangeCodeForSession` succeeds, when the callback detects `?type=recovery`. | `device.signed_in` | `{ "method": "recovery" }` |
| 2 | `app/(auth)/reset-password/actions.ts` — written immediately after `updateUser({ password })` succeeds. | `device.password_reset` | `{ "method": "recovery" }` |

Both rows reference the same `actor_user_id`. The first row
records the act of signing in via a recovery link (which is
itself a device sign-in, distinct from a password or Google
sign-in for forensic queries). The second row records the
actual password change. A query of the form

```sql
SELECT created_at, action, payload
FROM audit_log
WHERE actor_user_id = '<uid>'
  AND created_at >= now() - interval '5 minutes'
ORDER BY created_at;
```

returns the two rows in the exact order above, with a few
hundred milliseconds between them. SC-009 asserts that the
second row exists for every successful reset.

## What is NOT audited

- The `sendPasswordReset` action itself produces **no** audit
  row. The reset request is anonymous (it succeeds whether or
  not the email is registered, per Invariant C); attributing a
  row to "the user who clicked the button" would leak that
  signal. Supabase logs the request internally for ops-level
  rate-limiting; that's the layer where it belongs.
- An expired or already-used reset link produces **no** audit
  row in our schema. The PKCE failure is surfaced to the user
  via the `/reset-password?error=expired` view but not
  forensically attributed (there is no user yet — the exchange
  failed). If anti-abuse becomes a concern, Supabase Auth's
  internal audit feed is the appropriate source.

## Test coverage

| Assertion | Test file | Test name |
|---|---|---|
| `device.password_reset` row exists with correct shape after a successful reset | `tests/e2e/auth.spec.ts` (extended) | `password reset writes device.password_reset audit row` |
| `device.signed_in` row exists with `payload.method = "recovery"` after the PKCE exchange in `/auth/callback` | `tests/e2e/auth.spec.ts` (extended) | `recovery callback writes device.signed_in (method=recovery)` |
| `AuditAction` union compile-check | `tests/unit/auth/audit.test.ts` (existing — extended by adding the new value to the parameterised list) | `recordAuth accepts every action in the union` |

## Future extension (out of scope)

When Settings → Change Password is built (not in this feature),
it MUST reuse the same `device.password_reset` action with a
different `payload.method`:

```ts
recordAuth(
  "device.password_reset",
  userId,
  null,
  { method: "self_service" }
);
```

This keeps the action vocabulary stable and the
distinguishing-detail discoverable via `payload.method`. No
schema change required at that point either.
