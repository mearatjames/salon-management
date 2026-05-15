# Research: Login Flow (Device Sign-In + Staff PIN)

**Feature**: 003-login-flow
**Date**: 2026-05-15
**Scope**: Resolve every `NEEDS CLARIFICATION` from the plan template before
Phase 1 design, and record the decision behind each technology choice the
auth gate depends on.

The login flow is the first feature in the repo to touch Supabase Auth, write
to the database, sign cookies, and render an authenticated UI surface. Many
decisions below are foundational for later features (calendar, walk-in,
checkout) — they are made conservatively so those features inherit a stable
base.

## R1. Supabase session reads in middleware (`@supabase/ssr` on Edge)

- **Decision**: Use `@supabase/ssr`'s `createServerClient` inside
  `middleware.ts` at the repo root, running on the **Edge** runtime. The
  middleware reads the Supabase session via the Supabase auth cookies,
  redirects unauthenticated requests to `/login`, redirects pinned-out
  authenticated requests to `/select-staff`, and otherwise lets the request
  through. It does **not** open a Postgres connection — the staff row is
  fetched later by `requireStudioSession()` on the Node runtime
  (R12).
- **Rationale**: `@supabase/ssr` is already a project dependency and is the
  documented way to read session cookies in Next.js App Router. Edge keeps
  middleware latency under the SC-002 implicit budget (< 5 ms p95). Avoiding
  a DB call in middleware sidesteps the cold-start penalty Postgres connections
  carry on Edge runtimes and keeps the request path simple.
- **Alternatives considered**:
  - *`@supabase/auth-helpers-nextjs`*: deprecated upstream; the official
    migration target is `@supabase/ssr`.
  - *Custom JWT validation against the Supabase JWKS*: reinvents the wheel,
    no benefit.
  - *Move middleware to the Node runtime*: only useful if the middleware
    needed Node-only APIs; we don't (cookie + redirect are Edge-safe).

## R2. Operator cookie signing strategy

- **Decision**: Sign the `acting_as_staff_id` cookie with **HS256** via the
  `jose` library. Payload is a small JSON object `{ sid: string, iat: number }`
  where `sid` is `staff.id` and `iat` is issued-at (seconds). Cookie value is
  the compact JWT serialization. `Max-Age=43200` is set on the cookie itself
  (so the browser expires it client-side) **and** verified against `iat + 43200`
  on the server (so a tampered/extended cookie is rejected).
- **Rationale**: HS256 with a server-only `AUTH_COOKIE_SECRET` (32+ random
  bytes) is the simplest mechanism that satisfies FR-008 (signed, httpOnly,
  Secure, SameSite=Lax, hard 12h TTL). `jose` is tiny, Edge-runtime safe (Web
  Crypto under the hood), and lets us reuse the same primitive for verifying
  Supabase JWTs later if needed. No PII is in the payload, so even a leaked
  cookie reveals only an opaque staff id (display name / role / color are
  fetched fresh from Postgres each request — assumption section of spec).
- **Alternatives considered**:
  - *`iron-session`*: a lot more code than we need; ships its own session-
    object semantics that don't fit a single fixed payload.
  - *Plain HMAC with `crypto.createHmac`*: works on Node, doesn't run on
    Edge; would force middleware off Edge.
  - *Encrypted cookie (JWE)*: encryption isn't needed — the payload is just
    an opaque staff id. Authenticity is the property we need.
  - *Unsigned cookie*: trivially spoofable; an attacker could become any
    staff member with browser dev tools.

## R3. PIN hashing library

- **Decision**: Use **`bcryptjs`** at cost factor **11**. PIN hashes live in
  `staff.pin_hash` (text). Verification uses `bcrypt.compare(...)` which is
  constant-time relative to PIN length.
- **Rationale**: Spec FR-007 mandates bcrypt. `bcryptjs` is pure JavaScript
  (no native build deps, deploys cleanly on Vercel and runs on any Node
  version), which avoids Vercel's known headaches with the native `bcrypt`
  binding. Cost 11 measures ~120–250 ms on counter-class hardware (Apple M-
  series, modern Intel) and is the **only** brute-force cost per FR-011 + Q2
  ("rely solely on bcrypt's intrinsic latency"). At 200 ms / attempt, a
  4-digit PIN's full keyspace (10⁴ = 10 000 attempts) takes ~33 minutes of
  uninterrupted attacker time — acceptable for a device that requires prior
  Supabase sign-in to even reach the keypad.
