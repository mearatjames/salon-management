# Session Helper Contract

`lib/auth/session.ts` exposes the canonical interface every studio caller
uses to know "who is acting". It replaces the dashboard feature's stub at
the same path — the dashboard's call site does not change.

## Exports

```ts
export type StudioRole = 'owner' | 'manager' | 'technician' | 'front_desk';

export type StudioViewer = {
  deviceUserId: string;
  staff: {
    id: string;
    display_name: string;
    role: StudioRole;
    color_token: string;
  };
};

export type DegradedSession = {
  degraded: true;
  cookieStaffId: string | null;
};

export class AuthRedirectError extends Error {
  readonly target: '/login' | '/select-staff';
  readonly next: string | null;
  constructor(target: AuthRedirectError['target'], next: string | null);
}

export async function requireStudioSession(): Promise<StudioViewer>;
export async function getStudioSessionOrDegraded(): Promise<StudioViewer | DegradedSession>;
```

## `requireStudioSession()`

Throws `AuthRedirectError` on any unresolved layer. Never returns a
degraded sentinel — Server Actions must fail-closed on any unresolved
state (Constitution III: no write proceeds against a stale connection).

**Resolution sequence** (each step short-circuits to the throw on failure):

1. Read the Supabase device user via `lib/db/server.ts` →
   `supabase.auth.getUser()`.
   - On absence → `throw new AuthRedirectError('/login', currentPath)`.
   - On Supabase network/5xx error → re-throw the underlying error (Server
     Actions catch and surface a retryable toast; pages translate via the
     Next.js error boundary).
2. Read the operator cookie via `cookies().get('acting_as_staff_id')`.
   - On absence → `throw new AuthRedirectError('/select-staff', currentPath)`.
3. Verify the cookie via `verifyOperatorCookie(value)`.
   - On invalid signature, missing claims, or `iat + 43200 < now()` →
     `throw new AuthRedirectError('/select-staff', currentPath)`.
4. Read the `staff` row by `id = sid`.
   - On row missing or `staff.active = false` →
     `throw new AuthRedirectError('/select-staff', currentPath)`.
5. Return `{ deviceUserId: user.id, staff: { id, display_name, role, color_token } }`.

**`currentPath` source**: `headers().get('x-pathname')` (set by middleware
into a forwarded header). Falls back to `null` if absent (e.g., in unit
tests).

## `getStudioSessionOrDegraded()`

Same resolution sequence as `requireStudioSession()`, with **one** behavior
difference: on a Supabase network/5xx error at step 1 or step 4, returns
a `DegradedSession` sentinel instead of throwing.

```ts
{ degraded: true, cookieStaffId: parsedSidIfAny }
```

`cookieStaffId` is the cookie's `sid` claim **without** verifying the
signature (we want a best-effort id even if jose throws on a tampered
cookie — a tampered cookie returns `null`). It exists so the studio shell
can render a placeholder operator chip ("…") and the Reconnecting banner
without losing all context.

**Used by**: `app/(studio)/layout.tsx` only. Server Actions and individual
pages always call `requireStudioSession()`.

## Error class semantics

`AuthRedirectError` is **not** a sentinel — it is a real `Error` so it
participates in normal try/catch / Next.js error boundary plumbing.

**Caught by**:
- Server Actions: a small wrapper `withAuthRedirect(action)` (or inlined
  try/catch in each action) catches the error and calls Next.js
  `redirect(error.target + '?next=' + encodeURIComponent(error.next ?? ''))`
  — this turns into a 303 See Other for form posts.
- Server Components: the error escapes to the closest `error.tsx` boundary
  in `app/(studio)/error.tsx`, which checks `error instanceof AuthRedirectError`
  and calls `redirect(...)`. (Practically, the layout's
  `getStudioSessionOrDegraded()` rarely lets it surface this far.)

## Drop-in compatibility with the dashboard stub

The previous stub in `lib/auth/session.ts` exported:

```ts
export type StudioViewer = { id: string; staffId: string; displayName: string };
export async function requireStudioSession(): Promise<StudioViewer>;
```

The new contract is a strict superset of what the dashboard actually reads:
the dashboard uses only `viewer.staff.display_name` (or used `displayName`
from the stub). This feature's task list includes a one-line update to the
dashboard call site to use the new shape — the type checker will catch
anything missed.

## Performance contract

- `requireStudioSession()` is called on every studio request and most
  Server Actions. Implementation must:
  - Issue exactly **one** Supabase Auth call (`getUser()` — uses cached
    JWT validation, no network hop on the happy path).
  - Issue exactly **one** Postgres `SELECT` against `staff` (single PK
    lookup, ~1 ms).
  - Defer cookie verification to `jose` (sync HMAC, < 1 ms).
- Total budget: **< 10 ms** added to a server-rendered page on a warm
  connection.
