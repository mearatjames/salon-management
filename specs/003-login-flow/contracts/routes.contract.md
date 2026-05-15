# Routes Contract

Three HTTP surfaces are introduced by this feature, plus one middleware that
sits in front of every studio route.

## `middleware.ts` (repo root, Edge runtime)

**Matcher**: every path **except**:
- `/login`, `/select-staff`
- `/auth/callback` and any other future `/auth/*` paths
- `/kiosk/*` (the kiosk has its own auth path — out of scope here)
- `/api/webhooks/*` (Square webhook endpoint, signature-verified separately)
- Static assets (`/_next/*`, `/favicon.ico`, files with extensions)

**Behavior**:
1. Read the Supabase session via `@supabase/ssr` `createServerClient`.
   - **No session** → respond with a 307 redirect to
     `/login?next=<encodeURIComponent(pathname + search)>`.
2. Otherwise, read the `acting_as_staff_id` cookie.
   - **Missing cookie** → 307 redirect to `/select-staff?next=<...>`.
   - **Cookie present but signature invalid or `iat + 43200 < now()`** →
     clear the cookie via `Set-Cookie: acting_as_staff_id=; Max-Age=0` and
     307 redirect to `/select-staff?next=<...>`.
3. Otherwise, let the request through (`NextResponse.next()`).

**Non-behavior** (intentional):
- Middleware does **not** open a Postgres connection. The staff row is
  resolved by `requireStudioSession()` later in the request lifecycle (R12).
- Middleware does **not** validate that `?next=` is well-formed — the
  receiving page's Server Actions sanitize it via `sanitizeNext()` (R6).

**Performance**: < 5 ms p95 added to a request (target).

---

## `GET /login`

**Auth requirements**: none (public).

**Pre-redirect**: if a Supabase session is already present, redirect forward
to `/select-staff?next=<...>` (preserving the existing `?next` query
parameter). If both layers are present and valid, redirect to the sanitized
`?next=` (default `/dashboard`). This is the FR-005 short-circuit.

**Renders**: A centered card containing:
- Brand mark + headline ("Sign in to Tang Nails Studio")
- `<LoginForm>` — email input, password input, "Sign in" submit button,
  inline `<Alert>` slot for errors. Form `action` is the
  `signInWithPassword` Server Action.
- `<GoogleSignInButton>` — visible when `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`
  env var is `'true'`. Form `action` is `signInWithGoogle`.
- `<MagicLinkControl>` — a subordinate text-link
  ("Email me a sign-in link instead") that, when clicked, swaps the form
  to a single email input + "Send link" button. Form `action` is
  `signInWithMagicLink`.

**Response codes**:
- `200` for the rendered form.
- `307` for the pre-redirect cases above.

**Search params**:
- `next` (optional) — preserved into the form's hidden input and onward to
  `/select-staff` and `/auth/callback`.
- `error` (optional) — Supabase OAuth callback may set this; render the
  message inline in the `<Alert>` slot.
- `magic_sent` (optional, `'1'`) — set by `signInWithMagicLink` after
  enqueueing; renders a "Check your email" confirmation in place of the
  form.

---

## `GET /select-staff`

**Auth requirements**: requires a valid Supabase session (enforced by
middleware). No operator cookie required (this *is* where the operator
cookie is established).

**Pre-redirect**: if both layers are present and valid (the user already has
an operator cookie), the page still renders — it doubles as the
"Switch staff" landing — but the existing operator's tile is highlighted as
"You" so it's clear which one is active.

**Renders**:
- Brand mark + headline ("Choose your tile")
- `<StaffRoster>` — a grid of `<StaffTile>` components for every staff row
  where `active = true` AND `pin_hash IS NOT NULL`, fetched via
  `lib/db/server.ts`. Each tile shows the avatar (initials + color_token),
  display_name, and role chip.
- When a tile is tapped, the page swaps to `<PinKeypad>` for that tile.
  The keypad's hidden form fields carry `staffId` and the page's `?next=`
  value; `action` is `submitPin`.
- Empty state: if no rows match, render a calm message ("No staff
  configured. Ask the salon owner to add staff in Settings.") and a
  "Sign out" link (which posts to the `signOut` Server Action).

**Response codes**:
- `200` for the rendered roster / keypad / empty state.
- (Middleware handles redirects for the unauthenticated case.)

**Search params**:
- `next` (optional) — preserved into the keypad form's hidden input.
- `error` (optional, `'pin_failed'`) — set by `submitPin` after a failed
  PIN attempt; renders an inline `<Alert>` near the keypad ("PIN didn't
  match. Try again.") and re-renders the keypad cleared. (The targeted
  staff tile is implicitly preserved via the keypad's `staffId` form
  state.)

---

## `GET /auth/callback`

**Auth requirements**: none (this is where the auth handshake completes).

**Behavior**:
1. Read `?code=<...>` and `?next=<...>` from the query string.
2. Call `supabase.auth.exchangeCodeForSession(code)` (uses PKCE for OAuth
   and magic-link).
3. On success: `recordAuth('device.signed_in', user.id)`, then 307 redirect
   to `/select-staff?next=<sanitizeNext(rawNext)>`.
4. On failure: 307 redirect to `/login?error=oauth_failed`.

**Response codes**:
- `307` always (success or failure).

---

## Cross-route invariants

- **`?next=` propagation**: `middleware → /login → /auth/callback →
  /select-staff → studio` — the parameter is preserved at every hop and
  sanitized only at the final hop (the Server Action that issues the
  operator cookie).
- **Audit-log writes** (see `audit.contract.md`):
  - `device.signed_in` — written by the password Server Action and the
    `/auth/callback` route handler.
  - `device.signed_out` — written by the `signOut` Server Action.
  - `staff.signed_in` — written by `submitPin` on success.
  - `staff.pin_failed` — written by `submitPin` on failure.
  - `staff.switched` — written by `switchStaff` (and implicitly when a
    `submitPin` succeeds with an existing operator cookie present).
- **Cookie hygiene**: the operator cookie is **only** written by
  `submitPin`. It is **only** cleared by middleware (on expiry/invalidity),
  by `switchStaff`, and by `signOut`.