- **Alternatives considered**:
  - *Native `bcrypt`*: faster verify (~3× at the same cost) but Vercel build
    config is finicky; one of the standing salon-app gripes is "auth broke
    on deploy because native module compile failed".
  - *`argon2`*: stronger algorithm but pulls in WASM and is overkill for
    4-digit PINs that are protected behind a device login.
  - *Web Crypto PBKDF2*: works on Edge (a tempting symmetry) but the spec
    explicitly mandates bcrypt.

## R4. Schema migration scope

- **Decision**: Add **`supabase/migrations/0001_auth_schema.sql`** containing
  only the two tables this feature needs:
  - `staff (id uuid PK default gen_random_uuid(), user_id uuid references auth.users(id), display_name text not null, role text not null check (role in ('owner','manager','technician','front_desk')), pin_hash text, color_token text not null, active boolean not null default true, created_at timestamptz not null default now())` — with a partial unique index on `user_id` where `user_id is not null`, and a CHECK that PIN-only staff have a non-null `pin_hash`.
  - `audit_log (id uuid PK default gen_random_uuid(), ts timestamptz not null default now(), actor_user_id uuid, acting_as_staff_id uuid references staff(id), action text not null, entity_type text, entity_id uuid, payload jsonb not null default '{}'::jsonb)` — with an index on `(ts desc)`.
  - **RLS** enabled on both tables. Two policies on `staff` (`select` for
    `authenticated` role; no `insert`/`update`/`delete` from clients — owners
    edit via Settings later, which uses the service-role client). Two
    policies on `audit_log` (`select` for `authenticated` role on rows where
    `payload` is not flagged sensitive — which simplifies in v1 to "deny
    select on `payload` field" using a column-level grant; `insert` only via
    service-role).
- **Rationale**: Principle V — only what this feature needs in the first
  migration. The system design's note that `0001_init.sql` should hold the
  full schema is advisory build-order guidance; honoring it here would inflate
  the auth feature with ~13 tables nothing in the codebase reads yet. Each
  later feature adds its own migration for the tables it introduces. Naming
  the migration `0001_auth_schema.sql` makes the partial scope explicit so
  no future contributor expects to find `appointments` here.
- **Alternatives considered**:
  - *Full schema in 0001_init.sql*: violates Principle V; pulls in ~13 unused
    tables; later features still need data, RLS, and grants tweaks anyway.
  - *Split into `0001_staff.sql` + `0002_audit_log.sql`*: artificial split —
    the auth feature needs both, and they're tiny.
  - *Add the tables ad hoc per Server Action via raw SQL*: not a migration
    is not a schema; would not survive `supabase db reset` in CI.
- **Spec impact**: The spec's assumption "the `audit_log` table already
  exists in the schema (per `docs/system-design.md` § Data model)" is
  optimistic — the table did not exist. This research note updates that
  assumption: this feature creates it.

## R5. Magic-link / OAuth callback handling

- **Decision**: Add **`app/auth/callback/route.ts`** as a single GET Route
  Handler that calls
  `supabase.auth.exchangeCodeForSession(searchParams.code)` and then redirects
  to `?next=` (sanitized) or `/select-staff`. Used by both Google OAuth
  (PKCE) and the magic-link flow. `signInWithOAuth({ provider: 'google',
  redirectTo: '/auth/callback' })` and `signInWithOtp({ email, options: {
  emailRedirectTo: '/auth/callback?next=...' } })` post the user there.
- **Rationale**: One callback, one place to enforce `?next=` sanitization
  (R6). Standard `@supabase/ssr` pattern. Keeping the route under
  `/auth/callback` (not `/(auth)/callback`) avoids accidentally inheriting
  the centered-card layout designed for `/login` and `/select-staff`.
- **Alternatives considered**:
  - *Per-provider callbacks*: more files, no benefit; the exchange logic is
    identical.
  - *Handle the exchange inside the destination page's RSC*: works but
    splits the contract — middleware would need provider-specific exemptions.

## R6. `?next=` sanitization

