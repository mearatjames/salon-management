# Server Actions Contract

All Server Actions in this feature live under `app/(auth)/.../actions.ts` or
`app/(studio)/actions.ts` and are invoked exclusively via `<form action={...}>`
or `formAction` props (no client-side `useFormState` JS-only paths). Every
action awaits `recordAuth(...)` before responding.

Actions return `void` on the happy path (Next.js `redirect()` short-circuits
the response). Validation errors are surfaced by redirecting back with a
query-string error code that the page renders inline.

## `signInWithPassword`

**Location**: `app/(auth)/login/actions.ts`

**Signature**:
```ts
export async function signInWithPassword(formData: FormData): Promise<void>;
```

**FormData fields**:
- `email` (string, required)
- `password` (string, required)
- `next` (string, optional, propagated from query string)

**Behavior**:
1. Validate `email` and `password` are non-empty. On invalid: `redirect('/login?error=invalid&next=' + next)`.
2. Call `supabase.auth.signInWithPassword({ email, password })`.
3. On Supabase error: `redirect('/login?error=invalid&next=' + next)` —
   note the deliberately ambiguous error code (FR-019: do not reveal
   whether the email exists).
4. On success:
   - `recordAuth('device.signed_in', user.id, null, { method: 'password' })`
   - `redirect('/select-staff?next=' + next)`.

**Errors surfaced to the user** (via `?error=`):
- `invalid` — wrong credentials or empty fields. Renders "Email or
  password is incorrect."
- `network` — Supabase unreachable. Renders "Couldn't sign you in. Check
  your connection and try again."

---

## `signInWithGoogle`

**Location**: `app/(auth)/login/actions.ts`

**Signature**: `(formData: FormData) => Promise<void>`

**FormData fields**:
- `next` (string, optional)

**Behavior**:
1. Call `supabase.auth.signInWithOAuth({ provider: 'google', options: {
   redirectTo: '/auth/callback?next=' + next } })`.
2. Redirect to the URL Supabase returns.
3. The `device.signed_in` audit row is written by `/auth/callback` (not
   here) so it's only logged after the OAuth handshake actually completes.

**Errors**:
- If `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED !== 'true'`, the button does not
  render — this action is unreachable.

---

## `signInWithMagicLink`

**Location**: `app/(auth)/login/actions.ts`

**Signature**: `(formData: FormData) => Promise<void>`

**FormData fields**:
- `email` (string, required)
- `next` (string, optional)

**Behavior**:
1. Validate `email` non-empty.
2. Call `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo:
   '/auth/callback?next=' + next } })`.
3. `redirect('/login?magic_sent=1&next=' + next)` regardless of whether
   the email exists in Supabase (FR-019: don't reveal user existence).
4. The `device.signed_in` audit row is written by `/auth/callback` after
   the user clicks the link — not here.

---

## `submitPin`

**Location**: `app/(auth)/select-staff/actions.ts`

**Signature**: `(formData: FormData) => Promise<void>`

**FormData fields**:
- `staffId` (string uuid, required)
- `pin` (string, required, expected 4 digits)
- `next` (string, optional)

**Behavior**:
1. Resolve the Supabase device user via `lib/db/server.ts` →
   `supabase.auth.getUser()`. If absent, `redirect('/login?next=' + next)`.
2. Read `staff` row by `id = staffId` (server-side query, single read).
3. If row missing, inactive, or `pin_hash` null: `recordAuth('staff.pin_failed',
   user.id, staffId, { reason: 'invalid_target' })`, then
   `redirect('/select-staff?error=pin_failed&next=' + next)`.
4. Compute `verifyPin(pin, staff.pin_hash)`.
5. **On mismatch**:
   - `recordAuth('staff.pin_failed', user.id, staffId, { reason: 'mismatch' })`
   - `redirect('/select-staff?error=pin_failed&next=' + next)`.
6. **On match**:
   - If a previous operator cookie exists, capture its `sid` for the audit
     payload (see step 7).
   - `signOperatorCookie({ sid: staffId, iat: now() })` and set the cookie
     via `cookies().set(...)`.
   - `recordAuth('staff.signed_in', user.id, staffId, previousSid ? { previous_staff_id: previousSid } : {})`
   - `redirect(sanitizeNext(next) || '/dashboard')`.

**No throttling, no lockout** (FR-011 + Q2). Bcrypt is the only cost.

---

## `switchStaff`

**Location**: `app/(studio)/actions.ts`

**Signature**: `() => Promise<void>` (no FormData — invoked from the
operator menu).

**Behavior**:
1. Resolve `requireStudioSession()` to capture the current operator's
   `staff.id` (for the audit payload).
2. Clear the operator cookie via `cookies().delete('acting_as_staff_id')`.
3. `recordAuth('staff.switched', viewer.deviceUserId, viewer.staff.id, {})`.
4. `redirect('/select-staff?next=' + currentPath)` — `currentPath` is read
   from `headers().get('referer')` and sanitized.

**Note**: the Supabase session is **not** touched.

---

## `signOut`

**Location**: `app/(studio)/actions.ts`

**Signature**: `() => Promise<void>`

**Behavior**:
1. Resolve `getStudioSessionOrDegraded()` to capture the device user id and
   (best-effort) the operator's `staff.id` for the audit payload — degraded
   is acceptable here; we still want to sign the user out cleanly.
2. `recordAuth('device.signed_out', viewer.deviceUserId, viewer.staff?.id ?? null, {})`.
3. `cookies().delete('acting_as_staff_id')`.
4. `await supabase.auth.signOut()`.
5. `redirect('/login')`.

---

## Cross-action invariants

- **Single source of truth for the cookie**: `submitPin` is the only action
  that **issues** an operator cookie. `switchStaff` and `signOut` are the
  only actions that **clear** it. Middleware also clears expired/invalid
  cookies. No other write path is permitted.
- **Audit before redirect**: every action awaits `recordAuth(...)` before
  calling `redirect(...)`. Even on failure, the audit write is awaited so
  forensic queries see the attempt.
- **Sanitize at the boundary**: `sanitizeNext()` is called only at the last
  hop (the action that issues the operator cookie or signs the user in).
  Earlier hops just propagate the raw value.
- **Soft-degrade**: if a Server Action's underlying Supabase call fails
  with a network/5xx error, the action throws — this triggers a Next.js
  error boundary that the studio shell renders as a retryable toast. The
  cookie is **not** cleared.
