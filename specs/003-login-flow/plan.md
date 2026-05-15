# Implementation Plan: Login Flow (Device Sign-In + Staff PIN)

**Branch**: `003-login-flow` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-login-flow/spec.md`

## Summary

Build the two-layer login gate that fronts every studio surface: a long-lived
**Supabase device session** (email/password, Google OAuth, or magic-link
fallback) plus a short-lived **operator cookie** set after a staff member taps
their tile and enters a 4-digit PIN. Together they identify *what device* and
*who pressed the button* on every write — both are recorded in `audit_log`.
Replaces the dashboard feature's stub `requireStudioSession()` in place, with
the same call signature, so no consumer changes.

**Technical approach**: A repo-root Edge `middleware.ts` reads the Supabase
session via `@supabase/ssr` and the operator cookie's signature/`Max-Age`,
preserving `?next=<sanitized-path>` on every redirect. `/login` is a Server
Component with a `<form action={signInWithPassword}>` Server Action plus
auxiliary actions for Google OAuth (`/auth/callback` route handler) and a
subordinate magic-link control. `/select-staff` is a Server Component that
reads the active roster (no DB call from middleware itself), composing tappable
tiles + a `pin-keypad.tsx` client island that auto-submits on the 4th digit
into a `submitPin` Server Action. PIN verification uses **bcryptjs** (pure-JS,
cost 11 — the sole brute-force cost per FR-011). On success the action sets a
**HMAC-signed httpOnly cookie** containing `staff.id` + issued-at, with a hard
`Max-Age=43200` (no sliding extension), records `staff.signed_in` to
`audit_log`, and redirects to `?next=` (sanitized to a `(studio)` path).
`requireStudioSession()` becomes the real implementation in
`lib/auth/session.ts`; on Supabase failure it returns a `degraded` sentinel so
Server Actions short-circuit with a retryable toast and the new studio-shell
topbar shows the Lacquer "Reconnecting…" banner — the operator cookie is
**not** invalidated by transient outages (Q1). Schema is added by a targeted
`0001_auth_schema.sql` (only `staff` + `audit_log` + minimal RLS) so future
features add their own migrations without entangling the auth surface. See
[research.md](./research.md) for the full decision record.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (matches the repo's
`engines`).

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server Actions),
React 19, `@supabase/ssr` 0.10 + `@supabase/supabase-js` 2 (already
installed), `bcryptjs` 2 (NEW — pure-JS bcrypt for PIN hashing/verify; cost 11),
`jose` 5 (NEW — HMAC sign/verify for the operator cookie via Web Crypto), four
new shadcn primitives (`input`, `label`, `alert`, `dropdown-menu` — Radix-
backed), `lucide-react` (already installed). The dashboard feature's `button`,
`card`, `avatar` primitives are reused.

**Storage**: Supabase Postgres via `@supabase/ssr` typed clients. This feature
introduces `supabase/migrations/0001_auth_schema.sql` containing **only**
`staff` and `audit_log` (with their indexes and minimal RLS). Other tables
from the system-design schema are deferred to the features that own them
(R4). New TS types are generated from the migration via
`npx supabase gen types typescript --local` into `lib/db/types.ts`. New
clients in `lib/db/server.ts` (RSC/Server Action — uses cookie session) and
`lib/db/admin.ts` (service-role; only the audit-log writer uses it).

**Testing**: Vitest (unit) at `tests/unit/auth/*.test.ts` covering: HMAC cookie
sign/verify (round-trip + tamper detection), bcrypt PIN verify (constant-time
behavior + cost check), `requireStudioSession()` happy/degraded/redirect
paths, `?next=` sanitizer (same-origin, `(studio)` prefix only), audit-log
writer (all five action values), magic-link callback handshake. Playwright
e2e at `tests/e2e/auth.spec.ts` covering: full sign-in (email + PIN →
dashboard), wrong-password and wrong-PIN paths, switch-staff handoff, sign-out,
session-expiry redirect (cookie pre-expired), Supabase outage soft-degrade
(network mocked offline mid-shift), and the unauthenticated-deep-link
preservation through `?next=`.

**Target Platform**: Web (modern evergreen browsers). The salon counter
laptop and the front-desk iPad are the primary form factors; viewport range
360 px – 1440 px (matches dashboard SC-006 baseline). No PWA work in this
feature.

**Project Type**: Next.js App Router web application (single repo root,
matches dashboard feature).

**Performance Goals**: Bcrypt PIN verify ≤ 300 ms at cost 11 on
counter-class hardware; full sign-in path completes in < 15 s wall-clock
(SC-001); operator switch reflects in the studio shell within one render
(SC-005); middleware adds < 5 ms p95 to a request (Edge-runtime, no DB call
in middleware).

**Constraints**:
- **Server-authoritative**: PIN check, cookie issuance, Supabase session
  reads happen in Server Actions / middleware only. Client islands handle
  keypad input + auto-submit only (Constitution II).
- **Auditable**: Every auth state change writes to `audit_log` with one of
  five controlled-vocabulary `action` values: `device.signed_in`,
  `device.signed_out`, `staff.signed_in`, `staff.pin_failed`, `staff.switched`
  (FR-016, Constitution III).
- **Cookie hygiene**: `acting_as_staff_id` is `HttpOnly`, `Secure`,
  `SameSite=Lax`, signed with HS256 over a server-only `ACTING_AS_COOKIE_SECRET`,
  carrying `Max-Age=43200` with **no** sliding extension (FR-008).
- **No PII in cookie payload**: cookie carries `staff.id` + issued-at only;
  display name / role / color are looked up server-side per request so
  deactivation takes effect on the next render (spec assumption).
- **No PIN cooldown / lockout**: bcrypt latency is the only cost (FR-011 +
  Q2 clarification).
- **Password floor**: Supabase Auth password policy set to **min length 8**,
  no character-class rules (FR-023 + Q3 clarification).
- **Magic-link as recovery fallback**: enabled on the Supabase project; the
  `/login` UI surfaces it as a subordinate text-link, not a primary button
  (FR-001 + Q4 clarification).
- **Soft-degrade**: `requireStudioSession()` returns a `degraded` sentinel
  on Supabase failure rather than throwing; Server Actions short-circuit
  with a retryable toast; the studio shell renders the "Reconnecting…"
  banner; the operator cookie is not invalidated (FR-015a + Q1 clarification).
- **No raw values**: every color, spacing, radius, shadow, type weight on
  `/login`, `/select-staff`, and the studio topbar resolves to a `var(--*)`
  Lacquer token (Constitution I, FR-017).
- **Lucide-only icons** at 1.5 px stroke (FR-017).
- **Kiosk routes exempt**: middleware skips `/kiosk/*`, `/login`,
  `/select-staff`, `/auth/callback`, and `/api/webhooks/*` (FR-004).

**Scale/Scope**: Two new full pages (`/login`, `/select-staff`), one route
handler (`/auth/callback`), one repo-root middleware, one targeted migration
(2 tables + 4 RLS policies), real `requireStudioSession()` (in place), 6
Server Actions, 1 audit-log writer, 4 new lacquer components (login form +
provider buttons + magic-link control + PIN keypad), 1 studio-shell topbar
augmentation (operator chip + dropdown menu + Reconnecting banner slot), 4
new shadcn primitives, ~10 unit tests, ~6 Playwright scenarios. No new
runtime dependencies beyond `bcryptjs` and `jose`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status | Notes |
|-----------|----------|--------|-------|
| I. Design System Fidelity | **Yes** | **PASS** | No `/login` or `/select-staff` prototype exists in `design-system/` (verified — only `KioskSignIn.jsx` is present, and that is the customer kiosk, not staff login). Spec FR-018 explicitly anticipates this and permits composition from `components/ui/*` shadcn primitives following Lacquer conventions. Every value on the new surfaces resolves to a `var(--*)` token vendored by feature 002. Icons are Lucide at 1.5 px stroke. No second component library is introduced (R7). |
| II. Server-Authoritative Architecture | **Yes (load-bearing)** | **PASS** | All Supabase Auth calls and PIN verification happen in middleware (Edge) and Server Actions (Node) — never in the client. The PIN keypad is the **only** client island in this feature and it does no auth work; it merely buffers digits and submits the action. Cookies are signed with a server-only secret (R2). The audit-log writer uses the service-role client only (R9). |
| III. Auditability & Money Integrity | **Yes (auditability)** | **PASS** | Every state change writes to `audit_log` via `recordAuth(...)` (R9) using one of five controlled-vocabulary action values defined in `lib/auth/audit.ts` (FR-016). Money paths are not exercised by this feature, so the money-integrity sub-clauses do not apply. |
| IV. Test-First for Critical Paths | **Yes (load-bearing)** | **PASS** | Auth is a critical path under Principle IV.2. Vitest unit tests for `verifyOperatorCookie`, `signOperatorCookie`, `verifyPin`, `requireStudioSession`, the `?next=` sanitizer, and the audit writer are written **before** their implementations (the Vitest tasks emit failing assertions first). Playwright e2e covers the full flow end-to-end (R10). PRs touching these files will be flagged by the Constitution IV gate. |
| V. Scope Discipline & Cost Restraint | **Yes** | **PASS w/ noted pull-forwards** | Three deliberate pull-forwards from the build order — all justified, all the smallest viable shape (R4, R12, R13) — captured in Complexity Tracking. No paid services introduced; `bcryptjs` and `jose` are tiny pure-JS libraries. Out-of-scope items (kiosk pairing, manager-PIN inline override, password reset email, MFA, self-service signup) remain explicitly deferred per FR-020/021/022. |

**Gate result**: PASS. Pull-forwards are documented in Complexity Tracking
and each is the smallest shape that satisfies the spec without breaking the
soft-degrade contract (Q1) or fragmenting future migrations.

*Post-design re-check (after Phase 1)*: The contracts in `contracts/` and the
data model add no new abstraction layers beyond what this section already
covers; the middleware → Server Action → DB → cookie flow is unchanged; no
new dependencies were introduced by Phase 1. **Constitution Check still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/003-login-flow/
├── plan.md              # This file
├── spec.md              # Feature specification (with Clarifications session 2026-05-15)
├── research.md          # Phase 0 — decision record (R1–R13)
├── data-model.md        # Phase 1 — staff, audit_log, operator cookie, StudioViewer
├── quickstart.md        # Phase 1 — seed PINs, run flows, verify in CI
├── contracts/
│   ├── README.md
│   ├── routes.contract.md          # /login, /select-staff, /auth/callback
│   ├── server-actions.contract.md  # signInWithPassword, signInWithMagicLink, submitPin, switchStaff, signOut
│   ├── session-helper.contract.md  # requireStudioSession + degraded sentinel
│   ├── cookie.contract.md          # acting_as_staff_id payload + signing
│   └── audit.contract.md           # action enum + payload shape per action
└── checklists/
    └── requirements.md  # (existing — untouched by this command)
```

### Source Code (repository root)

```text
middleware.ts                          # NEW — Edge: reads Supabase session + operator cookie; redirects with ?next=

app/
├── layout.tsx                         # (existing — unchanged)
├── page.tsx                           # (existing — unchanged; already redirects to /dashboard)
├── (auth)/
│   ├── layout.tsx                     # NEW — minimal auth shell (centered card on neutral background)
│   ├── login/
│   │   ├── page.tsx                   # NEW — RSC: renders LoginForm + provider buttons + magic-link link
│   │   └── actions.ts                 # NEW — signInWithPassword, signInWithMagicLink Server Actions
│   └── select-staff/
│       ├── page.tsx                   # NEW — RSC: renders the staff roster
│       └── actions.ts                 # NEW — submitPin, switchStaff Server Actions
├── auth/
│   └── callback/
│       └── route.ts                   # NEW — Supabase OAuth + magic-link PKCE callback handler
├── (studio)/
│   ├── layout.tsx                     # MODIFIED — adds the topbar (operator chip + dropdown + Reconnecting banner slot)
│   ├── actions.ts                     # NEW — signOut Server Action (lives at studio scope so the menu can call it)
│   └── dashboard/                     # (existing — unchanged; but now gated for real)
└── api/
    └── (existing — unchanged; webhooks subdirectory exempt from middleware)

components/
├── ui/                                # MODIFIED — populated by `npx shadcn add input label alert dropdown-menu`
│   ├── input.tsx                      # NEW
│   ├── label.tsx                      # NEW
│   ├── alert.tsx                      # NEW
│   └── dropdown-menu.tsx              # NEW
└── lacquer/
    ├── login-form.tsx                 # NEW — server component (form action wires to actions.ts)
    ├── google-sign-in-button.tsx      # NEW — server component (renders form posting to a Google OAuth Server Action; hidden when Google not configured)
    ├── magic-link-control.tsx         # NEW — server component (subordinate text link → opens inline form)
    ├── staff-roster.tsx               # NEW — server component (grid of StaffTile)
    ├── staff-tile.tsx                 # NEW — server component (avatar + name + role chip)
    ├── pin-keypad.tsx                 # NEW — "use client" — 3×4 grid + buffer + auto-submit on 4th digit
    ├── operator-chip.tsx              # NEW — server component (display_name + color_token + role chip; opens dropdown)
    ├── operator-menu.tsx              # NEW — "use client" — DropdownMenu wrapper for Switch staff / Sign out
    └── reconnecting-banner.tsx        # NEW — "use client" — listens to a tiny health-check signal; shows the Lacquer notice when degraded

lib/
├── auth/
│   ├── session.ts                     # MODIFIED — replaces stub: real requireStudioSession + StudioViewer + DegradedSession sentinel
│   ├── cookie.ts                      # NEW — signOperatorCookie, verifyOperatorCookie (HS256 via jose)
│   ├── pin.ts                         # NEW — hashPin, verifyPin (bcryptjs cost 11)
│   ├── audit.ts                       # NEW — recordAuth(action, deviceUserId, staffId?, payload?)
│   ├── next-url.ts                    # NEW — sanitizeNext(rawNext): same-origin, (studio) prefix, default /dashboard
│   └── supabase-config.ts             # NEW — sets Supabase Auth password policy (min 8, no classes) + provider toggles at app boot
├── db/
│   ├── server.ts                      # NEW — createServerClient (cookies-aware, used by RSC + Server Actions)
│   ├── admin.ts                       # NEW — createServiceRoleClient (used only by lib/auth/audit.ts)
│   └── types.ts                       # NEW — generated types from `npx supabase gen types typescript --local`
└── (existing dirs unchanged)

styles/
├── tokens.css                         # (existing — unchanged)
├── globals.css                        # (existing — unchanged)
└── auth.css                           # NEW — minimal `.auth-*` classes for the centered card, keypad grid, and operator chip (every value resolves to a token)

supabase/
├── migrations/
│   └── 0001_auth_schema.sql           # NEW — staff + audit_log + indexes + 4 RLS policies
└── seed.sql                           # NEW — owner Supabase user reference + 3 seeded staff with bcrypt-hashed PINs (1234 / 5678 / 9999) for dev only

tests/
├── unit/
│   └── auth/
│       ├── cookie.test.ts             # NEW — sign/verify round-trip + tamper + Max-Age behavior
│       ├── pin.test.ts                # NEW — bcryptjs hash + verify + constant-time check
│       ├── session.test.ts            # NEW — requireStudioSession happy / degraded / redirect / deactivated-staff paths
│       ├── next-url.test.ts           # NEW — sanitizeNext (same-origin, prefix, default)
│       └── audit.test.ts              # NEW — recordAuth covers all five action values
└── e2e/
    └── auth.spec.ts                   # NEW — full sign-in, wrong PIN, switch staff, sign out, session expiry, soft-degrade, deep-link preservation
```

**Structure Decision**: Single Next.js App Router web application (matches
features 001 and 002). Auth lives in the `(auth)` route group with its own
minimal layout, and the studio layout is augmented in place — there is no
separate `apps/auth` package, and there will not be one.

## Phase outputs (for /speckit-tasks)

- **Phase 0**: [research.md](./research.md) — 13 decisions, every
  `NEEDS CLARIFICATION` resolved.
- **Phase 1**:
  - [data-model.md](./data-model.md) — `staff`, `audit_log`, the operator
    cookie payload, and the `StudioViewer` / `DegradedSession` composite
    types.
  - [contracts/](./contracts) — routes contract, Server Actions contract,
    session helper contract, cookie contract, audit contract.
  - [quickstart.md](./quickstart.md) — seed PINs, configure Supabase
    providers, run the flows in dev, run unit + e2e in CI.

## Complexity Tracking

> Three items pulled forward into this feature beyond the spec's headline scope
> because they unblock it and they are exactly what the `docs/system-design.md`
> build order prescribes.

| Item | Why included here | Simpler alternative rejected because |
|------|-------------------|--------------------------------------|
| Targeted `0001_auth_schema.sql` (only `staff` + `audit_log` + minimal RLS) instead of the full system-design schema | The auth flow cannot run without `staff` (PIN hashes) and `audit_log` (FR-016). Shipping only what's needed honors Principle V; future features add their own migrations for the tables they introduce (calendar → appointments, walkin → walk_ins, checkout → tickets/payments/...). | (a) Full schema in one migration: too much speculative scope for an "auth" feature, drags in tables nothing in the codebase reads yet; (b) Separate "schema-only" feature first: pure calendar drag — no user value, just a one-commit drop-in. |
| Real studio-shell topbar (operator chip + dropdown + Reconnecting banner slot) | The spec assumes a topbar exists with a menu trigger, but the dashboard feature shipped only a passthrough layout (verified). "Switch staff" and "Sign out" need somewhere to live, and the soft-degrade banner needs a slot. Adding it here keeps the auth feature self-contained. | (a) Defer the topbar entirely: then there's nowhere to put Switch staff or Sign out, and the spec's US3/US6 cannot ship; (b) Spawn a separate "shell" feature: artificial split — the only consumer of those affordances is auth. |
| `lib/db/server.ts` + `lib/db/admin.ts` + generated `types.ts` | The auth feature is the first one to read/write Supabase. Without typed clients there's nothing to call. The build order places "db clients" (step 5) right before "auth" (step 7) for this exact reason. | (a) Inline `createClient(...)` calls everywhere: drift, no shared cookie wiring, no shared types; (b) Separate "db clients" feature: same one-commit-no-user-value problem as schema-only. |

No other deviations. Standard implementation discipline applies: PIN check
and cookie issuance live only in Server Actions; the keypad is the lone
client island in the (auth) group; every visual value points at a token; the
operator cookie carries no PII; the audit writer uses the controlled-vocab
enum and is the single point of truth for all five action values.