- **Decision**: A pure helper `sanitizeNext(raw: string | null): string` in
  `lib/auth/next-url.ts` that returns `raw` unchanged iff:
  1. it's a same-origin path (starts with `/` and not `//`),
  2. it does not contain a hostname (no protocol, no `@`, no `:`),
  3. it begins with one of the studio path prefixes (currently
     `/(studio)`-equivalent: `/dashboard`, `/calendar`, `/clients`,
     `/checkout`, `/walkin`, `/end-of-day`, `/settings`),
  4. otherwise returns `/dashboard`.
- **Rationale**: Open-redirect prevention. The middleware appends
  `?next=<requested-pathname>` only, so callers pass exactly what middleware
  computed — but a malicious user could craft a link like
  `/login?next=https://evil.example.com` and we'd be on the hook to drop it.
  The whitelist pattern is unusual but small, and adding a new studio prefix
  is a one-line change in the helper plus a unit test.
- **Alternatives considered**:
  - *Allow any same-origin path*: leaks the gate's purpose (an attacker
    could deep-link to admin pages). Studio-prefix is the right scope.
  - *Reject all `?next=`*: defeats the UX of "click a deep link → sign in →
    land on the right page".
  - *URL parsing via `new URL(raw, origin)`*: useful but heavier; the
    string-prefix check is simpler and faster and is unit-testable in
    isolation.

## R7. shadcn primitives needed by the auth surfaces

- **Decision**: Pull four new primitives via `npx shadcn add input label
  alert dropdown-menu`. Reuse the dashboard's existing `button`, `card`, and
  `avatar`. Lucide icons only, 1.5 px stroke. No `form` primitive (we use
  plain `<form action={action}>` with Server Actions and surface validation
  errors inline via `alert`).
- **Rationale**: `input` + `label` for the email/password form on `/login`;
  `alert` for sign-in errors and the "PIN didn't match" message; `dropdown-
  menu` for the operator chip's Switch staff / Sign out menu in the studio
  topbar (R13). Skipping `form` keeps the bundle smaller and avoids
  introducing react-hook-form for a two-field form.
- **Alternatives considered**:
  - *Hand-roll inputs and dropdown*: violates Constitution I (only shadcn
    primitives composed into `components/lacquer/*`).
  - *Add `dialog`/`sheet` here for a future inline manager-PIN override*:
    out of scope for this feature (FR-021); add when that feature lands.

## R8. PIN keypad UX pattern

- **Decision**: A `components/lacquer/pin-keypad.tsx` `"use client"` island
  rendering a 3×4 grid of digit buttons (1-9, 0, with Clear and an empty
  slot in row 4 for visual symmetry). Tracks a 4-digit buffer in local
  React state. Auto-submits the wrapping form when the 4th digit is entered.
  Keyboard input is also wired (numeric keys append, Backspace deletes,
  Enter submits if 4 digits). Visual digit indicator above the keypad shows
  filled / empty dots.
- **Rationale**: Salon staff use iPads; tap targets dominate. Auto-submit
  on the 4th digit avoids a redundant "Submit" tap. Keyboard input keeps
  the surface usable on a counter laptop. Local state (no Zustand) — the
  buffer is ephemeral and never leaves the component.
- **Alternatives considered**:
  - *Single `<input type="password" inputMode="numeric" />`*: works on
    keyboard but feels wrong on iPad and offers no visual digit feedback.
  - *Show the PIN as you type*: deliberate no — shoulder-surfing risk on
    a shared counter device.
  - *Persist the buffer across refreshes*: deliberate no — the spec edge
    case "Refresh during PIN entry" requires the buffer to be discarded.

## R9. Audit-log writer pattern

