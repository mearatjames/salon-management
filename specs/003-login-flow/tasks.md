---

description: "Tasks for feature 003: Login Flow (Device Sign-In + Staff PIN)"
---

# Tasks: Login Flow (Device Sign-In + Staff PIN)

**Input**: Design documents from `/specs/003-login-flow/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/{routes,server-actions,session-helper,cookie,audit}.contract.md,
quickstart.md

**Tests**: INCLUDED. Auth is a Constitution-IV "critical path" — every helper
under `lib/auth/*` ships with a Vitest unit test, **written first and shown
to fail** before the implementation that satisfies it lands. Each user story
phase ends with an extension to a single Playwright spec
(`tests/e2e/auth.spec.ts`) that exercises the story end-to-end.

**Organization**: Tasks are grouped by the six user stories defined in
`spec.md` (US1–US6). Phases 1–2 are blocking prerequisites; Phases 3–8
deliver one user story each; Phase 9 is cross-cutting polish. The
foundational phase is large because this is the first feature in the repo
to touch Supabase Auth, ship a Postgres migration, run middleware, and
augment the studio shell — three explicit pull-forwards documented in
`plan.md` § Complexity Tracking.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to a `spec.md` user story (`[US1]` … `[US6]`)
- Every task lists exact file paths

## Path Conventions

This feature continues the Next.js App Router monorepo at the repo root —
no `src/`. All paths below are relative to
`/Users/mearathou/Dev/salon-management/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the two new runtime dependencies, the shadcn primitives the
auth surfaces need, the auth-only stylesheet, and the env-var documentation
that the rest of the feature reads. None of these are user-facing on their
own.

- [ ] T001 Install `bcryptjs` (runtime) and `@types/bcryptjs` (dev) via `npm install bcryptjs && npm install --save-dev @types/bcryptjs`. Confirm `package.json` and `package-lock.json` are updated and `npm install` is idempotent. (Used by `lib/auth/pin.ts`; research.md R3.)
- [ ] T002 [P] Install `jose` (runtime) via `npm install jose`. Confirm version is ≥ 5.x in `package.json`. (Used by `lib/auth/cookie.ts` for HS256 sign/verify on the Edge runtime; research.md R2.)
- [ ] T003 [P] Add four shadcn primitives via `npx shadcn@latest add input label alert dropdown-menu`. Confirm the generator writes `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/alert.tsx`, `components/ui/dropdown-menu.tsx` and does not modify any other file. No other primitives are added in this feature (Principle V; research.md R7).
- [ ] T004 [P] Create `styles/auth.css` containing only the `.auth-*` classes the auth surfaces need: `.auth-shell` (centered card on neutral background, viewport-padded), `.auth-card` (Lacquer-radius-16 card with shadow-md), `.auth-headline`, `.auth-form-row`, `.auth-form-actions`, `.auth-divider` (horizontal rule with "or" badge), `.auth-magic-link` (subordinate text-link styling), `.auth-roster` (responsive grid of staff tiles), `.auth-staff-tile` (avatar + name + role chip; tap-target sized for iPad), `.auth-keypad` (3×4 grid), `.auth-keypad-key`, `.auth-keypad-display` (4 dots), `.auth-keypad-clear`. Every property MUST resolve to a `var(--*)` from `styles/tokens.css` — no raw hex, no off-scale spacing. Constitution Principle I.
- [ ] T005 [P] Update `.env.example`: (a) add the new var `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=false` under `# --- App ---` with a one-line comment ("Set to `true` only when Google credentials are configured in the Supabase dashboard."), (b) leave `ACTING_AS_COOKIE_SECRET` as-is — it is the canonical name; the contract docs and quickstart will be aligned to it in T005a. Do **not** add `AUTH_COOKIE_SECRET` (the contract drafts used that name; we honor the existing scaffold).
- [ ] T005a [P] Align the auth contract docs to the existing env-var name: in `specs/003-login-flow/contracts/cookie.contract.md`, `specs/003-login-flow/plan.md`, and `specs/003-login-flow/quickstart.md`, replace every reference to `AUTH_COOKIE_SECRET` with `ACTING_AS_COOKIE_SECRET`. No other content changes. (Documentation hygiene only — no implementation depends on this task ordering, but doing it in Setup keeps later tasks searchable for the canonical name.)

**Checkpoint**: `npm install` clean; `components/ui/input.tsx`, `label.tsx`, `alert.tsx`, `dropdown-menu.tsx` present; `styles/auth.css` exists; `.env.example` documents `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`; contract docs use `ACTING_AS_COOKIE_SECRET`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, db clients, the seven `lib/auth/*` helpers (each with
its tests-first companion per Constitution IV), Edge middleware, the
`(auth)` layout, and the studio shell topbar augmentation. **No user-story
work begins until this phase is green.**

**⚠️ CRITICAL**: This phase is the foundation for every story below. All
four quality gates (`typecheck`, `lint`, `test`, `test:e2e`) must pass at
the checkpoint before Phase 3 begins.

### Phase 2A — Schema, seed, types

- [ ] T006 Create `supabase/migrations/0001_auth_schema.sql` introducing **only** the two tables this feature needs, exactly as specified in `data-model.md` § 1: (a) `staff` with the columns, CHECK constraints (`role IN (...)`, `pin_hash IS NOT NULL OR user_id IS NOT NULL`), partial unique index `staff_user_id_unique` ON `(user_id) WHERE user_id IS NOT NULL`, regular index `staff_active_role_idx` ON `(active, role)`; (b) `audit_log` with the columns, indexes `audit_log_ts_idx ON (ts DESC)`, `audit_log_actor_idx ON (actor_user_id, ts DESC)`, `audit_log_action_idx ON (action, ts DESC)`. Enable RLS on both. Add the four policies from data-model.md § 1.1 / § 1.2: `staff_select_authenticated` (SELECT for `authenticated`); `audit_log_select_authenticated` (SELECT for `authenticated`) plus `REVOKE SELECT (payload) FROM authenticated; GRANT SELECT (payload) TO service_role;`. No INSERT/UPDATE/DELETE policies for either table — those go through service-role.
- [ ] T007 [P] Create `supabase/seed.sql` per `data-model.md` § 7. Insert two `auth.users` rows via `auth.users` direct insert (with `encrypted_password = crypt('tang-nails-dev', gen_salt('bf'))` from pgcrypto): `owner@tangnails.dev` and `manager@tangnails.dev`. Insert three `staff` rows: Maya Patel (`owner`, `--accent-rose`, linked to owner@), Jordan Lee (`manager`, `--accent-amber`, linked to manager@), Sam Chen (`technician`, `--accent-violet`, no `user_id`). PIN hashes: precompute `bcrypt.hashSync('1234', 11)`, `'5678'`, `'9999'` once via a tiny script and embed the literal strings in `seed.sql`. Top-of-file comment notes the PINs are dev-only and that production bootstrap is a manual SQL/Studio step.
- [ ] T008 Run `supabase start` (idempotent if running) then `supabase db reset` to apply T006 + T007. Run `npx supabase gen types typescript --local > lib/db/types.ts` to generate the typed Database interface. Confirm `lib/db/types.ts` contains `staff` and `audit_log` table types with the columns from T006. (Depends on T006, T007.)

### Phase 2B — DB clients

- [ ] T009 [P] Create `lib/db/server.ts` exporting `createSupabaseServerClient()` — calls `createServerClient` from `@supabase/ssr` wired to `cookies()` from `next/headers` (read + write). Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `process.env`. Returns the typed client `SupabaseClient<Database>` (Database from `lib/db/types.ts`). Used by RSC and Server Actions. (Depends on T008 for the type import.)
- [ ] T010 [P] Create `lib/db/admin.ts` exporting `createSupabaseServiceRoleClient()` — calls `createClient` from `@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY`, `auth: { persistSession: false, autoRefreshToken: false }`. Returns the typed client. Used **only** by `lib/auth/audit.ts`. Top-of-file comment forbids importing this from any UI file. (Depends on T008.)

### Phase 2C — Pure helpers (tests-first)

> Each (test, impl) pair below MUST be committed in order: write the test
> file first, run `npm test` to confirm the suite is RED, then add the
> implementation in a second commit and confirm GREEN. Constitution
> Principle IV.3.

- [ ] T011 [P] Create `tests/unit/auth/_fixtures.ts` exporting `TEST_ACTING_AS_COOKIE_SECRET` (a fixed 32-byte base64 string), and helpers `mintCookie({ sid, iatOffsetSec? })` and `mintExpiredCookie({ sid })` that build valid/expired JWTs against the test secret using `jose`. These helpers are imported by every cookie/session test below and by the Playwright `__test_set_cookie__` shim referenced in `cookie.contract.md` § "Test fixtures".
- [ ] T012 [P] Create `tests/unit/auth/cookie.test.ts` per `research.md` R10 § cookie cases: round-trip (sign then verify returns identical `sid`/`iat`); tampered payload rejected (mutate the middle segment, expect `OperatorCookieInvalidError`); tampered signature rejected (mutate the trailing segment); expired `iat` rejected (use `mintExpiredCookie`, expect `OperatorCookieExpiredError`); missing `iat` claim rejected; signing payload with empty `sid` throws. Run `npm test -- cookie` and confirm RED (file/exports do not exist yet).
- [ ] T013 Create `lib/auth/cookie.ts` exporting `signOperatorCookie`, `verifyOperatorCookie`, `OperatorCookiePayload`, `OperatorCookieInvalidError`, `OperatorCookieExpiredError` per `contracts/cookie.contract.md`. Use `jose.SignJWT` (HS256) and `jose.jwtVerify`. Read the secret via `process.env.ACTING_AS_COOKIE_SECRET` (lazily, so test code can override via env). Verify expiry via `iat + 43200 < floor(Date.now()/1000)`. Confirm `npm test -- cookie` GREEN. (Depends on T012.)
- [ ] T014 [P] Create `tests/unit/auth/pin.test.ts` per research R10 § pin cases: `hashPin('1234')` returns a string starting with `$2a$11$` or `$2b$11$`; `verifyPin('1234', hash)` returns `true`; `verifyPin('0000', hash)` returns `false`; verify times for the same hash with two different inputs are within 2× of each other (constant-time sanity — measure `performance.now()` deltas, allow generous tolerance for CI variance). Run `npm test -- pin` and confirm RED.
- [ ] T015 Create `lib/auth/pin.ts` exporting `hashPin(plain: string): Promise<string>` (`bcrypt.hash(plain, 11)`) and `verifyPin(plain: string, hash: string): Promise<boolean>` (`bcrypt.compare(plain, hash)`). Import from `bcryptjs` (NOT `bcrypt`). Confirm `npm test -- pin` GREEN. (Depends on T014.)
- [ ] T016 [P] Create `tests/unit/auth/next-url.test.ts` per research R10 § next-url cases: ACCEPT `/dashboard`, `/calendar/2026-05-15`, `/checkout/abc-123`, `/clients`, `/walkin`, `/end-of-day`, `/settings/staff`; REJECT `//evil.com` (returns `/dashboard`), `https://evil.com` (returns `/dashboard`), `javascript:alert(1)` (returns `/dashboard`), `/admin` (returns `/dashboard` — not a studio prefix), `/login` (returns `/dashboard` — never bounce back to login), `null` (returns `/dashboard`), empty string (returns `/dashboard`), undefined (returns `/dashboard`). Run `npm test -- next-url` and confirm RED.
- [ ] T017 Create `lib/auth/next-url.ts` exporting `STUDIO_PREFIXES` (the seven prefixes enumerated in research R6) and `sanitizeNext(raw: string | null | undefined): string` returning `raw` iff it satisfies all four R6 conditions, else returning `'/dashboard'`. Confirm `npm test -- next-url` GREEN. (Depends on T016.)
- [ ] T018 [P] Create `tests/unit/auth/audit.test.ts` per research R10 § audit cases. Mock the service-role client (`vi.mock('@/lib/db/admin', ...)`), drive `recordAuth` once per action value (all five), and assert: each call inserts a single row into `audit_log` with the right `action` string, `entity_type === 'auth'`, payload jsonb shape per `contracts/audit.contract.md`. Also assert: when the mocked insert throws, `recordAuth` does not re-throw (it logs and resolves). Run `npm test -- audit` and confirm RED.
- [ ] T019 Create `lib/auth/audit.ts` exporting `AuthAction` (the five-value string literal union), `recordAuth(action, deviceUserId, staffId?, payload?)` that uses `createSupabaseServiceRoleClient()` to insert into `audit_log` with `entity_type: 'auth'`, `entity_id: staffId ?? null`, `payload: payload ?? {}`. Wrap the insert in `try { await ... } catch (e) { console.error('audit insert failed', e); }` so a transient failure never blocks the caller. Confirm `npm test -- audit` GREEN. (Depends on T010, T018.)

### Phase 2D — Session helper (replaces stub)

- [ ] T020 [P] Create `tests/unit/auth/session.test.ts` per research R10 § session cases. Use `vi.mock` to stub `lib/db/server.ts` and `next/headers.cookies()`. Cases: happy path returns full `StudioViewer` with `deviceUserId` + `staff.{id, display_name, role, color_token}`; missing Supabase user throws `AuthRedirectError('/login', currentPath)`; missing operator cookie throws `AuthRedirectError('/select-staff', currentPath)`; tampered cookie throws `AuthRedirectError('/select-staff', ...)`; expired cookie throws `AuthRedirectError('/select-staff', ...)`; deactivated staff (`active=false`) throws `AuthRedirectError('/select-staff', ...)`; Supabase network error (mocked `fetch` rejection) re-throws from `requireStudioSession()` but is caught by `getStudioSessionOrDegraded()` returning `{ degraded: true, cookieStaffId }`. Run `npm test -- session` and confirm RED.
- [ ] T021 Replace `lib/auth/session.ts` (currently the dashboard stub) with the real implementation per `contracts/session-helper.contract.md`. Export `StudioViewer`, `DegradedSession`, `AuthRedirectError`, `requireStudioSession()`, `getStudioSessionOrDegraded()`. Internal flow: read `cookies()` and `headers()` from `next/headers`; resolve Supabase user via `createSupabaseServerClient().auth.getUser()`; resolve cookie via `verifyOperatorCookie`; resolve staff row via `from('staff').select('id, display_name, role, color_token').eq('id', sid).eq('active', true).single()`. Throw `AuthRedirectError` on each failure path. The degraded variant catches Supabase fetch errors and returns the sentinel. Confirm `npm test -- session` GREEN. (Depends on T009, T013, T020.)
- [ ] T022 Update `app/(studio)/dashboard/page.tsx` to use the new viewer shape. The page currently destructures `{ id, staffId, displayName }` from the stub; the real `StudioViewer` exposes `{ deviceUserId, staff: { id, display_name, role, color_token } }`. Rename references accordingly (the page only reads `displayName` for the header subtitle — change to `viewer.staff.display_name`). Run `npm run typecheck` and confirm green; run `npm test` and confirm the existing dashboard suites stay green. (Depends on T021.)

### Phase 2E — Middleware

- [ ] T023 Create `middleware.ts` at the repo root per `contracts/routes.contract.md` § middleware. Use `@supabase/ssr` `createServerClient` wrapped over `NextRequest`/`NextResponse` cookie helpers. Matcher excludes `/login`, `/select-staff`, `/auth/*`, `/kiosk/*`, `/api/webhooks/*`, `/_next/*`, `/favicon.ico`, and any path with a file extension. Behavior matches the contract: redirect to `/login?next=...` when no Supabase session; verify the operator cookie via `verifyOperatorCookie`; on any verification failure, clear the cookie via `Set-Cookie: acting_as_staff_id=; Max-Age=0; Path=/` and redirect to `/select-staff?next=...`; otherwise call `NextResponse.next()` after copying the request's pathname into the `x-pathname` header so `requireStudioSession()` can read it. (Depends on T009, T013.)

### Phase 2F — Layouts and chrome

- [ ] T024 Create `app/(auth)/layout.tsx` rendering a centered card on a neutral background using `styles/auth.css` classes. Imports `'@/styles/auth.css'` at the top. Wraps `{children}` in `<main className="auth-shell"><section className="auth-card">…</section></main>`. Includes a small brand mark above the card (Lucide `<Sparkles size={20} />` + "Tang Nails Studio" — using `var(--foreground)`). No client JS.
- [ ] T025 [P] Create `components/lacquer/operator-chip.tsx` (server component). Props: `staff: { display_name, role, color_token }`. Renders an inline pill: small avatar circle (initials, background = `oklch(...)` derived from `color_token`), display name, role chip (small uppercase pill in `var(--muted)`). Wrapped in a button so it's the dropdown trigger when paired with `<OperatorMenu />`.
- [ ] T026 [P] Create `components/lacquer/operator-menu.tsx` as `"use client"`. Props: `children: ReactNode` (the chip is the trigger). Wraps `components/ui/dropdown-menu.tsx`. Items: "Switch staff" (form posts to `switchStaff` from `@/app/(studio)/actions`), "Sign out" (form posts to `signOut`). Each item is a `<form action={...}>` with a styled `<button type="submit">` so the action runs even with JS disabled. Uses Lucide `<Repeat size={16} />` and `<LogOut size={16} />`.
- [ ] T027 [P] Create `components/lacquer/reconnecting-banner.tsx` as `"use client"`. Polls `/api/health` every 10 seconds via `setInterval`; renders nothing when the response is `{ ok: true }`; renders an inline strip styled as Lacquer `notice` ("Reconnecting…" with Lucide `<Loader size={16} />` spinning) when the response is non-200 or fetch throws. Uses `useEffect` for the polling loop, with cleanup. No external state library.
- [ ] T028 [P] Create `app/api/health/route.ts` as a GET Route Handler. Calls `createSupabaseServerClient().from('staff').select('id', { count: 'exact', head: true })`. Returns `Response.json({ ok: true })` on success or `Response.json({ ok: false }, { status: 503 })` on failure. Used by `<ReconnectingBanner />` only — kept lightweight (a single SELECT … LIMIT 0). (Depends on T009.)
- [ ] T029 Create `app/(studio)/actions.ts` with stubbed `switchStaff` and `signOut` Server Actions. Both export `'use server'`-marked async functions that throw `new Error('Not implemented yet — implemented by US3 / US6')`. This file is the canonical import target for `<OperatorMenu />` (T026); US3 (T041) and US6 (T050) replace the function bodies in place.
- [ ] T030 Modify `app/(studio)/layout.tsx`. Replace the current passthrough body with a real shell: `<header className="studio-topbar">…</header>` containing the brand mark on the left, `<ReconnectingBanner />` slot in the center, and `<OperatorChip staff={...} />` wrapped in `<OperatorMenu>` on the right; `<main className="studio-main">{children}</main>` below. Resolve the operator via `await getStudioSessionOrDegraded()` in the layout server component; when the result is `degraded`, render the chip with display_name `"…"` and a muted color token (the banner explains the state). Add a small `studio-topbar` block to `styles/dashboard.css` (or a new `styles/studio.css` imported from this layout — pick whichever keeps token discipline cleanest; if a new file is added, document the choice in a single in-file comment). The existing `import "@/styles/dashboard.css"` line stays. (Depends on T021, T025, T026, T027.)

**Checkpoint**: All four gates green (`npm run typecheck && npm run lint && npm test && npm run test:e2e`). The dashboard renders inside a real shell with the demo seed user (Maya Patel) showing in the operator chip — but only after a manual `supabase db reset` and after pinning in (next phase). The Vitest auth suite is fully green; every helper has its tests-first commit pair landed.

---

## Phase 3: User Story 1 — Owner signs in with email and password (Priority: P1) 🎯 MVP

**Goal**: Render `/login` with an email + password form. Submitting valid
credentials redirects to `/select-staff?next=...` (preserving any deep-link
target). Wrong credentials show a calm, identical-for-unknown-emails error.

**Independent Test**: Run `supabase db reset && npm run dev`. Visit
`/dashboard` while signed-out → 307 to `/login?next=%2Fdashboard`. Sign in
with `owner@tangnails.dev` / `tang-nails-dev` → 307 to
`/select-staff?next=%2Fdashboard` (the next phase fills in the PIN
selector — for US1 alone, "lands on /select-staff" is the success
condition). Try a wrong password → inline error visible, no redirect; an
unknown email shows the identical error string (FR-019).

### Implementation for User Story 1

- [ ] T031 [P] [US1] Create `components/lacquer/login-form.tsx` (server component). Props: `next?: string` (propagates the query string into a hidden form input). Renders a `<form action={signInWithPassword}>` containing `<Label htmlFor="email">Email</Label>` + `<Input id="email" name="email" type="email" autoComplete="username" required />`, the same for password (`name="password" type="password" autoComplete="current-password"`), a hidden `<input type="hidden" name="next" value={next ?? ''} />`, and a submit `<Button type="submit">Sign in</Button>`. Uses only shadcn primitives (button/card/input/label) plus Lacquer tokens. No client JS.
- [ ] T032 [US1] Create `app/(auth)/login/page.tsx` as a server component. Read `searchParams.next` and `searchParams.error` and `searchParams.magic_sent`. Pre-redirect: call `createSupabaseServerClient().auth.getUser()` — if a user already exists, `redirect('/select-staff?next=' + (next ?? ''))`. Otherwise render the `<auth-card>`: headline "Sign in to Tang Nails Studio", `<LoginForm next={next} />`, when `searchParams.error === 'invalid'` render an `<Alert variant="destructive">Email or password is incorrect.</Alert>` above the form, when `searchParams.error === 'network'` render the network message. Magic-link / Google controls are added later (US4 — they slot below the form). (Depends on T024, T031.)
- [ ] T033 [US1] Create `app/(auth)/login/actions.ts` with the `signInWithPassword(formData)` Server Action per `contracts/server-actions.contract.md`. Steps: parse `email`, `password`, `next`; if either is empty, `redirect('/login?error=invalid&next=' + next)`; call `createSupabaseServerClient().auth.signInWithPassword({ email, password })`; on Supabase error or unknown email, `redirect('/login?error=invalid&next=' + next)` (deliberately ambiguous per FR-019); on success, `await recordAuth('device.signed_in', user.id, null, { method: 'password' })` then `redirect('/select-staff?next=' + next)`. Catch network errors (`AuthRetryableFetchError` from `@supabase/supabase-js`) and redirect with `error=network`. (Depends on T009, T019.)
- [ ] T034 [US1] Create `tests/e2e/auth.spec.ts` (Playwright) with a US1 block. Use a `test.beforeEach` that runs `supabase db reset` (or hits a `/api/test-reset` shim — pick whichever the dashboard suite already uses; if neither, prefer `supabase db reset` invoked from the global setup). Cases: (a) sign-out state visiting `/dashboard` redirects to `/login?next=%2Fdashboard` (assert URL); (b) submit `owner@tangnails.dev` / `tang-nails-dev` → redirected to `/select-staff?next=%2Fdashboard` (the page itself doesn't exist yet — assert URL only, treat 404 body as expected); (c) submit `owner@tangnails.dev` / `wrong` → URL becomes `/login?error=invalid&...`, the error alert text is exactly "Email or password is incorrect.", form is re-rendered; (d) submit `unknown@example.com` / `anything` → identical alert text and URL pattern (FR-019); (e) assert exactly one `audit_log` row was inserted across (b), (c), (d) — the one from (b) — using a small DB query helper invoked from the test (use the service-role key from `.env.local` via a tiny `tests/e2e/_db.ts` helper). (Depends on T032, T033.)

**Checkpoint**: `/login` renders, sign-in works, the e2e block for US1 is
green. `/select-staff` is still 404 — that's the next phase.

---

## Phase 4: User Story 2 — Staff selects identity with a PIN (Priority: P1)

**Goal**: Render `/select-staff` with the seeded roster. Tapping a tile opens
the PIN keypad; entering the correct PIN sets the operator cookie, writes
`staff.signed_in` to `audit_log`, and redirects to `?next=` (default
`/dashboard`). Wrong PIN shows a calm error and writes `staff.pin_failed`.
After a successful PIN, the studio shell shows the operator chip.

**Independent Test**: After the US1 sign-in, land on `/select-staff`. The
roster shows Maya Patel, Jordan Lee, and Sam Chen. Tap Maya → keypad
appears → enter `1234` → land on `/dashboard`; the topbar shows
`Maya Patel · Owner`. Tap Maya again from `/select-staff` and enter `0000` →
calm error visible, keypad cleared, tile remains tappable, an
`audit_log` row with `action='staff.pin_failed'` exists.

### Implementation for User Story 2

- [ ] T035 [P] [US2] Create `components/lacquer/staff-tile.tsx` (server component). Props: `staff: { id, display_name, role, color_token }`, `selected?: boolean`. Renders a tap-target sized for iPad (`min-h: 88px`, `min-w: 160px`): avatar circle (initials computed from `display_name`, background derived from `color_token`), display name on top line, role chip below. When `selected` is true, applies `.auth-staff-tile.selected` (Lacquer ring). The element is a `<button>` posting an in-page form that swaps the `selectedTileId` query param via the page's URL — keeping the tap → keypad transition server-rendered.
- [ ] T036 [P] [US2] Create `components/lacquer/staff-roster.tsx` (server component). Props: `staff: Array<{...}>`, `selectedId?: string`. Wraps `.auth-roster` grid; renders one `<StaffTile />` per row in priority order (owners first, then managers, then technicians, then front_desk; within a role, `display_name` ascending). Each tile is a `<form>` posting `selectedTileId=<id>` (and the existing `next`) so the page can re-render with the keypad slot filled. (Depends on T035.)
- [ ] T037 [P] [US2] Create `components/lacquer/pin-keypad.tsx` as `"use client"` per research R8. Props: `staffId: string`, `next: string`. Renders a digit-display strip (4 dots) above a 3×4 button grid (1-9, 0, Clear). Local state: `digits: string[]` (max length 4). On each digit click, append; when length reaches 4, programmatically submit a hidden form `<form action={submitPin} ref>` with hidden inputs `staffId`, `pin`, `next`. Keyboard input wired via a `useEffect` `keydown` listener: numeric keys append, Backspace removes the last, Enter submits if length is 4. Clear button resets the buffer. Imports the action from `@/app/(auth)/select-staff/actions`. (Depends on T039 for the action import — but the file can be created in parallel; the action must exist before the page is exercised.)
- [ ] T038 [US2] Create `app/(auth)/select-staff/page.tsx` as a server component. Read `searchParams.next`, `searchParams.error`, `searchParams.selectedTileId`. Resolve the device user via `createSupabaseServerClient().auth.getUser()`; if absent, `redirect('/login?next=' + (next ?? ''))`. Query the staff roster: `from('staff').select('id, display_name, role, color_token').eq('active', true).not('pin_hash', 'is', null).order('role').order('display_name')`. **Empty state**: when zero rows, render a calm message ("No staff configured. Ask the salon owner to add staff in Settings.") + a `<form action={signOut}>` "Sign out" link. Otherwise render `<StaffRoster staff={roster} selectedId={selectedTileId} />` followed (when `selectedTileId` is set and matches a row) by `<PinKeypad staffId={selectedTileId} next={next ?? ''} />`. When `searchParams.error === 'pin_failed'`, render `<Alert variant="destructive">PIN didn't match. Try again.</Alert>` above the keypad. (Depends on T024, T036, T037.)
- [ ] T039 [US2] Create `app/(auth)/select-staff/actions.ts` with the `submitPin(formData)` Server Action per `contracts/server-actions.contract.md`. Steps: resolve device user (redirect to `/login` if absent); read `staffId`, `pin`, `next`; query the staff row (`from('staff').select('id, pin_hash, active').eq('id', staffId).single()`); if missing/inactive/`pin_hash IS NULL`, `await recordAuth('staff.pin_failed', user.id, staffId, { reason: 'invalid_target' })` then `redirect('/select-staff?error=pin_failed&next=' + next)`; call `verifyPin(pin, row.pin_hash)`; on mismatch, `await recordAuth('staff.pin_failed', user.id, staffId, { reason: 'mismatch' })` then redirect; on match, capture any existing operator cookie's `sid` (via `verifyOperatorCookie` — swallow errors), call `signOperatorCookie({ sid: staffId, iat: Math.floor(Date.now()/1000) })`, set the cookie via `cookies().set('acting_as_staff_id', value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 43200 })`, `await recordAuth('staff.signed_in', user.id, staffId, previousSid ? { previous_staff_id: previousSid } : {})`, then `redirect(sanitizeNext(next))`. (Depends on T009, T013, T015, T017, T019.)
- [ ] T040 [US2] Extend `tests/e2e/auth.spec.ts` with a US2 block. Cases: (a) after the US1 sign-in, the URL `/select-staff?next=%2Fdashboard` renders three roster tiles by display name (Maya Patel, Jordan Lee, Sam Chen); (b) tap the Maya tile → keypad appears (assert 4 empty dots + 11 visible buttons including Clear); (c) tap `1`, `2`, `3`, `4` in order → URL becomes `/dashboard` and the topbar shows `Maya Patel`; (d) reset to `/select-staff` (sign out + back in via the test helper), tap Maya, enter `0000` → URL becomes `/select-staff?error=pin_failed&...`, alert text exactly "PIN didn't match. Try again.", a `staff.pin_failed` audit row exists with `payload.reason === 'mismatch'` and `entity_id` equal to Maya's staff id; (e) verify keyboard input — type `5678` while the keypad is showing for Jordan and assert auto-submit fires (URL transitions to `/dashboard`); (f) refresh the keypad page — URL goes back to roster view (no buffer persistence, per spec edge case). (Depends on T038, T039.)

**Checkpoint**: Both P1 user stories are functional. Sign-in + PIN lands
on the dashboard. The studio shell shows the active operator. Audit-log
rows exist for every transition.

---

## Phase 5: User Story 3 — Switch staff at shift change (Priority: P2)

**Goal**: Implement the `switchStaff` Server Action so the operator menu's
"Switch staff" item clears the operator cookie, writes `staff.switched`,
and returns to `/select-staff` — Supabase session intact.

**Independent Test**: From `/dashboard` as Maya, open the operator menu → tap
"Switch staff" → land on `/select-staff` (no `/login` flash; the email +
password form is **not** shown). Pin in as Jordan (`5678`) → topbar shows
`Jordan Lee · Manager` on the next render.

### Implementation for User Story 3

- [ ] T041 [US3] Replace the stub `switchStaff` in `app/(studio)/actions.ts` with the real implementation per `contracts/server-actions.contract.md`. Steps: `await requireStudioSession()` to capture the current `viewer.staff.id` and `viewer.deviceUserId`; read the current pathname from `headers().get('referer')` and run it through `sanitizeNext`; `cookies().delete('acting_as_staff_id')`; `await recordAuth('staff.switched', viewer.deviceUserId, viewer.staff.id, {})`; `redirect('/select-staff?next=' + sanitizedReferer)`. Do **not** touch the Supabase session. (Depends on T013, T017, T019, T021.)
- [ ] T042 [US3] Extend `tests/e2e/auth.spec.ts` with a US3 block. Cases: (a) signed-in as Maya on `/dashboard`, open the operator menu (assert visible), click "Switch staff" → URL is `/select-staff?next=%2Fdashboard`; the form on `/login` is NOT visible (the device session persists); (b) the previously-selected tile (Maya) is rendered with the `selected` modifier — i.e., the page can show "you were Maya" before the new operator pins in; (c) tap Jordan → enter `5678` → URL is `/dashboard`; the topbar reflects `Jordan Lee`; (d) one `staff.switched` audit row exists with `acting_as_staff_id` = Maya's id (the outgoing operator) and one subsequent `staff.signed_in` row exists with `payload.previous_staff_id` = Maya's id. (Depends on T041.)

**Checkpoint**: Switch-staff works end-to-end. Both P1 stories + US3 are
operational.

---

## Phase 6: User Story 4 — Sign in with Google + magic-link recovery (Priority: P2)

**Goal**: On `/login`, render the "Continue with Google" button when
`NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` and a subordinate "Email me a
sign-in link" recovery control. Both round-trip through `/auth/callback`,
which exchanges the code and routes to `/select-staff`.

**Independent Test**: Two sub-stories. **Google**: set
`NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` and configure Supabase Google OAuth
with sandbox credentials. Click "Continue with Google", complete the
handshake, land on `/select-staff`. With the env flag false, the button is
hidden. **Magic-link**: click "Email me a sign-in link", enter
`owner@tangnails.dev`, the page swaps to a "Check your email" confirmation;
the email arrives in the local Inbucket; clicking the link lands on
`/select-staff`.

### Implementation for User Story 4

- [ ] T043 [P] [US4] Create `app/auth/callback/route.ts` (NOT under `(auth)/` — the path is literal `/auth/callback`) as a GET Route Handler per `contracts/routes.contract.md` § /auth/callback. Read `?code` and `?next` from `searchParams`; call `createSupabaseServerClient().auth.exchangeCodeForSession(code)`; on success `await recordAuth('device.signed_in', user.id, null, { method: 'oauth_google' })` (or `magic_link` — see step 4 below) then `redirect('/select-staff?next=' + sanitizeNext(next))`; on failure `redirect('/login?error=oauth_failed')`. **Method tagging**: derive the method from `data.user.app_metadata.provider` — `'google'` → `'oauth_google'`, `'email'` → `'magic_link'` (Supabase tags magic-link sign-ins as `email` provider). (Depends on T009, T017, T019.)
- [ ] T044 [P] [US4] Create `components/lacquer/google-sign-in-button.tsx` (server component). Props: `next: string`. Renders only when `process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'` (read at module scope). Body is a `<form action={signInWithGoogle}><input type="hidden" name="next" value={next} /><Button type="submit" variant="outline" className="auth-provider-btn">…<GoogleLogo /> Continue with Google</Button></form>` — for the logo, use a small inline SVG (Lucide doesn't ship a Google logo); place it in `components/lacquer/_google-logo.tsx` for re-use.
- [ ] T045 [P] [US4] Create `components/lacquer/magic-link-control.tsx` (server component). Props: `next: string`, `sentTo?: string` (when present, render the "Check your email" confirmation instead of the form). When not sent: render a subordinate text-link `<button>Email me a sign-in link instead</button>` styled `.auth-magic-link`; clicking reveals the magic-link form (use a `<details>` element so it works without JS — `<details><summary>Email me a sign-in link instead</summary><form action={signInWithMagicLink}>…<Input name="email" type="email" /> <Button>Send link</Button></form></details>`). When sent: render the confirmation card with the email address and a "Send another link" link that re-opens the form.
- [ ] T046 [US4] Add `signInWithGoogle(formData)` and `signInWithMagicLink(formData)` to `app/(auth)/login/actions.ts` per `contracts/server-actions.contract.md`. `signInWithGoogle`: read `next`, call `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback?next=<next> } })`, redirect to the URL Supabase returns (`data.url`). `signInWithMagicLink`: read `email`, `next`; call `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback?next=' + next } })`; **always** `redirect('/login?magic_sent=' + encodeURIComponent(email) + '&next=' + next)` regardless of whether the email exists (FR-019). Audit rows for `device.signed_in` are written by `/auth/callback`, not here. (Depends on T009, T033, T043.)
- [ ] T047 [US4] Update `app/(auth)/login/page.tsx` to render `<GoogleSignInButton next={next} />` below the password form (separated by an `.auth-divider` rendering "or") and `<MagicLinkControl next={next} sentTo={searchParams.magic_sent} />` below that as a subordinate text link. When `searchParams.magic_sent` is present, the password form should still render — the magic-link confirmation appears alongside, not as a replacement (so the user can still try the password again). (Depends on T032, T044, T045.)
- [ ] T048 [US4] Extend `tests/e2e/auth.spec.ts` with a US4 block. **Magic-link** (works with local Supabase + Inbucket): submit the magic-link form with `owner@tangnails.dev` → URL becomes `/login?magic_sent=...`, confirmation visible; query Inbucket via its HTTP API (`http://127.0.0.1:54324/api/v1/mailbox/owner`) to fetch the latest message, extract the magic-link URL, navigate to it → URL lands on `/select-staff?next=%2Fdashboard`; assert one `device.signed_in` audit row with `payload.method === 'magic_link'`. **Google**: skipped in CI (mark `test.skip` with a comment) — gated behind a manual run when sandbox credentials are present; the test asserts (when the env flag is true) that the Google button is visible and posts to a URL containing `accounts.google.com`. **Empty-email magic-link**: submit with empty email → form validation prevents submit (HTML5 required attribute) — assert the URL did not change. (Depends on T046, T047.)

**Checkpoint**: All three sign-in paths work. Google + magic-link both round-
trip through `/auth/callback` and land on `/select-staff` for the PIN step.

---

## Phase 7: User Story 5 — Operator session expiry (Priority: P2)

**Goal**: Verify end-to-end that an expired operator cookie redirects to
`/select-staff?next=...` and that the Supabase session is preserved (no
bounce to `/login`). The implementation already exists (cookie verifier
checks `iat + 43200 < now`; middleware clears + redirects); this story
ships the e2e proof.

**Independent Test**: Sign in + pin in as Maya. Pre-expire the operator
cookie via a Playwright `context.addCookies` call using `mintExpiredCookie`
from `tests/unit/auth/_fixtures.ts`. Visit `/calendar` → URL is
`/select-staff?next=%2Fcalendar`; pin in again → land on `/calendar`.

### Implementation for User Story 5

- [ ] T049 [US5] Extend `tests/e2e/auth.spec.ts` with a US5 block. Cases: (a) sign in + pin in as Maya; (b) drop the operator cookie and replace it with one whose `iat` is 13 hours in the past via `context.addCookies([{ name: 'acting_as_staff_id', value: await mintExpiredCookie({ sid: maya.id }), domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }])` — the helper uses the dev `ACTING_AS_COOKIE_SECRET`; (c) navigate to `/calendar` (a route that does not exist yet — that's fine, middleware fires first); (d) assert URL is `/select-staff?next=%2Fcalendar` and the email + password form is NOT shown (the device session is intact); (e) assert the request that triggered the redirect carried a `Set-Cookie: acting_as_staff_id=; Max-Age=0` header (cookie cleared by middleware) — use `page.on('response')` to capture; (f) optionally pin in again as Maya and assert URL becomes `/calendar` (still 404 expected — only verify the URL transition). (Depends on T011, T021, T023.)

**Checkpoint**: Session-expiry behavior is proven end-to-end. The cookie
verifier + middleware machinery (already foundational) is exercised by a
real test.

---

## Phase 8: User Story 6 — Sign out the device (Priority: P3)

**Goal**: Implement `signOut` so the operator menu's "Sign out" item
terminates the Supabase session, clears the operator cookie, writes
`device.signed_out`, and returns to `/login`.

**Independent Test**: From `/dashboard`, open the operator menu → tap "Sign
out" → URL is `/login`; a hard refresh keeps the user on `/login` (the
Supabase session is gone). Re-signing in returns to the standard flow.

### Implementation for User Story 6

- [ ] T050 [US6] Replace the stub `signOut` in `app/(studio)/actions.ts` with the real implementation per `contracts/server-actions.contract.md`. Steps: `await getStudioSessionOrDegraded()` to capture the device user id and (best-effort) the operator's `staff.id`; `await recordAuth('device.signed_out', viewer.deviceUserId, viewer.staff?.id ?? null, {})`; `cookies().delete('acting_as_staff_id')`; `await createSupabaseServerClient().auth.signOut()`; `redirect('/login')`. (Depends on T009, T019, T021.)
- [ ] T051 [US6] Extend `tests/e2e/auth.spec.ts` with a US6 block. Cases: (a) signed-in + pinned-in as Maya on `/dashboard`, open the operator menu, click "Sign out" → URL is `/login`; (b) hard reload (`page.reload()`) → URL is still `/login` (the form is rendered, not the dashboard); (c) one `device.signed_out` audit row exists with `actor_user_id` = Maya's auth.users id and `acting_as_staff_id` = Maya's staff id. (Depends on T050.)

**Checkpoint**: All six user stories are functional. The full login flow
(sign in → pin in → use studio → switch staff → sign out, plus magic-link
recovery and session expiry) is operational.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Soft-degrade verification, design audit, gate sweep, manual
walkthrough. No new code paths.

- [ ] T052 [P] Extend `tests/e2e/auth.spec.ts` with a soft-degrade block (FR-015a / Q1 verification): (a) sign in + pin in as Maya; (b) intercept Supabase requests and return `503` for any `/rest/v1/*` or `/auth/v1/*` call via `page.route('**/127.0.0.1:54321/**', route => route.fulfill({ status: 503 }))`; (c) reload `/dashboard` → assert the studio shell renders, the Reconnecting banner is visible (poll until `text=Reconnecting…` is in the DOM via `expect(...).toBeVisible({ timeout: 12000 })`), the operator chip shows `…` placeholder; (d) attempt the operator menu's "Switch staff" → assert a retryable error toast (NOT a redirect to `/login`); (e) restore the route handler → assert the banner disappears within ~10 s and the operator chip rebuilds with Maya's name; (f) the operator cookie is still valid (assert via `context.cookies()`).
- [ ] T053 [P] Run the design-system auditor against `/login`, `/select-staff`, and the studio topbar: invoke the `speckit-design-auditor` agent with target routes `app/(auth)/login/page.tsx`, `app/(auth)/select-staff/page.tsx`, and `app/(studio)/layout.tsx`. Note: no Lacquer prototype exists for the auth surfaces (verified during plan); the auditor checks token discipline + composition rules from `components/ui/*`. Address every reported violation. (SC-007, Constitution I.)
- [ ] T054 Run all four quality gates locally: `npm run typecheck && npm run lint && npm test && npm run test:e2e`. All four MUST pass. The Vitest auth suite (cookie / pin / next-url / audit / session) is non-negotiable per Constitution IV.2. Resolve any drift before requesting review. (Constitution Principle IV.)
- [ ] T055 Walk through `specs/003-login-flow/quickstart.md` end-to-end manually in a real browser: §3 happy path, §4 US1–US6 scenarios, §4 Soft-degrade scenario. Tick every assertion. Note in the PR description which scenarios were verified manually vs. covered by Playwright (Google OAuth is the one manual-only check). Capture the audit-log row count before + after the walkthrough as evidence of SC-006 coverage.

**Final checkpoint**: PR-ready. All 22 functional requirements covered; all
8 success criteria measurable and met; the dashboard's stub
`requireStudioSession()` is fully replaced (SC-008); all five constitution
principles upheld (II, III, and IV are all load-bearing for this feature).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001/T002 (npm installs) are sequential against
  each other only because both touch `package.json`/`package-lock.json` —
  if your team's git hooks tolerate concurrent edits, parallelize. T003,
  T004, T005, T005a are independent of all others.
- **Phase 2A (Schema)**: T006 + T007 → T008 (apply + types).
- **Phase 2B (DB clients)**: depends on T008 (types).
- **Phase 2C (Helpers)**: each (test, impl) pair is sequential. The
  pairs themselves are largely independent of each other — T013, T015,
  T017 only depend on the npm installs from Phase 1. T019 also depends
  on T010 (admin client).
- **Phase 2D (Session)**: depends on T009 (server client), T013 (cookie
  verify), T010 (for the staff lookup); T022 depends on T021.
- **Phase 2E (Middleware)**: depends on T009, T013.
- **Phase 2F (Layouts/chrome)**: T024 is independent. T025/T026/T027/T028
  are mostly independent (T028 depends on T009). T029 is independent.
  T030 depends on T021, T025, T026, T027.
- **Phase 3 (US1)**: depends on Phase 2 complete (T024, T029, T030 in
  particular — the auth layout and stub actions must exist).
- **Phase 4 (US2)**: depends on Phase 2 + Phase 3 (US1 ships sign-in;
  US2 builds on top of the post-sign-in landing).
- **Phase 5 (US3)**: depends on Phase 4 (the operator must be pinned in
  to Switch). Code-only, edits T029's stub.
- **Phase 6 (US4)**: depends on Phase 3 (extends `/login`). T043
  (callback route) is independent of T044/T045 but must be present
  before T048 runs.
- **Phase 7 (US5)**: depends on Phase 4 (operator must exist before its
  cookie can expire). Test-only; no implementation work.
- **Phase 8 (US6)**: depends on Phase 4. Code-only, edits T029's stub.
- **Phase 9 (Polish)**: depends on every prior phase.

### Within Each User Story

- Components are written before the page edit that mounts them (T031
  before T032; T035–T037 before T038; T044/T045 before T047).
- Server Actions are written before or alongside the page that posts to
  them (T033 with T032; T039 with T038; T046 with T047).
- The Playwright spec is **extended once per phase** (T034 → T040 → T042
  → T048 → T049 → T051) so each story ships with its own end-to-end
  block. These tasks all touch the same file
  (`tests/e2e/auth.spec.ts`) and are therefore strictly **sequential**,
  never parallel.
- Test-first pairs in Phase 2C are strictly sequential (write red, then
  green). Different pairs can run in parallel because they touch
  different files.

### Parallel Opportunities

- Phase 1: T002 / T003 / T004 / T005 / T005a can run in parallel after
  T001 (T001 must land first only because the next `npm install` would
  re-run the lockfile resolution).
- Phase 2A: T006 + T007 in parallel; T008 sequential.
- Phase 2B: T009 / T010 in parallel.
- Phase 2C: the four pairs (cookie/pin/next-url/audit) are mutually
  parallel — T011/T012/T014/T016/T018 can all be written first; then
  T013/T015/T017/T019 follow sequentially within each pair.
- Phase 2D: T020 first (parallel with the Phase 2C tests); T021 then
  T022 sequentially.
- Phase 2F: T024 / T025 / T026 / T027 / T028 / T029 mostly parallel; T030
  sequentially after.
- Phase 3: T031 [P]; T032 / T033 sequential edits; T034 last.
- Phase 4: T035 / T036 / T037 [P]; T038 / T039 sequential; T040 last.
- Phase 6: T043 / T044 / T045 [P]; T046 / T047 sequential; T048 last.
- Phase 9: T052 / T053 [P]; T054 / T055 sequential.

---

## Parallel Example: Phase 2C (test-first helpers)

```bash
# Step 1 — write all five red test files in parallel:
Task: "Create tests/unit/auth/_fixtures.ts"                      # T011
Task: "Create tests/unit/auth/cookie.test.ts (red)"              # T012
Task: "Create tests/unit/auth/pin.test.ts (red)"                 # T014
Task: "Create tests/unit/auth/next-url.test.ts (red)"            # T016
Task: "Create tests/unit/auth/audit.test.ts (red)"               # T018
Task: "Create tests/unit/auth/session.test.ts (red)"             # T020
# Run npm test — expect all five suites RED.

# Step 2 — implement each helper to turn its suite green (sequential within each pair):
Task: "Implement lib/auth/cookie.ts"                             # T013
Task: "Implement lib/auth/pin.ts"                                # T015
Task: "Implement lib/auth/next-url.ts"                           # T017
Task: "Implement lib/auth/audit.ts"                              # T019
Task: "Replace lib/auth/session.ts (real impl)"                  # T021
# Run npm test — expect all five suites GREEN.
```

---

## Implementation Strategy

### MVP First (US1 + US2 only)

1. Phase 1 (Setup) — deps, primitives, styles, env.
2. Phase 2 (Foundational) — schema, db clients, helpers (test-first),
   middleware, layouts, topbar. Big phase, high leverage.
3. Phase 3 (US1) — `/login` + signInWithPassword.
4. Phase 4 (US2) — `/select-staff` + submitPin + operator chip lit up.
5. **STOP and VALIDATE**: at this point a signed-in operator can reach
   the dashboard and every later studio feature can call
   `requireStudioSession()`. The "real auth gate" is in place.

### Incremental Delivery (recommended)

1. Phase 1 + 2 → foundation ready (schema applied, helpers tested).
2. Phase 3 (US1) → sign-in works, lands on `/select-staff` (404 OK).
3. Phase 4 (US2) → full happy path lands on `/dashboard`.
4. Phase 5 (US3) → shift-change works.
5. Phase 6 (US4) → Google + magic-link recovery.
6. Phase 7 (US5) → expiry redirect proven by test.
7. Phase 8 (US6) → sign-out works.
8. Phase 9 (Polish) → soft-degrade test + design audit + manual walkthrough.

### Parallel Team Strategy

Two developers after Phase 2:

- Dev A: Phase 3 (US1) → Phase 4 (US2) → Phase 8 (US6) — owns the auth
  pages and the canonical Server Actions.
- Dev B: Phase 5 (US3) + Phase 6 (US4) + Phase 7 (US5) — owns the
  shell-level actions and alternative sign-in methods. Can start as soon
  as Dev A's Phase 4 lands (US3 / US5 / US6 all need a working PIN flow
  to test).

Within Phase 2 itself, all five test-first pairs can be assigned to
different pairs of developers and merged independently — they touch
disjoint files (`lib/auth/{cookie,pin,next-url,audit,session}.ts` and the
matching test files).

---

## Notes

- `[P]` tasks touch different files. Tasks that edit the same file
  (`tests/e2e/auth.spec.ts` is edited in T034, T040, T042, T048, T049,
  T051, T052; `app/(auth)/login/page.tsx` in T032 + T047;
  `app/(auth)/login/actions.ts` in T033 + T046; `app/(studio)/actions.ts`
  in T029 + T041 + T050) are intentionally sequential.
- `[Story]` labels appear on Phase 3–8 tasks only. Phases 1, 2, and 9
  carry no story label.
- Every helper file under `lib/auth/*` MUST land **after** its Vitest
  suite is committed and shown to fail. Constitution IV.3 — for money
  and auth logic, tests are written and shown to fail before the
  implementation that satisfies them is written.
- Every visual element under `/login`, `/select-staff`, and the new
  studio topbar MUST resolve to a `var(--*)` from `styles/tokens.css`.
  No raw hex codes, no off-scale spacing, no custom font weights. The
  design-system auditor in T053 is the final arbiter (SC-007).
- Tests live in `tests/unit/auth/*` (Vitest) and `tests/e2e/auth.spec.ts`
  (Playwright). CI runs all four gates on every PR (`typecheck`, `lint`,
  `vitest`, `playwright`) — see `.github/workflows/ci.yml` from feature
  001. PRs touching auth additionally require a reviewer to confirm
  Constitution Principles II, III, and IV (see constitution
  § Development Workflow & Quality Gates).
- The `audit_log.payload` column must remain unreadable from
  `authenticated` clients (T006 RLS + grants). Any future feature that
  needs to read payload must do so via the service-role client.
- The Supabase Auth password policy (8-character minimum, no character-
  class rules per FR-023) is configured **per Supabase project** via the
  Supabase dashboard or management API — there is no app-code change
  for it. Document this as a one-time project-config step in the PR
  description and in `quickstart.md` § 1.
- Commit after each task or each logical group; the `after_implement`
  hook in `.specify/extensions.yml` will commit at the end of
  `/speckit-implement`, but small per-task commits keep review legible
  and protect Constitution IV's "test-shown-to-fail" history.
- Stop at any checkpoint to validate the most recent user story before
  starting the next.
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that
  break independent testing, skipping the test-first pair sequence for
  any `lib/auth/*` helper.
