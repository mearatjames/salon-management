# Server Actions Contract — Login Redesign

Extends
[`specs/003-login-flow/contracts/server-actions.contract.md`](../../003-login-flow/contracts/server-actions.contract.md).
Two new actions; one existing action gains an extended invariant.

## `sendPasswordReset(formData)` — NEW

**Location**: `app/(auth)/login/actions.ts` (alongside
`signInWithPassword`, `signInWithGoogle`, `signInWithMagicLink`).

**Form fields**:

| Name | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | yes | Submitted from the `forgot` view's email input. |
| `next` | `string` | no | Propagates `?next=` verbatim through the redirect for post-reset landing target sanity (the reset flow eventually lands on `/select-staff` which itself respects `next`). |

**Behaviour**:

1. Read + trim `email`. If empty, redirect to
   `/login?error=invalid&reset_intent=1&next=<encoded>` so the
   `forgot` view re-renders with a calm error. (Mirrors the
   existing magic-link defensive guard at
   `app/(auth)/login/actions.ts:133`.)
2. Resolve `<origin>` via `getOrigin()` (the same helper used by
   `signInWithGoogle` / `signInWithMagicLink`).
3. Build `redirectTo = <origin>/auth/callback?next=<encoded-next>`
   — re-uses the existing callback's PKCE plumbing, which will
   branch on `type=recovery` and forward to `/reset-password`
   (see routes.contract.md).
4. Call:
   ```ts
   await supabase.auth.resetPasswordForEmail(email, { redirectTo });
   ```
5. **No-enumeration parity** (research R5): on success, on
   unknown-email, on `AuthRetryableFetchError` (network), or on
   any other thrown error that isn't a NEXT_REDIRECT sentinel,
   always redirect to:
   ```
   /login?reset_sent=<encodeURIComponent(email)>&next=<encoded-next>
   ```
   The `forgot-sent` view paints the confirmation regardless of
   actual email state.
6. **Only deviation**: a logged-but-swallowed
   `console.error("sendPasswordReset: SDK error swallowed (no-enum)", err)`
   for forensic visibility. No user-visible difference.

**Audit-log impact**: none directly. The reset request itself
does not produce an `audit_log` row — Supabase's email send is
not a user-attributed event. The subsequent
`device.signed_in` (PKCE exchange in `/auth/callback`) and
`device.password_reset` (in `updatePassword` below) are the
audited events.

**Tests** (`tests/unit/auth/login-actions.test.ts`):

- `sendPasswordReset → redirects to ?reset_sent=<encoded>` on
  success.
- `sendPasswordReset → redirects to ?reset_sent=<encoded>` on
  network failure (mocked `AuthRetryableFetchError`).
- `sendPasswordReset → redirects to ?reset_sent=<encoded>` on
  unknown email (mocked SDK error).
- `sendPasswordReset → preserves ?next= verbatim` through the
  redirect.
- Empty-email defensive branch → `?error=invalid&reset_intent=1`.

## `updatePassword(formData)` — NEW

**Location**: `app/(auth)/reset-password/actions.ts`.

**Form fields**:

| Name | Type | Required | Notes |
|---|---|---|---|
| `password` | `string` | yes | New password from the first input. |
| `confirm` | `string` | yes | Confirmation of the new password from the second input. |

**Behaviour**:

1. Read both fields without trimming
   (passwords may legitimately start/end with whitespace).
2. **Validate**:
   - `password.length >= 8` — per `003-login-flow` FR-023 (no
     character-class rules). On failure, redirect to
     `/reset-password?error=too_short`.
   - `password === confirm`. On failure, redirect to
     `/reset-password?error=mismatch`.