- **Decision**: A single function
  `recordAuth(action, deviceUserId, staffId?, payload?)` in
  `lib/auth/audit.ts`. The `action` parameter is typed against an exported
  string-literal union: `'device.signed_in' | 'device.signed_out' |
  'staff.signed_in' | 'staff.pin_failed' | 'staff.switched'`. The function
  uses `lib/db/admin.ts` (service-role Supabase client) so the insert runs
  even when the calling Server Action is in a soft-degraded state — the audit
  trail is the most important thing to preserve. Writes are awaited; failures
  are logged but never thrown to callers (an audit-log write that fails
  must not block the user's auth action).
- **Rationale**: Centralizing the controlled vocabulary in the type system
  enforces FR-016 at compile time. Service-role plus catch-and-log keeps the
  audit guarantee under degraded conditions without fail-closing legitimate
  user actions on transient DB hiccups.
- **Alternatives considered**:
  - *Inline `supabase.from('audit_log').insert(...)` calls*: drift risk;
    typos in the action string would land in production silently.
  - *Use the cookie-aware client*: fails when the user has no cookie yet
    (e.g., logging the very first `device.signed_in`).
  - *Throw on audit-log failures*: would block legit sign-ins on a Postgres
    blip. Constitution III says the audit must be reconcilable, not that the
    user-facing action must fail — we satisfy this by logging to the platform
    log so ops can replay missed audits.

## R10. Test strategy

- **Decision**:
  - **Vitest unit** (`tests/unit/auth/*.test.ts`):
    - `cookie.test.ts` — sign + verify round-trip; tampered payload rejected;
      tampered signature rejected; expired `iat` rejected; missing `iat`
      rejected.
    - `pin.test.ts` — `hashPin` produces a parseable bcrypt hash at cost 11;
      `verifyPin` returns true on match, false on mismatch; verify times
      against the same hash are within 2× of each other (constant-time
      sanity).
    - `session.test.ts` — `requireStudioSession` returns `StudioViewer` on
      happy path; throws redirect on missing Supabase session; throws
      redirect on missing/expired operator cookie; throws redirect when
      staff is deactivated; returns `DegradedSession` sentinel on Supabase
      network failure (mocked via `vi.mock`).
    - `next-url.test.ts` — `sanitizeNext` accepts `/dashboard`,
      `/calendar/2026-05-15`, `/checkout/abc`, `/settings/staff`; rejects
      `//evil.com`, `https://evil.com`, `javascript:alert(1)`,
      `/admin`, `/login` (we never bounce back to `/login`), `null`,
      empty string; returns `/dashboard` for rejections.
    - `audit.test.ts` — `recordAuth` writes a row with the right `action`
      value for each of the five values; payload jsonb round-trips; insert
      failure is logged but not thrown; service-role client is used (mocked
      asserter).
  - **Playwright e2e** (`tests/e2e/auth.spec.ts`):
    - Full happy path: visit `/dashboard` → redirected to `/login?next=/dashboard`
      → sign in → redirected to `/select-staff?next=/dashboard` → tap tile →
      enter PIN → land on `/dashboard`.
    - Wrong password: error alert visible, no redirect.
    - Wrong PIN: error alert visible, keypad cleared, tile remains
      tappable, audit row asserted via DB query helper.
    - Switch staff: from `/dashboard`, open operator menu → Switch staff →
      land on `/select-staff` → pin in as another staff → topbar reflects
      new operator within one navigation.
    - Sign out: from `/dashboard`, open operator menu → Sign out → land on
      `/login`; hard refresh stays on `/login`.
    - Session expiry: pre-set the operator cookie's `iat` to 13 hours ago →
      visit `/calendar` → land on `/select-staff?next=/calendar`.
    - Soft-degrade: simulate Supabase offline (intercept fetch in test) → the
      "Reconnecting…" banner is visible; a Server Action attempt surfaces a
      retryable toast; the operator cookie persists.
    - Magic link: click "Email me a sign-in link" → confirm a Supabase
      `signInWithOtp` was issued (mocked); confirm the UI returns to a
      "Check your email" state without throwing.
- **Rationale**: Constitution IV is load-bearing for auth. Tests for cookie
  signing, PIN verification, and session resolution are written **first**
  (per Principle IV.3, money/auth logic) — `tasks.md` will sequence the
  failing-test commits before their implementations. Playwright covers the
  full HTTP path so middleware + Server Action wiring is exercised end-to-
  end.

## R11. Supabase Auth provider configuration & soft-degrade detection

- **Decision**:
  - Set the Supabase Auth password policy to **min length 8, no character
    classes** at app boot via `lib/auth/supabase-config.ts` (idempotent —
    skips if already set; logged once at boot). This satisfies FR-023.
  - Magic-link / OTP-email is left **enabled** at the Supabase project level
    (FR-001(c) + Q4); the `/login` UI surfaces the recovery control.
  - Google OAuth is left **enabled** at the Supabase project level if
    credentials are configured. Detection at render-time: the provider
    button only renders when a `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` env
    var is set. (We deliberately do not call Supabase to discover providers
    at render-time — adds latency for a static fact.)
  - Soft-degrade is detected inside `requireStudioSession()` by catching
    `fetch` failures from the Supabase client (network errors and 5xx
    responses) and returning the `DegradedSession` sentinel. The
    `reconnecting-banner.tsx` client component polls `/api/health` every
    10 s when degraded (and stops polling when it returns green).
- **Rationale**: Centralizes the password policy decision in one place that
  CI runs on boot in dev / preview / prod. Env-flag gating Google avoids a
  flaky button when credentials are missing. Soft-degrade detection inside
  `requireStudioSession()` is the right boundary because that's the single
  function every studio page and Server Action calls.
- **Alternatives considered**:
  - *Configure password policy via Supabase dashboard only*: works but is a
    config-drift hazard; we want it in code so test environments match
    prod.
  - *Probe Google availability per render*: slow + brittle.
  - *Soft-degrade inside middleware*: middleware can't call DB anyway, so
    detection there would only catch Supabase Auth failures (not Postgres
    failures), which is the wrong scope.

## R12. `requireStudioSession()` — final shape

- **Decision**: Lives in `lib/auth/session.ts`. Real signature:
  ```ts
  export type StudioViewer = {
    deviceUserId: string;
    staff: { id: string; display_name: string; role: 'owner'|'manager'|'technician'|'front_desk'; color_token: string };
  };
  export type DegradedSession = { degraded: true; cookieStaffId: string };
  export async function requireStudioSession(): Promise<StudioViewer>; // throws redirect on missing session/cookie/staff
  export async function getStudioSessionOrDegraded(): Promise<StudioViewer | DegradedSession>;
  ```
  `requireStudioSession()` is the strict default: it throws a typed redirect
  (`AuthRedirectError` with the target URL embedded) on any unresolved
  state. Server Components that need the soft-degrade behavior call
  `getStudioSessionOrDegraded()` instead (used by `app/(studio)/layout.tsx`
  to keep the shell visible during outages). Server Actions always call
  `requireStudioSession()` and let the redirect propagate.
- **Rationale**: Two functions, two contracts. Pages that *render* during
  outages need the sentinel; mutations that *write* during outages need to
  fail-closed-ish (with a retryable toast, per FR-015a). Splitting the API
  keeps the call sites obvious and lets TypeScript distinguish "I handle
  degraded" from "I always need a real session". Replaces the dashboard's
  stub in place — the stub already returned `{ id, staffId, displayName }`
  and the new shape is a strict superset, but the dashboard never
  destructured those fields, so the swap is mechanical.
- **Alternatives considered**:
  - *Single function returning a discriminated union*: forces every caller
    to handle both branches — too much ceremony for the common "real
    session or bust" case.
  - *Throw a sentinel-shaped error always*: loses the type information
    needed for soft-degrade rendering.

## R13. Studio-shell topbar augmentation

- **Decision**: Modify `app/(studio)/layout.tsx` in place. The new shell is:
  - **Topbar** (56 px tall per Lacquer): brand mark on the left
    ("Tang Nails Studio"), `<reconnecting-banner />` slot in the center
    (renders nothing when not degraded), `<operator-chip />` on the right
    (display_name + color_token + role chip; opens an `<operator-menu />`
    dropdown with Switch staff / Sign out).
  - **Content**: `{children}` rendered in a `max-w-screen-xl` container,
    consistent with the dashboard's expectation.
  - The layout calls `getStudioSessionOrDegraded()` to get the operator (or
    a degraded sentinel) and passes the operator chip props server-side.
- **Rationale**: The dashboard feature shipped a passthrough layout (just
  imports `dashboard.css`) — there is no real shell yet. The auth feature is
  the natural place to add the topbar because (a) the operator chip needs the
  operator identity which only comes from the auth helper, (b) the Switch
  staff and Sign out actions are auth actions, and (c) the Reconnecting
  banner is part of the soft-degrade UX this feature is responsible for.
- **Alternatives considered**:
  - *Defer the topbar to a "shell" feature*: nothing else needs the topbar,
    and Switch staff / Sign out have nowhere else to live.
  - *Render the topbar inside `dashboard/page.tsx` only*: every future
    studio page would have to re-implement it.
  - *Use a portal so the topbar lives outside the layout*: unnecessary
    indirection.
