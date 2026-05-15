# Cookie Contract

The `acting_as_staff_id` cookie is the single piece of state that
`/select-staff` produces and that every subsequent studio request consumes.

## HTTP attributes

| Attribute | Value |
|-----------|-------|
| **Name** | `acting_as_staff_id` |
| **HttpOnly** | `true` |
| **Secure** | `true` (always — even in dev, where Next.js dev server emits HTTPS via `https://localhost` only when explicitly configured; for plain `http://localhost`, `Secure` is dropped automatically by the browser per spec) |
| **SameSite** | `Lax` |
| **Path** | `/` |
| **Max-Age** | `43200` (= 12 hours, in seconds) |
| **Domain** | omitted (host-only) |

The cookie is **set** by `submitPin` and is **cleared** by:
- middleware (on signature/expiry failure),
- `switchStaff`,
- `signOut`.

## Value format

Compact JWT (HS256), per `jose.SignJWT`:

```
<base64url(header)>.<base64url(payload)>.<base64url(signature)>
```

- **Header**: `{ "alg": "HS256", "typ": "JWT" }` (jose default)
- **Payload claims**:
  | Claim | Type | Notes |
  |-------|------|-------|
  | `sid` | string (uuid) | The selected `staff.id` |
  | `iat` | number (unix seconds) | Issued-at (`Math.floor(Date.now() / 1000)`) |

  No `exp` claim — we verify expiry from `iat` directly so a tampered `exp`
  cannot extend the lifetime.
- **Signature**: HS256 over the encoded header + payload, using a 32-byte
  secret read from `process.env.AUTH_COOKIE_SECRET`.

## API

`lib/auth/cookie.ts` exports:

```ts
export type OperatorCookiePayload = { sid: string; iat: number };

export async function signOperatorCookie(payload: OperatorCookiePayload): Promise<string>;
export async function verifyOperatorCookie(value: string): Promise<OperatorCookiePayload>;
```

### `signOperatorCookie(payload)`

- Validates `sid` is a non-empty string and `iat` is a positive integer.
- Returns the compact JWT.
- Does **not** set the cookie itself — callers do that via `cookies().set(...)`.

### `verifyOperatorCookie(value)`

- Calls `jose.jwtVerify(value, secret, { algorithms: ['HS256'] })`.
- Asserts the payload contains `sid` (string, uuid-shaped) and `iat`
  (number).
- Asserts `iat + 43200 >= floor(Date.now() / 1000)` (else throws
  `OperatorCookieExpiredError`).
- Returns the typed payload on success.
- Throws on any failure (invalid signature, missing claims, expired,
  tampered) — never returns a sentinel.

### Error classes

```ts
export class OperatorCookieInvalidError extends Error {}
export class OperatorCookieExpiredError extends Error {}
```

Both are caught by middleware and `requireStudioSession()` and translated
to a `/select-staff` redirect.

## Secret management

- `AUTH_COOKIE_SECRET` lives in `.env.local` (dev), Vercel project env
  (preview/prod). Generated as `openssl rand -base64 32`.
- The secret is **server-only**. It is never exposed via
  `NEXT_PUBLIC_*`.
- Rotation invalidates all outstanding operator cookies (next request
  redirects every operator to `/select-staff` to pin in again). This is the
  intended behavior; rotation is not part of v1's automation.

## Why a JWT instead of a plain HMAC blob?

- JWT serialization is well-understood, has multiple debug tools, and lets
  us reuse `jose` for verifying Supabase JWTs later if needed.
- The compact representation is the same length we'd get from a hand-rolled
  `${base64(payload)}.${base64(hmac)}` scheme.
- We deliberately **do not** use Supabase's auth JWT for the operator
  identity — that JWT identifies the device user, not the operator, and we
  need a separate, app-controlled lifetime (12 h hard).

## Test fixtures

- A test helper at `tests/unit/auth/_fixtures.ts` exposes a known
  `TEST_AUTH_COOKIE_SECRET` and helpers `mintCookie({ sid, iatOffsetSec })`
  and `mintExpiredCookie({ sid })`. The Vitest suite uses these to drive
  cookie verification in isolation; the Playwright suite uses them via a
  test-only Server Action `__test_set_cookie__` (registered only when
  `process.env.NODE_ENV !== 'production'`) to pre-set cookies for the
  session-expiry scenario.