3. **Resolve session**: call `supabase.auth.getUser()`. If no
   user is present (PKCE session expired / wasn't established),
   redirect to `/reset-password?error=expired`. The page renders
   the "This link has expired or has already been used." state
   from this query param.
4. Call:
   ```ts
   const { error } = await supabase.auth.updateUser({ password });
   ```
   On `AuthRetryableFetchError`, redirect to
   `/reset-password?error=network` and let the page render a
   retry button.
5. **Audit before redirect** (cross-action invariant 1):
   ```ts
   await recordAuth(
     "device.password_reset",
     userId,
     null,
     { method: "recovery" }
   );
   ```
6. Redirect to `/select-staff?next=` (passing through the
   sanitized `next` if one was carried — but for the reset flow
   most users land here with `next=""`, in which case
   `/select-staff` defaults to `/dashboard` post-PIN).

**Audit-log impact**: writes exactly one `device.password_reset`
row per successful reset (data-model.md § Audit row).

**Tests** (`tests/unit/auth/reset-password.test.ts` — NEW):

- `updatePassword → redirects to /select-staff` on valid input
  + happy path.
- `updatePassword → records device.password_reset` (assert via
  spy on `recordAuth`).
- `updatePassword → ?error=too_short` when password < 8 chars.
- `updatePassword → ?error=mismatch` when passwords don't match.
- `updatePassword → ?error=expired` when no session.
- `updatePassword → ?error=network` on AuthRetryableFetchError.

## `signInWithMagicLink(formData)` — EXTENSION

No code change. Extension is **contract-only**: this feature
introduces a `reset_intent=1` query param that `signInWithMagicLink`
MUST treat the same as `magic_intent=1` for its `next` propagation.
Currently the action ignores both — but reviewers MUST confirm no
regression here.

The simpler extension is that the page's
`MagicLinkControl` consumer is replaced by a `magic-link-view`
component (see `components/lacquer/auth-views.tsx`); the wire to
the action is unchanged.

## `signInWithPassword(formData)` — EXTENSION

No code change. The form rendered by `LoginForm` now lives inside
a redesigned shell with an inline "Forgot password?" link that is
a plain `<a href="/login?reset_intent=1">` (no client JS needed in
the no-JS path). The action's behaviour, contract, and tests are
unchanged.

## Cross-action invariant additions (this feature)

**Invariant 5 — No new env vars**. All four actions in this
folder (signInWithPassword, signInWithGoogle, signInWithMagicLink,
sendPasswordReset, updatePassword) derive their `redirectTo` /
origin from `request.headers().get('origin')` via `getOrigin()`.
No hardcoded URLs, no `process.env.NEXT_PUBLIC_SITE_URL`. Operator
configuration (Supabase Site URL allowlist) is the only out-of-code
piece.

**Invariant 6 — Reset enumeration parity**. The
`sendPasswordReset` action MUST produce a redirect that is
indistinguishable in URL shape, query params, and elapsed wall-clock
time (within ±50ms) for registered-vs-unknown emails. This is a
no-enumeration guarantee equivalent to `signInWithMagicLink`'s
FR-019.

## Action error-key reference

| Query param | Set by | Rendered on view | Copy |
|---|---|---|---|
| `?error=invalid` | `signInWithPassword`, `sendPasswordReset` (empty email) | `signin` / `forgot` | "Email or password is incorrect." / "Enter your email." |
| `?error=network` | All actions on `AuthRetryableFetchError` | The view that submitted | "Couldn't reach the server. Check your connection and try again." |
| `?error=oauth_failed` | `signInWithGoogle`, `/auth/callback` | `signin` | "We couldn't complete that sign-in. Try again or use your password." |
| `?error=too_short` | `updatePassword` | `/reset-password` form | "Password must be at least 8 characters." |
| `?error=mismatch` | `updatePassword` | `/reset-password` form | "Passwords don't match." |
| `?error=expired` | `updatePassword`, `/reset-password` page (no session) | `/reset-password` expired state | "This link has expired or has already been used." |

All copy follows Lacquer content fundamentals (calm, second-person,
sentence case).
