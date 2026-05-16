# Routes Contract — Login Redesign

Extends
[`specs/003-login-flow/contracts/routes.contract.md`](../../003-login-flow/contracts/routes.contract.md).
One existing route refactored, one route extended, one new route.

## `/login` (existing — refactor only)

**Component**: `app/(auth)/login/page.tsx` (Server Component).
**Layout**: `app/(auth)/layout.tsx` (Server Component, refactored
to use the two-panel shell — see ui-views.contract.md).

### Pre-redirect logic — UNCHANGED

The page's pre-redirect block from `003-login-flow`
(`app/(auth)/login/page.tsx:71-114`) is preserved verbatim. An
already-signed-in user with a valid operator cookie still
short-circuits to `sanitizeNext(next)`; an authenticated user
without an operator cookie still bounces to `/select-staff`. This
guards FR-005 of `003-login-flow` and US5 of `010-login-redesign`.

### Search-param contract (NEW shape)

The page now reads **five** view-selecting query params plus the
existing error/next params:

| Param | Type | Source | Effect |
|---|---|---|---|
| `next` | `string` | Middleware (`?next=<path>`) | Carried into every form action; sanitized at the cookie-issuing boundary. |
| `error` | `"invalid" \| "network" \| "oauth_failed"` | Server Actions on failure | Renders the matching `Alert` inside the form panel of whichever view is active. |
| `reset_intent` | `"1"` | "Forgot password?" link (no-JS path) | Seeds the `forgot` view. |
| `reset_sent` | `string (encoded email)` | `sendPasswordReset` on success | Seeds the `forgot-sent` view; the email is rendered in the confirmation card. |
| `magic_intent` | `"1"` | "Email me a sign-in link instead" link (no-JS path) | Seeds the `magic` view. |
| `magic_sent` | `string (encoded email)` | `signInWithMagicLink` on success | Seeds the `magic-sent` view; the email is rendered in the confirmation card. |

### View selection precedence

```
if reset_sent     → render <ForgotSentView email={reset_sent} />
else if reset_intent  → render <ForgotView />
else if magic_sent    → render <MagicSentView email={magic_sent} />
else if magic_intent  → render <MagicView />
else                  → render <SignInView />
```

Multiple "sent" params or multiple "intent" params on the same URL
are not a state the application produces; if encountered (e.g.
manual URL editing), the precedence above resolves them
deterministically.

### Response

`200 OK` with the rendered shell. No new headers.

## `/auth/callback` (existing — extended)

**Handler**: `app/auth/callback/route.ts` (Route Handler).

### Extension

Detect Supabase's `?type=recovery` query param. When present,
after a successful PKCE exchange, redirect to `/reset-password`
instead of `/select-staff`. The audit-log row written before
redirect changes its `payload.method` from `oauth_google` /
`magic_link` to `"recovery"`.

Wire-level summary:

```
GET /auth/callback?code=<pkce>&next=<encoded>           → /select-staff?next=<sanitized>
GET /auth/callback?code=<pkce>&type=recovery            → /reset-password
GET /auth/callback?code=<pkce>&type=recovery&next=<...> → /reset-password (next is dropped — reset flow lands on /select-staff later)
```

### Updated method-tagging dispatch

`methodFromProvider` (currently
`app/auth/callback/route.ts:30-34`) gains a fourth branch:

```ts
function methodFromCallback(
  provider: string | undefined,
  type: string | null,
): AuthMethod {
  if (type === "recovery") return "recovery";
  if (provider === "google") return "oauth_google";
  if (provider === "email") return "magic_link";
  return "oauth_other";
}
```

The `AuthMethod` type union in the same file gains `"recovery"`.

### Error states

`?error=oauth_failed` redirect destination is unchanged. The
recovery-specific expired-link case (PKCE code stale or
already-used) MUST redirect to
`/reset-password?error=expired` (NOT to `/login?error=oauth_failed`),
so the user sees a recovery-specific message:

```
GET /auth/callback?code=<stale>&type=recovery  → /reset-password?error=expired
```

The `/reset-password` page detects `?error=expired` and renders
the "This link has expired or has already been used." state with
a "Request a new link" button that links back to
`/login?reset_intent=1`.

## `/reset-password` (NEW)

**Component**: `app/(auth)/reset-password/page.tsx` (Server
Component).
**Layout**: shares `app/(auth)/layout.tsx` — same two-panel
shell as `/login`.

### Pre-render logic

1. Call `supabase.auth.getUser()`. If no user is present, render
   the **expired state** (see below). Do NOT redirect to
   `/login` — the user came here from an email link expecting
   to set a password; bouncing them silently would confuse.
2. If `?error=expired` is present, render the **expired state**
   regardless of session presence.
3. Otherwise render the form: heading "Set a new password",
   subtitle "Pick something you'll remember — 8 characters or
   more.", two password inputs (each with its own reveal
   toggle), and a primary "Set new password" button whose
   form action is `updatePassword`.

### Expired state

A confirm-card styled like the prototype's `.confirm-card`,
copy:

> **This link has expired or has already been used.**
>
> Reset links are good for 1 hour and can only be used once.
> Request a fresh link to try again.
>
> [ Request a new link ]   ← button linking to `/login?reset_intent=1`

### Search-param contract

| Param | Type | Source | Effect |
|---|---|---|---|
| `error` | `"expired" \| "too_short" \| "mismatch" \| "network"` | `updatePassword`, `/auth/callback` on recovery exchange failure | Renders the matching `Alert` above the form (or the expired-state body for `expired`). |

### Response

`200 OK` with the form or the expired state. No new headers.

## `/auth/callback` test coverage extension

| Test | Existing? | Action this feature requires |
|---|---|---|
| Magic-link exchange → `/select-staff` | yes (003) | Re-verify after extension. |
| Google OAuth exchange → `/select-staff` | yes (003) | Re-verify after extension. |
| Bad code → `/login?error=oauth_failed` | yes (003) | Unchanged. |
| **Recovery exchange → `/reset-password`** | no | **Add to `tests/e2e/auth.spec.ts`.** |
| **Stale recovery code → `/reset-password?error=expired`** | no | **Add to `tests/e2e/auth.spec.ts`.** |

## Cross-route invariants

- **No new env vars.** Every URL is derived from
  `request.url` / `headers.get('origin')`.
- **PKCE single-use.** Enforced by Supabase. Test for it
  (data-model.md Invariant B).
- **Operator cookie is untouched.** The recovery flow does not
  set, clear, or read the `acting_as_staff_id` cookie. After
  reset → `/select-staff` → the user pins in normally to
  establish operator identity.
- **No new middleware exemptions needed.** `/reset-password` sits
  under `app/(auth)/` which the existing middleware in
  `003-login-flow` already exempts from studio-gate redirects.
